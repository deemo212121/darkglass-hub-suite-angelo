-- Accounting -> Expenses -> Overall Expenses: the account a bill was paid on
-- (the provider's account number / the card or bank account used), typed per
-- line in Add branch expenses and shown in Branch Bills.
--
-- Run after 0450 (0450_it_has_super_admin_access).

alter table public.branch_expenses
  add column if not exists account_number text not null default '';

notify pgrst, 'reload schema';
