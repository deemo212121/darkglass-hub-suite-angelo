-- =====================================================================
-- 0109 — Explicit Working Hours / Meal Time override on profiles
--
-- Meal eligibility ("6 hours or less of scheduled shift has no meal
-- break") has always been computed by subtracting Time In Required from
-- Time Out Required (see hoursDiff/timeDiff call sites in TimeClockMenu.tsx,
-- routes/timecard.tsx, EmployeeSelfServicePage.tsx, timecards.ts's
-- getAttendanceForRange). working_hours is an explicit per-employee
-- override for that computed number — set it when someone's real
-- scheduled hours don't cleanly fall out of a Time In/Out subtraction.
-- When null, every call site falls back to the existing Time In/Out
-- diff — see resolveScheduledShiftHours() in timecards.ts.
--
-- meal_minutes just records how long that person's meal break should be
-- (not currently enforced anywhere, just stored/shown — see
-- AdminUserManagementPage.tsx's General Information tab).
--
-- Run once in the Supabase SQL Editor, after 0108.
-- =====================================================================

alter table profiles add column if not exists working_hours numeric;
alter table profiles add column if not exists meal_minutes integer;
