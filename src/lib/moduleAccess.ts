/**
 * Per-company overrides for which roles may open ANY module's submodule
 * (migration 0151, module_role_gate_overrides) — covers every module, not
 * just Dashboard. Hydrated once per session by auth.tsx right after the
 * profile loads, and re-hydrated live after that: auth.tsx also holds a
 * realtime subscription (module_role_gate_overrides, migration 0299 added
 * it to the supabase_realtime publication) that re-fetches and re-hydrates
 * this cache the instant a company's own rows change — an admin's edit in
 * Accessibility Management reaches every already-open session for that
 * company within moments, not just the tab that made the edit and not only
 * on that session's next login.
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
import { useSyncExternalStore } from "react";

// Reserved submodule_slug — module_role_gate_overrides otherwise always
// keys a real submodule, but this sentinel represents "can this role open
// the module AT ALL" (the module tile/route itself, not any one page
// inside it) — consumed by roleLabels.ts's isModuleAllowed. Same table,
// same cache, same realtime sync as every real submodule key; just a
// different meaning for this one reserved slug. No real submodule will
// ever use this literal string as its own slug.
export const MODULE_LEVEL_GATE_SLUG = "__module_access__";

let overrides: Record<string, string[]> = {}; // key: `${moduleSlug}:${submoduleSlug}`
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function gateKey(moduleSlug: string, submoduleSlug: string): string {
  return `${moduleSlug}:${submoduleSlug}`;
}

/** Called at login, and again on every realtime update — see auth.tsx. */
export function hydrateModuleRoleGates(o: Record<string, string[]>): void {
  overrides = o;
  notify();
}

/**
 * Raw override lookup for one (module, submodule) pair — null means no
 * override is recorded, i.e. open to every role (except for the Dashboard
 * module, where dashboardAccess.ts's getDashboardRoleGate still applies
 * its own hardcoded default on top of this). Plain synchronous read, not
 * reactive — fine for a one-shot check (a list filter, a save-path
 * fallback) but a component that stays mounted while access could change
 * out from under it (the actual submodule page) should use
 * useModuleRoleGate below instead, so it re-renders when the cache updates
 * instead of showing a stale answer until something else happens to
 * re-render it.
 */
export function getModuleRoleGate(moduleSlug: string, submoduleSlug: string): string[] | null {
  const key = gateKey(moduleSlug, submoduleSlug);
  return key in overrides ? overrides[key] : null;
}

/**
 * Reactive version of getModuleRoleGate — re-renders the calling component
 * the moment this (module, submodule) pair's override changes, whether
 * from this tab's own save or the realtime-driven re-hydration of an edit
 * made elsewhere. m.$module.$submodule.tsx uses this for its own gate so a
 * page someone is actively sitting on reacts immediately to an admin
 * revoking their access, instead of only on their next reload.
 */
export function useModuleRoleGate(moduleSlug: string, submoduleSlug: string): string[] | null {
  return useSyncExternalStore(subscribe, () => getModuleRoleGate(moduleSlug, submoduleSlug));
}
