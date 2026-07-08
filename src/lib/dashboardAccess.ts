/**
 * Role gates for the Dashboard module's submodules (mod.slug === "dashboard").
 * Keyed by submodule slug. A submodule with no entry here is open to every
 * signed-in user (e.g. the Employee Self-Service Portal).
 *
 * SUPERADMIN always passes regardless of this list — same convention as the
 * admin-module gate in m.$module.$submodule.tsx.
 */
export const DASHBOARD_ROLE_GATES: Record<string, string[]> = {
  "daily-activity": ["ADMIN", "BIZOPS_MANAGER", "BIZOPS_SENIOR_MANAGER", "CSR_MANAGER", "HR", "MANAGER"],
  "overall-status": ["ADMIN", "BIZOPS_MANAGER", "BIZOPS_SENIOR_MANAGER", "MANAGER"],
  "accounting-dashboard": ["ADMIN", "FINANCE"],
  "attendance-monitoring": ["ADMIN", "HR", "FINANCE", "BIZOPS_MANAGER", "BIZOPS_SENIOR_MANAGER"],
  "payroll-calculation": ["ADMIN", "FINANCE"],
  "expense-tracking": ["ADMIN", "FINANCE"],
  // CSR_AGENT/CSR_TEAM_LEADER are allowed in here too even though the org-wide
  // overview is meant for CSR_MANAGER/Admin/BizOps — CSRDashboard.tsx itself
  // redirects those two roles straight to their personal Team Leader
  // Dashboard, so they need to pass this gate for that redirect to fire.
  "csr-dashboard": ["ADMIN", "CSR_MANAGER", "BIZOPS_MANAGER", "BIZOPS_SENIOR_MANAGER", "CSR_AGENT", "CSR_TEAM_LEADER"],
  "hr-dashboard": ["ADMIN", "HR"],
};

export function getDashboardRoleGate(subSlug: string): string[] | null {
  return DASHBOARD_ROLE_GATES[subSlug] ?? null;
}

/**
 * True if `role` (primary) or anything in `extraRoles` satisfies one of the
 * `allowedRoles` for a gated page. SUPERADMIN always passes.
 */
export function hasDashboardAccess(
  allowedRoles: string[],
  role: string | null | undefined,
  extraRoles: string[] | null | undefined
): boolean {
  const primary = (role || "").toUpperCase();
  if (primary === "SUPERADMIN") return true;
  if (allowedRoles.includes(primary)) return true;
  return (extraRoles || []).some((r) => allowedRoles.includes((r || "").toUpperCase()));
}
