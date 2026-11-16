-- =====================================================================
-- 0450 — IT has Super Admin's access; only IT / Super Admin can make
--        someone IT (or Super Admin)
--
-- 1. IT counts as Super Admin everywhere the database checks for one:
--    is_company_superadmin() (every rule and function that calls it) and the
--    34 functions + 2 rules below that name 'SUPERADMIN' themselves.
--    Each is its latest definition with 'IT' added next to 'SUPERADMIN' —
--    nothing else changed. (is_it_ticket_admin already lets IT in, so it's
--    left alone.) The app does the same: ROLE_INCLUDES in
--    src/lib/roleLabels.ts — IT includes SUPERADMIN, like HR Manager
--    includes HR (0434).
--
--    Where a check is about the OTHER person (who's at the top of an approval
--    chain, whose profile a plain Admin / HR can't edit — can_edit_profile_row),
--    IT is treated like Super Admin there too.
--
-- 2. New guard on profiles: only IT or Super Admin (or the platform owner)
--    can give someone the IT or Super Admin role, or take it away — when
--    adding a user or editing one. Before this, Add User let anyone who can
--    open it (HR, Admin ...) create a Super Admin, and an extra role of Super
--    Admin could be added by an edit. The SQL Editor and the server's service
--    key aren't limited by it.
--
-- Today all 3 active IT holders are already Super Admin, so no one's access
-- changes when this runs; it decides what IT means from now on.
--
-- Replaces functions with the same signatures and two rules, and adds one
-- trigger — no data is touched. Run once in the Supabase SQL Editor, after
-- 0449. Safe to run again.
-- =====================================================================

create or replace function is_company_superadmin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
      and (role in ('SUPERADMIN', 'IT') or 'SUPERADMIN' = any(extra_roles) or 'IT' = any(extra_roles))
  );
$$;

-- accounting_coaching_can_read_all (0434)
create or replace function accounting_coaching_can_read_all()
returns boolean language sql stable security definer set search_path = public as $$
  select accounting_coaching_caller_has_role(array['ADMIN', 'SUPERADMIN', 'IT', 'SUPERSUPERADMIN', 'HR', 'HR_MANAGER', 'SENIOR_MANAGER']);
$$;

-- accounting_coaching_can_write (0433)
create or replace function accounting_coaching_can_write()
returns boolean language sql stable security definer set search_path = public as $$
  select accounting_coaching_caller_has_role(array['ADMIN', 'SUPERADMIN', 'IT', 'SUPERSUPERADMIN']);
$$;

-- can_edit_profile_row (0144)
create or replace function can_edit_profile_row(target_role text, target_firebase_uid text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    target_firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
    or is_superadmin()
    or is_company_superadmin()
    or target_role not in ('SUPERADMIN', 'IT');
$$;

-- can_post_announcements (0434)
create or replace function can_post_announcements()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
      and (
        role in ('SUPERADMIN', 'IT','ADMIN','MANAGER','SENIOR_MANAGER','HR','HR_MANAGER','BRANCH_MANAGER','SENIOR_BRANCH_MANAGER',
                 'CSR_MANAGER','CLAIMS_MANAGER','PARTS_MANAGER','BIZOPS_MANAGER','BIZOPS_SENIOR_MANAGER')
        or extra_roles && array['SUPERADMIN', 'IT','ADMIN','MANAGER','SENIOR_MANAGER','HR','HR_MANAGER','BRANCH_MANAGER','SENIOR_BRANCH_MANAGER',
                 'CSR_MANAGER','CLAIMS_MANAGER','PARTS_MANAGER','BIZOPS_MANAGER','BIZOPS_SENIOR_MANAGER']::text[]
      )
  );
$$;

-- car_iq_rate_caller_company (0427)
create or replace function car_iq_rate_caller_company()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_company_id uuid;
  v_ok boolean;
