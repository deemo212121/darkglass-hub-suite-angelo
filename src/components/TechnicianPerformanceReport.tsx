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
 *
 * Tech ID is profiles.technician_id — the real dedicated column Admin User
 * Management's own "Technician ID" field edits (getCompanyUsers already
 * selects it, no extra fetch needed) — NOT employee_info.employeeId, a
 * separate free-text HR field that's a different piece of data entirely
 * and was almost always empty, which is why every row showed "—" here.
 * Falls back to "—" rather than fabricating an ID when it hasn't been set.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronDown, ChevronLeft, Download, RefreshCw, X, MapPin, UserSquare2, Star, CalendarClock, ChevronRight } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { BrandedLoader } from "@/components/BrandedLoader";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getTechCompletedRepairCounts, getTechCompletedTicketsDaily, getTechRedoTickets, type TechCompletedTicketDaily } from "@/lib/supabase/techPayroll";
import { getMileageEntries, mileageEffectiveTotal } from "@/lib/supabase/mileage";
import { getCompanyTimecardEntries, calcWorkedHours, computeMealTimeCredit, startOfWeekSunday, addDaysISO } from "@/lib/supabase/timecards";
import { getCsrTeamComposition, type CsrTeamComposition } from "@/lib/supabase/csrTeams";
import { visibleAttendanceProfileIds } from "@/lib/notifyRouting";
import { TECHNICIAN_PAY_ROLES, normalizeRole, isMealAlwaysPaidRole } from "@/lib/roleLabels";
import { exportToCSV } from "@/lib/csvExport";

const TOOLTIP_STYLE = {
  background: "#ffffff",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  color: "#0f172a",
  fontSize: 12,
  fontWeight: 600,
  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
} as const;
const CHART_BAR_FILL = "#3b82f6";
const COMPARE_BAR_FILLS = ["#3b82f6", "#f59e0b", "#10b981", "#ec4899", "#8b5cf6", "#06b6d4"];

/** Checkbox-list multi-select so Location/Manager/Tier can pick several
 *  values at once (combined/OR filtering) rather than only one. Portaled
 *  to <body> with `fixed` positioning from the trigger's
 *  getBoundingClientRect() (same fix as AdminUserManagementPage.tsx's
 *  column filter) — an `absolute` menu here renders inside the glass
 *  `.panel` filter bar, which sits earlier in the DOM than the chart/
 *  table panels below; those panels are glassmorphic (backdrop-blur),
 *  which forms their own stacking context and paints over an in-flow
 *  `absolute` dropdown regardless of z-index. Rendering into <body>
 *  sidesteps that entirely. */
