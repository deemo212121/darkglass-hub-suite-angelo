-- =====================================================================
-- 0395 — payroll_review_breakdowns: regular / OT hours
--
-- Payroll History's per-person breakdown shows quantities, not just
-- dollars (Finance, 2026-10-20): hours and OT hours alongside tickets,
-- miles and bonus categories. Tickets/miles/bonuses come from the custom
-- pay lines; hours aren't stored anywhere once a period is reviewed (the
-- saved payroll run only has them for people it still holds), so they're
-- snapshotted here when Finance clicks Done in the Tech Activity Report.
--
-- Null for rows saved before this (or added by hand) — Payroll History
-- falls back to the payroll run's hours, else shows "—". Re-clicking Done
-- fills them in.
--
-- Run once in the Supabase SQL Editor (0394 was dropped; run
-- scripts/revert-0394-guaranteed-minimum-type.sql if 0394 was applied).
-- =====================================================================

alter table payroll_review_breakdowns add column if not exists regular_hours numeric;
alter table payroll_review_breakdowns add column if not exists ot_hours numeric;
