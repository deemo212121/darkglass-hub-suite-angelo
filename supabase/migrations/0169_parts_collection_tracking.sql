-- =====================================================================
-- 0166 — Part Daily Collection: real collection tracking on parts
--
-- Mirrors 0069 (Part Daily Pickup) and 0071 (Part Receive)'s pattern —
-- tracking columns bolted directly onto `parts`, not the dormant
-- `part_collections`/`part_pickups` tables from 0001_init.sql, which have
-- never been queried anywhere in the app. Keeping one source of truth per
-- part row instead of a second table to keep in sync.
--
-- `collect_note` is its own column (not the pre-existing `note`) because
-- Pickup already claims `note` for its own "Comment" field — sharing it
-- would let Pickup and Collection silently overwrite each other's notes
-- on the same row.
--
-- `picked_up_date` fills a gap in 0069: `picked_up` was only ever a bare
-- boolean, so there was nothing to show under a "Picked Up" date column.
-- Set by partDailyPickup.ts whenever a row is marked picked up.
--
-- Deliberately does NOT change `status` when collected/collect_type is
-- set — same non-goal Pickup already established for `picked_up`.
--
-- Run once in the Supabase SQL Editor, after 0165.
-- =====================================================================

alter table parts
  add column collected boolean not null default false,
  add column collected_date date,
  add column used_qty numeric(10,2) default 0,
  add column restock_qty numeric(10,2) default 0,
  add column collect_type text,
  add column collect_note text,
  add column lot_no text,
  add column picked_up_date date;
