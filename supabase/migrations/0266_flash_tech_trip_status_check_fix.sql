-- =====================================================================
-- 0266 — Fix flash_tech_trips_status_check: was blocking every future-
-- dated trip
--
-- Migration 0257 constrained the legacy `status` column to
-- ('Open', 'Closed', 'Pending'). A later change (computeFlashTechTripStatus,
-- see flashTechTrips.ts) started writing 'Upcoming' for any trip whose
-- start date is still in the future -- a value that constraint never
-- allowed. Every trip scheduled to start later than today has been
-- failing "Failed to save trip: ... violates check constraint
-- 'flash_tech_trips_status_check'" ever since. 'Pending' was never
-- actually written by any code path (dead legacy value) -- dropped in
-- favor of the real set, now including 'Cancelled' (migration 0265's
-- status_override).
--
-- Run once in the Supabase SQL Editor, after 0265.
-- =====================================================================

alter table flash_tech_trips drop constraint if exists flash_tech_trips_status_check;
alter table flash_tech_trips add constraint flash_tech_trips_status_check
  check (status in ('Upcoming', 'Open', 'Closed', 'Cancelled'));
