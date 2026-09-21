/**
 * Reports module — Technician Performance Report. A standalone, read-only
 * viewing surface (per an explicit ask that this NOT be folded into the
 * Tech Activity Report / payroll editing tools) computing the KPIs a
 * legacy "Technician Performance Management Module" spec called for:
 * Total Tickets, Redo Rate %, Tickets/Hour, and Miles/Ticket, per
 * technician, for a Weekly or Monthly period — plus 3 threshold alerts
 * (High Redo >5%, Route Mileage Audit >30 mi/ticket, Low Utilization
 * <32 hrs/week) and grouping by Branch/Manager/Tier.
 *
 * Deliberately reuses the SAME underlying data every other payroll/tech
 * report in this app already computes from (getTechCompletedRepairCounts,
 * getTechRedoTickets, mileage.ts, timecards.ts) rather than a new data
 * pipeline — this module is a different VIEW of that data, not a new
 * source of truth. No Minor/Major split (the app has no such concept —
 * see conversation): Total Tickets is simply every completed ticket.
 *
 * "Tier Level" here is whatever's on profiles.tier_level verbatim — a
 * pre-existing, loosely-defined column (a mix of pay-tier labels like
 * "tier 1" and job titles like "Branch Manager") that predates this
 * report and isn't a clean Tier 1-4 enum. Shown as-is rather than
 * inventing a new field no one would maintain.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, Download, RefreshCw } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { BrandedLoader } from "@/components/BrandedLoader";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getTechCompletedRepairCounts, getTechRedoTickets } from "@/lib/supabase/techPayroll";
import { getMileageEntries, mileageEffectiveTotal } from "@/lib/supabase/mileage";
import { getCompanyTimecardEntries, calcWorkedHours, computeMealTimeCredit, startOfWeekSunday, addDaysISO } from "@/lib/supabase/timecards";
import { getCsrTeamComposition, type CsrTeamComposition } from "@/lib/supabase/csrTeams";
import { visibleAttendanceProfileIds } from "@/lib/notifyRouting";
import { TECHNICIAN_PAY_ROLES, normalizeRole, isMealAlwaysPaidRole } from "@/lib/roleLabels";
import { exportToCSV } from "@/lib/csvExport";

type PeriodMode = "weekly" | "monthly";
type SortKey = "name" | "location" | "manager" | "tier" | "hoursWorked" | "totalTickets" | "redoCount" | "redoRatePct" | "miles" | "milesPerTicket" | "ticketsPerHour";
type GroupBy = "none" | "location" | "manager" | "tier";

interface TechPerfRow {
  id: string;
  name: string;
  location: string;
  manager: string;
  tier: string;
  daysWorked: number;
  hoursWorked: number;
  totalTickets: number;
  redoCount: number;
  redoRatePct: number | null;
  miles: number;
  milesPerTicket: number | null;
  ticketsPerHour: number | null;
  highRedoAlert: boolean;
  routeMileageAlert: boolean;
  lowUtilizationAlert: boolean;
}

const todayStr = () => new Date().toISOString().slice(0, 10);
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
const monthEnd = (d: string) => {
  const [y, m] = d.split("-").map(Number);
  return new Date(y, m, 0).toISOString().slice(0, 10);
};
const daysBetween = (start: string, end: string) => Math.round((new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime()) / 86400000) + 1;

const fmt1 = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });

export function TechnicianPerformanceReport({ mod }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const { uid } = useAuth();

  const [periodMode, setPeriodMode] = useState<PeriodMode>("weekly");
  const [anchor, setAnchor] = useState(todayStr());
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [csrComposition, setCsrComposition] = useState<CsrTeamComposition | null>(null);
  const [rows, setRows] = useState<TechPerfRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [managerFilter, setManagerFilter] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const periodStart = periodMode === "weekly" ? startOfWeekSunday(anchor) : monthStart(anchor);
  const periodEnd = periodMode === "weekly" ? addDaysISO(periodStart, 6) : monthEnd(anchor);
  const periodWeeks = daysBetween(periodStart, periodEnd) / 7;

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [allUsers, composition, repairCounts, redoMap, mileageEntries, timecardEntries] = await Promise.all([
        getCompanyUsers(),
        getCsrTeamComposition().catch(() => null),
        getTechCompletedRepairCounts(periodStart, periodEnd),
        getTechRedoTickets(periodStart, periodEnd),
        getMileageEntries(),
        getCompanyTimecardEntries(periodStart, periodEnd),
      ]);
      setUsers(allUsers);
      setCsrComposition(composition);

      const techs = allUsers.filter((u) => u.is_active && TECHNICIAN_PAY_ROLES.has(normalizeRole(u.role)));

      // Total completed tickets per technician (every repair-type category
      // summed — no Minor/Major split, see this file's header comment).
      const ticketsByName = new Map<string, number>();
      for (const rc of repairCounts) {
        const key = rc.technician.trim().toLowerCase();
        ticketsByName.set(key, (ticketsByName.get(key) ?? 0) + rc.count);
      }

      // Mileage: one effective total per distinct (technician, work_date) —
      // several entries can share one day's total (one row per ticket that
      // day), same dedup rule as Tech Activity Report's mileage panel.
      const milesByProfile = new Map<string, number>();
      const milesByName = new Map<string, number>();
      const seenDayKeys = new Set<string>();
      for (const e of mileageEntries) {
        if (e.deletedAt) continue;
        if (e.workDate < periodStart || e.workDate > periodEnd) continue;
        const identity = e.profileId ?? `name:${(e.technicianName || "").trim().toLowerCase()}`;
        const dayKey = `${identity}|${e.workDate}`;
        if (seenDayKeys.has(dayKey)) continue;
        seenDayKeys.add(dayKey);
        const miles = mileageEffectiveTotal(e);
        if (e.profileId) milesByProfile.set(e.profileId, (milesByProfile.get(e.profileId) ?? 0) + miles);
        else milesByName.set((e.technicianName || "").trim().toLowerCase(), (milesByName.get((e.technicianName || "").trim().toLowerCase()) ?? 0) + miles);
      }

      // Hours + distinct days worked per technician, from raw punches —
      // same calcWorkedHours + paid-meal-credit combination used
      // everywhere else pay/hours are computed in this app.
      const hoursByProfile = new Map<string, number>();
      const daysByProfile = new Map<string, Set<string>>();
      const entriesByProfile = new Map<string, typeof timecardEntries>();
      for (const e of timecardEntries) {
        if (!entriesByProfile.has(e.profileId)) entriesByProfile.set(e.profileId, []);
        entriesByProfile.get(e.profileId)!.push(e);
      }
      for (const tech of techs) {
        const entries = entriesByProfile.get(tech.id) ?? [];
        const mealAlwaysPaid = isMealAlwaysPaidRole(tech.role, tech.extra_roles);
        let hours = 0;
        const days = new Set<string>();
        for (const e of entries) {
          if (!e.checkIn) continue;
          days.add(e.workDate);
          const uiEntry = { checkIn: e.checkIn, checkOut: e.checkOut, mealStart: e.mealStart, mealEnd: e.mealEnd, notes: "" };
          hours += calcWorkedHours(uiEntry) + computeMealTimeCredit(uiEntry, mealAlwaysPaid);
        }
        hoursByProfile.set(tech.id, hours);
        daysByProfile.set(tech.id, days);
      }

      const computed: TechPerfRow[] = techs.map((t) => {
        const nameKey = (t.display_name || t.email).trim().toLowerCase();
        const totalTickets = ticketsByName.get(nameKey) ?? 0;
        const redoCount = redoMap.get(nameKey)?.length ?? 0;
        const miles = (milesByProfile.get(t.id) ?? 0) + (milesByName.get(nameKey) ?? 0);
        const hoursWorked = hoursByProfile.get(t.id) ?? 0;
        const redoRatePct = totalTickets > 0 ? (redoCount / totalTickets) * 100 : null;
        const milesPerTicket = totalTickets > 0 ? miles / totalTickets : null;
        const ticketsPerHour = hoursWorked > 0 ? totalTickets / hoursWorked : null;
        const weeklyEquivalentHours = periodWeeks > 0 ? hoursWorked / periodWeeks : hoursWorked;
        return {
          id: t.id,
          name: t.display_name || t.email,
          location: t.assigned_branch || "—",
          manager: t.manager_name || "—",
          tier: t.tier_level || "—",
          daysWorked: daysByProfile.get(t.id)?.size ?? 0,
          hoursWorked,
          totalTickets,
          redoCount,
          redoRatePct,
          miles,
          milesPerTicket,
          ticketsPerHour,
          highRedoAlert: redoRatePct != null && redoRatePct > 5,
          routeMileageAlert: milesPerTicket != null && milesPerTicket > 30,
          lowUtilizationAlert: weeklyEquivalentHours < 32,
        };
      });
      setRows(computed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load technician performance data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [periodStart, periodEnd]);

  const me = useMemo(() => users.find((u) => u.firebase_uid === uid) || null, [users, uid]);
  const scoped = useMemo(
    () => (me ? visibleAttendanceProfileIds(me, users, csrComposition) : new Set<string>()),
    [me, users, csrComposition],
  );
  const isFullAccess = scoped === null;
  const visibleRows = useMemo(() => (scoped === null ? rows : rows.filter((r) => scoped.has(r.id))), [rows, scoped]);

  const locationOptions = useMemo(() => Array.from(new Set(visibleRows.map((r) => r.location))).sort(), [visibleRows]);
  const managerOptions = useMemo(() => Array.from(new Set(visibleRows.map((r) => r.manager))).sort(), [visibleRows]);
  const tierOptions = useMemo(() => Array.from(new Set(visibleRows.map((r) => r.tier))).sort(), [visibleRows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visibleRows.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q) && !r.id.toLowerCase().includes(q)) return false;
      if (locationFilter && r.location !== locationFilter) return false;
      if (managerFilter && r.manager !== managerFilter) return false;
      if (tierFilter && r.tier !== tierFilter) return false;
      return true;
    });
  }, [visibleRows, search, locationFilter, managerFilter, tierFilter]);

  const sortedRows = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const val = (r: TechPerfRow): string | number => {
      switch (sortKey) {
        case "name": return r.name.toLowerCase();
        case "location": return r.location.toLowerCase();
        case "manager": return r.manager.toLowerCase();
        case "tier": return r.tier.toLowerCase();
        case "hoursWorked": return r.hoursWorked;
        case "totalTickets": return r.totalTickets;
        case "redoCount": return r.redoCount;
        case "redoRatePct": return r.redoRatePct ?? -1;
        case "miles": return r.miles;
        case "milesPerTicket": return r.milesPerTicket ?? -1;
        case "ticketsPerHour": return r.ticketsPerHour ?? -1;
      }
    };
    return [...filteredRows].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  }, [filteredRows, sortKey, sortDir]);

  const groupedRows = useMemo(() => {
    if (groupBy === "none") return [{ groupName: null as string | null, rows: sortedRows }];
    const key = groupBy === "location" ? "location" : groupBy === "manager" ? "manager" : "tier";
    const groups = new Map<string, TechPerfRow[]>();
    for (const r of sortedRows) {
      const g = r[key];
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(r);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([groupName, rows]) => ({ groupName, rows }));
  }, [sortedRows, groupBy]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const handleExportCsv = () => {
    exportToCSV(
      "technician_performance",
      ["Tech ID", "Name", "Location", "Manager", "Tier", "Days Worked", "Hours Worked", "Total Tickets", "Redo Count", "Redo Rate %", "Miles", "Miles/Ticket", "Tickets/Hour", "High Redo", "Route Mileage Audit", "Low Utilization"],
      sortedRows.map((r) => [
        r.id, r.name, r.location, r.manager, r.tier, r.daysWorked, fmt1(r.hoursWorked), r.totalTickets, r.redoCount,
        r.redoRatePct != null ? fmt1(r.redoRatePct) : "—", fmt1(r.miles),
        r.milesPerTicket != null ? fmt1(r.milesPerTicket) : "—", r.ticketsPerHour != null ? fmt1(r.ticketsPerHour) : "—",
        r.highRedoAlert ? "Yes" : "", r.routeMileageAlert ? "Yes" : "", r.lowUtilizationAlert ? "Yes" : "",
      ]),
    );
  };

  const shiftPeriod = (dir: -1 | 1) => {
    setAnchor((prev) => periodMode === "weekly" ? addDaysISO(prev, dir * 7) : (() => {
      const [y, m] = prev.split("-").map(Number);
      const d = new Date(y, m - 1 + dir, 1);
      return d.toISOString().slice(0, 10);
    })());
  };

  const thClass = "px-3 py-2 text-left text-xs text-muted-foreground uppercase cursor-pointer select-none hover:text-foreground";
  const sortIndicator = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1500px] mx-auto w-full px-4 sm:px-6 py-8">
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <button onClick={goBack} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4" /></button>
          <h1 className="text-2xl font-bold">Technician Performance Report</h1>
          <div className="ml-auto flex items-center gap-2">
            {isFullAccess && (
              <button onClick={handleExportCsv} className="btn text-xs px-2.5 py-1.5 flex items-center gap-1.5">
                <Download className="h-3.5 w-3.5" /> Export CSV
              </button>
            )}
            <button onClick={() => void load()} className="btn text-xs px-2.5 py-1.5 flex items-center gap-1.5" disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mb-6">
          Total Tickets, Redo Rate %, Tickets/Hour, and Miles/Ticket per technician — read-only. High Redo (&gt;5%), Route Mileage Audit (&gt;30 mi/ticket), and Low Utilization (&lt;32 hrs/week) are flagged automatically.
        </p>

        <div className="panel mb-4 p-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Period</label>
            <div className="flex rounded-md overflow-hidden border border-white/15 text-xs">
              <button type="button" onClick={() => setPeriodMode("weekly")} className={`px-3 py-1.5 ${periodMode === "weekly" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground"}`}>Weekly</button>
              <button type="button" onClick={() => setPeriodMode("monthly")} className={`px-3 py-1.5 border-l border-white/15 ${periodMode === "monthly" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground"}`}>Monthly</button>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => shiftPeriod(-1)} className="btn text-xs px-2 py-1.5">‹</button>
            <div className="text-xs text-muted-foreground px-1 whitespace-nowrap">{periodStart} – {periodEnd}</div>
            <button onClick={() => shiftPeriod(1)} className="btn text-xs px-2 py-1.5">›</button>
            <button onClick={() => setAnchor(todayStr())} className="btn text-xs px-2 py-1.5">Today</button>
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Search</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tech name or ID…" className="glass-input text-xs py-1.5 px-3 rounded-md w-full" />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Location</label>
            <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="glass-input text-xs py-1.5 px-3 rounded-md">
              <option value="">All</option>
              {locationOptions.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Manager</label>
            <select value={managerFilter} onChange={(e) => setManagerFilter(e.target.value)} className="glass-input text-xs py-1.5 px-3 rounded-md">
              <option value="">All</option>
              {managerOptions.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Tier</label>
            <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)} className="glass-input text-xs py-1.5 px-3 rounded-md">
              <option value="">All</option>
              {tierOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Group By</label>
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} className="glass-input text-xs py-1.5 px-3 rounded-md">
              <option value="none">None</option>
              <option value="location">Branch Location</option>
              <option value="manager">Direct Manager</option>
              <option value="tier">Tier Level</option>
            </select>
          </div>
        </div>

        {error && <p className="mb-4 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{error}</p>}

        {loading ? (
          <div className="panel p-10 flex items-center justify-center"><BrandedLoader /></div>
        ) : (
          <div className="space-y-4">
            {groupedRows.map(({ groupName, rows: groupRows }) => (
              <div key={groupName ?? "all"} className="panel p-0 overflow-hidden">
                {groupName != null && (
                  <div className="px-4 py-2.5 border-b border-white/10 bg-white/5 flex items-center justify-between">
                    <h2 className="font-semibold text-sm">{groupName}</h2>
                    <span className="text-[10px] text-muted-foreground">
                      {groupRows.length} tech{groupRows.length === 1 ? "" : "s"} · avg redo {fmt1(groupRows.reduce((s, r) => s + (r.redoRatePct ?? 0), 0) / groupRows.length || 0)}%
                    </span>
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5">
                        <th className={thClass} onClick={() => toggleSort("name")}>Name{sortIndicator("name")}</th>
                        <th className={thClass} onClick={() => toggleSort("location")}>Location{sortIndicator("location")}</th>
                        <th className={thClass} onClick={() => toggleSort("manager")}>Manager{sortIndicator("manager")}</th>
                        <th className={thClass} onClick={() => toggleSort("tier")}>Tier{sortIndicator("tier")}</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("hoursWorked")}>Hrs{sortIndicator("hoursWorked")}</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("totalTickets")}>Total Tickets{sortIndicator("totalTickets")}</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("redoCount")}>Redo{sortIndicator("redoCount")}</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("redoRatePct")}>Redo %{sortIndicator("redoRatePct")}</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("miles")}>Miles{sortIndicator("miles")}</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("milesPerTicket")}>Mi/Ticket{sortIndicator("milesPerTicket")}</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("ticketsPerHour")}>Tickets/Hr{sortIndicator("ticketsPerHour")}</th>
                        <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Alerts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupRows.length === 0 ? (
                        <tr><td colSpan={12} className="px-4 py-8 text-center text-muted-foreground text-sm">No technicians match.</td></tr>
                      ) : (
                        groupRows.map((r) => (
                          <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
                            <td className="px-3 py-2 font-medium">{r.name}</td>
                            <td className="px-3 py-2 text-muted-foreground">{r.location}</td>
                            <td className="px-3 py-2 text-muted-foreground">{r.manager}</td>
                            <td className="px-3 py-2 text-muted-foreground">{r.tier}</td>
                            <td className="px-3 py-2 text-right">{fmt1(r.hoursWorked)}</td>
                            <td className="px-3 py-2 text-right">{r.totalTickets}</td>
                            <td className="px-3 py-2 text-right">{r.redoCount}</td>
                            <td className={`px-3 py-2 text-right ${r.highRedoAlert ? "text-red-300 font-semibold" : ""}`}>{r.redoRatePct != null ? `${fmt1(r.redoRatePct)}%` : "—"}</td>
                            <td className="px-3 py-2 text-right">{fmt1(r.miles)}</td>
                            <td className={`px-3 py-2 text-right ${r.routeMileageAlert ? "text-amber-300 font-semibold" : ""}`}>{r.milesPerTicket != null ? fmt1(r.milesPerTicket) : "—"}</td>
                            <td className="px-3 py-2 text-right">{r.ticketsPerHour != null ? r.ticketsPerHour.toFixed(2) : "—"}</td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap gap-1">
                                {r.highRedoAlert && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/40">High Redo</span>}
                                {r.routeMileageAlert && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">Route Mileage</span>}
                                {r.lowUtilizationAlert && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/40">Low Utilization</span>}
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
