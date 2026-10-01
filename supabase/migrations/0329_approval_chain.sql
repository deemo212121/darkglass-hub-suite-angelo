-- =====================================================================
-- 0329 — Approval Chain: role + area/branch based approval routing,
-- enforced in the database (not just hidden buttons).
--
-- Reuses what already exists:
--   profiles.role / extra_roles / assigned_branch  — who someone is & where
--   senior_branch_manager_branches (0283)          — which Senior Branch
--       Manager owns which branch (also drives Branch Daily Report)
--   timecard_corrections / pto_requests            — the requests (Manager /
--       HR / Accounting steps, 2-of-3 quorum unchanged)
--   timecard_entries.clocked_in_by (0076)          — proxy clock-ins
-- Adds only:
--   approval_areas — a named Area owned by one Senior Branch Manager. An
--       area's branches are that SBM's rows in senior_branch_manager_branches
--       (no second copy of "who owns which branch").
--   chain_* functions + triggers below.
--
-- Scope: NON-Philippines staff holding these roles (primary OR extra role —
-- the highest one decides the level) (PH and every other
-- department keep their existing rules — the functions return NULL = "not
-- governed" for them and the triggers let those writes through unchanged):
--   tech level    TECHNICIAN, TECHNICIAN_MANAGER
--   branch level  BRANCH_MANAGER, PARTS_MANAGER, PARTS_TEAM_LEADER, PARTS
--   SENIOR_BRANCH_MANAGER, TECHNICAL_ASSISTANT_DIRECTOR, TECHNICAL_DIRECTOR
--
-- Manager step approvers (any one; SuperAdmin always; never your own):
--   tech   → Branch Manager / Parts / Parts Team Leader / Parts Manager at the same branch,
--            the SBM owning the branch, Admin / Technical Director / ATD
--   branch → the SBM owning the branch, Admin / TD / ATD
--   SBM    → Admin / TD / ATD
--   ATD    → Technical Director / Admin;  TD → Admin
-- Proxy Clock In:
--   tech   → Parts / Parts Team Leader / Parts Manager / Branch Manager at the same branch, the
--            owning SBM, HR / Finance / Admin / TD / ATD
--   branch → owning SBM, HR / Finance / Admin / TD / ATD
--   SBM / directors → HR / Finance / Admin / TD / ATD
-- Branch names compare loosely ("Jackson,MS" = "Jackson, MS").
--
-- Service-role / server writes (no signed-in user) are never blocked.
--
-- Run once in the Supabase SQL Editor, after 0328.
-- =====================================================================

-- ---------- Areas ------------------------------------------------------
create table if not exists approval_areas (
  id                        uuid primary key default gen_random_uuid(),
  company_id                uuid not null references companies(id) on delete cascade,
  name                      text not null,
  senior_branch_manager_id  uuid references profiles(id) on delete set null,
  sort_order                int not null default 0,
  created_at                timestamptz not null default now(),
  unique (company_id, name)
);
create unique index if not exists idx_approval_areas_one_per_sbm
  on approval_areas(company_id, senior_branch_manager_id) where senior_branch_manager_id is not null;

create or replace function approval_areas_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_approval_areas_stamp on approval_areas;
create trigger trg_approval_areas_stamp before insert on approval_areas
  for each row execute function approval_areas_stamp();

alter table approval_areas enable row level security;
alter table approval_areas force row level security;
drop policy if exists approval_areas_select on approval_areas;
create policy approval_areas_select on approval_areas
  for select using (company_id = auth_company_id() or is_superadmin());
drop policy if exists approval_areas_insert on approval_areas;
create policy approval_areas_insert on approval_areas
  for insert with check ((company_id = auth_company_id() or is_superadmin()) and (is_admin() or is_company_superadmin() or is_superadmin()));
drop policy if exists approval_areas_update on approval_areas;
create policy approval_areas_update on approval_areas
  for update using ((company_id = auth_company_id() or is_superadmin()) and (is_admin() or is_company_superadmin() or is_superadmin()))
  with check ((company_id = auth_company_id() or is_superadmin()) and (is_admin() or is_company_superadmin() or is_superadmin()));
drop policy if exists approval_areas_delete on approval_areas;
create policy approval_areas_delete on approval_areas
  for delete using ((company_id = auth_company_id() or is_superadmin()) and (is_admin() or is_company_superadmin() or is_superadmin()));

-- ---------- Helpers -----------------------------------------------------
create or replace function chain_norm_branch(b text)
returns text language sql immutable as $$
  select nullif(lower(regexp_replace(trim(coalesce(b, '')), '\s*,\s*', ', ', 'g')), '');
$$;

create or replace function chain_level(p_role text)
returns text language sql immutable as $$
  select case upper(coalesce(p_role, ''))
    when 'TECHNICIAN' then 'tech'
    when 'TECHNICIAN_MANAGER' then 'tech'
    when 'BRANCH_MANAGER' then 'branch'
    when 'PARTS_MANAGER' then 'branch'
    when 'PARTS_TEAM_LEADER' then 'branch'
    when 'PARTS' then 'branch'
    when 'SENIOR_BRANCH_MANAGER' then 'sbm'
    when 'TECHNICAL_ASSISTANT_DIRECTOR' then 'atd'
    when 'TECHNICAL_DIRECTOR' then 'td'
    else null
  end;
$$;

/**
 * A person's chain level from ALL roles they hold (primary + extra_roles),
 * highest wins — e.g. a Parts Team Leader who also holds Parts Manager is
 * branch level. Admin / SuperAdmin as the primary role is never governed.
 */
create or replace function chain_level_held(p_role text, p_extra text[])
returns text language sql immutable as $$
  select case
    when upper(coalesce(p_role, '')) in ('ADMIN', 'SUPERADMIN', 'SUPERSUPERADMIN') then null
    else (
      select l from (select chain_level(x) as l from unnest(array_append(coalesce(p_extra, '{}'), p_role)) x) s
      where l is not null
      order by case l when 'td' then 5 when 'atd' then 4 when 'sbm' then 3 when 'branch' then 2 else 1 end desc
      limit 1
    )
  end;
$$;

/** True when the SBM owns this (normalized) branch in the requester's company. */
create or replace function chain_owns_branch(p_sbm uuid, p_company uuid, p_branch text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from senior_branch_manager_branches s
    where s.company_id = p_company and s.profile_id = p_sbm
      and chain_norm_branch(s.branch) = chain_norm_branch(p_branch)
  );
$$;

/**
 * Can p_viewer act on p_requester's Manager step?
 * NULL = requester isn't governed by the chain (PH / other department) —
 * callers keep their existing rules for those.
 */
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
  r_level := chain_level_held(r.role, r.extra_roles);
  if r_level is null or chain_norm_branch(r.assigned_branch) = 'philippines' then return null; end if;

  select * into v from profiles where id = p_viewer;
  if not found or v.company_id <> r.company_id or v.id = r.id then return false; end if;
  v_roles := array(select upper(x) from unnest(array_append(coalesce(v.extra_roles, '{}'), v.role)) x where x is not null);

  if v_roles && array['SUPERADMIN', 'SUPERSUPERADMIN'] then return true; end if;
  v_top := v_roles && array['ADMIN', 'TECHNICAL_DIRECTOR', 'TECHNICAL_ASSISTANT_DIRECTOR'];

  if r_level = 'tech' then
    return v_top
      or (v_roles && array['BRANCH_MANAGER', 'PARTS_MANAGER', 'PARTS_TEAM_LEADER', 'PARTS'] and chain_norm_branch(v.assigned_branch) = chain_norm_branch(r.assigned_branch))
      or chain_owns_branch(v.id, r.company_id, r.assigned_branch);
  elsif r_level = 'branch' then
    return v_top or chain_owns_branch(v.id, r.company_id, r.assigned_branch);
  elsif r_level = 'sbm' then
    return v_top;
  elsif r_level = 'atd' then
    return v_roles && array['ADMIN', 'TECHNICAL_DIRECTOR'];
  else -- 'td'
    return 'ADMIN' = any(v_roles);
  end if;
end;
$$;

/** Can p_viewer proxy Clock In p_target? NULL = target not governed. */
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

  if v_roles && array['SUPERADMIN', 'SUPERSUPERADMIN', 'ADMIN', 'HR', 'FINANCE', 'TECHNICAL_DIRECTOR', 'TECHNICAL_ASSISTANT_DIRECTOR'] then return true; end if;
  if t_level = 'tech' then
    return (v_roles && array['PARTS', 'PARTS_TEAM_LEADER', 'PARTS_MANAGER', 'BRANCH_MANAGER'] and chain_norm_branch(v.assigned_branch) = chain_norm_branch(t.assigned_branch))
      or chain_owns_branch(v.id, t.company_id, t.assigned_branch);
  elsif t_level = 'branch' then
    return chain_owns_branch(v.id, t.company_id, t.assigned_branch);
  end if;
  return false;
end;
$$;

-- ---------- Enforcement: Manager step on corrections / PTO -------------
create or replace function chain_enforce_manager_stage()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth_profile_id();
  allowed boolean;
  is_staff boolean;
begin
  if me is null then return new; end if; -- server / service-role write
  if tg_op = 'UPDATE' and new.manager_status is not distinct from old.manager_status then return new; end if;
  if tg_op = 'INSERT' and coalesce(new.manager_status, 'pending') = 'pending' then return new; end if;

  allowed := chain_can_approve(me, new.profile_id);
  if allowed is null then return new; end if; -- not governed — existing rules
  if allowed then return new; end if;

  -- HR / Admin may still reset a step back to pending, or file a request
  -- already approved on someone's behalf (HR Calendar), as before.
  is_staff := is_hr() or is_admin() or is_company_superadmin() or is_superadmin();
  if is_staff and (new.manager_status = 'pending' or tg_op = 'INSERT') then return new; end if;

  raise exception 'Approval chain: you are not allowed to approve or reject this employee''s request at the Manager step.'
    using errcode = '42501';
end;
$$;

drop trigger if exists trg_chain_manager_stage on timecard_corrections;
create trigger trg_chain_manager_stage before insert or update on timecard_corrections
  for each row execute function chain_enforce_manager_stage();

drop trigger if exists trg_chain_manager_stage on pto_requests;
create trigger trg_chain_manager_stage before insert or update on pto_requests
  for each row execute function chain_enforce_manager_stage();

-- ---------- Enforcement: proxy Clock In ---------------------------------
create or replace function chain_enforce_clock_in()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth_profile_id();
  allowed boolean;
begin
  if me is null then return new; end if;
  if new.clocked_in_by is null or new.clocked_in_by = new.profile_id then return new; end if;
  if tg_op = 'UPDATE' and new.clocked_in_by is not distinct from old.clocked_in_by then return new; end if;

  -- Nobody may stamp a clock-in as someone else.
  if new.clocked_in_by <> me and not (is_superadmin() or is_company_superadmin()) then
    raise exception 'Approval chain: a clock-in can only be recorded under your own name.' using errcode = '42501';
  end if;

  allowed := chain_can_clock_in(me, new.profile_id);
  if allowed is null or allowed then return new; end if;
  raise exception 'Approval chain: you are not allowed to clock in this employee.' using errcode = '42501';
end;
$$;

drop trigger if exists trg_chain_clock_in on timecard_entries;
create trigger trg_chain_clock_in before insert or update on timecard_entries
  for each row execute function chain_enforce_clock_in();
