-- =====================================================================
-- 0434 — New role: HR_MANAGER ("HR Manager"), in the HR department, with
-- exactly HR's access everywhere — the app treats it as also holding HR
-- (ROLE_INCLUDES in src/lib/roleLabels.ts), and this does the same for
-- every database check that lets HR in.
--
-- No role constraint to widen: profiles_role_check was dropped in 0209
-- (custom roles), so profiles can already hold the new code.
--
-- Each function below is its latest definition with HR_MANAGER added next
-- to HR — nothing else changed:
--   is_hr() (0150) — every RLS policy and function that calls it
--   can_post_announcements (0359)
--   chain_can_approve_correction (0366)
--   chain_can_clock_in (0340, last replaced in 0427)
--   chain_department (0337, last replaced in 0427) — files them under "HR" in the PH approval chain, like HR
--   clock_code_issuer (0344)
--   clock_code_viewer (0352)
--   csr_coaching_can_read_all (0356)
--   csr_coaching_is_full_reader (0357)
--   accounting_coaching_can_read_all (0433)
--   hiring_gmail_caller (0428) — Hiring's Gmail accounts and signatures
--   set_flash_tech_open_alert_email (0268)
--   restrict_profile_self_edit_columns (0225, last replaced in 0427) — their own Required Schedule / Days Off, like HR
--   messages_insert policy (0137) — posting announcements in Team Messenger
--   technician_clock_out_checks_select policy (0362, last replaced in 0427)
--
-- Not changed: chain_department_manager_roles (0337) has no default HR
-- approver, same as before — an HR Manager isn't the HR department's PH
-- approver unless an Admin names them in the PH approval chain panel,
-- exactly like HR today.
--
-- Replaces functions with the same signatures and two policies — no data
-- is touched. Run once in the Supabase SQL Editor, after 0433.
-- Safe to run twice.
-- =====================================================================

create or replace function is_hr()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
      and (role in ('HR', 'HR_MANAGER') or 'HR' = any(extra_roles) or 'HR_MANAGER' = any(extra_roles))
  );
$$;

create or replace function can_post_announcements()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
      and (
        role in ('SUPERADMIN','ADMIN','MANAGER','SENIOR_MANAGER','HR','HR_MANAGER','BRANCH_MANAGER','SENIOR_BRANCH_MANAGER',
                 'CSR_MANAGER','CLAIMS_MANAGER','PARTS_MANAGER','BIZOPS_MANAGER','BIZOPS_SENIOR_MANAGER')
        or extra_roles && array['SUPERADMIN','ADMIN','MANAGER','SENIOR_MANAGER','HR','HR_MANAGER','BRANCH_MANAGER','SENIOR_BRANCH_MANAGER',
                 'CSR_MANAGER','CLAIMS_MANAGER','PARTS_MANAGER','BIZOPS_MANAGER','BIZOPS_SENIOR_MANAGER']::text[]
      )
  );
$$;

create or replace function chain_can_approve_correction(p_viewer uuid, p_requester uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v profiles%rowtype;
  r profiles%rowtype;
  v_roles text[];
  r_roles text[];
  r_level text;
  is_logistics boolean;
  parts_roles constant text[] := array['PARTS', 'PARTS_TEAM_LEADER', 'PARTS_MANAGER', 'PARTS_ORDER'];
  tech_roles constant text[] := array['TECHNICIAN', 'TECHNICIAN_MANAGER', 'BRANCH_MANAGER', 'SENIOR_BRANCH_MANAGER', 'TECHNICAL_ASSISTANT_DIRECTOR', 'TECHNICAL_DIRECTOR'];
begin
  select * into r from profiles where id = p_requester;
  if not found then return null; end if;
  -- Philippines: department chain, unchanged.
  if chain_norm_branch(r.assigned_branch) = 'philippines' then
    return chain_can_approve(p_viewer, p_requester);
  end if;

  r_roles := array(select upper(x) from unnest(array_append(coalesce(r.extra_roles, '{}'), r.role)) x where x is not null);
  is_logistics := upper(coalesce(r.role, '')) not in ('ADMIN', 'SUPERADMIN', 'SUPERSUPERADMIN')
    and r_roles && parts_roles
    and not (upper(coalesce(r.role, '')) = any(tech_roles));

  if not is_logistics then
    r_level := chain_level_held(r.role, r.extra_roles);
    if r_level is distinct from 'tech' then
      return chain_can_approve(p_viewer, p_requester); -- branch / SBM / directors / not governed: unchanged
    end if;
    -- Technician: same as chain_can_approve, minus the Parts roles.
    select * into v from profiles where id = p_viewer;
    if not found or v.company_id <> r.company_id or v.id = r.id then return false; end if;
    v_roles := array(select upper(x) from unnest(array_append(coalesce(v.extra_roles, '{}'), v.role)) x where x is not null);
    if v_roles && array['SUPERADMIN', 'SUPERSUPERADMIN'] then return true; end if;
    return chain_is_top(v.id, r.company_id, v_roles)
      or ('BRANCH_MANAGER' = any(v_roles) and chain_norm_branch(v.assigned_branch) = chain_norm_branch(r.assigned_branch))
      or chain_owns_branch(v.id, r.company_id, r.assigned_branch);
  end if;

  -- Logistics (Parts).
  select * into v from profiles where id = p_viewer;
  if not found or v.company_id <> r.company_id or v.id = r.id then return false; end if;
  v_roles := array(select upper(x) from unnest(array_append(coalesce(v.extra_roles, '{}'), v.role)) x where x is not null);
  if v_roles && array['SUPERADMIN', 'SUPERSUPERADMIN', 'ADMIN', 'HR', 'HR_MANAGER'] then return true; end if;
  if 'PARTS_MANAGER' = any(r_roles) then return false; -- a Parts Manager's: HR / Admin / SuperAdmin only
  end if;
  return 'PARTS_MANAGER' = any(v_roles)
    and chain_norm_branch(v.assigned_branch) = chain_norm_branch(r.assigned_branch);
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

  if v_roles && array['SUPERADMIN', 'SUPERSUPERADMIN', 'ADMIN', 'HR', 'HR_MANAGER', 'FINANCE', 'ACCOUNTING_MANAGER', 'TECHNICAL_DIRECTOR', 'TECHNICAL_ASSISTANT_DIRECTOR'] then return true; end if;
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
    when 'HR' then 'HR' when 'HR_MANAGER' then 'HR'
    when 'IT' then 'IT'
    when 'DISPATCHER' then 'Dispatch'
    when 'TECHNICIAN' then 'Technician' when 'TECHNICIAN_MANAGER' then 'Technician'
    when 'TECHNICAL_DIRECTOR' then 'Technician' when 'TECHNICAL_ASSISTANT_DIRECTOR' then 'Technician'
    when 'BRANCH_MANAGER' then 'Technician' when 'SENIOR_BRANCH_MANAGER' then 'Technician'
    else 'Other'
  end;
$$;

create or replace function clock_code_issuer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth_profile_id()
      and array(select upper(x) from unnest(array_append(coalesce(p.extra_roles, '{}'), p.role)) x where x is not null)
          && array['HR', 'HR_MANAGER', 'ADMIN', 'SUPERADMIN', 'SUPERSUPERADMIN']
  );
