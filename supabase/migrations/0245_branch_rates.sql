-- =====================================================================
-- 0245 — Branch Rates
--
-- Backs the "Branch Rates" tab on AccountingDashboard.tsx: a reference
-- table letting Finance/Admin set one $ rate per branch (no calculation
-- reads it yet — purely a reference value the accountant maintains, per
-- the request that added this tab). One row per (company, branch), same
-- unique-per-branch shape as 0121_branch_role_schedules.sql, but with the
-- simpler company-scoped RLS of 0120_tech_repair_rates.sql (not the
-- stricter ADMIN/SUPERADMIN-only branch_role_schedules gate) since this is
-- Accounting Dashboard data — FINANCE, not just ADMIN, needs to write it,
-- matching tech_repair_rates' own access pattern for the same dashboard.
--
-- Run once in the Supabase SQL Editor, after 0244.
-- =====================================================================

create table if not exists branch_rates (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  branch      text not null,
  rate        numeric not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, branch)
);

create index if not exists idx_branch_rates_company on branch_rates(company_id);

create or replace function branch_rates_stamp_and_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' and new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_branch_rates_stamp on branch_rates;
create trigger trg_branch_rates_stamp before insert or update on branch_rates
  for each row execute function branch_rates_stamp_and_touch();

alter table branch_rates enable row level security;
alter table branch_rates force row level security;

drop policy if exists branch_rates_select on branch_rates;
create policy branch_rates_select on branch_rates
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists branch_rates_insert on branch_rates;
create policy branch_rates_insert on branch_rates
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists branch_rates_update on branch_rates;
create policy branch_rates_update on branch_rates
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists branch_rates_delete on branch_rates;
create policy branch_rates_delete on branch_rates
  for delete using (company_id = auth_company_id() or is_superadmin());
