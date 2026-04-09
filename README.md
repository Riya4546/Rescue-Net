# Rescue-Net

Rescue-Net is a disaster-response web application.

## Config setup

The app no longer keeps project-specific API settings hardcoded in source files.

### Frontend

1. Copy `frontend/app.config.example.json` to `frontend/app.config.json`.
2. Fill in your own Supabase project URL and anon key.
3. Optionally change the public service endpoints in the same file.

`frontend/app.config.json` is ignored by git, so each user can keep their own setup locally.

### Backend

1. Copy `.env.example` to `.env`.
2. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

The backend loads `.env` automatically, so no extra package is needed.

## Supabase table contract

- `profiles`: canonical user identity/profile row for each signed-in user.
- `help_requests`: canonical case/request records used by `get_help`, `volunteer`, and `portal`.
- `work_history`: timeline/event log for user activity on requests.
- `member_records`: cached profile stats for dashboards and profile counters.
- `resources`: inventory/resource listings only, not auth storage.

The migration for aligning the current live schema to this contract is:

- `backend/supabase/schema_update_2026_04_09_unified_contract.sql`
