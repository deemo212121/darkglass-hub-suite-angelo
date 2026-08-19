/**
 * Parts Dashboard — overview for the Parts team, rebuilt on live data.
 *
 * Every number here comes from a real query: `parts` (via
 * getPartsInventoryRows — the same source the real Part Inventory page
 * uses, 159 real ticket-attached part lines as of this writing) and
 * `truck_stock` (real per-branch on-hand counts, ~7k rows). Distributor/
 * status/location/technician filter options are derived from whatever
 * values are actually present in the data, not a fixed invented list —
 * the real `status` column carries free-text values beyond the nominal
 * enum (e.g. "CX Home", "RA - PNN"), so a hardcoded dropdown would hide
 * real rows. `parts.created_by` isn't populated in this data set, so the
 * Parts staff table shows real PARTS/PARTS_MANAGER profiles with their
 * real Warnings/Mistakes record, not a fabricated "lines submitted" count.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, LayoutDashboard, Package, AlertTriangle, CheckCircle, Truck, ClipboardList, Loader2, Users, Download } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import * as XLSX from "xlsx";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getPartsInventoryRows, type PartInventoryRow } from "@/lib/supabase/partsInventory";
import { getTruckStock, type TruckStockRow } from "@/lib/supabase/truckStock";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getAllAgentNotes, type CsrAgentNote } from "@/lib/supabase/csrAgentNotes";
import { normalizeRole, ROLE_LABELS } from "@/lib/roleLabels";
import { ReportAttendanceMonitoring } from "@/components/ReportAttendanceMonitoring";

const PARTS_ROLES = new Set(["PARTS", "PARTS_MANAGER"]);
// Module-level (not defined inside the component) so ReportAttendanceMonitoring's
// data-fetching effect sees a stable reference across renders — an inline
// arrow recreated on every render would retrigger its fetch each time. Same
// pattern TriageDashboardPage.tsx already established for this component.
const isPartsProfileFilter = (p: ProfileRow) => PARTS_ROLES.has(normalizeRole(p.role));
const PENDING_STATUSES = new Set(["Need PO", "PO Made"]);
const READY_STATUSES = new Set(["Part Ready", "Tech Pickup"]);
const DONE_STATUSES = new Set(["Used", "Claimed"]);

// Fixed light tooltip — CSS-variable-based tooltips don't reliably resolve
// against the dark theme (see the CSR Status Summary Pie Breakdown, which
// established this fixed-color pattern for the same reason). Always
// readable regardless of theme or which slice/bar it's floating over.
const HIGH_CONTRAST_TOOLTIP_STYLE = {
  background: "#ffffff",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  color: "#0f172a",
  fontSize: 12,
  fontWeight: 600,
  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
} as const;

// Always show cents — rounding to whole dollars here made individual part
// prices ($13.25, $67.97, $7.00) display as $13/$68/$7, which doesn't match
// the real Part Transaction records and loses precision on every total.
const currency = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Splits the page into tabs instead of one long scroll — each tab renders
// only its own slice below, so switching tabs replaces content in place
// rather than jumping the scroll position to an anchor further down.
// Distributor spend, PO balances, warranty/vendor breakdown, and the part
// line ledger now live on the Parts Order Dashboard — this page stays
// focused on part records (status, aging, warranty, truck stock, staff).
const TABS = [
  { id: "overview" as const, label: "Overview", icon: LayoutDashboard },
  { id: "staff" as const, label: "Parts Staff", icon: Users },
];
type PartsDashboardTab = (typeof TABS)[number]["id"];

export function PartsDashboard({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [rows, setRows] = useState<PartInventoryRow[]>([]);
  const [truckStock, setTruckStock] = useState<TruckStockRow[]>([]);
  const [staff, setStaff] = useState<ProfileRow[]>([]);
  const [notes, setNotes] = useState<CsrAgentNote[]>([]);

  const [tab, setTab] = useState<PartsDashboardTab>("overview");

  // ── Dashboard-wide scope: Date Range + Branch ──
  // Applies to every KPI, chart, and table below (Part Lines by createdAt +
  // branch, Truck Stock and Parts Staff by branch only — those two are
  // current-snapshot data with no meaningful "period" of their own, same
  // reasoning Generate Report's own period already uses). Independent of
  // Generate Report's From/To below, which only ever scopes the XLSX export.
  const [scopeFrom, setScopeFrom] = useState("");
  const [scopeTo, setScopeTo] = useState("");
  const [branchFilter, setBranchFilter] = useState("");

  // ── Generate Report (CSV export) ──
  // Period applies to part lines (createdAt-scoped) — truck stock and staff
  // are current-snapshot data with no meaningful "period" of their own, so
  // those sections always reflect right now regardless of the date range.
  const [showGenerateReport, setShowGenerateReport] = useState(false);
  const [reportFrom, setReportFrom] = useState("");
  const [reportTo, setReportTo] = useState("");
  const [generatingReport, setGeneratingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [partsRows, truck, users, allNotes] = await Promise.all([
          getPartsInventoryRows(),
          getTruckStock().catch((err) => {
            console.error("Failed to load truck stock:", err);
            return [] as TruckStockRow[];
          }),
          getCompanyUsers(),
          getAllAgentNotes().catch((err) => {
            console.error("Failed to load agent notes:", err);
            return [] as CsrAgentNote[];
          }),
        ]);
        if (cancelled) return;
        setRows(partsRows);
        setTruckStock(truck);
        setStaff(users.filter((p) => p.is_active && PARTS_ROLES.has(normalizeRole(p.role))));
        setNotes(allNotes);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load Parts Dashboard.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Every branch that shows up anywhere in the raw data — always the full
  // list regardless of the current selection, so picking a branch never
  // shrinks its own dropdown.
  const branchOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.location) set.add(r.location);
    for (const t of truckStock) if (t.branch) set.add(t.branch);
    for (const p of staff) if (p.assigned_branch) set.add(p.assigned_branch);
    return Array.from(set).sort();
  }, [rows, truckStock, staff]);

  // Dashboard-wide scoping — every KPI/chart/table below reads from these,
  // not the raw loaded arrays. Truck Stock and Staff have no createdAt of
  // their own (current snapshot / current assignment), so scopeFrom/scopeTo
  // only ever narrow Part Lines; branchFilter narrows all three.
  const scopedRows = useMemo(() => {
    return rows.filter((r) => {
      if (scopeFrom && r.createdAt < scopeFrom) return false;
      if (scopeTo && r.createdAt > `${scopeTo}T23:59:59`) return false;
      if (branchFilter && r.location !== branchFilter) return false;
      return true;
    });
  }, [rows, scopeFrom, scopeTo, branchFilter]);

  const scopedTruckStock = useMemo(() => {
    if (!branchFilter) return truckStock;
    return truckStock.filter((t) => t.branch === branchFilter);
  }, [truckStock, branchFilter]);

  const scopedStaff = useMemo(() => {
    if (!branchFilter) return staff;
    return staff.filter((p) => p.assigned_branch === branchFilter);
  }, [staff, branchFilter]);

  const kpi = useMemo(() => {
    const totalSpend = scopedRows.reduce((s, r) => s + r.partPrice * r.quantity, 0);
    const pendingPO = scopedRows.filter((r) => PENDING_STATUSES.has(r.status)).length;
    const readyForPickup = scopedRows.filter((r) => READY_STATUSES.has(r.status)).length;
    const completed = scopedRows.filter((r) => DONE_STATUSES.has(r.status)).length;
    const uniqueTickets = new Set(scopedRows.map((r) => r.ticketNo).filter(Boolean)).size;
    const truckStockTotal = scopedTruckStock.reduce((s, t) => s + t.quantity, 0);
    return { totalLines: scopedRows.length, totalSpend, pendingPO, readyForPickup, completed, uniqueTickets, truckStockTotal, staffCount: scopedStaff.length };
  }, [scopedRows, scopedTruckStock, scopedStaff]);

  const statusBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of scopedRows) {
      const key = r.status || "Unspecified";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [scopedRows]);

  const truckStockByBranch = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of scopedTruckStock) {
      const key = t.branch || "Unspecified";
      map.set(key, (map.get(key) ?? 0) + t.quantity);
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 12);
  }, [scopedTruckStock]);

  // Daily trend — the live date range in this data set spans a few weeks,
  // not enough for a meaningful monthly view, so this tracks lines logged
  // per day over the trailing window instead of inventing a monthly bucket.
  // Tracks both count and $ spend per day — the toggle below switches which
  // one the chart plots, same idea as the branch PO ledger's own "Daily PO
  // Balances" sheet, which tracks dollars per day rather than line counts.
  const dailyTrend = useMemo(() => {
    const map = new Map<string, { count: number; spend: number; poNos: Set<string> }>();
    for (const r of scopedRows) {
      const day = r.createdAt.slice(0, 10);
      if (!day) continue;
      const existing = map.get(day) ?? { count: 0, spend: 0, poNos: new Set<string>() };
      existing.count += 1;
      existing.spend += r.partPrice * r.quantity;
      if (r.poNo) existing.poNos.add(r.poNo);
      map.set(day, existing);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-14)
      .map(([date, v]) => ({
        date: new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        count: v.count,
        spend: Math.round(v.spend * 100) / 100,
        poCount: v.poNos.size,
      }));
  }, [scopedRows]);

  const agingBuckets = useMemo(() => {
    const buckets = { "0-3 Days": 0, "4-7 Days": 0, "8-14 Days": 0, "15+ Days": 0 };
    for (const r of scopedRows) {
      if (DONE_STATUSES.has(r.status)) continue;
      if (r.agingDays <= 3) buckets["0-3 Days"]++;
      else if (r.agingDays <= 7) buckets["4-7 Days"]++;
      else if (r.agingDays <= 14) buckets["8-14 Days"]++;
      else buckets["15+ Days"]++;
    }
    return Object.entries(buckets).map(([label, count]) => ({ label, count }));
  }, [scopedRows]);

  // Warranty status (In/Out of Warranty) per line — the field already
  // rides along on every row (from the ticket), just never aggregated into
  // its own view before.
  const warrantyBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of scopedRows) {
      const key = r.warranty || "Unspecified";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  }, [scopedRows]);

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
    return scopedStaff
      .map((p) => ({
        id: p.id,
        name: p.display_name || p.username || p.email,
        role: ROLE_LABELS[normalizeRole(p.role)] ?? p.role,
        branch: p.assigned_branch || "—",
        warnings: warningCountByProfile.get(p.id) ?? 0,
        mistakes: mistakeCountByProfile.get(p.id) ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [scopedStaff, warningCountByProfile, mistakeCountByProfile]);

  const generateReport = () => {
    try {
      setGeneratingReport(true);
      setReportError(null);

      const inPeriod = (iso: string) => {
        if (reportFrom && iso < reportFrom) return false;
        if (reportTo && iso > `${reportTo}T23:59:59`) return false;
        return true;
      };
      // Respects the dashboard-wide Branch selector (same scope as everything
      // on screen) but its OWN From/To above, independent of the dashboard's
      // Date Range selector — this period is what actually gets exported.
      const periodRows = rows.filter((r) => inPeriod(r.createdAt) && (!branchFilter || r.location === branchFilter));

      const totalSpend = periodRows.reduce((s, r) => s + r.partPrice * r.quantity, 0);
      const pendingPO = periodRows.filter((r) => PENDING_STATUSES.has(r.status)).length;
      const readyForPickup = periodRows.filter((r) => READY_STATUSES.has(r.status)).length;
      const completed = periodRows.filter((r) => DONE_STATUSES.has(r.status)).length;
      const uniqueTickets = new Set(periodRows.map((r) => r.ticketNo).filter(Boolean)).size;

      const statusMap = new Map<string, number>();
      const locationMap = new Map<string, number>();
      for (const r of periodRows) {
        const status = r.status || "Unspecified";
        statusMap.set(status, (statusMap.get(status) ?? 0) + 1);

        const loc = r.location || "Unspecified";
        locationMap.set(loc, (locationMap.get(loc) ?? 0) + 1);
      }

      const rows_: (string | number)[][] = [
        ["Parts Dashboard Report"],
        [`Period: ${reportFrom || "All time"} to ${reportTo || "All time"}`],
        [`Branch: ${branchFilter || "All Branches"}`],
        [`Generated: ${new Date().toLocaleString()}`],
        [],
        ["Summary"],
        ["Metric", "Value"],
        ["Total Part Lines", periodRows.length],
        ["Total Spend", totalSpend.toFixed(2)],
        ["Unique Tickets", uniqueTickets],
        ["Pending PO", pendingPO],
        ["Ready for Pickup", readyForPickup],
        ["Completed", completed],
        ["Truck Stock Units (current)", kpi.truckStockTotal],
        ["Parts Staff (current)", kpi.staffCount],
        [],
        ["By Status"],
        ["Status", "Lines"],
        ...Array.from(statusMap.entries()).sort((a, b) => b[1] - a[1]),
        [],
        ["By Location"],
        ["Location", "Lines"],
        ...Array.from(locationMap.entries()).sort((a, b) => b[1] - a[1]),
        [],
        ["Truck Stock by Branch (current snapshot)"],
        ["Branch", "On-Hand Units"],
        ...truckStockByBranch.map((t) => [t.name, t.value]),
        [],
        ["Parts Staff (current)"],
        ["Name", "Role", "Branch", "Warnings", "Mistakes"],
        ...staffRows.map((s) => [s.name, s.role, s.branch, s.warnings, s.mistakes]),
      ];

      const worksheet = XLSX.utils.aoa_to_sheet(rows_);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Parts Report");
      XLSX.writeFile(workbook, `parts-dashboard-report_${reportFrom || "all"}_to_${reportTo || "all"}.xlsx`);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "Failed to generate report.");
    } finally {
      setGeneratingReport(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">

        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">{sub.title}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Live from Part Inventory &amp; Truck Stock · {kpi.staffCount} Parts staff</p>
          </div>
        </div>

        {/* Dashboard-wide scope — every KPI, chart, and table below reads
            through this Date Range + Branch selection. */}
        <div className="panel p-4 mb-6 mt-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Date From</label>
              <input type="date" aria-label="Scope date from" value={scopeFrom} onChange={(e) => setScopeFrom(e.target.value)} className="glass-input mt-1" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Date To</label>
              <input type="date" aria-label="Scope date to" value={scopeTo} onChange={(e) => setScopeTo(e.target.value)} className="glass-input mt-1" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Branch</label>
              <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="glass-input mt-1">
                <option value="">All Branches</option>
                {branchOptions.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            {(scopeFrom || scopeTo || branchFilter) && (
              <button
                type="button"
                onClick={() => { setScopeFrom(""); setScopeTo(""); setBranchFilter(""); }}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowGenerateReport((v) => !v)}
              className={`ml-auto flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${showGenerateReport ? "border-primary/40 bg-primary/15 text-primary" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
            >
              <span>📄</span>Generate Report
            </button>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">Applies to every KPI, chart, and table below (Date Range narrows Part Lines only — Truck Stock and Parts Staff are current-snapshot data with no date of their own).</p>
        </div>

        {showGenerateReport && (
          <div className="panel p-4 mb-6">
            <p className="text-sm font-semibold mb-2 flex items-center gap-1.5">
              <Download className="h-4 w-4" /> Generate Report
            </p>
            <p className="text-xs text-muted-foreground mb-4">
              Pick a period and download an XLSX of Part Lines for that window — Summary, By Status, and By Location. Truck Stock and Parts Staff are always the current snapshot, since those aren't period-based data.
            </p>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Period From</label>
                <input type="date" aria-label="Period from" title="Period from" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} className="glass-input mt-1" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Period To</label>
                <input type="date" aria-label="Period to" title="Period to" value={reportTo} onChange={(e) => setReportTo(e.target.value)} className="glass-input mt-1" />
              </div>
              <button
                type="button"
                onClick={generateReport}
                disabled={generatingReport || loading}
                className="btn bg-primary/15 border-primary/40 text-primary hover:bg-primary/25 disabled:opacity-50 inline-flex items-center gap-2"
              >
                {generatingReport ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {generatingReport ? "Generating…" : "Download XLSX"}
              </button>
            </div>
            {reportError && <p className="mt-3 text-xs text-red-300">{reportError}</p>}
            <p className="mt-3 text-[10px] text-muted-foreground">Leave both blank to cover all-time.</p>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
        )}

        {loading ? (
          <div className="panel p-8 mb-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading Parts Dashboard…
          </div>
        ) : !showGenerateReport && (
        <>
        {/* Tabs — each renders only its own slice below, replacing content
            in place instead of stacking every KPI/chart/table on one scroll. */}
        <div className="flex gap-2 border-b border-white/10 mb-4 overflow-x-auto">
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

        {tab === "overview" && (
        <>
        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
          {[
            { label: "Part Lines", value: kpi.totalLines.toLocaleString(), color: "text-blue-300", icon: <Package className="h-4 w-4" /> },
            { label: "Unique Tickets", value: kpi.uniqueTickets.toLocaleString(), color: "text-purple-300", icon: <ClipboardList className="h-4 w-4" /> },
            { label: "Pending PO", value: kpi.pendingPO, color: "text-orange-300", icon: <AlertTriangle className="h-4 w-4" /> },
            { label: "Ready for Pickup", value: kpi.readyForPickup, color: "text-cyan-300", icon: <Truck className="h-4 w-4" /> },
            { label: "Completed", value: kpi.completed, color: "text-emerald-300", icon: <CheckCircle className="h-4 w-4" /> },
            { label: "Truck Stock Units", value: kpi.truckStockTotal.toLocaleString(), color: "text-blue-300", icon: <Package className="h-4 w-4" /> },
            { label: "Parts Staff", value: kpi.staffCount, color: "text-blue-300", icon: <Users className="h-4 w-4" /> },
          ].map((k) => (
            <div key={k.label} className="panel p-3 text-center">
              <div className="flex justify-center mb-1 text-muted-foreground">{k.icon}</div>
              <p className={`text-xl font-bold ${k.color}`}>{k.value || "—"}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{k.label}</p>
            </div>
          ))}
        </div>

        {/* Trend — distributor spend/PO financials now live on the Parts
            Order Dashboard, so this stays a simple line-count trend. */}
        <div className="panel p-4 mb-4">
          <p className="text-sm font-semibold mb-4">Part Lines Logged — Last 14 Days</p>
          {dailyTrend.length === 0 ? (
            <p className="text-xs text-muted-foreground py-16 text-center">No part lines logged yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={200} debounce={200}>
              <BarChart data={dailyTrend} margin={{ left: -10 }}>
                <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={HIGH_CONTRAST_TOOLTIP_STYLE} />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Lines" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Status + aging + warranty — folded in from the old standalone
            Breakdown tab, which had nothing left in it once Location/Truck
            Stock moved to Part Lines. */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Lines by Status</p>
            <ResponsiveContainer width="100%" height={Math.max(180, statusBreakdown.length * 24)} debounce={200}>
              <BarChart data={statusBreakdown} layout="vertical" margin={{ left: 20 }}>
                <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} width={110} />
                <Tooltip contentStyle={HIGH_CONTRAST_TOOLTIP_STYLE} />
                <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Aging — Still Open</p>
            <div className="space-y-3 mt-2">
              {agingBuckets.map((b) => {
                const max = Math.max(1, ...agingBuckets.map((x) => x.count));
                return (
                  <div key={b.label}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">{b.label}</span>
                      <span className="text-orange-300">{b.count}</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full rounded-full bg-orange-400" style={{ width: `${(b.count / max) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Lines by Warranty Status</p>
            {warrantyBreakdown.length === 0 ? (
              <p className="text-xs text-muted-foreground py-16 text-center">No data yet.</p>
            ) : (
              <div className="space-y-3 mt-2">
                {warrantyBreakdown.map((b) => {
                  const max = Math.max(1, ...warrantyBreakdown.map((x) => x.count));
                  return (
                    <div key={b.label}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">{b.label}</span>
                        <span className="text-cyan-300">{b.count}</span>
                      </div>
                      <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full bg-cyan-400" style={{ width: `${(b.count / max) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        </>
        )}

        {tab === "staff" && (
        <ReportAttendanceMonitoring mod={mod} sub={sub} filterProfile={isPartsProfileFilter} groupBy="employee" embedded />
        )}

        </>
        )}
      </main>
    </div>
  );
}
