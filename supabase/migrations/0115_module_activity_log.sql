-- =====================================================================
-- 0115 — Module Activity Log
--
-- A dedicated audit trail for the Payroll Calculation, Attendance
-- Monitoring, IT Tickets, and User Management pages — one shared table
-- (keyed by a `module` column) rather than four near-identical tables,
-- but each page only ever queries its own module, so the log each page
-- shows is exclusively its own (mirrors hr_activity_log's design, see
-- migration 0051, just parameterized across a few more pages).
--
-- Visibility: RLS only enforces company isolation here, same as
-- hr_activity_log — role isolation ("only those who can see that
-- dashboard can see its log") is enforced by the fact that the log
-- viewer is embedded INSIDE each already role-gated page (Payroll/
-- Attendance/IT Tickets/User Management all have their own
-- DASHBOARD_ROLE_GATES/ADMIN_MODULE_ROLES checks in
-- m.$module.$submodule.tsx), not by a separate route anyone could visit.
--
-- Run once in the Supabase SQL Editor, after 0114.
-- =====================================================================

create table if not exists module_activity_log (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  module        text not null check (module in ('accounting', 'payroll', 'attendance-monitoring', 'it-tickets', 'user-management')),
  actor_id      uuid references profiles(id),
  actor_name    text,
  action        text not null,
  target_type   text,
  target_id     text,
  target_label  text,
  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists idx_module_activity_log_company_module on module_activity_log(company_id, module, created_at desc);

create or replace function module_activity_log_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  if new.actor_id is null then
    new.actor_id := auth_profile_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_module_activity_log_stamp on module_activity_log;
create trigger trg_module_activity_log_stamp before insert on module_activity_log
  for each row execute function module_activity_log_stamp();

-- ---------- RLS: company-wide read (it's an audit log, page access already
-- gates who reaches it), insert-only otherwise — entries are never edited
-- or deleted, so the trail can't be tampered with after the fact. ----------
alter table module_activity_log enable row level security;
alter table module_activity_log force row level security;

drop policy if exists module_activity_log_select on module_activity_log;
create policy module_activity_log_select on module_activity_log
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists module_activity_log_insert on module_activity_log;
create policy module_activity_log_insert on module_activity_log
  for insert with check (company_id = auth_company_id() or is_superadmin());
