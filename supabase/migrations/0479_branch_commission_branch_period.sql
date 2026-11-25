-- =====================================================================
-- 0479 (Angelo's 0473, renumbered) — Branch Commission: per branch, per pay period.
--
-- One row per branch per period on the Accounting Dashboard's "Branch
-- Commission" tab (src/components/BranchManagerCommissionTab.tsx):
--
--   flash_tech        Yes / No (blank = not set) — reference only
--   damages           Yes / No (blank = not set) — reference only
--   damage_count      total damages in the area (blank = not set)
--   tickets_override  the branch's ticket count when Finance keeps it per
--                     branch (their sheet's "24*10"); used instead of the
--                     technicians' tickets added up. Blank = add them up.
--   note              e.g. the sheet's Review status ("Confirm branch")
--   paid_at / paid_by / paid_by_name
--                     Mark as Paid. While set, the tab locks that branch's
--                     numbers for the period. Monitoring only — nothing is
--                     sent to payroll.
--
-- branch_key = src/lib/branchName.ts branchMatchKey (same as 0474 / 0476 here).
-- Same company scoping / RLS as 0417. New table only — no existing data is
-- changed. Run once in the Supabase SQL Editor. Safe to run again.
-- =====================================================================

create table if not exists branch_commission_branch_period (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  branch_key        text not null,
  branch            text not null,
  period_start      date not null,
  period_end        date not null,
  flash_tech        boolean,
  damages           boolean,
  damage_count      integer check (damage_count is null or damage_count >= 0),
  tickets_override  integer check (tickets_override is null or tickets_override >= 0),
  note              text,
  paid_at           timestamptz,
  paid_by           uuid references profiles(id) on delete set null,
  paid_by_name      text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, branch_key, period_start, period_end)
);
create index if not exists idx_branch_commission_branch_period_period
  on branch_commission_branch_period(company_id, period_start, period_end);

create or replace function branch_commission_branch_period_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_branch_commission_branch_period_stamp on branch_commission_branch_period;
create trigger trg_branch_commission_branch_period_stamp before insert or update on branch_commission_branch_period
  for each row execute function branch_commission_branch_period_stamp();

alter table branch_commission_branch_period enable row level security;
alter table branch_commission_branch_period force row level security;

drop policy if exists branch_commission_branch_period_select on branch_commission_branch_period;
create policy branch_commission_branch_period_select on branch_commission_branch_period
  for select using (company_id = auth_company_id() or is_superadmin());
drop policy if exists branch_commission_branch_period_insert on branch_commission_branch_period;
create policy branch_commission_branch_period_insert on branch_commission_branch_period
  for insert with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists branch_commission_branch_period_update on branch_commission_branch_period;
create policy branch_commission_branch_period_update on branch_commission_branch_period
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists branch_commission_branch_period_delete on branch_commission_branch_period;
create policy branch_commission_branch_period_delete on branch_commission_branch_period
  for delete using (company_id = auth_company_id() or is_superadmin());

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Imports (Branch Commission → Import): what each import wrote over, so
-- it can be reverted later. snapshot = { periods, techs, branches } with
-- each row's values from before the import (null = the row was new).
-- ---------------------------------------------------------------------
create table if not exists branch_commission_imports (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  file_name         text,
  imported_by_name  text,
  imported_at       timestamptz not null default now(),
  lines             integer not null default 0,
  snapshot          jsonb not null default '{}'::jsonb,
  reverted_at       timestamptz,
  reverted_by_name  text,
  updated_at        timestamptz not null default now()
);
create index if not exists idx_branch_commission_imports_company on branch_commission_imports(company_id, imported_at desc);

drop trigger if exists trg_branch_commission_imports_stamp on branch_commission_imports;
create trigger trg_branch_commission_imports_stamp before insert or update on branch_commission_imports
  for each row execute function branch_commission_branch_period_stamp();

alter table branch_commission_imports enable row level security;
alter table branch_commission_imports force row level security;

drop policy if exists branch_commission_imports_select on branch_commission_imports;
create policy branch_commission_imports_select on branch_commission_imports
  for select using (company_id = auth_company_id() or is_superadmin());
drop policy if exists branch_commission_imports_insert on branch_commission_imports;
create policy branch_commission_imports_insert on branch_commission_imports
  for insert with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists branch_commission_imports_update on branch_commission_imports;
create policy branch_commission_imports_update on branch_commission_imports
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());

notify pgrst, 'reload schema';
