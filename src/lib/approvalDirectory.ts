/**
 * Approval Chain — app-side mirror of the database rules in migration 0332
 * (chain_can_approve / chain_can_clock_in). The database is what actually
 * enforces them (triggers on timecard_corrections, pto_requests and
 * timecard_entries); this copy only decides which buttons/rows to show so
 * people don't see actions the server would refuse.
 *
 * Scope: NON-Philippines staff in the chain roles (see chainLevel). Anyone
 * else returns null = "not governed" and keeps the existing rules.
 *
 * Data: getCompanyUsers() registers the company's profiles here and loads
 * senior_branch_manager_branches (which SBM owns which branch) before it
 * returns, so every screen that already loads users gets both.
 */
import type { ProfileRow } from "@/lib/supabase/users";
import { getSeniorBranchManagerAssignments, type SbmBranchAssignment } from "@/lib/supabase/seniorBranchManagerAssignments";
import { getTopApproverIds, getPhDepartmentManagers, type PhDepartmentManagerRow } from "@/lib/supabase/approvalAreas";

export type ChainLevel = "tech" | "branch" | "sbm" | "atd" | "td";

const LEVEL_BY_ROLE: Record<string, ChainLevel> = {
  TECHNICIAN: "tech",
  TECHNICIAN_MANAGER: "tech",
  BRANCH_MANAGER: "branch",
  PARTS_MANAGER: "branch",
  PARTS_TEAM_LEADER: "branch",
  PARTS: "branch",
  SENIOR_BRANCH_MANAGER: "sbm",
  TECHNICAL_ASSISTANT_DIRECTOR: "atd",
  TECHNICAL_DIRECTOR: "td",
};

export const CHAIN_LEVEL_LABEL: Record<ChainLevel, string> = {
  tech: "Technician",
  branch: "Branch (BM / Parts)",
  sbm: "Senior Branch Manager",
  atd: "Technical Assistant Director",
  td: "Technical Director",
};

/** Same normalization as the SQL chain_norm_branch — "Jackson,MS" = "Jackson, MS". */
export function normBranch(b: string | null | undefined): string {
  return (b ?? "").trim().replace(/\s*,\s*/g, ", ").toLowerCase();
}

const heldRoles = (p: Pick<ProfileRow, "role" | "extra_roles">) =>
  [p.role, ...(p.extra_roles ?? [])].filter(Boolean).map((r) => String(r).toUpperCase());

const LEVEL_RANK: Record<ChainLevel, number> = { tech: 1, branch: 2, sbm: 3, atd: 4, td: 5 };

/**
 * The person's level in the chain from ALL roles they hold (primary + extra),
 * highest wins — e.g. a Parts Team Leader who also holds Parts Manager is
 * branch level, same as a Branch Manager. null when not governed: PH staff,
 * other departments, or Admin / SuperAdmin as the primary role. Mirrors SQL
 * chain_level_held.
 */
export function chainLevelOf(p: Pick<ProfileRow, "role" | "extra_roles" | "assigned_branch">): ChainLevel | null {
  if (normBranch(p.assigned_branch) === "philippines") return null;
  if (["ADMIN", "SUPERADMIN", "SUPERSUPERADMIN"].includes(String(p.role || "").toUpperCase())) return null;
  let best: ChainLevel | null = null;
  for (const r of heldRoles(p)) {
    const l = LEVEL_BY_ROLE[r];
    if (l && (!best || LEVEL_RANK[l] > LEVEL_RANK[best])) best = l;
  }
  return best;
}

export interface ChainData {
  byId: Map<string, ProfileRow>;
  sbmBranches: SbmBranchAssignment[];
  /** Explicit top-level approvers (migration 0333) — empty means the role-based default. */
  topApproverIds?: string[];
  /** PH department manager lists (migration 0334) — a department with none uses the role default. */
  phDeptManagers?: PhDepartmentManagerRow[];
}

// ---- Philippines (migration 0334): department managers, no branches ----------
const PH_DEPT_BY_ROLE: Record<string, string> = {
  CSR: "CSR", CSR_AGENT: "CSR", CSR_TEAM_LEADER: "CSR", CSR_MANAGER: "CSR",
  CLAIMS: "Claims", CLAIMS_TEAM_LEADER: "Claims", CLAIMS_MANAGER: "Claims",
  PARTS: "Parts", PARTS_ORDER: "Parts", PARTS_TEAM_LEADER: "Parts", PARTS_MANAGER: "Parts",
  BIZOPS_MANAGER: "BizOps", BIZOPS_SENIOR_MANAGER: "BizOps",
  TRIAGE_USER: "Triage", TRIAGE_MANAGER: "Triage",
  MANAGER: "Management", SENIOR_MANAGER: "Management",
  FINANCE: "Accounting", HR: "HR", IT: "IT", DISPATCHER: "Dispatch",
  TECHNICIAN: "Technician", TECHNICIAN_MANAGER: "Technician", TECHNICAL_DIRECTOR: "Technician",
  TECHNICAL_ASSISTANT_DIRECTOR: "Technician", BRANCH_MANAGER: "Technician", SENIOR_BRANCH_MANAGER: "Technician",
};
const PH_DEPT_MANAGER_ROLES: Record<string, string[]> = {
  CSR: ["CSR_MANAGER"],
  Claims: ["CLAIMS_MANAGER"],
  Parts: ["PARTS_MANAGER"],
  BizOps: ["BIZOPS_SENIOR_MANAGER", "BIZOPS_MANAGER"],
  Triage: ["TRIAGE_MANAGER"],
  Management: ["SENIOR_MANAGER", "MANAGER"],
  Technician: ["TECHNICIAN_MANAGER"],
};

