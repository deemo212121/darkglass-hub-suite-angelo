-- =====================================================================
-- 0290 — Named, browsable pay-period cut-offs for the Accounting
-- Dashboard's "Branch Commission" tab (src/components/
-- BranchManagerCommissionTab.tsx). A period here is a company-wide date
-- range (Start/End) that Finance can optionally name (e.g. "Sept Cutoff
-- 1") so it shows up in a History list and can be reopened later — the
-- per-person Completion %/LTP %/Completed Ticket values themselves stay
-- in branch_manager_commission_tally (0289), unchanged; this table is
-- just the shared label/registry for the cut-off itself, sitting above
-- that per-person data.
--
-- Company-scoped via RLS, company_id auto-stamped from the caller's
-- session — same pattern as branch_manager_commission_tally (0289).
-- Run once in the Supabase SQL Editor, after 0289.
-- =====================================================================

create table if not exists branch_manager_commission_periods (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  period_start  date not null,
  period_end    date not null,
  label         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, period_start, period_end)
);
create index if not exists idx_branch_manager_commission_periods_start on branch_manager_commission_periods(company_id, period_start);

-- ---------- Auto-stamp company_id, keep updated_at current ----------
create or replace function branch_manager_commission_periods_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_branch_manager_commission_periods_stamp on branch_manager_commission_periods;
create trigger trg_branch_manager_commission_periods_stamp before insert or update on branch_manager_commission_periods
  for each row execute function branch_manager_commission_periods_stamp();

-- ---------- RLS: company-scoped, same pattern as branch_manager_commission_tally (0289) ----------
alter table branch_manager_commission_periods enable row level security;
alter table branch_manager_commission_periods force row level security;

drop policy if exists branch_manager_commission_periods_select on branch_manager_commission_periods;
create policy branch_manager_commission_periods_select on branch_manager_commission_periods
  for select using (company_id = auth_company_id() or is_superadmin());
drop policy if exists branch_manager_commission_periods_insert on branch_manager_commission_periods;
create policy branch_manager_commission_periods_insert on branch_manager_commission_periods
  for insert with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists branch_manager_commission_periods_update on branch_manager_commission_periods;
create policy branch_manager_commission_periods_update on branch_manager_commission_periods
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists branch_manager_commission_periods_delete on branch_manager_commission_periods;
create policy branch_manager_commission_periods_delete on branch_manager_commission_periods
  for delete using (company_id = auth_company_id() or is_superadmin());
