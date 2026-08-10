/**
 * Human-readable label for each canonical UserRole code.
 *
 * The system stores roles as snake-case-uppercase enum codes (e.g.
 * `BIZOPS_SENIOR_MANAGER`) so they're stable across the codebase and the
 * database. The Firestore console — and any UI that needs a "User Type"
 * label — uses the values from this map instead of the raw code.
 */
export const ROLE_LABELS: Record<string, string> = {
  SUPERSUPERADMIN: "Super Super Admin",
  SUPERADMIN: "Super Admin",
  ADMIN: "Admin",
  MANAGER: "Manager",
  SENIOR_MANAGER: "Senior Manager",
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
  CLAIMS_TEAM_LEADER: "Claims Team Leader",
  PARTS_MANAGER: "Parts Manager",
  PARTS_TEAM_LEADER: "Parts Team Leader",
  BIZOPS_MANAGER: "BizOps Manager",
  BIZOPS_SENIOR_MANAGER: "BizOps Senior Manager",
  TRIAGE_USER: "Technical Support",
  TRIAGE_MANAGER: "Technical Support Manager",
  TECHNICAL_DIRECTOR: "Technical Director",
  TECHNICAL_ASSISTANT_DIRECTOR: "Technical Assistant Director",
  SENIOR_DIRECTOR: "Senior Director",
  ASSISTANT_MANAGER: "Assistant Manager",
};

/**
 * Every role code assignable via the "User Type" multi-select (individual
 * user edit page), the Role Management bulk grid, and the roles list on the
 * left of Accessibility Management's access matrix — every ROLE_LABELS
 * code except the two platform/company super-admin tiers, which are
 * deliberately excluded (they bypass every access gate unconditionally, so
 * restricting them here would be meaningless). Single source of truth so
 * none of these UIs can drift out of sync with each other.
 */
export const ROLE_OPTIONS: { value: string; label: string }[] = Object.entries(ROLE_LABELS)
  .filter(([code]) => code !== "SUPERADMIN" && code !== "SUPERSUPERADMIN")
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label));

/**
 * Splits a role code into which department it belongs to and what tier the
 * person holds within it (e.g. CSR_TEAM_LEADER -> department "CSR", role
 * "Team Leader") — used anywhere department and role need to be shown as
 * two separate columns (e.g. AccountingDashboard.tsx's Payroll table),
 * instead of one flat "CSR Team Leader"-style label.
 */
export const ROLE_DEPARTMENT_BREAKDOWN: Record<string, { department: string; roleLabel: string }> = {
  SUPERADMIN: { department: "Admin", roleLabel: "Super Admin" },
  SUPERSUPERADMIN: { department: "Admin", roleLabel: "Super Super Admin" },
  ADMIN: { department: "Admin", roleLabel: "Admin" },
  MANAGER: { department: "Management", roleLabel: "Manager" },
  SENIOR_MANAGER: { department: "Management", roleLabel: "Senior Manager" },
  CSR: { department: "CSR", roleLabel: "CSR" },
  TECHNICIAN: { department: "Technician", roleLabel: "Technician" },
  TECHNICIAN_MANAGER: { department: "Technician", roleLabel: "Manager" },
  TECHNICAL_DIRECTOR: { department: "Technician", roleLabel: "Director" },
  TECHNICAL_ASSISTANT_DIRECTOR: { department: "Technician", roleLabel: "Assistant Director" },
  DISPATCHER: { department: "Dispatch", roleLabel: "Dispatcher" },
  HR: { department: "HR", roleLabel: "HR" },
  IT: { department: "IT", roleLabel: "IT" },
  PARTS: { department: "Parts", roleLabel: "Parts" },
  FINANCE: { department: "Finance", roleLabel: "Finance" },
  CLAIMS: { department: "Claims", roleLabel: "Claims" },
  CSR_AGENT: { department: "CSR", roleLabel: "Agent" },
  CSR_TEAM_LEADER: { department: "CSR", roleLabel: "Team Leader" },
  CSR_MANAGER: { department: "CSR", roleLabel: "Manager" },
  BRANCH_MANAGER: { department: "Branch Manager", roleLabel: "Manager" },
  SENIOR_BRANCH_MANAGER: { department: "Branch Manager", roleLabel: "Senior Manager" },
  CLAIMS_MANAGER: { department: "Claims", roleLabel: "Manager" },
  CLAIMS_TEAM_LEADER: { department: "Claims", roleLabel: "Team Leader" },
  PARTS_MANAGER: { department: "Parts", roleLabel: "Manager" },
  PARTS_TEAM_LEADER: { department: "Parts", roleLabel: "Team Leader" },
  BIZOPS_MANAGER: { department: "BizOps", roleLabel: "Manager" },
  BIZOPS_SENIOR_MANAGER: { department: "BizOps", roleLabel: "Senior Manager" },
  TRIAGE_USER: { department: "Triage", roleLabel: "Agent" },
  TRIAGE_MANAGER: { department: "Triage", roleLabel: "Manager" },
};

