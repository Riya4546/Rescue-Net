-- RescueNet Supabase contract update (2026-04-09)
-- Goal:
-- 1) `profiles` = canonical identity/profile rows for signed-in users.
-- 2) `help_requests` = canonical case records.
-- 3) `work_history` = per-user activity timeline linked to cases.
-- 4) `member_records` = cached summary metrics for dashboards/profile cards.
-- 5) `resources` = actual resource inventory only, never auth fallback.
--
-- Run this in Supabase SQL Editor after taking a backup.

begin;

create extension if not exists pgcrypto;

-- -------------------------------------------------
-- 1) PROFILES (canonical identity)
-- -------------------------------------------------
alter table if exists public.profiles
    add column if not exists full_name text,
    add column if not exists user_role text,
    add column if not exists location text,
    add column if not exists auth_provider text default 'supabase_auth',
    add column if not exists created_at timestamptz default now(),
    add column if not exists updated_at timestamptz default now(),
    add column if not exists last_login_at timestamptz;

create unique index if not exists idx_profiles_email_lower
    on public.profiles ((lower(email)));

-- Backfill canonical profiles from existing member_records
insert into public.profiles (
    id,
    email,
    full_name,
    user_role,
    location,
    auth_provider,
    created_at,
    updated_at
)
select
    case
        when m.id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then m.id
        else gen_random_uuid()
    end,
    lower(m.email),
    m.full_name,
    coalesce(nullif(m.user_role, ''), 'Volunteer'),
    m.location,
    'legacy_member_records',
    now(),
    now()
from public.member_records m
where m.email is not null
  and not exists (
      select 1
      from public.profiles p
      where lower(p.email) = lower(m.email)
  );

-- Backfill canonical profiles from help request participants
insert into public.profiles (
    id,
    email,
    full_name,
    user_role,
    auth_provider,
    created_at,
    updated_at
)
select distinct
    case
        when candidate.profile_identity ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then candidate.profile_identity::uuid
        else gen_random_uuid()
    end,
    candidate.email,
    candidate.full_name,
    candidate.user_role,
    'legacy_help_requests',
    now(),
    now()
from (
    select
        lower(coalesce(
            h.specific_details->'participants'->>'requester_email',
            case when h.created_by like '%@%' then h.created_by else null end
        )) as email,
        coalesce(
            h.specific_details->'participants'->>'requester_name',
            initcap(replace(split_part(lower(coalesce(
                h.specific_details->'participants'->>'requester_email',
                case when h.created_by like '%@%' then h.created_by else null end,
                h.created_by
            )), '@', 1), '.', ' '))
        ) as full_name,
        coalesce(
            nullif(h.specific_details->'participants'->>'requester_id', ''),
            case when h.created_by not like '%@%' then h.created_by else null end
        ) as profile_identity,
        'Requester' as user_role
    from public.help_requests h

    union all

    select
        lower(coalesce(
            h.specific_details->'participants'->>'volunteer_email',
            case when h.assigned_volunteer like '%@%' then h.assigned_volunteer else null end
        )) as email,
        coalesce(
            h.specific_details->'participants'->>'volunteer_name',
            initcap(replace(split_part(lower(coalesce(
                h.specific_details->'participants'->>'volunteer_email',
                case when h.assigned_volunteer like '%@%' then h.assigned_volunteer else null end,
                h.assigned_volunteer
            )), '@', 1), '.', ' '))
        ) as full_name,
        coalesce(
            nullif(h.specific_details->'participants'->>'volunteer_id', ''),
            case when h.assigned_volunteer not like '%@%' then h.assigned_volunteer else null end
        ) as profile_identity,
        'Volunteer' as user_role
    from public.help_requests h
) candidate
where candidate.email is not null
  and candidate.email <> ''
  and not exists (
      select 1
      from public.profiles p
      where lower(p.email) = candidate.email
  );

-- -------------------------------------------------
-- 2) HELP REQUESTS (canonical cases)
-- -------------------------------------------------
alter table if exists public.help_requests
    add column if not exists requester_profile_id text,
    add column if not exists requester_email text,
    add column if not exists assigned_volunteer_profile_id text,
    add column if not exists assigned_volunteer_email text,
    add column if not exists updated_at timestamptz default now();

