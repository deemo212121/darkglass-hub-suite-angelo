-- Philippine Staff's "Staff Need" column (Generate EOD/EOM Hiring Report)
-- had no way to save at all — Technician/Parts Manager's Staff Need comes
-- from staffing_targets (keyed by position+branch, via getStaffingTargets/
-- setStaffingTarget), but Philippine Staff rows are keyed by DEPARTMENT,
-- not a real "position", so that table was never a fit and the input was
-- shipped disabled. Reusing hr_hiring_report_manual_entries (0278) instead
-- — the same table Budget/Sponsored/Others already save into per (period,
-- section, row) — rather than force department names into the position/
-- branch table.
--
-- Run once in the Supabase SQL Editor, after 0303.

alter table hr_hiring_report_manual_entries add column if not exists staff_needed numeric;
