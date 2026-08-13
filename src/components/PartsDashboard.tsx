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
import { ChevronLeft, LayoutDashboard, Package, AlertTriangle, CheckCircle, Truck, ClipboardList, DollarSign, Loader2, Users, Download, Calendar, Building2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import * as XLSX from "xlsx";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getPartsInventoryRows, type PartInventoryRow } from "@/lib/supabase/partsInventory";
import { getTruckStock, type TruckStockRow } from "@/lib/supabase/truckStock";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getAllAgentNotes, type CsrAgentNote } from "@/lib/supabase/csrAgentNotes";
import { normalizeRole, ROLE_LABELS } from "@/lib/roleLabels";
import { ReportAttendanceMonitoring } from "@/components/ReportAttendanceMonitoring";

const COLORS = ["#3b82f6", "#34d399", "#a78bfa", "#fb923c", "#f472b6", "#facc15", "#22d3ee", "#60a5fa"];
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

// Shared by every panel's own one-click "Download XLSX" button below — the
// combined Generate Report at the top of the page covers all of these
// already, but as one big multi-section file; these give each panel a
// quick, focused export of just its own data.
function downloadSheetXlsx(filename: string, sheetName: string, rows: (string | number)[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, filename);
}

// Splits the page into tabs instead of one long scroll — each tab renders
// only its own slice below, so switching tabs replaces content in place
// rather than jumping the scroll position to an anchor further down.
const TABS = [
  { id: "overview" as const, label: "Overview", icon: LayoutDashboard },
  { id: "staff" as const, label: "Parts Staff", icon: Users },
  { id: "distributor" as const, label: "Distributor & Most Ordered Parts", icon: Truck },
  { id: "daily-po-balances" as const, label: "Daily PO Balances", icon: Calendar },
  { id: "wty-vendor" as const, label: "Wty/Vendor - $", icon: Building2 },
  { id: "part-lines" as const, label: "Part Lines", icon: ClipboardList },
];
type PartsDashboardTab = (typeof TABS)[number]["id"];

