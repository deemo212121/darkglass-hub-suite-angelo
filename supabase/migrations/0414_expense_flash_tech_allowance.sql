-- =====================================================================
-- 0414 — Expenses: "Flash Tech Allowance" type of reimbursement.
-- (0413 in Angelo's repo — renumbered here, past 0413_claim_details_sp_photos.)
--
-- A Reimbursement Form can now be for a Flash Tech allowance, next to Gas,
-- Food and Other (migration 0401). Accounting sees those under Expenses →
-- Flash Tech (shown as "Flash Tech / Allowance") instead of Employee
-- Requests.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table expenses drop constraint if exists expenses_reimbursement_type_check;
alter table expenses add constraint expenses_reimbursement_type_check
  check (reimbursement_type is null or reimbursement_type in ('Gas', 'Food', 'Other', 'Flash Tech Allowance'));
