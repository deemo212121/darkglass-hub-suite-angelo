-- Accounting -> Expenses -> Other Expenses: keep the transactions behind a
-- bill (every Car IQ fuel-card swipe: date, driver, vehicle, station, amount)
-- so a branch's CarIQ Transactions total can be opened and checked line by line.

alter table public.branch_expenses
  add column if not exists line_items jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
