-- =====================================================================
-- 0111 — Extra pay + Notes on payroll line items
--
-- Finance needs a per-employee, per-payslip adjustment ("Extra" — a bonus/
-- add-on that isn't part of the regular/overtime calculation) plus a free-
-- text note, both shown on the employee-facing payslip (My Payroll tab)
-- alongside a Grand Total that folds Extra into the regular gross pay.
-- Edited from AccountingDashboard.tsx's Reports tab (expand a payroll run
-- to edit each employee's line item).
--
-- Run once in the Supabase SQL Editor, after 0110.
-- =====================================================================

alter table payroll_line_items add column if not exists extra_pay numeric not null default 0;
alter table payroll_line_items add column if not exists notes text;
