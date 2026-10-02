-- =====================================================================
-- 0340 — The Approval Chain's top level can clock in technicians at every
-- branch.
--
-- Everyone on the top level (Approval Chain page → "Top level", the custom
-- list from 0336 / chain_is_top) can now use mobile Clock In Team for any
-- branch's technicians and branch staff — not only the roles that already
-- could (Admin / HR / Finance / Technical Director / Asst. Director).
-- Same rule as before for everyone else.
--
-- Run once in the Supabase SQL Editor, after 0339.
-- =====================================================================

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
  -- New: the top level clocks in at every branch.
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
