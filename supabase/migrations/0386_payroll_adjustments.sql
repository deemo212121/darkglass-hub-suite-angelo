-- =====================================================================
-- 0386 — Payroll adjustments: reimbursements and deductions.
--
-- Accounting → Payroll's employee popup gets an "Adjustments" section for
-- PH payroll (everyone) and US Office staff (Parts Manager, Parts Team
-- Leader, Parts, Accounting, Admin-level) — not technicians, who have their own custom
-- pay lines (tech_custom_pay_items). Each line belongs to one employee and
-- one pay period:
--   kind = 'reimbursement' (+) or 'deduction' (−), a description, an amount.
-- Net pay = gross pay + reimbursements − deductions. Generate Payroll stores
-- the lines in payroll_line_items.breakdown and the totals in deductions /
-- net_pay; the payslip lists each line.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

create table if not exists payroll_adjustments (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  profile_id    uuid not null references profiles(id) on delete cascade,
  period_start  date not null,
  period_end    date not null,
  kind          text not null check (kind in ('reimbursement', 'deduction')),
  description   text not null default '',
  amount        numeric(12,2) not null default 0 check (amount >= 0),
  created_by_name text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_payroll_adjustments_period on payroll_adjustments(company_id, period_start, period_end);

create or replace function payroll_adjustments_stamp_and_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_payroll_adjustments_stamp on payroll_adjustments;
create trigger trg_payroll_adjustments_stamp before insert or update on payroll_adjustments
  for each row execute function payroll_adjustments_stamp_and_touch();

alter table payroll_adjustments enable row level security;
alter table payroll_adjustments force row level security;

drop policy if exists payroll_adjustments_select on payroll_adjustments;
create policy payroll_adjustments_select on payroll_adjustments
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists payroll_adjustments_insert on payroll_adjustments;
create policy payroll_adjustments_insert on payroll_adjustments
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists payroll_adjustments_update on payroll_adjustments;
create policy payroll_adjustments_update on payroll_adjustments
  for update using (company_id = auth_company_id() or is_superadmin())
  with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists payroll_adjustments_delete on payroll_adjustments;
create policy payroll_adjustments_delete on payroll_adjustments
  for delete using (company_id = auth_company_id() or is_superadmin());
