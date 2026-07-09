-- =====================================================================
-- 0039 — Truck Stock status (In Stock / In Use)
--
-- Lets a branch mark a part as already installed/allocated ("In Use")
-- instead of just tracking raw quantity — so a tech can tell at a glance
-- whether the units on a row are actually available or already spoken for.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table truck_stock add column if not exists status text not null default 'in_stock'
  check (status in ('in_stock','in_use'));

create index if not exists truck_stock_status_idx on truck_stock (company_id, status);
