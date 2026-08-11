/**
 * Per-company overrides for which roles may open ANY module's submodule
 * (migration 0151, module_role_gate_overrides) — covers every module, not
 * just Dashboard. Hydrated once per session by auth.tsx right after the
 * profile loads (see hydrateModuleRoleGates below).
 *
 * The Dashboard module additionally has hardcoded defaults
 * (DASHBOARD_ROLE_GATES in dashboardAccess.ts) for submodules with no
 * override — dashboardAccess.ts's getDashboardRoleGate() reads this same
 * cache via getModuleRoleGate("dashboard", subSlug) and layers its own
 * default on top. This file deliberately doesn't import from
 * dashboardAccess.ts (and vice versa doesn't import the cache functions
 * from here — see that file's own getDashboardRoleGate) to keep the two
 * one-directional and avoid a circular import.
 *
 * Every other module's submodules have no hardcoded default: no override
 * here means "open to every role," same as before this system existed.
 */

let overrides: Record<string, string[]> = {}; // key: `${moduleSlug}:${submoduleSlug}`

function gateKey(moduleSlug: string, submoduleSlug: string): string {
  return `${moduleSlug}:${submoduleSlug}`;
}

/** Called once after login/profile load — see auth.tsx. */
export function hydrateModuleRoleGates(o: Record<string, string[]>): void {
  overrides = o;
}

/**
 * Raw override lookup for one (module, submodule) pair — null means no
 * override is recorded, i.e. open to every role (except for the Dashboard
 * module, where dashboardAccess.ts's getDashboardRoleGate still applies
 * its own hardcoded default on top of this).
 */
export function getModuleRoleGate(moduleSlug: string, submoduleSlug: string): string[] | null {
  const key = gateKey(moduleSlug, submoduleSlug);
  return key in overrides ? overrides[key] : null;
}
