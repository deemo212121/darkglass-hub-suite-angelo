-- =====================================================================
-- 0427 — New role: ACCOUNTING_MANAGER ("Accounting Manager"), in the
-- Accounting department, with exactly Accounting's (FINANCE) access
-- everywhere — the app treats it as also holding FINANCE (ROLE_INCLUDES in
-- src/lib/roleLabels.ts), and this does the same for every database check
-- that lets FINANCE in.
--
-- No role constraint to widen: profiles_role_check was dropped in 0209
-- (custom roles), so profiles can already hold the new code.
--
-- Each function below is its latest definition with ACCOUNTING_MANAGER
-- added next to FINANCE — nothing else changed:
--   is_finance()                        (0206) — every RLS policy and
--                                        function that calls it: profile
--                                        edits, payroll, expenses,
--                                        incentives (0426), ...
--   set_car_iq_mileage_rates            (0324)
--   car_iq_rate_caller_company          (0381)
--   chain_can_clock_in                  (0340)
--   chain_department                    (0405) — files them under
--                                        "Accounting" in the PH approval
--                                        chain, like FINANCE
--   expenses_review_accounting_only     (0396)
--   restrict_profile_self_edit_columns  (0410) — Payroll's include box on
--                                        their own row
-- plus the technician_clock_out_checks_select policy (0362).
--
-- Replaces functions with the same signatures and one read policy — no
-- data is touched. Run once in the Supabase SQL Editor, after 0426.
-- Safe to run twice.
-- =====================================================================

create or replace function is_finance()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
      and (role in ('FINANCE', 'ACCOUNTING_MANAGER') or 'FINANCE' = any(extra_roles) or 'ACCOUNTING_MANAGER' = any(extra_roles))
  );
$$;

create or replace function set_car_iq_mileage_rates(p_with numeric, p_without numeric)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company_id uuid;
  v_role text;
begin
  select company_id, role into v_company_id, v_role
  from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;

  if v_role is null or upper(v_role) not in ('ADMIN', 'SUPERADMIN', 'FINANCE', 'ACCOUNTING_MANAGER') then
    raise exception 'Only Admin/Finance can set the Car IQ mileage rates';
  end if;

  if p_with < 0 or p_without < 0 then
    raise exception 'Mileage rates cannot be negative';
  end if;

  update companies
  set settings = jsonb_set(
        jsonb_set(coalesce(settings, '{}'::jsonb), '{carIqMileageRateWith}', to_jsonb(p_with)),
        '{carIqMileageRateWithout}', to_jsonb(p_without)
      )
  where id = v_company_id;
end;
$$;

create or replace function car_iq_rate_caller_company()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_company_id uuid;
  v_ok boolean;
begin
  select company_id,
         (upper(coalesce(role, '')) in ('ADMIN', 'SUPERADMIN', 'FINANCE', 'ACCOUNTING_MANAGER')
          or coalesce(extra_roles, '{}') && array['ADMIN', 'SUPERADMIN', 'FINANCE', 'ACCOUNTING_MANAGER'])
    into v_company_id, v_ok
  from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;
  if not coalesce(v_ok, false) then
    raise exception 'Only Admin/Finance can change the Car IQ mileage rates';
  end if;
  return v_company_id;
end;
$$;

