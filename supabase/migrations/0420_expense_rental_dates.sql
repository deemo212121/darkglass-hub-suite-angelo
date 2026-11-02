-- =====================================================================
-- 0420 — Car Rental pick-up and return dates on expenses.
--
-- Accounting's Add Expense form asks for both when the category is Car
-- Rental; the Expenses lists show them in a "Pick-up / Return" column.
-- Other categories leave them empty. Nothing else reads them.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table expenses add column if not exists pickup_date date;
alter table expenses add column if not exists return_date date;
