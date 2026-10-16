-- =====================================================================
-- 0392 — payroll_review_breakdowns: the Accounting Dashboard's "Reviewed
-- Periods" tab. One row per (technician, pay period) in Finance's
-- payroll-summary format: Regular Hours $ (incl. state regular match),
-- OT Hours $ (incl. OT premium / state OT match), Bonus (LTP,
-- Performance), Commission, PTO $, Deduction, Mileage + other
-- reimbursements (incl. Flash Tech mileage), Pre-Tax Insurance, Salary
-- Match Needed.
--
-- Snapshotted automatically when Finance clicks Done in the Tech Activity
-- Report (the review wizard's last step — same moment payroll_review_marks
-- is stamped), and every amount stays editable afterwards; rows can also
-- be added by hand. Clicking Done again re-snapshots the row (overwrites
-- manual edits for that technician/period).
--
-- RLS mirrors payroll_review_marks (0218): read company-wide, write ADMIN /
-- FINANCE / company SUPERADMIN.
-- Run once in the Supabase SQL Editor.
-- (Numbered 0374 in janeyyy16's repo — renumbered here past this repo's own
-- 0374-0391; already applied to the shared database, 86 rows on 2026-10-15.
-- Safe to run again.)
-- =====================================================================

create table if not exists payroll_review_breakdowns (
  id                    uuid primary key default uuid_generate_v4(),
  company_id            uuid not null references companies(id) on delete cascade,
  profile_id            uuid not null references profiles(id) on delete cascade,
  period_start          date not null,
  period_end            date not null,
  branch                text,
  regular_pay           numeric not null default 0,
  ot_pay                numeric not null default 0,
  bonus                 numeric not null default 0,
  commission            numeric not null default 0,
  pto_pay               numeric not null default 0,
  deduction             numeric not null default 0,
  mileage_other_reimb   numeric not null default 0,
  pretax_insurance      numeric not null default 0,
  salary_match          numeric not null default 0,
  -- 'review' = snapshotted at Done; 'manual' = added by hand on the tab.
  source                text not null default 'manual',
  updated_by            uuid references profiles(id) on delete set null,
  updated_by_name       text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (company_id, profile_id, period_start, period_end)
);

create index if not exists idx_payroll_review_breakdowns_company_period
  on payroll_review_breakdowns (company_id, period_start, period_end);

create or replace function payroll_review_breakdowns_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_payroll_review_breakdowns_stamp on payroll_review_breakdowns;
create trigger trg_payroll_review_breakdowns_stamp before insert or update on payroll_review_breakdowns
  for each row execute function payroll_review_breakdowns_stamp();

alter table payroll_review_breakdowns enable row level security;
alter table payroll_review_breakdowns force row level security;

drop policy if exists payroll_review_breakdowns_select on payroll_review_breakdowns;
create policy payroll_review_breakdowns_select on payroll_review_breakdowns
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists payroll_review_breakdowns_write on payroll_review_breakdowns;
create policy payroll_review_breakdowns_write on payroll_review_breakdowns
  for all
  using (
    (company_id = auth_company_id() and (is_admin() or is_finance() or is_company_superadmin()))
    or is_superadmin()
  )
  with check (
    (company_id = auth_company_id() and (is_admin() or is_finance() or is_company_superadmin()))
    or is_superadmin()
  );
