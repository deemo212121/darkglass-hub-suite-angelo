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

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Menu, Package, AlertTriangle, CheckCircle, Truck, ClipboardList, DollarSign, Loader2, Users, Download, RotateCcw, TrendingUp, BarChart2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getPartsInventoryRows, type PartInventoryRow } from "@/lib/supabase/partsInventory";
import { getTruckStock, type TruckStockRow } from "@/lib/supabase/truckStock";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getAllAgentNotes, type CsrAgentNote } from "@/lib/supabase/csrAgentNotes";
import { normalizeRole, ROLE_LABELS } from "@/lib/roleLabels";

const COLORS = ["#3b82f6", "#34d399", "#a78bfa", "#fb923c", "#f472b6", "#facc15", "#22d3ee", "#60a5fa"];
const PARTS_ROLES = new Set(["PARTS", "PARTS_MANAGER"]);
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

const DASHBOARD_SECTIONS = [
  { id: "section-distributor-breakdown", label: "Distributor Breakdown", icon: Truck },
  { id: "section-most-ordered-parts", label: "Most Ordered Parts", icon: Package },
  { id: "section-part-lines", label: "Part Lines", icon: ClipboardList },
];

const QUICK_NAV = [
  { slug: "part-order", label: "Part Order", icon: <ClipboardList className="h-4 w-4" /> },
  { slug: "part-inventory", label: "Part Inventory", icon: <Package className="h-4 w-4" /> },
  { slug: "part-collection", label: "Part Collection", icon: <CheckCircle className="h-4 w-4" /> },
  { slug: "part-pickup", label: "Part Pickup", icon: <Truck className="h-4 w-4" /> },
  { slug: "part-receive", label: "Part Receive", icon: <Package className="h-4 w-4" /> },
  { slug: "part-return", label: "Part Return", icon: <RotateCcw className="h-4 w-4" /> },
  { slug: "part-return-status", label: "Return Status", icon: <TrendingUp className="h-4 w-4" /> },
  { slug: "po-status", label: "PO Status", icon: <BarChart2 className="h-4 w-4" /> },
  { slug: "truck-stock", label: "Truck Stock", icon: <Truck className="h-4 w-4" /> },
];

/**
 * Hover-driven left rail, same pattern as TicketSidebar.tsx on the ticket
 * detail page — collapsed to a slim "Sections" tab by default, slides out
 * on hover so the long dashboard (KPIs, multiple charts, three tables) has
 * a way to jump straight to a section without scrolling past everything
 * above it.
 */
