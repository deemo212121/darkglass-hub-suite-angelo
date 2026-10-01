-- =====================================================================
-- 0334 — Approval Chain: Philippines staff.
--
-- PH staff aren't organized by branch/area — they're organized by
-- department. A PH staff member's Manager step (Time Corrections, PTO,
-- trainee days) can be approved by:
--   - their DEPARTMENT's manager(s), or
--   - the top level (same list as the US side, 0333 / chain_is_top).
-- Team Leaders do not approve. A department manager's own request goes to
-- the top level. No clock-in rules for PH (chain_can_clock_in stays NULL).
--
-- Department managers: an editable list per department
-- (ph_department_managers, Admin → Approval Chain → Philippines). When a
-- department has no list, the default is PH staff whose PRIMARY role is the
-- department's manager role, or who hold it as an extra role within the same
-- department (e.g. a Claims Team Leader who also holds Claims Manager).
--
-- Department = the person's primary role's department (same grouping as
-- roleLabels.ts ROLE_DEPARTMENT_BREAKDOWN). Admin / SuperAdmin as the primary
-- role is never governed.
--
-- Run once in the Supabase SQL Editor, after 0333.
-- =====================================================================

create table if not exists ph_department_managers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  department  text not null,
  profile_id  uuid not null references profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (company_id, department, profile_id)
);

create or replace function ph_department_managers_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_ph_department_managers_stamp on ph_department_managers;
create trigger trg_ph_department_managers_stamp before insert on ph_department_managers
  for each row execute function ph_department_managers_stamp();

alter table ph_department_managers enable row level security;
alter table ph_department_managers force row level security;
drop policy if exists ph_department_managers_select on ph_department_managers;
create policy ph_department_managers_select on ph_department_managers
  for select using (company_id = auth_company_id() or is_superadmin());
drop policy if exists ph_department_managers_insert on ph_department_managers;
create policy ph_department_managers_insert on ph_department_managers
  for insert with check ((company_id = auth_company_id() or is_superadmin()) and (is_admin() or is_company_superadmin() or is_superadmin()));
drop policy if exists ph_department_managers_delete on ph_department_managers;
create policy ph_department_managers_delete on ph_department_managers
  for delete using ((company_id = auth_company_id() or is_superadmin()) and (is_admin() or is_company_superadmin() or is_superadmin()));

-- ---------- Helpers ------------------------------------------------------
create or replace function chain_department(p_role text)
returns text language sql immutable as $$
  select case upper(coalesce(p_role, ''))
    when 'CSR' then 'CSR' when 'CSR_AGENT' then 'CSR' when 'CSR_TEAM_LEADER' then 'CSR' when 'CSR_MANAGER' then 'CSR'
    when 'CLAIMS' then 'Claims' when 'CLAIMS_TEAM_LEADER' then 'Claims' when 'CLAIMS_MANAGER' then 'Claims'
    when 'PARTS' then 'Parts' when 'PARTS_ORDER' then 'Parts' when 'PARTS_TEAM_LEADER' then 'Parts' when 'PARTS_MANAGER' then 'Parts'
    when 'BIZOPS_MANAGER' then 'BizOps' when 'BIZOPS_SENIOR_MANAGER' then 'BizOps'
    when 'TRIAGE_USER' then 'Triage' when 'TRIAGE_MANAGER' then 'Triage'
    when 'MANAGER' then 'Management' when 'SENIOR_MANAGER' then 'Management'
    when 'FINANCE' then 'Accounting'
    when 'HR' then 'HR'
    when 'IT' then 'IT'
    when 'DISPATCHER' then 'Dispatch'
    when 'TECHNICIAN' then 'Technician' when 'TECHNICIAN_MANAGER' then 'Technician'
    when 'TECHNICAL_DIRECTOR' then 'Technician' when 'TECHNICAL_ASSISTANT_DIRECTOR' then 'Technician'
    when 'BRANCH_MANAGER' then 'Technician' when 'SENIOR_BRANCH_MANAGER' then 'Technician'
    else 'Other'
  end;
$$;

create or replace function chain_department_manager_roles(p_department text)
returns text[] language sql immutable as $$
  select case p_department
    when 'CSR' then array['CSR_MANAGER']
    when 'Claims' then array['CLAIMS_MANAGER']
    when 'Parts' then array['PARTS_MANAGER']
    when 'BizOps' then array['BIZOPS_SENIOR_MANAGER', 'BIZOPS_MANAGER']
    when 'Triage' then array['TRIAGE_MANAGER']
    when 'Management' then array['SENIOR_MANAGER', 'MANAGER']
    when 'Technician' then array['TECHNICIAN_MANAGER']
    else array[]::text[]
  end;
