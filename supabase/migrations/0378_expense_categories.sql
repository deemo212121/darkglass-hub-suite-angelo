-- =====================================================================
-- 0378 — Expense categories: Hotel / Car Rental / Office Supply /
-- Reimbursement Form.
--
--   Hotel, Car Rental, Office Supply — entered by Accounting (Add Expense);
--     Flash Tech trips create Hotel + Car Rental lines automatically.
--   Reimbursement Form — sent by the employee themselves (Employee
--     Self-Service / mobile Expenses).
--
-- The old categories (Travel, Supplies, Meals, Other) stay allowed so any
-- row that can't be mapped keeps its value. Existing rows are moved:
--   Travel + hotel line (Flash Tech)           → Hotel
--   Travel + transportation line (Flash Tech)  → Car Rental
--   Supplies                                   → Office Supply
--   sent by the employee themselves            → Reimbursement Form
--
-- Also fills in the $0 Flash Tech Hotel / Car Rental lines from the trip's
-- Hotel Rate / Rental Rate (see the bottom of this file).
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table expenses drop constraint if exists expenses_category_check;
alter table expenses add constraint expenses_category_check check (
  category in ('Hotel', 'Car Rental', 'Office Supply', 'Reimbursement Form', 'Travel', 'Supplies', 'Meals', 'Other')
);

update expenses set category = 'Hotel' where category = 'Travel' and expense_subtype = 'hotel';
update expenses set category = 'Car Rental' where category = 'Travel' and expense_subtype = 'transportation';
update expenses set category = 'Office Supply' where category = 'Supplies';
update expenses
set category = 'Reimbursement Form'
where flash_tech_trip_id is null
  and expense_subtype is null
  and created_by is not null
  and created_by = profile_id;

-- Flash Tech expense lines were created at $0 and never picked up the
-- Hotel Rate / Rental Rate HR entered on the trip. Fill them in (Pending
-- lines only — anything Accounting already decided on is left alone).
update expenses e
set amount = t.hotel_rate,
    expense_date = coalesce(t.lodging_start_date, t.start_date, e.expense_date)
from flash_tech_trips t
where e.flash_tech_trip_id = t.id
  and e.expense_subtype = 'hotel'
  and e.status = 'Pending'
  and coalesce(e.amount, 0) = 0
  and t.hotel_rate is not null;

update expenses e
set amount = t.rental_rate,
    expense_date = coalesce(t.rental_start_date, t.start_date, e.expense_date)
from flash_tech_trips t
where e.flash_tech_trip_id = t.id
  and e.expense_subtype = 'transportation'
  and e.status = 'Pending'
  and coalesce(e.amount, 0) = 0
  and t.rental_rate is not null;
