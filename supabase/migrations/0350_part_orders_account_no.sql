-- Preserve the ordering account used for each purchase order.
alter table public.part_orders add column if not exists account_no text;
comment on column public.part_orders.account_no is 'Distributor ordering account captured on the purchase order; distinct from the ticket warranty account.';
