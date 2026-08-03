-- ─────────────────────────────────────────────────────────────────────────
-- 0022_ticket_product_edited.sql
--
-- Adds a boolean lock flag on `tickets` so user edits to the Product
-- Information panel (brand, model, serial, model version, product type,
-- purchase date, warranty type, claim company, redo ticket no) are NOT
-- overwritten by subsequent ServicePower re-syncs.
--
-- Pattern mirrors `customers.edited_by_user` introduced in migration 0016 —
-- once set, the ServicePower upsert path skips the product-info column
-- overwrite during ticket updates.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.tickets
  add column if not exists product_edited_by_user boolean not null default false;

-- Index isn't necessary; the column is only read once per upsert by id.
