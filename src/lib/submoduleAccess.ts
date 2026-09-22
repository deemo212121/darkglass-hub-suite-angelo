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
import { isSubmoduleAllowed, isSubmoduleAllowedForTrainee, isSubmoduleAllowedForFrozen, isCompanySuperAdminRole } from "./roleLabels";
import { getDashboardRoleGate, hasDashboardAccess } from "./dashboardAccess";
import { getModuleRoleGate } from "./moduleAccess";

export const ADMIN_MODULE_ROLES = ["ADMIN", "SUPERADMIN"];
// DEFAULTS only, not floors — a company can widen or narrow any of these
// three from Accessibility Management (module "admin", the matching
// submodule slug) exactly like any other page, via module_role_gate_
// overrides. This list is only what a company gets until it configures its
// own; see canAccessSubmodule below, which checks explicitModuleOverride
// first and falls back to these.
export const USER_MANAGEMENT_DEFAULT_ROLES = ["HR", "FINANCE", "MANAGER", "SENIOR_BRANCH_MANAGER", "ADMIN", "SUPERADMIN"];
export const ACTIVITY_LOG_DEFAULT_ROLES = ["SENIOR_BRANCH_MANAGER", "ADMIN", "SUPERADMIN"];
// Technical Director oversees dispatch/route visibility company-wide, same
// operational reason Senior Branch Manager already gets a broader default
// above for Activity Logs — full Admin access isn't needed just to see
// where technicians are.
export const WHEREABOUTS_DEFAULT_ROLES = ["TECHNICAL_DIRECTOR", "ADMIN", "SUPERADMIN"];
// Admin-module submodules open to everyone regardless of the admin gate —
// company-wide utilities, same carve-out as m.$module.$submodule.tsx's own.
const ALL_ROLES_ADMIN_SUBMODULES = new Set(["internal-message-support"]);

export function canAccessSubmodule(
  role: string | null | undefined,
  extraRoles: string[] | null | undefined,
  moduleSlug: string,
  sub: { slug: string; custom?: string },
  isTrainee?: boolean,
  isFrozen?: boolean
): boolean {
  if (isTrainee && !isSubmoduleAllowedForTrainee(isTrainee, moduleSlug, sub.slug)) return false;
  if (isFrozen && !isSubmoduleAllowedForFrozen(isFrozen, moduleSlug, sub.slug)) return false;

  const explicitModuleOverride = getModuleRoleGate(moduleSlug, sub.slug);
  // Kept in sync with m.$module.$submodule.tsx's identical moduleAllowedRoles
  // line — "accounting" and "csr" are included alongside "dashboard"/"hr" so
  // accounting-dashboard's and daily-report/team-composition's hardcoded
  // defaults still apply here (the floating quick-nav) even though they
  // moved out of the Dashboard module into their own Accounting/CSR
  // modules (see modules.ts).
  const moduleAllowedRoles = (moduleSlug === "dashboard" || moduleSlug === "hr" || moduleSlug === "accounting" || moduleSlug === "csr") ? getDashboardRoleGate(sub.slug) : explicitModuleOverride;

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

  if (isUserManagementSubmodule && !hasDashboardAccess(explicitModuleOverride ?? USER_MANAGEMENT_DEFAULT_ROLES, role, extraRoles)) return false;
  if (isActivityLogSubmodule && !hasDashboardAccess(explicitModuleOverride ?? ACTIVITY_LOG_DEFAULT_ROLES, role, extraRoles)) return false;
  if (isWhereaboutsSubmodule && !hasDashboardAccess(explicitModuleOverride ?? WHEREABOUTS_DEFAULT_ROLES, role, extraRoles)) return false;
  if (sub.custom === "company-settings" && !isCompanySuperAdminRole(role, extraRoles)) return false;

  // Same carve-out as the admin-module gate above (ALL_ROLES_ADMIN_SUBMODULES)
  // — internal-message-support must stay unrestrictable even if a company
  // configures a role-gate override for it via Accessibility Management,
  // which doesn't know this submodule is meant to be exempt. See
  // m.$module.$submodule.tsx's identical moduleAccessOk exemption.
  const isAllRolesAdminSubmodule = moduleSlug === "admin" && ALL_ROLES_ADMIN_SUBMODULES.has(sub.slug);
  if (moduleAllowedRoles && !isAllRolesAdminSubmodule && !hasDashboardAccess(moduleAllowedRoles, role, extraRoles)) return false;

  return true;
}