/** Falls back to the flat ROLE_LABELS value for both fields if the role isn't in the breakdown map above. */
export function getRoleDepartmentBreakdown(role: string | null | undefined): { department: string; roleLabel: string } {
  const code = normalizeRole(role);
  const known = ROLE_DEPARTMENT_BREAKDOWN[code];
  if (known) return known;
  const fallback = ROLE_LABELS[code] ?? (role ? String(role) : "—");
  return { department: fallback, roleLabel: fallback };
}

/**
 * Normalize a raw role string to the canonical snake-case-uppercase code
 * (e.g. "CSR_MANAGER") used by the UserRole enum. Some profiles have a
 * legacy space-separated value (e.g. "CSR Manager") instead of the enum
 * code — this lets role checks match either form.
 */
export function normalizeRole(role: string | null | undefined): string {
  return String(role ?? "").trim().toUpperCase().replace(/\s+/g, "_");
}

/** `role` (primary) plus every entry in `extraRoles`, normalized, deduped. */
function allHeldRoles(role: string | null | undefined, extraRoles?: string[] | null): string[] {
  const all = [role, ...(extraRoles ?? [])].map((r) => normalizeRole(r)).filter(Boolean);
  return Array.from(new Set(all));
}

/**
 * True if ANY role this person holds (primary or extra) is in `roleSet` —
 * "pile up" semantics for a permission grant: a secondary role that
 * qualifies is just as good as a primary one, so holding multiple roles can
 * only ever widen what someone can do, never narrow it.
 */
function anyHeldRoleIn(roleSet: Set<string>, role: string | null | undefined, extraRoles?: string[] | null): boolean {
  return allHeldRoles(role, extraRoles).some((r) => roleSet.has(r));
}

/**
 * True only if EVERY role this person holds (primary and extra) is in
 * `roleSet` — "pile up" semantics for a restriction: someone who also holds
 * even one role outside the restricted set gets that role's fuller access,
 * so the restriction only applies when none of their roles escapes it.
 * A person with no role at all is not considered restricted (matches the
 * prior single-role behavior, where an empty/unknown role never matched).
 */
function everyHeldRoleIn(roleSet: Set<string>, role: string | null | undefined, extraRoles?: string[] | null): boolean {
  const held = allHeldRoles(role, extraRoles);
  return held.length > 0 && held.every((r) => roleSet.has(r));
}

/**
 * The whole Customer Service department (Agent, Team Leader, and Manager)
 * gets a narrow slice of the app — their own Dashboard tools and Tickets,
 * nothing else. Everyone else is unrestricted (this is an allow-list applied
 * only to these three roles, not a general permission system).
 */
const CSR_RESTRICTED_ROLES = new Set(["CSR_AGENT", "CSR_TEAM_LEADER", "CSR_MANAGER"]);

/** Top-level modules the CSR department may open. */
const CSR_ALLOWED_MODULES = new Set(["dashboard", "tickets"]);

/** Within the Dashboard module, the only submodules the CSR department may open. */
const CSR_ALLOWED_DASHBOARD_SUBMODULES = new Set([
  "daily-activity",
  "overall-status",
  "employee-self-service",
  "csr-dashboard", // redirects them to their own csr-team-leader-dashboard
  "csr-team-leader-dashboard", // the personal dashboard that redirect lands on
  "live-chat-support",
]);

/**
 * Admin-module submodules that are open to every role regardless of the CSR
 * restriction — mirrors ALL_ROLES_ADMIN_SUBMODULES in
 * m.$module.$submodule.tsx (the admin-gate carve-out for company-wide
 * utilities, e.g. the internal team messenger). Without this, the CSR gate
 * below still blocks it since "admin" isn't in CSR_ALLOWED_MODULES, even
 * though the admin-role gate itself already treats it as open to everyone —
 * MessagesMenu.tsx links straight to this submodule from the header, so a
 * CSR Manager clicking it hits this check directly, never the module tile list.
 */
const CSR_EXEMPT_ADMIN_SUBMODULES = new Set(["internal-message-support"]);

/**
 * Restricted only if EVERY role this person holds is CSR-restricted — a
 * secondary role outside the CSR department (e.g. also holding ADMIN, or
 * CLAIMS_MANAGER) lifts the restriction entirely, same "any unrestricted
 * role wins" pile-up logic as everywhere else in this file.
 */
export function isCsrRestrictedRole(role: string | null | undefined, extraRoles?: string[] | null): boolean {
  return everyHeldRoleIn(CSR_RESTRICTED_ROLES, role, extraRoles);
}

/** Whether a CSR department role may open this module at all. Non-CSR roles always pass. */
export function isModuleAllowed(role: string | null | undefined, moduleSlug: string, extraRoles?: string[] | null): boolean {
  if (!isCsrRestrictedRole(role, extraRoles)) return true;
  return CSR_ALLOWED_MODULES.has(moduleSlug);
}