/** A PH person's department from their primary role — mirrors SQL chain_department. */
export function phDepartmentOf(p: Pick<ProfileRow, "role">): string {
  return PH_DEPT_BY_ROLE[String(p.role || "").toUpperCase()] ?? "Other";
}

/** PH staff governed by the PH chain (not Admin / SuperAdmin as the primary role). */
export function isPhGoverned(p: Pick<ProfileRow, "role" | "assigned_branch">): boolean {
  return normBranch(p.assigned_branch) === "philippines" && !["ADMIN", "SUPERADMIN", "SUPERSUPERADMIN"].includes(String(p.role || "").toUpperCase());
}

/** Mirrors SQL chain_is_ph_department_manager. */
export function isPhDepartmentManager(data: ChainData, p: ProfileRow, department: string): boolean {
  const list = (data.phDeptManagers ?? []).filter((m) => m.department === department);
  if (list.length > 0) return list.some((m) => m.profileId === p.id);
  if (!p.is_active || normBranch(p.assigned_branch) !== "philippines") return false;
  const mgrRoles = PH_DEPT_MANAGER_ROLES[department] ?? [];
  if (mgrRoles.includes(String(p.role || "").toUpperCase())) return true;
  return phDepartmentOf(p) === department && (p.extra_roles ?? []).some((r) => mgrRoles.includes(String(r).toUpperCase()));
}

/** Everyone who manages a PH department (explicit list or role default). */
export function phDepartmentManagers(data: ChainData, department: string): ProfileRow[] {
  return [...data.byId.values()].filter((p) => isPhDepartmentManager(data, p, department));
}

let registry: ChainData = { byId: new Map(), sbmBranches: [], topApproverIds: [], phDeptManagers: [] };

/** Top level: on the explicit list when it has anyone, else holds Admin / Technical Director / Asst. Director. Mirrors SQL chain_is_top. */
export function isTopApprover(data: ChainData, p: Pick<ProfileRow, "id" | "role" | "extra_roles">): boolean {
  const list = data.topApproverIds ?? [];
  if (list.length > 0) return list.includes(p.id);
  return heldRoles(p).some((r) => r === "ADMIN" || r === "TECHNICAL_DIRECTOR" || r === "TECHNICAL_ASSISTANT_DIRECTOR");
}

export async function registerApprovalDirectory(profiles: ProfileRow[]): Promise<void> {
  registry = { ...registry, byId: new Map(profiles.map((p) => [p.id, p])) };
  try {
    const [sbmBranches, topApproverIds, phDeptManagers] = await Promise.all([getSeniorBranchManagerAssignments(), getTopApproverIds(), getPhDepartmentManagers()]);
    registry = { ...registry, sbmBranches, topApproverIds, phDeptManagers };
  } catch (err) {
    console.error("Approval chain: couldn't load Senior Branch Manager branches:", err);
  }
}

export function ownsBranch(data: ChainData, sbmId: string, branch: string | null | undefined): boolean {
  const b = normBranch(branch);
  return !!b && data.sbmBranches.some((s) => s.profileId === sbmId && normBranch(s.branch) === b);
}

export function branchOwner(data: ChainData, branch: string | null | undefined): ProfileRow | null {
  const b = normBranch(branch);
  const row = b ? data.sbmBranches.find((s) => normBranch(s.branch) === b) : null;
  return row ? data.byId.get(row.profileId) ?? null : null;
}

/** Pure version — same logic as SQL chain_can_approve. null = not governed. */
export function chainCanApproveWith(data: ChainData, viewerId: string | null | undefined, requesterId: string | null | undefined): boolean | null {
  const r = requesterId ? data.byId.get(requesterId) : undefined;
  if (!r) return null;
  if (normBranch(r.assigned_branch) === "philippines") return phCanApproveWith(data, viewerId, r);
  const level = chainLevelOf(r);
  if (!level) return null;
  const v = viewerId ? data.byId.get(viewerId) : undefined;
  if (!v || v.id === r.id) return false;
  const roles = heldRoles(v);
  const has = (...xs: string[]) => xs.some((x) => roles.includes(x));
  if (has("SUPERADMIN", "SUPERSUPERADMIN")) return true;
  const top = isTopApprover(data, v);
  const hasTopList = (data.topApproverIds ?? []).length > 0;
  const sameBranch = !!normBranch(v.assigned_branch) && normBranch(v.assigned_branch) === normBranch(r.assigned_branch);
  switch (level) {
    case "tech":
      return top || (has("BRANCH_MANAGER", "PARTS_MANAGER", "PARTS_TEAM_LEADER", "PARTS") && sameBranch) || ownsBranch(data, v.id, r.assigned_branch);
    case "branch":
      return top || ownsBranch(data, v.id, r.assigned_branch);
    case "sbm":
      return top;
    case "atd":
      return hasTopList ? top : has("ADMIN", "TECHNICAL_DIRECTOR");
    case "td":
      return hasTopList ? top : has("ADMIN");
  }
}

