-- =====================================================================
-- 0121 — Branch/Role Working-Hours templates
--
-- Lets an Admin set a Required Schedule (Check-In/Check-Out) once per
-- branch + role (e.g. "CSR Manager at Nashville") instead of re-entering it
-- for every employee individually. Saving a template writes straight into
-- profiles.required_check_in/required_check_out for the selected employees
-- (see ManageWorkingHoursModal.tsx + branchSchedules.ts) — this table is
-- just the saved template itself, not a live-resolution layer, so every
-- existing consumer of those two profile columns (Attendance, Payroll, My
-- Profile) needs zero changes.
--
-- Postdates the one-time tenant_tables RLS loop in 0001_init.sql, so RLS is
-- set up from scratch here — same shape as 0114_it_tickets.sql.
--
-- Run once in the Supabase SQL Editor, after 0120.
-- =====================================================================

create table if not exists branch_role_schedules (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  branch              text not null,
  role                text not null,  -- canonical role code, e.g. 'CSR_MANAGER'
  required_check_in   text not null,
  required_check_out  text not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, branch, role)
);

create index if not exists idx_branch_role_schedules_company on branch_role_schedules(company_id, branch);

alter table branch_role_schedules enable row level security;
alter table branch_role_schedules force row level security;

create or replace function branch_role_schedules_stamp_and_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' and new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_branch_role_schedules_stamp on branch_role_schedules;
create trigger trg_branch_role_schedules_stamp before insert or update on branch_role_schedules
  for each row execute function branch_role_schedules_stamp_and_touch();

-- Admin/Superadmin only — this is a company-config table, not employee-facing data.
create or replace function is_branch_schedule_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select
    upper(role) in ('ADMIN', 'SUPERADMIN')
    or exists (
      select 1 from unnest(coalesce(extra_roles, '{}')) r
      where upper(r) in ('ADMIN', 'SUPERADMIN')
    )
  from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;
$$;

drop policy if exists branch_role_schedules_select on branch_role_schedules;
create policy branch_role_schedules_select on branch_role_schedules
  for select using (
    is_superadmin() or (company_id = auth_company_id() and is_branch_schedule_admin())
  );

drop policy if exists branch_role_schedules_insert on branch_role_schedules;
create policy branch_role_schedules_insert on branch_role_schedules
  for insert with check (
    is_superadmin() or (company_id = auth_company_id() and is_branch_schedule_admin())
  );

drop policy if exists branch_role_schedules_update on branch_role_schedules;
create policy branch_role_schedules_update on branch_role_schedules
  for update
  using (is_superadmin() or (company_id = auth_company_id() and is_branch_schedule_admin()))
  with check (is_superadmin() or (company_id = auth_company_id() and is_branch_schedule_admin()));

drop policy if exists branch_role_schedules_delete on branch_role_schedules;
create policy branch_role_schedules_delete on branch_role_schedules
  for delete using (
    is_superadmin() or (company_id = auth_company_id() and is_branch_schedule_admin())
  );
