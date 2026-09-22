/**
 * Per-company overrides for which roles may open ANY module's submodule —
 * see migration 0151 (module_role_gate_overrides) for the full semantics.
 * A (module, submodule) with no override rows is open to everyone (the
 * Dashboard module additionally falls back to its own hardcoded default,
 * see dashboardAccess.ts). Editing a submodule always replaces its
 * complete allowed-role set, never a partial diff.
 */
import { supabase } from "./client";

// Supabase caps an unbounded select at 1000 rows (see signableDocuments.ts's
// own note on this) — a company with dozens of modules/submodules times a
// dozen-plus roles each crosses that easily (confirmed: 1604 rows for one
// real company), so a single unpaged select here silently dropped roughly a
// third of all override rows on every load. Any (module, submodule) whose
// entire row set happened to land in the dropped remainder read back as "no
// override at all" — i.e. open to everyone — making a real, successfully
// saved revoke appear to have reverted itself the moment the page reloaded.
const PAGE_SIZE = 1000;

/** `${module_slug}:${submodule_slug}` -> allowed role codes, for every (module, submodule) that has at least one override row. */
export async function getModuleRoleGateOverrides(): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("module_role_gate_overrides")
      .select("module_slug, submodule_slug, role")
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error("getModuleRoleGateOverrides error:", error.message);
      return out;
    }
    for (const row of data ?? []) {
      const key = `${row.module_slug}:${row.submodule_slug}`;
      (out[key] ??= []).push(row.role);
    }
    if (!data || data.length < PAGE_SIZE) break;
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
