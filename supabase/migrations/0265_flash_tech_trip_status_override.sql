-- =====================================================================
-- 0265 — Flash Tech Trip manual status override
--
-- Trip Status on the Tracker is normally auto-computed from the travel
-- dates (Upcoming/Open/Closed — see computeFlashTechTripStatus). This adds
-- a manual override column: when set, it wins over the computed value
-- (see mapTripRow in flashTechTrips.ts); when null, behavior is unchanged.
-- Editing a trip's dates does NOT clear an existing override — it's a
-- deliberate choice, not something a date correction should silently undo.
-- Also adds "Cancelled" as a pickable status, which nothing computes on
-- its own (a trip is never auto-detected as cancelled from its dates).
--
-- Run once in the Supabase SQL Editor, after 0264.
-- =====================================================================

alter table flash_tech_trips add column if not exists status_override text;

alter table flash_tech_trips drop constraint if exists flash_tech_trips_status_override_check;
alter table flash_tech_trips add constraint flash_tech_trips_status_override_check
  check (status_override is null or status_override in ('Upcoming', 'Open', 'Closed', 'Cancelled'));
