-- =====================================================================
-- 0069 — Part Daily Pickup: real pickup tracking on parts
--
-- The "Part Daily Pickup" page was 100% mock/seed data with no backing
-- columns at all. Adds the two fields that page actually needs to write:
-- picked_up (a tech physically has the part in hand) and pickup_action
-- (free-text note on the pickup row, separate from the existing general
-- `note` field which the page also surfaces as "Comment").
--
-- Deliberately does NOT change `status` when picked_up is toggled - per
-- explicit instruction, Picked Up is tracked as its own flag, not a
-- status transition.
--
-- Run once in the Supabase SQL Editor, after 0068.
-- =====================================================================

alter table parts
  add column picked_up boolean not null default false,
  add column pickup_action text;
