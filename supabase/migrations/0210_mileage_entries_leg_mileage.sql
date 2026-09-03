-- =====================================================================
-- 0210 — Per-ticket leg mileage for mileage_entries
--
-- Every ticket a technician had on the same day currently shows the exact
-- same number in the Mileage tab — that day's whole route total (branch ->
-- stop 1 -> ... -> stop N -> home). This adds a per-row breakdown: this
-- ticket's own leg of the route (distance from the previous stop to this
-- one, with the final "way home" leg folded into the day's last stop).
--
-- Purely additive display data — total_mileage (what payroll actually
-- reimburses) is completely unchanged. Computed and written alongside it
-- in syncMileageFromTickets/recalculateMileageDayRoute (mileage.ts), via
-- computeDailyRouteMiles's new legMiles return value (mapEngine.ts).
-- Summing every ticket's leg_mileage for one (technician, work_date) day
-- reconstructs that day's total_mileage exactly.
--
-- Null for: manual entries (no route/stop-order concept), a stop that
-- failed to geocode, or any row not yet recalculated since this shipped —
-- backfills itself the next time that day's route is synced/recalculated,
-- no migration script needed.
--
-- Run once in the Supabase SQL Editor, after 0209.
-- =====================================================================

alter table mileage_entries
  add column if not exists leg_mileage numeric;
