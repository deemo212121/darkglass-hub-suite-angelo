/**
 * Part Daily Report — rebuilt on live data, sharing PartsDashboard.tsx's
 * data source (getPartsInventoryRows(), the real `parts` table joined to
 * `tickets` for branch/location) and its established status buckets
 * (PENDING/READY/DONE). Per branch: Collections = parts that reached a
 * DONE status, RA = parts with a return-authorization number set,
 * Receives = parts with an inbound tracking number set — all scoped to the
 * selected date range.
 *
 * `parts.created_by` isn't populated in this data set (same gap
 * PartsDashboard.tsx already documents), so there's no real field to
 * attribute an individual part line to a specific staff member —
 * Collections/Pickups/RA/Receives stay branch-level, which is what the
 * charts and the Daily Branch Activity table actually emphasize anyway.
 * Issues/Lost are the one manually-entered pair, tracked per branch per
 * day in parts_daily_issues_log (see partsDailyIssuesLog.ts).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearch, useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, Loader2, LayoutDashboard, CheckCheck, Building2, ClipboardList, RotateCcw, Download, Package, Truck, Inbox, AlertTriangle, DollarSign, ShieldCheck, PackageX, Users } from "lucide-react";
import { BrandedLoader } from "@/components/BrandedLoader";
import { Bar, BarChart, CartesianGrid, Pie, PieChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import * as XLSX from "xlsx";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getPartsInventoryRows, type PartInventoryRow } from "@/lib/supabase/partsInventory";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getPartsDailyIssues, upsertPartsDailyIssue, type PartsDailyIssueEntry } from "@/lib/supabase/partsDailyIssuesLog";
import { normalizeRole, ROLE_LABELS } from "@/lib/roleLabels";
import { getPartsDoneActivity, type PartsDoneActivityRow } from "@/lib/supabase/partsDoneActivityLog";
import { getBranchProgress, type BranchProgress } from "@/lib/partsBranchProgress";
import { getPartReturns as getRaCreatedRows, type PartReturnRow as RaCreatedRow } from "@/lib/supabase/partReturnStatus";
import { getPartReturns as getReturnPendingRows, type PartReturnRow as ReturnPendingRow } from "@/lib/supabase/partReturn";
import { getPartsForDailyCollection, type PartCollectionRow } from "@/lib/supabase/partDailyCollection";
import { getPartsToReceive, type PartReceiveRow } from "@/lib/supabase/partReceive";

const PARTS_ROLES = new Set(["PARTS", "PARTS_MANAGER"]);
// Same buckets PartsDashboard.tsx already established — Back Order and
// Cancelled are deliberately their own buckets, not folded into Pending.
const PENDING_STATUSES = new Set(["Need PO", "PO Made"]);
const READY_STATUSES = new Set(["Part Ready", "Tech Pickup"]);
const DONE_STATUSES = new Set(["Used", "Claimed"]);
const TOOLTIP_STYLE = { background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 6, color: "#0f172a", fontSize: 12, fontWeight: 600, boxShadow: "0 4px 12px rgba(0,0,0,0.3)" } as const;
const LEGEND_STYLE = { fontSize: 11, color: "#94a3b8" } as const;
const STATUS_BUCKET_COLORS: Record<string, string> = {
  Pending: "#facc15",
  Ready: "#3b82f6",
  Done: "#34d399",
  "Back Order": "#fb923c",
  Cancelled: "#f87171",
};
// Full literal class strings (not built with `${color}` template
// interpolation) — Tailwind's build-time scanner only picks up classes
// that appear as complete strings in the source, so a dynamic
// `border-l-${color}-500` would silently compile to nothing.
// Tailwind's -400 shade for each is the literal hex the chart bars use
// (emerald-400 #34d399, violet-400 #a78bfa, orange-400 #fb923c, red-400
// #f87171, rose-400 #fb7185) — picked to match, not just "close enough".
const KPI_TILE_COLORS = {
  emerald: { border: "border-l-emerald-500", bg: "bg-emerald-500/5", iconBg: "bg-emerald-500/15", text: "text-emerald-400" },
  violet: { border: "border-l-violet-500", bg: "bg-violet-500/5", iconBg: "bg-violet-500/15", text: "text-violet-400" },
  orange: { border: "border-l-orange-500", bg: "bg-orange-500/5", iconBg: "bg-orange-500/15", text: "text-orange-400" },
  blue: { border: "border-l-blue-500", bg: "bg-blue-500/5", iconBg: "bg-blue-500/15", text: "text-blue-400" },
  red: { border: "border-l-red-500", bg: "bg-red-500/5", iconBg: "bg-red-500/15", text: "text-red-400" },
  rose: { border: "border-l-rose-500", bg: "bg-rose-500/5", iconBg: "bg-rose-500/15", text: "text-rose-400" },
} as const;

// Shared by this page's "Download XLSX" button — same shape as
// PartsOrderDashboard.tsx's own copy (kept local rather than a shared
// import; both files' export buttons are one-off enough not to be worth a
// shared module for a five-line function).
function downloadSheetXlsx(filename: string, sheetName: string, rows: (string | number)[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, filename);
}

const TABS = [
  { id: "overview" as const, label: "Overview", icon: LayoutDashboard },
  { id: "pending-queue" as const, label: "Pending Queue", icon: ClipboardList },
  { id: "ra-returns" as const, label: "RA & Returns", icon: RotateCcw },
  { id: "done-activity" as const, label: "Done Activity", icon: CheckCheck },
];
type ReportPartsDailyTab = (typeof TABS)[number]["id"];

// CheckboxDropdown — same pattern PartsOrderDashboard.tsx established
// (select-styled trigger, portal-positioned checkbox list below it, empty
// `selected` = no filter/show all). Kept local here too since this is the
// only tab on this page that needs it.
function CheckboxDropdown({ options, selected, onChange, allLabel }: {
  options: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  allLabel: string;
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
    <div>
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

// Done Activity tab's per-metric done/total color: nothing to do at all
// (total 0) is neutral, fully caught up is green, still behind is amber.
function doneMetricColor(done: number, total: number): string {
  if (total === 0) return "text-slate-400";
  return done >= total ? "text-emerald-400" : "text-amber-400";
}

// Rows without structured metrics (migration 0175) — either logged before
// that migration, or a branch-progress lookup miss at log time — still
// carry the numbers inside the flat `summary` sentence
// (formatBranchProgressLine's own fixed wording), so parse them back out
// rather than falling back to an unbulleted line.
const SUMMARY_METRICS_RE = /Collections done (\d+)\/(\d+).*Daily Pickup done (\d+)\/(\d+).*Parts Received done (\d+)\/(\d+)/;
function parseSummaryMetrics(summary: string): PartsDoneActivityRow["metrics"] {
  const m = SUMMARY_METRICS_RE.exec(summary);
  if (!m) return null;
  return {
    collectionsDone: Number(m[1]),
    collectionsTotal: Number(m[2]),
    pickupDone: Number(m[3]),
    pickupTotal: Number(m[4]),
    receivedDone: Number(m[5]),
    receivedTotal: Number(m[6]),
  };
}

function isPartsProfile(p: ProfileRow): boolean {
  if (PARTS_ROLES.has(normalizeRole(p.role))) return true;
  return (p.extra_roles || []).some((r) => PARTS_ROLES.has(normalizeRole(r)));
}
function dateOnly(v: string | undefined | null): string {
  return (v || "").slice(0, 10);
}
function inRange(v: string | undefined | null, from: string, to: string): boolean {
  const d = dateOnly(v);
  return !!d && d >= from && d <= to;
}
const todayIso = () => new Date().toISOString().slice(0, 10);
const daysAgoIso = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
// Same day-by-day expansion as the eBay report's Daily Branch Report —
// capped so a wide date range doesn't render hundreds of blocks.
function dateRangeList(start: string, end: string, max = 31): string[] {
  const out: string[] = [];
  const d = new Date(start + "T00:00:00");
  const endD = new Date(end + "T00:00:00");
  if (Number.isNaN(d.getTime()) || Number.isNaN(endD.getTime()) || d > endD) return out;
  while (d <= endD && out.length < max) {
    out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export function ReportPartsDaily({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<PartInventoryRow[]>([]);
  const [staff, setStaff] = useState<ProfileRow[]>([]);
  const [issuesLog, setIssuesLog] = useState<PartsDailyIssueEntry[]>([]);

  const [dateFrom, setDateFrom] = useState(daysAgoIso(29));
  const [dateTo, setDateTo] = useState(todayIso());
  // Multi-select — empty set = no filter (show all), matching
  // PartsOrderDashboard's dashboard-wide Branch filter convention.
  const [branchFilter, setBranchFilter] = useState<Set<string>>(new Set());

  const [tab, setTab] = useState<ReportPartsDailyTab>("overview");

  // Deep link from a bell-icon notification straight into the Done
  // Activity tab (the "Parts done" notification sets ?tab=done-activity
  // on its link — see m.$module.tsx's confirmImDone) — same convention
  // PartInventory.tsx's Truck Stock Requests tab already uses.
  const routeSearch = (useSearch({ strict: false }) as { tab?: string }) ?? {};
  useEffect(() => {
    if (routeSearch.tab === "done-activity") setTab("done-activity");
  }, [routeSearch.tab]);

  // Pending Queue tab — per-branch Pickup/Collection/Receive pending
  // counts, reusing the exact same getBranchProgress() the Parts hub's own
  // "Done" digest already relies on (src/lib/partsBranchProgress.ts) —
  // "pending" here is just total - done. Loaded lazily, once branchOptions
  // is available (needs the Overview load to finish first) and this tab
  // is opened.
  const [branchProgress, setBranchProgress] = useState<BranchProgress[]>([]);
  const [branchProgressLoading, setBranchProgressLoading] = useState(false);
  const [branchProgressLoaded, setBranchProgressLoaded] = useState(false);

  // Pending Queue tab's raw line-item exports — the actual Collections/
  // Receives export format the team already produces by hand (matching
  // the reference workbook's own "Sample Exported Data" sheets), not
  // just the per-branch pending counts above. Loaded alongside
  // branchProgress, same tab/timing.
  const [collectionExportRows, setCollectionExportRows] = useState<PartCollectionRow[]>([]);
  const [receiveExportRows, setReceiveExportRows] = useState<PartReceiveRow[]>([]);

  // RA & Returns tab — RA Created (partReturnStatus.ts) and Return Pending
  // (partReturn.ts) are two distinct real workflows that happen to share
  // the same underlying `parts` table, so both load together when this tab
  // opens (same "load once, lazily" pattern as Done Activity/Pending Queue).
  const [raCreatedRows, setRaCreatedRows] = useState<RaCreatedRow[]>([]);
  const [returnPendingRows, setReturnPendingRows] = useState<ReturnPendingRow[]>([]);
  const [raReturnsLoading, setRaReturnsLoading] = useState(false);
  const [raReturnsLoaded, setRaReturnsLoaded] = useState(false);
  const [raReturnTypeFilter, setRaReturnTypeFilter] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Also loaded for Overview now — the Staff Changes Counter's RA
    // Created column needs raCreatedRows too, so widen the trigger
    // instead of fetching it twice.
    if ((tab !== "ra-returns" && tab !== "overview") || raReturnsLoaded) return;
    setRaReturnsLoading(true);
    Promise.all([
      getRaCreatedRows().catch((err) => { console.error("Failed to load RA Created rows:", err); return []; }),
      getReturnPendingRows().catch((err) => { console.error("Failed to load Return Pending rows:", err); return []; }),
    ])
      .then(([ra, pending]) => { setRaCreatedRows(ra); setReturnPendingRows(pending); setRaReturnsLoaded(true); })
      .finally(() => setRaReturnsLoading(false));
  }, [tab, raReturnsLoaded]);

  // Done Activity tab — a log of every "Done" button click on the Parts
  // hub (m.$module.tsx), synced with the same "Parts done" notification
  // that goes out to each branch's Parts Manager (see migration 0174 /
  // partsDoneActivityLog.ts). Loaded lazily, only once this tab is opened.
  const [doneActivity, setDoneActivity] = useState<PartsDoneActivityRow[]>([]);
  const [doneActivityLoading, setDoneActivityLoading] = useState(false);
  const [doneActivityLoaded, setDoneActivityLoaded] = useState(false);
  useEffect(() => {
    if (tab !== "done-activity" || doneActivityLoaded) return;
    setDoneActivityLoading(true);
    getPartsDoneActivity()
      .then((r) => { setDoneActivity(r); setDoneActivityLoaded(true); })
      .catch((err) => console.error("Failed to load Done activity:", err))
      .finally(() => setDoneActivityLoading(false));
  }, [tab, doneActivityLoaded]);
  // Empty set = no filter (show all), same convention as the checkbox
  // dropdowns above. Date range is inclusive on both ends, compared
  // against createdAt's own date (not time-of-day).
  const [doneActivityBranchFilter, setDoneActivityBranchFilter] = useState<Set<string>>(new Set());
  const [doneActivityNameFilter, setDoneActivityNameFilter] = useState<Set<string>>(new Set());
  const [doneActivityFrom, setDoneActivityFrom] = useState("");
  const [doneActivityTo, setDoneActivityTo] = useState("");
  const doneActivityBranchOptions = useMemo(
    () => Array.from(new Set(doneActivity.map((r) => r.branch))).sort((a, b) => a.localeCompare(b)),
    [doneActivity]
  );
  const doneActivityNameOptions = useMemo(
    () => Array.from(new Set(doneActivity.map((r) => r.actorName).filter((n): n is string => !!n))).sort((a, b) => a.localeCompare(b)),
    [doneActivity]
  );
  const filteredDoneActivity = useMemo(() => {
    return doneActivity.filter((r) => {
      if (doneActivityBranchFilter.size > 0 && !doneActivityBranchFilter.has(r.branch)) return false;
      if (doneActivityNameFilter.size > 0 && !(r.actorName && doneActivityNameFilter.has(r.actorName))) return false;
      const day = r.createdAt.slice(0, 10);
      if (doneActivityFrom && day < doneActivityFrom) return false;
      if (doneActivityTo && day > doneActivityTo) return false;
      return true;
    });
  }, [doneActivity, doneActivityBranchFilter, doneActivityNameFilter, doneActivityFrom, doneActivityTo]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [partRows, profiles] = await Promise.all([
          getPartsInventoryRows(),
          getCompanyUsers(),
        ]);
        if (cancelled) return;
        setRows(partRows);
        setStaff(profiles.filter((p) => p.is_active && isPartsProfile(p)));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load Part Daily Report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const branchOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.location).filter(Boolean))).sort(), [rows]);

  // Manual Issues/Lost tally, re-fetched whenever the date range changes —
  // same "scoped to the picker" convention as the rest of Overview.
  useEffect(() => {
    let cancelled = false;
    getPartsDailyIssues(dateFrom, dateTo)
      .then((entries) => { if (!cancelled) setIssuesLog(entries); })
      .catch((err) => console.error("Failed to load Issues/Lost log:", err));
    return () => { cancelled = true; };
  }, [dateFrom, dateTo]);

  useEffect(() => {
    if (tab !== "pending-queue" || branchProgressLoaded || branchOptions.length === 0) return;
    setBranchProgressLoading(true);
    // Fetched once over a fixed wide window (not the dashboard Date
    // Range) — same "load once, filter client-side" pattern the rest of
    // this file already uses (e.g. Done Activity). collectionExportRows/
    // receiveExportRows get re-filtered against dateFrom/dateTo/branchFilter
    // at render time instead of re-fetching on every date change.
    Promise.all([
      getBranchProgress(branchOptions),
      getPartsForDailyCollection({
        dateType: "Collect Date",
        startDate: daysAgoIso(89),
        endDate: todayIso(),
        notCollected: false,
        collected: true,
      }).catch((err) => { console.error("Failed to load Collections export:", err); return []; }),
      getPartsToReceive().catch((err) => { console.error("Failed to load Receives export:", err); return []; }),
    ])
      .then(([progress, collections, receives]) => {
        setBranchProgress(progress);
        setCollectionExportRows(collections);
        setReceiveExportRows(receives);
        setBranchProgressLoaded(true);
      })
      .catch((err) => console.error("Failed to load branch progress:", err))
      .finally(() => setBranchProgressLoading(false));
  }, [tab, branchProgressLoaded, branchOptions]);

  const inWindow = useMemo(
    () => rows.filter((r) => inRange(r.createdAt, dateFrom, dateTo) && (branchFilter.size === 0 || branchFilter.has(r.location))),
    [rows, dateFrom, dateTo, branchFilter],
  );

  const collectionsRows = useMemo(() => inWindow.filter((r) => DONE_STATUSES.has(r.status)), [inWindow]);
  // RA is date-scoped by ra_date (when the RA was actually created), not the
  // part line's createdAt — those can be days apart. Falls back to
  // createdAt for older rows recorded before ra_date was tracked.
  const raRows = useMemo(
    () => rows.filter((r) => !!r.raNo.trim() && inRange(r.raDate || r.createdAt, dateFrom, dateTo) && (branchFilter.size === 0 || branchFilter.has(r.location))),
    [rows, dateFrom, dateTo, branchFilter],
  );
  const receivesRows = useMemo(() => inWindow.filter((r) => !!r.inTracking.trim()), [inWindow]);
  // Pickups scoped by pickedUpDate (when the technician actually picked it
  // up), same fallback-to-createdAt convention as RA above — not
  // getBranchProgress()'s pickup source, which is a single-day, example-
  // data-backed queue view, not a real date-range-scoped history.
  const pickupRows = useMemo(
    () => rows.filter((r) => r.pickedUp && inRange(r.pickedUpDate || r.createdAt, dateFrom, dateTo) && (branchFilter.size === 0 || branchFilter.has(r.location))),
    [rows, dateFrom, dateTo, branchFilter],
  );

  const kpi = {
    collections: collectionsRows.length,
    pickups: pickupRows.length,
    ra: raRows.length,
    receives: receivesRows.length,
  };

  const branchChartData = useMemo(() => {
    const map = new Map<string, { collections: number; pickups: number; ra: number; receives: number; issues: number; lost: number }>();
    const ensure = (loc: string) => {
      const b = loc || "Unspecified";
      if (!map.has(b)) map.set(b, { collections: 0, pickups: 0, ra: 0, receives: 0, issues: 0, lost: 0 });
      return map.get(b)!;
    };
    for (const r of collectionsRows) ensure(r.location).collections++;
    for (const r of pickupRows) ensure(r.location).pickups++;
    for (const r of raRows) ensure(r.location).ra++;
    for (const r of receivesRows) ensure(r.location).receives++;
    for (const e of issuesLog) {
      if (branchFilter.size > 0 && !branchFilter.has(e.branch)) continue;
      const row = ensure(e.branch);
      row.issues += e.issues;
      row.lost += e.lost;
    }
    return Array.from(map.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.collections - a.collections).slice(0, 12);
  }, [collectionsRows, pickupRows, raRows, receivesRows, issuesLog, branchFilter]);

  // Same 4 automated metrics as branchChartData, but keyed per (branch, day)
  // instead of summed per branch — feeds the "Daily Branch Activity" table,
  // where these 4 columns are read-only next to the 2 manual ones.
  const dailyBranchStats = useMemo(() => {
    const map = new Map<string, { collections: number; pickups: number; ra: number; receives: number }>();
    const bump = (loc: string, dateStr: string, key: "collections" | "pickups" | "ra" | "receives") => {
      const b = loc || "Unspecified";
      const k = `${b}|${dateOnly(dateStr)}`;
      if (!map.has(k)) map.set(k, { collections: 0, pickups: 0, ra: 0, receives: 0 });
      map.get(k)![key]++;
    };
    for (const r of collectionsRows) bump(r.location, r.createdAt, "collections");
    for (const r of pickupRows) bump(r.location, r.pickedUpDate || r.createdAt, "pickups");
    for (const r of raRows) bump(r.location, r.raDate || r.createdAt, "ra");
    for (const r of receivesRows) bump(r.location, r.createdAt, "receives");
    return map;
  }, [collectionsRows, pickupRows, raRows, receivesRows]);
  const getDailyBranchStats = (branch: string, date: string) =>
    dailyBranchStats.get(`${branch}|${date}`) || { collections: 0, pickups: 0, ra: 0, receives: 0 };

  // $ value of parts collected this period — partPrice * quantity is
  // already on every row, just never summed anywhere on this page before.
  const dollarCollected = useMemo(
    () => collectionsRows.reduce((sum, r) => sum + (r.partPrice || 0) * (r.quantity || 1), 0),
    [collectionsRows]
  );

  // Live pipeline snapshot — everything in `inWindow` that hasn't reached a
  // DONE status yet, bucketed the same way PartsDashboard.tsx already does.
  const statusDistribution = useMemo(() => {
    const counts: Record<string, number> = { Pending: 0, Ready: 0, Done: 0, "Back Order": 0, Cancelled: 0 };
    for (const r of inWindow) {
      if (PENDING_STATUSES.has(r.status)) counts.Pending++;
      else if (READY_STATUSES.has(r.status)) counts.Ready++;
      else if (DONE_STATUSES.has(r.status)) counts.Done++;
      else if (r.status === "Back Order") counts["Back Order"]++;
      else if (r.status === "Cancelled") counts.Cancelled++;
    }
    return Object.entries(counts).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
  }, [inWindow]);

  const agingStats = useMemo(() => {
    const pending = inWindow.filter((r) => !DONE_STATUSES.has(r.status) && r.status !== "Cancelled");
    if (pending.length === 0) return { avgDays: 0, oldest: null as PartInventoryRow | null };
    const avgDays = Math.round(pending.reduce((s, r) => s + r.agingDays, 0) / pending.length);
    const oldest = pending.reduce((a, b) => (b.agingDays > a.agingDays ? b : a));
    return { avgDays, oldest };
  }, [inWindow]);

  // `warranty` is free text off the tickets table (not a fixed enum) —
  // same "group by whatever real values exist" approach PartsDashboard.tsx's
  // own Warranty panel already uses, rather than guessing an in/out split.
  const warrantyBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of inWindow) {
      const key = r.warranty || "Unspecified";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [inWindow]);

  // Staff Changes Counter — Collections/Pickups/Receives are driven by
  // `technician` on the parts rows, which is the TICKET's field
  // technician, not a Parts/Parts Manager staffer, so there's no real way
  // to attribute those three to someone in `staff`; they stay blank
  // rather than show a number attributed to the wrong person. RA Created
  // is the one genuine case — `returned_by` (free text, set when someone
  // processes a return) is matched by name against the Parts Staff roster.
  const staffChangesCounter = useMemo(() => {
    const byNameLower = new Map(staff.map((p) => [(p.display_name || p.email || "").trim().toLowerCase(), p]));
    const raCountByProfile = new Map<string, number>();
    for (const r of raCreatedRows) {
      const name = (r.returnedBy || "").trim();
      if (!name) continue;
      const match = byNameLower.get(name.toLowerCase());
      if (!match) continue;
      if (branchFilter.size > 0 && !branchFilter.has(r.location)) continue;
      const d = (r.raDate || "").slice(0, 10);
      if (!d || d < dateFrom || d > dateTo) continue;
      raCountByProfile.set(match.id, (raCountByProfile.get(match.id) ?? 0) + 1);
    }
    return staff
      .map((p) => ({
        id: p.id,
        name: p.display_name || p.email || "—",
        role: ROLE_LABELS[normalizeRole(p.role)] || p.role,
        branch: p.assigned_branch || p.department || "—",
        ra: raCountByProfile.get(p.id) ?? 0,
      }))
      .filter((s) => s.ra > 0)
      .sort((a, b) => b.ra - a.ra || a.name.localeCompare(b.name));
  }, [staff, raCreatedRows, branchFilter, dateFrom, dateTo]);

  // Manual Issues/Lost tally — branch-filtered the same way every other
  // Overview number already is, so the top tiles and the per-day table
  // below always agree with the picker.
  const issuesDateList = useMemo(() => dateRangeList(dateFrom, dateTo), [dateFrom, dateTo]);
  const filteredIssuesLog = useMemo(
    () => (branchFilter.size === 0 ? issuesLog : issuesLog.filter((e) => branchFilter.has(e.branch))),
    [issuesLog, branchFilter]
  );
  const issuesByKey = useMemo(() => new Map(filteredIssuesLog.map((e) => [`${e.branch}|${e.date}`, e])), [filteredIssuesLog]);
  const issuesTotals = useMemo(
    () => filteredIssuesLog.reduce((acc, e) => ({ issues: acc.issues + e.issues, lost: acc.lost + e.lost }), { issues: 0, lost: 0 }),
    [filteredIssuesLog]
  );
  const getIssueEntry = (branch: string, date: string) => issuesByKey.get(`${branch}|${date}`) || { branch, date, issues: 0, lost: 0 };
  const updateIssueField = (branch: string, date: string, field: "issues" | "lost", value: number) => {
    setIssuesLog((prev) => {
      const idx = prev.findIndex((e) => e.branch === branch && e.date === date);
      if (idx === -1) return [...prev, { branch, date, issues: 0, lost: 0, [field]: value }];
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };
  const saveIssueField = async (branch: string, date: string, field: "issues" | "lost", value: number) => {
    try {
      await upsertPartsDailyIssue(branch, date, { [field]: value });
    } catch (err) {
      console.error("Failed to save Issues/Lost entry:", err);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <button type="button" onClick={goBack} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4" /></button>
          <h1 className="text-2xl font-bold">{sub.title}</h1>
        </div>

        <div className="flex gap-2 border-b border-white/10 mb-6 overflow-x-auto">
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

        {tab !== "done-activity" && (
        <div className="panel mb-6"><div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" /></div>
          <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" /></div>
          <div className="flex flex-col gap-1 min-w-45"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Branch</label>
            <CheckboxDropdown options={branchOptions} selected={branchFilter} onChange={setBranchFilter} allLabel="Branches" />
          </div>
          {branchFilter.size > 0 && <button onClick={() => setBranchFilter(new Set())} className="btn text-sm px-3 mb-0.5">Clear</button>}
        </div></div>
        )}

        {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

        {tab === "overview" && (
        <>
        {loading ? (
          <div className="panel p-8 mb-6"><BrandedLoader label="Loading Part Daily Report…" /></div>
        ) : (
        <>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          {[
            { l: "Collections", v: kpi.collections, icon: Package, cls: KPI_TILE_COLORS.emerald },
            { l: "Pickups", v: kpi.pickups, icon: Truck, cls: KPI_TILE_COLORS.violet },
            { l: "RA Created", v: kpi.ra, icon: RotateCcw, cls: KPI_TILE_COLORS.orange },
            { l: "Receives", v: kpi.receives, icon: Inbox, cls: KPI_TILE_COLORS.blue },
            { l: "Issues", v: issuesTotals.issues, icon: AlertTriangle, cls: KPI_TILE_COLORS.red },
            { l: "Lost", v: issuesTotals.lost, icon: PackageX, cls: KPI_TILE_COLORS.rose },
          ].map(({ l, v, icon: Icon, cls }) => (
            <div key={l} className={`panel p-4 border-l-4 ${cls.border} ${cls.bg} flex items-center gap-3`}>
              <div className={`rounded-full ${cls.iconBg} p-2 shrink-0`}><Icon className={`h-4 w-4 ${cls.text}`} /></div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5 truncate">{l}</p>
                <p className={`text-2xl font-bold ${cls.text}`}>{v}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="panel p-4 border-l-4 border-l-indigo-500 mb-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-indigo-300 flex items-center gap-2"><Building2 className="h-4 w-4" /> Collections / Pickups / RA / Receives / Issues / Lost by Branch</p>
            <button
              onClick={() => downloadSheetXlsx(
                `parts-daily-branch-breakdown_${dateFrom}_to_${dateTo}.xlsx`,
                "Branch Breakdown",
                [
                  ["Branch", "Collections", "Pickups", "RA Created", "Receives", "Issues", "Lost"],
                  ...branchChartData.map((b) => [b.name, b.collections, b.pickups, b.ra, b.receives, b.issues, b.lost]),
                ],
              )}
              disabled={branchChartData.length === 0}
              className="btn text-xs px-2.5 py-1 flex items-center gap-1.5 disabled:opacity-50"
            >
              <Download className="h-3 w-3" /> Download XLSX
            </button>
          </div>
          {branchChartData.length === 0 ? (
            <p className="text-xs text-muted-foreground py-16 text-center">No part activity in this date range.</p>
          ) : (
            <>
            <ResponsiveContainer width="100%" height={280} debounce={200}>
              <BarChart data={branchChartData} margin={{ left: -10, top: 4 }} barCategoryGap="20%">
                <defs>
                  <linearGradient id="gradCollections" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#34d399" stopOpacity={1} /><stop offset="100%" stopColor="#34d399" stopOpacity={0.55} /></linearGradient>
                  <linearGradient id="gradPickups" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a78bfa" stopOpacity={1} /><stop offset="100%" stopColor="#a78bfa" stopOpacity={0.55} /></linearGradient>
                  <linearGradient id="gradReceives" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3b82f6" stopOpacity={1} /><stop offset="100%" stopColor="#3b82f6" stopOpacity={0.55} /></linearGradient>
                  <linearGradient id="gradRa" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#fb923c" stopOpacity={1} /><stop offset="100%" stopColor="#fb923c" stopOpacity={0.55} /></linearGradient>
                  <linearGradient id="gradIssues" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f87171" stopOpacity={1} /><stop offset="100%" stopColor="#f87171" stopOpacity={0.55} /></linearGradient>
                  <linearGradient id="gradLost" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#fb7185" stopOpacity={1} /><stop offset="100%" stopColor="#fb7185" stopOpacity={0.55} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 9 }} angle={-25} textAnchor="end" height={50} axisLine={{ stroke: "rgba(148,163,184,0.2)" }} tickLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
                <Legend wrapperStyle={LEGEND_STYLE} iconType="circle" iconSize={8} />
                <Bar dataKey="collections" fill="url(#gradCollections)" radius={[4, 4, 0, 0]} name="Collections" maxBarSize={24} />
                <Bar dataKey="pickups" fill="url(#gradPickups)" radius={[4, 4, 0, 0]} name="Pickups" maxBarSize={24} />
                <Bar dataKey="receives" fill="url(#gradReceives)" radius={[4, 4, 0, 0]} name="Receives" maxBarSize={24} />
                <Bar dataKey="ra" fill="url(#gradRa)" radius={[4, 4, 0, 0]} name="RA Created" maxBarSize={24} />
                <Bar dataKey="issues" fill="url(#gradIssues)" radius={[4, 4, 0, 0]} name="Issues" maxBarSize={24} />
                <Bar dataKey="lost" fill="url(#gradLost)" radius={[4, 4, 0, 0]} name="Lost" maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
            {/* Raw data under the graph, per the same numbers the chart plots. */}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-muted-foreground">
                    <th className="text-left font-semibold px-2 py-1.5">Branch</th>
                    <th className="text-right font-semibold px-2 py-1.5">Collections</th>
                    <th className="text-right font-semibold px-2 py-1.5">Pickups</th>
                    <th className="text-right font-semibold px-2 py-1.5">RA Created</th>
                    <th className="text-right font-semibold px-2 py-1.5">Receives</th>
                    <th className="text-right font-semibold px-2 py-1.5">Issues</th>
                    <th className="text-right font-semibold px-2 py-1.5">Lost</th>
                  </tr>
                </thead>
                <tbody>
                  {branchChartData.map((b) => (
                    <tr key={b.name} className="border-b border-white/5">
                      <td className="px-2 py-1.5 font-medium">{b.name}</td>
                      <td className="px-2 py-1.5 text-right text-emerald-300">{b.collections}</td>
                      <td className="px-2 py-1.5 text-right text-violet-300">{b.pickups}</td>
                      <td className="px-2 py-1.5 text-right text-orange-300">{b.ra}</td>
                      <td className="px-2 py-1.5 text-right text-blue-300">{b.receives}</td>
                      <td className="px-2 py-1.5 text-right text-red-300">{b.issues}</td>
                      <td className="px-2 py-1.5 text-right text-rose-300">{b.lost}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div className="panel p-4 border-l-4 border-l-green-500">
            <p className="text-sm font-semibold mb-3 text-green-300 flex items-center gap-2"><DollarSign className="h-4 w-4" /> Value &amp; Aging</p>
            <div className="space-y-3">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Value Collected</p>
                <p className="text-2xl font-bold text-green-400">${dollarCollected.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
              <div className="flex items-center justify-between border-t border-white/10 pt-3">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Avg Aging (pending)</p>
                  <p className="text-lg font-bold text-amber-300">{agingStats.avgDays}d</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Oldest Pending</p>
                  <p className="text-sm font-semibold text-red-300">
                    {agingStats.oldest ? `${agingStats.oldest.ticketNo || "—"} · ${agingStats.oldest.agingDays}d` : "—"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="panel p-4 border-l-4 border-l-purple-500">
            <p className="text-sm font-semibold mb-2 text-purple-300">Status Distribution</p>
            {statusDistribution.length === 0 ? (
              <p className="text-xs text-muted-foreground py-10 text-center">No parts in this date range.</p>
            ) : (
              <div className="flex items-center gap-3">
                <ResponsiveContainer width="55%" height={160}>
                  <PieChart>
                    <Pie data={statusDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={38} outerRadius={62} paddingAngle={2} stroke="none">
                      {statusDistribution.map((d) => <Cell key={d.name} fill={STATUS_BUCKET_COLORS[d.name] || "#94a3b8"} />)}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-1.5">
                  {statusDistribution.map((d) => (
                    <div key={d.name} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-muted-foreground"><span className="h-2 w-2 rounded-full shrink-0" style={{ background: STATUS_BUCKET_COLORS[d.name] || "#94a3b8" }} />{d.name}</span>
                      <span className="font-semibold text-slate-200">{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="panel p-4 border-l-4 border-l-cyan-500">
            <p className="text-sm font-semibold mb-3 text-cyan-300 flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Warranty</p>
            {warrantyBreakdown.length === 0 ? (
              <p className="text-xs text-muted-foreground py-10 text-center">No parts in this date range.</p>
            ) : (
              <div className="space-y-2.5">
                {warrantyBreakdown.map((b) => {
                  const max = Math.max(1, ...warrantyBreakdown.map((x) => x.count));
                  return (
                    <div key={b.label}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground truncate">{b.label}</span>
                        <span className="text-cyan-300 font-semibold">{b.count}</span>
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

        <div className="panel p-0 border-l-4 border-l-blue-500 mb-4">
          <div className="px-4 pt-4 pb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-blue-300 flex items-center gap-2"><Users className="h-4 w-4" /> Staff Changes Counter</p>
            <span className="text-xs text-muted-foreground">{staffChangesCounter.length} of {staff.length} Parts Staff</span>
          </div>
          <p className="text-xs text-muted-foreground px-4 pb-3">Only RA Created is attributable to a Parts Staff member (via who processed the return) — Collections/Pickups/Receives are tied to the ticket's field technician, not Parts Staff, so they stay blank here.</p>
          {staffChangesCounter.length === 0 ? (
            <p className="text-xs text-muted-foreground px-4 pb-4">No Parts staff have an RA Created attributed to them in this date range.</p>
          ) : (
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-900">
                  <tr className="border-b border-white/10 text-muted-foreground">
                    <th className="text-left font-semibold px-4 py-2">Name</th>
                    <th className="text-left font-semibold px-2 py-2">Role</th>
                    <th className="text-left font-semibold px-2 py-2">Branch</th>
                    <th className="text-right font-semibold px-2 py-2">Collections</th>
                    <th className="text-right font-semibold px-2 py-2">Pickups</th>
                    <th className="text-right font-semibold px-2 py-2">RA Created</th>
                    <th className="text-right font-semibold px-4 py-2">Receives</th>
                  </tr>
                </thead>
                <tbody>
                  {staffChangesCounter.map((s) => (
                    <tr key={s.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-4 py-2 font-medium">{s.name}</td>
                      <td className="px-2 py-2 text-muted-foreground">{s.role}</td>
                      <td className="px-2 py-2 text-muted-foreground">{s.branch}</td>
                      <td className="px-2 py-2 text-right text-muted-foreground">—</td>
                      <td className="px-2 py-2 text-right text-muted-foreground">—</td>
                      <td className="px-2 py-2 text-right font-semibold text-orange-300">{s.ra}</td>
                      <td className="px-4 py-2 text-right text-muted-foreground">—</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="mt-4">
          <p className="text-sm font-semibold mb-2 text-red-300 flex items-center gap-2"><PackageX className="h-4 w-4" /> Daily Branch Activity</p>
          <p className="text-xs text-muted-foreground mb-3">Collections/Pickups/RA/Receives are automated — same counts as the charts above, just broken out per branch per day. Issues and Lost are the only manual columns; the tiles above sum whatever's entered here for the selected date range.</p>
          {branchOptions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No branches yet — add a part record first.</p>
          ) : (
            <div className="space-y-4">
              {issuesDateList.map((date) => {
                const dayTotals = branchOptions.reduce(
                  (acc, b) => {
                    const e = getIssueEntry(b, date);
                    const s = getDailyBranchStats(b, date);
                    return {
                      collections: acc.collections + s.collections,
                      pickups: acc.pickups + s.pickups,
                      ra: acc.ra + s.ra,
                      receives: acc.receives + s.receives,
                      issues: acc.issues + e.issues,
                      lost: acc.lost + e.lost,
                    };
                  },
                  { collections: 0, pickups: 0, ra: 0, receives: 0, issues: 0, lost: 0 }
                );
                return (
                  <div key={date} className="panel p-0 overflow-hidden border-l-4 border-l-red-500">
                    <div className="px-4 py-2 bg-red-500/10 border-b border-white/10 font-semibold text-sm text-red-300">
                      {new Date(date + "T00:00:00").toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" })}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-white/10 bg-white/5">
                            <th className="px-2 py-2 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Branch</th>
                            <th className="px-2 py-2 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Collections</th>
                            <th className="px-2 py-2 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Pickups</th>
                            <th className="px-2 py-2 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">RA Created</th>
                            <th className="px-2 py-2 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Receives</th>
                            <th className="px-2 py-2 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Issues</th>
                            <th className="px-2 py-2 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Lost</th>
                          </tr>
                        </thead>
                        <tbody>
                          {branchOptions.map((branch) => {
                            const entry = getIssueEntry(branch, date);
                            const stats = getDailyBranchStats(branch, date);
                            return (
                              <tr key={branch} className="border-b border-white/5 hover:bg-white/5">
                                <td className="px-2 py-2 font-medium whitespace-nowrap">{branch}</td>
                                <td className="px-2 py-2 text-center text-emerald-300">{stats.collections}</td>
                                <td className="px-2 py-2 text-center text-violet-300">{stats.pickups}</td>
                                <td className="px-2 py-2 text-center text-orange-300">{stats.ra}</td>
                                <td className="px-2 py-2 text-center text-blue-300">{stats.receives}</td>
                                <td className="px-2 py-2 text-center">
                                  <input
                                    type="number"
                                    min={0}
                                    value={entry.issues}
                                    onChange={(e) => updateIssueField(branch, date, "issues", Number(e.target.value))}
                                    onBlur={(e) => saveIssueField(branch, date, "issues", Number(e.target.value))}
                                    className="glass-input text-xs py-0.5 px-1.5 rounded w-16 text-center text-red-300 font-medium"
                                  />
                                </td>
                                <td className="px-2 py-2 text-center">
                                  <input
                                    type="number"
                                    min={0}
                                    value={entry.lost}
                                    onChange={(e) => updateIssueField(branch, date, "lost", Number(e.target.value))}
                                    onBlur={(e) => saveIssueField(branch, date, "lost", Number(e.target.value))}
                                    className="glass-input text-xs py-0.5 px-1.5 rounded w-16 text-center text-rose-300 font-medium"
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-white/10 bg-white/5 font-semibold">
                            <td className="px-2 py-2">Totals</td>
                            <td className="px-2 py-2 text-center text-emerald-300">{dayTotals.collections}</td>
                            <td className="px-2 py-2 text-center text-violet-300">{dayTotals.pickups}</td>
                            <td className="px-2 py-2 text-center text-orange-300">{dayTotals.ra}</td>
                            <td className="px-2 py-2 text-center text-blue-300">{dayTotals.receives}</td>
                            <td className="px-2 py-2 text-center text-red-300">{dayTotals.issues}</td>
                            <td className="px-2 py-2 text-center text-rose-300">{dayTotals.lost}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {(() => {
            const fullRange = Math.round((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000) + 1;
            return fullRange > issuesDateList.length ? (
              <p className="text-xs text-muted-foreground mt-2">Showing the first {issuesDateList.length} days of this range — narrow the dates to see the rest.</p>
            ) : null;
          })()}
        </div>
        </>
        )}
        </>
        )}

        {tab === "pending-queue" && (
        <>
        {branchProgressLoading ? (
          <div className="panel p-8 mb-6"><BrandedLoader label="Loading Pending Queue…" /></div>
        ) : (
        <>
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            ["Pending Pickup", branchProgress.reduce((s, b) => s + (b.pickupTotal - b.pickupDone), 0), "text-violet-300"],
            ["Pending Collection", branchProgress.reduce((s, b) => s + (b.collectionsTotal - b.collectionsDone), 0), "text-cyan-300"],
            ["Pending Receive", branchProgress.reduce((s, b) => s + (b.receivedTotal - b.receivedDone), 0), "text-emerald-300"],
          ].map(([l, v, c]) => (
            <div key={l as string} className="panel p-4 text-center"><p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{l}</p><p className={`text-3xl font-bold ${c}`}>{v}</p></div>
          ))}
        </div>

        <div className="panel p-4 mb-4">
          <p className="text-sm font-semibold mb-4">Pending by Branch</p>
          {branchProgress.length === 0 ? (
            <p className="text-xs text-muted-foreground py-16 text-center">No branch data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(180, branchProgress.length * 26)} debounce={200}>
              <BarChart
                data={branchProgress.map((b) => ({ name: b.branch, pickup: b.pickupTotal - b.pickupDone, collections: b.collectionsTotal - b.collectionsDone, receives: b.receivedTotal - b.receivedDone }))}
                layout="vertical"
                margin={{ left: 20 }}
              >
                <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} width={100} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={LEGEND_STYLE} />
                <Bar dataKey="pickup" fill="#a78bfa" radius={[0, 4, 4, 0]} name="Pickup" />
                <Bar dataKey="collections" fill="#22d3ee" radius={[0, 4, 4, 0]} name="Collection" />
                <Bar dataKey="receives" fill="#34d399" radius={[0, 4, 4, 0]} name="Receive" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="panel p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-blue-400" />Pending by Branch
            <button
              type="button"
              onClick={() => downloadSheetXlsx(
                `parts-pending-queue_${todayIso()}.xlsx`,
                "Pending Queue",
                [["Branch", "Pickup Pending", "Collection Pending", "Receive Pending"], ...branchProgress.map((b) => [b.branch, b.pickupTotal - b.pickupDone, b.collectionsTotal - b.collectionsDone, b.receivedTotal - b.receivedDone])]
              )}
              className="ml-auto flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />Download XLSX
            </button>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-white/10 bg-white/5">
              {["Branch", "Pickup Pending", "Collection Pending", "Receive Pending"].map((h) => <th key={h} className="px-4 py-2 text-left text-xs text-muted-foreground uppercase">{h}</th>)}
            </tr></thead>
            <tbody>
              {branchProgress.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No data yet.</td></tr>
              ) : branchProgress.map((b, i) => (
                <tr key={b.branch} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                  <td className="px-4 py-2 font-medium">{b.branch}</td>
                  <td className="px-4 py-2 text-violet-300">{b.pickupTotal - b.pickupDone}</td>
                  <td className="px-4 py-2 text-cyan-300">{b.collectionsTotal - b.collectionsDone}</td>
                  <td className="px-4 py-2 text-emerald-300">{b.receivedTotal - b.receivedDone}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(() => {
          const collectionsScoped = collectionExportRows.filter((r) =>
            (branchFilter.size === 0 || branchFilter.has(r.location)) && inRange(r.collectedDate, dateFrom, dateTo)
          );
          const receivesScoped = receiveExportRows.filter((r) =>
            (branchFilter.size === 0 || branchFilter.has(r.location)) && inRange(r.receivedDate, dateFrom, dateTo) && r.qtyReceived > 0
          );
          return (
          <>
          <div className="panel p-0 overflow-hidden mt-4">
            <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-cyan-400" />Collections Export
              <button
                type="button"
                onClick={() => downloadSheetXlsx(
                  `collections-export_${todayIso()}.xlsx`,
                  "Collections",
                  [
                    ["Run Date", "Branch", "Technician", "Ticket #", "PartNo", "Qty", "Collect Type", "PartStatusDesc"],
                    ...collectionsScoped.map((r) => [dateOnly(r.collectedDate), r.location, r.techName, r.ticketNo, r.partNo, r.quantity, r.collectType, r.partStatus]),
                  ]
                )}
                className="ml-auto flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />Download XLSX
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-white/10 bg-white/5">
                  {["Run Date", "Branch", "Technician", "Ticket #", "PartNo", "Qty", "Collect Type", "PartStatusDesc"].map((h) => <th key={h} className="px-4 py-2 text-left text-xs text-muted-foreground uppercase whitespace-nowrap">{h}</th>)}
                </tr></thead>
                <tbody>
                  {collectionsScoped.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No collections in this date range.</td></tr>
                  ) : collectionsScoped.map((r, i) => (
                    <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                      <td className="px-4 py-2 text-xs whitespace-nowrap">{dateOnly(r.collectedDate)}</td>
                      <td className="px-4 py-2 text-xs">{r.location || "—"}</td>
                      <td className="px-4 py-2 text-xs">{r.techName || "—"}</td>
                      <td className="px-4 py-2 font-mono text-xs text-blue-300">{r.ticketNo || "—"}</td>
                      <td className="px-4 py-2 font-mono text-xs">{r.partNo || "—"}</td>
                      <td className="px-4 py-2 text-right">{r.quantity}</td>
                      <td className="px-4 py-2 text-xs">{r.collectType || "—"}</td>
                      <td className="px-4 py-2 text-xs">{r.partStatus || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel p-0 overflow-hidden mt-4">
            <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-emerald-400" />Receives Export
              <button
                type="button"
                onClick={() => downloadSheetXlsx(
                  `receives-export_${todayIso()}.xlsx`,
                  "Receives",
                  [
                    ["Receive Date", "Branch", "PO Number", "Ticket #", "PartNo", "Unique ID"],
                    ...receivesScoped.map((r) => [dateOnly(r.receivedDate), r.location, r.poNo, r.ticketNo, r.partNo, `${r.poNo}-${r.partNo}`]),
                  ]
                )}
                className="ml-auto flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />Download XLSX
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-white/10 bg-white/5">
                  {["Receive Date", "Branch", "PO Number", "Ticket #", "PartNo", "Unique ID"].map((h) => <th key={h} className="px-4 py-2 text-left text-xs text-muted-foreground uppercase whitespace-nowrap">{h}</th>)}
                </tr></thead>
                <tbody>
                  {receivesScoped.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No receives in this date range.</td></tr>
                  ) : receivesScoped.map((r, i) => (
                    <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                      <td className="px-4 py-2 text-xs whitespace-nowrap">{dateOnly(r.receivedDate)}</td>
                      <td className="px-4 py-2 text-xs">{r.location || "—"}</td>
                      <td className="px-4 py-2 font-mono text-xs">{r.poNo || "—"}</td>
                      <td className="px-4 py-2 font-mono text-xs text-blue-300">{r.ticketNo || "—"}</td>
                      <td className="px-4 py-2 font-mono text-xs">{r.partNo || "—"}</td>
                      <td className="px-4 py-2 font-mono text-[11px] text-muted-foreground">{r.poNo}-{r.partNo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          </>
          );
        })()}
        </>
        )}
        </>
        )}

        {tab === "ra-returns" && (
        <>
        {raReturnsLoading ? (
          <div className="panel p-8 mb-6"><BrandedLoader label="Loading RA & Returns…" /></div>
        ) : (
        <>
        {(() => {
          const raScoped = raCreatedRows.filter((r) =>
            (branchFilter.size === 0 || branchFilter.has(r.location)) &&
            inRange(r.raDate, dateFrom, dateTo) &&
            (raReturnTypeFilter.size === 0 || raReturnTypeFilter.has(r.returnType))
          );
          const returnTypeOptions = Array.from(new Set(raCreatedRows.map((r) => r.returnType))).sort();
          // Branch, not return_reason — that column exists in the schema but
          // nothing in this app has ever written to it (confirmed against
          // live data), so it's blank on every real row right now.
          const raByBranch = (() => {
            const map = new Map<string, number>();
            for (const r of raScoped) { const key = r.location || "Unspecified"; map.set(key, (map.get(key) ?? 0) + 1); }
            return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10);
          })();
          const returnPendingScoped = returnPendingRows.filter((r) =>
            (branchFilter.size === 0 || branchFilter.has(r.location)) &&
            inRange(r.invoiceDate, dateFrom, dateTo)
          );

          return (
          <>
          <div className="panel mb-4"><div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1 min-w-45">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Return Type</label>
              <CheckboxDropdown options={returnTypeOptions} selected={raReturnTypeFilter} onChange={setRaReturnTypeFilter} allLabel="Return Types" />
            </div>
            {raReturnTypeFilter.size > 0 && <button onClick={() => setRaReturnTypeFilter(new Set())} className="btn text-sm px-3 mb-0.5">Clear</button>}
          </div></div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <div className="panel p-4">
              <p className="text-sm font-semibold mb-4">RA Created</p>
              <div className="text-3xl font-bold text-yellow-300 text-center py-4">{raScoped.length}</div>
            </div>
            <div className="panel p-4">
              <p className="text-sm font-semibold mb-4">RA Created by Branch</p>
              {raByBranch.length === 0 ? (
                <p className="text-xs text-muted-foreground py-16 text-center">No RA activity in this date range.</p>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(140, raByBranch.length * 26)} debounce={200}>
                  <BarChart data={raByBranch} layout="vertical" margin={{ left: 20 }}>
                    <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} width={100} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="value" fill="#facc15" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="panel p-0 overflow-hidden mb-6">
            <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-yellow-400" />RA Created
              <button
                type="button"
                onClick={() => downloadSheetXlsx(
                  `ra-created_${todayIso()}.xlsx`,
                  "RA Created",
                  [
                    ["Return Date", "Branch", "RA No", "PO #", "Part No", "Description", "Return Type", "Returned By", "Qty", "Distributor"],
                    ...raScoped.map((r) => [r.raDate, r.location, r.raNo, r.poNo, r.partNo, r.description, r.returnType, r.returnedBy, r.qty, r.distributor]),
                  ]
                )}
                className="ml-auto flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />Download XLSX
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-white/10 bg-white/5">
                  {["Return Date", "Branch", "RA No", "PO #", "Return Type", "Returned By", "Qty", "Distributor"].map((h) => <th key={h} className="px-4 py-2 text-left text-xs text-muted-foreground uppercase whitespace-nowrap">{h}</th>)}
                </tr></thead>
                <tbody>
                  {raScoped.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No RA records match these filters.</td></tr>
                  ) : raScoped.map((r, i) => (
                    <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                      <td className="px-4 py-2 text-xs whitespace-nowrap">{r.raDate ? dateOnly(r.raDate) : "—"}</td>
                      <td className="px-4 py-2 text-xs">{r.location || "—"}</td>
                      <td className="px-4 py-2 font-mono text-xs text-blue-300">{r.raNo || "—"}</td>
                      <td className="px-4 py-2 font-mono text-xs">{r.poNo || "—"}</td>
                      <td className="px-4 py-2 text-xs">{r.returnType}</td>
                      <td className="px-4 py-2 text-xs">{r.returnedBy || "—"}</td>
                      <td className="px-4 py-2 text-right">{r.qty}</td>
                      <td className="px-4 py-2 text-xs">{r.distributor || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-orange-400" />Return Pending
              <button
                type="button"
                onClick={() => downloadSheetXlsx(
                  `return-pending_${todayIso()}.xlsx`,
                  "Return Pending",
                  [
                    ["Branch", "Part No", "Description", "Distributor", "Invoice No", "Invoice Date", "Qty", "Aging (days)", "Return Status"],
                    ...returnPendingScoped.map((r) => [r.location, r.partNo, r.description, r.partDist, r.invoiceNo, r.invoiceDate, r.quantity, r.aging ?? "", r.returnStatus]),
                  ]
                )}
                className="ml-auto flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />Download XLSX
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-white/10 bg-white/5">
                  {["Branch", "Part No", "Description", "Distributor", "Invoice No", "Invoice Date", "Qty", "Aging", "Return Status"].map((h) => <th key={h} className="px-4 py-2 text-left text-xs text-muted-foreground uppercase whitespace-nowrap">{h}</th>)}
                </tr></thead>
                <tbody>
                  {returnPendingScoped.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">No pending returns match these filters.</td></tr>
                  ) : returnPendingScoped.map((r, i) => (
                    <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                      <td className="px-4 py-2 text-xs">{r.location || "—"}</td>
                      <td className="px-4 py-2 font-mono text-xs text-blue-300">{r.partNo || "—"}</td>
                      <td className="px-4 py-2 text-xs">{r.description || "—"}</td>
                      <td className="px-4 py-2 text-xs">{r.partDist || "—"}</td>
                      <td className="px-4 py-2 font-mono text-xs">{r.invoiceNo || "—"}</td>
                      <td className="px-4 py-2 text-xs whitespace-nowrap">{r.invoiceDate ? dateOnly(r.invoiceDate) : "—"}</td>
                      <td className="px-4 py-2 text-right">{r.quantity}</td>
                      <td className="px-4 py-2 text-right text-orange-300">{r.aging ?? "—"}</td>
                      <td className="px-4 py-2 text-xs">{r.returnStatus || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          </>
          );
        })()}
        </>
        )}
        </>
        )}

        {tab === "done-activity" && (
        <div className="space-y-3">
          <div className="panel flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1 min-w-[180px]">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Branch</label>
              <CheckboxDropdown options={doneActivityBranchOptions} selected={doneActivityBranchFilter} onChange={setDoneActivityBranchFilter} allLabel="Branches" />
            </div>
            <div className="flex flex-col gap-1 min-w-[180px]">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reported By</label>
              <CheckboxDropdown options={doneActivityNameOptions} selected={doneActivityNameFilter} onChange={setDoneActivityNameFilter} allLabel="Names" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">From</label>
              <input type="date" aria-label="Done activity date from" value={doneActivityFrom} onChange={(e) => setDoneActivityFrom(e.target.value)} className="glass-input" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">To</label>
              <input type="date" aria-label="Done activity date to" value={doneActivityTo} onChange={(e) => setDoneActivityTo(e.target.value)} className="glass-input" />
            </div>
            {(doneActivityBranchFilter.size > 0 || doneActivityNameFilter.size > 0 || doneActivityFrom || doneActivityTo) && (
              <button
                type="button"
                onClick={() => { setDoneActivityBranchFilter(new Set()); setDoneActivityNameFilter(new Set()); setDoneActivityFrom(""); setDoneActivityTo(""); }}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                Clear filters
              </button>
            )}
          </div>

          {doneActivityLoading ? (
            <div className="panel p-8">
              <BrandedLoader label="Loading Done activity…" />
            </div>
          ) : doneActivity.length === 0 ? (
            <div className="panel text-sm text-muted-foreground">No one has clicked "Done" on the Parts hub yet.</div>
          ) : filteredDoneActivity.length === 0 ? (
            <div className="panel text-sm text-muted-foreground">No Done activity matches these filters.</div>
          ) : (
            Array.from(
              filteredDoneActivity.reduce((map, row) => {
                (map.get(row.branch) ?? map.set(row.branch, []).get(row.branch)!).push(row);
                return map;
              }, new Map<string, PartsDoneActivityRow[]>())
            )
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([branch, rows]) => (
                <div key={branch} className="panel">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold flex items-center gap-2"><Building2 className="h-4 w-4 text-blue-400" />{branch}</h3>
                    <span className="text-xs text-muted-foreground">{rows.length} Done click{rows.length === 1 ? "" : "s"}</span>
                  </div>
                  <div className="space-y-2">
                    {rows.map((row) => {
                      const metrics = row.metrics ?? parseSummaryMetrics(row.summary);
                      return (
                      <div key={row.id} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border px-2 py-0.5 text-[11px] font-medium bg-emerald-500/15 text-emerald-300 border-emerald-500/30">Done</span>
                          <span className="text-xs text-muted-foreground ml-auto">
                            {new Date(row.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                          </span>
                        </div>
                        {metrics ? (
                          <ul className="mt-1.5 space-y-1">
                            {[
                              { label: "Collection", dot: "bg-cyan-400", done: metrics.collectionsDone, total: metrics.collectionsTotal },
                              { label: "Pickup", dot: "bg-violet-400", done: metrics.pickupDone, total: metrics.pickupTotal },
                              { label: "Receive", dot: "bg-emerald-400", done: metrics.receivedDone, total: metrics.receivedTotal },
                            ].map((m) => (
                              <li key={m.label} className="flex items-center gap-2 text-sm">
                                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.dot}`} />
                                <span className="text-slate-300">{m.label}</span>
                                <span className={`ml-auto font-semibold tabular-nums ${doneMetricColor(m.done, m.total)}`}>{m.done}/{m.total}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1 text-sm text-slate-200">{row.summary}</p>
                        )}
                        <p className="mt-2 pt-2 border-t border-white/5 text-xs text-slate-400">
                          <span className="font-medium text-slate-300">Name:</span> {row.actorName || "Unknown"}
                          <span className="mx-1.5 text-muted-foreground">·</span>
                          Notified {row.recipientCount} Parts Manager{row.recipientCount === 1 ? "" : "s"}
                        </p>
                      </div>
                      );
                    })}
                  </div>
                </div>
              ))
          )}
        </div>
        )}
      </main>
    </div>
  );
}
