-- =====================================================================
-- csr-daily-report, call-tracker, and csr-status-summary moved from the
-- Dashboard module to a new dedicated CSR module (src/lib/modules.ts) —
-- any company that already configured a custom role-gate override for one
-- of them (Accessibility Management's Module Access by Role grid,
-- migration 0151) has a module_role_gate_overrides row keyed
-- module_slug='dashboard'. dashboardAccess.ts's getDashboardRoleGate()
-- now looks up each of these three submodules' override under the "csr"
-- namespace instead (matching what the admin UI reports as their module
-- going forward, same move already made for hr-dashboard in migration
-- 0219 and accounting-dashboard in migration 0249), so the existing rows
-- need to move with them — otherwise a company's already-configured
-- override would silently stop applying.
--
-- (Two other pages briefly moved alongside these before this migration
-- ever ran, then were retired again — "CSR Team Leader Dashboard"/
-- csr-team-leader-dashboard, and "CSR Dashboard"/csr-dashboard itself,
-- replaced by daily-report + team-composition. Both intentionally left
-- out of the list below since neither exists to have an override for
-- anymore.)
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

update module_role_gate_overrides
set module_slug = 'csr'
where module_slug = 'dashboard'
  and submodule_slug in (
    'csr-daily-report',
    'call-tracker',
    'csr-status-summary'
  );
