-- =====================================================================
-- 0327 — Branch Daily Report: editable fallback tech access.
--
-- A branch with no active Branch Manager hands notes-only access to its
-- highest present technician-pay tier (0307). Per the user's explicit
-- call, that stays the DEFAULT, but Senior Branch Manager and above can
-- now pick the fallback tech(s) themselves. Once a branch has any rows in
-- branch_daily_report_fallback_techs, that list REPLACES the automatic
-- highest-tier pick for that branch; deleting all its rows restores the
-- default. Still only applies while the branch has no active Branch
-- Manager, same as the automatic fallback.
--
-- Who may edit the list: can_manage_branch_extra_editors() — HR-and-above,
-- Technical Assistant Director, or the Senior Branch Manager assigned to
-- that branch (0319/0320).
--
-- Additive only: new table + policies, and can_edit_branch_daily_report()
-- re-created with one extra check. No existing rows are touched.
--
-- Run once in the Supabase SQL Editor, after 0326.
-- =====================================================================

create table if not exists branch_daily_report_fallback_techs (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  branch       text not null,
  profile_id   uuid not null references profiles(id) on delete cascade,
  granted_by   uuid references profiles(id),
  created_at   timestamptz not null default now(),
  unique (company_id, branch, profile_id)
);
create index if not exists idx_branch_fallback_techs_branch on branch_daily_report_fallback_techs(company_id, branch);
create index if not exists idx_branch_fallback_techs_profile on branch_daily_report_fallback_techs(profile_id);

-- Same company/granted_by stamping as the extra-editors table.
drop trigger if exists trg_branch_fallback_techs_stamp on branch_daily_report_fallback_techs;
create trigger trg_branch_fallback_techs_stamp before insert on branch_daily_report_fallback_techs
  for each row execute function branch_daily_report_extra_editors_stamp();

alter table branch_daily_report_fallback_techs enable row level security;
alter table branch_daily_report_fallback_techs force row level security;

drop policy if exists branch_fallback_techs_select on branch_daily_report_fallback_techs;
create policy branch_fallback_techs_select on branch_daily_report_fallback_techs
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists branch_fallback_techs_insert on branch_daily_report_fallback_techs;
create policy branch_fallback_techs_insert on branch_daily_report_fallback_techs
  for insert with check (
    (company_id = auth_company_id() or is_superadmin())
    and can_manage_branch_extra_editors(branch)
  );

drop policy if exists branch_fallback_techs_delete on branch_daily_report_fallback_techs;
create policy branch_fallback_techs_delete on branch_daily_report_fallback_techs
  for delete using (
    (company_id = auth_company_id() or is_superadmin())
    and can_manage_branch_extra_editors(branch)
  );

-- ---------- can_edit_branch_daily_report: honor the picked fallback list ----------
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

  -- Fallback only applies while the branch has no active Branch Manager.
  select exists (
    select 1 from profiles
    where company_id = my_company and assigned_branch = p_branch and is_active
      and role = 'BRANCH_MANAGER'
  ) into has_branch_manager;
  if has_branch_manager then
    return false;
  end if;

  -- New in 0327 — a hand-picked fallback list replaces the automatic tier pick.
  if exists (
    select 1 from branch_daily_report_fallback_techs
    where company_id = my_company and branch = p_branch
  ) then
    return exists (
      select 1 from branch_daily_report_fallback_techs
      where company_id = my_company and branch = p_branch and profile_id = my_id
    );
  end if;

  -- Default: highest present tier — primary role only.
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
