-- =====================================================================
-- 0366 — Time In / Time Out corrections: Logistics (Parts) and the tech
-- side approve only their own people.
--
-- Until now the US approval chain ranked Branch Manager and every Parts role
-- on one shared "branch" level, so Senior Branch Managers approved Parts
-- Managers' corrections and Parts staff could approve technicians'. For the
-- MANAGER step of a timecard correction only (PTO / leave keep
-- chain_can_approve unchanged):
--
--   Parts Manager's correction            -> HR, Admin, SuperAdmin only
--   Parts / Parts Team Leader / Parts Order -> their branch's Parts Manager,
--                                              or HR, Admin, SuperAdmin
--   Technician's correction               -> as before, minus Parts roles
--                                              (BM same branch, owning SBM,
--                                              top level)
--   Everyone else (incl. the Philippines chain) -> unchanged
--
-- "Logistics" = holds a Parts role (Parts, Parts Team Leader, Parts Manager,
-- Parts Order) and the main role isn't a tech-side role — so a Technician
-- Manager who also holds Parts stays on the technician side.
--
-- Function and trigger changes only — no data is changed.
-- Run once in the Supabase SQL Editor, after 0365.
-- =====================================================================

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
  if v_roles && array['SUPERADMIN', 'SUPERSUPERADMIN', 'ADMIN', 'HR'] then return true; end if;
  if 'PARTS_MANAGER' = any(r_roles) then return false; -- a Parts Manager's: HR / Admin / SuperAdmin only
  end if;
  return 'PARTS_MANAGER' = any(v_roles)
    and chain_norm_branch(v.assigned_branch) = chain_norm_branch(r.assigned_branch);
end;
$$;

-- Manager step on timecard corrections now uses the correction-specific
-- check; same shape as chain_enforce_manager_stage (0332) otherwise.
create or replace function chain_enforce_correction_manager_stage()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth_profile_id();
  allowed boolean;
  is_staff boolean;
begin
  if me is null then return new; end if; -- server / service-role write
  if tg_op = 'UPDATE' and new.manager_status is not distinct from old.manager_status then return new; end if;
  if tg_op = 'INSERT' and coalesce(new.manager_status, 'pending') = 'pending' then return new; end if;

  allowed := chain_can_approve_correction(me, new.profile_id);
  if allowed is null then return new; end if; -- not governed — existing rules
  if allowed then return new; end if;

  -- HR / Admin may still reset a step back to pending, or file a request
  -- already approved on someone's behalf, as before.
  is_staff := is_hr() or is_admin() or is_company_superadmin() or is_superadmin();
  if is_staff and (new.manager_status = 'pending' or tg_op = 'INSERT') then return new; end if;

  raise exception 'Approval chain: you are not allowed to approve or reject this employee''s time correction at the Manager step.'
    using errcode = '42501';
end;
$$;

drop trigger if exists trg_chain_manager_stage on timecard_corrections;
create trigger trg_chain_manager_stage before insert or update on timecard_corrections
  for each row execute function chain_enforce_correction_manager_stage();
-- pto_requests keeps chain_enforce_manager_stage (unchanged).
