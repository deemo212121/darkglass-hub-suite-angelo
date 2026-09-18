-- =====================================================================
-- 0283 — Senior Branch Manager → Branch assignments.
--
-- Backs the new "Branch Daily Report" (0284): which branches a given
-- Senior Branch Manager is responsible for reviewing/updating. A Senior
-- Branch Manager can own several branches; a branch has at most one
-- owning Senior Branch Manager at a time (re-assigning just replaces the
-- row via the unique constraint below).
--
-- Assignment is HR-and-above only (is_hr()/is_admin()/is_superadmin()/
-- is_company_superadmin()) — everyone else may only read it, since the
-- Branch Daily Report page needs it to group branches by manager and to
-- compute who's allowed to edit which branch's report.
--
-- Run once in the Supabase SQL Editor, after 0282.
-- =====================================================================

create table if not exists senior_branch_manager_branches (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  profile_id   uuid not null references profiles(id) on delete cascade,
  branch       text not null,
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now(),
  unique (company_id, branch)
);
create index if not exists idx_sbm_branches_profile on senior_branch_manager_branches(profile_id);
create index if not exists idx_sbm_branches_company on senior_branch_manager_branches(company_id);

create or replace function senior_branch_manager_branches_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  if new.created_by is null then
    new.created_by := auth_profile_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sbm_branches_stamp on senior_branch_manager_branches;
create trigger trg_sbm_branches_stamp before insert on senior_branch_manager_branches
  for each row execute function senior_branch_manager_branches_stamp();

-- ---------- RLS ----------
alter table senior_branch_manager_branches enable row level security;
alter table senior_branch_manager_branches force row level security;

drop policy if exists sbm_branches_select on senior_branch_manager_branches;
create policy sbm_branches_select on senior_branch_manager_branches
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists sbm_branches_insert on senior_branch_manager_branches;
create policy sbm_branches_insert on senior_branch_manager_branches
  for insert with check (
    (company_id = auth_company_id() or is_superadmin())
    and (is_hr() or is_admin() or is_company_superadmin() or is_superadmin())
  );

drop policy if exists sbm_branches_delete on senior_branch_manager_branches;
create policy sbm_branches_delete on senior_branch_manager_branches
  for delete using (
    (company_id = auth_company_id() or is_superadmin())
    and (is_hr() or is_admin() or is_company_superadmin() or is_superadmin())
  );
