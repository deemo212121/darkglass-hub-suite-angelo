/**
 * Resolves who a "Notify Team Lead" checkbox actually reaches: the CSR Team
 * Composition's assigned leader for CSR roles, or the free-text `manager_name`
 * (matched against real profiles by display name) for everyone else.
 */

import { getCsrTeamComposition, type CsrTeamComposition } from "@/lib/supabase/csrTeams";
import type { ProfileRow } from "@/lib/supabase/users";
import { isAttendanceManagerTierRole } from "@/lib/roleLabels";

const CSR_ROLES = new Set(["CSR", "CSR_AGENT", "CSR_TEAM_LEADER", "CSR_MANAGER"]);

function isCsrRoleValue(role: string): boolean {
  return CSR_ROLES.has(role) || role.startsWith("CSR");
}

/** True if the profile's primary role OR any held extra_roles entry is CSR-flavored. */
function isCsrRole(profile: Pick<ProfileRow, "role" | "extra_roles">): boolean {
  return [profile.role, ...(profile.extra_roles ?? [])].some((r) => isCsrRoleValue(r || ""));
}

/**
 * @param profile the employee the note is about
 * @param allProfiles the full company roster, used to resolve manager_name / team-lead ids to real profiles
 */
export async function resolveTeamLeadOrManager(
  profile: ProfileRow,
  allProfiles: ProfileRow[]
): Promise<ProfileRow | null> {
  if (isCsrRole(profile)) {
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

/**
 * Attendance Monitoring's row-visibility scope: `null` means unrestricted
 * (Admin/SuperAdmin/HR/Finance see the whole company). Otherwise the set of
 * profile ids a manager-tier viewer (see isAttendanceManagerTierRole) may
 * see — their own row, anyone whose manager_name resolves to them, and (for
 * CSR Manager/Team Leader) anyone on a CSR team they lead.
 */
export function visibleAttendanceProfileIds(
  viewer: ProfileRow,
  allProfiles: ProfileRow[],
  csrComposition: CsrTeamComposition | null
): Set<string> | null {
  if (!isAttendanceManagerTierRole(viewer.role, viewer.extra_roles)) return null;

  const ids = new Set<string>([viewer.id]);
  const viewerName = (viewer.display_name || "").trim().toLowerCase();
  if (viewerName) {
    allProfiles.forEach((p) => {
      if ((p.manager_name || "").trim().toLowerCase() === viewerName) ids.add(p.id);
    });
  }
  if (csrComposition && isCsrRole(viewer)) {
    const myLeaderTeamIds = new Set(
      csrComposition.members.filter((m) => m.profileId === viewer.id && m.isLeader).map((m) => m.teamId)
    );
    if (myLeaderTeamIds.size > 0) {
      csrComposition.members
        .filter((m) => myLeaderTeamIds.has(m.teamId))
        .forEach((m) => ids.add(m.profileId));
    }
  }
  return ids;
}
