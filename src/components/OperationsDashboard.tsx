/**
 * Operations Dashboard — company-wide overview for BizOps, structured the
 * same way as ClaimsDashboard.tsx / CSRDashboard.tsx (filters, KPI tiles, a
 * couple of charts, a staff table). Complements the existing "Operations
 * Daily Report" (ReportOperationsDaily.tsx), which drills into per-branch
 * LTP/aging detail across Eastern/Western/Central TX — this page is the
 * higher-level summary: every company ticket, bucketed by region and by
 * statusGroupOf() (the single source of truth for open/completed/cancelled,
 * shared with TicketList/Overall Status/the daily report so this never
 * drifts from how those already classify a status).
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, MapPin, Clock, CheckCircle2, XCircle, Users, Download, LayoutDashboard, CalendarClock } from "lucide-react";
import { BrandedLoader } from "@/components/BrandedLoader";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import * as XLSX from "xlsx";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getCompanyTickets } from "@/lib/supabase/tickets";
import { statusGroupOf, type Ticket } from "@/lib/ticketData";
import { getAllAgentNotes, type CsrAgentNote } from "@/lib/supabase/csrAgentNotes";
import { normalizeRole, ROLE_LABELS } from "@/lib/roleLabels";
import { REGIONS, REGION_LOCATIONS, locationRegion, type Region } from "@/lib/locations";
import { ReportAttendanceMonitoring } from "@/components/ReportAttendanceMonitoring";
import { WorkHoursPanel } from "@/components/WorkHoursPanel";
import { computeBranchRows, CANCEL_REASONS } from "@/lib/operationsBranchMetrics";

// BizOps Manager / Senior Manager — same roster definition as
// ReportOperationsDaily.tsx's isBizOpsProfile (kept as its own copy here,
// same convention every sibling dashboard follows — e.g. ClaimsDashboard's
// isClaimsProfile — rather than a shared cross-file helper).
const BIZOPS_ROLES = new Set(["BIZOPS_MANAGER", "BIZOPS_SENIOR_MANAGER"]);
function isBizOpsProfile(p: ProfileRow): boolean {
  if (BIZOPS_ROLES.has(normalizeRole(p.role))) return true;
  return (p.extra_roles || []).some((r) => BIZOPS_ROLES.has(normalizeRole(r)));
}

const TABS = [
  { id: "overview" as const, label: "Overview", icon: LayoutDashboard },
  { id: "cancelled" as const, label: "Cancelled", icon: XCircle },
  { id: "attendance" as const, label: "Attendance", icon: Clock },
  { id: "workHours" as const, label: "Work Hours", icon: CalendarClock },
];
type OperationsDashboardTab = (typeof TABS)[number]["id"];
const CHART_COLORS = ["#3b82f6", "#34d399", "#a78bfa", "#fb923c", "#f472b6", "#facc15", "#60a5fa", "#f87171"];
const STATUS_GROUP_COLOR: Record<string, string> = {
  Open: "#60a5fa",
  Completed: "#34d399",
  Cancelled: "#f87171",
  Other: "#94a3b8",
};
const STATUS_GROUP_LABEL: Record<string, string> = { open: "Open", completed: "Completed", cancelled: "Cancelled", other: "Other" };

// Readable label per CANCEL_REASONS entry (operationsBranchMetrics.ts) — the
// underlying values are shouted/slashed for the status-dropdown they come
// from, not fit for a table header.
const REASON_LABEL: Record<string, string> = {
  "CANCELLED BY WARRANTY": "Cancelled by Warranty",
  "CUSTOMER UNREACHABLE": "Customer Unreachable",
  "WARRANTY DISCREPANCY/OOW": "Warranty Discrepancy / OOW",
  "REFUSE SERVICE": "Refuse Service",
  DUPLICATE: "Duplicate",
  "UNIT WORKING": "Unit Working",
  "OUT OF COVERAGE": "Out of Coverage",
  "NEED FUTURE SCHEDULE": "Need Future Schedule",
  "NOT COVERED": "Not Covered",
};

export function OperationsDashboard({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<OperationsDashboardTab>("overview");

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [staff, setStaff] = useState<ProfileRow[]>([]);
  const [notes, setNotes] = useState<CsrAgentNote[]>([]);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [statusGroupFilter, setStatusGroupFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [allTickets, profiles, allNotes] = await Promise.all([
          getCompanyTickets(),
          getCompanyUsers(),
          getAllAgentNotes().catch((err) => {
            console.error("Failed to load agent notes:", err);
            return [];
          }),
        ]);
        if (cancelled) return;
        setTickets(allTickets);
        setStaff(profiles.filter((p) => p.is_active && isBizOpsProfile(p)));
        setNotes(allNotes);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load Operations Dashboard.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const regionOf = (t: Ticket) => locationRegion(t.location) || "Unassigned";

  const filteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      if (dateFrom && t.created && t.created < dateFrom) return false;
      if (dateTo && t.created && t.created > dateTo) return false;
      if (regionFilter && regionOf(t) !== regionFilter) return false;
      if (statusGroupFilter && statusGroupOf(t.status) !== statusGroupFilter) return false;
      return true;
    });
  }, [tickets, dateFrom, dateTo, regionFilter, statusGroupFilter]);

  const kpi = useMemo(() => {
    let open = 0, completed = 0, cancelled = 0;
    for (const t of filteredTickets) {
      const g = statusGroupOf(t.status);
      if (g === "open") open++;
      else if (g === "completed") completed++;
      else if (g === "cancelled") cancelled++;
    }
    return { total: filteredTickets.length, open, completed, cancelled, staffCount: staff.length };
  }, [filteredTickets, staff]);

  const regionBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of filteredTickets) {
      const key = regionOf(t);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    // Fixed region order first (CENTRAL/WEST/EAST), then any Unassigned tail.
    const ordered: { name: string; value: number }[] = REGIONS.filter((r) => map.has(r)).map((r) => ({ name: r, value: map.get(r)! }));
    if (map.has("Unassigned")) ordered.push({ name: "Unassigned", value: map.get("Unassigned")! });
    return ordered;
  }, [filteredTickets]);

  const statusGroupBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of filteredTickets) {
      const g = STATUS_GROUP_LABEL[statusGroupOf(t.status)] ?? "Other";
      map.set(g, (map.get(g) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filteredTickets]);

  // Only approved notes count as an employee's official record — same rule
  // used everywhere else this workflow shows up.
  const warningCountByProfile = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of notes) {
      if (n.status !== "approved" || n.type !== "warning") continue;
      map.set(n.agentProfileId, (map.get(n.agentProfileId) ?? 0) + 1);
    }
    return map;
  }, [notes]);
  const mistakeCountByProfile = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of notes) {
      if (n.status !== "approved" || n.type !== "mistake") continue;
      map.set(n.agentProfileId, (map.get(n.agentProfileId) ?? 0) + 1);
    }
    return map;
  }, [notes]);

  const staffRows = useMemo(() => {
    return staff
      .map((p) => ({
        id: p.id,
        name: p.display_name || p.username || p.email,
        role: ROLE_LABELS[normalizeRole(p.role)] ?? p.role,
        branch: p.assigned_branch || "—",
        // status_changed_by is stamped automatically by the ticket audit
        // trigger, so this reflects who last actually worked the ticket.
        ticketsTouched: filteredTickets.filter((t) => t.statusChangedBy === p.id).length,
        warnings: warningCountByProfile.get(p.id) ?? 0,
        mistakes: mistakeCountByProfile.get(p.id) ?? 0,
      }))
      .sort((a, b) => b.ticketsTouched - a.ticketsTouched);
  }, [staff, filteredTickets, warningCountByProfile, mistakeCountByProfile]);

  // Cancelled tickets by branch × reason — respects Date From/To and Region
  // like the Overview tab, but NOT the Status filter (this tab is inherently
  // scoped to cancelled tickets only). computeBranchRows already tallies
  // reasonCounts per branch for the existing Operations Daily Report's
  // per-region tables, so this reuses that instead of re-deriving it —
  // "cancelled" there means CL-Cancelled specifically (isCancelled()), and
  // only those tickets carry a structured reason (see its own comment).
  // inRange() (inside computeBranchRows) requires non-empty bounds, so a
  // blank Date From/To — meaning "all time" everywhere else on this page —
  // is widened to an effectively-unbounded range here.
  const cancelledBranchLocations = useMemo(
    () => (regionFilter ? REGION_LOCATIONS[regionFilter as Region] : REGIONS.flatMap((r) => REGION_LOCATIONS[r])),
    [regionFilter],
  );
  const cancelledBranchRows = useMemo(() => {
    const rows = computeBranchRows(tickets, cancelledBranchLocations, dateFrom || "0000-01-01", dateTo || "9999-12-31", new Set());
    return rows.filter((r) => r.cancelled > 0);
  }, [tickets, cancelledBranchLocations, dateFrom, dateTo]);
  const cancelledReasonTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const reason of CANCEL_REASONS) totals[reason] = 0;
    for (const row of cancelledBranchRows) {
      for (const reason of CANCEL_REASONS) totals[reason] += row.reasonCounts[reason] ?? 0;
    }
    return totals;
  }, [cancelledBranchRows]);
  const cancelledGrandTotal = cancelledBranchRows.reduce((s, r) => s + r.cancelled, 0);

  // Exports exactly what's on screen — respects the same date/region/status
  // filters as the dashboard itself.
  const exportToXlsx = () => {
    const sheet: (string | number)[][] = [
      ["Operations Dashboard Report"],
      [`Period: ${dateFrom || "All time"} to ${dateTo || "All time"}`],
      [`Generated: ${new Date().toLocaleString()}`],
      [],
      ["Summary"],
      ["Metric", "Value"],
      ["Total Tickets", kpi.total],
      ["Open", kpi.open],
      ["Completed", kpi.completed],
      ["Cancelled", kpi.cancelled],
      ["BizOps Staff", kpi.staffCount],
      [],
      ["By Region"],
      ["Region", "Tickets"],
      ...regionBreakdown.map((r) => [r.name, r.value]),
      [],
      ["By Status"],
      ["Status", "Tickets"],
      ...statusGroupBreakdown.map((s) => [s.name, s.value]),
      [],
      ["BizOps Staff"],
      ["Name", "Role", "Branch", "Tickets Touched", "Warnings", "Mistakes"],
      ...staffRows.map((s) => [s.name, s.role, s.branch, s.ticketsTouched, s.warnings, s.mistakes]),
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(sheet);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Operations Report");
    XLSX.writeFile(workbook, `operations-dashboard-report_${dateFrom || "all"}_to_${dateTo || "all"}.xlsx`);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">
        <div className="flex items-center gap-3 mb-2">
          <button type="button" onClick={goBack} className="btn hover:bg-white/15">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-2xl font-bold">{sub.title}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Company-wide ticket overview across all regions — live from ticket status.</p>
          </div>
        </div>

        <div className="flex gap-2 border-b border-white/10 mb-4 mt-4 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 border-b-2 transition whitespace-nowrap flex items-center gap-2 text-sm ${tab === t.id ? "border-blue-500 text-blue-300" : "border-transparent text-slate-400 hover:text-slate-300"}`}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
        </div>

        {tab === "cancelled" && (<>
        <div className="panel p-4 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Date From</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="glass-input mt-1 w-full" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Date To</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="glass-input mt-1 w-full" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Region</label>
              <select value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)} className="glass-input mt-1 w-full">
                <option value="">All</option>
                {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-3">
            Cancelled tickets (CL-Cancelled) by branch and cancel reason, scoped to when the ticket was created. Reason columns only fill in once BizOps records one at cancellation — leave Date From/To blank for all-time.
          </p>
        </div>

        {error ? (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
        ) : loading ? (
          <div className="panel p-8 mb-6">
            <BrandedLoader label="Loading Operations Dashboard…" />
          </div>
        ) : (
        <div className="panel p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-white/5 border-b border-white/10">
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground sticky left-0 bg-[var(--color-panel)]">Branch</th>
                  {CANCEL_REASONS.map((reason) => (
                    <th key={reason} className="px-3 py-2 text-right font-semibold text-muted-foreground whitespace-nowrap">{REASON_LABEL[reason] ?? reason}</th>
                  ))}
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground whitespace-nowrap">Total</th>
                </tr>
              </thead>
              <tbody>
                {cancelledBranchRows.length === 0 ? (
                  <tr><td colSpan={CANCEL_REASONS.length + 2} className="px-3 py-8 text-center text-muted-foreground">No cancelled tickets in this filter.</td></tr>
                ) : cancelledBranchRows.map((row) => (
                  <tr key={row.branch} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2 font-medium sticky left-0 bg-[var(--color-panel)]">{row.branch}</td>
                    {CANCEL_REASONS.map((reason) => {
                      const count = row.reasonCounts[reason] ?? 0;
                      return <td key={reason} className="px-3 py-2 text-right">{count > 0 ? count : <span className="text-muted-foreground">—</span>}</td>;
                    })}
                    <td className={`px-3 py-2 text-right font-semibold ${row.cancelled >= 10 ? "bg-red-500/20 text-red-300" : row.cancelled >= 5 ? "bg-red-500/10 text-red-200" : ""}`}>{row.cancelled}</td>
                  </tr>
                ))}
              </tbody>
              {cancelledBranchRows.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-white/20 bg-white/5 font-semibold">
                    <td className="px-3 py-2 sticky left-0 bg-[var(--color-panel)]">Total</td>
                    {CANCEL_REASONS.map((reason) => (
                      <td key={reason} className="px-3 py-2 text-right">{cancelledReasonTotals[reason] > 0 ? cancelledReasonTotals[reason] : <span className="text-muted-foreground">—</span>}</td>
                    ))}
                    <td className="px-3 py-2 text-right bg-red-500/20 text-red-300">{cancelledGrandTotal}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
        )}
        </>)}

        {tab === "attendance" && (
          <ReportAttendanceMonitoring mod={mod} sub={sub} filterProfile={isBizOpsProfile} groupBy="employee" embedded />
        )}

        {tab === "workHours" && (
          <WorkHoursPanel filterProfile={isBizOpsProfile} emptyMessage="No active BizOps staff found." />
        )}

        {tab === "overview" && (<>
        {/* Filters */}
        <div className="panel p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Date From</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="glass-input mt-1 w-full" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Date To</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="glass-input mt-1 w-full" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Region</label>
              <select value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)} className="glass-input mt-1 w-full">
                <option value="">All</option>
                {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                <option value="Unassigned">Unassigned</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Status</label>
              <select value={statusGroupFilter} onChange={(e) => setStatusGroupFilter(e.target.value)} className="glass-input mt-1 w-full">
                <option value="">All</option>
                <option value="open">Open</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-4">
            <p className="text-[10px] text-muted-foreground">
              Every company ticket, bucketed by region (Eastern/Western/Central TX) and status. Leave Date From/To blank for all-time.
            </p>
            <button onClick={exportToXlsx} disabled={loading} className="btn text-sm px-3 shrink-0 flex items-center gap-1.5 disabled:opacity-50">
              <Download className="h-3.5 w-3.5" /> Download XLSX
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
        )}

        {loading ? (
          <div className="panel p-8 mb-6">
            <BrandedLoader label="Loading Operations Dashboard…" />
          </div>
        ) : (
        <>
        {/* KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
          {[
            { label: "Total Tickets", value: kpi.total, color: "text-white", icon: <MapPin className="h-4 w-4" /> },
            { label: "Open", value: kpi.open, color: "text-blue-300", icon: <Clock className="h-4 w-4" /> },
            { label: "Completed", value: kpi.completed, color: "text-emerald-300", icon: <CheckCircle2 className="h-4 w-4" /> },
            { label: "Cancelled", value: kpi.cancelled, color: "text-red-300", icon: <XCircle className="h-4 w-4" /> },
            { label: "BizOps Staff", value: kpi.staffCount, color: "text-blue-300", icon: <Users className="h-4 w-4" /> },
          ].map((k) => (
            <div key={k.label} className="panel p-4 text-center">
              <div className="flex justify-center mb-1 text-muted-foreground">{k.icon}</div>
              <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{k.label}</p>
            </div>
          ))}
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Tickets by Region</p>
            {regionBreakdown.length === 0 ? (
              <p className="text-xs text-muted-foreground py-16 text-center">No tickets yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220} debounce={200}>
                <BarChart data={regionBreakdown} margin={{ left: -10 }}>
                  <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 6, color: "#0f172a", fontSize: 12, fontWeight: 600 }} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} name="Tickets">
                    {regionBreakdown.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Tickets by Status</p>
            {statusGroupBreakdown.length === 0 ? (
              <p className="text-xs text-muted-foreground py-16 text-center">No tickets yet.</p>
            ) : (
              <div className="flex gap-3 items-center">
                <ResponsiveContainer width="45%" height={220} debounce={200}>
                  <PieChart>
                    <Pie data={statusGroupBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={false} labelLine={false}>
                      {statusGroupBreakdown.map((entry) => <Cell key={entry.name} fill={STATUS_GROUP_COLOR[entry.name] ?? "#94a3b8"} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 6, color: "#0f172a", fontSize: 12, fontWeight: 600 }} formatter={(v: any, n: any) => [v, n]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 min-w-0 flex flex-col justify-start gap-px py-1">
                  {statusGroupBreakdown.map((entry) => {
                    const total = statusGroupBreakdown.reduce((s, d) => s + d.value, 0);
                    const pct = total > 0 ? (entry.value / total) * 100 : 0;
                    return (
                      <div key={entry.name} className="flex items-center gap-1.5 text-[10px] leading-[1.35]">
                        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: STATUS_GROUP_COLOR[entry.name] ?? "#94a3b8" }} />
                        <span className="truncate flex-1">{entry.name}</span>
                        <span className="text-muted-foreground shrink-0">{entry.value} · {pct.toFixed(0)}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Staff table */}
        <div className="panel p-0 overflow-hidden">
          <div className="px-4 py-4 border-b border-white/10">
            <h2 className="font-semibold text-sm">BizOps Staff</h2>
            <p className="text-[10px] text-muted-foreground mt-0.5">Everyone currently holding a BizOps Manager or BizOps Senior Manager role — click a name for their full stats, mistakes &amp; warnings.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-white/5 border-b border-white/10">
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Name</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Role</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Branch</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Tickets Touched</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Warnings</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Mistakes</th>
                </tr>
              </thead>
              <tbody>
                {staffRows.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No one currently holds a BizOps Manager or BizOps Senior Manager role.</td></tr>
                ) : staffRows.map((s) => (
                  <tr key={s.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2 font-medium">
                      <a href={`/csr-agent/${s.id}`} target="_blank" rel="noopener noreferrer" className="hover:text-blue-300 hover:underline transition" title={`View ${s.name}'s statistics`}>
                        {s.name}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{s.role}</td>
                    <td className="px-3 py-2 text-muted-foreground">{s.branch}</td>
                    <td className="px-3 py-2 text-right">{s.ticketsTouched}</td>
                    <td className="px-3 py-2 text-right">
                      {s.warnings > 0 ? <span className="bg-yellow-500/20 text-yellow-300 px-2 py-0.5 rounded font-semibold">{s.warnings}</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {s.mistakes > 0 ? <span className="bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded font-semibold">{s.mistakes}</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        </>
        )}
        </>)}
      </main>
    </div>
  );
}
