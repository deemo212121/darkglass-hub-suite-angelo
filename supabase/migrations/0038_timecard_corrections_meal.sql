-- =====================================================================
-- 0038 — Timecard corrections can also fix meal times
--
-- A correction request could only fix check-in/check-out; meal start/end
-- are sometimes wrong too (e.g. forgot to clock back in from lunch). Adds
-- the same original/corrected pair for meal times that already exists for
-- check-in/check-out.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table timecard_corrections add column if not exists original_meal_start text;
alter table timecard_corrections add column if not exists original_meal_end text;
alter table timecard_corrections add column if not exists corrected_meal_start text;
alter table timecard_corrections add column if not exists corrected_meal_end text;
