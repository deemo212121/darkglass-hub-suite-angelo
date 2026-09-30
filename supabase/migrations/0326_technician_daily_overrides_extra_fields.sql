-- =====================================================================
-- 0326 — Extend technician_daily_performance_overrides (0299/0300) with
-- 5 more per-day correctable figures on the Technician Performance
-- Report: Damage Assessment, Minor Ticket, Major Ticket, Reschedule, and
-- NCNS. Same shape as 0300 (which added redo_count) — a plain nullable
-- column per figure, null meaning "no correction, keep the live
-- computed value" (or, for NCNS, which has no live source at all,
-- "nothing entered yet"). No RLS changes needed: policies are table/row
-- -level, and 0299's existing policies already cover any new nullable
-- column on this table.
--
-- Run once in the Supabase SQL Editor, after 0325.
-- =====================================================================

alter table technician_daily_performance_overrides add column if not exists damage_assessment numeric;
alter table technician_daily_performance_overrides add column if not exists minor_ticket numeric;
alter table technician_daily_performance_overrides add column if not exists major_ticket numeric;
alter table technician_daily_performance_overrides add column if not exists reschedule numeric;
alter table technician_daily_performance_overrides add column if not exists ncns numeric;