begin
  select company_id,
         (upper(coalesce(role, '')) in ('ADMIN', 'SUPERADMIN', 'IT', 'FINANCE', 'ACCOUNTING_MANAGER')
          or coalesce(extra_roles, '{}') && array['ADMIN', 'SUPERADMIN', 'IT', 'FINANCE', 'ACCOUNTING_MANAGER'])
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

-- chain_can_approve (0337)
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

  if v_roles && array['SUPERADMIN', 'IT', 'SUPERSUPERADMIN'] then return true; end if;
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

-- chain_can_approve_correction (0434)
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
  is_logistics := upper(coalesce(r.role, '')) not in ('ADMIN', 'SUPERADMIN', 'IT', 'SUPERSUPERADMIN')
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
    if v_roles && array['SUPERADMIN', 'IT', 'SUPERSUPERADMIN'] then return true; end if;
    return chain_is_top(v.id, r.company_id, v_roles)
      or ('BRANCH_MANAGER' = any(v_roles) and chain_norm_branch(v.assigned_branch) = chain_norm_branch(r.assigned_branch))
      or chain_owns_branch(v.id, r.company_id, r.assigned_branch);
  end if;

  -- Logistics (Parts).
  select * into v from profiles where id = p_viewer;
  if not found or v.company_id <> r.company_id or v.id = r.id then return false; end if;
  v_roles := array(select upper(x) from unnest(array_append(coalesce(v.extra_roles, '{}'), v.role)) x where x is not null);
  if v_roles && array['SUPERADMIN', 'IT', 'SUPERSUPERADMIN', 'ADMIN', 'HR', 'HR_MANAGER'] then return true; end if;
  if 'PARTS_MANAGER' = any(r_roles) then return false; -- a Parts Manager's: HR / Admin / SuperAdmin only
  end if;
  return 'PARTS_MANAGER' = any(v_roles)
    and chain_norm_branch(v.assigned_branch) = chain_norm_branch(r.assigned_branch);
end;
$$;

