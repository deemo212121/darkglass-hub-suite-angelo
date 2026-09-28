/**
 * Flash Tech Grid — a CSR Main Dashboard tab, read-only. Same underlying
 * data as the Flash Tech Calendar (flash_tech_trips, see
 * flashTechTrips.ts/FlashTechCalendarPage.tsx) — trip scheduling/expenses
 * stay Admin/Finance-only there; this is just a different grid/style over
 * the same trips for CSR's own day-to-day reference (who's stationed
 * where, dispatch-relevant).
 *
 * Rows: everyone with a Flash Tech trip overlapping the visible two-week
 * window — split into "Flash Techs" and "Managers" sections by the
 * traveler's own profile role (manager-tier via isAttendanceManagerTierRole
 * goes under Managers). Someone with no trip at all never appears, even if
 * they're a designated flash tech generally — there's nothing to plot.
 *
 * Each day cell: that person's home branch (profile.assigned_branch) by
 * default, overridden by a trip's destination on any day within that
 * trip's [startDate, endDate]. Deliberately does NOT attempt to source
 * "OFF" days (no day-off data feeds into this) — every visible day always
 * resolves to either a trip destination or the home branch.
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { getCompanyFlashTechTrips, type FlashTechTrip } from "@/lib/supabase/flashTechTrips";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { isAttendanceManagerTierRole } from "@/lib/roleLabels";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
/** Monday of the week containing `d` (Sunday counts as the end of the prior week, matching the reference worksheet's M–SU layout). */
function mondayOf(d: Date): Date {
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(d);
  m.setDate(m.getDate() + diff);
  return m;
}
const DAY_LABELS = ["M", "T", "W", "Th", "F", "S", "SU"];

interface PersonRow {
  key: string;
  name: string;
  homeBranch: string;
  trips: FlashTechTrip[];
}

export function CsrFlashTechGrid() {
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const [trips, setTrips] = useState<FlashTechTrip[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [tripRows, profileRows] = await Promise.all([getCompanyFlashTechTrips(), getCompanyUsers()]);
        if (cancelled) return;
        setTrips(tripRows);
        setProfiles(profileRows);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load Flash Tech trips.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const days = useMemo(() => {
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);
  const rangeStart = toIso(days[0]);
  const rangeEnd = toIso(days[days.length - 1]);

  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);

  const { flashTechRows, managerRows } = useMemo(() => {
    const visibleTrips = trips.filter((t) => t.startDate <= rangeEnd && t.endDate >= rangeStart);
    const byPerson = new Map<string, PersonRow>();
    for (const t of visibleTrips) {
      const key = t.technicianProfileId ?? `name:${t.technicianName}`;
      const existing = byPerson.get(key);
      if (existing) existing.trips.push(t);
      else {
        const p = t.technicianProfileId ? profileById.get(t.technicianProfileId) : undefined;
        byPerson.set(key, {
          key,
          name: t.technicianName,
          homeBranch: p?.assigned_branch || t.originLocation || "",
          trips: [t],
        });
      }
    }
    const flash: PersonRow[] = [];
    const managers: PersonRow[] = [];
    for (const row of byPerson.values()) {
      const p = row.trips[0].technicianProfileId ? profileById.get(row.trips[0].technicianProfileId!) : undefined;
      const isManager = p ? isAttendanceManagerTierRole(p.role, p.extra_roles) : false;
      (isManager ? managers : flash).push(row);
    }
    const byName = (a: PersonRow, b: PersonRow) => a.name.localeCompare(b.name);
    flash.sort(byName);
    managers.sort(byName);
    return { flashTechRows: flash, managerRows: managers };
  }, [trips, profileById, rangeStart, rangeEnd]);

  const locationFor = (row: PersonRow, day: Date): string => {
    const iso = toIso(day);
    const trip = row.trips.find((t) => t.startDate <= iso && iso <= t.endDate);
    return trip ? trip.destinationLocation : row.homeBranch || "—";
  };

  const shiftWeeks = (n: number) => {
    const next = new Date(weekStart);
    next.setDate(next.getDate() + n * 7);
    setWeekStart(next);
  };

  const renderSection = (title: string, rows: PersonRow[]) => (
    <div className="mb-6">
      <div className="bg-indigo-900/60 border border-indigo-500/30 rounded-t-lg px-3 py-2">
        <h3 className="text-sm font-bold text-white uppercase tracking-wide">{title}</h3>
      </div>
      {rows.length === 0 ? (
        <div className="border border-t-0 border-white/10 rounded-b-lg px-3 py-4 text-sm text-slate-500">
          No Flash Tech trips covering this window.
        </div>
      ) : (
        <div className="overflow-x-auto border border-t-0 border-white/10 rounded-b-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-indigo-900/30 border-b border-white/10">
                <th className="px-3 py-2 text-left text-xs font-semibold text-indigo-200 sticky left-0 bg-slate-900">Name</th>
                {days.map((d) => (
                  <th key={toIso(d)} className="px-2 py-2 text-center text-xs font-semibold text-indigo-200 whitespace-nowrap">
                    {DAY_LABELS[(d.getDay() + 6) % 7]}
                    <div className="text-[10px] text-slate-400 font-normal">{d.getMonth() + 1}/{d.getDate()}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                  <td className="px-3 py-2 font-semibold text-white whitespace-nowrap sticky left-0 bg-slate-900">{row.name}</td>
                  {days.map((d) => {
                    const loc = locationFor(row, d);
                    const isHome = loc === row.homeBranch;
                    return (
                      <td
                        key={toIso(d)}
                        className={`px-2 py-2 text-center text-xs whitespace-nowrap ${isHome ? "text-slate-400" : "text-amber-300 font-semibold"}`}
                        title={isHome ? "Home branch" : "Flash Tech destination"}
                      >
                        {loc || "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-slate-400 max-w-lg">
          Same Flash Tech trip data as the Flash Tech Calendar, laid out as a two-week grid instead — view only. Amber cells are a trip destination; grey is that person's home branch.
        </p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => shiftWeeks(-2)} className="btn hover:bg-white/15 px-2 py-1">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold text-white whitespace-nowrap">
            {days[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} – {days[13].toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
          <button type="button" onClick={() => shiftWeeks(2)} className="btn hover:bg-white/15 px-2 py-1">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin inline" /></div>
      ) : error ? (
        <p className="text-sm text-red-400 px-2 py-6">{error}</p>
      ) : (
        <>
          {renderSection("Flash Techs", flashTechRows)}
          {renderSection("Managers", managerRows)}
        </>
      )}
    </div>
  );
}
