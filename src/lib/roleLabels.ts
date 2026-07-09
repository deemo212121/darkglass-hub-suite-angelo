/**
 * Human-readable label for each canonical UserRole code.
 *
 * The system stores roles as snake-case-uppercase enum codes (e.g.
 * `BIZOPS_SENIOR_MANAGER`) so they're stable across the codebase and the
 * database. The Firestore console — and any UI that needs a "User Type"
 * label — uses the values from this map instead of the raw code.
 */
export const ROLE_LABELS: Record<string, string> = {
  SUPERADMIN: "Super Admin",
  ADMIN: "Admin",
  MANAGER: "Manager",
  CSR: "CSR",
  TECHNICIAN: "Technician",
  TECHNICIAN_MANAGER: "Tech Manager",
  DISPATCHER: "Dispatcher",
  HR: "HR",
  IT: "IT",
  PARTS: "Parts",
  FINANCE: "Finance",
  CLAIMS: "Claims",
  CSR_AGENT: "CSR Agent",
  CSR_TEAM_LEADER: "CSR Team Leader",
  CSR_MANAGER: "CSR Manager",
  BRANCH_MANAGER: "Branch Manager",
  SENIOR_BRANCH_MANAGER: "Senior Branch Manager",
  CLAIMS_MANAGER: "Claims Manager",
  PARTS_MANAGER: "Parts Manager",
  BIZOPS_MANAGER: "BizOps Manager",
  BIZOPS_SENIOR_MANAGER: "BizOps Senior Manager",
  TRIAGE_USER: "Triage User",
  TRIAGE_MANAGER: "Triage Manager",
};

/**
 * Normalize a raw role string to the canonical snake-case-uppercase code
 * (e.g. "CSR_MANAGER") used by the UserRole enum. Some profiles have a
 * legacy space-separated value (e.g. "CSR Manager") instead of the enum
 * code — this lets role checks match either form.
 */
export function normalizeRole(role: string | null | undefined): string {
  return String(role ?? "").trim().toUpperCase().replace(/\s+/g, "_");
}

/**
 * CSR Agents and Team Leaders get a narrow slice of the app — their own
 * Dashboard tools and Tickets, nothing else. Everyone else is unrestricted
 * (this is an allow-list applied only to these two roles, not a general
 * permission system).
 */
const CSR_RESTRICTED_ROLES = new Set(["CSR_AGENT", "CSR_TEAM_LEADER"]);

/** Top-level modules a CSR Agent/Team Leader may open. */
const CSR_ALLOWED_MODULES = new Set(["dashboard", "tickets"]);

/** Within the Dashboard module, the only submodules a CSR Agent/Team Leader may open. */
const CSR_ALLOWED_DASHBOARD_SUBMODULES = new Set([
  "daily-activity",
  "overall-status",
  "employee-self-service",
  "csr-dashboard", // redirects them to their own csr-team-leader-dashboard
  "csr-team-leader-dashboard", // the personal dashboard that redirect lands on
]);

export function isCsrRestrictedRole(role: string | null | undefined): boolean {
  return CSR_RESTRICTED_ROLES.has(normalizeRole(role));
}

/** Whether a CSR Agent/Team Leader may open this module at all. Non-CSR roles always pass. */
export function isModuleAllowed(role: string | null | undefined, moduleSlug: string): boolean {
  if (!isCsrRestrictedRole(role)) return true;
  return CSR_ALLOWED_MODULES.has(moduleSlug);
}

/** Whether a CSR Agent/Team Leader may open this submodule. Non-CSR roles always pass. */
export function isSubmoduleAllowed(role: string | null | undefined, moduleSlug: string, submoduleSlug: string): boolean {
  if (!isCsrRestrictedRole(role)) return true;
  if (!isModuleAllowed(role, moduleSlug)) return false;
  if (moduleSlug === "dashboard") return CSR_ALLOWED_DASHBOARD_SUBMODULES.has(submoduleSlug);
  return true; // tickets: fully open once the module itself is allowed
}
