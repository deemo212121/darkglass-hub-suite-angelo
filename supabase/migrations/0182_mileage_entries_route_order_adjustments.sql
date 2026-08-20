-- =====================================================================
-- 0182 — Manual stop order + manual mileage adjustments on mileage_entries
--
-- Two independent additions for the new Day Route view (Accounting
-- Dashboard's Mileage tab):
--
-- 1. route_order: lets Accounting reorder a day's stops (the auto
--    time-slot-based sequence is a best guess, not the tech's real visit
--    order). Set on every row in a (technician, work_date) group when a
--    human saves a custom order via the Day Route view; null means "use
--    the automatic time-slot/created-at heuristic" (see
--    syncMileageFromTickets, mileage.ts). A brand new ticket joining an
--    already-manually-ordered day has no route_order yet — the sync
--    deliberately falls back to the full heuristic for that whole group
--    in that case, rather than guessing where to splice it in, so Finance
--    always sees a consistent within-day order rather than a partially
--    human/partially guessed one.
--
-- 2. Adjustment fields, layered ON TOP of the calculated total_mileage
--    rather than replacing it in place, so a later re-sync (a new ticket
--    joining the day) can still recompute the base route without
--    clobbering a human's correction:
--      mileage_override    — full replacement for the day's total, if set.
--      mileage_adjustment  — a +/- delta added to total_mileage, if set
--                             (ignored when mileage_override is set).
--      adjustment_note      — why (free text), shown in the UI.
--      adjusted_by / adjusted_by_name / adjusted_at — audit trail, same
--                             shape as payroll_excluded_by(_name)/_at (0148).
--    Effective total = mileage_override ?? (total_mileage + coalesce(mileage_adjustment, 0)).
--    Application code (mileageEffectiveTotal, mileage.ts) is the single
--    source of truth for that formula — every payroll/UI total read must
--    go through it, never total_mileage alone, once this migration lands.
--
-- Run once in the Supabase SQL Editor, after 0181.
-- =====================================================================

alter table mileage_entries add column if not exists route_order integer;
alter table mileage_entries add column if not exists mileage_override numeric;
alter table mileage_entries add column if not exists mileage_adjustment numeric;
alter table mileage_entries add column if not exists adjustment_note text;
alter table mileage_entries add column if not exists adjusted_by uuid references profiles(id) on delete set null;
alter table mileage_entries add column if not exists adjusted_by_name text;
alter table mileage_entries add column if not exists adjusted_at timestamptz;
