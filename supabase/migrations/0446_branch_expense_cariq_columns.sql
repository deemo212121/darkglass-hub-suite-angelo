-- =====================================================================
-- 0446 — Other Expenses: the rest of Accounting's monthly branch sheet.
--
-- Adds CarIQ Transactions, CarIQ Mileage Reimbursement ($0.20), NON CarIQ
-- Mileage Reimbursement ($0.50) and Field Equipment. ("travel_lodging" and
-- "food" are the sheet's Flash Tech Travel / Lodging and Flash Tech Food
-- Reimbursement — only their labels on the page changed.)
--
-- CarIQ Transactions is what Import Car IQ fills in: Car IQ's transaction
-- report, its TOTAL (USD) summed per branch.
--
-- Only the category check on branch_expenses changes. Safe to run again.
-- Run once in the Supabase SQL Editor, after 0445.
-- =====================================================================

alter table branch_expenses drop constraint if exists branch_expenses_category_check;
alter table branch_expenses add constraint branch_expenses_category_check check (category in (
  'lease', 'auto_insurance', 'internet', 'utility', 'travel_lodging', 'food', 'rental_car',
  'cariq_transactions', 'cariq_mileage', 'non_cariq_mileage',
  'gas', 'equipment_supplies', 'field_equipment', 'operation',
  'tech_payroll', 'us_office_payroll', 'ph_office_payroll',
  'phone', 'other'
));