function MultiSelect({
  label, options, selected, onChange,
}: { label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const openMenu = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const closeOnScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", closeOnScroll, { capture: true, passive: true });
    const closeOnOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => {
      window.removeEventListener("scroll", closeOnScroll, { capture: true });
      document.removeEventListener("mousedown", closeOnOutsideClick);
    };
  }, [open]);

  const allSelected = selected.length === options.length && options.length > 0;
  const toggleAll = () => onChange(allSelected ? [] : [...options]);
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  const display = selected.length === 0
    ? "All"
    : selected.length === options.length
    ? "All selected"
    : selected.slice(0, 2).join(", ") + (selected.length > 2 ? `, +${selected.length - 2} more` : "");

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={`Select ${label}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="glass-input text-xs py-1.5 px-3 rounded-md flex items-center gap-2 min-w-[140px] justify-between"
      >
        <span className="truncate">{display}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          aria-label={label}
          aria-multiselectable="true"
          className="fixed z-[9999] w-56 max-h-64 overflow-y-auto rounded-md border border-white/15 shadow-2xl"
          style={{ top: pos.top, left: pos.left, background: "rgb(22,28,52)", border: "1px solid rgba(255,255,255,0.15)" }}
        >
          <label className="flex items-center gap-2 px-3 py-2 hover:bg-white/5 cursor-pointer border-b border-white/10 text-xs font-medium">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-blue-500" />
            [ Select All ]
          </label>
          {options.map((o) => (
            <label key={o} className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 cursor-pointer text-xs">
              <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} className="accent-blue-500" />
              {o}
            </label>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

type PeriodMode = "weekly" | "monthly" | "custom";
type SortKey = "techId" | "name" | "location" | "manager" | "tier" | "daysWorked" | "hoursWorked" | "totalTickets" | "redoCount" | "redoRatePct" | "miles" | "milesPerTicket" | "ticketsPerHour";
type GroupBy = "none" | "location" | "manager" | "tier";

interface TechPerfRow {
  id: string;
  techId: string;
  name: string;
  location: string;
  manager: string;
  tier: string;
  isActive: boolean;
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

/** One day's mileage_entries dedup result behind a technician's Miles
 *  figure — see the Mileage breakdown popup and this file's load()
 *  comment on the branch-scoping/last-entry-wins fixes this backs. */
interface MileageDayDetail {
  techKey: string;
  isProfileId: boolean;
  date: string;
  miles: number;
  branch: string;
  /** Non-deleted entries this day whose branch matched the technician's own and contributed to (or overwrote) `miles`. */
  entryCount: number;
  /** Non-deleted entries this day tagged to a DIFFERENT branch than the technician's own — seen, but excluded from `miles`. */
  excludedEntryCount: number;
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
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
  const [customStart, setCustomStart] = useState(() => startOfWeekSunday(todayStr()));
  const [customEnd, setCustomEnd] = useState(() => addDaysISO(startOfWeekSunday(todayStr()), 6));
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [csrComposition, setCsrComposition] = useState<CsrTeamComposition | null>(null);
  const [rows, setRows] = useState<TechPerfRow[]>([]);
  const [dailyTickets, setDailyTickets] = useState<TechCompletedTicketDaily[]>([]);
  const [mileageDaily, setMileageDaily] = useState<MileageDayDetail[]>([]);
  const [techDimensionByName, setTechDimensionByName] = useState<Map<string, { location: string; manager: string; tier: string }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ticketListFor, setTicketListFor] = useState<{ id: string; name: string } | null>(null);
  const [mileageListFor, setMileageListFor] = useState<{ id: string; name: string } | null>(null);

  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState<string[]>([]);
  const [managerFilter, setManagerFilter] = useState<string[]>([]);
  const [tierFilter, setTierFilter] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selectedTechId, setSelectedTechId] = useState<string | null>(null);
  const [showActivityLog, setShowActivityLog] = useState(false);

  const periodStart =
    periodMode === "weekly" ? startOfWeekSunday(anchor)
    : periodMode === "monthly" ? monthStart(anchor)
    : customStart <= customEnd ? customStart : customEnd;
  const periodEnd =
    periodMode === "weekly" ? addDaysISO(periodStart, 6)
    : periodMode === "monthly" ? monthEnd(anchor)
    : customStart <= customEnd ? customEnd : customStart;
  const periodWeeks = daysBetween(periodStart, periodEnd) / 7;

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [allUsers, composition, repairCounts, redoMap, mileageEntries, timecardEntries, dailyCompleted] = await Promise.all([
        getCompanyUsers(),
        getCsrTeamComposition().catch(() => null),
        getTechCompletedRepairCounts(periodStart, periodEnd),
        getTechRedoTickets(periodStart, periodEnd),
        getMileageEntries(),
        getCompanyTimecardEntries(periodStart, periodEnd),
        getTechCompletedTicketsDaily(periodStart, periodEnd),
      ]);
      setUsers(allUsers);
      setCsrComposition(composition);
      setDailyTickets(dailyCompleted);

      const techs = allUsers.filter((u) => u.is_active && TECHNICIAN_PAY_ROLES.has(normalizeRole(u.role)));
      const dimensionByName = new Map<string, { location: string; manager: string; tier: string }>();
      for (const t of techs) {
        dimensionByName.set((t.display_name || t.email).trim().toLowerCase(), {
          location: t.assigned_branch || "—",
          manager: t.manager_name || "—",
          tier: t.tier_level || "—",
        });
      }
      setTechDimensionByName(dimensionByName);

      // Total completed tickets per technician (every repair-type category
      // summed — no Minor/Major split, see this file's header comment).
      const ticketsByName = new Map<string, number>();
      for (const rc of repairCounts) {
        const key = rc.technician.trim().toLowerCase();
        ticketsByName.set(key, (ticketsByName.get(key) ?? 0) + rc.count);
      }

      // Mileage: one effective total per distinct (technician, work_date) —
      // several entries can share one day's total (one row per ticket that
      // day). Matched exactly to AccountingDashboard's real Tech Activity
      // Report modal, which builds a Map<work_date, mileageEffectiveTotal>
      // and calls .set() on every matching entry in query order
      // (work_date desc, id asc) — so for a day with several entries, the
      // LAST one (highest id / most recently created — e.g. a correction
      // row) wins, not the first. This report used to keep the FIRST
      // entry seen per day and skip the rest, which silently picked a
      // stale total whenever a day's entries didn't all agree — caught by
      // comparing Chris Simpson's Miles (1,445.8 here) against Accounting's
      // Mileage (1,683.6) for the identical technician/branch/date range.
      //
      // Also scoped to each technician's OWN assigned branch, matching how
      // the same modal pulls mileage — getMileageEntries(branch) there
      // filters server-side to the branch that payroll run is open for.
      // Without this, a tech with a stray mileage_entries row tagged to a
      // different branch (data entry slip, or a genuine one-off
      // cross-branch job) shows MORE total miles here than what payroll
      // actually counted/paid for them.
      const branchByProfile = new Map<string, string>();
      const branchByName = new Map<string, string>();
      for (const t of techs) {
        if (!t.assigned_branch) continue;
        branchByProfile.set(t.id, t.assigned_branch);
        branchByName.set((t.display_name || t.email).trim().toLowerCase(), t.assigned_branch);
      }

      // Also kept as a flat day-by-day breakdown (mileageDaily state) so a
      // clicked Miles number can show exactly which days/entries it's
      // built from — same transparency purpose as the Total Tickets
      // popup, and how the branch/dedup fixes above were actually caught
      // and verified in the first place.
      const dayTotalsByProfile = new Map<string, Map<string, { miles: number; branch: string; entryCount: number; excludedEntryCount: number }>>();
      const dayTotalsByName = new Map<string, Map<string, { miles: number; branch: string; entryCount: number; excludedEntryCount: number }>>();
      for (const e of mileageEntries) {
        if (e.deletedAt) continue;
        if (e.workDate < periodStart || e.workDate > periodEnd) continue;
        const nameKey = (e.technicianName || "").trim().toLowerCase();
        const techBranch = e.profileId ? branchByProfile.get(e.profileId) : branchByName.get(nameKey);
        const byMap = e.profileId ? dayTotalsByProfile : dayTotalsByName;
        const identity = e.profileId ?? nameKey;
        if (!byMap.has(identity)) byMap.set(identity, new Map());
        const days = byMap.get(identity)!;
        if (techBranch && e.branch !== techBranch) {
          // Doesn't count toward the total, but tracked so the breakdown
          // popup can show it was seen and excluded (which branch it was
          // tagged to), instead of just silently vanishing.
          const prev = days.get(e.workDate);
          days.set(e.workDate, prev ?? { miles: 0, branch: "", entryCount: 0, excludedEntryCount: 0 });
          days.get(e.workDate)!.excludedEntryCount += 1;
          continue;
        }
        const miles = mileageEffectiveTotal(e);
        const prev = days.get(e.workDate);
        days.set(e.workDate, { miles, branch: e.branch, entryCount: (prev?.entryCount ?? 0) + 1, excludedEntryCount: prev?.excludedEntryCount ?? 0 });
      }
      const milesByProfile = new Map<string, number>();
      for (const [id, days] of dayTotalsByProfile) milesByProfile.set(id, Array.from(days.values()).reduce((s, d) => s + d.miles, 0));
      const milesByName = new Map<string, number>();
      for (const [name, days] of dayTotalsByName) milesByName.set(name, Array.from(days.values()).reduce((s, d) => s + d.miles, 0));

      const mileageDailyFlat: MileageDayDetail[] = [];
      for (const [id, days] of dayTotalsByProfile) {
        for (const [date, d] of days) mileageDailyFlat.push({ techKey: id, isProfileId: true, date, miles: d.miles, branch: d.branch, entryCount: d.entryCount, excludedEntryCount: d.excludedEntryCount });
      }
      for (const [name, days] of dayTotalsByName) {
        for (const [date, d] of days) mileageDailyFlat.push({ techKey: name, isProfileId: false, date, miles: d.miles, branch: d.branch, entryCount: d.entryCount, excludedEntryCount: d.excludedEntryCount });
      }
      setMileageDaily(mileageDailyFlat);

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
          techId: t.technician_id?.trim() || "—",
          name: t.display_name || t.email,
          location: t.assigned_branch || "—",
          manager: t.manager_name || "—",
          tier: t.tier_level || "—",
          isActive: t.is_active,
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
      if (locationFilter.length > 0 && !locationFilter.includes(r.location)) return false;
      if (managerFilter.length > 0 && !managerFilter.includes(r.manager)) return false;
      if (tierFilter.length > 0 && !tierFilter.includes(r.tier)) return false;
      return true;
    });
  }, [visibleRows, search, locationFilter, managerFilter, tierFilter]);

  // "Compare" mode: once 2+ values are picked in one of the Location/
  // Manager/Tier multi-selects, aggregate the (already combined/OR-
  // filtered) rows per selected value so they can be read side by side,
  // instead of only as one merged total. Location takes priority when
  // more than one dimension has 2+ picks, to keep the comparison to a
  // single axis at a time.
  const compareDimension: "location" | "manager" | "tier" | null =
    locationFilter.length >= 2 ? "location" : managerFilter.length >= 2 ? "manager" : tierFilter.length >= 2 ? "tier" : null;

  const compareGroups = useMemo(() => {
    if (!compareDimension) return [];
    const selected = compareDimension === "location" ? locationFilter : compareDimension === "manager" ? managerFilter : tierFilter;
    return selected.map((value) => {
      const groupRows = filteredRows.filter((r) => r[compareDimension] === value);
      const totalTickets = groupRows.reduce((s, r) => s + r.totalTickets, 0);
      const redoCount = groupRows.reduce((s, r) => s + r.redoCount, 0);
      const miles = groupRows.reduce((s, r) => s + r.miles, 0);
      const hoursWorked = groupRows.reduce((s, r) => s + r.hoursWorked, 0);
      return {
        value,
        techCount: groupRows.length,
        totalTickets,
        redoRatePct: totalTickets > 0 ? (redoCount / totalTickets) * 100 : null,
        ticketsPerHour: hoursWorked > 0 ? totalTickets / hoursWorked : null,
        milesPerTicket: totalTickets > 0 ? miles / totalTickets : null,
      };
    });
  }, [compareDimension, locationFilter, managerFilter, tierFilter, filteredRows]);

  // Day-by-day Total Tickets per selected value, for the Compare line
  // chart — same completed-ticket population as the aggregate table
  // above (getTechCompletedTicketsDaily excludes redo/on-hold the same
  // way getTechCompletedRepairCounts does), just bucketed per day instead
  // of summed over the whole period.
  const compareTimeSeries = useMemo(() => {
    if (!compareDimension) return [];
    const selected = compareDimension === "location" ? locationFilter : compareDimension === "manager" ? managerFilter : tierFilter;
    if (selected.length === 0) return [];
    const selectedSet = new Set(selected);

    const dates: string[] = [];
    for (let d = periodStart; d <= periodEnd; d = addDaysISO(d, 1)) dates.push(d);

    const byDate = new Map<string, Map<string, number>>();
    for (const t of dailyTickets) {
      if (t.date < periodStart || t.date > periodEnd) continue;
      const info = techDimensionByName.get(t.technician.trim().toLowerCase());
      const groupValue = info?.[compareDimension];
      if (!groupValue || !selectedSet.has(groupValue)) continue;
      if (!byDate.has(t.date)) byDate.set(t.date, new Map());
      const m = byDate.get(t.date)!;
      m.set(groupValue, (m.get(groupValue) ?? 0) + 1);
    }

    return dates.map((date) => {
      const entry: Record<string, string | number> = { date: `${date.slice(5, 7)}/${date.slice(8, 10)}` };
      const m = byDate.get(date);
      for (const g of selected) entry[g] = m?.get(g) ?? 0;
      return entry;
    });
  }, [compareDimension, locationFilter, managerFilter, tierFilter, dailyTickets, techDimensionByName, periodStart, periodEnd]);

  // The actual tickets behind a clicked Total Tickets count — same
  // name-matched population as ticketsByName in load(), just listed
  // instead of summed, sorted most-recent first.
  const ticketListRows = useMemo(() => {
    if (!ticketListFor) return [];
    const nameKey = ticketListFor.name.trim().toLowerCase();
    return dailyTickets
      .filter((t) => t.technician.trim().toLowerCase() === nameKey)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [ticketListFor, dailyTickets]);

  // The day-by-day breakdown behind a clicked Miles figure — the exact
  // per-day rows load()'s branch-scoped, last-entry-wins dedup produced
  // before they got summed into that technician's `miles` total. A row
  // with excludedEntryCount > 0 had at least one same-day entry tagged to
  // a DIFFERENT branch that was seen but didn't count.
  const mileageListRows = useMemo(() => {
    if (!mileageListFor) return [];
    const nameKey = mileageListFor.name.trim().toLowerCase();
    return mileageDaily
      .filter((d) => (d.isProfileId ? d.techKey === mileageListFor.id : d.techKey === nameKey))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [mileageListFor, mileageDaily]);

  const sortedRows = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const val = (r: TechPerfRow): string | number => {
      switch (sortKey) {
        case "techId": return r.techId.toLowerCase();
        case "name": return r.name.toLowerCase();
        case "location": return r.location.toLowerCase();
        case "manager": return r.manager.toLowerCase();
        case "tier": return r.tier.toLowerCase();
        case "daysWorked": return r.daysWorked;
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

  const top5Chart = useMemo(
    () => [...filteredRows]
      .sort((a, b) => b.totalTickets - a.totalTickets)
      .slice(0, 5)
      .map((r) => ({ name: r.name.split(" ")[0] || r.name, fullName: r.name, value: r.totalTickets })),
    [filteredRows],
  );

  // Same stat-tile treatment as the Technician Details modal's Daily
  // Activity Log row — a page-level rollup of whatever's currently
  // filtered, so it moves with Location/Manager/Tier/Search like the table
  // below it does.
  const pageKpis = useMemo(() => {
    const totalTickets = filteredRows.reduce((s, r) => s + r.totalTickets, 0);
    const totalRedo = filteredRows.reduce((s, r) => s + r.redoCount, 0);
    const totalHours = filteredRows.reduce((s, r) => s + r.hoursWorked, 0);
    const flagged = filteredRows.filter((r) => r.highRedoAlert || r.routeMileageAlert || r.lowUtilizationAlert).length;
    return {
      techCount: filteredRows.length,
      totalTickets,
      avgRedoPct: totalTickets > 0 ? (totalRedo / totalTickets) * 100 : null,
      avgTicketsPerHour: totalHours > 0 ? totalTickets / totalHours : null,
      flagged,
    };
  }, [filteredRows]);

  const handleExportCsv = () => {
    exportToCSV(
      "technician_performance",
      ["Technician ID", "Name", "Location", "Manager", "Tier", "Days Worked", "Hours Worked", "Total Tickets", "Redo Count", "Redo Rate %", "Miles", "Miles/Ticket", "Tickets/Hour", "High Redo", "Route Mileage Audit", "Low Utilization"],
      sortedRows.map((r) => [
        r.techId, r.name, r.location, r.manager, r.tier, r.daysWorked, fmt1(r.hoursWorked), r.totalTickets, r.redoCount,
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

  const selectedTech = useMemo(() => (selectedTechId ? visibleRows.find((r) => r.id === selectedTechId) ?? null : null), [selectedTechId, visibleRows]);

  // Same dailyTickets population the Compare line chart already draws
  // from (getTechCompletedTicketsDaily) — filtered to just this one
  // technician's name for the "View Activity Log" breakdown, so no new
  // fetch is needed to back it.
  const selectedTechDailyLog = useMemo(() => {
    if (!selectedTech) return [];
    const nameKey = selectedTech.name.trim().toLowerCase();
    const counts = new Map<string, number>();
    for (const t of dailyTickets) {
      if (t.date < periodStart || t.date > periodEnd) continue;
      if (t.technician.trim().toLowerCase() !== nameKey) continue;
      counts.set(t.date, (counts.get(t.date) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [selectedTech, dailyTickets, periodStart, periodEnd]);

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1500px] mx-auto w-full px-4 sm:px-6 py-8">
        <div className="relative rounded-2xl border border-white/10 bg-gradient-to-br from-blue-600/20 via-indigo-600/10 to-transparent px-6 py-6 mb-5">
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={goBack} className="btn hover:bg-white/15 shrink-0"><ChevronLeft className="h-4 w-4" /></button>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-300/80 mb-0.5">Reports</p>
              <h1 className="text-2xl font-bold">Technician Performance Report</h1>
            </div>
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
          <p className="text-xs text-muted-foreground mt-3 max-w-3xl">
            Total Tickets, Redo Rate %, Tickets/Hour, and Miles/Ticket per technician — read-only. High Redo (&gt;5%), Route Mileage Audit (&gt;30 mi/ticket), and Low Utilization (&lt;32 hrs/week) are flagged automatically.
          </p>
        </div>

        {!loading && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
            {[
              { label: "Technicians", icon: UserSquare2, accent: "blue", value: pageKpis.techCount },
              { label: "Total Tickets", icon: Star, accent: "emerald", value: pageKpis.totalTickets },
              { label: "Avg Redo %", icon: MapPin, accent: "amber", value: pageKpis.avgRedoPct != null ? `${fmt1(pageKpis.avgRedoPct)}%` : "—" },
              { label: "Avg Tickets/Hr", icon: CalendarClock, accent: "violet", value: pageKpis.avgTicketsPerHour != null ? pageKpis.avgTicketsPerHour.toFixed(2) : "—" },
              { label: "Flagged", icon: UserSquare2, accent: "cyan", value: pageKpis.flagged },
            ].map(({ label, icon: Icon, accent, value }) => (
              <div key={label} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className={`inline-flex p-1.5 rounded-lg mb-2 ${ACCENT_CLASSES[accent].chip}`}>
                  <Icon className={`h-3.5 w-3.5 ${ACCENT_CLASSES[accent].text}`} />
                </div>
                <p className={`text-2xl font-bold tabular-nums ${ACCENT_CLASSES[accent].text}`}>{value}</p>
                <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{label}</p>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-xl border border-white/10 bg-white/[0.03] mb-4 p-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Period</label>
            <div className="flex rounded-md overflow-hidden border border-white/15 text-xs">
              <button type="button" onClick={() => setPeriodMode("weekly")} className={`px-3 py-1.5 ${periodMode === "weekly" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground"}`}>Weekly</button>
              <button type="button" onClick={() => setPeriodMode("monthly")} className={`px-3 py-1.5 border-l border-white/15 ${periodMode === "monthly" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground"}`}>Monthly</button>
              <button
                type="button"
                onClick={() => {
                  // Seed the custom range from whatever's currently showing,
                  // so switching in doesn't reset the user back to "this week".
                  setCustomStart(periodStart);
                  setCustomEnd(periodEnd);
                  setPeriodMode("custom");
                }}
                className={`px-3 py-1.5 border-l border-white/15 ${periodMode === "custom" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground"}`}
              >
                Custom
              </button>
            </div>
          </div>
          {periodMode === "custom" ? (
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={customStart}
                max={customEnd}
                onChange={(e) => setCustomStart(e.target.value)}
                className="glass-input text-xs py-1.5 px-2 rounded-md"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <input
                type="date"
                value={customEnd}
                min={customStart}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="glass-input text-xs py-1.5 px-2 rounded-md"
              />
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <button onClick={() => shiftPeriod(-1)} className="btn text-xs px-2 py-1.5">‹</button>
              <div className="text-xs text-muted-foreground px-1 whitespace-nowrap">{periodStart} – {periodEnd}</div>
              <button onClick={() => shiftPeriod(1)} className="btn text-xs px-2 py-1.5">›</button>
              <button onClick={() => setAnchor(todayStr())} className="btn text-xs px-2 py-1.5">Today</button>
            </div>
          )}
          <div className="flex-1 min-w-[160px]">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Search</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tech name or ID…" className="glass-input text-xs py-1.5 px-3 rounded-md w-full" />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Location</label>
            <MultiSelect label="Location" options={locationOptions} selected={locationFilter} onChange={setLocationFilter} />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Manager</label>
            <MultiSelect label="Manager" options={managerOptions} selected={managerFilter} onChange={setManagerFilter} />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Tier</label>
            <MultiSelect label="Tier" options={tierOptions} selected={tierFilter} onChange={setTierFilter} />
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
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-10 flex items-center justify-center"><BrandedLoader /></div>
        ) : (
          <div className="space-y-4">
            {compareDimension && compareGroups.length > 0 && (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center gap-1.5 mb-1">
                  <UserSquare2 className="h-4 w-4 text-blue-400" />
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Compare by {compareDimension === "location" ? "Location" : compareDimension === "manager" ? "Manager" : "Tier"}
                  </p>
                </div>
                <p className="text-[10px] text-muted-foreground mb-4">
                  {compareGroups.length} selected — Total Tickets per day, color-coded per {compareDimension}. Period totals are in the table below.
                </p>
                <ResponsiveContainer width="100%" height={260} debounce={200}>
                  <LineChart data={compareTimeSeries} margin={{ left: -10, right: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: "#94a3b8", fontSize: 9 }}
                      angle={compareTimeSeries.length > 10 ? -35 : 0}
                      textAnchor={compareTimeSeries.length > 10 ? "end" : "middle"}
                      height={compareTimeSeries.length > 10 ? 45 : 24}
                      interval={compareTimeSeries.length > 20 ? Math.ceil(compareTimeSeries.length / 15) : 0}
                    />
                    <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {compareGroups.map((g, i) => (
                      <Line
                        key={g.value}
                        type="monotone"
                        dataKey={g.value}
                        name={g.value}
                        stroke={COMPARE_BAR_FILLS[i % COMPARE_BAR_FILLS.length]}
                        strokeWidth={2}
                        dot={{ r: 2.5 }}
                        activeDot={{ r: 4.5 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
                <div className="overflow-x-auto mt-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5">
                        <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">{compareDimension === "location" ? "Location" : compareDimension === "manager" ? "Manager" : "Tier"}</th>
                        <th className="px-3 py-2 text-right text-xs text-muted-foreground uppercase">Techs</th>
                        <th className="px-3 py-2 text-right text-xs text-muted-foreground uppercase">Total Tickets</th>
                        <th className="px-3 py-2 text-right text-xs text-muted-foreground uppercase">Redo %</th>
                        <th className="px-3 py-2 text-right text-xs text-muted-foreground uppercase">Tickets/Hr</th>
                        <th className="px-3 py-2 text-right text-xs text-muted-foreground uppercase">Mi/Ticket</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compareGroups.map((g, i) => (
                        <tr key={g.value} className="border-b border-white/5">
                          <td className="px-3 py-2 font-medium flex items-center gap-2">
                            <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ background: COMPARE_BAR_FILLS[i % COMPARE_BAR_FILLS.length] }} />
                            {g.value}
                          </td>
                          <td className="px-3 py-2 text-right">{g.techCount}</td>
                          <td className="px-3 py-2 text-right">{g.totalTickets}</td>
                          <td className="px-3 py-2 text-right">{g.redoRatePct != null ? `${fmt1(g.redoRatePct)}%` : "—"}</td>
                          <td className="px-3 py-2 text-right">{g.ticketsPerHour != null ? g.ticketsPerHour.toFixed(2) : "—"}</td>
                          <td className="px-3 py-2 text-right">{g.milesPerTicket != null ? fmt1(g.milesPerTicket) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {top5Chart.length > 0 && (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center gap-1.5 mb-4">
                  <Star className="h-4 w-4 text-emerald-400" />
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Top 5 Technicians (Total Tickets)</p>
                </div>
                <ResponsiveContainer width="100%" height={200} debounce={200}>
                  <BarChart data={top5Chart} margin={{ left: -10 }}>
                    <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      cursor={{ fill: "rgba(148,163,184,0.1)" }}
                      formatter={(v: any) => [v, "Total Tickets"]}
                      labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ""}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]} name="Total Tickets">
                      {top5Chart.map((_, i) => <Cell key={i} fill={CHART_BAR_FILL} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {groupedRows.map(({ groupName, rows: groupRows }) => (
              <div key={groupName ?? "all"} className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
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
                        <th className={thClass} onClick={() => toggleSort("techId")}>Technician ID{sortIndicator("techId")}</th>
                        <th className={thClass} onClick={() => toggleSort("name")}>Name{sortIndicator("name")}</th>
                        <th className={thClass} onClick={() => toggleSort("location")}>Location{sortIndicator("location")}</th>
                        <th className={thClass} onClick={() => toggleSort("manager")}>Manager{sortIndicator("manager")}</th>
                        <th className={thClass} onClick={() => toggleSort("tier")}>Tier{sortIndicator("tier")}</th>
                        <th className={`${thClass} text-right`} onClick={() => toggleSort("daysWorked")}>Days{sortIndicator("daysWorked")}</th>
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
                        <tr><td colSpan={14} className="px-4 py-8 text-center text-muted-foreground text-sm">No technicians match.</td></tr>
                      ) : (
                        groupRows.map((r) => (
                          <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
                            <td className="px-3 py-2 text-muted-foreground">{r.techId}</td>
                            <td className="px-3 py-2 font-medium">
                              <button
                                type="button"
                                onClick={() => { setSelectedTechId(r.id); setShowActivityLog(false); }}
                                className="hover:text-blue-300 hover:underline underline-offset-2 transition"
                                title="Click the name to view details"
                              >
                                {r.name}
                              </button>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{r.location}</td>
                            <td className="px-3 py-2 text-muted-foreground">{r.manager}</td>
                            <td className="px-3 py-2 text-muted-foreground">{r.tier}</td>
                            <td className="px-3 py-2 text-right">{r.daysWorked}</td>
                            <td className="px-3 py-2 text-right">{fmt1(r.hoursWorked)}</td>
                            <td className="px-3 py-2 text-right">
                              {r.totalTickets > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => setTicketListFor({ id: r.id, name: r.name })}
                                  className="text-blue-400 hover:text-blue-300 hover:underline underline-offset-2"
                                  title="View completed tickets"
                                >
                                  {r.totalTickets}
                                </button>
                              ) : (
                                r.totalTickets
                              )}
                            </td>
                            <td className="px-3 py-2 text-right">{r.redoCount}</td>
                            <td className={`px-3 py-2 text-right ${r.highRedoAlert ? "text-red-300 font-semibold" : ""}`}>{r.redoRatePct != null ? `${fmt1(r.redoRatePct)}%` : "—"}</td>
                            <td className="px-3 py-2 text-right">
                              {r.miles > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => setMileageListFor({ id: r.id, name: r.name })}
                                  className="text-blue-400 hover:text-blue-300 hover:underline underline-offset-2"
                                  title="View mileage breakdown"
                                >
                                  {fmt1(r.miles)}
                                </button>
                              ) : (
                                fmt1(r.miles)
                              )}
                            </td>
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

      {ticketListFor && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setTicketListFor(null)}>
          <div
            className="bg-slate-900 border border-white/15 rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-slate-950 rounded-t-xl">
              <div>
                <p className="font-semibold text-white">Completed Tickets — {ticketListFor.name}</p>
                <p className="text-xs text-slate-400">{periodStart} – {periodEnd} · {ticketListRows.length} ticket{ticketListRows.length === 1 ? "" : "s"}</p>
              </div>
              <button onClick={() => setTicketListFor(null)} className="text-white/40 hover:text-white/80 transition">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-2">
              {ticketListRows.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">No completed tickets in this period.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-400 uppercase">
                      <th className="px-3 py-2">Ticket #</th>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Location</th>
                      <th className="px-3 py-2">Repair Type</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {ticketListRows.map((t) => (
                      <tr key={t.ticketId} className="hover:bg-white/5">
                        <td className="px-3 py-2">
                          <Link to="/ticket/$ticketNo" params={{ ticketNo: t.ticketNo }} target="_blank" rel="noreferrer" className="font-mono text-blue-400 hover:text-blue-300 hover:underline">
                            {t.ticketNo || t.ticketId.slice(0, 8)}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-slate-300">{t.date}</td>
                        <td className="px-3 py-2 text-slate-300">{t.location || "—"}</td>
                        <td className="px-3 py-2 text-slate-300">{t.repairType}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {mileageListFor && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setMileageListFor(null)}>
          <div
            className="bg-slate-900 border border-white/15 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-slate-950 rounded-t-xl">
              <div>
                <p className="font-semibold text-white">Mileage Breakdown — {mileageListFor.name}</p>
                <p className="text-xs text-slate-400">{periodStart} – {periodEnd} · {fmt1(mileageListRows.reduce((s, d) => s + d.miles, 0))} total miles</p>
              </div>
              <button onClick={() => setMileageListFor(null)} className="text-white/40 hover:text-white/80 transition">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="px-5 pt-3 text-[11px] text-slate-400">
              One effective total per day — from mileage_entries, source of truth is <span className="text-slate-300">mileageEffectiveTotal()</span> (a manual override replaces the calculated total; an adjustment adds/subtracts). When a day has several entries (one per ticket that day, or a correction), the most recently created one wins — same rule Accounting's Tech Activity Report uses. Only entries tagged to this technician's own branch count; a day flagged "excluded" had another entry seen but tagged to a different branch.
            </p>
            <div className="overflow-y-auto flex-1 p-2">
              {mileageListRows.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">No mileage in this period.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-400 uppercase">
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2 text-right">Miles</th>
                      <th className="px-3 py-2">Branch</th>
                      <th className="px-3 py-2 text-right">Entries</th>
                      <th className="px-3 py-2">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {mileageListRows.map((d) => (
                      <tr key={d.date} className="hover:bg-white/5">
                        <td className="px-3 py-2 text-slate-300">{d.date}</td>
                        <td className="px-3 py-2 text-right font-medium">{fmt1(d.miles)}</td>
                        <td className="px-3 py-2 text-slate-300">{d.branch || "—"}</td>
                        <td className="px-3 py-2 text-right text-slate-300">{d.entryCount}</td>
                        <td className="px-3 py-2">
                          {d.excludedEntryCount > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                              {d.excludedEntryCount} excluded (different branch)
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {selectedTech && (
        <TechDetailPanel
          tech={selectedTech}
          dailyLog={selectedTechDailyLog}
          showActivityLog={showActivityLog}
          onToggleActivityLog={() => setShowActivityLog((v) => !v)}
          onClose={() => setSelectedTechId(null)}
        />
      )}
    </div>
  );
}

const ACTIVITY_TILES: { label: string; icon: typeof Star; accent: string; getValue: (t: TechPerfRow) => string | number }[] = [
  { label: "Days Worked", icon: CalendarClock, accent: "blue", getValue: (t) => t.daysWorked },
  { label: "Total Hrs Worked", icon: CalendarClock, accent: "violet", getValue: (t) => fmt1(t.hoursWorked) },
  { label: "Tickets Completed", icon: Star, accent: "emerald", getValue: (t) => t.totalTickets },
  { label: "Redo Count", icon: UserSquare2, accent: "amber", getValue: (t) => t.redoCount },
  { label: "Drive Range (Mi)", icon: MapPin, accent: "cyan", getValue: (t) => fmt1(t.miles) },
];
const ACCENT_CLASSES: Record<string, { chip: string; text: string }> = {
  blue: { chip: "bg-blue-500/10", text: "text-blue-400" },
  violet: { chip: "bg-violet-500/10", text: "text-violet-400" },
  emerald: { chip: "bg-emerald-500/10", text: "text-emerald-400" },
  amber: { chip: "bg-amber-500/10", text: "text-amber-400" },
  cyan: { chip: "bg-cyan-500/10", text: "text-cyan-400" },
};

function TechDetailPanel({
  tech, dailyLog, showActivityLog, onToggleActivityLog, onClose,
}: {
  tech: TechPerfRow;
  dailyLog: [string, number][];
  showActivityLog: boolean;
  onToggleActivityLog: () => void;
  onClose: () => void;
}) {
  // No animation plugin installed in this project (tailwindcss-animate
  // isn't a dependency) — fade/scale it in manually: mount at
  // opacity-0/scale-95, then flip on the next tick so the transition plays.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // A stat tile is a shortcut into the same day-by-day breakdown the "View
  // Activity Log" button opens — clicking one opens it (never closes it)
  // and scrolls it into view, since it's the only detail view this data
  // supports today.
  const activityLogRef = useRef<HTMLDivElement>(null);
  const onOpenActivityLog = () => {
    if (!showActivityLog) onToggleActivityLog();
    requestAnimationFrame(() => activityLogRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  };

  const infoCards = [
    { icon: UserSquare2, label: "Technician ID", value: tech.techId, hint: "Unique technician identifier", accent: "blue" },
    { icon: MapPin, label: "Location", value: tech.location, hint: "Geographical location / branch", accent: "rose" },
    { icon: UserSquare2, label: "Direct Manager", value: tech.manager, hint: "Direct supervisor", accent: "indigo" },
    { icon: Star, label: "Tier Level", value: tech.tier, hint: "Technician classification tier", accent: "amber" },
  ];
  const infoAccent: Record<string, { chip: string; text: string }> = {
    ...ACCENT_CLASSES,
    rose: { chip: "bg-rose-500/10", text: "text-rose-400" },
    indigo: { chip: "bg-indigo-500/10", text: "text-indigo-400" },
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm transition-opacity duration-200 ${entered ? "opacity-100" : "opacity-0"}`}
      onClick={onClose}
    >
      <div
        className={`w-full max-w-5xl max-h-[88vh] overflow-y-auto rounded-2xl border border-white/10 bg-slate-950 shadow-[0_20px_70px_rgba(0,0,0,0.55)] transition-all duration-200 ${entered ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative px-7 py-7 bg-gradient-to-br from-blue-600/20 via-indigo-600/10 to-transparent border-b border-white/10">
          <button type="button" onClick={onClose} className="absolute top-5 right-5 text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-white/5 transition" title="Close">
            <X className="h-5 w-5" />
          </button>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-300/80 mb-1">Technician Details</p>
          <div className="flex items-start gap-4">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 ring-4 ring-blue-500/20 flex items-center justify-center text-white font-bold text-xl shrink-0 shadow-lg">
              {initialsFor(tech.name)}
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-2xl font-bold truncate">{tech.name}</h2>
                <span className={`shrink-0 inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full ${tech.isActive ? "bg-green-500/15 text-green-300" : "bg-slate-500/15 text-slate-400"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${tech.isActive ? "bg-green-400" : "bg-slate-500"}`} />
                  {tech.isActive ? "Active" : "Inactive"}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">{tech.techId !== "—" ? `${tech.techId} · ` : ""}{tech.tier}</p>
              {(tech.highRedoAlert || tech.routeMileageAlert || tech.lowUtilizationAlert) && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {tech.highRedoAlert && <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/40">High Redo</span>}
                  {tech.routeMileageAlert && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">Route Mileage</span>}
                  {tech.lowUtilizationAlert && <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/40">Low Utilization</span>}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="p-7 grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-6 items-start">
          <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {infoCards.map(({ icon: Icon, label, value, hint, accent }) => (
              <div key={label} className="rounded-xl border border-white/10 bg-white/[0.03] p-4 hover:border-white/20 transition">
                <div className={`inline-flex p-2 rounded-lg mb-2.5 ${infoAccent[accent].chip}`}>
                  <Icon className={`h-4 w-4 ${infoAccent[accent].text}`} />
                </div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
                <p className="text-base font-bold truncate mt-0.5" title={value}>{value}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>
              </div>
            ))}
          </div>

          <div>
            <div className="flex items-center gap-1.5 mb-3">
              <CalendarClock className="h-4 w-4 text-blue-400" />
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Daily Activity Log</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {ACTIVITY_TILES.map(({ label, icon: Icon, accent, getValue }) => (
                <button
                  key={label}
                  type="button"
                  onClick={onOpenActivityLog}
                  title="View the day-by-day breakdown"
                  className="text-left rounded-xl border border-white/10 bg-white/[0.03] p-4 hover:border-white/25 hover:bg-white/[0.06] active:scale-[0.98] transition cursor-pointer"
                >
                  <div className={`inline-flex p-1.5 rounded-lg mb-2 ${ACCENT_CLASSES[accent].chip}`}>
                    <Icon className={`h-3.5 w-3.5 ${ACCENT_CLASSES[accent].text}`} />
                  </div>
                  <p className={`text-2xl font-bold tabular-nums ${ACCENT_CLASSES[accent].text}`}>{getValue(tech)}</p>
                  <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{label}</p>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={onToggleActivityLog}
              className="btn text-xs w-full mt-4 flex items-center justify-center gap-1.5"
            >
              {showActivityLog ? "Hide Activity Log" : "View Activity Log"}
              <ChevronRight className={`h-3.5 w-3.5 transition-transform ${showActivityLog ? "rotate-90" : ""}`} />
            </button>
            {showActivityLog && (
              <div ref={activityLogRef} className="mt-3">
                {dailyLog.length === 0 ? (
                  <div className="rounded-xl border border-white/10 py-6">
                    <p className="text-xs text-muted-foreground text-center">No completed tickets logged for this period.</p>
                  </div>
                ) : (
                  <>
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 mb-2">
                      <ResponsiveContainer width="100%" height={160} debounce={200}>
                        <BarChart data={[...dailyLog].reverse().map(([date, count]) => ({ date: `${date.slice(5, 7)}/${date.slice(8, 10)}`, count }))} margin={{ left: -20, right: 8 }}>
                          <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                          <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} allowDecimals={false} width={28} />
                          <Tooltip
                            contentStyle={TOOLTIP_STYLE}
                            cursor={{ fill: "rgba(148,163,184,0.1)" }}
                            formatter={(v: any) => [v, "Tickets"]}
                          />
                          <Bar dataKey="count" radius={[3, 3, 0, 0]} name="Tickets">
                            {dailyLog.map((_, i) => <Cell key={i} fill={CHART_BAR_FILL} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="max-h-56 overflow-y-auto rounded-xl border border-white/10 divide-y divide-white/5">
                      {dailyLog.map(([date, count]) => (
                        <div key={date} className="flex items-center justify-between px-4 py-2 text-xs">
                          <span className="text-muted-foreground">{date}</span>
                          <span className="font-semibold">{count} ticket{count === 1 ? "" : "s"}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Ticket Outcomes</p>
            <div className="relative">
              <ResponsiveContainer width="100%" height={170}>
                <PieChart>
                  <Pie
                    data={[
                      { name: "Completed", value: Math.max(0, tech.totalTickets - tech.redoCount) },
                      { name: "Redo", value: tech.redoCount },
                    ]}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={48}
                    outerRadius={68}
                    paddingAngle={tech.redoCount > 0 && tech.totalTickets - tech.redoCount > 0 ? 3 : 0}
                    stroke="none"
                  >
                    <Cell fill="#22c55e" />
                    <Cell fill="#ef4444" />
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any, n: any) => [v, n]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <p className="text-xl font-bold">{tech.redoRatePct != null ? `${fmt1(tech.redoRatePct)}%` : "—"}</p>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Redo Rate</p>
              </div>
            </div>
            <div className="flex flex-col gap-1.5 mt-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-green-500" />Completed</span>
                <span className="font-semibold">{Math.max(0, tech.totalTickets - tech.redoCount)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-red-500" />Redo</span>
                <span className="font-semibold">{tech.redoCount}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
