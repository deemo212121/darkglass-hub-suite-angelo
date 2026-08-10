/**
 * Per-company overrides for which roles may open ANY module's submodule —
 * see migration 0151 (module_role_gate_overrides) for the full semantics.
 * A (module, submodule) with no override rows is open to everyone (the
 * Dashboard module additionally falls back to its own hardcoded default,
 * see dashboardAccess.ts). Editing a submodule always replaces its
 * complete allowed-role set, never a partial diff.
 */
import { supabase } from "./client";

/** `${module_slug}:${submodule_slug}` -> allowed role codes, for every (module, submodule) that has at least one override row. */
export async function getModuleRoleGateOverrides(): Promise<Record<string, string[]>> {
  const { data, error } = await supabase.from("module_role_gate_overrides").select("module_slug, submodule_slug, role");
  if (error) {
    console.error("getModuleRoleGateOverrides error:", error.message);
    return {};
  }
  const out: Record<string, string[]> = {};
  for (const row of data ?? []) {
    const key = `${row.module_slug}:${row.submodule_slug}`;
    (out[key] ??= []).push(row.role);
  }
  return out;
}

/** Replaces the complete allowed-role set for one (module, submodule) pair. Admin/SuperAdmin only — enforced by RLS. */
export async function setModuleRoleGateOverride(moduleSlug: string, submoduleSlug: string, allowedRoles: string[]): Promise<void> {
  const { error: deleteError } = await supabase
    .from("module_role_gate_overrides")
    .delete()
    .eq("module_slug", moduleSlug)
    .eq("submodule_slug", submoduleSlug);
  if (deleteError) throw new Error(deleteError.message);

  if (allowedRoles.length === 0) return;
  const { error: insertError } = await supabase
    .from("module_role_gate_overrides")
    .insert(allowedRoles.map((role) => ({ module_slug: moduleSlug, submodule_slug: submoduleSlug, role })));
  if (insertError) throw new Error(insertError.message);
}
