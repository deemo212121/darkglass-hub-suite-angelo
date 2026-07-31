-- =====================================================================
-- 0110 — Add "training_rate" as a Salary History reason
--
-- salary_entries.reason has been check-constrained to
-- 'promotion'/'demotion'/'adjustment'/'initial' since 0001_init.sql — adds
-- 'training_rate' for employees on a temporary/reduced rate during
-- training, selectable from the Reason dropdown on the Payroll Calculation
-- / Accounting Dashboard employee detail modal (EmployeePayrollDetailModal.tsx).
--
-- Run once in the Supabase SQL Editor, after 0109.
-- =====================================================================

alter table salary_entries drop constraint if exists salary_entries_reason_check;
alter table salary_entries add constraint salary_entries_reason_check
  check (reason in ('promotion', 'demotion', 'adjustment', 'initial', 'training_rate'));
