-- =====================================================================
-- 0289 — payroll_hourly_ot_overrides: per-technician, per-period override
-- of the flat company-rate Hourly + OT figure (EmployeePayrollRow.techHourlyPay)
-- with the State-matched amount computed on the payroll detail step
-- (EmployeePayrollDetailModal's Compliant/"State" toggle).
--
-- A row here means Finance clicked "Next" on the detail step while "State"
-- was selected for that technician/period — the stored `amount` then
-- replaces the flat calc everywhere downstream (Tech Activity Report's
-- Hourly Pay line, Total Payment, gross pay, CSV export, payslip/Send).
-- Clicking Next on "Company" instead deletes the row for that
-- technician/period, reverting to the flat calc. Period-scoped like
-- payroll_review_marks (0218) — a different pay period starts clean.
--
-- Run once in the Supabase SQL Editor, after 0288.
-- =====================================================================

create table if not exists payroll_hourly_ot_overrides (
  id           uuid primary key default uuid_generate_v4(),
  company_id   uuid not null references companies(id) on delete cascade,
  profile_id   uuid not null references profiles(id) on delete cascade,
  period_start date not null,
  period_end   date not null,
  amount       numeric not null,
  set_by       uuid references profiles(id) on delete set null,
  set_by_name  text,
  set_at       timestamptz not null default now(),
  unique (company_id, profile_id, period_start, period_end)
);

create index if not exists idx_payroll_hourly_ot_overrides_company_period
  on payroll_hourly_ot_overrides (company_id, period_start, period_end);

create or replace function payroll_hourly_ot_overrides_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.set_at := now();
  return new;
end;
$$;

drop trigger if exists trg_payroll_hourly_ot_overrides_stamp on payroll_hourly_ot_overrides;
create trigger trg_payroll_hourly_ot_overrides_stamp before insert or update on payroll_hourly_ot_overrides
  for each row execute function payroll_hourly_ot_overrides_stamp();

-- ---------- RLS ----------
-- Same shape as payroll_review_marks (0218): company-wide read, ADMIN/
-- FINANCE/company-SUPERADMIN write.
alter table payroll_hourly_ot_overrides enable row level security;
alter table payroll_hourly_ot_overrides force row level security;

drop policy if exists payroll_hourly_ot_overrides_select on payroll_hourly_ot_overrides;
create policy payroll_hourly_ot_overrides_select on payroll_hourly_ot_overrides
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists payroll_hourly_ot_overrides_write on payroll_hourly_ot_overrides;
create policy payroll_hourly_ot_overrides_write on payroll_hourly_ot_overrides
  for all
  using (
    (company_id = auth_company_id() and (is_admin() or is_finance() or is_company_superadmin()))
    or is_superadmin()
  )
  with check (
    (company_id = auth_company_id() and (is_admin() or is_finance() or is_company_superadmin()))
    or is_superadmin()
  );
