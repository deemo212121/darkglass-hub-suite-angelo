/**
 * Resolves who a "Notify Team Lead" checkbox actually reaches: the CSR Team
 * Composition's assigned leader for CSR roles, or the free-text `manager_name`
 * (matched against real profiles by display name) for everyone else.
 */

import { getCsrTeamComposition } from "@/lib/supabase/csrTeams";
import type { ProfileRow } from "@/lib/supabase/users";

const CSR_ROLES = new Set(["CSR", "CSR_AGENT", "CSR_TEAM_LEADER", "CSR_MANAGER"]);

function isCsrRole(role: string): boolean {
  return CSR_ROLES.has(role) || role.startsWith("CSR");
}

/**
 * @param profile the employee the note is about
 * @param allProfiles the full company roster, used to resolve manager_name / team-lead ids to real profiles
 */
export async function resolveTeamLeadOrManager(
  profile: ProfileRow,
  allProfiles: ProfileRow[]
): Promise<ProfileRow | null> {
  if (isCsrRole(profile.role)) {
    try {
      const { members } = await getCsrTeamComposition();
      const mine = members.find((m) => m.profileId === profile.id);
      if (mine) {
        const leader = members.find((m) => m.teamId === mine.teamId && m.isLeader);
        const leaderProfile = leader ? allProfiles.find((p) => p.id === leader.profileId) : null;
        if (leaderProfile) return leaderProfile;
      }
    } catch {
      // CSR team composition unavailable — fall through to manager_name match.
    }
  }

  const managerName = (profile.manager_name || "").trim().toLowerCase();
  if (!managerName) return null;
  return allProfiles.find((p) => (p.display_name || "").trim().toLowerCase() === managerName) ?? null;
}
