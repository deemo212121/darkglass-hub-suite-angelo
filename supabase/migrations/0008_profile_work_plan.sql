-- =====================================================================
-- Per-user Work Plan (User Details → Work Plan tab).
--
-- Stores, per location: whether the user works weekdays/weekends and the
-- AM/PM/AM+PM slot per day. This ALSO acts as a location access restriction:
-- a user can only see tickets / work map for locations enabled here (weekday
-- OR weekend checked).
--
-- Shape (jsonb):
-- {
--   "Asheville": { "weekday": true, "weekend": false,
--                  "days": { "Sunday":"AM + PM", "Monday":"AM", ... } },
--   ...
-- }
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table profiles add column if not exists work_plan jsonb default '{}'::jsonb;
