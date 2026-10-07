-- =====================================================================
-- 0338 — Approval Chain helper fix.
--
-- 0332 (Approval Chain; Angelo's 0329) was updated after it was first run (Parts / Parts Team Leader at
-- branch level, and levels taken from ALL held roles via
-- chain_level_held). Databases that ran the ORIGINAL 0332 are missing
-- chain_level_held — so 0336/0337's chain_can_approve fails with
-- "function chain_level_held(text, text[]) does not exist" and every
-- Manager-step approve/reject errors out (SuperAdmin included).
--
-- This re-creates the current versions of the helpers 0332 defines. Safe
-- to run more than once and on a database that already has them.
--
-- Run once in the Supabase SQL Editor, after 0337. Not needed on the live database (checked 2026-10-01: chain_level_held already exists); safe to run anyway.
-- =====================================================================

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

/** Level from ALL held roles (primary + extra_roles), highest wins; Admin / SuperAdmin as the primary role is never governed. */
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
