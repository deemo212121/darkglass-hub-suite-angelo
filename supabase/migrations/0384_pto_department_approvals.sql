-- =====================================================================
-- 0384 — PTO / leave requests: the Manager step follows the company's two
-- lines, each approving only its own people.
--
--   Tech side:  Tech Director > Tech Asst. Director > SBM > BM > Technician
--     Technician          -> BM of the same branch, the SBM owning the
--                            branch, Tech Asst. Director, Tech Director
--     Branch Manager      -> owning SBM, Asst. Director, Director
--     Senior Branch Mgr   -> Asst. Director, Director
--     Tech Asst. Director -> Tech Director
--     Tech Director       -> SuperAdmin only
--   Parts side: Parts head (Naveen Lakhani) > Parts Manager > Parts
--     Parts / Parts Team Leader / Parts Order -> their branch's Parts
--                            Manager, or a Parts head
--     Parts Manager       -> a Parts head
--
-- Until now pto_requests used chain_can_approve (0332), which put Branch
-- Managers and every Parts role on one shared "branch" level and let the
-- 12-person top-approver list (Admins, HR, BizOps, Finance…) approve
-- anyone — e.g. Matt Simmons (SBM over Columbus) approved Amanda Simmons's
-- (Columbus Parts) leave. Admin / HR / the top list no longer approve at the
-- Manager step on these two lines (HR keeps its own stage, and any 2 of the
-- 3 stages still decide a leave — 0335); SuperAdmin always can. The
-- Philippines chain and everyone outside these two lines are unchanged.
-- Time corrections keep their own rule (0366).
--
--   1. approval_chain_parts_heads — the top of the Parts line (company-
--      scoped list like approval_chain_top_approvers), seeded with Naveen.
--   2. chain_can_approve_pto(viewer, requester).
--   3. pto_requests' Manager-step trigger uses it.
--
-- Adds one table and its one row (Naveen as Parts head); otherwise function
-- and trigger changes only — no existing data is changed. Safe to run twice.
-- Run once in the Supabase SQL Editor, after 0383.
-- =====================================================================

create table if not exists approval_chain_parts_heads (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  profile_id  uuid not null references profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (company_id, profile_id)
);

create or replace function approval_chain_parts_heads_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_approval_chain_parts_heads_stamp on approval_chain_parts_heads;
create trigger trg_approval_chain_parts_heads_stamp before insert on approval_chain_parts_heads
  for each row execute function approval_chain_parts_heads_stamp();

alter table approval_chain_parts_heads enable row level security;
alter table approval_chain_parts_heads force row level security;
drop policy if exists approval_chain_parts_heads_select on approval_chain_parts_heads;
create policy approval_chain_parts_heads_select on approval_chain_parts_heads
  for select using (company_id = auth_company_id() or is_superadmin());
drop policy if exists approval_chain_parts_heads_insert on approval_chain_parts_heads;
create policy approval_chain_parts_heads_insert on approval_chain_parts_heads
  for insert with check ((company_id = auth_company_id() or is_superadmin()) and (is_admin() or is_company_superadmin() or is_superadmin()));
drop policy if exists approval_chain_parts_heads_delete on approval_chain_parts_heads;
create policy approval_chain_parts_heads_delete on approval_chain_parts_heads
  for delete using ((company_id = auth_company_id() or is_superadmin()) and (is_admin() or is_company_superadmin() or is_superadmin()));

-- Naveen Lakhani — head of Logistics / Parts.
insert into approval_chain_parts_heads (company_id, profile_id)
select company_id, id from profiles where id = 'bec83133-0de3-4fa6-8174-f6aa1b04d3e8'
on conflict (company_id, profile_id) do nothing;

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
    and upper(coalesce(r.role, '')) not in ('ADMIN', 'SUPERADMIN', 'SUPERSUPERADMIN');
  r_level := case when is_logistics then null else chain_level_held(r.role, r.extra_roles) end;
  if not is_logistics and r_level is null then return null; end if; -- not on either line

  select * into v from profiles where id = p_viewer;
  if not found or v.company_id <> r.company_id or v.id = r.id then return false; end if;
  v_roles := array(select upper(x) from unnest(array_append(coalesce(v.extra_roles, '{}'), v.role)) x where x is not null);
  if v_roles && array['SUPERADMIN', 'SUPERSUPERADMIN'] then return true; end if;
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

create or replace function chain_enforce_pto_manager_stage()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth_profile_id();
  allowed boolean;
  is_staff boolean;
begin
  if me is null then return new; end if; -- server / service-role write
  if tg_op = 'UPDATE' and new.manager_status is not distinct from old.manager_status then return new; end if;
  if tg_op = 'INSERT' and coalesce(new.manager_status, 'pending') = 'pending' then return new; end if;

  allowed := chain_can_approve_pto(me, new.profile_id);
  if allowed is null then return new; end if; -- not on either line — existing rules
  if allowed then return new; end if;

  -- HR / Admin may still reset a step back to pending, or file a request
  -- already approved on someone's behalf (HR Calendar), as before.
  is_staff := is_hr() or is_admin() or is_company_superadmin() or is_superadmin();
  if is_staff and (new.manager_status = 'pending' or tg_op = 'INSERT') then return new; end if;

  raise exception 'Approval chain: you are not allowed to approve or reject this employee''s leave request at the Manager step — only their own line (Tech Director > Tech Asst. Director > SBM > BM, or Parts head > Parts Manager) can.'
    using errcode = '42501';
end;
$$;

drop trigger if exists trg_chain_manager_stage on pto_requests;
create trigger trg_chain_manager_stage before insert or update on pto_requests
  for each row execute function chain_enforce_pto_manager_stage();
