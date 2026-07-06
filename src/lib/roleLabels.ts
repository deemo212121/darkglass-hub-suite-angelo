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
