-- =====================================================================
-- 0211 — Estimate Time for mileage_entries
--
-- Ticket Attendance's Excel-style daily detail view needs an "Estimate
-- Time" per ticket that this app has never tracked anywhere — a plain
-- admin-editable free-text field, filled in by hand (no formula/source
-- feeds it). Stored on mileage_entries since that's already the one-row-
-- per-ticket table the Mileage/Ticket Attendance columns already join
-- against, so no new table or fetch is needed.
--
-- Run once in the Supabase SQL Editor, after 0210.
-- =====================================================================

alter table mileage_entries
  add column if not exists estimate_time text;