-- chain_can_approve_pto (0384)
create or replace function chain_can_approve_pto(p_viewer uuid, p_requester uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v profiles%rowtype;
  r profiles%rowtype;
  v_roles text[];
  r_roles text[];
  r_level text;
  is_logistics boolean;
  same_branch boolean;
  v_td boolean;
  v_atd boolean;
  parts_roles constant text[] := array['PARTS', 'PARTS_TEAM_LEADER', 'PARTS_MANAGER', 'PARTS_ORDER'];
  tech_roles constant text[] := array['TECHNICIAN', 'TECHNICIAN_MANAGER', 'BRANCH_MANAGER', 'SENIOR_BRANCH_MANAGER', 'TECHNICAL_ASSISTANT_DIRECTOR', 'TECHNICAL_DIRECTOR'];
begin
  select * into r from profiles where id = p_requester;
  if not found then return null; end if;
  if chain_norm_branch(r.assigned_branch) = 'philippines' then
    return chain_ph_can_approve(p_viewer, p_requester);
  end if;

  r_roles := array(select upper(x) from unnest(array_append(coalesce(r.extra_roles, '{}'), r.role)) x where x is not null);
  -- Logistics = holds a Parts role and the main role isn't tech-side or Admin (same as 0366).
  is_logistics := r_roles && parts_roles
    and not (upper(coalesce(r.role, '')) = any(tech_roles))
    and upper(coalesce(r.role, '')) not in ('ADMIN', 'SUPERADMIN', 'IT', 'SUPERSUPERADMIN');
  r_level := case when is_logistics then null else chain_level_held(r.role, r.extra_roles) end;
  if not is_logistics and r_level is null then return null; end if; -- not on either line

  select * into v from profiles where id = p_viewer;
  if not found or v.company_id <> r.company_id or v.id = r.id then return false; end if;
  v_roles := array(select upper(x) from unnest(array_append(coalesce(v.extra_roles, '{}'), v.role)) x where x is not null);
  if v_roles && array['SUPERADMIN', 'IT', 'SUPERSUPERADMIN'] then return true; end if;
  same_branch := chain_norm_branch(v.assigned_branch) <> '' and chain_norm_branch(v.assigned_branch) = chain_norm_branch(r.assigned_branch);

  if is_logistics then
    if exists (select 1 from approval_chain_parts_heads h where h.company_id = r.company_id and h.profile_id = v.id) then
      return not exists (select 1 from approval_chain_parts_heads h where h.company_id = r.company_id and h.profile_id = r.id);
    end if;
    if 'PARTS_MANAGER' = any(r_roles) then return false; end if; -- a Parts Manager's leave: the Parts head
    return 'PARTS_MANAGER' = any(v_roles) and same_branch;
  end if;

  v_td := 'TECHNICAL_DIRECTOR' = any(v_roles);
  v_atd := 'TECHNICAL_ASSISTANT_DIRECTOR' = any(v_roles);
  if r_level = 'tech' then
    return v_td or v_atd or chain_owns_branch(v.id, r.company_id, r.assigned_branch)
      or ('BRANCH_MANAGER' = any(v_roles) and same_branch);
  elsif r_level = 'branch' then
    return v_td or v_atd or chain_owns_branch(v.id, r.company_id, r.assigned_branch);
  elsif r_level = 'sbm' then
    return v_td or v_atd;
  elsif r_level = 'atd' then
    return v_td;
  else -- 'td'
    return false;
  end if;
end;
$$;

-- chain_can_clock_in (0434)
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

  if v_roles && array['SUPERADMIN', 'IT', 'SUPERSUPERADMIN', 'ADMIN', 'HR', 'HR_MANAGER', 'FINANCE', 'ACCOUNTING_MANAGER', 'TECHNICAL_DIRECTOR', 'TECHNICAL_ASSISTANT_DIRECTOR'] then return true; end if;
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

-- chain_level_held (0338)
create or replace function chain_level_held(p_role text, p_extra text[])
returns text language sql immutable as $$
  select case
    when upper(coalesce(p_role, '')) in ('ADMIN', 'SUPERADMIN', 'IT', 'SUPERSUPERADMIN') then null
    else (
      select l from (select chain_level(x) as l from unnest(array_append(coalesce(p_extra, '{}'), p_role)) x) s
      where l is not null
      order by case l when 'td' then 5 when 'atd' then 4 when 'sbm' then 3 when 'branch' then 2 else 1 end desc
      limit 1
    )
  end;
$$;

-- chain_ph_can_approve (0337)
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
  if upper(coalesce(r.role, '')) in ('ADMIN', 'SUPERADMIN', 'IT', 'SUPERSUPERADMIN') then return null; end if;

  select * into v from profiles where id = p_viewer;
  if not found or v.company_id <> r.company_id or v.id = r.id then return false; end if;
  v_roles := array(select upper(x) from unnest(array_append(coalesce(v.extra_roles, '{}'), v.role)) x where x is not null);
  if v_roles && array['SUPERADMIN', 'IT', 'SUPERSUPERADMIN'] then return true; end if;
  if chain_is_top(v.id, r.company_id, v_roles) then return true; end if;

  dept := chain_department(r.role);
  -- A department manager's own request (or a top-level person's) goes to the top level only.
  if chain_is_ph_department_manager(r.id, r.company_id, dept) then return false; end if;
  return chain_is_ph_department_manager(v.id, r.company_id, dept);
end;
$$;

-- clock_code_issuer (0434)
create or replace function clock_code_issuer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth_profile_id()
      and array(select upper(x) from unnest(array_append(coalesce(p.extra_roles, '{}'), p.role)) x where x is not null)
          && array['HR', 'HR_MANAGER', 'ADMIN', 'SUPERADMIN', 'IT', 'SUPERSUPERADMIN']
  );
$$;