update public.help_requests h
set
    requester_profile_id = coalesce(
        h.requester_profile_id,
        nullif(h.specific_details->'participants'->>'requester_id', ''),
        case when h.created_by not like '%@%' then h.created_by else null end
    ),
    requester_email = lower(coalesce(
        nullif(h.requester_email, ''),
        nullif(h.specific_details->'participants'->>'requester_email', ''),
        case when h.created_by like '%@%' then h.created_by else null end
    )),
    assigned_volunteer_profile_id = coalesce(
        h.assigned_volunteer_profile_id,
        nullif(h.specific_details->'participants'->>'volunteer_id', ''),
        case when h.assigned_volunteer not like '%@%' then h.assigned_volunteer else null end
    ),
    assigned_volunteer_email = lower(coalesce(
        nullif(h.assigned_volunteer_email, ''),
        nullif(h.specific_details->'participants'->>'volunteer_email', ''),
        case when h.assigned_volunteer like '%@%' then h.assigned_volunteer else null end
    )),
    updated_at = coalesce(h.updated_at, now())
where true;

create index if not exists idx_help_requests_requester_profile_id
    on public.help_requests (requester_profile_id);

create index if not exists idx_help_requests_assigned_volunteer_profile_id
    on public.help_requests (assigned_volunteer_profile_id);

create index if not exists idx_help_requests_requester_email_lower
    on public.help_requests ((lower(requester_email)));

create index if not exists idx_help_requests_assigned_volunteer_email_lower
    on public.help_requests ((lower(assigned_volunteer_email)));

-- Keep canonical requester/volunteer identities in sync and enforce assignment rules.
create or replace function public.rescuenet_enforce_help_request_rules()
returns trigger
language plpgsql
as $$
declare
    requester_identity text;
    requester_email_value text;
    volunteer_identity text;
    volunteer_email_value text;
    active_assignment_count integer := 0;
begin
    new.specific_details := coalesce(new.specific_details, '{}'::jsonb);

    requester_identity := lower(coalesce(
        nullif(new.requester_profile_id, ''),
        nullif(new.specific_details->'participants'->>'requester_id', ''),
        case when coalesce(new.created_by, '') not like '%@%' then new.created_by else null end
    ));
    requester_email_value := lower(coalesce(
        nullif(new.requester_email, ''),
        nullif(new.specific_details->'participants'->>'requester_email', ''),
        case when coalesce(new.created_by, '') like '%@%' then new.created_by else null end
    ));
    volunteer_identity := lower(coalesce(
        nullif(new.assigned_volunteer_profile_id, ''),
        nullif(new.specific_details->'participants'->>'volunteer_id', ''),
        case when coalesce(new.assigned_volunteer, '') not like '%@%' then new.assigned_volunteer else null end
    ));
    volunteer_email_value := lower(coalesce(
        nullif(new.assigned_volunteer_email, ''),
        nullif(new.specific_details->'participants'->>'volunteer_email', ''),
        case when coalesce(new.assigned_volunteer, '') like '%@%' then new.assigned_volunteer else null end
    ));

    if requester_identity is not null then
        new.requester_profile_id := requester_identity;
    end if;
    if requester_email_value is not null then
        new.requester_email := requester_email_value;
    end if;
    if new.created_by is null or new.created_by = '' then
        new.created_by := coalesce(requester_identity, requester_email_value);
    end if;

    if volunteer_identity is not null then
        new.assigned_volunteer_profile_id := volunteer_identity;
    end if;
    if volunteer_email_value is not null then
        new.assigned_volunteer_email := volunteer_email_value;
    end if;
    if coalesce(new.assigned_volunteer, '') = '' and coalesce(volunteer_identity, volunteer_email_value) is not null then
        new.assigned_volunteer := coalesce(volunteer_identity, volunteer_email_value);
    end if;

    new.specific_details := jsonb_set(
        new.specific_details,
        '{participants}',
        coalesce(new.specific_details->'participants', '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
            'requester_id', requester_identity,
            'requester_email', requester_email_value,
            'volunteer_id', volunteer_identity,
            'volunteer_email', volunteer_email_value
        )),
        true
    );

    if requester_identity is not null and volunteer_identity is not null and requester_identity = volunteer_identity then
        raise exception 'Requester cannot volunteer for the same help request.'
            using errcode = '23514';
    end if;

    if requester_email_value is not null and volunteer_email_value is not null and requester_email_value = volunteer_email_value then
        raise exception 'Requester cannot volunteer for the same help request.'
            using errcode = '23514';
    end if;

    if coalesce(new.status, 'queued') = 'on_progress' and (volunteer_identity is not null or volunteer_email_value is not null) then
        select count(*)
        into active_assignment_count
        from public.help_requests h
        where h.id is distinct from new.id
          and h.status = 'on_progress'
          and (
              (volunteer_identity is not null and lower(coalesce(
                  h.assigned_volunteer_profile_id,
                  h.specific_details->'participants'->>'volunteer_id',
                  case when coalesce(h.assigned_volunteer, '') not like '%@%' then h.assigned_volunteer else null end
              )) = volunteer_identity)
              or
              (volunteer_email_value is not null and lower(coalesce(
                  h.assigned_volunteer_email,
                  h.specific_details->'participants'->>'volunteer_email',
                  case when coalesce(h.assigned_volunteer, '') like '%@%' then h.assigned_volunteer else null end
              )) = volunteer_email_value)
          );

        if active_assignment_count >= 3 then
            raise exception 'Responder already has 3 active missions.'
                using errcode = '23514';
        end if;
    end if;

    return new;
