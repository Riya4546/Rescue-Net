-- RescueNet Supabase update (2026-04-08)
-- Goal:
-- 1) Keep login credentials in `profiles` (email + hashed password).
-- 2) Keep per-user progress counters in `member_records`.
-- 3) Keep timeline entries in `work_history`.
--
-- Run in Supabase SQL Editor after a backup.

begin;

create extension if not exists pgcrypto;

-- -------------------------------------------------
-- 1) PROFILES (Auth + Identity)
-- -------------------------------------------------
create table if not exists public.profiles (
    id uuid primary key default gen_random_uuid(),
    email text not null,
    full_name text,
    user_role text,
    location text,
    password_hash text,
    password text,
    auth_provider text default 'local',
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    last_login_at timestamptz
);

alter table if exists public.profiles
    add column if not exists email text,
    add column if not exists full_name text,
    add column if not exists user_role text,
    add column if not exists location text,
    add column if not exists password_hash text,
    add column if not exists password text,
    add column if not exists auth_provider text,
    add column if not exists created_at timestamptz default now(),
    add column if not exists updated_at timestamptz default now(),
    add column if not exists last_login_at timestamptz;

create unique index if not exists idx_profiles_email_lower
    on public.profiles ((lower(email)));

-- Backfill profiles from member_records (legacy credential store)
insert into public.profiles (
    email,
    full_name,
    user_role,
    location,
    password_hash,
    auth_provider,
    created_at,
    updated_at,
    last_login_at
)
select
    lower(m.email) as email,
    m.full_name,
    m.user_role,
    m.location,
    coalesce(m.password_hash, to_jsonb(m)->>'password'),
    'legacy_member_records',
    now(),
    now(),
    now()
from public.member_records m
where m.email is not null
  and not exists (
      select 1
      from public.profiles p
      where lower(p.email) = lower(m.email)
  );

-- Backfill profiles from resources fallback auth rows (if used)
insert into public.profiles (
    email,
    full_name,
    user_role,
    password_hash,
    auth_provider,
    created_at,
    updated_at,
    last_login_at
)
select
    lower(r.offered_by) as email,
    initcap(replace(split_part(lower(r.offered_by), '@', 1), '.', ' ')) as full_name,
    'Volunteer' as user_role,
    r.pickup_location as password_hash,
    'legacy_resources',
    now(),
    now(),
    now()
from public.resources r
where r.type = '__auth_user__'
  and r.offered_by is not null
  and not exists (
      select 1
      from public.profiles p
      where lower(p.email) = lower(r.offered_by)
  );

-- -------------------------------------------------
-- 2) MEMBER RECORDS (Per-user progress summaries)
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

update public.member_records
set
    requested_total = coalesce(requested_total, 0),
    requested_active = coalesce(requested_active, 0),
    requested_resolved = coalesce(requested_resolved, 0),
    requested_cancelled = coalesce(requested_cancelled, 0),
    volunteered_total = coalesce(volunteered_total, 0),
    volunteered_active = coalesce(volunteered_active, 0),
    volunteered_resolved = coalesce(volunteered_resolved, 0),
    volunteered_cancelled = coalesce(volunteered_cancelled, 0),
    total_cases = coalesce(total_cases, 0),
    active_cases = coalesce(active_cases, 0),
    resolved_cases = coalesce(resolved_cases, 0)
where true;

-- Fill profile_id by email match where missing
update public.member_records m
set profile_id = p.id::text
from public.profiles p
where m.profile_id is null
  and m.email is not null
  and lower(m.email) = lower(p.email);

-- Ensure every profile has a member_records row
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
    last_login_at
)
select
    p.email,
    coalesce(p.full_name, initcap(replace(split_part(lower(p.email), '@', 1), '.', ' '))) as full_name,
    coalesce(p.user_role, 'Volunteer') as user_role,
    p.location,
    p.id::text as profile_id,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0,
    p.last_login_at
from public.profiles p
where p.email is not null
  and not exists (
      select 1
      from public.member_records m
      where m.email is not null
        and lower(m.email) = lower(p.email)
  );

create index if not exists idx_member_records_profile_id
    on public.member_records (profile_id);

create index if not exists idx_member_records_email_lower
    on public.member_records ((lower(email)));

-- -------------------------------------------------
-- 3) WORK HISTORY (Timeline events)
-- -------------------------------------------------
alter table if exists public.work_history
    add column if not exists request_id text,
    add column if not exists actor_identity text,
    add column if not exists actor_role text,
    add column if not exists event_type text,
    add column if not exists meta jsonb default '{}'::jsonb;

create index if not exists idx_work_history_user_email_created_at
    on public.work_history (user_email, created_at desc);

create index if not exists idx_work_history_request_id
    on public.work_history (request_id);

commit;