-- clock_code_viewer (0434)
create or replace function clock_code_viewer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth_profile_id()
      and array(
            select upper(trim(x)) from unnest(array_append(coalesce(p.extra_roles, '{}'), p.role)) x
            where x is not null and trim(x) <> ''
          )
          && (array['HR', 'HR_MANAGER', 'ADMIN', 'SUPERADMIN', 'IT', 'SUPERSUPERADMIN']
              || array(select upper(trim(r)) from unnest(get_clock_code_viewer_roles()) r))
  );
$$;

-- csr_coaching_can_read_all (0434)
create or replace function csr_coaching_can_read_all()
returns boolean language sql stable security definer set search_path = public as $$
  select csr_coaching_caller_has_role(array['ADMIN', 'SUPERADMIN', 'IT', 'CSR_MANAGER', 'CSR_TEAM_LEADER', 'HR', 'HR_MANAGER', 'SENIOR_MANAGER']);
$$;

-- csr_coaching_can_write (0356)
create or replace function csr_coaching_can_write()
returns boolean language sql stable security definer set search_path = public as $$
  select csr_coaching_caller_has_role(array['ADMIN', 'SUPERADMIN', 'IT', 'CSR_MANAGER', 'CSR_TEAM_LEADER']);
$$;

-- csr_coaching_is_full_reader (0434)
create or replace function csr_coaching_is_full_reader()
returns boolean language sql stable security definer set search_path = public as $$
  select csr_coaching_caller_has_role(array['ADMIN', 'SUPERADMIN', 'IT', 'CSR_MANAGER', 'HR', 'HR_MANAGER', 'SENIOR_MANAGER']);
$$;

-- csr_coaching_is_manager (0357)
create or replace function csr_coaching_is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select csr_coaching_caller_has_role(array['ADMIN', 'SUPERADMIN', 'IT', 'CSR_MANAGER']);
$$;

-- decision_revert_caller (0431)
create or replace function decision_revert_caller()
returns table(company_id uuid, profile_id uuid, name text, is_super boolean)
language sql stable security definer set search_path = public as $$
  select
    p.company_id,
    p.id,
    coalesce(p.display_name, p.username, p.email),
    exists (select 1 from unnest(array_append(coalesce(p.extra_roles, '{}'), p.role)) r where upper(r) in ('SUPERADMIN', 'IT', 'SUPERSUPERADMIN'))
  from profiles p
  where p.firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
    and coalesce(p.is_active, true)
  limit 1;
$$;

-- disconnect_gmail (0329)
create or replace function disconnect_gmail(p_region text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company_id uuid;
  v_roles text[];
  v_region text := upper(coalesce(p_region, ''));
begin
  select company_id, array_append(coalesce(extra_roles, '{}'), role) into v_company_id, v_roles
  from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;

  if v_company_id is null then
    raise exception 'Profile not found';
  end if;

  if not exists (select 1 from unnest(v_roles) r where upper(r) in ('ADMIN', 'SUPERADMIN', 'IT', 'SUPERSUPERADMIN'))
     and not exists (
       select 1 from gmail_connect_role_gates g
       where g.company_id = v_company_id and g.region = v_region
         and upper(g.role) in (select upper(r) from unnest(v_roles) r)
     ) then
    raise exception 'You do not have permission to disconnect this Gmail';
  end if;

  delete from hr_gmail_connections where company_id = v_company_id and region = v_region;
end;
$$;

-- disconnect_google_drive (0080)
create or replace function disconnect_google_drive()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company_id uuid;
  v_role text;
begin
  select company_id, role into v_company_id, v_role
  from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;

  if v_role is null or upper(v_role) not in ('ADMIN', 'SUPERADMIN', 'IT') then
    raise exception 'Only an Admin can disconnect Google Drive';
  end if;

  delete from hr_google_drive_connections where company_id = v_company_id;
end;
$$;

-- expenses_review_accounting_only (0427)
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
    where upper(replace(trim(r), ' ', '_')) in ('FINANCE', 'ACCOUNTING_MANAGER', 'ADMIN', 'SUPERADMIN', 'IT', 'SUPERSUPERADMIN')
  ) then
    raise exception 'Only Accounting can approve, reject or reimburse expenses.';
  end if;
  return new;