end;
$$;

drop trigger if exists trg_help_requests_enforce_assignment_rules on public.help_requests;
create trigger trg_help_requests_enforce_assignment_rules
before insert or update on public.help_requests
for each row execute function public.rescuenet_enforce_help_request_rules();

-- -------------------------------------------------
-- 3) MEMBER RECORDS (cached summary metrics)
-- -------------------------------------------------
alter table if exists public.member_records
    add column if not exists profile_id text,
    add column if not exists requested_total integer default 0,
    add column if not exists requested_active integer default 0,
    add column if not exists requested_resolved integer default 0,
    add column if not exists requested_cancelled integer default 0,
    add column if not exists volunteered_total integer default 0,
    add column if not exists volunteered_active integer default 0,
    add column if not exists volunteered_resolved integer default 0,
    add column if not exists volunteered_cancelled integer default 0,
    add column if not exists total_cases integer default 0,
    add column if not exists active_cases integer default 0,
    add column if not exists resolved_cases integer default 0,
    add column if not exists last_activity_at timestamptz,
    add column if not exists last_login_at timestamptz;

update public.member_records m
set profile_id = p.id::text
from public.profiles p
where m.email is not null
  and lower(m.email) = lower(p.email)
  and (m.profile_id is null or m.profile_id = '');

insert into public.member_records (
    email,
    full_name,
    user_role,
    location,
    profile_id,
    requested_total,
    requested_active,
    requested_resolved,
    requested_cancelled,
    volunteered_total,
    volunteered_active,
    volunteered_resolved,
    volunteered_cancelled,
    total_cases,
    active_cases,
    resolved_cases,
    last_activity_at,
    last_login_at
)
select
    p.email,
    coalesce(p.full_name, initcap(replace(split_part(lower(p.email), '@', 1), '.', ' '))),
    coalesce(nullif(p.user_role, ''), 'Volunteer'),
    p.location,
    p.id::text,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    null,
    p.last_login_at
from public.profiles p
where p.email is not null
  and not exists (
      select 1
      from public.member_records m
      where m.email is not null
        and lower(m.email) = lower(p.email)
  );

