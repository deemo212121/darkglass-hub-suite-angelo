-- =====================================================================
-- 0394 — Payroll adjustments: Tax (a % of gross pay).
--
-- Adds a third kind next to Reimbursement / Deduction (0393): 'tax', with
-- its percentage in `percent` (e.g. 13). The amount is worked out from the
-- employee's gross pay for the period (gross × percent / 100) and taken off
-- like a deduction; `amount` keeps the last worked-out figure.
--
-- Run once in the Supabase SQL Editor, after 0393. Safe to run twice.
-- (Numbered 0387 in Angelo's repo — renumbered here past this repo's own
-- 0387-0393; already applied to the shared database 2026-10-16.)
-- =====================================================================

alter table payroll_adjustments add column if not exists percent numeric(6,3);

alter table payroll_adjustments drop constraint if exists payroll_adjustments_kind_check;
alter table payroll_adjustments add constraint payroll_adjustments_kind_check
  check (kind in ('reimbursement', 'deduction', 'tax'));

alter table payroll_adjustments drop constraint if exists payroll_adjustments_percent_check;
alter table payroll_adjustments add constraint payroll_adjustments_percent_check
  check (percent is null or (percent >= 0 and percent <= 100));
