-- =====================================================================
-- 0183 — Lets Accounting choose whether a day's route ends at the
-- technician's home address or loops back to the branch, from the Day
-- Route view. Shared across every row in a (technician, work_date) group,
-- same as route_order/total_mileage.
--
-- Null means "use the automatic default" (home address if one's on file,
-- branch otherwise — the behavior before this migration, computeDailyRouteMiles
-- in mapEngine.ts). 'home' forces the home-address leg (falls back to
-- branch anyway if there's genuinely no home address on file); 'branch'
-- forces a branch-return route even when a home address exists.
--
-- Reset back to null (alongside route_order) whenever a new ticket joins
-- an already-recomputed day — see syncMileageFromTickets, mileage.ts —
-- for the same reason route_order resets: the day's stop set changed, so
-- a stale manual choice shouldn't silently keep applying to a route that's
-- now different.
--
-- Run once in the Supabase SQL Editor, after 0182.
-- =====================================================================

alter table mileage_entries add column if not exists route_return_to text
  check (route_return_to in ('home', 'branch'));
