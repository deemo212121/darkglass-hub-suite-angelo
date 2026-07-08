-- =====================================================================
-- 0034 — Employee requests (Employee Self-Service "My Requests" tab)
--
-- Covers the two request types that had no real table yet: attendance
-- disputes and payroll inquiries. (PTO requests already live in
-- pto_requests/pto.ts, and time corrections already live in
-- timecard_corrections/timecardCorrections.ts — both reviewed today from
-- the Attendance Monitoring dashboard.) This table lets HR/Finance/Admin
-- review and resolve the other two the same way.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

create table if not exists employee_requests (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  profile_id    uuid not null references profiles(id) on delete cascade,
  request_type  text not null check (request_type in ('attendance_dispute','payroll_inquiry')),
  details       text not null,
  status        text not null default 'pending'
                check (status in ('pending','approved','rejected','closed')),
  requested_by  uuid references profiles(id),
  reviewed_by   uuid references profiles(id),
  reviewed_at   timestamptz,
  review_note   text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_employee_requests_profile on employee_requests(profile_id, created_at desc);
create index if not exists idx_employee_requests_status on employee_requests(company_id, status);

-- ---------- Auto-stamp company_id (reuses set_company_id() from 0001_init.sql) ----------
drop trigger if exists trg_employee_requests_company on employee_requests;
create trigger trg_employee_requests_company
  before insert on employee_requests
  for each row execute function set_company_id();

-- ---------- RLS: company-scoped, matches the rest of the platform ----------
alter table employee_requests enable row level security;
alter table employee_requests force row level security;

drop policy if exists employee_requests_select on employee_requests;
create policy employee_requests_select on employee_requests
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists employee_requests_insert on employee_requests;
create policy employee_requests_insert on employee_requests
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists employee_requests_update on employee_requests;
create policy employee_requests_update on employee_requests
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists employee_requests_delete on employee_requests;
create policy employee_requests_delete on employee_requests
  for delete using (company_id = auth_company_id() or is_superadmin());