end;
$$;

-- hiring_gmail_caller (0434)
create or replace function hiring_gmail_caller()
returns table(company_id uuid, profile_id uuid, can_use boolean, can_manage_all boolean)
language sql stable security definer set search_path = public as $$
  select
    p.company_id,
    p.id,
    exists (select 1 from unnest(array_append(coalesce(p.extra_roles, '{}'), p.role)) r where upper(r) in ('HR', 'HR_MANAGER', 'ADMIN', 'SUPERADMIN', 'IT')),
    exists (select 1 from unnest(array_append(coalesce(p.extra_roles, '{}'), p.role)) r where upper(r) in ('ADMIN', 'SUPERADMIN', 'IT'))
  from profiles p
  where p.firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
    and coalesce(p.is_active, true)
  limit 1;
$$;

-- is_branch_schedule_admin (0121)
create or replace function is_branch_schedule_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select
    upper(role) in ('ADMIN', 'SUPERADMIN', 'IT')
    or exists (
      select 1 from unnest(coalesce(extra_roles, '{}')) r
      where upper(r) in ('ADMIN', 'SUPERADMIN', 'IT')
    )
  from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;
$$;

-- is_csr_wide_visibility (0380)
create or replace function is_csr_wide_visibility()
returns boolean language sql stable security definer set search_path = public as $$
  select
    upper(role) in ('ADMIN', 'SUPERADMIN', 'IT', 'CSR_MANAGER', 'BIZOPS_MANAGER', 'BIZOPS_SENIOR_MANAGER', 'BIZOPS_TEAM_LEADER', 'BIZOPS_ASSOCIATE')
    or exists (
      select 1 from unnest(coalesce(extra_roles, '{}')) r
      where upper(r) in ('ADMIN', 'SUPERADMIN', 'IT', 'CSR_MANAGER', 'BIZOPS_MANAGER', 'BIZOPS_SENIOR_MANAGER', 'BIZOPS_TEAM_LEADER', 'BIZOPS_ASSOCIATE')
    )
  from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;
$$;


-- restrict_profile_self_edit_columns (0434)
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
    where upper(r) in ('SUPERADMIN', 'IT', 'SUPERSUPERADMIN')
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
     and my_role not in ('ADMIN', 'SUPERADMIN', 'IT', 'SUPERSUPERADMIN') then
    raise exception 'You do not have permission to change your own role.';
  end if;

  -- Extra roles — same trusted-tier exception as role above.
  if new.extra_roles is distinct from old.extra_roles
     and my_role not in ('ADMIN', 'SUPERADMIN', 'IT', 'SUPERSUPERADMIN') then
    raise exception 'You do not have permission to change your own extra roles.';
  end if;

  -- Required Check-In/Out + Days Off — mirrors profile.tsx's SCHEDULE_EDIT_ROLES.
  if (new.required_check_in is distinct from old.required_check_in
      or new.required_check_out is distinct from old.required_check_out
      or new.off_days is distinct from old.off_days)
     and my_role not in (
       'SUPERADMIN', 'IT', 'ADMIN', 'HR', 'HR_MANAGER', 'MANAGER', 'SENIOR_MANAGER',
       'BRANCH_MANAGER', 'SENIOR_BRANCH_MANAGER', 'CSR_MANAGER',
       'CLAIMS_MANAGER', 'PARTS_MANAGER', 'BIZOPS_MANAGER', 'BIZOPS_SENIOR_MANAGER'
     ) then
    raise exception 'You do not have permission to change your own schedule.';
  end if;

  -- Schedule timezone — mirrors profile.tsx's canEditTimezone (SUPERADMIN only).
  if new.schedule_timezone is distinct from old.schedule_timezone
     and my_role not in ('SUPERADMIN', 'IT') then
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
       where upper(r) in ('FINANCE', 'ACCOUNTING_MANAGER', 'ADMIN', 'SUPERADMIN', 'IT', 'SUPERSUPERADMIN')
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

