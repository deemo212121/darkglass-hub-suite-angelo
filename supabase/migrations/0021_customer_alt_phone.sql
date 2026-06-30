-- =====================================================================
-- 0021 — Customer alternate phone
--
-- The ticket detail's General Info section now includes an "Alternate Phone"
-- textbox for an additional contact number (separate from home / cell).
-- Stored on the existing customers row so every ticket linked to the same
-- customer picks up the change.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table customers
  add column if not exists alt_phone text;
