-- =====================================================================
-- 0300 — technician_daily_performance_overrides: add redo_count
--
-- Redo Count has no day-level breakdown in this report's own data
-- pipeline (getTechRedoTickets returns a period total with no date per
-- ticket, see 0299's own header comment on why it was left out
-- originally) — a day-level correction here doesn't "replace" a live
-- day figure the way total_tickets/miles/hours_worked do. Instead, when
-- ANY row in the period has a redo_count set, the technician's whole
-- period total is replaced by the SUM of every set redo_count across
-- that period (see TechnicianPerformanceReport.tsx's computed.redoCount)
-- — a human corrects days for however many redos they can attribute to
-- one, and the total follows from that, rather than needing to isolate
-- which live-counted tickets were already redos.
--
-- Run once in the Supabase SQL Editor, after 0299.
-- =====================================================================

alter table technician_daily_performance_overrides
  add column if not exists redo_count numeric;