/** Whether a CSR department role may open this submodule. Non-CSR roles always pass. */
export function isSubmoduleAllowed(role: string | null | undefined, moduleSlug: string, submoduleSlug: string, extraRoles?: string[] | null): boolean {
  if (!isCsrRestrictedRole(role, extraRoles)) return true;
  if (moduleSlug === "admin" && CSR_EXEMPT_ADMIN_SUBMODULES.has(submoduleSlug)) return true;
  if (!isModuleAllowed(role, moduleSlug, extraRoles)) return false;
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
  "SENIOR_MANAGER",
  "BRANCH_MANAGER",
  "SENIOR_BRANCH_MANAGER",
  "BIZOPS_MANAGER",
  "BIZOPS_SENIOR_MANAGER",
  "TRIAGE_MANAGER",
  "CLAIMS_MANAGER",
]);

export function canManageMisdiagnosed(role: string | null | undefined, extraRoles?: string[] | null): boolean {
  return anyHeldRoleIn(MISDIAGNOSED_ROLES, role, extraRoles);
}

/**
 * Is this the per-company SUPERADMIN role (primary or extra)? Mirrors the
 * SQL is_company_superadmin() helper (0099_role_hierarchy_split.sql) —
 * SUPERSUPERADMIN (the platform-level role) also passes, since it can
 * reach the same content as a superset, though it rarely needs to.
 */
export function isCompanySuperAdminRole(
  role: string | null | undefined,
  extraRoles?: string[] | null
): boolean {
  const primary = normalizeRole(role);
  if (primary === "SUPERADMIN" || primary === "SUPERSUPERADMIN") return true;
  return (extraRoles ?? []).some((r) => normalizeRole(r) === "SUPERADMIN");
}

/**
 * Roles that may submit a warning/mistake conduct note about an employee
 * (employee_conduct_notes — see csrAgentNotes.ts). Any manager-flavored
 * role, not just CSR management, since the same two-stage review workflow
 * covers every department. Shared by CsrAgentDetailPage (per-employee
 * detail page) and the Attendance Monitoring page's Warnings tab.
 */
const CONDUCT_NOTE_SUBMITTER_ROLES = new Set([
  "CSR_TEAM_LEADER", "CSR_MANAGER", "MANAGER", "SENIOR_MANAGER", "ADMIN", "SUPERADMIN", "HR",
  "BRANCH_MANAGER", "SENIOR_BRANCH_MANAGER", "TECHNICIAN_MANAGER",
  "CLAIMS_MANAGER", "PARTS_MANAGER", "PARTS_TEAM_LEADER", "BIZOPS_MANAGER", "BIZOPS_SENIOR_MANAGER",
]);

export function canSubmitConductNote(role: string | null | undefined, extraRoles?: string[] | null): boolean {
  return anyHeldRoleIn(CONDUCT_NOTE_SUBMITTER_ROLES, role, extraRoles);
}

/**
 * Stage 2 (final/HR-tier) reviewers — their own submissions fast-track
 * straight to 'approved' since they already hold final review authority
 * and routing through a department manager first would be redundant.
 */
const CONDUCT_NOTE_FAST_TRACK_ROLES = new Set(["HR", "ADMIN", "SUPERADMIN"]);

export function canFastTrackConductNote(role: string | null | undefined, extraRoles?: string[] | null): boolean {
  return anyHeldRoleIn(CONDUCT_NOTE_FAST_TRACK_ROLES, role, extraRoles);
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

export function canFilterDataClosedTickets(role: string | null | undefined, extraRoles?: string[] | null): boolean {
  return anyHeldRoleIn(DATA_CLOSE_FILTER_ROLES, role, extraRoles);
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
const JOTFORM_HR_ROLES = new Set(["HR", "ADMIN", "SUPERADMIN", "MANAGER", "SENIOR_MANAGER"]);

export function isJotformHrRole(role: string | null | undefined, extraRoles?: string[] | null): boolean {
  return anyHeldRoleIn(JOTFORM_HR_ROLES, role, extraRoles);
}

/**
 * "Manager tier" for Attendance Monitoring: every department-manager-flavored
 * role. These roles see only their own direct reports on that page (resolved
 * via manager_name / CSR team leadership — see notifyRouting.ts), unlike
 * ADMIN/SUPERADMIN/HR/FINANCE who continue to see the whole company.
 */
const ATTENDANCE_MANAGER_TIER_ROLES = new Set([
  "MANAGER",
  "SENIOR_MANAGER",
  "TECHNICIAN_MANAGER",
  "CSR_MANAGER",
  "CSR_TEAM_LEADER",
  "BRANCH_MANAGER",
  "SENIOR_BRANCH_MANAGER",
  "PARTS_MANAGER",
  "PARTS_TEAM_LEADER",
  "CLAIMS_MANAGER",
  "TRIAGE_MANAGER",
  "BIZOPS_MANAGER",
  "BIZOPS_SENIOR_MANAGER",
]);

export function isAttendanceManagerTierRole(role: string | null | undefined, extraRoles?: string[] | null): boolean {
  return anyHeldRoleIn(ATTENDANCE_MANAGER_TIER_ROLES, role, extraRoles);
}

/** Array form for spreading into a DASHBOARD_ROLE_GATES entry. */
export const ATTENDANCE_MANAGER_TIER_ROLES_ARRAY = Array.from(ATTENDANCE_MANAGER_TIER_ROLES);
