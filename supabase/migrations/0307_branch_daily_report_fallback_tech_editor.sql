-- =====================================================================
-- 0307 — Branch Daily Report: fallback editor for branches with no
-- active Branch Manager.
--
-- can_edit_branch_daily_report() (0284) only ever granted write access to
-- HR-and-above, the branch's own Branch Manager, or its assigned Senior
-- Branch Manager — a branch with none of those (no Branch Manager hired
-- yet, or the role vacant) had literally nobody able to post an update
-- except HR reaching in from outside. This adds one more fallback: when a
-- branch has no active Branch Manager, whichever technician(s) at that
-- branch hold its highest present technician-pay tier may also edit
-- (never Urgency — that stays HR/Senior Branch Manager only, same
-- notes-only trust model Branch Manager's own restriction already relies
-- on: this function gates the whole report row, the app's own UI is what
-- keeps the Urgency control disabled for this tier, exactly like it
-- already does for a plain Branch Manager).
--
-- Tier order (highest wins): Technician (0) < Technician Manager (1) <
-- Technical Assistant Director (2) < Technical Director (3). If several
-- people at the branch share the highest present tier, all of them
-- qualify — role+branch based, same as every other tier in this
-- function, not tied to one specific person's identity.
--
-- Run once in the Supabase SQL Editor, after 0284.
-- =====================================================================

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
