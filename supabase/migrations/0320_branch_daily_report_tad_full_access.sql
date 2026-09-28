-- =====================================================================
-- 0320 — Branch Daily Report: Technical Assistant Director gets the same
-- full access as HR-and-above.
--
-- Per the user's explicit call: "that role must be able to access
-- everything in [Branch Daily Report]" — every branch, notes AND
-- Urgency, moderate/delete any note, manage SBM branch assignments, and
-- add/remove extra editors on any branch. Same tier as
-- HR/Admin/SuperAdmin/SuperSuperAdmin throughout; checked role-or-extra-
-- roles, same convention every other role check in this feature already
-- uses (Branch Manager/Senior Branch Manager in 0284/0307/0319).
--
-- Run once in the Supabase SQL Editor, after 0319.
-- =====================================================================

-- ---------- 1. Full notes+urgency access on every branch ----------
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

  if my_role = 'TECHNICAL_ASSISTANT_DIRECTOR' or 'TECHNICAL_ASSISTANT_DIRECTOR' = any(my_extra) then
    return true;
  end if;

  if (my_role = 'BRANCH_MANAGER' or 'BRANCH_MANAGER' = any(my_extra)) and my_branch = p_branch then
    return true;
  end if;
  if (my_role = 'SENIOR_BRANCH_MANAGER' or 'SENIOR_BRANCH_MANAGER' = any(my_extra)) and exists (
    select 1 from senior_branch_manager_branches
    where profile_id = my_id and branch = p_branch
  ) then
    return true;
  end if;

  if exists (
    select 1 from branch_daily_report_extra_editors
    where profile_id = my_id and branch = p_branch
  ) then
    return true;
  end if;

  -- Fallback tier — primary role only (same convention
  -- BranchDailyReportPage.tsx's own techsFor()/tier lookup uses, not
  -- role-OR-extra-roles like the checks above).
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

-- ---------- 2. Manage extra editors on any branch ----------
create or replace function can_manage_branch_extra_editors(p_branch text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  my_id uuid := auth_profile_id();
begin
  if is_hr() or is_admin() or is_company_superadmin() or is_superadmin() then
    return true;
  end if;
  if exists (
    select 1 from profiles
    where id = my_id
      and (role = 'TECHNICAL_ASSISTANT_DIRECTOR' or 'TECHNICAL_ASSISTANT_DIRECTOR' = any(coalesce(extra_roles, '{}')))
  ) then
    return true;
  end if;
  return exists (
    select 1 from senior_branch_manager_branches
    where profile_id = my_id and branch = p_branch
  );
end;
$$;

-- ---------- 3. Manage SBM branch assignments ----------
drop policy if exists sbm_branches_insert on senior_branch_manager_branches;
create policy sbm_branches_insert on senior_branch_manager_branches
  for insert with check (
    (company_id = auth_company_id() or is_superadmin())
    and (
      is_hr() or is_admin() or is_company_superadmin() or is_superadmin()
      or exists (
        select 1 from profiles
        where id = auth_profile_id()
          and (
            role = 'SENIOR_BRANCH_MANAGER' or 'SENIOR_BRANCH_MANAGER' = any(coalesce(extra_roles, '{}'))
            or role = 'TECHNICAL_ASSISTANT_DIRECTOR' or 'TECHNICAL_ASSISTANT_DIRECTOR' = any(coalesce(extra_roles, '{}'))
          )
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
          and (
            role = 'SENIOR_BRANCH_MANAGER' or 'SENIOR_BRANCH_MANAGER' = any(coalesce(extra_roles, '{}'))
            or role = 'TECHNICAL_ASSISTANT_DIRECTOR' or 'TECHNICAL_ASSISTANT_DIRECTOR' = any(coalesce(extra_roles, '{}'))
          )
      )
    )
  );

-- ---------- 4. Delete a whole report row ----------
drop policy if exists branch_daily_reports_delete on branch_daily_reports;
create policy branch_daily_reports_delete on branch_daily_reports
  for delete using (
    (company_id = auth_company_id() or is_superadmin())
    and (
      is_hr() or is_admin() or is_company_superadmin() or is_superadmin()
      or exists (
        select 1 from profiles
        where id = auth_profile_id()
          and (role = 'TECHNICAL_ASSISTANT_DIRECTOR' or 'TECHNICAL_ASSISTANT_DIRECTOR' = any(coalesce(extra_roles, '{}')))
      )
    )
  );

-- ---------- 5. Moderate/delete any note ----------
drop policy if exists branch_daily_report_notes_delete on branch_daily_report_notes;
create policy branch_daily_report_notes_delete on branch_daily_report_notes
  for delete using (
    (company_id = auth_company_id() or is_superadmin())
    and (
      author_id = auth_profile_id()
      or is_hr() or is_admin() or is_company_superadmin() or is_superadmin()
      or exists (
        select 1 from profiles
        where id = auth_profile_id()
          and (role = 'TECHNICAL_ASSISTANT_DIRECTOR' or 'TECHNICAL_ASSISTANT_DIRECTOR' = any(coalesce(extra_roles, '{}')))
      )
    )
  );
