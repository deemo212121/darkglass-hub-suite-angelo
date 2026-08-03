-- =====================================================================
-- 0123 — Login Lockout history
--
-- Every time an account actually crosses into a locked state (see
-- loginLockoutBridge.ts's recordFailure — fail count reaches 5, or any
-- failure after that while already fragile), a row is appended here so the
-- "Lockout History" tab (LoginSecurityPage.tsx) can show a timeline of past
-- incidents, not just accounts currently at/above the threshold.
--
-- employee_name/employee_email are snapshotted at lock time (not a live
-- join) so history still reads correctly even if the profile is later
-- renamed or deactivated.
--
-- Written by loginLockoutBridge.ts using the service-role key (pre-auth, no
-- session yet — same reasoning as 0122), so no insert policy is needed here;
-- only a select policy for the admin-facing history view.
--
-- Run once in the Supabase SQL Editor, after 0122.
-- =====================================================================

create table if not exists login_lockout_events (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id) on delete cascade,
  profile_id     uuid references profiles(id) on delete set null,
  employee_name  text not null,
  employee_email text not null,
  fail_count     int not null,
  locked_at      timestamptz not null default now()
);

create index if not exists idx_login_lockout_events_company on login_lockout_events(company_id, locked_at desc);

alter table login_lockout_events enable row level security;
alter table login_lockout_events force row level security;

-- is_branch_schedule_admin() already exists (migration 0121) — same
-- ADMIN/SUPERADMIN gate, reused as-is rather than redefining it.
drop policy if exists login_lockout_events_select on login_lockout_events;
create policy login_lockout_events_select on login_lockout_events
  for select using (
    is_superadmin() or (company_id = auth_company_id() and is_branch_schedule_admin())
  );