$$;

create or replace function clock_code_viewer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth_profile_id()
      and array(
            select upper(trim(x)) from unnest(array_append(coalesce(p.extra_roles, '{}'), p.role)) x
            where x is not null and trim(x) <> ''
          )
          && (array['HR', 'HR_MANAGER', 'ADMIN', 'SUPERADMIN', 'SUPERSUPERADMIN']
              || array(select upper(trim(r)) from unnest(get_clock_code_viewer_roles()) r))
  );
$$;

create or replace function csr_coaching_can_read_all()
returns boolean language sql stable security definer set search_path = public as $$
  select csr_coaching_caller_has_role(array['ADMIN', 'SUPERADMIN', 'CSR_MANAGER', 'CSR_TEAM_LEADER', 'HR', 'HR_MANAGER', 'SENIOR_MANAGER']);
$$;

create or replace function csr_coaching_is_full_reader()
returns boolean language sql stable security definer set search_path = public as $$
  select csr_coaching_caller_has_role(array['ADMIN', 'SUPERADMIN', 'CSR_MANAGER', 'HR', 'HR_MANAGER', 'SENIOR_MANAGER']);
$$;

create or replace function accounting_coaching_can_read_all()
returns boolean language sql stable security definer set search_path = public as $$
  select accounting_coaching_caller_has_role(array['ADMIN', 'SUPERADMIN', 'SUPERSUPERADMIN', 'HR', 'HR_MANAGER', 'SENIOR_MANAGER']);
$$;

create or replace function hiring_gmail_caller()
returns table(company_id uuid, profile_id uuid, can_use boolean, can_manage_all boolean)
language sql stable security definer set search_path = public as $$
  select
    p.company_id,
    p.id,
    exists (select 1 from unnest(array_append(coalesce(p.extra_roles, '{}'), p.role)) r where upper(r) in ('HR', 'HR_MANAGER', 'ADMIN', 'SUPERADMIN')),
    exists (select 1 from unnest(array_append(coalesce(p.extra_roles, '{}'), p.role)) r where upper(r) in ('ADMIN', 'SUPERADMIN'))
  from profiles p
  where p.firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
    and coalesce(p.is_active, true)
  limit 1;
$$;

create or replace function set_flash_tech_open_alert_email(p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company_id uuid;
  v_role text;
begin
  select company_id, role into v_company_id, v_role
  from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;

  if v_role is null or upper(v_role) not in ('ADMIN', 'SUPERADMIN', 'HR', 'HR_MANAGER') then
    raise exception 'Only HR/Admin can set the Flash Tech alert recipient';
  end if;

  update companies
  set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{flashTechOpenAlertEmail}', to_jsonb(p_email))
  where id = v_company_id;
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
       'SUPERADMIN', 'ADMIN', 'HR', 'HR_MANAGER', 'MANAGER', 'SENIOR_MANAGER',
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

drop policy if exists messages_insert on messages;
create policy messages_insert on messages
  for insert with check (
    company_id = auth_company_id()
    and (
      is_announcement = false
      or exists (
        select 1 from profiles p
        where p.firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
          and p.role in ('SUPERADMIN','ADMIN','MANAGER','HR','HR_MANAGER')
      )
    )
    and (
      channel_id is null
      or not exists (select 1 from message_channels mc where mc.id = messages.channel_id and mc.is_private = true)
      or can_access_private_channel(messages.channel_id)
    )
  );

drop policy if exists technician_clock_out_checks_select on technician_clock_out_checks;
create policy technician_clock_out_checks_select on technician_clock_out_checks
  for select using (
    company_id = auth_company_id()
    and exists (
      select 1 from profiles
      where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
        and (
          upper(role) in ('HR', 'HR_MANAGER', 'ADMIN', 'SUPERADMIN', 'FINANCE', 'ACCOUNTING_MANAGER')
          or exists (select 1 from unnest(coalesce(extra_roles, '{}')) r where upper(r) in ('HR', 'HR_MANAGER', 'ADMIN', 'SUPERADMIN', 'FINANCE', 'ACCOUNTING_MANAGER'))
        )
    )
  );

notify pgrst, 'reload schema';
