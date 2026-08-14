/**
 * Branch -> notified-role reverse lookup for the Parts hub's "Done"
 * button — a manager can cover more than one branch (e.g. two smaller
 * branches sharing one manager), and profiles.branch_access (already
 * used elsewhere for permission scoping — see parseBranchAccess in
 * lib/locations.ts) is the source of truth for which branch(es) that is,
 * rather than a new admin-maintained table.
 *
 * Which role(s) count as "the branch manager" is itself configurable —
 * see notificationRoleGates.ts's "parts_done_digest" trigger (defaults
 * to Parts Manager) — so this takes the effective role list as a param
 * instead of hardcoding PARTS_MANAGER.
 */
import { supabase } from "./client";
import { parseBranchAccess } from "@/lib/locations";

export interface PartsManagerBranches {
  firebaseUid: string;
  branches: string[]; // already expanded — parseBranchAccess turns "*" into every LOCATIONS entry
}

export async function getPartsManagerBranchRoster(roles: string[]): Promise<PartsManagerBranches[]> {
  if (roles.length === 0) return [];
  const orClause = roles.map((r) => `role.eq.${r},extra_roles.cs.{${r}}`).join(",");
  const { data, error } = await supabase
    .from("profiles")
    .select("firebase_uid, role, extra_roles, branch_access")
    .or(orClause);
  if (error) {
    console.error("getPartsManagerBranchRoster error:", error.message);
    return [];
  }
  return (data ?? [])
    .filter((r: any) => r.firebase_uid)
    .map((r: any) => ({
      firebaseUid: r.firebase_uid as string,
      branches: parseBranchAccess(r.branch_access),
    }));
}

/**
 * Groups the given branches by which manager(s) cover them. A manager
 * covering 2 of the touched branches appears once, with both branches
 * listed, so they get one combined notification instead of two. Any
 * branch nobody's branch_access covers comes back in
 * unassignedBranches so the caller can fall back to notifying the
 * whole role pool for it, instead of silently dropping it.
 */
export async function groupBranchesByManager(branches: string[], roles: string[]): Promise<{
  byManager: Map<string, string[]>;
  unassignedBranches: string[];
}> {
  const roster = await getPartsManagerBranchRoster(roles);
  const byManager = new Map<string, string[]>();
  const covered = new Set<string>();
  for (const branch of branches) {
    const managers = roster.filter((m) => m.branches.includes(branch));
    for (const m of managers) {
      const list = byManager.get(m.firebaseUid) ?? [];
      list.push(branch);
      byManager.set(m.firebaseUid, list);
      covered.add(branch);
    }
  }
  const unassignedBranches = branches.filter((b) => !covered.has(b));
  return { byManager, unassignedBranches };
}
