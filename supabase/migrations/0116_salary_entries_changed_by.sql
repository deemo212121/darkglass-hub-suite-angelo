-- =====================================================================
-- 0116 — Track who made each Salary History change
--
-- salary_entries records every rate change (raise/promotion/demotion/
-- adjustment) but never who entered it. Adds changed_by so the Accounting
-- Dashboard's employee detail modal (EmployeePayrollDetailModal.tsx) can
-- show a "Changed By" column in Salary History — same free-text actor-name
-- pattern as module_activity_log.actor_name (0115), not a profiles FK,
-- since the actor may not always resolve to a current profile row.
--
-- Run once in the Supabase SQL Editor, after 0115.
-- =====================================================================

alter table salary_entries add column if not exists changed_by text;