$$;

/** Is p_profile a manager of p_department (PH)? The explicit list when the department has one, else the role default. */
create or replace function chain_is_ph_department_manager(p_profile uuid, p_company uuid, p_department text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  p profiles%rowtype;
  mgr_roles text[] := chain_department_manager_roles(p_department);
begin
  if exists (select 1 from ph_department_managers d where d.company_id = p_company and d.department = p_department) then
    return exists (select 1 from ph_department_managers d where d.company_id = p_company and d.department = p_department and d.profile_id = p_profile);
  end if;
  select * into p from profiles where id = p_profile;
  if not found or p.company_id <> p_company or not p.is_active or chain_norm_branch(p.assigned_branch) <> 'philippines' then return false; end if;
  if upper(coalesce(p.role, '')) = any(mgr_roles) then return true; end if;
  -- An extra manager role counts only within the person's own department.
  return chain_department(p.role) = p_department
    and exists (select 1 from unnest(coalesce(p.extra_roles, '{}')) x where upper(x) = any(mgr_roles));
end;
$$;

/** PH Manager-step rule. NULL = not a PH requester (or Admin as the primary role). */
create or replace function chain_ph_can_approve(p_viewer uuid, p_requester uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v profiles%rowtype;
  r profiles%rowtype;
  v_roles text[];
  dept text;
begin
  select * into r from profiles where id = p_requester;
  if not found or chain_norm_branch(r.assigned_branch) <> 'philippines' then return null; end if;
  if upper(coalesce(r.role, '')) in ('ADMIN', 'SUPERADMIN', 'SUPERSUPERADMIN') then return null; end if;

  select * into v from profiles where id = p_viewer;
  if not found or v.company_id <> r.company_id or v.id = r.id then return false; end if;
  v_roles := array(select upper(x) from unnest(array_append(coalesce(v.extra_roles, '{}'), v.role)) x where x is not null);
  if v_roles && array['SUPERADMIN', 'SUPERSUPERADMIN'] then return true; end if;
  if chain_is_top(v.id, r.company_id, v_roles) then return true; end if;

  dept := chain_department(r.role);
  -- A department manager's own request (or a top-level person's) goes to the top level only.
  if chain_is_ph_department_manager(r.id, r.company_id, dept) then return false; end if;
  return chain_is_ph_department_manager(v.id, r.company_id, dept);
end;
$$;

-- ---------- chain_can_approve: PH requesters use the department rule ----
create or replace function chain_can_approve(p_viewer uuid, p_requester uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v profiles%rowtype;
  r profiles%rowtype;
  v_roles text[];
  r_level text;
  v_top boolean;
begin
  select * into r from profiles where id = p_requester;
  if not found then return null; end if;
  if chain_norm_branch(r.assigned_branch) = 'philippines' then
    return chain_ph_can_approve(p_viewer, p_requester);
  end if;
  r_level := chain_level_held(r.role, r.extra_roles);
  if r_level is null then return null; end if;

  select * into v from profiles where id = p_viewer;
  if not found or v.company_id <> r.company_id or v.id = r.id then return false; end if;
  v_roles := array(select upper(x) from unnest(array_append(coalesce(v.extra_roles, '{}'), v.role)) x where x is not null);

  if v_roles && array['SUPERADMIN', 'SUPERSUPERADMIN'] then return true; end if;
  v_top := chain_is_top(v.id, r.company_id, v_roles);

  if r_level = 'tech' then
    return v_top
      or (v_roles && array['BRANCH_MANAGER', 'PARTS_MANAGER', 'PARTS_TEAM_LEADER', 'PARTS'] and chain_norm_branch(v.assigned_branch) = chain_norm_branch(r.assigned_branch))
      or chain_owns_branch(v.id, r.company_id, r.assigned_branch);
  elsif r_level = 'branch' then
    return v_top or chain_owns_branch(v.id, r.company_id, r.assigned_branch);
  elsif r_level = 'sbm' then
    return v_top;
  elsif chain_has_top_list(r.company_id) then
    return v_top;
  elsif r_level = 'atd' then
    return v_roles && array['ADMIN', 'TECHNICAL_DIRECTOR'];
  else -- 'td'
    return 'ADMIN' = any(v_roles);
  end if;
end;
$$;
