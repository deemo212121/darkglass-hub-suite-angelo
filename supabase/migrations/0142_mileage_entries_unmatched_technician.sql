-- =====================================================================
-- 0142 — Mileage entries for technicians with no matching profile
--
-- syncMileageFromTickets (src/lib/supabase/mileage.ts) previously required
-- an exact technician-name match against a real profile before it would
-- create ANY mileage entry — a technician whose ticket text doesn't match
-- any profile (wrong/legacy Display Name, or no User Management account
-- yet at all) got silently skipped entirely, even though their completed
-- tickets are real and their mileage should still be tracked.
--
-- profile_id is now nullable, with technician_name (the raw ticket text)
-- as the fallback display source when there's no linked profile — once
-- that person's Display Name is fixed to match, or a profile is created
-- for them, a future sync run will pick up their NEW tickets under the
-- real profile_id (existing rows stay attributed to the free-text name
-- unless manually reassigned — this migration doesn't attempt to
-- retroactively relink anything).
--
-- Run once in the Supabase SQL Editor, after 0141.
-- =====================================================================

alter table mileage_entries alter column profile_id drop not null;
alter table mileage_entries add column if not exists technician_name text;
