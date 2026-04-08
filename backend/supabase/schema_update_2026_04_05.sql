-- RescueNet Supabase update (2026-04-05)
-- Run this in Supabase SQL Editor after taking a backup.

begin;

-- 1) Ensure help_requests can store latest workflow fields
alter table if exists public.help_requests
    add column if not exists status text,
    add column if not exists created_by text,
    add column if not exists assigned_volunteer text,
    add column if not exists specific_details jsonb,
    add column if not exists roadmap jsonb,
    add column if not exists created_at timestamptz default now();

update public.help_requests
set status = coalesce(status, 'queued')
where status is null;

update public.help_requests
set specific_details = '{}'::jsonb
where specific_details is null;

update public.help_requests
set roadmap = '[]'::jsonb
where roadmap is null;

alter table if exists public.help_requests
    alter column status set default 'queued',
    alter column status set not null,
    alter column specific_details set default '{}'::jsonb,
    alter column specific_details set not null,
    alter column roadmap set default '[]'::jsonb,
    alter column roadmap set not null,
    alter column created_at set default now();

-- Replace old status check (if any) with a constraint that includes cancelled
DO $$
declare c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.help_requests'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.help_requests drop constraint if exists %I', c.conname);
  end loop;
end $$;

alter table if exists public.help_requests
    add constraint help_requests_status_check
    check (status in ('queued', 'on_progress', 'completed', 'cancelled'));

-- 2) Ensure member_records has fields used by frontend/profile logic
alter table if exists public.member_records
    add column if not exists full_name text,
    add column if not exists email text,
    add column if not exists user_role text,
    add column if not exists location text,
    add column if not exists password_hash text;

-- 3) Performance indexes for dashboard and ownership queries
create index if not exists idx_help_requests_status_created_at
    on public.help_requests (status, created_at desc);

create index if not exists idx_help_requests_created_by_status
    on public.help_requests (created_by, status);

create index if not exists idx_help_requests_assigned_volunteer_status
    on public.help_requests (assigned_volunteer, status);

create index if not exists idx_help_requests_urgency_status
    on public.help_requests (urgency, status);

create index if not exists idx_help_requests_category_status
    on public.help_requests (category, status);

create index if not exists idx_help_requests_specific_details_gin
    on public.help_requests using gin (specific_details);

create index if not exists idx_member_records_email_lower
    on public.member_records ((lower(email)));

commit;

-- Optional hardening (apply only after validating app flow with auth policies):
-- 1) enable row level security on public.help_requests;
-- 2) create requester/volunteer policies using auth.uid()::text and auth.jwt()->>'email'.
