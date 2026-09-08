-- =====================================================================
-- 0217 — Attendance Monitoring "Settings" (SuperAdmin-only): grace-period
-- warning emails.
--
-- Extends the existing every-5-minute attendance alert job
-- (src/lib/server/attendanceAlerts.ts) with a SECOND, earlier alert type
-- that fires the moment an employee's scheduled check-in/check-out time
-- passes (while still inside the grace window — see attendanceGrace.ts's
-- payGraceMinutesFor), not just after the grace window fully expires like
-- the existing missing_clock_in/missing_clock_out alerts do. This one is
-- delivered by EMAIL (via a new "ATTENDANCE" Gmail connection slot) to
-- whichever managers have opted in on the new Settings tab, so they can
-- act before the grace window runs out — the existing in-app
-- missing_clock_in/missing_clock_out notifications are untouched.
--
-- Three schema pieces:
--   1. attendance_alerts.alert_type gains 'grace_warning_clock_in' /
--      'grace_warning_clock_out' alongside the existing pair — same dedup
--      ledger, just two more allowed values.
--   2. hr_gmail_connections.region gains 'ATTENDANCE' — a dedicated Gmail
--      connection slot for these warning emails, same idiom as the
--      PARTS/IT_1/IT_2/IT_3 slots added in 0168/0173.
--   3. New attendance_warning_subscriptions table: which managers
--      (profiles.id) have opted in to receive these emails. A manager is
--      "enrolled" iff a row exists for them — checking/unchecking the box
--      on the Settings tab just inserts/deletes a row. Company-scoped
--      SUPERADMIN-only (is_company_superadmin(), same role the Settings
--      tab itself is hidden from everyone else for — NOT is_superadmin(),
--      which per 0099_role_hierarchy_split.sql means the platform-level
--      SUPERSUPERADMIN, a different and much narrower thing), modeled on
--      custom_roles' (0209) stamping-trigger + split select/insert/delete
--      policy shape.
--
-- Run once in the Supabase SQL Editor, after 0216.
-- =====================================================================

alter table attendance_alerts drop constraint if exists attendance_alerts_alert_type_check;
alter table attendance_alerts add constraint attendance_alerts_alert_type_check
  check (alert_type in ('missing_clock_in', 'missing_clock_out', 'grace_warning_clock_in', 'grace_warning_clock_out'));

alter table hr_gmail_connections drop constraint if exists hr_gmail_connections_region_check;
alter table hr_gmail_connections add constraint hr_gmail_connections_region_check
  check (region in ('US', 'PH', 'PARTS', 'IT_1', 'IT_2', 'IT_3', 'ATTENDANCE'));

create table if not exists attendance_warning_subscriptions (
  id                  uuid primary key default uuid_generate_v4(),
  company_id          uuid not null references companies(id) on delete cascade,
  manager_profile_id  uuid not null references profiles(id) on delete cascade,
  created_at          timestamptz not null default now(),
  created_by          uuid references profiles(id) on delete set null,
  created_by_name     text,
  unique (company_id, manager_profile_id)
);

create index if not exists idx_attendance_warning_subscriptions_company
  on attendance_warning_subscriptions (company_id);

create or replace function attendance_warning_subscriptions_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_attendance_warning_subscriptions_stamp on attendance_warning_subscriptions;
create trigger trg_attendance_warning_subscriptions_stamp before insert on attendance_warning_subscriptions
  for each row execute function attendance_warning_subscriptions_stamp();

-- ---------- RLS: company-scoped SUPERADMIN-only, both read and write ----------
-- Stricter than attendance_alerts (company-scoped select for anyone) since
-- this table is exactly the enrollment list the SuperAdmin-only Settings
-- tab manages. The server-side cron job (attendanceAlerts.ts) reads it with
-- the service-role key, which bypasses RLS entirely, same as every other
-- sync job.
alter table attendance_warning_subscriptions enable row level security;
alter table attendance_warning_subscriptions force row level security;

drop policy if exists attendance_warning_subscriptions_select on attendance_warning_subscriptions;
create policy attendance_warning_subscriptions_select on attendance_warning_subscriptions
  for select using (
    (company_id = auth_company_id() and is_company_superadmin()) or is_superadmin()
  );

drop policy if exists attendance_warning_subscriptions_insert on attendance_warning_subscriptions;
create policy attendance_warning_subscriptions_insert on attendance_warning_subscriptions
  for insert with check (
    (company_id = auth_company_id() and is_company_superadmin()) or is_superadmin()
  );

drop policy if exists attendance_warning_subscriptions_delete on attendance_warning_subscriptions;
create policy attendance_warning_subscriptions_delete on attendance_warning_subscriptions
  for delete using (
    (company_id = auth_company_id() and is_company_superadmin()) or is_superadmin()
  );