-- set_car_iq_mileage_rates (0427)
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

  if v_role is null or upper(v_role) not in ('ADMIN', 'SUPERADMIN', 'IT', 'FINANCE', 'ACCOUNTING_MANAGER') then
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

-- set_company_coe_body_template (0063)
create or replace function set_company_coe_body_template(p_template text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company_id uuid;
  v_role text;
begin
  select company_id, role into v_company_id, v_role
  from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;

  if v_role is null or upper(v_role) not in ('ADMIN', 'SUPERADMIN', 'IT') then
    raise exception 'Only an Admin can edit the Certificate of Employment template';
  end if;

  update companies
  set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{coeBodyTemplate}', to_jsonb(p_template))
  where id = v_company_id;
end;
$$;

-- set_company_default_technician (0067)
create or replace function set_company_default_technician(p_technician text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company_id uuid;
  v_role text;
begin
  select company_id, role into v_company_id, v_role
  from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;

  if v_role is null or upper(v_role) not in ('ADMIN', 'SUPERADMIN', 'IT') then
    raise exception 'Only an Admin can set the default technician';
  end if;

  update companies
  set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{defaultTechnician}', to_jsonb(p_technician))
  where id = v_company_id;
end;
$$;

-- set_company_map_provider (0053)
create or replace function set_company_map_provider(p_provider text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company_id uuid;
  v_role text;
begin
  select company_id, role into v_company_id, v_role
  from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;

  if v_role is null or upper(v_role) not in ('ADMIN', 'SUPERADMIN', 'IT') then
    raise exception 'Only an Admin can change the Ticket Map provider';
  end if;

  if p_provider not in ('google', 'leaflet') then
    raise exception 'Unknown map provider: %', p_provider;
  end if;

  update companies
  set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{mapProvider}', to_jsonb(p_provider))
  where id = v_company_id;
end;
$$;

-- set_company_weekly_password_reset (0236)
create or replace function set_company_weekly_password_reset(p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company_id uuid;
  v_role text;
begin
  select company_id, role into v_company_id, v_role
  from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;

  if v_role is null or upper(v_role) not in ('SUPERADMIN', 'IT') then
    raise exception 'Only a Super Admin can change the weekly password reset setting';
  end if;

  update companies
  set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{weeklyPasswordResetEnabled}', to_jsonb(p_enabled))
  where id = v_company_id;
end;
$$;

-- set_flash_tech_open_alert_email (0434)
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

  if v_role is null or upper(v_role) not in ('ADMIN', 'SUPERADMIN', 'IT', 'HR', 'HR_MANAGER') then
    raise exception 'Only HR/Admin can set the Flash Tech alert recipient';
  end if;

  update companies
  set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{flashTechOpenAlertEmail}', to_jsonb(p_email))
  where id = v_company_id;
end;
$$;

-- set_notify_admins_coe (0090)
create or replace function set_notify_admins_coe(p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company_id uuid;
  v_role text;
begin
  select company_id, role into v_company_id, v_role
  from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;

  if v_role is null or upper(v_role) not in ('ADMIN', 'SUPERADMIN', 'IT') then
    raise exception 'Only an Admin can change notification settings';
  end if;

  update companies
  set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{notifyAdminsCoe}', to_jsonb(p_enabled))
  where id = v_company_id;
end;
$$;

-- set_notify_admins_tax_forms (0090)
create or replace function set_notify_admins_tax_forms(p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company_id uuid;
  v_role text;
begin
  select company_id, role into v_company_id, v_role
  from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;

  if v_role is null or upper(v_role) not in ('ADMIN', 'SUPERADMIN', 'IT') then
    raise exception 'Only an Admin can change notification settings';
  end if;

  update companies
  set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{notifyAdminsTaxForms}', to_jsonb(p_enabled))
  where id = v_company_id;
end;
$$;

-- set_notify_admins_warning_form (0090)
create or replace function set_notify_admins_warning_form(p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company_id uuid;
  v_role text;
begin
  select company_id, role into v_company_id, v_role
  from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;

  if v_role is null or upper(v_role) not in ('ADMIN', 'SUPERADMIN', 'IT') then
    raise exception 'Only an Admin can change notification settings';
  end if;

  update companies
  set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{notifyAdminsWarningForm}', to_jsonb(p_enabled))
  where id = v_company_id;
end;
$$;

-- policy messages.messages_insert (0434)
drop policy if exists messages_insert on messages;
create policy messages_insert on messages
  for insert with check (
    company_id = (select auth_company_id())
    and (
      is_announcement = false
      or exists (
        select 1 from profiles p
        where p.firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
          and p.role in ('SUPERADMIN', 'IT','ADMIN','MANAGER','HR','HR_MANAGER')
      )
    )
    and (
      channel_id is null
      or not exists (select 1 from message_channels mc where mc.id = messages.channel_id and mc.is_private = true)
      or can_access_private_channel(messages.channel_id)
    )
  );

-- policy technician_clock_out_checks.technician_clock_out_checks_select (0434)
drop policy if exists technician_clock_out_checks_select on technician_clock_out_checks;
create policy technician_clock_out_checks_select on technician_clock_out_checks
  for select using (
    company_id = (select auth_company_id())
    and exists (
      select 1 from profiles
      where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
        and (
          upper(role) in ('HR', 'HR_MANAGER', 'ADMIN', 'SUPERADMIN', 'IT', 'FINANCE', 'ACCOUNTING_MANAGER')
          or exists (select 1 from unnest(coalesce(extra_roles, '{}')) r where upper(r) in ('HR', 'HR_MANAGER', 'ADMIN', 'SUPERADMIN', 'IT', 'FINANCE', 'ACCOUNTING_MANAGER'))
        )
    )
  );

-- ---------------------------------------------------------------------
-- Only IT / Super Admin give or take away IT or Super Admin.
-- ---------------------------------------------------------------------
create or replace function profiles_guard_super_admin_roles()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_claims text := current_setting('request.jwt.claims', true);
  v_old text[] := '{}';
  v_new text[];
begin
  -- The SQL Editor and the server's service key aren't limited.
  if v_claims is null or v_claims = '' or (v_claims::json->>'role') = 'service_role' then
    return new;
  end if;
  if is_company_superadmin() or is_superadmin() then
    return new;
  end if;
  v_new := array(
    select distinct upper(regexp_replace(trim(r), '\s+', '_', 'g'))
    from unnest(array_append(coalesce(new.extra_roles, '{}'), new.role)) r
    where upper(regexp_replace(trim(coalesce(r, '')), '\s+', '_', 'g')) in ('SUPERADMIN', 'IT')
    order by 1
  );
  if tg_op = 'UPDATE' then
    v_old := array(
      select distinct upper(regexp_replace(trim(r), '\s+', '_', 'g'))
      from unnest(array_append(coalesce(old.extra_roles, '{}'), old.role)) r
      where upper(regexp_replace(trim(coalesce(r, '')), '\s+', '_', 'g')) in ('SUPERADMIN', 'IT')
      order by 1
    );
  end if;
  if v_new is distinct from v_old then
    raise exception 'Only IT or Super Admin can give someone the IT or Super Admin role, or take it away.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_guard_super_admin_roles on profiles;
create trigger trg_profiles_guard_super_admin_roles
  before insert or update of role, extra_roles on profiles
  for each row execute function profiles_guard_super_admin_roles();

notify pgrst, 'reload schema';
