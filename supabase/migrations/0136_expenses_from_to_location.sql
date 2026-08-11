-- =====================================================================
-- 0136 — Free-text From/To location fields on expenses
--
-- Carried over from a Flash Tech trip's origin_location/destination_location
-- when a Hotel or Transportation expense is auto-created for it (see
-- flashTechTrips.ts), but usable on any expense.
--
-- Run once in the Supabase SQL Editor, after 0135.
-- =====================================================================

alter table expenses add column if not exists from_location text;
alter table expenses add column if not exists to_location text;
