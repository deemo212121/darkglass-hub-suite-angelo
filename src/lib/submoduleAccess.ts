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
import { getModuleRoleGate, MODULE_LEVEL_GATE_SLUG } from "./moduleAccess";

const DASHBOARD_FAMILY_MODULES = new Set(["dashboard", "hr", "accounting", "csr"]);

/**
 * The per-page role list a (module, submodule) is gated by. A company
 * override saved against the page's REAL module (what Accessibility
 * Management writes, e.g. ("accounting", "expenses")) always wins. Only
 * when there's none do the Dashboard-family modules fall back to
 * getDashboardRoleGate's hardcoded defaults — which look overrides up under
 * the "dashboard" namespace for most slugs, so using it FIRST (as this used
 * to) silently ignored a real ("accounting", "expenses") override and read
 * Accounting → Expenses as open to every role.
 */
export function resolveSubmoduleAllowedRoles(moduleSlug: string, subSlug: string, explicitModuleOverride: string[] | null): string[] | null {
  if (explicitModuleOverride) return explicitModuleOverride;
  return DASHBOARD_FAMILY_MODULES.has(moduleSlug) ? getDashboardRoleGate(subSlug) : null;
}

/**
 * The module's "Whole Module" gate (Accessibility Management's module-level
 * box, stored under MODULE_LEVEL_GATE_SLUG). When set it's authoritative for
 * every page inside the module — same rule home.tsx and m.$module.tsx
 * already apply to the module tile/grid. The submodule route never checked
 * it, so a pasted /m/accounting/expenses link opened for a role locked out
 * of Accounting entirely.
 */
export function passesModuleLevelGate(role: string | null | undefined, extraRoles: string[] | null | undefined, moduleSlug: string): boolean {
  // Admin is exempt: it already has its own dedicated page gate (Admin/
  // SuperAdmin plus per-page carve-outs for IT Tickets, User Management,
  // Activity Logs, Technician Whereabouts, Messages), and its module-level
  // list is narrower than those carve-outs — applying it here would bounce
  // IT out of IT Tickets, HR out of User Management, etc.
  if (moduleSlug === "admin") return true;
  const moduleLevelGate = getModuleRoleGate(moduleSlug, MODULE_LEVEL_GATE_SLUG);
  return !moduleLevelGate || hasDashboardAccess(moduleLevelGate, role, extraRoles);
}

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

  const isAllRolesAdminSubmodule = moduleSlug === "admin" && ALL_ROLES_ADMIN_SUBMODULES.has(sub.slug);
  if (!passesModuleLevelGate(role, extraRoles, moduleSlug)) return false;

  const explicitModuleOverride = getModuleRoleGate(moduleSlug, sub.slug);
  // Same resolver m.$module.$submodule.tsx uses — keep them identical.
  const moduleAllowedRoles = resolveSubmoduleAllowedRoles(moduleSlug, sub.slug, explicitModuleOverride);

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
  if (moduleAllowedRoles && !isAllRolesAdminSubmodule && !hasDashboardAccess(moduleAllowedRoles, role, extraRoles)) return false;

  return true;
}
