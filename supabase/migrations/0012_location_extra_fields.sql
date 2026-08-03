-- =====================================================================
-- AH Solutions — Location Management extra fields
--
-- Adds the "General Information" fields that weren't in the original
-- location_mgmt_locations table:
--   - delivery_recipient_name  (Delivery Recipient Name)
--   - OOW Default Charge block: labor_fee, part_fee, trip_fee, others_fee
--     (Out-of-Warranty default charges)
--   - oow_part_actual           (when true, the actual part price is applied
--                                instead of a fixed part fee)
--
-- All columns are nullable / defaulted so existing rows are unaffected.
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table location_mgmt_locations
  add column if not exists delivery_recipient_name text,
  add column if not exists labor_fee   numeric default 0,
  add column if not exists part_fee    numeric default 0,
  add column if not exists trip_fee    numeric default 0,
  add column if not exists others_fee  numeric default 0,
  add column if not exists oow_part_actual boolean default false;
