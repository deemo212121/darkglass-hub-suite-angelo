-- =====================================================================
-- 0445 — Other Expenses: categories = Accounting's branch sheet columns.
--
-- Lease · Auto Insurance / Payment · Internet · Utility · Travel / Lodging
-- Food · Rental Car · Gas · Equipment / Office Supplies · Operation
-- Tech Payroll · US Office Payroll · PH Office Payroll
--
-- 'utility', 'lease', 'internet' keep their names. 'phone' / 'other' (from
-- 0444) stay allowed so any bill already saved with them still loads; the
-- page no longer offers them.
--
-- Only the category check on branch_expenses changes. Safe to run again.
-- Run once in the Supabase SQL Editor, after 0444.
-- =====================================================================

alter table branch_expenses drop constraint if exists branch_expenses_category_check;
alter table branch_expenses add constraint branch_expenses_category_check check (category in (
  'lease', 'auto_insurance', 'internet', 'utility', 'travel_lodging', 'food', 'rental_car',
  'gas', 'equipment_supplies', 'operation', 'tech_payroll', 'us_office_payroll', 'ph_office_payroll',
  'phone', 'other'
));