with requester_stats as (
    select
        lower(coalesce(h.requester_email, h.specific_details->'participants'->>'requester_email')) as email,
        count(*)::int as requested_total,
        count(*) filter (where h.status in ('queued', 'on_progress'))::int as requested_active,
        count(*) filter (where h.status = 'completed')::int as requested_resolved,
        count(*) filter (where h.status = 'cancelled')::int as requested_cancelled,
        max(h.created_at) as last_requested_at
    from public.help_requests h
    group by 1
),
volunteer_stats as (
    select
        lower(coalesce(h.assigned_volunteer_email, h.specific_details->'participants'->>'volunteer_email')) as email,
        count(*)::int as volunteered_total,
        count(*) filter (where h.status = 'on_progress')::int as volunteered_active,
        count(*) filter (where h.status = 'completed')::int as volunteered_resolved,
        count(*) filter (where h.status = 'cancelled')::int as volunteered_cancelled,
        max(h.created_at) as last_volunteered_at
    from public.help_requests h
    where coalesce(h.assigned_volunteer, h.specific_details->'participants'->>'volunteer_id', h.specific_details->'participants'->>'volunteer_email') is not null
    group by 1
)
update public.member_records m
set
    requested_total = coalesce(r.requested_total, 0),
    requested_active = coalesce(r.requested_active, 0),
    requested_resolved = coalesce(r.requested_resolved, 0),
    requested_cancelled = coalesce(r.requested_cancelled, 0),
    volunteered_total = coalesce(v.volunteered_total, 0),
    volunteered_active = coalesce(v.volunteered_active, 0),
    volunteered_resolved = coalesce(v.volunteered_resolved, 0),
    volunteered_cancelled = coalesce(v.volunteered_cancelled, 0),
    total_cases = coalesce(r.requested_total, 0) + coalesce(v.volunteered_total, 0),
    active_cases = coalesce(r.requested_active, 0) + coalesce(v.volunteered_active, 0),
    resolved_cases = coalesce(r.requested_resolved, 0) + coalesce(v.volunteered_resolved, 0),
    last_activity_at = greatest(
        coalesce(r.last_requested_at, 'epoch'::timestamptz),
        coalesce(v.last_volunteered_at, 'epoch'::timestamptz)
    )
from requester_stats r
full outer join volunteer_stats v
    on r.email = v.email
where lower(m.email) = coalesce(r.email, v.email);

create index if not exists idx_member_records_profile_id
    on public.member_records (profile_id);

create index if not exists idx_member_records_email_lower
    on public.member_records ((lower(email)));

-- -------------------------------------------------
-- 4) WORK HISTORY (event timeline)
-- -------------------------------------------------
alter table if exists public.work_history
    add column if not exists profile_id text,
    add column if not exists request_id text,
    add column if not exists actor_identity text,
    add column if not exists actor_role text,
    add column if not exists event_type text,
    add column if not exists meta jsonb default '{}'::jsonb;

update public.work_history w
set profile_id = p.id::text
from public.profiles p
where w.user_email is not null
  and lower(w.user_email) = lower(p.email)
  and (w.profile_id is null or w.profile_id = '');

-- Seed requester creation history for existing cases if work_history is empty for that case/email pair
insert into public.work_history (
    user_email,
    profile_id,
    task_name,
    task_status,
    created_at,
    request_id,
    actor_identity,
    actor_role,
    event_type,
    meta
)
select
    lower(coalesce(h.requester_email, h.specific_details->'participants'->>'requester_email')) as user_email,
    coalesce(h.requester_profile_id, h.specific_details->'participants'->>'requester_id', h.created_by) as profile_id,
    concat('Created help request: ', coalesce(h.title, 'Untitled request')),
    case
        when h.status = 'completed' then 'Completed'
        when h.status = 'cancelled' then 'Cancelled'
        when h.status = 'on_progress' then 'On Progress'
        else 'Queued'
    end,
    h.created_at,
    h.id::text,
    coalesce(h.requester_profile_id, h.specific_details->'participants'->>'requester_id', h.created_by),
    'requester',
    'request_created',
    jsonb_build_object(
        'category', h.category,
        'urgency', h.urgency,
        'status', h.status
    )
from public.help_requests h
where coalesce(h.requester_email, h.specific_details->'participants'->>'requester_email') is not null
  and not exists (
      select 1
      from public.work_history w
      where w.request_id = h.id::text
        and lower(w.user_email) = lower(coalesce(h.requester_email, h.specific_details->'participants'->>'requester_email'))
        and coalesce(w.event_type, 'request_created') = 'request_created'
  );

