/**
 * Per-company overrides for DASHBOARD_ROLE_GATES (src/lib/dashboardAccess.ts)
 * — see migration 0151 for the full semantics. A submodule with no override
 * rows falls back to the hardcoded default; editing a submodule always
 * replaces its complete allowed-role set, never a partial diff.
 */
import { supabase } from "./client";

/** submodule_slug -> allowed role codes, for every submodule that has at least one override row. */
export async function getDashboardRoleGateOverrides(): Promise<Record<string, string[]>> {
  const { data, error } = await supabase.from("dashboard_role_gate_overrides").select("submodule_slug, role");
  if (error) {
    console.error("getDashboardRoleGateOverrides error:", error.message);
    return {};
  }
  const out: Record<string, string[]> = {};
  for (const row of data ?? []) {
    (out[row.submodule_slug] ??= []).push(row.role);
  }
  return out;
}

/** Replaces the complete allowed-role set for one submodule. Admin/SuperAdmin only — enforced by RLS. */
export async function setDashboardRoleGateOverride(submoduleSlug: string, allowedRoles: string[]): Promise<void> {
  const { error: deleteError } = await supabase
    .from("dashboard_role_gate_overrides")
    .delete()
    .eq("submodule_slug", submoduleSlug);
  if (deleteError) throw new Error(deleteError.message);

  if (allowedRoles.length === 0) return;
  const { error: insertError } = await supabase
    .from("dashboard_role_gate_overrides")
    .insert(allowedRoles.map((role) => ({ submodule_slug: submoduleSlug, role })));
  if (insertError) throw new Error(insertError.message);
}
