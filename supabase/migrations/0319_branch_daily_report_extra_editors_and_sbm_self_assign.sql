-- =====================================================================
-- 0319 — Branch Daily Report: Senior Branch Manager can now manage the
-- SBM->branch assignments themselves (not HR-and-above only), plus a new
-- "extra editors" grant so a manager can add a SPECIFIC person (someone
-- who wouldn't otherwise qualify by role+branch — e.g. a technician at a
-- different branch, or anyone else) to a branch's notes-only access list.
--
-- Per the user's explicit call: "Assign Branches to Senior Branch
-- Managers ... editable by senior branch manager and up" and "add
-- function where we can add more people to access their branch ... add
-- notes too" (an extra editor gets the same notes-only rights a Branch
-- Manager already has — never Urgency, same client-side-only restriction
-- every non-HR/SBM editor tier already has, see can_edit_branch_daily_
-- report()'s own doc history in 0284/0307).
--
-- Run once in the Supabase SQL Editor, after 0318.
-- =====================================================================

-- ---------- 1. Senior Branch Manager can self-manage SBM assignments ----------
-- Previously HR-and-above only (0283). Widened so a Senior Branch Manager
-- can also reassign branches (their own or anyone else's) without needing
-- to go through HR first — "and up" means HR/Admin/SuperAdmin still can
-- too, this is additive, not a narrowing.
drop policy if exists sbm_branches_insert on senior_branch_manager_branches;
create policy sbm_branches_insert on senior_branch_manager_branches
  for insert with check (
    (company_id = auth_company_id() or is_superadmin())
    and (
      is_hr() or is_admin() or is_company_superadmin() or is_superadmin()
      or exists (
        select 1 from profiles
        where id = auth_profile_id()
          and (role = 'SENIOR_BRANCH_MANAGER' or 'SENIOR_BRANCH_MANAGER' = any(coalesce(extra_roles, '{}')))
      )
    )
  );

drop policy if exists sbm_branches_delete on senior_branch_manager_branches;
create policy sbm_branches_delete on senior_branch_manager_branches
  for delete using (
    (company_id = auth_company_id() or is_superadmin())
    and (
      is_hr() or is_admin() or is_company_superadmin() or is_superadmin()
      or exists (
        select 1 from profiles
        where id = auth_profile_id()
          and (role = 'SENIOR_BRANCH_MANAGER' or 'SENIOR_BRANCH_MANAGER' = any(coalesce(extra_roles, '{}')))
      )
    )
  );

-- ---------- 2. Extra editors ----------
create table if not exists branch_daily_report_extra_editors (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  branch       text not null,
  profile_id   uuid not null references profiles(id) on delete cascade,
  granted_by   uuid references profiles(id),
  created_at   timestamptz not null default now(),
  unique (company_id, branch, profile_id)
);
create index if not exists idx_branch_extra_editors_branch on branch_daily_report_extra_editors(company_id, branch);
create index if not exists idx_branch_extra_editors_profile on branch_daily_report_extra_editors(profile_id);

create or replace function branch_daily_report_extra_editors_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  if new.granted_by is null then
    new.granted_by := auth_profile_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_branch_extra_editors_stamp on branch_daily_report_extra_editors;
create trigger trg_branch_extra_editors_stamp before insert on branch_daily_report_extra_editors
  for each row execute function branch_daily_report_extra_editors_stamp();

-- Who may add/remove someone from a branch's extra-editors list — the same
-- tier that can manage SBM assignments above: HR-and-above (any branch),
-- or the Senior Branch Manager currently assigned to that specific branch
-- (not just any SBM — granting extra access to a branch is a decision for
-- whoever actually owns it, same scoping can_edit_branch_daily_report
-- already applies to Urgency).
create or replace function can_manage_branch_extra_editors(p_branch text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  my_id uuid := auth_profile_id();
begin
  if is_hr() or is_admin() or is_company_superadmin() or is_superadmin() then
    return true;
  end if;
  return exists (
    select 1 from senior_branch_manager_branches
    where profile_id = my_id and branch = p_branch
  );
end;
$$;

alter table branch_daily_report_extra_editors enable row level security;
alter table branch_daily_report_extra_editors force row level security;

drop policy if exists branch_extra_editors_select on branch_daily_report_extra_editors;
create policy branch_extra_editors_select on branch_daily_report_extra_editors
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists branch_extra_editors_insert on branch_daily_report_extra_editors;
create policy branch_extra_editors_insert on branch_daily_report_extra_editors
  for insert with check (
    (company_id = auth_company_id() or is_superadmin())
    and can_manage_branch_extra_editors(branch)
  );

drop policy if exists branch_extra_editors_delete on branch_daily_report_extra_editors;
create policy branch_extra_editors_delete on branch_daily_report_extra_editors
  for delete using (
    (company_id = auth_company_id() or is_superadmin())
    and can_manage_branch_extra_editors(branch)
  );

-- ---------- 3. Widen can_edit_branch_daily_report to honor extra editors ----------
create or replace function can_edit_branch_daily_report(p_branch text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  my_id uuid := auth_profile_id();
  my_role text;
  my_extra text[];
  my_branch text;
  my_company uuid;
  my_tier int;
  has_branch_manager boolean;
  highest_tier int;
begin
  if is_hr() or is_admin() or is_company_superadmin() or is_superadmin() then
    return true;
  end if;
  select role, coalesce(extra_roles, '{}'), assigned_branch, company_id
    into my_role, my_extra, my_branch, my_company
    from profiles where id = my_id;
  if (my_role = 'BRANCH_MANAGER' or 'BRANCH_MANAGER' = any(my_extra)) and my_branch = p_branch then
    return true;
  end if;
  if (my_role = 'SENIOR_BRANCH_MANAGER' or 'SENIOR_BRANCH_MANAGER' = any(my_extra)) and exists (
    select 1 from senior_branch_manager_branches
    where profile_id = my_id and branch = p_branch
  ) then
    return true;
  end if;

  -- New in 0319 — a specific person manually granted access to this one
  -- branch, regardless of their own role/assigned_branch.
  if exists (
    select 1 from branch_daily_report_extra_editors
    where profile_id = my_id and branch = p_branch
  ) then
    return true;
  end if;

  -- Fallback tier — primary role only (same convention
  -- BranchDailyReportPage.tsx's own techsFor()/tier lookup uses, not
  -- role-OR-extra-roles like the two checks above).
  if my_branch is distinct from p_branch or my_branch is null then
    return false;
  end if;
  my_tier := case my_role
    when 'TECHNICIAN' then 0
    when 'TECHNICIAN_MANAGER' then 1
    when 'TECHNICAL_ASSISTANT_DIRECTOR' then 2
    when 'TECHNICAL_DIRECTOR' then 3
    else null
  end;
  if my_tier is null then
    return false;
  end if;

  select exists (
    select 1 from profiles
    where company_id = my_company and assigned_branch = p_branch and is_active
      and role = 'BRANCH_MANAGER'
  ) into has_branch_manager;
  if has_branch_manager then
    return false;
  end if;

  select max(case role
      when 'TECHNICIAN' then 0
      when 'TECHNICIAN_MANAGER' then 1
      when 'TECHNICAL_ASSISTANT_DIRECTOR' then 2
      when 'TECHNICAL_DIRECTOR' then 3
      else null
    end)
    into highest_tier
    from profiles
    where company_id = my_company and assigned_branch = p_branch and is_active
      and role in ('TECHNICIAN', 'TECHNICIAN_MANAGER', 'TECHNICAL_ASSISTANT_DIRECTOR', 'TECHNICAL_DIRECTOR');

  return highest_tier is not null and my_tier = highest_tier;
end;
$$;
