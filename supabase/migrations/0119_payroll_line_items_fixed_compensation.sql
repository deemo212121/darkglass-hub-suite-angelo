-- =====================================================================
-- 0119 — Record whether a payroll_line_items row was a fixed-salary
-- payout, not just an hourly one
--
-- Mirrors salary_entries' compensation_type/annual_salary (migration
-- 0118) onto the actual generated line item, so a finalized payslip can
-- tell the two apart unambiguously (rather than inferring it from
-- hourly_rate happening to be 0, which isn't a safe signal on its own).
-- Needed by the self-service payslip (EmployeeSelfServicePage.tsx) and
-- the Gmail-sent payslip (AccountingDashboard.tsx) to skip the per-day
-- hours × rate breakdown for fixed-salary employees, since that table
-- would otherwise show a misleading $0.00 for every day despite the
-- correct flat total.
--
-- Run once in the Supabase SQL Editor, after 0118.
-- =====================================================================

alter table payroll_line_items add column if not exists compensation_type text not null default 'hourly' check (compensation_type in ('hourly', 'fixed'));
alter table payroll_line_items add column if not exists annual_salary numeric;