export function PartsDashboard({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [rows, setRows] = useState<PartInventoryRow[]>([]);
  const [truckStock, setTruckStock] = useState<TruckStockRow[]>([]);
  const [staff, setStaff] = useState<ProfileRow[]>([]);
  const [notes, setNotes] = useState<CsrAgentNote[]>([]);

  const [showDistPct, setShowDistPct] = useState(true);
  const [trendMetric, setTrendMetric] = useState<"count" | "spend" | "po_count">("count");
  const [tab, setTab] = useState<PartsDashboardTab>("overview");

  // Wty/Vendor - $ tab's own Distributor/Warranty Company filters — kept
  // local to this tab (not promoted to the dashboard-wide filter bar above)
  // so they don't change what any other tab shows.
  const [wtyDistFilter, setWtyDistFilter] = useState("");
  const [wtyCompanyFilter, setWtyCompanyFilter] = useState("");

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

  // Embedded live table filters (Part Lines section only — Location was
  // dropped from here since the dashboard-wide Branch selector above now
  // covers it for every section, not just this one table).
  const [distFilter, setDistFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [techFilter, setTechFilter] = useState("");
  const [search, setSearch] = useState("");
  const PART_LINES_PAGE_SIZE = 20;
  const [partLinesPage, setPartLinesPage] = useState(1);

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
        setStaff(users.filter((p) => PARTS_ROLES.has(normalizeRole(p.role))));
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

  const distBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of scopedRows) {
      const key = r.partDist || "Unspecified";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [scopedRows]);

  const locationBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of scopedRows) {
      const key = r.location || "Unspecified";
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

  // Daily PO Balances — per-branch $ spent per day, branch rows x day
  // columns. Mirrors the branch PO ledger's own "Daily PO Balances" sheet
  // shape more directly than a multi-line chart could with this many
  // branches (too many series to stay legible on one small chart).
  const dailyByBranchDates = useMemo(() => {
    if (scopeFrom && scopeTo) {
      const dates: string[] = [];
      const cur = new Date(`${scopeFrom}T00:00:00`);
      const end = new Date(`${scopeTo}T00:00:00`);
      while (cur <= end) {
        dates.push(cur.toISOString().slice(0, 10));
        cur.setDate(cur.getDate() + 1);
      }
      return dates;
    }
    const set = new Set<string>();
    for (const r of scopedRows) {
      const day = r.createdAt.slice(0, 10);
      if (day) set.add(day);
    }
    return Array.from(set).sort().slice(-14);
  }, [scopedRows, scopeFrom, scopeTo]);

  const dailyByBranch = useMemo(() => {
    const dateSet = new Set(dailyByBranchDates);
    const branchDayMap = new Map<string, Map<string, number>>();
    for (const r of scopedRows) {
      const day = r.createdAt.slice(0, 10);
      if (!dateSet.has(day)) continue;
      const branch = r.location || "Unspecified";
      const bmap = branchDayMap.get(branch) ?? new Map<string, number>();
      bmap.set(day, (bmap.get(day) ?? 0) + r.partPrice * r.quantity);
      branchDayMap.set(branch, bmap);
    }
    return Array.from(branchDayMap.entries())
      .map(([branch, byDate]) => ({
        branch,
        byDate: dailyByBranchDates.map((d) => byDate.get(d) ?? 0),
        total: dailyByBranchDates.reduce((s, d) => s + (byDate.get(d) ?? 0), 0),
      }))
      .sort((a, b) => b.total - a.total);
  }, [scopedRows, dailyByBranchDates]);

  // Chart view of the table above — a full branch x day matrix doesn't
  // chart legibly with this many branches/dates, so this summarizes just
  // the Total column (top 10 branches by spend over the current window).
  // The combined day-by-day trend across all branches already lives on
  // the Overview tab's Lines/Spend/PO Count chart.
  const dailyByBranchChartData = useMemo(
    () => dailyByBranch.slice(0, 10).map((r) => ({ name: r.branch, value: Math.round(r.total * 100) / 100 })),
    [dailyByBranch]
  );

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

  const topParts = useMemo(() => {
    const map = new Map<string, { partNo: string; desc: string; count: number; spend: number }>();
    for (const r of scopedRows) {
      if (!r.partNo) continue;
      const key = r.partNo;
      const existing = map.get(key) ?? { partNo: r.partNo, desc: r.partDesc, count: 0, spend: 0 };
      existing.count += 1;
      existing.spend += r.partPrice * r.quantity;
      if (!existing.desc && r.partDesc) existing.desc = r.partDesc;
      map.set(key, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [scopedRows]);

  const distTable = useMemo(() => {
    const totalLines = scopedRows.length || 1;
    const map = new Map<string, { name: string; lines: number; spend: number }>();
    for (const r of scopedRows) {
      const key = r.partDist || "Unspecified";
      const existing = map.get(key) ?? { name: key, lines: 0, spend: 0 };
      existing.lines += 1;
      existing.spend += r.partPrice * r.quantity;
      map.set(key, existing);
    }
    return Array.from(map.values())
      .map((d) => ({ ...d, share: Math.round((d.lines / totalLines) * 1000) / 10 }))
      .sort((a, b) => b.lines - a.lines);
  }, [scopedRows]);

  // Chart views for the Distributor & Most Ordered Parts tab — top 10 each
  // by their table's own primary sort (Distributor by $ spend, Parts by
  // times ordered), not the same axis Overview's own distributor pie uses
  // (that one's line-count share, this is $ spend).
  const distSpendChartData = useMemo(
    () => [...distTable].sort((a, b) => b.spend - a.spend).slice(0, 10).map((d) => ({ name: d.name, value: Math.round(d.spend * 100) / 100 })),
    [distTable]
  );
  const topPartsChartData = useMemo(
    () => topParts.map((p) => ({ name: p.partNo, value: p.count })),
    [topParts]
  );

  // Wty/Vendor - $ tab — its own Distributor/Warranty Company filters,
  // layered on top of the dashboard-wide Date Range + Branch scope.
  const wtyCompanyOptions = useMemo(() => Array.from(new Set(scopedRows.map((r) => r.claimCompany).filter(Boolean))).sort(), [scopedRows]);

  const wtyVendorScopedRows = useMemo(() => {
    return scopedRows.filter((r) => {
      if (wtyDistFilter && r.partDist !== wtyDistFilter) return false;
      if (wtyCompanyFilter && r.claimCompany !== wtyCompanyFilter) return false;
      return true;
    });
  }, [scopedRows, wtyDistFilter, wtyCompanyFilter]);

  // Crosstab: rows = Warranty Company (claim_company — the actual payer,
  // distinct from `warranty`'s In/Out-of-Warranty status), columns =
  // Distributor, cells = $ spent — mirrors the branch PO ledger's own
  // "WtyVendor - $" sheet (distributor totals broken down per warranty).
  const wtyVendorCrosstab = useMemo(() => {
    const distributors = Array.from(new Set(wtyVendorScopedRows.map((r) => r.partDist || "Unspecified"))).sort();
    const companies = Array.from(new Set(wtyVendorScopedRows.map((r) => r.claimCompany || "Unspecified"))).sort();
    const cellMap = new Map<string, number>();
    for (const r of wtyVendorScopedRows) {
      const company = r.claimCompany || "Unspecified";
      const dist = r.partDist || "Unspecified";
      const key = `${company}::${dist}`;
      cellMap.set(key, (cellMap.get(key) ?? 0) + r.partPrice * r.quantity);
    }
    const rows = companies
      .map((company) => {
        const cells = distributors.map((dist) => cellMap.get(`${company}::${dist}`) ?? 0);
        const rowTotal = cells.reduce((s, v) => s + v, 0);
        return { company, cells, rowTotal };
      })
      .sort((a, b) => b.rowTotal - a.rowTotal);
    const columnTotals = distributors.map((_, i) => rows.reduce((s, r) => s + r.cells[i], 0));
    const grandTotal = columnTotals.reduce((s, v) => s + v, 0);
    return { distributors, rows, columnTotals, grandTotal };
  }, [wtyVendorScopedRows]);

  // Chart view of the crosstab above — a full 2D grid doesn't chart legibly
  // with this many distributors/companies, so these summarize each axis on
  // its own (row totals, column totals), capped to the top 10 by spend.
  const wtyCompanyChartData = useMemo(
    () => wtyVendorCrosstab.rows.slice(0, 10).map((r) => ({ name: r.company, value: Math.round(r.rowTotal * 100) / 100 })),
    [wtyVendorCrosstab]
  );
  const wtyDistributorChartData = useMemo(
    () => wtyVendorCrosstab.distributors
      .map((name, i) => ({ name, value: Math.round(wtyVendorCrosstab.columnTotals[i] * 100) / 100 }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10),
    [wtyVendorCrosstab]
  );

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

  // Real in-stock lookup — matches the embedded table's part numbers
  // against truck_stock instead of showing an invented reserved/available
  // quantity.
  const stockByPartNo = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of scopedTruckStock) {
      const key = t.partNo.trim().toUpperCase();
      if (!key) continue;
      map.set(key, (map.get(key) ?? 0) + t.quantity);
    }
    return map;
  }, [scopedTruckStock]);

  const distOptions = useMemo(() => Array.from(new Set(scopedRows.map((r) => r.partDist).filter(Boolean))).sort(), [scopedRows]);
  const statusOptions = useMemo(() => Array.from(new Set(scopedRows.map((r) => r.status).filter(Boolean))).sort(), [scopedRows]);
  const techOptions = useMemo(() => Array.from(new Set(scopedRows.map((r) => r.technician).filter(Boolean))).sort(), [scopedRows]);

  const filteredRows = useMemo(() => {
    return scopedRows.filter((r) => {
      if (distFilter && r.partDist !== distFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (techFilter && r.technician !== techFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!r.ticketNo.toLowerCase().includes(q) && !r.partNo.toLowerCase().includes(q) && !r.partDesc.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [scopedRows, distFilter, statusFilter, techFilter, search]);

  // Jump back to page 1 whenever the filtered set changes underneath the
  // current page — otherwise narrowing a filter can strand the view on a
  // now-empty page.
  useEffect(() => {
    setPartLinesPage(1);
  }, [scopeFrom, scopeTo, branchFilter, distFilter, statusFilter, techFilter, search]);

  const partLinesTotalPages = Math.max(1, Math.ceil(filteredRows.length / PART_LINES_PAGE_SIZE));
  const partLinesPageSafe = Math.min(partLinesPage, partLinesTotalPages);
  const pagedRows = useMemo(
    () => filteredRows.slice((partLinesPageSafe - 1) * PART_LINES_PAGE_SIZE, partLinesPageSafe * PART_LINES_PAGE_SIZE),
    [filteredRows, partLinesPageSafe],
  );

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

      const distMap = new Map<string, { lines: number; spend: number }>();
      const statusMap = new Map<string, number>();
      const locationMap = new Map<string, number>();
      const partsMap = new Map<string, { desc: string; count: number; spend: number }>();
      for (const r of periodRows) {
        const dist = r.partDist || "Unspecified";
        const d = distMap.get(dist) ?? { lines: 0, spend: 0 };
        d.lines += 1;
        d.spend += r.partPrice * r.quantity;
        distMap.set(dist, d);

        const status = r.status || "Unspecified";
        statusMap.set(status, (statusMap.get(status) ?? 0) + 1);

        const loc = r.location || "Unspecified";
        locationMap.set(loc, (locationMap.get(loc) ?? 0) + 1);

        if (r.partNo) {
          const p = partsMap.get(r.partNo) ?? { desc: r.partDesc, count: 0, spend: 0 };
          p.count += 1;
          p.spend += r.partPrice * r.quantity;
          if (!p.desc && r.partDesc) p.desc = r.partDesc;
          partsMap.set(r.partNo, p);
        }
      }

      // Daily PO Balances — branch x day $ spent, same shape as the Daily
      // PO Balances tab's on-screen table but over the report's own period
      // (not capped to a trailing window, since this is a one-time export).
      const branchDayDates = Array.from(new Set(periodRows.map((r) => r.createdAt.slice(0, 10)).filter(Boolean))).sort();
      const branchDayMap = new Map<string, Map<string, number>>();
      for (const r of periodRows) {
        const day = r.createdAt.slice(0, 10);
        if (!day) continue;
        const branch = r.location || "Unspecified";
        const bmap = branchDayMap.get(branch) ?? new Map<string, number>();
        bmap.set(day, (bmap.get(day) ?? 0) + r.partPrice * r.quantity);
        branchDayMap.set(branch, bmap);
      }
      const branchDayRows = Array.from(branchDayMap.entries())
        .map(([branch, byDate]) => ({
          branch,
          total: branchDayDates.reduce((s, d) => s + (byDate.get(d) ?? 0), 0),
          cells: branchDayDates.map((d) => (byDate.get(d) ?? 0).toFixed(2)),
        }))
        .sort((a, b) => Number(b.total) - Number(a.total));

      // Wty/Vendor - $ — warranty company (claim_company) x distributor $ spent.
      const wtyDistributors = Array.from(new Set(periodRows.map((r) => r.partDist || "Unspecified"))).sort();
      const wtyCompanies = Array.from(new Set(periodRows.map((r) => r.claimCompany || "Unspecified"))).sort();
      const wtyCellMap = new Map<string, number>();
      for (const r of periodRows) {
        const key = `${r.claimCompany || "Unspecified"}::${r.partDist || "Unspecified"}`;
        wtyCellMap.set(key, (wtyCellMap.get(key) ?? 0) + r.partPrice * r.quantity);
      }
      const wtyRows = wtyCompanies
        .map((company) => {
          const cells = wtyDistributors.map((dist) => (wtyCellMap.get(`${company}::${dist}`) ?? 0).toFixed(2));
          const total = wtyDistributors.reduce((s, dist) => s + (wtyCellMap.get(`${company}::${dist}`) ?? 0), 0);
          return { company, cells, total };
        })
        .sort((a, b) => b.total - a.total);

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
        ["By Distributor"],
        ["Distributor", "Lines", "Spend"],
        ...Array.from(distMap.entries()).sort((a, b) => b[1].lines - a[1].lines).map(([name, d]) => [name, d.lines, d.spend.toFixed(2)]),
        [],
        ["By Status"],
        ["Status", "Lines"],
        ...Array.from(statusMap.entries()).sort((a, b) => b[1] - a[1]),
        [],
        ["By Location"],
        ["Location", "Lines"],
        ...Array.from(locationMap.entries()).sort((a, b) => b[1] - a[1]),
        [],
        ["Most Ordered Parts"],
        ["Part No", "Description", "Times Ordered", "Spend"],
        ...Array.from(partsMap.entries()).sort((a, b) => b[1].count - a[1].count).slice(0, 25).map(([partNo, p]) => [partNo, p.desc, p.count, p.spend.toFixed(2)]),
        [],
        ["Daily PO Balances — $ Spent per Branch per Day"],
        ["Branch", ...branchDayDates, "Total"],
        ...branchDayRows.map((r) => [r.branch, ...r.cells, r.total.toFixed(2)]),
        [],
        ["Wty/Vendor - $ — Warranty Company x Distributor"],
        ["Warranty Company", ...wtyDistributors, "Total"],
        ...wtyRows.map((r) => [r.company, ...r.cells, r.total.toFixed(2)]),
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
              Pick a period and download an XLSX of Part Lines for that window — Summary, By Distributor, By Status, By Location, and Most Ordered Parts. Truck Stock and Parts Staff are always the current snapshot, since those aren't period-based data.
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
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-4">
          {[
            { label: "Part Lines", value: kpi.totalLines.toLocaleString(), color: "text-blue-300", icon: <Package className="h-4 w-4" /> },
            { label: "Total Spend", value: currency(kpi.totalSpend), color: "text-green-300", icon: <DollarSign className="h-4 w-4" /> },
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

        {/* Charts row 1 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          <div className="panel p-4 lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold">{trendMetric === "count" ? "Part Lines Logged" : trendMetric === "spend" ? "Part Spend" : "PO Count"} — Last 14 Days</p>
              <div className="flex rounded border border-white/10 overflow-hidden text-[10px] uppercase tracking-wide">
                <button
                  onClick={() => setTrendMetric("count")}
                  className={`px-2 py-1 transition-colors ${trendMetric === "count" ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-white/5"}`}
                >
                  Lines
                </button>
                <button
                  onClick={() => setTrendMetric("spend")}
                  className={`px-2 py-1 transition-colors border-l border-white/10 ${trendMetric === "spend" ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-white/5"}`}
                >
                  Spend
                </button>
                <button
                  onClick={() => setTrendMetric("po_count")}
                  className={`px-2 py-1 transition-colors border-l border-white/10 ${trendMetric === "po_count" ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-white/5"}`}
                  title="Count of distinct PO numbers per day, not raw line count"
                >
                  PO Count
                </button>
              </div>
            </div>
            {dailyTrend.length === 0 ? (
              <p className="text-xs text-muted-foreground py-16 text-center">No part lines logged yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={200} debounce={200}>
                <BarChart data={dailyTrend} margin={{ left: -10 }}>
                  <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} tickFormatter={trendMetric === "spend" ? (v) => `$${v}` : undefined} />
                  <Tooltip contentStyle={HIGH_CONTRAST_TOOLTIP_STYLE} formatter={(v: any) => trendMetric === "spend" ? currency(Number(v)) : v} />
                  {trendMetric === "count" ? (
                    <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Lines" />
                  ) : trendMetric === "spend" ? (
                    <Bar dataKey="spend" fill="#34d399" radius={[4, 4, 0, 0]} name="Spend" />
                  ) : (
                    <Bar dataKey="poCount" fill="#a78bfa" radius={[4, 4, 0, 0]} name="PO Count" />
                  )}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="panel p-4">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold">Lines by Distributor</p>
              {distBreakdown.length > 0 && (
                <button
                  onClick={() => setShowDistPct((v) => !v)}
                  className={`text-[10px] uppercase tracking-wide px-2 py-1 rounded border transition-colors ${showDistPct ? "border-white/20 bg-white/10 text-foreground" : "border-white/10 text-muted-foreground hover:text-foreground hover:bg-white/5"}`}
                >
                  {showDistPct ? "Hide %" : "Show %"}
                </button>
              )}
            </div>
            {distBreakdown.length === 0 ? (
              <p className="text-xs text-muted-foreground py-16 text-center">No data yet.</p>
            ) : (
              // On-slice labels overlap once there are more than a handful of
              // distributors — instead the pie sits label-free on the left
              // and every slice gets its own row (name + count + %) on the
              // right, same pattern as Status Summary's Pie Breakdown.
              <div className="flex gap-3 items-center">
                <ResponsiveContainer width="50%" height={200} debounce={200}>
                  <PieChart>
                    <Pie data={distBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={false} labelLine={false}>
                      {distBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={HIGH_CONTRAST_TOOLTIP_STYLE} formatter={(v: any, n: any) => [v, n]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
                  {distBreakdown.map((entry, i) => {
                    const total = distBreakdown.reduce((s, d) => s + d.value, 0);
                    const pct = total > 0 ? (entry.value / total) * 100 : 0;
                    return (
                      <div key={entry.name} className="flex items-center gap-1.5 text-[11px] leading-tight">
                        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                        <span className="truncate flex-1">{entry.name}</span>
                        <span className="text-muted-foreground shrink-0">
                          {entry.value}{showDistPct ? ` · ${pct.toFixed(0)}%` : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
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

        {tab === "distributor" && (
        <>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Top Distributors by Spend</p>
            {distSpendChartData.length === 0 ? (
              <p className="text-xs text-muted-foreground py-16 text-center">No data yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(180, distSpendChartData.length * 26)} debounce={200}>
                <BarChart data={distSpendChartData} layout="vertical" margin={{ left: 20 }}>
                  <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} width={120} />
                  <Tooltip contentStyle={HIGH_CONTRAST_TOOLTIP_STYLE} formatter={(v: any) => currency(Number(v))} />
                  <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} name="Spend" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Most Ordered Parts (Times Ordered)</p>
            {topPartsChartData.length === 0 ? (
              <p className="text-xs text-muted-foreground py-16 text-center">No data yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(180, topPartsChartData.length * 26)} debounce={200}>
                <BarChart data={topPartsChartData} layout="vertical" margin={{ left: 20 }}>
                  <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} width={120} />
                  <Tooltip contentStyle={HIGH_CONTRAST_TOOLTIP_STYLE} />
                  <Bar dataKey="value" fill="#a78bfa" radius={[0, 4, 4, 0]} name="Times Ordered" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <div className="panel p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex items-center gap-2">
              <Truck className="h-4 w-4 text-blue-400" />Distributor Breakdown
              <button
                type="button"
                onClick={() => downloadSheetXlsx(
                  `distributor-breakdown_${new Date().toISOString().slice(0, 10)}.xlsx`,
                  "Distributor Breakdown",
                  [["Distributor", "Lines", "Spend", "Share"], ...distTable.map((d) => [d.name, d.lines, d.spend.toFixed(2), `${d.share}%`])]
                )}
                className="ml-auto flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />Download XLSX
              </button>
            </div>
            <table className="w-full text-sm">
              <thead><tr className="border-b border-white/10 bg-white/5">
                {["Distributor", "Lines", "Spend", "Share"].map((h) => <th key={h} className="px-4 py-2 text-left text-xs text-muted-foreground uppercase">{h}</th>)}
              </tr></thead>
              <tbody>
                {distTable.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No data yet.</td></tr>
                ) : distTable.map((d, i) => (
                  <tr key={d.name} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                    <td className="px-4 py-2 font-medium">{d.name}</td>
                    <td className="px-4 py-2 text-blue-300">{d.lines.toLocaleString()}</td>
                    <td className="px-4 py-2 text-green-300">{currency(d.spend)}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 rounded-full bg-white/10 overflow-hidden">
                          <div className="h-full rounded-full bg-blue-400" style={{ width: `${Math.min(100, d.share)}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground">{d.share}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex items-center gap-2">
              <Package className="h-4 w-4 text-purple-400" />Most Ordered Parts
              <button
                type="button"
                onClick={() => downloadSheetXlsx(
                  `most-ordered-parts_${new Date().toISOString().slice(0, 10)}.xlsx`,
                  "Most Ordered Parts",
                  [["Part No", "Description", "Times Ordered", "Total Spend"], ...topParts.map((p) => [p.partNo, p.desc, p.count, p.spend.toFixed(2)])]
                )}
                className="ml-auto flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />Download XLSX
              </button>
            </div>
            <table className="w-full text-sm">
              <thead><tr className="border-b border-white/10 bg-white/5">
                {["Part No", "Description", "Times Ordered", "Total Spend"].map((h) => <th key={h} className="px-4 py-2 text-left text-xs text-muted-foreground uppercase">{h}</th>)}
              </tr></thead>
              <tbody>
                {topParts.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No data yet.</td></tr>
                ) : topParts.map((p, i) => (
                  <tr key={p.partNo + i} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                    <td className="px-4 py-2 font-mono text-xs text-blue-300">{p.partNo}</td>
                    <td className="px-4 py-2 text-xs">{p.desc || "—"}</td>
                    <td className="px-4 py-2 text-blue-300">{p.count}</td>
                    <td className="px-4 py-2 text-green-300">{currency(p.spend)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        </>
        )}

        {tab === "daily-po-balances" && (
        <>
        <div className="panel p-4 mb-4">
          <p className="text-sm font-semibold mb-4">Top Branches by Total Spend</p>
          {dailyByBranchChartData.length === 0 ? (
            <p className="text-xs text-muted-foreground py-16 text-center">No data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(180, dailyByBranchChartData.length * 26)} debounce={200}>
              <BarChart data={dailyByBranchChartData} layout="vertical" margin={{ left: 20 }}>
                <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} width={120} />
                <Tooltip contentStyle={HIGH_CONTRAST_TOOLTIP_STYLE} formatter={(v: any) => currency(Number(v))} />
                <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} name="Spend" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="panel p-0 overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex items-center gap-2">
            <Calendar className="h-4 w-4 text-blue-400" />Daily PO Balances — $ Spent per Branch per Day
            <button
              type="button"
              onClick={() => downloadSheetXlsx(
                `daily-po-balances_${new Date().toISOString().slice(0, 10)}.xlsx`,
                "Daily PO Balances",
                [["Branch", ...dailyByBranchDates, "Total"], ...dailyByBranch.map((r) => [r.branch, ...r.byDate.map((v) => v.toFixed(2)), r.total.toFixed(2)])]
              )}
              className="ml-auto flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />Download XLSX
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground sticky left-0 bg-slate-950">Branch</th>
                  {dailyByBranchDates.map((d) => (
                    <th key={d} className="px-2 py-2 text-right font-semibold text-muted-foreground whitespace-nowrap">
                      {new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Total</th>
                </tr>
              </thead>
              <tbody>
                {dailyByBranch.length === 0 ? (
                  <tr><td colSpan={dailyByBranchDates.length + 2} className="px-4 py-8 text-center text-muted-foreground">No data yet.</td></tr>
                ) : dailyByBranch.map((row, i) => (
                  <tr key={row.branch} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                    <td className="px-3 py-2 font-medium sticky left-0 bg-slate-950">{row.branch}</td>
                    {row.byDate.map((v, di) => (
                      <td key={di} className="px-2 py-2 text-right text-muted-foreground">{v > 0 ? currency(v) : "—"}</td>
                    ))}
                    <td className="px-3 py-2 text-right text-green-300 font-semibold">{currency(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-[10px] text-muted-foreground border-t border-white/10">
            Columns follow the dashboard-wide Date Range above when set, otherwise the trailing 14 days with activity. Use the Overview tab's Lines/Spend/PO Count toggle for the company-wide daily trend.
          </p>
        </div>
        </>
        )}

        {tab === "wty-vendor" && (
        <div className="mb-4">
          <div className="panel p-4 mb-4">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Distributor</label>
                <select value={wtyDistFilter} onChange={(e) => setWtyDistFilter(e.target.value)} className="glass-input mt-1">
                  <option value="">All Distributors</option>
                  {distOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Warranty Company</label>
                <select value={wtyCompanyFilter} onChange={(e) => setWtyCompanyFilter(e.target.value)} className="glass-input mt-1">
                  <option value="">All Warranty Companies</option>
                  {wtyCompanyOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              {(wtyDistFilter || wtyCompanyFilter) && (
                <button
                  type="button"
                  onClick={() => { setWtyDistFilter(""); setWtyCompanyFilter(""); }}
                  className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                >
                  Clear
                </button>
              )}
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">Layered on top of the dashboard-wide Date Range + Branch scope above. Date Range and Branch already apply here — these two are local to this tab.</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <div className="panel p-4">
              <p className="text-sm font-semibold mb-4">Top Warranty Companies by Spend</p>
              {wtyCompanyChartData.length === 0 ? (
                <p className="text-xs text-muted-foreground py-16 text-center">No data yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(180, wtyCompanyChartData.length * 26)} debounce={200}>
                  <BarChart data={wtyCompanyChartData} layout="vertical" margin={{ left: 20 }}>
                    <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                    <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} width={120} />
                    <Tooltip contentStyle={HIGH_CONTRAST_TOOLTIP_STYLE} formatter={(v: any) => currency(Number(v))} />
                    <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} name="Spend" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="panel p-4">
              <p className="text-sm font-semibold mb-4">Top Distributors by Spend</p>
              {wtyDistributorChartData.length === 0 ? (
                <p className="text-xs text-muted-foreground py-16 text-center">No data yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(180, wtyDistributorChartData.length * 26)} debounce={200}>
                  <BarChart data={wtyDistributorChartData} layout="vertical" margin={{ left: 20 }}>
                    <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                    <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} width={120} />
                    <Tooltip contentStyle={HIGH_CONTRAST_TOOLTIP_STYLE} formatter={(v: any) => currency(Number(v))} />
                    <Bar dataKey="value" fill="#34d399" radius={[0, 4, 4, 0]} name="Spend" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="panel p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex items-center gap-2">
              <Building2 className="h-4 w-4 text-blue-400" />Spend by Warranty Company × Distributor
              <button
                type="button"
                onClick={() => downloadSheetXlsx(
                  `wty-vendor_${new Date().toISOString().slice(0, 10)}.xlsx`,
                  "Wty-Vendor",
                  [
                    ["Warranty Company", ...wtyVendorCrosstab.distributors, "Total"],
                    ...wtyVendorCrosstab.rows.map((r) => [r.company, ...r.cells.map((v) => v.toFixed(2)), r.rowTotal.toFixed(2)]),
                    ["Total", ...wtyVendorCrosstab.columnTotals.map((v) => v.toFixed(2)), wtyVendorCrosstab.grandTotal.toFixed(2)],
                  ]
                )}
                className="ml-auto flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />Download XLSX
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground sticky left-0 bg-slate-950">Warranty Company</th>
                    {wtyVendorCrosstab.distributors.map((d) => (
                      <th key={d} className="px-2 py-2 text-right font-semibold text-muted-foreground whitespace-nowrap">{d}</th>
                    ))}
                    <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {wtyVendorCrosstab.rows.length === 0 ? (
                    <tr><td colSpan={wtyVendorCrosstab.distributors.length + 2} className="px-4 py-8 text-center text-muted-foreground">No data yet.</td></tr>
                  ) : wtyVendorCrosstab.rows.map((row, i) => (
                    <tr key={row.company} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                      <td className="px-3 py-2 font-medium sticky left-0 bg-slate-950">{row.company}</td>
                      {row.cells.map((v, ci) => (
                        <td key={ci} className="px-2 py-2 text-right text-muted-foreground">{v > 0 ? currency(v) : "—"}</td>
                      ))}
                      <td className="px-3 py-2 text-right text-green-300 font-semibold">{currency(row.rowTotal)}</td>
                    </tr>
                  ))}
                </tbody>
                {wtyVendorCrosstab.rows.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-white/10 bg-white/5">
                      <td className="px-3 py-2 font-semibold sticky left-0 bg-slate-950">Total</td>
                      {wtyVendorCrosstab.columnTotals.map((v, i) => (
                        <td key={i} className="px-2 py-2 text-right font-semibold text-muted-foreground">{v > 0 ? currency(v) : "—"}</td>
                      ))}
                      <td className="px-3 py-2 text-right font-semibold text-green-300">{currency(wtyVendorCrosstab.grandTotal)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
        )}

        {tab === "part-lines" && (
        <>
        {/* Location + Truck Stock context for the part lines below — moved
            here from Breakdown since both charts describe this same data
            (line counts and in-stock levels per branch), not a general
            company-wide breakdown. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Lines by Location</p>
            <ResponsiveContainer width="100%" height={220} debounce={200}>
              <BarChart data={locationBreakdown} margin={{ left: -10 }}>
                <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 9 }} angle={-25} textAnchor="end" height={52} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={HIGH_CONTRAST_TOOLTIP_STYLE} />
                <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Lines" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Truck Stock — Top Branches by On-Hand Units</p>
            <ResponsiveContainer width="100%" height={220} debounce={200}>
              <BarChart data={truckStockByBranch} margin={{ left: -10 }}>
                <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 9 }} angle={-25} textAnchor="end" height={52} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={HIGH_CONTRAST_TOOLTIP_STYLE} />
                <Bar dataKey="value" fill="#34d399" radius={[4, 4, 0, 0]} name="On-Hand" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-purple-400" />
            <span className="font-semibold text-sm">Part Lines</span>
            <button
              type="button"
              onClick={() => downloadSheetXlsx(
                `part-lines_${new Date().toISOString().slice(0, 10)}.xlsx`,
                "Part Lines",
                [
                  ["Ticket", "Branch/Location", "Technician", "Status", "Warranty", "Part No", "Description", "Distributor", "Qty", "Price", "In Truck Stock", "Aging (days)"],
                  ...filteredRows.map((r) => [
                    r.ticketNo, r.location, r.technician, r.status, r.warranty, r.partNo, r.partDesc, r.partDist,
                    r.quantity, r.partPrice.toFixed(2), stockByPartNo.get(r.partNo.trim().toUpperCase()) ?? "", r.agingDays,
                  ]),
                ]
              )}
              className="ml-auto flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />Download XLSX
            </button>
            <Link to="/m/$module/$submodule" params={{ module: "parts", submodule: "part-inventory" }}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors">Open full page →</Link>
          </div>

          <div className="p-4 border-b border-white/10 bg-white/[0.01]">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Distributor</label>
                <select value={distFilter} onChange={(e) => setDistFilter(e.target.value)} className="glass-input mt-1 w-full">
                  <option value="">All Distributors</option>
                  {distOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Status</label>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="glass-input mt-1 w-full">
                  <option value="">All Statuses</option>
                  {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Technician</label>
                <select value={techFilter} onChange={(e) => setTechFilter(e.target.value)} className="glass-input mt-1 w-full">
                  <option value="">All Technicians</option>
                  {techOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Search</label>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ticket, part #, description"
                  className="glass-input mt-1 w-full" />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-white/10 bg-white/[0.01]">
            <span className="text-sm text-muted-foreground">Total Lines: {filteredRows.length}</span>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span>Showing {pagedRows.length} of {filteredRows.length}</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPartLinesPage((p) => Math.max(1, p - 1))}
                  disabled={partLinesPageSafe <= 1}
                  className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent text-xs"
                >
                  Prev
                </button>
                <span className="px-1">Page {partLinesPageSafe} of {partLinesTotalPages}</span>
                <button
                  type="button"
                  onClick={() => setPartLinesPage((p) => Math.min(partLinesTotalPages, p + 1))}
                  disabled={partLinesPageSafe >= partLinesTotalPages}
                  className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent text-xs"
                >
                  Next
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="px-3 py-2.5 text-left text-xs text-muted-foreground uppercase">Ticket</th>
                  <th className="px-3 py-2.5 text-left text-xs text-muted-foreground uppercase">Branch/Location</th>
                  <th className="px-3 py-2.5 text-left text-xs text-muted-foreground uppercase">Status</th>
                  <th className="px-3 py-2.5 text-left text-xs text-muted-foreground uppercase">Part / Distributor</th>
                  <th className="px-3 py-2.5 text-right text-xs text-muted-foreground uppercase">Qty</th>
                  <th className="px-3 py-2.5 text-right text-xs text-muted-foreground uppercase">Price</th>
                  <th className="px-3 py-2.5 text-right text-xs text-muted-foreground uppercase">In Truck Stock</th>
                  <th className="px-3 py-2.5 text-right text-xs text-muted-foreground uppercase">Aging</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">No records match current filters.</td></tr>
                ) : pagedRows.map((r) => {
                  const inStock = stockByPartNo.get(r.partNo.trim().toUpperCase());
                  return (
                    <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-3 py-2.5 align-top">
                        <Link to="/ticket/$ticketNo" params={{ ticketNo: r.ticketNo }} className="font-mono text-xs text-blue-400 hover:underline">{r.ticketNo || "—"}</Link>
                        {r.technician && <p className="text-[10px] text-muted-foreground mt-0.5">{r.technician}</p>}
                      </td>
                      <td className="px-3 py-2.5 align-top text-xs">{r.location || "—"}</td>
                      <td className="px-3 py-2.5 align-top">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] border ${PENDING_STATUSES.has(r.status) ? "bg-red-500/15 text-red-300 border-red-500/25" : READY_STATUSES.has(r.status) ? "bg-yellow-500/15 text-yellow-300 border-yellow-500/25" : DONE_STATUSES.has(r.status) ? "bg-green-500/15 text-green-300 border-green-500/25" : "bg-white/10 text-muted-foreground border-white/10"}`}>
                          {r.status || "—"}
                        </span>
                        {r.warranty && <p className="text-[10px] text-muted-foreground mt-1">{r.warranty}</p>}
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <p className="text-xs font-medium">{r.partDesc || "—"}</p>
                        <p className="font-mono text-[11px] text-blue-300 mt-0.5">{r.partNo || "—"}</p>
                        <p className="text-[10px] text-muted-foreground/70 mt-0.5">{r.partDist || "—"}</p>
                      </td>
                      <td className="px-3 py-2.5 align-top text-right">{r.quantity}</td>
                      <td className="px-3 py-2.5 align-top text-right text-green-300">{currency(r.partPrice)}</td>
                      <td className="px-3 py-2.5 align-top text-right">
                        {inStock !== undefined ? <span className={inStock > 0 ? "text-green-300 font-semibold" : "text-red-300"}>{inStock}</span> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2.5 align-top text-right text-muted-foreground">{r.agingDays}d</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {partLinesTotalPages > 1 && (
            <div className="flex items-center justify-center gap-1 px-4 py-2.5 border-t border-white/10">
              <button
                type="button"
                onClick={() => setPartLinesPage((p) => Math.max(1, p - 1))}
                disabled={partLinesPageSafe <= 1}
                className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent text-xs"
              >
                Prev
              </button>
              <span className="px-2 text-xs text-muted-foreground">Page {partLinesPageSafe} of {partLinesTotalPages}</span>
              <button
                type="button"
                onClick={() => setPartLinesPage((p) => Math.min(partLinesTotalPages, p + 1))}
                disabled={partLinesPageSafe >= partLinesTotalPages}
                className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent text-xs"
              >
                Next
              </button>
            </div>
          )}
        </div>
        </>
        )}
        </>
        )}
      </main>
    </div>
  );
}
