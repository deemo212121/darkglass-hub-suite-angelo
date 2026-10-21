-- =====================================================================
-- 0400 — Expenses: type of reimbursement.
--
-- A Reimbursement Form (sent by the employee from Self-Service or the
-- mobile app) now says what it was for: Gas, Food, or Other (with the
-- employee's own words in reimbursement_other). Accounting filters the
-- Expenses list by it. Hotel / Car Rental / Office Supply lines and older
-- reimbursements leave both blank.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table expenses add column if not exists reimbursement_type text;
alter table expenses add column if not exists reimbursement_other text;

alter table expenses drop constraint if exists expenses_reimbursement_type_check;
alter table expenses add constraint expenses_reimbursement_type_check
  check (reimbursement_type is null or reimbursement_type in ('Gas', 'Food', 'Other'));
