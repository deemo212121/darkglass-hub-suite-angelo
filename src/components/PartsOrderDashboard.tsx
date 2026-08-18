/**
 * Parts Order Dashboard — PO/procurement reporting for the Parts Order team,
 * split out of Parts Dashboard so each stays focused: Parts Dashboard covers
 * part records (status, aging, warranty, truck stock), this page covers
 * everything PO/financial (distributor spend, daily PO balances,
 * warranty/vendor $ breakdown, the part-line ledger, and a per-branch
 * overview modeled on the team's own branch PO ledger spreadsheet — built
 * from live data here, not imported from that file).
 *
 * Same data source as Parts Dashboard (`parts` via getPartsInventoryRows,
 * `truck_stock` via getTruckStock) — this is a reporting lens over the same
 * records, not a separate data set. Parts Order Staff shows real PARTS_ORDER
 * profiles (primary or secondary role), not a fabricated roster.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, LayoutDashboard, Package, AlertTriangle, Truck, ClipboardList, DollarSign, Loader2, Users, Download, Calendar, Building2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import * as XLSX from "xlsx";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getPartsInventoryRows, type PartInventoryRow } from "@/lib/supabase/partsInventory";
import { getTruckStock, type TruckStockRow } from "@/lib/supabase/truckStock";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { normalizeRole, ROLE_LABELS } from "@/lib/roleLabels";
import { ReportAttendanceMonitoring } from "@/components/ReportAttendanceMonitoring";
import { TicketColumnFilter } from "@/components/TicketColumnFilter";

// CheckboxDropdown — a select-styled button that opens a portal-positioned
// checkbox list below it. The whole button is the trigger (unlike a plain
// box with a small icon buried inside it) — same interaction/visual pattern
// ReportAttendanceMonitoring.tsx already established for its Employee filter.
// Empty `selected` = no filter (show all), same convention as TicketColumnFilter.
// Local to this file since every use of it lives on this page.
function CheckboxDropdown({ options, selected, onChange, allLabel, className }: {
  options: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Plural noun shown as "All {allLabel}" — e.g. "Branches", "Distributors". */
  allLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const openMenu = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (btnRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const toggle = (opt: string) => {
    const next = new Set(selected);
    if (next.has(opt)) next.delete(opt);
    else next.add(opt);
    onChange(next);
  };

  return (
    <div className={className}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="glass-input w-full text-left flex items-center justify-between gap-2"
      >
        <span className="truncate">
          {selected.size === 0 ? `All ${allLabel}` : Array.from(selected).join(", ")}
        </span>
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 max-h-72 overflow-y-auto rounded-lg border border-white/15 bg-slate-900 p-2 shadow-2xl"
          style={{ top: pos.top, left: pos.left, minWidth: pos.width }}
        >
          <label className="flex items-center gap-2 px-2 py-1.5 mb-1 rounded border-b border-white/10 hover:bg-white/5 cursor-pointer text-sm font-semibold text-slate-100 whitespace-nowrap">
            <input type="checkbox" checked={selected.size === 0} onChange={() => onChange(new Set())} className="accent-blue-500" />
            All {allLabel}
          </label>
          {options.length === 0 && <p className="text-xs text-muted-foreground px-2 py-1.5">No options.</p>}
          {options.map((opt) => (
            <label key={opt} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 cursor-pointer text-sm text-slate-200 whitespace-nowrap">
              <input type="checkbox" checked={selected.has(opt)} onChange={() => toggle(opt)} className="accent-blue-500" />
              {opt}
            </label>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

// Module-level (not defined inside the component) so ReportAttendanceMonitoring's
// data-fetching effect sees a stable reference across renders — same pattern
// PartsDashboard.tsx's isPartsProfileFilter established. Checks BOTH the
// primary role and extra_roles (secondary) — PARTS_ORDER is currently only
// ever held as a secondary role (e.g. Cheska Timkang / Alyssa Diones, both
// primary PARTS_MANAGER), so primary-only would miss everyone.
const isPartsOrderProfileFilter = (p: ProfileRow) =>
  normalizeRole(p.role) === "PARTS_ORDER" || (p.extra_roles ?? []).some((r) => normalizeRole(r) === "PARTS_ORDER");

const PENDING_STATUSES = new Set(["Need PO", "PO Made"]);
const READY_STATUSES = new Set(["Part Ready", "Tech Pickup"]);
const DONE_STATUSES = new Set(["Used", "Claimed"]);

// Fixed light tooltip — CSS-variable-based tooltips don't reliably resolve
// against the dark theme, same reasoning as PartsDashboard.tsx.
const HIGH_CONTRAST_TOOLTIP_STYLE = {
  background: "#ffffff",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  color: "#0f172a",
  fontSize: 12,
  fontWeight: 600,
  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
} as const;

const currency = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });


// Shared by every panel's own one-click "Download XLSX" button below.
function downloadSheetXlsx(filename: string, sheetName: string, rows: (string | number)[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, filename);
}

const TABS = [
  { id: "overview" as const, label: "Overview", icon: LayoutDashboard },
  { id: "staff" as const, label: "Parts Order Staff", icon: Users },
  { id: "distributor" as const, label: "Distributor & Most Ordered Parts", icon: Truck },
  { id: "daily-po-balances" as const, label: "Daily PO Balances", icon: Calendar },
  { id: "wty-vendor" as const, label: "Wty/Vendor - $", icon: Building2 },
  { id: "part-lines" as const, label: "Part Lines", icon: ClipboardList },
];
type PartsOrderDashboardTab = (typeof TABS)[number]["id"];

export function PartsOrderDashboard({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [rows, setRows] = useState<PartInventoryRow[]>([]);
  const [truckStock, setTruckStock] = useState<TruckStockRow[]>([]);
  const [staff, setStaff] = useState<ProfileRow[]>([]);

  const [tab, setTab] = useState<PartsOrderDashboardTab>("overview");

  // Wty/Vendor - $ tab's own Distributor/Warranty Company filters — checkbox
  // dropdowns (TicketColumnFilter), so more than one of each can be picked
  // at once. Empty set = no filter (show all), same convention the component
  // already uses on Ticket List.
  const [wtyDistFilter, setWtyDistFilter] = useState<Set<string>>(new Set());
  const [wtyCompanyFilter, setWtyCompanyFilter] = useState<Set<string>>(new Set());

  // Per-Branch Overview's own checkbox filter — empty set shows the summary
  // rollup (one row per branch); checking one or more branches switches the
  // panel to a full line-by-line breakdown for just those branches, mirroring
  // the team's own branch PO ledger sheets (one tab per branch, full detail).
  const [branchDetailFilter, setBranchDetailFilter] = useState<Set<string>>(new Set());
  // Local Date From/To for the detail breakdown — layered on top of the
  // dashboard-wide Date Range above, same "own filter on top of global scope"
  // pattern as Wty/Vendor's Distributor/Warranty Company filters.
  const [branchDetailFrom, setBranchDetailFrom] = useState("");
  const [branchDetailTo, setBranchDetailTo] = useState("");

  // Dashboard-wide scope: Date Range + Branch.
  const [scopeFrom, setScopeFrom] = useState("");
  const [scopeTo, setScopeTo] = useState("");
  const [branchFilter, setBranchFilter] = useState<Set<string>>(new Set());

  // Generate Report (XLSX export).
  const [showGenerateReport, setShowGenerateReport] = useState(false);
  const [reportFrom, setReportFrom] = useState("");
  const [reportTo, setReportTo] = useState("");
  const [generatingReport, setGeneratingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  // Part Lines tab's own filters — checkbox dropdowns, same as Wty/Vendor above.
  const [distFilter, setDistFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [techFilter, setTechFilter] = useState<Set<string>>(new Set());
  // Attached directly to the Branch/Location and Aging column headers below
  // (same inline-icon placement as Ticket List), rather than a separate
  // filter-bar control.
  const [locationFilter, setLocationFilter] = useState<Set<string>>(new Set());
  const [agingFilter, setAgingFilter] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const PART_LINES_PAGE_SIZE = 20;
  const [partLinesPage, setPartLinesPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [partsRows, truck, users] = await Promise.all([
          getPartsInventoryRows(),
          getTruckStock().catch((err) => {
            console.error("Failed to load truck stock:", err);
            return [] as TruckStockRow[];
          }),
          getCompanyUsers(),
        ]);
        if (cancelled) return;
        setRows(partsRows);
        setTruckStock(truck);
        setStaff(users.filter((p) => p.is_active && isPartsOrderProfileFilter(p)));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load Parts Order Dashboard.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const branchOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.location) set.add(r.location);
    for (const t of truckStock) if (t.branch) set.add(t.branch);
    for (const p of staff) if (p.assigned_branch) set.add(p.assigned_branch);
    return Array.from(set).sort();
  }, [rows, truckStock, staff]);

  const scopedRows = useMemo(() => {
    return rows.filter((r) => {
      if (scopeFrom && r.createdAt < scopeFrom) return false;
      if (scopeTo && r.createdAt > `${scopeTo}T23:59:59`) return false;
      if (branchFilter.size > 0 && !branchFilter.has(r.location)) return false;
      return true;
    });
  }, [rows, scopeFrom, scopeTo, branchFilter]);

  const scopedTruckStock = useMemo(() => {
    if (branchFilter.size === 0) return truckStock;
    return truckStock.filter((t) => branchFilter.has(t.branch));
  }, [truckStock, branchFilter]);

  const scopedStaff = useMemo(() => {
    if (branchFilter.size === 0) return staff;
    return staff.filter((p) => branchFilter.has(p.assigned_branch || ""));
  }, [staff, branchFilter]);

  const kpi = useMemo(() => {
    const totalSpend = scopedRows.reduce((s, r) => s + r.partPrice * r.quantity, 0);
    const pendingPO = scopedRows.filter((r) => PENDING_STATUSES.has(r.status)).length;
    const distinctPOs = new Set(scopedRows.map((r) => r.poNo).filter(Boolean)).size;
    const distinctDistributors = new Set(scopedRows.map((r) => r.partDist).filter(Boolean)).size;
    const branchesCount = new Set(scopedRows.map((r) => r.location).filter(Boolean)).size;
    return { totalLines: scopedRows.length, totalSpend, pendingPO, distinctPOs, distinctDistributors, branchesCount };
  }, [scopedRows]);

  // Per-branch overview — a rollup (not a line-by-line replica) of the
  // team's own branch PO ledger spreadsheet, built entirely from live data.
  const branchSummary = useMemo(() => {
    const map = new Map<string, { branch: string; lines: number; spend: number; poNos: Set<string>; distributors: Set<string>; pending: number }>();
    for (const r of scopedRows) {
      const key = r.location || "Unspecified";
      const existing = map.get(key) ?? { branch: key, lines: 0, spend: 0, poNos: new Set<string>(), distributors: new Set<string>(), pending: 0 };
      existing.lines += 1;
      existing.spend += r.partPrice * r.quantity;
      if (r.poNo) existing.poNos.add(r.poNo);
      if (r.partDist) existing.distributors.add(r.partDist);
      if (PENDING_STATUSES.has(r.status)) existing.pending += 1;
      map.set(key, existing);
    }
    return Array.from(map.values())
      .map((b) => ({ branch: b.branch, lines: b.lines, spend: b.spend, poCount: b.poNos.size, distributorCount: b.distributors.size, pending: b.pending }))
      .sort((a, b) => b.spend - a.spend);
  }, [scopedRows]);

  const branchSpendChartData = useMemo(
    () => branchSummary.slice(0, 10).map((b) => ({ name: b.branch, value: Math.round(b.spend * 100) / 100 })),
    [branchSummary]
  );

  // Full per-line breakdown for the branches checked in the Per-Branch
  // Overview panel's filter — same fields as the team's own branch PO ledger
  // (PO Date/Vendor/Location/PO #/Part#/Description/Qty/Unit Price/Total
  // Amount/Warranty Company), minus Note and Core Amount, which aren't
  // tracked anywhere in this schema.
  const branchDetailRows = useMemo(() => {
    if (branchDetailFilter.size === 0) return [];
    return scopedRows
      .filter((r) => {
        if (!branchDetailFilter.has(r.location || "Unspecified")) return false;
        if (branchDetailFrom && r.createdAt < branchDetailFrom) return false;
        if (branchDetailTo && r.createdAt > `${branchDetailTo}T23:59:59`) return false;
        return true;
      })
      .sort((a, b) => (a.location || "").localeCompare(b.location || "") || a.createdAt.localeCompare(b.createdAt));
  }, [scopedRows, branchDetailFilter, branchDetailFrom, branchDetailTo]);

  // Broken down by branch as well as part number — the same part can be
  // ordered from several branches.
  const topParts = useMemo(() => {
    const map = new Map<string, { branch: string; partNo: string; desc: string; count: number; spend: number }>();
    for (const r of scopedRows) {
      if (!r.partNo) continue;
      const branch = r.location || "Unspecified";
      const key = `${branch}::${r.partNo}`;
      const existing = map.get(key) ?? { branch, partNo: r.partNo, desc: r.partDesc, count: 0, spend: 0 };
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

  const distSpendChartData = useMemo(
    () => [...distTable].sort((a, b) => b.spend - a.spend).slice(0, 10).map((d) => ({ name: d.name, value: Math.round(d.spend * 100) / 100 })),
    [distTable]
  );
  const topPartsChartData = useMemo(
    () => topParts.map((p) => ({ name: p.partNo, value: p.count })),
    [topParts]
  );

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

  const dailyByBranchChartData = useMemo(
    () => dailyByBranch.slice(0, 10).map((r) => ({ name: r.branch, value: Math.round(r.total * 100) / 100 })),
    [dailyByBranch]
  );

  const wtyCompanyOptions = useMemo(() => Array.from(new Set(scopedRows.map((r) => r.claimCompany).filter(Boolean))).sort(), [scopedRows]);

  const wtyVendorScopedRows = useMemo(() => {
    return scopedRows.filter((r) => {
      if (wtyDistFilter.size > 0 && !wtyDistFilter.has(r.partDist)) return false;
      if (wtyCompanyFilter.size > 0 && !wtyCompanyFilter.has(r.claimCompany)) return false;
      return true;
    });
  }, [scopedRows, wtyDistFilter, wtyCompanyFilter]);

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
  const locationOptions = useMemo(() => Array.from(new Set(scopedRows.map((r) => r.location).filter(Boolean))).sort(), [scopedRows]);
  const agingOptions = useMemo(() => Array.from(new Set(scopedRows.map((r) => String(r.agingDays)))).sort((a, b) => Number(a) - Number(b)), [scopedRows]);

  const filteredRows = useMemo(() => {
    return scopedRows.filter((r) => {
      if (distFilter.size > 0 && !distFilter.has(r.partDist)) return false;
      if (statusFilter.size > 0 && !statusFilter.has(r.status)) return false;
      if (techFilter.size > 0 && !techFilter.has(r.technician)) return false;
      if (locationFilter.size > 0 && !locationFilter.has(r.location)) return false;
      if (agingFilter.size > 0 && !agingFilter.has(String(r.agingDays))) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!r.ticketNo.toLowerCase().includes(q) && !r.partNo.toLowerCase().includes(q) && !r.partDesc.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [scopedRows, distFilter, statusFilter, techFilter, locationFilter, agingFilter, search]);

  useEffect(() => {
    setPartLinesPage(1);
  }, [scopeFrom, scopeTo, branchFilter, distFilter, statusFilter, techFilter, locationFilter, agingFilter, search]);

  const partLinesTotalPages = Math.max(1, Math.ceil(filteredRows.length / PART_LINES_PAGE_SIZE));
  const partLinesPageSafe = Math.min(partLinesPage, partLinesTotalPages);
  const pagedRows = useMemo(
    () => filteredRows.slice((partLinesPageSafe - 1) * PART_LINES_PAGE_SIZE, partLinesPageSafe * PART_LINES_PAGE_SIZE),
    [filteredRows, partLinesPageSafe],
  );

  const staffRows = useMemo(() => {
    return scopedStaff
      .map((p) => ({
        name: p.display_name || p.username || p.email,
        role: ROLE_LABELS[normalizeRole(p.role)] ?? p.role,
        branch: p.assigned_branch || "—",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [scopedStaff]);

  const generateReport = () => {
    try {
      setGeneratingReport(true);
      setReportError(null);

      const inPeriod = (iso: string) => {
        if (reportFrom && iso < reportFrom) return false;
        if (reportTo && iso > `${reportTo}T23:59:59`) return false;
        return true;
      };
      const periodRows = rows.filter((r) => inPeriod(r.createdAt) && (branchFilter.size === 0 || branchFilter.has(r.location)));

      const totalSpend = periodRows.reduce((s, r) => s + r.partPrice * r.quantity, 0);
      const pendingPO = periodRows.filter((r) => PENDING_STATUSES.has(r.status)).length;
      const distinctPOs = new Set(periodRows.map((r) => r.poNo).filter(Boolean)).size;

      const distMap = new Map<string, { lines: number; spend: number }>();
      const partsMap = new Map<string, { desc: string; count: number; spend: number }>();
      for (const r of periodRows) {
        const dist = r.partDist || "Unspecified";
        const d = distMap.get(dist) ?? { lines: 0, spend: 0 };
        d.lines += 1;
        d.spend += r.partPrice * r.quantity;
        distMap.set(dist, d);

        if (r.partNo) {
          const p = partsMap.get(r.partNo) ?? { desc: r.partDesc, count: 0, spend: 0 };
          p.count += 1;
          p.spend += r.partPrice * r.quantity;
          if (!p.desc && r.partDesc) p.desc = r.partDesc;
          partsMap.set(r.partNo, p);
        }
      }

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

      // Per-branch overview, same shape as the on-screen table but over the
      // report's own period.
      const branchMap = new Map<string, { lines: number; spend: number; poNos: Set<string>; distributors: Set<string>; pending: number }>();
      for (const r of periodRows) {
        const key = r.location || "Unspecified";
        const existing = branchMap.get(key) ?? { lines: 0, spend: 0, poNos: new Set<string>(), distributors: new Set<string>(), pending: 0 };
        existing.lines += 1;
        existing.spend += r.partPrice * r.quantity;
        if (r.poNo) existing.poNos.add(r.poNo);
        if (r.partDist) existing.distributors.add(r.partDist);
        if (PENDING_STATUSES.has(r.status)) existing.pending += 1;
        branchMap.set(key, existing);
      }
      const branchOverviewRows = Array.from(branchMap.entries())
        .map(([branch, b]) => ({ branch, lines: b.lines, spend: b.spend, poCount: b.poNos.size, distributorCount: b.distributors.size, pending: b.pending }))
        .sort((a, b) => b.spend - a.spend);

      const rows_: (string | number)[][] = [
        ["Parts Order Dashboard Report"],
        [`Period: ${reportFrom || "All time"} to ${reportTo || "All time"}`],
        [`Branch: ${branchFilter.size === 0 ? "All Branches" : Array.from(branchFilter).join(", ")}`],
        [`Generated: ${new Date().toLocaleString()}`],
        [],
        ["Summary"],
        ["Metric", "Value"],
        ["Total PO Lines", periodRows.length],
        ["Total Spend", totalSpend.toFixed(2)],
        ["Distinct POs", distinctPOs],
        ["Pending PO", pendingPO],
        [],
        ["Per-Branch Overview"],
        ["Branch", "PO Lines", "Total Spend", "Distinct POs", "Distinct Distributors", "Pending PO"],
        ...branchOverviewRows.map((b) => [b.branch, b.lines, b.spend.toFixed(2), b.poCount, b.distributorCount, b.pending]),
        [],
        ["By Distributor"],
        ["Distributor", "Lines", "Spend"],
        ...Array.from(distMap.entries()).sort((a, b) => b[1].lines - a[1].lines).map(([name, d]) => [name, d.lines, d.spend.toFixed(2)]),
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
        ["Parts Order Staff (current)"],
        ["Name", "Role", "Branch"],
        ...staffRows.map((s) => [s.name, s.role, s.branch]),
      ];

      const worksheet = XLSX.utils.aoa_to_sheet(rows_);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Parts Order Report");
      XLSX.writeFile(workbook, `parts-order-dashboard-report_${reportFrom || "all"}_to_${reportTo || "all"}.xlsx`);
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
            <p className="text-xs text-muted-foreground mt-0.5">Live from Part Inventory &amp; Truck Stock · {scopedStaff.length} Parts Order staff</p>
          </div>
        </div>

        {/* Dashboard-wide scope */}
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
              <CheckboxDropdown options={branchOptions} selected={branchFilter} onChange={setBranchFilter} allLabel="Branches" className="mt-1 min-w-36" />
            </div>
            {(scopeFrom || scopeTo || branchFilter.size > 0) && (
              <button
                type="button"
                onClick={() => { setScopeFrom(""); setScopeTo(""); setBranchFilter(new Set()); }}
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
          <p className="mt-2 text-[10px] text-muted-foreground">Applies to every KPI, chart, and table below.</p>
        </div>

        {showGenerateReport && (
          <div className="panel p-4 mb-6">
            <p className="text-sm font-semibold mb-2 flex items-center gap-1.5">
              <Download className="h-4 w-4" /> Generate Report
            </p>
            <p className="text-xs text-muted-foreground mb-4">
              Pick a period and download an XLSX of Parts Order data for that window — Summary, Per-Branch Overview, By Distributor, Most Ordered Parts, Daily PO Balances, Wty/Vendor - $, and Parts Order Staff.
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
            <Loader2 className="h-4 w-4 animate-spin" /> Loading Parts Order Dashboard…
          </div>
        ) : !showGenerateReport && (
        <>
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
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
          {[
            { label: "PO Lines", value: kpi.totalLines.toLocaleString(), color: "text-blue-300", icon: <Package className="h-4 w-4" /> },
            { label: "Total Spend", value: currency(kpi.totalSpend), color: "text-green-300", icon: <DollarSign className="h-4 w-4" /> },
            { label: "Distinct POs", value: kpi.distinctPOs.toLocaleString(), color: "text-purple-300", icon: <ClipboardList className="h-4 w-4" /> },
            { label: "Distributors", value: kpi.distinctDistributors.toLocaleString(), color: "text-cyan-300", icon: <Truck className="h-4 w-4" /> },
            { label: "Pending PO", value: kpi.pendingPO, color: "text-orange-300", icon: <AlertTriangle className="h-4 w-4" /> },
            { label: "Branches", value: kpi.branchesCount, color: "text-blue-300", icon: <Building2 className="h-4 w-4" /> },
          ].map((k) => (
            <div key={k.label} className="panel p-3 text-center">
              <div className="flex justify-center mb-1 text-muted-foreground">{k.icon}</div>
              <p className={`text-xl font-bold ${k.color}`}>{k.value || "—"}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{k.label}</p>
            </div>
          ))}
        </div>

        <div className="panel p-4 mb-4">
          <p className="text-sm font-semibold mb-4">Top Branches by Spend</p>
          {branchSpendChartData.length === 0 ? (
            <p className="text-xs text-muted-foreground py-16 text-center">No data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(180, branchSpendChartData.length * 26)} debounce={200}>
              <BarChart data={branchSpendChartData} layout="vertical" margin={{ left: 20 }}>
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
            <Building2 className="h-4 w-4 text-blue-400" />Per-Branch Overview
            <CheckboxDropdown
              options={branchSummary.map((b) => b.branch)}
              selected={branchDetailFilter}
              onChange={setBranchDetailFilter}
              allLabel="Branches"
              className="w-40"
            />
            {branchDetailFilter.size > 0 && (
              <>
                <span className="text-[10px] text-muted-foreground">{branchDetailFilter.size} branch{branchDetailFilter.size > 1 ? "es" : ""} selected — showing full breakdown</span>
                <input type="date" aria-label="Branch detail date from" title="Date from" value={branchDetailFrom} onChange={(e) => setBranchDetailFrom(e.target.value)} className="glass-input text-xs py-1" />
                <span className="text-[10px] text-muted-foreground">to</span>
                <input type="date" aria-label="Branch detail date to" title="Date to" value={branchDetailTo} onChange={(e) => setBranchDetailTo(e.target.value)} className="glass-input text-xs py-1" />
                {(branchDetailFrom || branchDetailTo) && (
                  <button
                    type="button"
                    onClick={() => { setBranchDetailFrom(""); setBranchDetailTo(""); }}
                    className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2"
                  >
                    Clear dates
                  </button>
                )}
              </>
            )}
            <button
              type="button"
              onClick={() => branchDetailFilter.size > 0
                ? downloadSheetXlsx(
                    `parts-order-branch-detail_${new Date().toISOString().slice(0, 10)}.xlsx`,
                    "Branch Detail",
                    [
                      ["PO Date", "Vendor", "Location", "PO #", "Part#", "Description", "Qty", "Unit Price", "Total Amount", "Warranty Company"],
                      ...branchDetailRows.map((r) => [r.createdAt.slice(0, 10), r.partDist, r.location, r.poNo, r.partNo, r.partDesc, r.quantity, r.partPrice.toFixed(2), (r.partPrice * r.quantity).toFixed(2), r.claimCompany]),
                    ]
                  )
                : downloadSheetXlsx(
                    `parts-order-branch-overview_${new Date().toISOString().slice(0, 10)}.xlsx`,
                    "Per-Branch Overview",
                    [["Branch", "PO Lines", "Total Spend", "Distinct POs", "Distinct Distributors", "Pending PO"], ...branchSummary.map((b) => [b.branch, b.lines, b.spend.toFixed(2), b.poCount, b.distributorCount, b.pending])]
                  )
              }
              className="ml-auto flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />Download XLSX
            </button>
          </div>
          {branchDetailFilter.size === 0 ? (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-white/10 bg-white/5">
              {["Branch", "PO Lines", "Total Spend", "Distinct POs", "Distributors", "Pending PO"].map((h) => <th key={h} className="px-4 py-2 text-left text-xs text-muted-foreground uppercase">{h}</th>)}
            </tr></thead>
            <tbody>
              {branchSummary.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No data yet.</td></tr>
              ) : branchSummary.map((b, i) => (
                <tr key={b.branch} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                  <td className="px-4 py-2 font-medium">{b.branch}</td>
                  <td className="px-4 py-2 text-blue-300">{b.lines.toLocaleString()}</td>
                  <td className="px-4 py-2 text-green-300">{currency(b.spend)}</td>
                  <td className="px-4 py-2">{b.poCount}</td>
                  <td className="px-4 py-2">{b.distributorCount}</td>
                  <td className="px-4 py-2 text-orange-300">{b.pending}</td>
                </tr>
              ))}
            </tbody>
          </table>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-white/10 bg-white/5">
                {["PO Date", "Vendor", "Location", "PO #", "Part#", "Description", "Qty", "Unit Price", "Total Amount", "Warranty Company"].map((h) => <th key={h} className="px-4 py-2 text-left text-xs text-muted-foreground uppercase whitespace-nowrap">{h}</th>)}
              </tr></thead>
              <tbody>
                {branchDetailRows.length === 0 ? (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">No records for the selected branch(es).</td></tr>
                ) : branchDetailRows.map((r, i) => (
                  <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                    <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">{r.createdAt.slice(0, 10)}</td>
                    <td className="px-4 py-2 text-xs">{r.partDist || "—"}</td>
                    <td className="px-4 py-2 text-xs">{r.location || "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs">{r.poNo || "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs text-blue-300">{r.partNo || "—"}</td>
                    <td className="px-4 py-2 text-xs">{r.partDesc || "—"}</td>
                    <td className="px-4 py-2 text-right">{r.quantity}</td>
                    <td className="px-4 py-2 text-right text-green-300">{currency(r.partPrice)}</td>
                    <td className="px-4 py-2 text-right text-green-300">{currency(r.partPrice * r.quantity)}</td>
                    <td className="px-4 py-2 text-xs">{r.claimCompany || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </div>
        </>
        )}

        {tab === "staff" && (
        <ReportAttendanceMonitoring mod={mod} sub={sub} filterProfile={isPartsOrderProfileFilter} groupBy="employee" embedded />
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
                  [["Branch", "Part No", "Description", "Times Ordered", "Total Spend"], ...topParts.map((p) => [p.branch, p.partNo, p.desc, p.count, p.spend.toFixed(2)])]
                )}
                className="ml-auto flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />Download XLSX
              </button>
            </div>
            <table className="w-full text-sm">
              <thead><tr className="border-b border-white/10 bg-white/5">
                {["Branch", "Part No", "Description", "Times Ordered", "Total Spend"].map((h) => <th key={h} className="px-4 py-2 text-left text-xs text-muted-foreground uppercase">{h}</th>)}
              </tr></thead>
              <tbody>
                {topParts.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No data yet.</td></tr>
                ) : topParts.map((p, i) => (
                  <tr key={`${p.branch}::${p.partNo}::${i}`} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{p.branch}</td>
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
            Columns follow the dashboard-wide Date Range above when set, otherwise the trailing 14 days with activity.
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
                <CheckboxDropdown options={distOptions} selected={wtyDistFilter} onChange={setWtyDistFilter} allLabel="Distributors" className="mt-1 min-w-36" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Warranty Company</label>
                <CheckboxDropdown options={wtyCompanyOptions} selected={wtyCompanyFilter} onChange={setWtyCompanyFilter} allLabel="Warranty Companies" className="mt-1 min-w-36" />
              </div>
              {(wtyDistFilter.size > 0 || wtyCompanyFilter.size > 0) && (
                <button
                  type="button"
                  onClick={() => { setWtyDistFilter(new Set()); setWtyCompanyFilter(new Set()); }}
                  className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                >
                  Clear
                </button>
              )}
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">Layered on top of the dashboard-wide Date Range + Branch scope above.</p>
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Technician</label>
                <CheckboxDropdown options={techOptions} selected={techFilter} onChange={setTechFilter} allLabel="Technicians" className="mt-1 w-full" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Search</label>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ticket, part #, description"
                  className="glass-input mt-1 w-full" />
              </div>
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">Distributor, Status, Branch/Location, and Aging now filter from their own column headers below.</p>
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
                  <th className="px-3 py-2.5 text-left text-xs text-muted-foreground uppercase">
                    Branch/Location
                    <TicketColumnFilter options={locationOptions} selected={locationFilter} onChange={setLocationFilter} label="Filter by Branch/Location" />
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs text-muted-foreground uppercase">
                    Status
                    <TicketColumnFilter options={statusOptions} selected={statusFilter} onChange={setStatusFilter} label="Filter by Status" />
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs text-muted-foreground uppercase">
                    Part / Distributor
                    <TicketColumnFilter options={distOptions} selected={distFilter} onChange={setDistFilter} label="Filter by Distributor" />
                  </th>
                  <th className="px-3 py-2.5 text-right text-xs text-muted-foreground uppercase">Qty</th>
                  <th className="px-3 py-2.5 text-right text-xs text-muted-foreground uppercase">Price</th>
                  <th className="px-3 py-2.5 text-right text-xs text-muted-foreground uppercase">In Truck Stock</th>
                  <th className="px-3 py-2.5 text-right text-xs text-muted-foreground uppercase">
                    Aging
                    <TicketColumnFilter options={agingOptions} selected={agingFilter} onChange={setAgingFilter} label="Filter by Aging (days)" />
                  </th>
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
