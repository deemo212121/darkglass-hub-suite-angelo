-- =====================================================================
-- 0120 — Tech Payroll piece rates (per repair type, optionally per branch)
--
-- Backs the "Tech Payroll" split on AccountingDashboard.tsx's Payroll tab:
-- technicians are paid per completed repair ticket instead of hourly, at a
-- rate looked up by the visit's repair_type (and branch, if a branch-
-- specific override exists — otherwise the repair_type's company-wide
-- rate applies to every branch). repair_type = 'Default Amount' is the
-- fallback rate used when a completed visit has no repair_type set.
--
-- Edited from TechPayrollSetup.tsx's "Payroll Amount" tab, which used to be
-- a disconnected UI mockup with nothing persisted.
--
-- Same company-scoped RLS pattern as csr_teams (0027).
-- Run once in the Supabase SQL Editor, after 0119.
-- =====================================================================

create table if not exists tech_repair_rates (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  repair_type text not null,
  -- null = applies to every branch; a specific branch name overrides the
  -- null-branch rate for that same repair_type.
  branch      text,
  amount      numeric not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_tech_repair_rates_company on tech_repair_rates(company_id);

create or replace function tech_repair_rates_stamp_company()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tech_repair_rates_stamp on tech_repair_rates;
create trigger trg_tech_repair_rates_stamp before insert on tech_repair_rates
  for each row execute function tech_repair_rates_stamp_company();

alter table tech_repair_rates enable row level security;
alter table tech_repair_rates force row level security;

drop policy if exists tech_repair_rates_select on tech_repair_rates;
create policy tech_repair_rates_select on tech_repair_rates
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists tech_repair_rates_insert on tech_repair_rates;
create policy tech_repair_rates_insert on tech_repair_rates
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists tech_repair_rates_update on tech_repair_rates;
create policy tech_repair_rates_update on tech_repair_rates
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists tech_repair_rates_delete on tech_repair_rates;
create policy tech_repair_rates_delete on tech_repair_rates
  for delete using (company_id = auth_company_id() or is_superadmin());