/** PH Manager step — mirrors SQL chain_ph_can_approve: the department's manager(s) or the top level; Team Leaders don't approve; a manager's own request goes to the top level. */
function phCanApproveWith(data: ChainData, viewerId: string | null | undefined, r: ProfileRow): boolean | null {
  if (!isPhGoverned(r)) return null;
  const v = viewerId ? data.byId.get(viewerId) : undefined;
  if (!v || v.id === r.id) return false;
  const roles = heldRoles(v);
  if (roles.includes("SUPERADMIN") || roles.includes("SUPERSUPERADMIN")) return true;
  if (isTopApprover(data, v)) return true;
  const dept = phDepartmentOf(r);
  if (isPhDepartmentManager(data, r, dept)) return false;
  return isPhDepartmentManager(data, v, dept);
}

/** Pure version — same logic as SQL chain_can_clock_in. null = not governed. */
export function chainCanClockInWith(data: ChainData, viewerId: string | null | undefined, targetId: string | null | undefined): boolean | null {
  const t = targetId ? data.byId.get(targetId) : undefined;
  if (!t) return null;
  const level = chainLevelOf(t);
  if (!level) return null;
  const v = viewerId ? data.byId.get(viewerId) : undefined;
  if (!v) return false;
  const roles = heldRoles(v);
  const has = (...xs: string[]) => xs.some((x) => roles.includes(x));
  if (has("SUPERADMIN", "SUPERSUPERADMIN", "ADMIN", "HR", "FINANCE", "TECHNICAL_DIRECTOR", "TECHNICAL_ASSISTANT_DIRECTOR")) return true;
  // The Approval Chain's top level clocks in at every branch (migration 0340).
  if (isTopApprover(data, v)) return true;
  const sameBranch = !!normBranch(v.assigned_branch) && normBranch(v.assigned_branch) === normBranch(t.assigned_branch);
  if (level === "tech") return (has("PARTS", "PARTS_TEAM_LEADER", "PARTS_MANAGER", "BRANCH_MANAGER") && sameBranch) || ownsBranch(data, v.id, t.assigned_branch);
  if (level === "branch") return ownsBranch(data, v.id, t.assigned_branch);
  return false;
}

/** Uses the registered company data. */
export function chainCanApprove(viewerId: string | null | undefined, requesterId: string | null | undefined): boolean | null {
  return chainCanApproveWith(registry, viewerId, requesterId);
}

export function chainCanClockIn(viewerId: string | null | undefined, targetId: string | null | undefined): boolean | null {
  return chainCanClockInWith(registry, viewerId, targetId);
}

/** Is this person on the Approval Chain's top level (registered company data)? They can clock in technicians at every branch. */
export function isChainTopApprover(profileId: string | null | undefined): boolean {
  const p = profileId ? registry.byId.get(profileId) : undefined;
  return !!p && p.is_active !== false && isTopApprover(registry, p);
}

/** Everyone who can approve this requester's Manager step, grouped by tier — for previews. */
export function chainApproverGroups(data: ChainData, requesterId: string): { label: string; people: ProfileRow[] }[] | null {
  const r = data.byId.get(requesterId);
  if (!r || !chainLevelOf(r)) return null;
  const active = [...data.byId.values()].filter((p) => p.is_active && p.id !== r.id);
  const can = (p: ProfileRow) => chainCanApproveWith(data, p.id, r.id) === true;
  const roles = (p: ProfileRow) => heldRoles(p);
  const isSuper = (p: ProfileRow) => roles(p).some((x) => x === "SUPERADMIN" || x === "SUPERSUPERADMIN");
  const isTop = (p: ProfileRow) => isTopApprover(data, p);
  const branchLevel = active.filter((p) => can(p) && !isSuper(p) && !isTop(p) && !ownsBranch(data, p.id, r.assigned_branch));
  const sbm = active.filter((p) => can(p) && !isSuper(p) && !isTop(p) && ownsBranch(data, p.id, r.assigned_branch));
  const top = active.filter((p) => can(p) && !isSuper(p) && isTop(p));
  return [
    { label: "Branch", people: branchLevel },
    { label: "Senior Branch Manager", people: sbm },
    { label: "Admin / Technical Director / Asst. Director", people: top },
  ].filter((g) => g.people.length > 0);
}

export function getChainData(): ChainData {
  return registry;
}
