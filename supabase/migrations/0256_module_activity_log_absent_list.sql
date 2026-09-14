-- =====================================================================
-- 0256 — Allow "absent-list" in module_activity_log
--
-- AbsentListPage.tsx's own Activity Log (Note saved / HR Status set /
-- attachment added/removed) logs with module = 'absent-list', but
-- 0115_module_activity_log.sql's CHECK constraint only allowed
-- ('accounting', 'payroll', 'attendance-monitoring', 'it-tickets',
-- 'user-management') — every insert since has been silently rejected by
-- Postgres (logModuleActivity swallows the error, just console.errors it),
-- so the log always showed "No activity yet" with no visible failure.
--
-- Run once in the Supabase SQL Editor, after 0255.
-- =====================================================================

alter table module_activity_log drop constraint if exists module_activity_log_module_check;
alter table module_activity_log add constraint module_activity_log_module_check
  check (module in ('accounting', 'payroll', 'attendance-monitoring', 'it-tickets', 'user-management', 'absent-list'));
