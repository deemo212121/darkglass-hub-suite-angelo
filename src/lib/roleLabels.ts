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

/**
 * Roles allowed to flag a ticket as misdiagnosed (ticket.$ticketNo.tsx) and
 * to see the "Show Misdiagnosed" filter (TicketList.tsx) — manager-tier
 * reviewers only. "Managers" maps to the plain MANAGER role plus branch
 * managers; Triage/Claims/BizOps are their own dedicated manager roles,
 * called out separately from the generic "Managers" bucket per how this
 * was originally requested.
 */
const MISDIAGNOSED_ROLES = new Set([
  "ADMIN",
  "SUPERADMIN",
  "MANAGER",
  "BRANCH_MANAGER",
  "SENIOR_BRANCH_MANAGER",
  "BIZOPS_MANAGER",
  "BIZOPS_SENIOR_MANAGER",
  "TRIAGE_MANAGER",
  "CLAIMS_MANAGER",
]);

export function canManageMisdiagnosed(role: string | null | undefined): boolean {
  return MISDIAGNOSED_ROLES.has(normalizeRole(role));
}

/**
 * Roles that may submit a warning/mistake conduct note about an employee
 * (employee_conduct_notes — see csrAgentNotes.ts). Any manager-flavored
 * role, not just CSR management, since the same two-stage review workflow
 * covers every department. Shared by CsrAgentDetailPage (per-employee
 * detail page) and the Attendance Monitoring page's Warnings tab.
 */
const CONDUCT_NOTE_SUBMITTER_ROLES = new Set([
  "CSR_TEAM_LEADER", "CSR_MANAGER", "MANAGER", "ADMIN", "SUPERADMIN", "HR",
  "BRANCH_MANAGER", "SENIOR_BRANCH_MANAGER", "TECHNICIAN_MANAGER",
  "CLAIMS_MANAGER", "PARTS_MANAGER", "BIZOPS_MANAGER", "BIZOPS_SENIOR_MANAGER",
]);

export function canSubmitConductNote(role: string | null | undefined): boolean {
  return CONDUCT_NOTE_SUBMITTER_ROLES.has(normalizeRole(role));
}

/**
 * Stage 2 (final/HR-tier) reviewers — their own submissions fast-track
 * straight to 'approved' since they already hold final review authority
 * and routing through a department manager first would be redundant.
 */
const CONDUCT_NOTE_FAST_TRACK_ROLES = new Set(["HR", "ADMIN", "SUPERADMIN"]);

export function canFastTrackConductNote(role: string | null | undefined): boolean {
  return CONDUCT_NOTE_FAST_TRACK_ROLES.has(normalizeRole(role));
}

/**
 * Roles allowed to see the "Completed / Claimed / Data Closed" status-group
 * filter option on Ticket List — revenue-sensitive since Data Closed marks
 * a job as fully billed/closed out, so it's restricted to Admin, BizOps,
 * and Claims rather than shown to every role that can view tickets.
 */
const DATA_CLOSE_FILTER_ROLES = new Set([
  "ADMIN", "SUPERADMIN", "BIZOPS_MANAGER", "BIZOPS_SENIOR_MANAGER", "CLAIMS", "CLAIMS_MANAGER",
]);

export function canFilterDataClosedTickets(role: string | null | undefined): boolean {
  return DATA_CLOSE_FILTER_ROLES.has(normalizeRole(role));
}

/**
 * Single source of truth for "HR-tier" access to Jotform form-submission
 * pings — shared between who can see the Jotform Submissions tab
 * (ReportHRDaily.tsx) and who actually gets notified when a submission
 * comes in (findHrFirebaseUids in jotformBridge.ts). These two MUST stay
 * in sync: previously the tab was visible to HR/Admin/Superadmin/Manager
 * but the webhook only ever notified accounts tagged exactly "HR", so
 * every other role saw a permanently empty tab regardless of how many
 * submissions came in.
 */
const JOTFORM_HR_ROLES = new Set(["HR", "ADMIN", "SUPERADMIN", "MANAGER"]);

export function isJotformHrRole(role: string | null | undefined): boolean {
  return JOTFORM_HR_ROLES.has(normalizeRole(role));
}
