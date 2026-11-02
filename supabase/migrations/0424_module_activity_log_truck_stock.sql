-- =====================================================================
-- 0424 — Allow "truck-stock" in module_activity_log
--
-- Truck Stock Import is now Admin and above only (TruckStockPage.tsx).
-- Every import, and every attempt by someone without Admin access (an
-- alert), is logged with module = 'truck-stock' and shows on Admin →
-- Activity Logs under Parts. 0256's CHECK constraint doesn't allow that
-- value, so without this those inserts are rejected (logModuleActivity
-- swallows the error) and nothing shows.
--
-- No data is touched — only the allowed list changes. Safe to rerun.
-- Run once in the Supabase SQL Editor, after 0423.
-- =====================================================================

alter table module_activity_log drop constraint if exists module_activity_log_module_check;
alter table module_activity_log add constraint module_activity_log_module_check
  check (module in ('accounting', 'payroll', 'attendance-monitoring', 'it-tickets', 'user-management', 'absent-list', 'truck-stock'));
