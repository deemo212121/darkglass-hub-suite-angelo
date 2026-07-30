-- =====================================================================
-- 0075 — Attendance Alerts: missing clock-in/out notification dedup
--
-- Attendance Monitoring's grace-period check (5 minutes past
-- required_check_in/required_check_out, see src/lib/attendanceGrace.ts) now
-- has a real side effect: a Cron Trigger job (every 5 minutes, see
-- scheduled() in src/server.ts + src/lib/server/attendanceAlerts.ts) pings
-- HR/Finance/Admin + the employee's manager the first time a gap is
-- detected. This table is that job's dedup ledger — the unique constraint
-- is what stops it from re-notifying the same gap every 5 minutes for the
-- rest of the day.
--
-- Only ever written by the Worker's service-role key (bypasses RLS
-- entirely, like the rest of the server-side sync jobs), so RLS here is
-- select-only — nothing client-side ever inserts into this table.
--
-- Run once in the Supabase SQL Editor, after 0074.
-- =====================================================================

create table if not exists attendance_alerts (
  id            uuid primary key default uuid_generate_v4(),
  company_id    uuid not null references companies(id) on delete cascade,
  profile_id    uuid not null references profiles(id) on delete cascade,
  work_date     date not null,
  alert_type    text not null check (alert_type in ('missing_clock_in', 'missing_clock_out')),
  notified_at   timestamptz not null default now(),
  unique (profile_id, work_date, alert_type)
);

create index if not exists idx_attendance_alerts_company_date
  on attendance_alerts (company_id, work_date);

-- ---------- RLS: company-scoped select only (service-role writes bypass RLS) ----------
alter table attendance_alerts enable row level security;
alter table attendance_alerts force row level security;

drop policy if exists attendance_alerts_select on attendance_alerts;
create policy attendance_alerts_select on attendance_alerts
  for select using (company_id = auth_company_id() or is_superadmin());
