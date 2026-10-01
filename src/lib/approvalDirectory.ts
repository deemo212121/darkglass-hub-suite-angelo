/**
 * Approval Chain — app-side mirror of the database rules in migration 0329
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
}

let registry: ChainData = { byId: new Map(), sbmBranches: [] };

export async function registerApprovalDirectory(profiles: ProfileRow[]): Promise<void> {
  registry = { ...registry, byId: new Map(profiles.map((p) => [p.id, p])) };
  try {
    registry = { ...registry, sbmBranches: await getSeniorBranchManagerAssignments() };
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
  const level = chainLevelOf(r);
  if (!level) return null;
  const v = viewerId ? data.byId.get(viewerId) : undefined;
  if (!v || v.id === r.id) return false;
  const roles = heldRoles(v);
  const has = (...xs: string[]) => xs.some((x) => roles.includes(x));
  if (has("SUPERADMIN", "SUPERSUPERADMIN")) return true;
  const top = has("ADMIN", "TECHNICAL_DIRECTOR", "TECHNICAL_ASSISTANT_DIRECTOR");
  const sameBranch = !!normBranch(v.assigned_branch) && normBranch(v.assigned_branch) === normBranch(r.assigned_branch);
  switch (level) {
    case "tech":
      return top || (has("BRANCH_MANAGER", "PARTS_MANAGER", "PARTS_TEAM_LEADER", "PARTS") && sameBranch) || ownsBranch(data, v.id, r.assigned_branch);
    case "branch":
      return top || ownsBranch(data, v.id, r.assigned_branch);
    case "sbm":
      return top;
    case "atd":
      return has("ADMIN", "TECHNICAL_DIRECTOR");
    case "td":
      return has("ADMIN");
  }
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

/** Everyone who can approve this requester's Manager step, grouped by tier — for previews. */
export function chainApproverGroups(data: ChainData, requesterId: string): { label: string; people: ProfileRow[] }[] | null {
  const r = data.byId.get(requesterId);
  if (!r || !chainLevelOf(r)) return null;
  const active = [...data.byId.values()].filter((p) => p.is_active && p.id !== r.id);
  const can = (p: ProfileRow) => chainCanApproveWith(data, p.id, r.id) === true;
  const roles = (p: ProfileRow) => heldRoles(p);
  const isSuper = (p: ProfileRow) => roles(p).some((x) => x === "SUPERADMIN" || x === "SUPERSUPERADMIN");
  const isTop = (p: ProfileRow) => roles(p).some((x) => x === "ADMIN" || x === "TECHNICAL_DIRECTOR" || x === "TECHNICAL_ASSISTANT_DIRECTOR");
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
