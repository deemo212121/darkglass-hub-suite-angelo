-- =====================================================================
-- hr-dashboard moved from the Dashboard module to a new dedicated HR
-- module (src/lib/modules.ts) — any company that already configured a
-- custom role-gate override for it (Accessibility Management's Module
-- Access by Role grid, migration 0151) has a module_role_gate_overrides
-- row keyed module_slug='dashboard'. dashboardAccess.ts's
-- getDashboardRoleGate() now looks up hr-dashboard's override under the
-- "hr" namespace instead (matching what the admin UI reports as its
-- module going forward), so the existing row needs to move with it —
-- otherwise a company's already-configured override would silently stop
-- applying (falling back to the hardcoded ADMIN/HR default instead, which
-- happens to match today's data but would silently ignore any future
-- edit made before this migration ran).
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

update module_role_gate_overrides
set module_slug = 'hr'
where module_slug = 'dashboard' and submodule_slug = 'hr-dashboard';
