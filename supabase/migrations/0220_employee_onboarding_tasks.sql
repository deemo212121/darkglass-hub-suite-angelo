-- =====================================================================
-- 0220 — employee_onboarding_tasks: HR's "what's left to set up for this
-- new hire" checklist.
--
-- Creating a user in User Management (AdminUserManagementPage's
-- createCompanyUser) only sets name / email / role / branch / schedule —
-- everything else (login handoff, profile detail, off-days on the profile
-- rather than just localStorage, pay rate, onboarding docs, HR forms,
-- manager notify) is left for HR to finish. This table is the per-hire
-- punch list for that, surfaced on the HR module's To-Do List page
-- (HrOnboardingChecklistPage, HR / Admin / Super Admin only).
--
-- One row per (profile, task_key). Rows are seeded from a role-aware
-- template right after the account is created; HR flips each to 'done' or
-- 'na', and the employee drops off the To-Do List once nothing is 'open'.
--
-- RLS matches who can open the HR module's To-Do List and HR Dashboard —
-- is_admin() / is_hr() / company-superadmin / platform-superadmin.
--
-- Run once in the Supabase SQL Editor, after 0219.
-- =====================================================================

create table if not exists employee_onboarding_tasks (
  id           uuid primary key default uuid_generate_v4(),
  company_id   uuid not null references companies(id) on delete cascade,
  profile_id   uuid not null references profiles(id) on delete cascade,
  task_key     text not null,
  status       text not null default 'open' check (status in ('open', 'done', 'na')),
  note         text,
  done_by      uuid references profiles(id) on delete set null,
  done_by_name text,
  done_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, profile_id, task_key)
);

create index if not exists idx_employee_onboarding_tasks_company
  on employee_onboarding_tasks (company_id, profile_id);

create or replace function employee_onboarding_tasks_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  -- First transition into a resolved state stamps when + by whom (unless the
  -- caller already supplied its own done_at, e.g. a backfill).
  if new.status in ('done', 'na') and (tg_op = 'INSERT' or old.status = 'open') and new.done_at is null then
    new.done_at := now();
    if new.done_by is null then new.done_by := auth_profile_id(); end if;
  end if;
  if new.status = 'open' then
    new.done_at := null;
    new.done_by := null;
    new.done_by_name := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_employee_onboarding_tasks_stamp on employee_onboarding_tasks;
create trigger trg_employee_onboarding_tasks_stamp
  before insert or update on employee_onboarding_tasks
  for each row execute function employee_onboarding_tasks_stamp();

-- ---------- RLS ----------
alter table employee_onboarding_tasks enable row level security;
alter table employee_onboarding_tasks force row level security;

drop policy if exists employee_onboarding_tasks_select on employee_onboarding_tasks;
create policy employee_onboarding_tasks_select on employee_onboarding_tasks
  for select using (
    (company_id = auth_company_id() and (is_admin() or is_hr() or is_company_superadmin()))
    or is_superadmin()
  );

drop policy if exists employee_onboarding_tasks_write on employee_onboarding_tasks;
create policy employee_onboarding_tasks_write on employee_onboarding_tasks
  for all
  using (
    (company_id = auth_company_id() and (is_admin() or is_hr() or is_company_superadmin()))
    or is_superadmin()
  )
  with check (
    (company_id = auth_company_id() and (is_admin() or is_hr() or is_company_superadmin()))
    or is_superadmin()
  );
