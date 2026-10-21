-- =====================================================================
-- 0400 — payroll_hourly_ot_overrides.regular_amount
--
-- Pay is now rounded the way Finance's summary does it: each column to
-- the cent (Regular $, OT $, Commission, …) and then added up (src/lib/
-- payRounding.ts). For a technician paid in State mode, the Accounting
-- Dashboard only had the override's TOTAL Hourly + OT, so it couldn't
-- round Regular $ and OT $ separately the way the Tech Activity Report
-- does, and the two could end up a cent apart.
--
-- regular_amount is the Regular $ part of that State total (regular hours
-- at the company rate + the state regular-hours match). The Tech Activity
-- Report saves it when State is picked, and fills it in when it opens for
-- an override saved before this. Null = not known yet (the dashboard
-- falls back to regular hours at the company rate).
--
-- Run once in the Supabase SQL Editor, after 0399.
-- =====================================================================

alter table payroll_hourly_ot_overrides add column if not exists regular_amount numeric;
