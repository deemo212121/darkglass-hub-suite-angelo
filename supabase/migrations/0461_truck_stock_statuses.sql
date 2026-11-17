-- =====================================================================
-- 0461 — Truck Stock: the inventory workbook's Status list.
--
-- Part Inventory → Truck Stock's Status is now a dropdown with the
-- workbook's statuses (src/lib/truckStockOptions.ts):
--
--   sold · in_stock · ebay · b2b · return · ticket · used
--
-- 0039 only allowed in_stock / in_use. in_use stays allowed for rows saved
-- before (no rows use it today) — it just isn't offered any more. Only
-- in_stock counts as available (Marcone Lookup, transfer requests), as
-- before.
--
-- Changes which values are allowed — no row is changed (every row is
-- in_stock today). Safe to run again. Run once in the Supabase SQL Editor,
-- after 0460.
-- =====================================================================

-- 0039's check was written inline, so its name was picked by Postgres — drop whichever status check is there.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'truck_stock'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table truck_stock drop constraint %I', c.conname);
  end loop;
end $$;

alter table truck_stock add constraint truck_stock_status_check
  check (status in ('in_stock', 'in_use', 'sold', 'ebay', 'b2b', 'return', 'ticket', 'used'));

notify pgrst, 'reload schema';
