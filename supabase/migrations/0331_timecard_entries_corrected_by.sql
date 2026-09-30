-- =====================================================================
-- 0331 — Who directly corrected a day's punches.
--
-- clocked_in_by (0076) means "someone else clocked this person IN on
-- their behalf" (a manager's proxy clock-in). It was also being reused by
-- HR's direct time edits (Payroll detail, Employee Monitoring → Attendance
-- Status), so the app couldn't tell "Clocked in by" from "Corrected by".
--
-- corrected_by / corrected_at are set ONLY by those edit screens, never by
-- a punch — including when HR corrects their own timecard. Existing rows
-- are left null (earlier edits can't be told apart from proxy clock-ins).
--
-- Run once in the Supabase SQL Editor, after 0330.
-- =====================================================================

alter table timecard_entries add column if not exists corrected_by uuid references profiles(id) on delete set null;
alter table timecard_entries add column if not exists corrected_at timestamptz;
