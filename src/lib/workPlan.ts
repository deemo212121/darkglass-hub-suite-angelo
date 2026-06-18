/**
 * Work Plan model + access helpers.
 *
 * A user's work plan defines, per location, whether they work weekdays/weekends
 * and the AM/PM slot per day. It also doubles as a LOCATION ACCESS restriction:
 * a user can only see tickets / work map for locations where weekday OR weekend
 * is enabled.
 */

export const WORK_PLAN_DAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;

export const SLOT_OPTIONS = ["AM", "PM", "AM + PM"] as const;
export type SlotValue = (typeof SLOT_OPTIONS)[number];

export interface LocationWorkPlan {
  weekday: boolean;
  weekend: boolean;
  days: Record<string, SlotValue>;
}

export type WorkPlan = Record<string, LocationWorkPlan>;

export function buildDefaultLocationPlan(): LocationWorkPlan {
  const days: Record<string, SlotValue> = {};
  for (const d of WORK_PLAN_DAYS) days[d] = "AM + PM";
  return { weekday: false, weekend: false, days };
}

/** Ensure every location has an entry (used when rendering the grid). */
export function normalizeWorkPlan(plan: WorkPlan | null | undefined, locations: string[]): WorkPlan {
  const out: WorkPlan = {};
  for (const loc of locations) {
    const existing = plan?.[loc];
    if (existing) {
      out[loc] = {
        weekday: Boolean(existing.weekday),
        weekend: Boolean(existing.weekend),
        days: { ...buildDefaultLocationPlan().days, ...(existing.days || {}) },
      };
    } else {
      out[loc] = buildDefaultLocationPlan();
    }
  }
  return out;
}

/**
 * The set of locations a user may access: any location where weekday or weekend
 * is enabled in their work plan. Returns null to mean "no restriction" (e.g.
 * an empty/unset plan for admins) — callers decide how to treat null.
 */
export function accessibleLocations(plan: WorkPlan | null | undefined): string[] | null {
  if (!plan || Object.keys(plan).length === 0) return null;
  const locs = Object.entries(plan)
    .filter(([, v]) => v && (v.weekday || v.weekend))
    .map(([loc]) => loc);
  return locs;
}

/** Roles that bypass the work-plan location restriction (see everything). */
// Only TECHNICIAN is restricted by the work plan for now. Everyone else sees
// all locations (you can still untick their boxes later to restrict them).
const RESTRICTED_ROLES = new Set(["TECHNICIAN"]);

/**
 * Whether `role` is restricted by the work plan. Currently only TECHNICIAN is
 * limited to their planned locations; all other roles see every location.
 */
export function isLocationRestrictedRole(role: string | null | undefined): boolean {
  if (!role) return false;
  return RESTRICTED_ROLES.has(role);
}
