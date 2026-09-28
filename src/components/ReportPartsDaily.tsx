/**
 * Part Daily Report — rebuilt on live data, sharing PartsDashboard.tsx's
 * data source (getPartsInventoryRows(), the real `parts` table joined to
 * `tickets` for branch/location). Per branch: Collections = parts that
 * reached a DONE status, RA = parts with a return-authorization number
 * set, Receives = parts with an inbound tracking number set, Pending RA =
 * return-eligible parts (partReturn.ts) with no RA number yet — all
 * scoped to the selected date range.
 *
 * `parts.created_by` isn't populated in this data set (same gap
 * PartsDashboard.tsx already documents), so there's no real field to
 * attribute an individual part line to a specific staff member —
 * Collections/Pickups/RA/Receives stay branch-level, which is what the
 * Daily Branch Activity table actually emphasizes anyway. Issues/Lost/Not
 * Recovered/Total Warnings/Remarks are manually entered, tracked per
 * branch per day in parts_daily_issues_log (see partsDailyIssuesLog.ts).
 *
 * The Overview tab's old chart section (KPI tiles, branch bar chart,
 * Value & Aging/Status Distribution/Warranty panels) was replaced with
 * "PO Team's Daily Report" — Tickets/Parts Ordered computed live from
 * parts.po_date, Pending Tickets/Internal Note entered by hand (one row
 * per day, not per branch — see partsPoTeamDailyLog.ts).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearch, useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, Loader2, LayoutDashboard, CheckCheck, Building2, ClipboardList, RotateCcw, Download, Package, PackageX, Users, Hourglass } from "lucide-react";
import { BrandedLoader } from "@/components/BrandedLoader";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import * as XLSX from "xlsx";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getPartsInventoryRows, type PartInventoryRow } from "@/lib/supabase/partsInventory";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getPartsDailyIssues, upsertPartsDailyIssue, type PartsDailyIssueEntry } from "@/lib/supabase/partsDailyIssuesLog";
import { getPartsPoTeamDailyLog, upsertPartsPoTeamDailyEntry, type PartsPoTeamDailyEntry } from "@/lib/supabase/partsPoTeamDailyLog";
import { getPartsPoTeamStaffDailyLog, upsertPartsPoTeamStaffDailyEntry, type PartsPoTeamStaffDailyEntry } from "@/lib/supabase/partsPoTeamStaffDailyLog";
import { normalizeRole, ROLE_LABELS } from "@/lib/roleLabels";
import { getPartsDoneActivity, type PartsDoneActivityRow } from "@/lib/supabase/partsDoneActivityLog";
import { getBranchProgress, type BranchProgress } from "@/lib/partsBranchProgress";
import { getPartReturns as getRaCreatedRows, type PartReturnRow as RaCreatedRow } from "@/lib/supabase/partReturnStatus";
import { getPartReturns as getReturnPendingRows, type PartReturnRow as ReturnPendingRow } from "@/lib/supabase/partReturn";
import { getPartsForDailyCollection, type PartCollectionRow } from "@/lib/supabase/partDailyCollection";
import { getPartsToReceive, type PartReceiveRow } from "@/lib/supabase/partReceive";

// The "Parts Order" clerical role (roleLabels.ts's PARTS_ORDER) — PO Team
// members specifically, distinct from branch-floor PARTS/PARTS_MANAGER
// staff, which this page never lists.
const PARTS_ORDER_ROLES = new Set(["PARTS_ORDER"]);
// Same DONE bucket PartsDashboard.tsx already established.
const DONE_STATUSES = new Set(["Used", "Claimed"]);
const TOOLTIP_STYLE = { background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 6, color: "#0f172a", fontSize: 12, fontWeight: 600, boxShadow: "0 4px 12px rgba(0,0,0,0.3)" } as const;
const LEGEND_STYLE = { fontSize: 11, color: "#94a3b8" } as const;
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

function isPartsOrderProfile(p: ProfileRow): boolean {
  if (PARTS_ORDER_ROLES.has(normalizeRole(p.role))) return true;
  return (p.extra_roles || []).some((r) => PARTS_ORDER_ROLES.has(normalizeRole(r)));
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
    // Created column and Daily Branch Activity's Pending RA column both
    // need this data too, so widen the trigger instead of fetching twice.
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
        setStaff(profiles.filter((p) => p.is_active && isPartsOrderProfile(p)));
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

  // Same automated metrics, but keyed per (branch, day) instead of summed
  // company-wide — feeds the "Daily Branch Activity" table, where these
  // are read-only next to the manual columns. Pending RA is sourced from
  // returnPendingRows (partReturn.ts) — parts eligible for return that
  // don't have an RA number yet — bucketed by invoiceDate since that's
  // the closest thing to "when this became return-eligible"; it's a live
  // snapshot (no historical status log exists), so a past day's count can
  // shift if a part invoiced that day is still pending today.
  const dailyBranchStats = useMemo(() => {
    const map = new Map<string, { collections: number; pickups: number; ra: number; receives: number; pendingRa: number }>();
    const bump = (loc: string, dateStr: string, key: "collections" | "pickups" | "ra" | "receives" | "pendingRa") => {
      const b = loc || "Unspecified";
      const k = `${b}|${dateOnly(dateStr)}`;
      if (!map.has(k)) map.set(k, { collections: 0, pickups: 0, ra: 0, receives: 0, pendingRa: 0 });
      map.get(k)![key]++;
    };
    for (const r of collectionsRows) bump(r.location, r.createdAt, "collections");
    for (const r of pickupRows) bump(r.location, r.pickedUpDate || r.createdAt, "pickups");
    for (const r of raRows) bump(r.location, r.raDate || r.createdAt, "ra");
    for (const r of receivesRows) bump(r.location, r.createdAt, "receives");
    for (const r of returnPendingRows) {
      if (r.raNo.trim()) continue; // already has an RA — counted in "ra" above instead
      if (branchFilter.size > 0 && !branchFilter.has(r.location)) continue;
      if (!r.invoiceDate) continue;
      bump(r.location, r.invoiceDate, "pendingRa");
    }
    return map;
  }, [collectionsRows, pickupRows, raRows, receivesRows, returnPendingRows, branchFilter]);
  const getDailyBranchStats = (branch: string, date: string) =>
    dailyBranchStats.get(`${branch}|${date}`) || { collections: 0, pickups: 0, ra: 0, receives: 0, pendingRa: 0 };

  // PO Team roster — Parts Order staff only (isPartsOrderProfile). No.
  // Tickets/Parts/Pending here are the SAME company-wide numbers as the
  // PO Team's Daily Report tiles above (ticketsOrdered/partsOrdered/
  // poTeamPendingTickets, same poTeamDateFrom/poTeamDateTo range) — parts
  // rows carry no staff-attribution field (parts.created_by isn't
  // populated), so there's no real way to break those down per person;
  // this just lists who's on the PO team for the period, not per-person
  // counts.
  const staffChangesCounter = useMemo(() => {
    return staff
      .map((p) => ({
        id: p.id,
        name: p.display_name || p.email || "—",
        role: ROLE_LABELS[normalizeRole(p.role)] || p.role,
        branch: p.assigned_branch || p.department || "—",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [staff]);

  // Manual per-branch tally (Issues/Lost/Not Recovered/Total Warnings/
  // Remarks) — branch-filtered the same way every other Overview number
  // already is.
  const issuesDateList = useMemo(() => dateRangeList(dateFrom, dateTo), [dateFrom, dateTo]);
  const filteredIssuesLog = useMemo(
    () => (branchFilter.size === 0 ? issuesLog : issuesLog.filter((e) => branchFilter.has(e.branch))),
    [issuesLog, branchFilter]
  );
  const issuesByKey = useMemo(() => new Map(filteredIssuesLog.map((e) => [`${e.branch}|${e.date}`, e])), [filteredIssuesLog]);
  const getIssueEntry = (branch: string, date: string) =>
    issuesByKey.get(`${branch}|${date}`) || { branch, date, issues: 0, lost: 0, notRecovered: 0, totalWarnings: 0, remarks: "" };
  type ManualTallyField = "issues" | "lost" | "notRecovered" | "totalWarnings" | "remarks";
  const updateIssueField = (branch: string, date: string, field: ManualTallyField, value: number | string) => {
    setIssuesLog((prev) => {
      const idx = prev.findIndex((e) => e.branch === branch && e.date === date);
      if (idx === -1) return [...prev, { branch, date, issues: 0, lost: 0, notRecovered: 0, totalWarnings: 0, remarks: "", [field]: value }];
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };
  const saveIssueField = async (branch: string, date: string, field: ManualTallyField, value: number | string) => {
    try {
      await upsertPartsDailyIssue(branch, date, { [field]: value } as Partial<Pick<PartsDailyIssueEntry, ManualTallyField>>);
    } catch (err) {
      console.error("Failed to save manual tally entry:", err);
    }
  };

  // PO Team's Daily Report — replaces the old chart section. Tickets/Parts
  // Ordered are computed live from parts.po_date (real "when the PO was
  // placed" data), summed across the selected range. Pending Tickets and
  // Internal Note have no live source (Pending Tickets would need a
  // same-day 2PM CST snapshot this app doesn't take), so the PO Team
  // enters both by hand — one row per day (partsPoTeamDailyLog.ts).
  // Pending Tickets sums whatever's been entered for each day in range;
  // Internal Note is a single field tied to Date To (the most recent day
  // in the range) — editing it only ever writes that one day's row.
  const [poTeamDateFrom, setPoTeamDateFrom] = useState(todayIso());
  const [poTeamDateTo, setPoTeamDateTo] = useState(todayIso());
  const [poTeamEntries, setPoTeamEntries] = useState<PartsPoTeamDailyEntry[]>([]);
  const [poTeamSaving, setPoTeamSaving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getPartsPoTeamDailyLog(poTeamDateFrom, poTeamDateTo)
      .then((entries) => { if (!cancelled) setPoTeamEntries(entries); })
      .catch((err) => console.error("Failed to load PO Team's Daily Report entries:", err));
    return () => { cancelled = true; };
  }, [poTeamDateFrom, poTeamDateTo]);
  const poTeamIsSingleDay = poTeamDateFrom === poTeamDateTo;
  const poTeamPendingTickets = useMemo(() => poTeamEntries.reduce((sum, e) => sum + e.pendingTickets, 0), [poTeamEntries]);
  const savePoTeamEntryField = async (patch: Partial<Pick<PartsPoTeamDailyEntry, "pendingTickets">>) => {
    setPoTeamSaving(true);
    try {
      await upsertPartsPoTeamDailyEntry(poTeamDateTo, patch);
      setPoTeamEntries((prev) => {
        const idx = prev.findIndex((e) => e.date === poTeamDateTo);
        if (idx === -1) return [...prev, { date: poTeamDateTo, pendingTickets: 0, internalNote: "", ...patch }];
        const next = [...prev];
        next[idx] = { ...next[idx], ...patch };
        return next;
      });
    } catch (err) {
      console.error("Failed to save PO Team's Daily Report entry:", err);
    } finally {
      setPoTeamSaving(false);
    }
  };
  const poTeamOrderedRows = useMemo(
    () => rows.filter((r) => inRange(r.poDate, poTeamDateFrom, poTeamDateTo) && (branchFilter.size === 0 || branchFilter.has(r.location))),
    [rows, poTeamDateFrom, poTeamDateTo, branchFilter]
  );
  const ticketsOrdered = useMemo(() => new Set(poTeamOrderedRows.map((r) => r.ticketNo).filter(Boolean)).size, [poTeamOrderedRows]);
  const partsOrdered = useMemo(() => poTeamOrderedRows.reduce((sum, r) => sum + (r.quantity || 1), 0), [poTeamOrderedRows]);

  // Staff Changes Counter — PO Team's own per-person tally (migration
  // 0310). No live source for any of these (parts.created_by isn't
  // populated), so a lead enters Tickets/Parts/Pending and a note by hand
  // per (staffer, day) — same manual-tally pattern as Daily Branch
  // Activity's Issues/Lost/etc., just keyed by profile_id instead of
  // branch. Editable inline when the range is a single day; summed
  // read-only (Tickets/Parts/Pending) across the range otherwise, with
  // Internal Note always tied to Date To specifically.
  const [staffPoEntries, setStaffPoEntries] = useState<PartsPoTeamStaffDailyEntry[]>([]);
  const [staffPoSavingKey, setStaffPoSavingKey] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getPartsPoTeamStaffDailyLog(poTeamDateFrom, poTeamDateTo)
      .then((entries) => { if (!cancelled) setStaffPoEntries(entries); })
      .catch((err) => console.error("Failed to load PO Team staff daily entries:", err));
    return () => { cancelled = true; };
  }, [poTeamDateFrom, poTeamDateTo]);
  const staffPoEntriesByProfile = useMemo(() => {
    const map = new Map<string, PartsPoTeamStaffDailyEntry[]>();
    for (const e of staffPoEntries) {
      const arr = map.get(e.profileId);
      if (arr) arr.push(e);
      else map.set(e.profileId, [e]);
    }
    return map;
  }, [staffPoEntries]);
  const getStaffPoSummary = (profileId: string) => {
    const entries = staffPoEntriesByProfile.get(profileId) ?? [];
    return {
      ticketsOrdered: entries.reduce((s, e) => s + e.ticketsOrdered, 0),
      partsOrdered: entries.reduce((s, e) => s + e.partsOrdered, 0),
      pendingTickets: entries.reduce((s, e) => s + e.pendingTickets, 0),
      internalNote: entries.find((e) => e.date === poTeamDateTo)?.internalNote ?? "",
    };
  };
  const saveStaffPoField = async (profileId: string, patch: Partial<Pick<PartsPoTeamStaffDailyEntry, "ticketsOrdered" | "partsOrdered" | "pendingTickets" | "internalNote">>) => {
    setStaffPoSavingKey(profileId);
    try {
      await upsertPartsPoTeamStaffDailyEntry(profileId, poTeamDateTo, patch);
      setStaffPoEntries((prev) => {
        const idx = prev.findIndex((e) => e.profileId === profileId && e.date === poTeamDateTo);
        if (idx === -1) return [...prev, { profileId, date: poTeamDateTo, ticketsOrdered: 0, partsOrdered: 0, pendingTickets: 0, internalNote: "", ...patch }];
        const next = [...prev];
        next[idx] = { ...next[idx], ...patch };
        return next;
      });
    } catch (err) {
      console.error("Failed to save PO Team staff entry:", err);
    } finally {
      setStaffPoSavingKey(null);
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
        <div className="panel p-4 border-l-4 border-l-indigo-500 mb-6">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <p className="text-sm font-semibold text-indigo-300 flex items-center gap-2"><ClipboardList className="h-4 w-4" /> PO Team's Daily Report</p>
            <div className="flex items-end gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date From</label>
                <input type="date" value={poTeamDateFrom} onChange={(e) => setPoTeamDateFrom(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date To</label>
                <input type="date" value={poTeamDateTo} onChange={(e) => setPoTeamDateTo(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
              </div>
              {poTeamSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground mb-2" />}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div className={`panel p-4 border-l-4 ${KPI_TILE_COLORS.emerald.border} ${KPI_TILE_COLORS.emerald.bg} flex items-center gap-3`}>
              <div className={`rounded-full ${KPI_TILE_COLORS.emerald.iconBg} p-2 shrink-0`}><ClipboardList className={`h-4 w-4 ${KPI_TILE_COLORS.emerald.text}`} /></div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5 truncate">No. of Tickets Ordered</p>
                <p className={`text-2xl font-bold ${KPI_TILE_COLORS.emerald.text}`}>{ticketsOrdered}</p>
              </div>
            </div>
            <div className={`panel p-4 border-l-4 ${KPI_TILE_COLORS.violet.border} ${KPI_TILE_COLORS.violet.bg} flex items-center gap-3`}>
              <div className={`rounded-full ${KPI_TILE_COLORS.violet.iconBg} p-2 shrink-0`}><Package className={`h-4 w-4 ${KPI_TILE_COLORS.violet.text}`} /></div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5 truncate">No. of Parts Ordered</p>
                <p className={`text-2xl font-bold ${KPI_TILE_COLORS.violet.text}`}>{partsOrdered}</p>
              </div>
            </div>
            <div className={`panel p-4 border-l-4 ${KPI_TILE_COLORS.orange.border} ${KPI_TILE_COLORS.orange.bg} flex items-center gap-3`}>
              <div className={`rounded-full ${KPI_TILE_COLORS.orange.iconBg} p-2 shrink-0`}><Hourglass className={`h-4 w-4 ${KPI_TILE_COLORS.orange.text}`} /></div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5 truncate">No. of Pending Tickets</p>
                {poTeamIsSingleDay ? (
                  <input
                    type="number"
                    min={0}
                    value={poTeamPendingTickets}
                    onChange={(e) => setPoTeamEntries([{ date: poTeamDateTo, pendingTickets: Number(e.target.value) || 0, internalNote: "" }])}
                    onBlur={(e) => savePoTeamEntryField({ pendingTickets: Number(e.target.value) || 0 })}
                    className={`w-full bg-transparent text-2xl font-bold ${KPI_TILE_COLORS.orange.text} focus:outline-none`}
                  />
                ) : (
                  <p className={`text-2xl font-bold ${KPI_TILE_COLORS.orange.text}`} title="Sum of each day's entry in this range — narrow to one day to edit">{poTeamPendingTickets}</p>
                )}
              </div>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">Tickets/Parts Ordered are automatic (parts.po_date within {poTeamDateFrom} – {poTeamDateTo}, respecting the Branch filter below). Pending Tickets is entered by hand, one row per day — narrow to a single day to edit it directly.</p>
        </div>

        <div className="panel p-0 border-l-4 border-l-blue-500 mb-4">
          <div className="px-4 pt-4 pb-2 flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm font-semibold text-blue-300 flex items-center gap-2"><Users className="h-4 w-4" /> Staff Changes Counter — PO Team</p>
            <span className="text-xs text-muted-foreground">{staffChangesCounter.length} Parts Order staff</span>
          </div>
          <p className="text-xs text-muted-foreground px-4 pb-3">Same {poTeamDateFrom} – {poTeamDateTo} range as PO Team's Daily Report above. No live source for any of these (parts.created_by isn't populated), so they're entered by hand per person, per day — editable directly when the range is a single day; summed across the range otherwise ({poTeamIsSingleDay ? "editing now" : "narrow to a single day to edit"}). Internal Note always applies to {poTeamDateTo}.</p>
          {staffChangesCounter.length === 0 ? (
            <p className="text-xs text-muted-foreground px-4 pb-4">No active Parts Order staff found.</p>
          ) : (
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-900">
                  <tr className="border-b border-white/10 text-muted-foreground">
                    <th className="text-left font-semibold px-4 py-2">Name</th>
                    <th className="text-left font-semibold px-2 py-2">Role</th>
                    <th className="text-center font-semibold px-2 py-2">No. of Tickets Ordered</th>
                    <th className="text-center font-semibold px-2 py-2">No. of Parts Ordered</th>
                    <th className="text-center font-semibold px-2 py-2">No. of Pending Tickets</th>
                    <th className="text-left font-semibold px-4 py-2">Internal Note</th>
                  </tr>
                </thead>
                <tbody>
                  {staffChangesCounter.map((s) => {
                    const summary = getStaffPoSummary(s.id);
                    const saving = staffPoSavingKey === s.id;
                    return (
                      <tr key={s.id} className="border-b border-white/5 hover:bg-white/5">
                        <td className="px-4 py-2 font-medium whitespace-nowrap">{s.name}</td>
                        <td className="px-2 py-2 text-muted-foreground whitespace-nowrap">{s.role}</td>
                        {poTeamIsSingleDay ? (
                          <>
                            <td className="px-2 py-2 text-center">
                              <input
                                type="number"
                                min={0}
                                defaultValue={summary.ticketsOrdered}
                                onBlur={(e) => saveStaffPoField(s.id, { ticketsOrdered: Number(e.target.value) || 0 })}
                                className="glass-input text-xs py-0.5 px-1.5 rounded w-16 text-center text-emerald-300 font-medium"
                              />
                            </td>
                            <td className="px-2 py-2 text-center">
                              <input
                                type="number"
                                min={0}
                                defaultValue={summary.partsOrdered}
                                onBlur={(e) => saveStaffPoField(s.id, { partsOrdered: Number(e.target.value) || 0 })}
                                className="glass-input text-xs py-0.5 px-1.5 rounded w-16 text-center text-violet-300 font-medium"
                              />
                            </td>
                            <td className="px-2 py-2 text-center">
                              <input
                                type="number"
                                min={0}
                                defaultValue={summary.pendingTickets}
                                onBlur={(e) => saveStaffPoField(s.id, { pendingTickets: Number(e.target.value) || 0 })}
                                className="glass-input text-xs py-0.5 px-1.5 rounded w-16 text-center text-orange-300 font-medium"
                              />
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-2 py-2 text-center text-emerald-300 font-semibold">{summary.ticketsOrdered}</td>
                            <td className="px-2 py-2 text-center text-violet-300 font-semibold">{summary.partsOrdered}</td>
                            <td className="px-2 py-2 text-center text-orange-300 font-semibold">{summary.pendingTickets}</td>
                          </>
                        )}
                        <td className="px-4 py-2">
                          <input
                            type="text"
                            defaultValue={summary.internalNote}
                            onBlur={(e) => saveStaffPoField(s.id, { internalNote: e.target.value })}
                            placeholder="Manually entered…"
                            className="glass-input text-xs py-0.5 px-1.5 rounded w-full min-w-[160px]"
                          />
                          {saving && <span className="text-[10px] text-slate-500 ml-1">Saving…</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="mt-4">
          <p className="text-sm font-semibold mb-2 text-red-300 flex items-center gap-2"><PackageX className="h-4 w-4" /> Daily Branch Activity</p>
          <p className="text-xs text-muted-foreground mb-3">Pickups/Collections/Receives/Pending RA/RA Created are automated, broken out per branch per day. Issues, Lost, Not Recovered, Total Warnings, and Remarks are manual.</p>
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
                      receives: acc.receives + s.receives,
                      pendingRa: acc.pendingRa + s.pendingRa,
                      ra: acc.ra + s.ra,
                      issues: acc.issues + e.issues,
                      lost: acc.lost + e.lost,
                      notRecovered: acc.notRecovered + e.notRecovered,
                      totalWarnings: acc.totalWarnings + e.totalWarnings,
                    };
                  },
                  { collections: 0, pickups: 0, receives: 0, pendingRa: 0, ra: 0, issues: 0, lost: 0, notRecovered: 0, totalWarnings: 0 }
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
                            <th className="px-2 py-2 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Pickups</th>
                            <th className="px-2 py-2 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Collections</th>
                            <th className="px-2 py-2 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Receives</th>
                            <th className="px-2 py-2 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Pending RA</th>
                            <th className="px-2 py-2 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">RA Created</th>
                            <th className="px-2 py-2 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Issues</th>
                            <th className="px-2 py-2 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Lost</th>
                            <th className="px-2 py-2 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Not Recovered</th>
                            <th className="px-2 py-2 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Total Warnings</th>
                            <th className="px-2 py-2 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Remarks</th>
                          </tr>
                        </thead>
                        <tbody>
                          {branchOptions.map((branch) => {
                            const entry = getIssueEntry(branch, date);
                            const stats = getDailyBranchStats(branch, date);
                            return (
                              <tr key={branch} className="border-b border-white/5 hover:bg-white/5">
                                <td className="px-2 py-2 font-medium whitespace-nowrap">{branch}</td>
                                <td className="px-2 py-2 text-center text-violet-300">{stats.pickups}</td>
                                <td className="px-2 py-2 text-center text-emerald-300">{stats.collections}</td>
                                <td className="px-2 py-2 text-center text-blue-300">{stats.receives}</td>
                                <td className="px-2 py-2 text-center text-amber-300">{stats.pendingRa}</td>
                                <td className="px-2 py-2 text-center text-orange-300">{stats.ra}</td>
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
                                <td className="px-2 py-2 text-center">
                                  <input
                                    type="number"
                                    min={0}
                                    value={entry.notRecovered}
                                    onChange={(e) => updateIssueField(branch, date, "notRecovered", Number(e.target.value))}
                                    onBlur={(e) => saveIssueField(branch, date, "notRecovered", Number(e.target.value))}
                                    className="glass-input text-xs py-0.5 px-1.5 rounded w-16 text-center text-red-300 font-medium"
                                  />
                                </td>
                                <td className="px-2 py-2 text-center">
                                  <input
                                    type="number"
                                    min={0}
                                    value={entry.totalWarnings}
                                    onChange={(e) => updateIssueField(branch, date, "totalWarnings", Number(e.target.value))}
                                    onBlur={(e) => saveIssueField(branch, date, "totalWarnings", Number(e.target.value))}
                                    className="glass-input text-xs py-0.5 px-1.5 rounded w-16 text-center text-amber-300 font-medium"
                                  />
                                </td>
                                <td className="px-2 py-2">
                                  <input
                                    type="text"
                                    value={entry.remarks}
                                    onChange={(e) => updateIssueField(branch, date, "remarks", e.target.value)}
                                    onBlur={(e) => saveIssueField(branch, date, "remarks", e.target.value)}
                                    placeholder="—"
                                    className="glass-input text-xs py-0.5 px-1.5 rounded w-full min-w-[140px]"
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-white/10 bg-white/5 font-semibold">
                            <td className="px-2 py-2">Totals</td>
                            <td className="px-2 py-2 text-center text-violet-300">{dayTotals.pickups}</td>
                            <td className="px-2 py-2 text-center text-emerald-300">{dayTotals.collections}</td>
                            <td className="px-2 py-2 text-center text-blue-300">{dayTotals.receives}</td>
                            <td className="px-2 py-2 text-center text-amber-300">{dayTotals.pendingRa}</td>
                            <td className="px-2 py-2 text-center text-orange-300">{dayTotals.ra}</td>
                            <td className="px-2 py-2 text-center text-red-300">{dayTotals.issues}</td>
                            <td className="px-2 py-2 text-center text-rose-300">{dayTotals.lost}</td>
                            <td className="px-2 py-2 text-center text-red-300">{dayTotals.notRecovered}</td>
                            <td className="px-2 py-2 text-center text-amber-300">{dayTotals.totalWarnings}</td>
                            <td className="px-2 py-2"></td>
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