create index if not exists idx_work_history_user_email_created_at
    on public.work_history (user_email, created_at desc);

create index if not exists idx_work_history_profile_id
    on public.work_history (profile_id);

create index if not exists idx_work_history_request_id
    on public.work_history (request_id);

-- -------------------------------------------------
-- 5) UPDATED_AT helpers
-- -------------------------------------------------
create or replace function public.rescuenet_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_profiles_touch_updated_at on public.profiles;
create trigger trg_profiles_touch_updated_at
before update on public.profiles
for each row execute function public.rescuenet_touch_updated_at();

drop trigger if exists trg_help_requests_touch_updated_at on public.help_requests;
create trigger trg_help_requests_touch_updated_at
before update on public.help_requests
for each row execute function public.rescuenet_touch_updated_at();

-- -------------------------------------------------
-- 6) RLS POLICIES
-- -------------------------------------------------
create or replace function public.rescuenet_auth_email()
returns text
language sql
stable
as $$
    select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.rescuenet_matches_current_user(identity_value text, email_value text default null)
returns boolean
language sql
stable
as $$
    select (
        auth.uid() is not null
        and lower(coalesce(identity_value, '')) = lower(auth.uid()::text)
    ) or (
        public.rescuenet_auth_email() <> ''
        and (
            lower(coalesce(email_value, '')) = public.rescuenet_auth_email()
            or lower(coalesce(identity_value, '')) = public.rescuenet_auth_email()
        )
    );
$$;

create or replace function public.rescuenet_current_user_is_dispatcher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.profiles p
        where public.rescuenet_matches_current_user(p.id::text, p.email)
          and lower(coalesce(p.user_role, '')) similar to '%(dispatcher|coordinator|admin|command)%'
    );
$$;

alter table if exists public.profiles enable row level security;
alter table if exists public.member_records enable row level security;
alter table if exists public.help_requests enable row level security;
alter table if exists public.work_history enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select
on public.profiles
for select
to authenticated
using (
    public.rescuenet_matches_current_user(id::text, email)
    or public.rescuenet_current_user_is_dispatcher()
);

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert
on public.profiles
for insert
to authenticated
with check (public.rescuenet_matches_current_user(id::text, email));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update
on public.profiles
for update
to authenticated
using (
    public.rescuenet_matches_current_user(id::text, email)
    or public.rescuenet_current_user_is_dispatcher()
)
with check (
    public.rescuenet_matches_current_user(id::text, email)
    or public.rescuenet_current_user_is_dispatcher()
);

drop policy if exists member_records_select on public.member_records;
create policy member_records_select
on public.member_records
for select
to authenticated
using (true);

drop policy if exists member_records_insert on public.member_records;
create policy member_records_insert
on public.member_records
for insert
to authenticated
with check (true);

drop policy if exists member_records_update on public.member_records;
create policy member_records_update
on public.member_records
for update
to authenticated
using (true)
with check (true);

drop policy if exists help_requests_select on public.help_requests;
create policy help_requests_select
on public.help_requests
for select
to authenticated
using (true);

drop policy if exists help_requests_insert on public.help_requests;
create policy help_requests_insert
on public.help_requests
for insert
to authenticated
with check (
    public.rescuenet_matches_current_user(requester_profile_id, requester_email)
    or public.rescuenet_matches_current_user(created_by, requester_email)
);

drop policy if exists help_requests_update on public.help_requests;
create policy help_requests_update
on public.help_requests
for update
to authenticated
using (true)
with check (true);

drop policy if exists work_history_select on public.work_history;
create policy work_history_select
on public.work_history
for select
to authenticated
using (
    public.rescuenet_matches_current_user(profile_id, user_email)
    or public.rescuenet_current_user_is_dispatcher()
);

drop policy if exists work_history_insert on public.work_history;
create policy work_history_insert
on public.work_history
for insert
to authenticated
with check (true);

-- -------------------------------------------------
-- 7) NOTE ON RESOURCES
-- -------------------------------------------------
-- `resources` remains the inventory/donation table.
-- It must not be used for auth rows anymore.
--
-- Optional cleanup after verifying profiles/auth migration:
-- delete from public.resources where type = '__auth_user__';

commit;
