-- =====================================================================
-- 0169 — Part Daily Collection: real collection tracking on parts
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
-- Run once in the Supabase SQL Editor, after 0168. `if not exists` on every
-- column since this data set's `parts` table already had all of these
-- columns applied directly (predating this file's own creation) — safe
-- no-op here, but still needed for any other environment running from a
-- clean migration history.
-- =====================================================================

alter table parts
  add column if not exists collected boolean not null default false,
  add column if not exists collected_date date,
  add column if not exists used_qty numeric(10,2) default 0,
  add column if not exists restock_qty numeric(10,2) default 0,
  add column if not exists collect_type text,
  add column if not exists collect_note text,
  add column if not exists lot_no text,
  add column if not exists picked_up_date date;
