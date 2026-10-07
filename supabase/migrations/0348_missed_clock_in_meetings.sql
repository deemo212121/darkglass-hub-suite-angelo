-- =====================================================================
-- 0348 — Missed clock-in → meeting required (+1 error on the Technician
-- Performance Report).
--
-- A technician (role TECHNICIAN, not Philippines, not a trainee) whose
-- scheduled work day ends with no Time In — not their day off, not on
-- approved PTO, not a company holiday — gets one clock_in_meetings row for
-- that day, status 'required'. Rows are written only by the Worker's
-- hourly job (src/lib/server/missedClockInMeetings.ts, service role), which
-- also notifies the technician's managers. Whoever can see the daily
-- clock-in code (clock_code_viewer(), migration 0347 — HR / Admin plus the
-- roles picked on the Clock-In Codes page) marks the meeting done; the row
-- stays, so the missed day still counts as an error.
--
-- New table only — no existing data is changed.
-- Run once in the Supabase SQL Editor, after 0347.
-- =====================================================================

create table if not exists clock_in_meetings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  missed_date date not null,
  status text not null default 'required' check (status in ('required', 'done')),
  done_by_name text,
  done_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  unique (profile_id, missed_date)
);

create index if not exists clock_in_meetings_company_date_idx on clock_in_meetings (company_id, missed_date);

alter table clock_in_meetings enable row level security;

drop policy if exists clock_in_meetings_select on clock_in_meetings;
create policy clock_in_meetings_select on clock_in_meetings
  for select using (
    company_id = auth_company_id()
    and (profile_id = auth_profile_id() or clock_code_viewer() or is_admin() or is_superadmin())
  );

-- Mark a meeting done (status / done_by_name / done_at / note).
drop policy if exists clock_in_meetings_update on clock_in_meetings;
create policy clock_in_meetings_update on clock_in_meetings
  for update using (company_id = auth_company_id() and clock_code_viewer())
  with check (company_id = auth_company_id() and clock_code_viewer());
