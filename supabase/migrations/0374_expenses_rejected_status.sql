-- =====================================================================
-- 0374 — Allow "Rejected" as an expense status.
--
-- 0001_init.sql created expenses.status with
--   check (status in ('Pending','Approved','Reimbursed'))
-- but the app has always offered Reject (Accounting → Expenses, now with a
-- required reason — 0372), so every rejection failed with
--   new row for relation "expenses" violates check constraint "expenses_status_check".
--
-- Replaces the check with the same list plus 'Rejected'. No rows change —
-- every existing status is already in the new list.
--
-- Run once in the Supabase SQL Editor, after 0373.
-- =====================================================================

alter table expenses drop constraint if exists expenses_status_check;
alter table expenses add constraint expenses_status_check
  check (status in ('Pending', 'Approved', 'Reimbursed', 'Rejected'));
