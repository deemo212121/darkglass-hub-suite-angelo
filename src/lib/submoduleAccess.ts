/**
 * Single source of truth for "can this role open this (module, submodule)"
 * — mirrors the step-by-step gate logic m.$module.$submodule.tsx actually
 * enforces (CSR restriction, admin-module gate with its it-tickets/
 * user-management/activity-log/internal-message-support carve-outs,
 * company-settings, and the generic Dashboard-hardcoded-or-DB-override
 * gate), collapsed into one synchronous boolean. Used by surfaces that
 * only LIST/LINK to submodules (home.tsx's module cards, ModuleNavigator's
 * quick-switch dropdown) so they don't advertise something the same user
 * would immediately be blocked from opening — that route's own checks
 * remain the actual enforcement; this is a read-only mirror of them, not a
 * replacement.
 */
import { isSubmoduleAllowed, isSubmoduleAllowedForTrainee, isCompanySuperAdminRole } from "./roleLabels";
import { getDashboardRoleGate, hasDashboardAccess } from "./dashboardAccess";
import { getModuleRoleGate } from "./moduleAccess";

export const ADMIN_MODULE_ROLES = ["ADMIN", "SUPERADMIN"];
export const USER_MANAGEMENT_ROLES = ["HR", "FINANCE", "MANAGER", "SENIOR_BRANCH_MANAGER", "ADMIN", "SUPERADMIN"];
export const ACTIVITY_LOG_ROLES = ["SENIOR_BRANCH_MANAGER", "ADMIN", "SUPERADMIN"];
// Technical Director oversees dispatch/route visibility company-wide, same
// operational reason Senior Branch Manager already gets a broader carve-out
// above for Activity Logs — full Admin access isn't needed just to see
// where technicians are.
export const WHEREABOUTS_ROLES = ["TECHNICAL_DIRECTOR", "ADMIN", "SUPERADMIN"];
// Admin-module submodules open to everyone regardless of the admin gate —
// company-wide utilities, same carve-out as m.$module.$submodule.tsx's own.
const ALL_ROLES_ADMIN_SUBMODULES = new Set(["internal-message-support"]);

export function canAccessSubmodule(
  role: string | null | undefined,
  extraRoles: string[] | null | undefined,
  moduleSlug: string,
  sub: { slug: string; custom?: string },
  isTrainee?: boolean
): boolean {
  if (isTrainee && !isSubmoduleAllowedForTrainee(isTrainee, moduleSlug, sub.slug)) return false;

  const explicitModuleOverride = getModuleRoleGate(moduleSlug, sub.slug);
  const moduleAllowedRoles = moduleSlug === "dashboard" ? getDashboardRoleGate(sub.slug) : explicitModuleOverride;

  if (!explicitModuleOverride && !isSubmoduleAllowed(role, moduleSlug, sub.slug, extraRoles)) return false;

  const isUserManagementSubmodule = sub.custom === "user-management";
  const isActivityLogSubmodule = sub.custom === "universal-activity-log";
  const isWhereaboutsSubmodule = sub.custom === "technician-whereabouts";
  const hasAdminAccess = hasDashboardAccess(ADMIN_MODULE_ROLES, role, extraRoles);
  const hasItTicketsAccess = sub.custom === "it-tickets" && hasDashboardAccess(getDashboardRoleGate("it-tickets") || [], role, extraRoles);

  if (
    moduleSlug === "admin" &&
    !hasAdminAccess &&
    !hasItTicketsAccess &&
    !ALL_ROLES_ADMIN_SUBMODULES.has(sub.slug) &&
    !isUserManagementSubmodule &&
    !isActivityLogSubmodule &&
    !isWhereaboutsSubmodule
  ) {
    return false;
  }

  if (isUserManagementSubmodule && !hasDashboardAccess(USER_MANAGEMENT_ROLES, role, extraRoles)) return false;
  if (isActivityLogSubmodule && !hasDashboardAccess(ACTIVITY_LOG_ROLES, role, extraRoles)) return false;
  if (isWhereaboutsSubmodule && !hasDashboardAccess(WHEREABOUTS_ROLES, role, extraRoles)) return false;
  if (sub.custom === "company-settings" && !isCompanySuperAdminRole(role, extraRoles)) return false;

  if (moduleAllowedRoles && !hasDashboardAccess(moduleAllowedRoles, role, extraRoles)) return false;

  return true;
}
