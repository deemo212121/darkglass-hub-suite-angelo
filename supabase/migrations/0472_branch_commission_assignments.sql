-- =====================================================================
-- 0472 — Branch Commission: pick a branch's manager, move a technician.
--
-- Used only by the Accounting Dashboard's "Branch Commission" tab
-- (src/components/BranchManagerCommissionTab.tsx). Nothing else reads
-- these tables — profiles' Assigned Branch and the Approval Chain stay as
-- they are.
--
-- branch_commission_branch_managers
--   One row per branch: the Branch Manager / Senior Branch Manager whose
--   commission that branch counts toward, instead of the one worked out
--   from Assigned Branch + Approval Chain. No row = worked out as before.
--
-- branch_commission_tech_branches
--   One row per technician: the branch their numbers count under, instead
--   of their profile's Assigned Branch. No row = their Assigned Branch.
--
-- branch_key is the same match rule as everywhere else
-- (src/lib/branchName.ts branchMatchKey / chain_norm_branch, 0471).
-- Same company scoping / RLS as 0417. Run once in the Supabase SQL Editor.
-- =====================================================================

create table if not exists branch_commission_branch_managers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  branch_key  text not null,
  branch      text not null,
  profile_id  uuid not null references profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, branch_key)
);

create table if not exists branch_commission_tech_branches (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  profile_id  uuid not null references profiles(id) on delete cascade,
  branch_key  text not null,
  branch      text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, profile_id)
);

create or replace function branch_commission_assignment_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_branch_commission_branch_managers_stamp on branch_commission_branch_managers;
create trigger trg_branch_commission_branch_managers_stamp before insert or update on branch_commission_branch_managers
  for each row execute function branch_commission_assignment_stamp();
drop trigger if exists trg_branch_commission_tech_branches_stamp on branch_commission_tech_branches;
create trigger trg_branch_commission_tech_branches_stamp before insert or update on branch_commission_tech_branches
  for each row execute function branch_commission_assignment_stamp();

alter table branch_commission_branch_managers enable row level security;
alter table branch_commission_branch_managers force row level security;
alter table branch_commission_tech_branches enable row level security;
alter table branch_commission_tech_branches force row level security;

drop policy if exists branch_commission_branch_managers_select on branch_commission_branch_managers;
create policy branch_commission_branch_managers_select on branch_commission_branch_managers
  for select using (company_id = auth_company_id() or is_superadmin());
drop policy if exists branch_commission_branch_managers_insert on branch_commission_branch_managers;
create policy branch_commission_branch_managers_insert on branch_commission_branch_managers
  for insert with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists branch_commission_branch_managers_update on branch_commission_branch_managers;
create policy branch_commission_branch_managers_update on branch_commission_branch_managers
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists branch_commission_branch_managers_delete on branch_commission_branch_managers;
create policy branch_commission_branch_managers_delete on branch_commission_branch_managers
  for delete using (company_id = auth_company_id() or is_superadmin());

drop policy if exists branch_commission_tech_branches_select on branch_commission_tech_branches;
create policy branch_commission_tech_branches_select on branch_commission_tech_branches
  for select using (company_id = auth_company_id() or is_superadmin());
drop policy if exists branch_commission_tech_branches_insert on branch_commission_tech_branches;
create policy branch_commission_tech_branches_insert on branch_commission_tech_branches
  for insert with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists branch_commission_tech_branches_update on branch_commission_tech_branches;
create policy branch_commission_tech_branches_update on branch_commission_tech_branches
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists branch_commission_tech_branches_delete on branch_commission_tech_branches;
create policy branch_commission_tech_branches_delete on branch_commission_tech_branches
  for delete using (company_id = auth_company_id() or is_superadmin());
