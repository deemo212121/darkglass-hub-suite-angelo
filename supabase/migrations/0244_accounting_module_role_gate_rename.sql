-- =====================================================================
-- accounting-dashboard moved from the Dashboard module to a new dedicated
-- Accounting module (src/lib/modules.ts) — any company that already
-- configured a custom role-gate override for it (Accessibility
-- Management's Module Access by Role grid, migration 0151) has a
-- module_role_gate_overrides row keyed module_slug='dashboard'.
-- dashboardAccess.ts's getDashboardRoleGate() now looks up
-- accounting-dashboard's override under the "accounting" namespace
-- instead (matching what the admin UI reports as its module going
-- forward, same move already made for hr-dashboard in migration 0219),
-- so the existing row needs to move with it — otherwise a company's
-- already-configured override would silently stop applying (falling back
-- to the hardcoded ADMIN/FINANCE default instead, which happens to match
-- today's data but would silently ignore any future edit made before this
-- migration ran).
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

update module_role_gate_overrides
set module_slug = 'accounting'
where module_slug = 'dashboard' and submodule_slug = 'accounting-dashboard';
