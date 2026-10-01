-- =====================================================================
-- 0333 — Editable top level of the Approval Chain.
--
-- 0329 decided the top level ("approves Senior Branch Managers and everyone
-- below") from roles: anyone holding Admin / Technical Director / Technical
-- Assistant Director — which also pulled in HR and Accounting staff who hold
-- Admin as an extra role. This lets an Admin pick the top level explicitly
-- on Admin → Approval Chain:
--   - list has people  → only they (plus SuperAdmin) are top level
--   - list is empty    → the role-based rule from 0329, unchanged
-- A Technical Director's or Asst. Director's own request goes to anyone else
-- on the list (never themselves).
--
-- Run once in the Supabase SQL Editor, after 0332 (needs 0329).
-- =====================================================================

create table if not exists approval_chain_top_approvers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  profile_id  uuid not null references profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (company_id, profile_id)
);

create or replace function approval_chain_top_approvers_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_approval_chain_top_approvers_stamp on approval_chain_top_approvers;
create trigger trg_approval_chain_top_approvers_stamp before insert on approval_chain_top_approvers
  for each row execute function approval_chain_top_approvers_stamp();

alter table approval_chain_top_approvers enable row level security;
alter table approval_chain_top_approvers force row level security;
drop policy if exists approval_chain_top_approvers_select on approval_chain_top_approvers;
create policy approval_chain_top_approvers_select on approval_chain_top_approvers
  for select using (company_id = auth_company_id() or is_superadmin());
drop policy if exists approval_chain_top_approvers_insert on approval_chain_top_approvers;
create policy approval_chain_top_approvers_insert on approval_chain_top_approvers
  for insert with check ((company_id = auth_company_id() or is_superadmin()) and (is_admin() or is_company_superadmin() or is_superadmin()));
drop policy if exists approval_chain_top_approvers_delete on approval_chain_top_approvers;
create policy approval_chain_top_approvers_delete on approval_chain_top_approvers
  for delete using ((company_id = auth_company_id() or is_superadmin()) and (is_admin() or is_company_superadmin() or is_superadmin()));

/** Is p_viewer top level in p_company? The explicit list when it has anyone, else the 0329 role rule. */
create or replace function chain_is_top(p_viewer uuid, p_company uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from approval_chain_top_approvers t where t.company_id = p_company)
      then exists (select 1 from approval_chain_top_approvers t where t.company_id = p_company and t.profile_id = p_viewer)
    else p_roles && array['ADMIN', 'TECHNICAL_DIRECTOR', 'TECHNICAL_ASSISTANT_DIRECTOR']
  end;
$$;

create or replace function chain_has_top_list(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from approval_chain_top_approvers t where t.company_id = p_company);
$$;

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
    -- Directors: anyone else on the top-level list.
    return v_top;
  elsif r_level = 'atd' then
    return v_roles && array['ADMIN', 'TECHNICAL_DIRECTOR'];
  else -- 'td'
    return 'ADMIN' = any(v_roles);
  end if;
end;
$$;
