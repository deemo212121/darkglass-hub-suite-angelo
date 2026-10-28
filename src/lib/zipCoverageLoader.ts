/**
 * The company's Location Management ZIPs (location_mgmt_coverage), loaded
 * into the runtime ZIP lookup on top of the built-in map (registerZipCoverage)
 * — once per session, started at sign-in (auth.tsx). A page that judges
 * coverage awaits the same load, so a ZIP added in Location Management isn't
 * shown as out of coverage while the list is still on its way. `force`
 * re-reads it (No-Coverage Tickets' Refresh).
 */
import { getCoverage } from "./supabase/locationManagement";
import { registerZipCoverage } from "./zipCoverage";

let loading: Promise<number> | null = null;

/** Resolves to how many ZIPs were registered. */
export function ensureCompanyZipCoverage(force = false): Promise<number> {
  if (loading && !force) return loading;
  const p = getCoverage().then((rows) => {
    if (rows.length) {
      registerZipCoverage(
        rows.map((r) => ({ zipCode: r.zipCode, location: r.location, city: r.city, selfSchedule: r.selfSchedule, tierCode: r.tierCode })),
      );
    }
    return rows.length;
  });
  loading = p;
  p.catch(() => {
    if (loading === p) loading = null; // try again next time
  });
  return p;
}
