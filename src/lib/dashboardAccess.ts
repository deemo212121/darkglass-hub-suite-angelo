import { normalizeRole, ATTENDANCE_MANAGER_TIER_ROLES_ARRAY } from "./roleLabels";

/**
 * Role gates for the Dashboard module's submodules (mod.slug === "dashboard").
 * Keyed by submodule slug. A submodule with no entry here is open to every
 * signed-in user (e.g. the Employee Self-Service Portal).
 *
 * SUPERADMIN always passes regardless of this list — same convention as the
 * admin-module gate in m.$module.$submodule.tsx.
 */
export const DASHBOARD_ROLE_GATES: Record<string, string[]> = {
  "daily-activity": ["ADMIN", "BIZOPS_MANAGER", "BIZOPS_SENIOR_MANAGER", "CSR_MANAGER", "HR", "MANAGER", "SENIOR_MANAGER"],
  "overall-status": ["ADMIN", "BIZOPS_MANAGER", "BIZOPS_SENIOR_MANAGER", "MANAGER", "SENIOR_MANAGER"],
  "accounting-dashboard": ["ADMIN", "FINANCE"],
  // Manager-tier roles (see ATTENDANCE_MANAGER_TIER_ROLES_ARRAY) are scoped to
  // their own direct reports here (AttendanceMonitoringPage.tsx's
  // visibleAttendanceProfileIds) — ADMIN/HR/FINANCE/SUPERADMIN see everyone.
  "attendance-monitoring": ["ADMIN", "HR", "FINANCE", ...ATTENDANCE_MANAGER_TIER_ROLES_ARRAY],
  "payroll-calculation": ["ADMIN", "FINANCE"],
  "expense-tracking": ["ADMIN", "FINANCE"],
  // CSR_AGENT/CSR_TEAM_LEADER are allowed in here too even though the org-wide
  // overview is meant for CSR_MANAGER/Admin/BizOps — CSRDashboard.tsx itself
  // redirects those two roles straight to their personal Team Leader
  // Dashboard, so they need to pass this gate for that redirect to fire.
  "csr-dashboard": ["ADMIN", "CSR_MANAGER", "BIZOPS_MANAGER", "BIZOPS_SENIOR_MANAGER", "CSR_AGENT", "CSR_TEAM_LEADER"],
  "hr-dashboard": ["ADMIN", "HR"],
  "live-chat-support": ["ADMIN", "BIZOPS_MANAGER", "BIZOPS_SENIOR_MANAGER", "CSR_AGENT", "CSR_TEAM_LEADER", "CSR_MANAGER"],
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
  const primary = normalizeRole(role);
  if (primary === "SUPERADMIN") return true;
  // normalizeRole() so legacy space-separated role values (e.g. "CSR Manager")
  // still match the underscore-form codes in allowedRoles (e.g. "CSR_MANAGER").
  const normalizedAllowed = allowedRoles.map((r) => normalizeRole(r));
  if (normalizedAllowed.includes(primary)) return true;
  return (extraRoles || []).some((r) => normalizedAllowed.includes(normalizeRole(r)));
}
