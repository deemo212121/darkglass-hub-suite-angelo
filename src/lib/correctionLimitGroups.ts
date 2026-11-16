/**
 * Who Exceeded → Time Corrections lists (and so who its red badge may count):
 * active people in its groups — Philippines staff, BM and up, technicians and
 * Parts. Shared by the tab and the badge (lib/attention.ts) so the two never
 * disagree — before, the badge counted anyone (deactivated people, CSRs…)
 * and showed "1" over a list with nobody over the limit.
 */

import { BM_AND_UP_ROLES, TECHNICIAN_PAY_ROLES, normalizeRole } from "./roleLabels";

export const CORRECTION_LIMIT_PH_BRANCH = "Philippines";
export const CORRECTION_LIMIT_PARTS_ROLES = new Set(["PARTS", "PARTS_TEAM_LEADER", "PARTS_MANAGER", "PARTS_ORDER"]);

/** The person's group on the list ("PH", "TECHNICIAN", their BM-and-up or Parts role), or null when they aren't on it. */
export function correctionLimitGroupOf(p: { assigned_branch?: string | null; role?: string | null }): string | null {
  if (p.assigned_branch === CORRECTION_LIMIT_PH_BRANCH) return "PH";
  const role = normalizeRole(p.role ?? "");
  if (BM_AND_UP_ROLES.has(role)) return role;
  if (TECHNICIAN_PAY_ROLES.has(role)) return "TECHNICIAN";
  if (CORRECTION_LIMIT_PARTS_ROLES.has(role)) return role;
  return null;
}

/** On the list at all: active and in one of its groups. */
export const isOnCorrectionLimitList = (p: { is_active?: boolean | null; assigned_branch?: string | null; role?: string | null }) =>
  !!p.is_active && correctionLimitGroupOf(p) !== null;
