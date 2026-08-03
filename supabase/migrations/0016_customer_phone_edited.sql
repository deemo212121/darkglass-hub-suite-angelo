-- =====================================================================
-- 0016 — Customer "edited by user" flag
-- Prevents the per-ticket ServicePower auto-sync from overwriting customer
-- fields (name, address, phones, email, etc.) that a CSR or other employee
-- edited manually via the Edit Customer Info form. The save flow flips this
-- flag on; auto-sync only writes when the flag is false.
--
-- Note: this migration was originally introduced as `phone_edited_by_user`.
-- That column is kept for back-compat but no longer read by the app.
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table customers
  add column if not exists phone_edited_by_user boolean not null default false;

alter table customers
  add column if not exists edited_by_user boolean not null default false;