function PartsDashboardSidebar() {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 220);
  };

  const jumpTo = (anchorId: string) => {
    document.getElementById(anchorId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div
      className="hidden md:block fixed left-4 top-28 z-20"
      onMouseEnter={() => { cancelClose(); setOpen(true); }}
      onMouseLeave={scheduleClose}
    >
      {/* Visible hamburger tab — hovers reveal the panel; this tab stays
          as a permanent anchor when collapsed. */}
      <div
        className={`flex items-center justify-center rounded-md border border-blue-400/40 bg-blue-500/20 text-blue-200 p-2 shadow-md shadow-blue-900/30 select-none transition-opacity ${
          open ? "opacity-0 pointer-events-none" : "opacity-100"
        }`}
        aria-hidden="true"
      >
        <Menu className="h-4 w-4" />
      </div>

      {/* Expanded panel — slides over from the left when hovered. */}
      <aside
        className={`absolute left-0 top-0 w-64 pr-3 transition-transform duration-200 ease-out ${
          open ? "translate-x-0" : "-translate-x-[110%]"
        }`}
      >
        <div className="rounded-xl border border-white/10 bg-slate-900/85 backdrop-blur-md p-2.5 shadow-2xl">
          <div className="px-2 py-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              Jump To
            </span>
          </div>
          <div className="space-y-1">
            {DASHBOARD_SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => jumpTo(s.id)}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-white/8 hover:text-white transition-colors border border-transparent whitespace-nowrap"
              >
                <s.icon className="h-4 w-4 shrink-0" />
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

export function PartsDashboard({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [rows, setRows] = useState<PartInventoryRow[]>([]);
  const [truckStock, setTruckStock] = useState<TruckStockRow[]>([]);
  const [staff, setStaff] = useState<ProfileRow[]>([]);
  const [notes, setNotes] = useState<CsrAgentNote[]>([]);

  const [showDistPct, setShowDistPct] = useState(true);

  // ── Generate Report (CSV export) ──
  // Period applies to part lines (createdAt-scoped) — truck stock and staff
  // are current-snapshot data with no meaningful "period" of their own, so
  // those sections always reflect right now regardless of the date range.
  const [showGenerateReport, setShowGenerateReport] = useState(false);
  const [reportFrom, setReportFrom] = useState("");
  const [reportTo, setReportTo] = useState("");
  const [generatingReport, setGeneratingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  // Embedded live table filters
  const [locationFilter, setLocationFilter] = useState("");
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

  const kpi = useMemo(() => {
    const totalSpend = rows.reduce((s, r) => s + r.partPrice * r.quantity, 0);
    const pendingPO = rows.filter((r) => PENDING_STATUSES.has(r.status)).length;
    const readyForPickup = rows.filter((r) => READY_STATUSES.has(r.status)).length;
    const completed = rows.filter((r) => DONE_STATUSES.has(r.status)).length;
    const uniqueTickets = new Set(rows.map((r) => r.ticketNo).filter(Boolean)).size;
    const truckStockTotal = truckStock.reduce((s, t) => s + t.quantity, 0);
    return { totalLines: rows.length, totalSpend, pendingPO, readyForPickup, completed, uniqueTickets, truckStockTotal, staffCount: staff.length };
  }, [rows, truckStock, staff]);

  const statusBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const key = r.status || "Unspecified";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [rows]);

  const distBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const key = r.partDist || "Unspecified";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [rows]);

  const locationBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const key = r.location || "Unspecified";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [rows]);

  const truckStockByBranch = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of truckStock) {
      const key = t.branch || "Unspecified";
      map.set(key, (map.get(key) ?? 0) + t.quantity);
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 12);
  }, [truckStock]);

  // Daily trend — the live date range in this data set spans a few weeks,
  // not enough for a meaningful monthly view, so this tracks lines logged
  // per day over the trailing window instead of inventing a monthly bucket.
  const dailyTrend = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const day = r.createdAt.slice(0, 10);
      if (!day) continue;
      map.set(day, (map.get(day) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-14)
      .map(([date, count]) => ({ date: new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" }), count }));
  }, [rows]);

  const agingBuckets = useMemo(() => {
    const buckets = { "0-3 Days": 0, "4-7 Days": 0, "8-14 Days": 0, "15+ Days": 0 };
    for (const r of rows) {
      if (DONE_STATUSES.has(r.status)) continue;
      if (r.agingDays <= 3) buckets["0-3 Days"]++;
      else if (r.agingDays <= 7) buckets["4-7 Days"]++;
      else if (r.agingDays <= 14) buckets["8-14 Days"]++;
      else buckets["15+ Days"]++;
    }
    return Object.entries(buckets).map(([label, count]) => ({ label, count }));
  }, [rows]);

  const topParts = useMemo(() => {
    const map = new Map<string, { partNo: string; desc: string; count: number; spend: number }>();
    for (const r of rows) {
      if (!r.partNo) continue;
      const key = r.partNo;
      const existing = map.get(key) ?? { partNo: r.partNo, desc: r.partDesc, count: 0, spend: 0 };
      existing.count += 1;
      existing.spend += r.partPrice * r.quantity;
      if (!existing.desc && r.partDesc) existing.desc = r.partDesc;
      map.set(key, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [rows]);

  const distTable = useMemo(() => {
    const totalLines = rows.length || 1;
    const map = new Map<string, { name: string; lines: number; spend: number }>();
    for (const r of rows) {
      const key = r.partDist || "Unspecified";
      const existing = map.get(key) ?? { name: key, lines: 0, spend: 0 };
      existing.lines += 1;
      existing.spend += r.partPrice * r.quantity;
      map.set(key, existing);
    }
    return Array.from(map.values())
      .map((d) => ({ ...d, share: Math.round((d.lines / totalLines) * 1000) / 10 }))
      .sort((a, b) => b.lines - a.lines);
  }, [rows]);

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
        warnings: warningCountByProfile.get(p.id) ?? 0,
        mistakes: mistakeCountByProfile.get(p.id) ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [staff, warningCountByProfile, mistakeCountByProfile]);

  // Real in-stock lookup — matches the embedded table's part numbers
  // against truck_stock instead of showing an invented reserved/available
  // quantity.
  const stockByPartNo = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of truckStock) {
      const key = t.partNo.trim().toUpperCase();
      if (!key) continue;
      map.set(key, (map.get(key) ?? 0) + t.quantity);
    }
    return map;
  }, [truckStock]);

  const locationOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.location).filter(Boolean))).sort(), [rows]);
  const distOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.partDist).filter(Boolean))).sort(), [rows]);
  const statusOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.status).filter(Boolean))).sort(), [rows]);
  const techOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.technician).filter(Boolean))).sort(), [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (locationFilter && r.location !== locationFilter) return false;
      if (distFilter && r.partDist !== distFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (techFilter && r.technician !== techFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!r.ticketNo.toLowerCase().includes(q) && !r.partNo.toLowerCase().includes(q) && !r.partDesc.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [rows, locationFilter, distFilter, statusFilter, techFilter, search]);

  // Jump back to page 1 whenever the filtered set changes underneath the
  // current page — otherwise narrowing a filter can strand the view on a
  // now-empty page.
  useEffect(() => {
    setPartLinesPage(1);
  }, [locationFilter, distFilter, statusFilter, techFilter, search]);

  const partLinesTotalPages = Math.max(1, Math.ceil(filteredRows.length / PART_LINES_PAGE_SIZE));
  const partLinesPageSafe = Math.min(partLinesPage, partLinesTotalPages);
  const pagedRows = useMemo(
    () => filteredRows.slice((partLinesPageSafe - 1) * PART_LINES_PAGE_SIZE, partLinesPageSafe * PART_LINES_PAGE_SIZE),
    [filteredRows, partLinesPageSafe],
  );

  const csvEscape = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const generateReport = () => {
    try {
      setGeneratingReport(true);
      setReportError(null);

      const inPeriod = (iso: string) => {
        if (reportFrom && iso < reportFrom) return false;
        if (reportTo && iso > `${reportTo}T23:59:59`) return false;
        return true;
      };
      const periodRows = rows.filter((r) => inPeriod(r.createdAt));

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

      const rows_: (string | number)[][] = [
        ["Parts Dashboard Report"],
        [`Period: ${reportFrom || "All time"} to ${reportTo || "All time"}`],
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
        ["Truck Stock by Branch (current snapshot)"],
        ["Branch", "On-Hand Units"],
        ...truckStockByBranch.map((t) => [t.name, t.value]),
        [],
        ["Parts Staff (current)"],
        ["Name", "Role", "Branch", "Warnings", "Mistakes"],
        ...staffRows.map((s) => [s.name, s.role, s.branch, s.warnings, s.mistakes]),
      ];

      const csv = rows_.map((row) => row.map(csvEscape).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `parts-dashboard-report_${reportFrom || "all"}_to_${reportTo || "all"}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "Failed to generate report.");
    } finally {
      setGeneratingReport(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <PartsDashboardSidebar />
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

        <div className="flex flex-wrap gap-2 mb-6 mt-4">
          {QUICK_NAV.map((item) => (
            <Link key={item.slug} to="/m/$module/$submodule" params={{ module: "parts", submodule: item.slug }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-sm font-medium transition-colors">
              {item.icon}{item.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setShowGenerateReport((v) => !v)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${showGenerateReport ? "border-primary/40 bg-primary/15 text-primary" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
          >
            <span>📄</span>Generate Report
          </button>
        </div>

        {showGenerateReport && (
          <div className="panel p-4 mb-6">
            <p className="text-sm font-semibold mb-2 flex items-center gap-1.5">
              <Download className="h-4 w-4" /> Generate Report
            </p>
            <p className="text-xs text-muted-foreground mb-4">
              Pick a period and download a CSV of Part Lines for that window — Summary, By Distributor, By Status, By Location, and Most Ordered Parts. Truck Stock and Parts Staff are always the current snapshot, since those aren't period-based data.
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
                {generatingReport ? "Generating…" : "Download CSV"}
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
            <p className="text-sm font-semibold mb-4">Part Lines Logged — Last 14 Days</p>
            {dailyTrend.length === 0 ? (
              <p className="text-xs text-muted-foreground py-16 text-center">No part lines logged yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={dailyTrend} margin={{ left: -10 }}>
                  <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                  <Tooltip contentStyle={HIGH_CONTRAST_TOOLTIP_STYLE} />
                  <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Lines" />
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
                <ResponsiveContainer width="50%" height={200}>
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

        {/* Location + status */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Lines by Location</p>
            <ResponsiveContainer width="100%" height={220}>
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
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={truckStockByBranch} margin={{ left: -10 }}>
                <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 9 }} angle={-25} textAnchor="end" height={52} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={HIGH_CONTRAST_TOOLTIP_STYLE} />
                <Bar dataKey="value" fill="#34d399" radius={[4, 4, 0, 0]} name="On-Hand" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Status + aging + staff */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Lines by Status</p>
            <ResponsiveContainer width="100%" height={Math.max(180, statusBreakdown.length * 24)}>
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

          <div className="panel p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex items-center gap-2">
              <Users className="h-4 w-4 text-blue-400" />Parts Staff
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-white/5 border-b border-white/10">
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Name</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Warn</th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Mistk</th>
                </tr>
              </thead>
              <tbody>
                {staffRows.length === 0 ? (
                  <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">No one currently holds a Parts role.</td></tr>
                ) : staffRows.map((s) => (
                  <tr key={s.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2 font-medium">
                      <a href={`/csr-agent/${s.id}`} target="_blank" rel="noopener noreferrer" className="hover:text-blue-300 hover:underline transition" title={`View ${s.name}'s statistics`}>
                        {s.name}
                      </a>
                      <p className="text-[10px] text-muted-foreground">{s.role} · {s.branch}</p>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {s.warnings > 0 ? <span className="bg-yellow-500/20 text-yellow-300 px-1.5 py-0.5 rounded font-semibold">{s.warnings}</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {s.mistakes > 0 ? <span className="bg-orange-500/20 text-orange-300 px-1.5 py-0.5 rounded font-semibold">{s.mistakes}</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Distributor table */}
        <div id="section-distributor-breakdown" className="panel p-0 overflow-hidden mb-4 scroll-mt-24">
          <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex items-center gap-2">
            <Truck className="h-4 w-4 text-blue-400" />Distributor Breakdown
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

        {/* Top parts table */}
        <div id="section-most-ordered-parts" className="panel p-0 overflow-hidden mb-4 scroll-mt-24">
          <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex items-center gap-2">
            <Package className="h-4 w-4 text-purple-400" />Most Ordered Parts
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

        {/* Live Part Inventory table — filters + real rows, no fake reserve/ship workflow */}
        <div id="section-part-lines" className="panel p-0 overflow-hidden scroll-mt-24">
          <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-purple-400" />
            <span className="font-semibold text-sm">Part Lines</span>
            <Link to="/m/$module/$submodule" params={{ module: "parts", submodule: "part-inventory" }}
              className="ml-auto text-xs text-blue-400 hover:text-blue-300 transition-colors">Open full page →</Link>
          </div>

          <div className="p-4 border-b border-white/10 bg-white/[0.01]">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Location</label>
                <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="glass-input mt-1 w-full">
                  <option value="">All Locations</option>
                  {locationOptions.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
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
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No records match current filters.</td></tr>
                ) : pagedRows.map((r) => {
                  const inStock = stockByPartNo.get(r.partNo.trim().toUpperCase());
                  return (
                    <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-3 py-2.5 align-top">
                        <Link to="/ticket/$ticketNo" params={{ ticketNo: r.ticketNo }} className="font-mono text-xs text-blue-400 hover:underline">{r.ticketNo || "—"}</Link>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{r.location || "—"}{r.technician ? ` · ${r.technician}` : ""}</p>
                      </td>
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
      </main>
    </div>
  );
}