create or replace function chain_can_clock_in(p_viewer uuid, p_target uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v profiles%rowtype;
  t profiles%rowtype;
  v_roles text[];
  t_level text;
begin
  select * into t from profiles where id = p_target;
  if not found then return null; end if;
  t_level := chain_level_held(t.role, t.extra_roles);
  if t_level is null or chain_norm_branch(t.assigned_branch) = 'philippines' then return null; end if;

  select * into v from profiles where id = p_viewer;
  if not found or v.company_id <> t.company_id then return false; end if;
  v_roles := array(select upper(x) from unnest(array_append(coalesce(v.extra_roles, '{}'), v.role)) x where x is not null);

  if v_roles && array['SUPERADMIN', 'SUPERSUPERADMIN', 'ADMIN', 'HR', 'FINANCE', 'ACCOUNTING_MANAGER', 'TECHNICAL_DIRECTOR', 'TECHNICAL_ASSISTANT_DIRECTOR'] then return true; end if;
  -- The top level clocks in at every branch.
  if chain_is_top(v.id, v.company_id, v_roles) then return true; end if;
  if t_level = 'tech' then
    return (v_roles && array['PARTS', 'PARTS_TEAM_LEADER', 'PARTS_MANAGER', 'BRANCH_MANAGER'] and chain_norm_branch(v.assigned_branch) = chain_norm_branch(t.assigned_branch))
      or chain_owns_branch(v.id, t.company_id, t.assigned_branch);
  elsif t_level = 'branch' then
    return chain_owns_branch(v.id, t.company_id, t.assigned_branch);
  end if;
  return false;
end;
$$;

create or replace function chain_department(p_role text)
returns text language sql immutable as $$
  select case upper(coalesce(p_role, ''))
    when 'CSR' then 'CSR' when 'CSR_AGENT' then 'CSR' when 'CSR_TEAM_LEADER' then 'CSR' when 'CSR_MANAGER' then 'CSR'
    when 'CLAIMS' then 'Claims' when 'CLAIMS_TEAM_LEADER' then 'Claims' when 'CLAIMS_MANAGER' then 'Claims'
    when 'PARTS' then 'Parts' when 'PARTS_ORDER' then 'Parts' when 'PARTS_TEAM_LEADER' then 'Parts' when 'PARTS_MANAGER' then 'Parts'
    when 'BIZOPS_ASSOCIATE' then 'BizOps' when 'BIZOPS_TEAM_LEADER' then 'BizOps'
    when 'BIZOPS_MANAGER' then 'BizOps' when 'BIZOPS_SENIOR_MANAGER' then 'BizOps'
    when 'TRIAGE_USER' then 'Triage' when 'TRIAGE_MANAGER' then 'Triage'
    when 'SALES_MANAGER' then 'Sales'
    when 'MANAGER' then 'Management' when 'SENIOR_MANAGER' then 'Management'
    when 'FINANCE' then 'Accounting' when 'ACCOUNTING_MANAGER' then 'Accounting'
    when 'HR' then 'HR'
    when 'IT' then 'IT'
    when 'DISPATCHER' then 'Dispatch'
    when 'TECHNICIAN' then 'Technician' when 'TECHNICIAN_MANAGER' then 'Technician'
    when 'TECHNICAL_DIRECTOR' then 'Technician' when 'TECHNICAL_ASSISTANT_DIRECTOR' then 'Technician'
    when 'BRANCH_MANAGER' then 'Technician' when 'SENIOR_BRANCH_MANAGER' then 'Technician'
    else 'Other'
  end;
$$;

create or replace function expenses_review_accounting_only()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_roles text[];
begin
  if new.status is not distinct from old.status
     and new.reviewed_by is not distinct from old.reviewed_by then
    return new;
  end if;
  if auth_profile_id() is null then
    return new; -- server-side / service role
  end if;
  select array_append(coalesce(p.extra_roles, '{}'), p.role) into v_roles
  from profiles p where p.id = auth_profile_id();
  if not exists (
    select 1 from unnest(coalesce(v_roles, '{}')) r
    where upper(replace(trim(r), ' ', '_')) in ('FINANCE', 'ACCOUNTING_MANAGER', 'ADMIN', 'SUPERADMIN', 'SUPERSUPERADMIN')
  ) then
    raise exception 'Only Accounting can approve, reject or reimburse expenses.';
  end if;
  return new;
end;
$$;

create or replace function restrict_profile_self_edit_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_self boolean;
  my_role text;
  is_super boolean;
begin
  is_self := (auth_profile_id() is not null) and (old.id = auth_profile_id());
  if not is_self then
    return new;
  end if;

  my_role := old.role; -- the caller's OWN role as of BEFORE this edit
  -- SuperAdmin / SuperSuperAdmin, primary or extra role (0410).
  is_super := exists (
    select 1 from unnest(array_append(coalesce(old.extra_roles, '{}'), old.role)) r
    where upper(r) in ('SUPERADMIN', 'SUPERSUPERADMIN')
  );

  -- Account identity — never editable on your own row, SuperAdmin included.
  if new.company_id is distinct from old.company_id
     or new.firebase_uid is distinct from old.firebase_uid
     or new.id is distinct from old.id
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by
  then
    raise exception 'You do not have permission to change that field on your own account.';
  end if;

  -- A SuperAdmin may edit everything else on their own record (0410).
  if is_super then
    return new;
  end if;

  -- Role — mirrors profile.tsx's ACCOUNT_FIELD_EDIT_ROLES exactly.
  if new.role is distinct from old.role
     and my_role not in ('ADMIN', 'SUPERADMIN', 'SUPERSUPERADMIN') then
    raise exception 'You do not have permission to change your own role.';
  end if;

  -- Extra roles — same trusted-tier exception as role above.
  if new.extra_roles is distinct from old.extra_roles
     and my_role not in ('ADMIN', 'SUPERADMIN', 'SUPERSUPERADMIN') then
    raise exception 'You do not have permission to change your own extra roles.';
  end if;

  -- Required Check-In/Out + Days Off — mirrors profile.tsx's SCHEDULE_EDIT_ROLES.
  if (new.required_check_in is distinct from old.required_check_in
      or new.required_check_out is distinct from old.required_check_out
      or new.off_days is distinct from old.off_days)
     and my_role not in (
       'SUPERADMIN', 'ADMIN', 'HR', 'MANAGER', 'SENIOR_MANAGER',
       'BRANCH_MANAGER', 'SENIOR_BRANCH_MANAGER', 'CSR_MANAGER',
       'CLAIMS_MANAGER', 'PARTS_MANAGER', 'BIZOPS_MANAGER', 'BIZOPS_SENIOR_MANAGER'
     ) then
    raise exception 'You do not have permission to change your own schedule.';
  end if;

  -- Schedule timezone — mirrors profile.tsx's canEditTimezone (SUPERADMIN only).
  if new.schedule_timezone is distinct from old.schedule_timezone
     and my_role <> 'SUPERADMIN' then
    raise exception 'You do not have permission to change your own timezone.';
  end if;

  -- must_change_password — only the self-clear direction has a real use.
  if new.must_change_password is distinct from old.must_change_password
     and new.must_change_password = true then
    raise exception 'Cannot set your own must-change-password flag.';
  end if;

  -- frozen — only the auto-unfreeze-on-sign direction has a real use.
  if new.frozen is distinct from old.frozen
     and not (old.frozen = true and new.frozen = false) then
    raise exception 'You do not have permission to change your own frozen status.';
  end if;
  if new.frozen_at is distinct from old.frozen_at
     or new.frozen_by is distinct from old.frozen_by
     or new.frozen_by_name is distinct from old.frozen_by_name then
    raise exception 'You do not have permission to change that field on your own account.';
  end if;

  -- payroll_excluded (Accounting → Payroll's include checkbox) — whoever runs
  -- payroll may include / exclude their own row too (0390). Primary or extra role.
  if new.payroll_excluded is distinct from old.payroll_excluded
     and not exists (
       select 1 from unnest(array_append(coalesce(old.extra_roles, '{}'), old.role)) r
       where upper(r) in ('FINANCE', 'ACCOUNTING_MANAGER', 'ADMIN', 'SUPERADMIN', 'SUPERSUPERADMIN')
     ) then
    raise exception 'You do not have permission to change your own payroll inclusion.';
  end if;

  -- Everything else below still has NO legitimate self-edit call site.
  if new.is_active is distinct from old.is_active
     or new.branch_access is distinct from old.branch_access
     or new.employment_type is distinct from old.employment_type
     or new.manager_name is distinct from old.manager_name
     or new.master_list_extra_departments is distinct from old.master_list_extra_departments
     or new.technician_id is distinct from old.technician_id
     or new.username is distinct from old.username
     or new.permissions is distinct from old.permissions
     or new.employee_id is distinct from old.employee_id
     or new.employee_info is distinct from old.employee_info
     or new.last_login_ip is distinct from old.last_login_ip
     or new.failed_login_count is distinct from old.failed_login_count
     or new.locked_until is distinct from old.locked_until
     or new.current_session_id is distinct from old.current_session_id
     or new.updated_at is distinct from old.updated_at
  then
    raise exception 'You do not have permission to change that field on your own account.';
  end if;

  return new;
end;
$$;

drop policy if exists technician_clock_out_checks_select on technician_clock_out_checks;
create policy technician_clock_out_checks_select on technician_clock_out_checks
  for select using (
    company_id = auth_company_id()
    and exists (
      select 1 from profiles
      where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
        and (
          upper(role) in ('HR', 'ADMIN', 'SUPERADMIN', 'FINANCE', 'ACCOUNTING_MANAGER')
          or exists (select 1 from unnest(coalesce(extra_roles, '{}')) r where upper(r) in ('HR', 'ADMIN', 'SUPERADMIN', 'FINANCE', 'ACCOUNTING_MANAGER'))
        )
    )
  );
