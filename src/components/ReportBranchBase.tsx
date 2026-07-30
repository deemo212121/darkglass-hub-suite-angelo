import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as XLSX from "xlsx";
import { Download } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend, ReferenceLine } from "recharts";
import {
  computeBranchRows,
  computeDailyCounts,
  computeDailyLtpBreakdown,
  describeAgingBuckets,
  LTP_AGING_MAX_BUCKET,
  type BranchRow,
  type DailyLtpRow,
} from "@/lib/operationsBranchMetrics";
import type { Ticket } from "@/lib/ticketData";

interface RegionGroup {
  /** Display label — "CENTRAL" / "WEST" / "EAST", or a single region's own tab. */
  region: string;
  locations: string[];
}

interface Props {
  /** Full company ticket set — already fetched once by the parent (ReportOperationsDaily). */
  tickets: Ticket[];
  /**
   * One entry for a single-region tab (Eastern/Western/Central TX). Multiple
   * entries (Overview) turn on the Region filter/column and region-level
   * summary cards.
   */
  regionGroups: RegionGroup[];
  /** Filename prefix for the XLSX export, e.g. "operations-eastern-tx". */
  exportFilePrefix: string;
}

type BranchRowWithRegion = BranchRow & { region: string };

// Recharts' Tooltip contentStyle doesn't reliably resolve/flip CSS custom
// properties (var(--card)/var(--foreground)) between light and dark theme,
// which left dark text on a dark background in dark mode. Every other chart
// tooltip in this app (Claims/Parts/CSR dashboards) sidesteps this with a
// fixed light box + fixed dark text instead — always readable regardless of
// page theme.
const TOOLTIP_STYLE = {
  background: "#ffffff",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  color: "#0f172a",
  fontSize: 12,
  fontWeight: 600,
  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
} as const;
// Mid-tone gray — same color already used for axis tick labels in this
// file, which have enough contrast on both the dark navy and cream page
// backgrounds (the Legend sits on the page, not inside the white tooltip
// box, so it needs a color that works on both themes rather than a fixed one).
const LEGEND_STYLE = { fontSize: 11, color: "#94a3b8" } as const;

const ltpColor = (v: number | null) => (v === null ? "" : v >= 50 ? "#34d399" : v >= 40 ? "#facc15" : "#f87171");
const todayIso = () => new Date().toISOString().slice(0, 10);
const daysAgoIso = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};
const fmtShort = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
};
const TD = "px-3 py-2.5 text-center";

// LTP aging bucket options for the dropdown: 1-7 are exact-day buckets, 8 is
// the open-ended "8+ days" catch-all (see matchesAgingBucket).
const AGING_BUCKET_OPTIONS = [1, 2, 3, 4, 5, 6, 7, LTP_AGING_MAX_BUCKET];
const bucketLabel = (n: number) => (n >= LTP_AGING_MAX_BUCKET ? "8+" : String(n));

/** Export the rows currently on screen (whatever filters are active) as a real .xlsx workbook. */
function exportBranchRowsToXlsx(rows: BranchRowWithRegion[], multiRegion: boolean, filePrefix: string) {
  const data = rows.map((r) => ({
    ...(multiRegion ? { Region: r.region } : {}),
    Location: r.branch,
    "Daily LTP%": r.dailyLTP ?? "",
    "Late Tickets": r.lateCount,
    "Pending Tickets": r.pendingCount,
    "Monthly LTP%": r.monthlyLTP ?? "",
    "Monthly Late Tickets": r.monthlyLateCount,
    "Monthly Tickets Entered": r.monthlyTotalCount,
    Assigned: r.assigned,
    Completed: r.completed,
    "Comp%": r.compPct ?? "",
    Staff: r.staff,
    "AM Reschedules": r.amReschedule,
    "Need Cancel": r.needCancel,
    Cancelled: r.cancelled,
    Reasons: r.reasons,
  }));
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Location Detail");
  XLSX.writeFile(workbook, `${filePrefix}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// January 2026 through the current month — future months would just be
// empty (no tickets exist yet), so there's no point offering them.
const LTP_MONTHS: string[] = (() => {
  const now = new Date();
  const lastMonth = now.getFullYear() === 2026 ? now.getMonth() + 1 : 12;
  return Array.from({ length: lastMonth }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);
})();

const monthLabel = (yyyymm: string) => {
  const [y, m] = yyyymm.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
};

// "July 1" style — matches the reference table's per-row date style, more
// readable in the exported workbook than a bare ISO string.
const dailyDateLabel = (yyyymmdd: string) => {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleString("en-US", { month: "long", day: "numeric" });
};

/** Export the currently-selected month's daily LTP breakdown as a real .xlsx workbook. */
function exportDailyLtpToXlsx(rows: DailyLtpRow[], agingLabel: string, month: string, filePrefix: string) {
  const data = rows.map((r) => ({
    Date: dailyDateLabel(r.date),
    [agingLabel]: r.lateCount,
    Pending: r.pendingCount,
    Locations: r.locations,
    "Month Total": r.monthTotalPending,
    "%LTP": r.ltpPct ?? "",
  }));
  const totalLate = rows.reduce((s, r) => s + r.lateCount, 0);
  const totalPending = rows.reduce((s, r) => s + r.pendingCount, 0);
  data.push({
    Date: "Total",
    [agingLabel]: totalLate,
    Pending: totalPending,
    Locations: "",
    "Month Total": rows.length > 0 ? rows[rows.length - 1].monthTotalPending : 0,
    "%LTP": totalPending > 0 ? Math.round((totalLate / totalPending) * 10000) / 100 : "",
  });
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, month);
  XLSX.writeFile(workbook, `${filePrefix}_ltp-daily_${month}.xlsx`);
}

export function ReportBranchBase({ tickets, regionGroups, exportFilePrefix }: Props) {
  const multiRegion = regionGroups.length > 1;
  const allLocations = useMemo(() => regionGroups.flatMap((g) => g.locations), [regionGroups]);

  const [dateFrom, setDateFrom] = useState(daysAgoIso(29));
  const [dateTo, setDateTo] = useState(todayIso());
  const [regionFilter, setRegionFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  // Default to the "7+ days" business rule (7 exact + the 8+ catch-all).
  const [agingBuckets, setAgingBuckets] = useState<Set<number>>(new Set([7, LTP_AGING_MAX_BUCKET]));
  const [agingMenuOpen, setAgingMenuOpen] = useState(false);
  const [agingMenuPos, setAgingMenuPos] = useState<{ top: number; left: number } | null>(null);
  const agingBtnRef = useRef<HTMLButtonElement>(null);
  // Single-region views (Eastern/Western/Central) split into an "LTP" and an
  // "Operations" sub-tab — one screen was carrying both at once. Overview
  // (multiRegion) is unaffected and keeps showing everything together.
  const [subTab, setSubTab] = useState<"ltp" | "operations">("ltp");
  const showLtpSection = multiRegion || subTab === "ltp";
  const showOpsSection = multiRegion || subTab === "operations";

  // The dropdown panel is portaled straight onto <body> (see below) instead
  // of relying on `absolute` + an ancestor z-index: the filter bar and the
  // chart cards below it are sibling `.panel` elements that each form their
  // own stacking context (backdrop-blur), so a z-index set inside one panel
  // can never out-rank a later sibling panel — the chart was always painting
  // on top of the dropdown regardless of how high z-50 went.
  const openAgingMenu = () => {
    const rect = agingBtnRef.current?.getBoundingClientRect();
    if (rect) setAgingMenuPos({ top: rect.bottom + 4, left: rect.left });
    setAgingMenuOpen(true);
  };

  // The panel's position is computed once, on open, from the button's
  // on-screen coordinates — it doesn't track the button as the page scrolls
  // (position: fixed stays put in the viewport while the button scrolls away
  // underneath it). Simplest fix: close it on scroll, same as the existing
  // click-away behavior, rather than recomputing position on every scroll
  // event.
  useEffect(() => {
    if (!agingMenuOpen) return;
    const close = () => setAgingMenuOpen(false);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", close, { capture: true });
  }, [agingMenuOpen]);

  const allBucketsSelected = agingBuckets.size === AGING_BUCKET_OPTIONS.length;
  const toggleBucket = (n: number) => {
    setAgingBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  };
  const toggleSelectAllBuckets = () => {
    setAgingBuckets(allBucketsSelected ? new Set() : new Set(AGING_BUCKET_OPTIONS));
  };

  const activeGroups = regionFilter ? regionGroups.filter((g) => g.region === regionFilter) : regionGroups;
  const locationOptions = regionFilter ? (regionGroups.find((g) => g.region === regionFilter)?.locations ?? []) : allLocations;

  const [ltpMonth, setLtpMonth] = useState(LTP_MONTHS[LTP_MONTHS.length - 1]);
  const dailyLtpRows = useMemo(
    () => computeDailyLtpBreakdown(tickets, branchFilter ? [branchFilter] : locationOptions, ltpMonth, agingBuckets),
    [tickets, locationOptions, branchFilter, ltpMonth, agingBuckets],
  );
  const dailyLtpTotals = useMemo(() => {
    const late = dailyLtpRows.reduce((s, r) => s + r.lateCount, 0);
    const pending = dailyLtpRows.reduce((s, r) => s + r.pendingCount, 0);
    return {
      late,
      pending,
      monthTotal: dailyLtpRows.length > 0 ? dailyLtpRows[dailyLtpRows.length - 1].monthTotalPending : 0,
      ltpPct: pending > 0 ? Math.round((late / pending) * 10000) / 100 : null,
    };
  }, [dailyLtpRows]);
  const rows: BranchRowWithRegion[] = useMemo(() => {
    return activeGroups.flatMap((g) => {
      const locs = branchFilter ? [branchFilter] : g.locations;
      return computeBranchRows(tickets, locs, dateFrom, dateTo, agingBuckets).map((r) => ({ ...r, region: g.region }));
    });
  }, [tickets, activeGroups, branchFilter, dateFrom, dateTo, agingBuckets]);

  const filtered = rows;

  const withLtp = filtered.filter((b) => b.dailyLTP !== null);
  const avgLTP = withLtp.length > 0 ? (withLtp.reduce((s, b) => s + (b.dailyLTP ?? 0), 0) / withLtp.length).toFixed(1) : "—";
  const totalAssigned = filtered.reduce((s, b) => s + b.assigned, 0);
  const totalCompleted = filtered.reduce((s, b) => s + b.completed, 0);
  const overallComp = totalAssigned > 0 ? ((totalCompleted / totalAssigned) * 100).toFixed(1) : "—";
  const totalNeedCancel = filtered.reduce((s, b) => s + b.needCancel, 0);
  const totalCancelled = filtered.reduce((s, b) => s + b.cancelled, 0);

  // Region-level rollup — only shown/used when this view spans multiple regions (Overview).
  const regionSummary = useMemo(() => {
    if (!multiRegion) return [];
    return regionGroups.map((g) => {
      const regionRows = filtered.filter((r) => r.region === g.region);
      const assigned = regionRows.reduce((s, r) => s + r.assigned, 0);
      const completed = regionRows.reduce((s, r) => s + r.completed, 0);
      const withL = regionRows.filter((r) => r.dailyLTP !== null);
      const avgL = withL.length > 0 ? withL.reduce((s, r) => s + (r.dailyLTP ?? 0), 0) / withL.length : null;
      return {
        region: g.region,
        locationCount: regionRows.length,
        assigned,
        completed,
        compPct: assigned > 0 ? (completed / assigned) * 100 : null,
        avgLTP: avgL !== null ? Math.round(avgL * 10) / 10 : null,
        needCancel: regionRows.reduce((s, r) => s + r.needCancel, 0),
        cancelled: regionRows.reduce((s, r) => s + r.cancelled, 0),
      };
    });
  }, [multiRegion, regionGroups, filtered]);

  // Company/region-wide cancellation-reason breakdown — aggregated across
  // every filtered location's reasonCounts (raw per-branch tallies), not a
  // re-parse of the formatted `reasons` string. Only CL-Cancelled tickets
  // carry a structured reason (see operationsBranchMetrics.ts); CL-Need
  // Cancel tickets are still awaiting BizOps review and have none yet.
  const reasonBreakdown = useMemo(() => {
    const totals = new Map<string, number>();
    for (const b of filtered) {
      for (const [reason, count] of Object.entries(b.reasonCounts)) {
        totals.set(reason, (totals.get(reason) ?? 0) + count);
      }
    }
    return Array.from(totals.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filtered]);

  const ltpChartData = filtered
    .filter((b) => b.dailyLTP !== null)
    .map((b) => ({
      name: multiRegion ? `${b.branch} (${b.region})` : b.branch,
      dailyLTP: b.dailyLTP as number,
      lateCount: b.lateCount,
      pendingCount: b.pendingCount,
    }))
    .sort((a, b) => b.dailyLTP - a.dailyLTP);
  const completionChartData = filtered
    .filter((b) => b.assigned > 0)
    .map((b) => ({ name: multiRegion ? `${b.branch} (${b.region})` : b.branch, assigned: b.assigned, completed: b.completed }))
    .sort((a, b) => b.assigned - a.assigned)
    .slice(0, 12);

  // Real day-by-day Assigned/Completed within the selected range — replaces
  // an earlier "LTP trend" chart that was silently flat (LTP is a live
  // open-ticket snapshot, not something with real historical daily values).
  const dailyChartData = useMemo(
    () => computeDailyCounts(tickets, branchFilter ? [branchFilter] : locationOptions, dateFrom, dateTo).map((d) => ({ ...d, date: fmtShort(d.date) })),
    [tickets, locationOptions, branchFilter, dateFrom, dateTo],
  );

  return (
    <div>
      <div className="panel mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
          </div>
          {multiRegion && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Region</label>
              <select value={regionFilter} onChange={(e) => { setRegionFilter(e.target.value); setBranchFilter(""); }} className="glass-input text-sm py-1.5 px-3 rounded-md">
                <option value="">All Regions</option>
                {regionGroups.map((g) => <option key={g.region} value={g.region}>{g.region}</option>)}
              </select>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Location</label>
            <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md">
              <option value="">All Locations</option>
              {locationOptions.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">LTP Aging (days)</label>
            <button
              ref={agingBtnRef}
              type="button"
              onClick={() => (agingMenuOpen ? setAgingMenuOpen(false) : openAgingMenu())}
              className="glass-input text-sm py-1.5 px-3 rounded-md text-left min-w-36"
              aria-haspopup="true"
              aria-expanded={agingMenuOpen}
            >
              {describeAgingBuckets(agingBuckets)}
            </button>
            {agingMenuOpen && agingMenuPos && createPortal(
              <>
                <div className="fixed inset-0 z-40" onClick={() => setAgingMenuOpen(false)} />
                <div
                  className="fixed z-50 w-40 rounded-lg border border-white/15 bg-slate-900 p-2 shadow-2xl"
                  style={{ top: agingMenuPos.top, left: agingMenuPos.left }}
                >
                  <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 cursor-pointer text-sm border-b border-white/10 mb-1">
                    <input type="checkbox" checked={allBucketsSelected} onChange={toggleSelectAllBuckets} />
                    <span className="text-slate-200 font-semibold">Select All</span>
                  </label>
                  <div className="max-h-56 overflow-y-auto">
                    {AGING_BUCKET_OPTIONS.map((n) => (
                      <label key={n} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 cursor-pointer text-sm">
                        <input type="checkbox" checked={agingBuckets.has(n)} onChange={() => toggleBucket(n)} />
                        <span className="text-slate-200">{bucketLabel(n)} {n >= LTP_AGING_MAX_BUCKET ? "days" : "day" + (n === 1 ? "" : "s")}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </>,
              document.body,
            )}
          </div>
          {(regionFilter || branchFilter) && (
            <button onClick={() => { setRegionFilter(""); setBranchFilter(""); }} className="btn text-sm px-3 mb-0.5">Clear</button>
          )}
          <button onClick={() => exportBranchRowsToXlsx(filtered, multiRegion, exportFilePrefix)} className="btn text-sm px-3 mb-0.5 flex items-center gap-1.5">
            <Download className="h-3.5 w-3.5" /> Download XLSX
          </button>
          <span className="text-sm text-muted-foreground mb-0.5">{filtered.length} of {allLocations.length} locations</span>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Assigned/Completed/Staff/AM Reschedules and Daily LTP are scoped to Date From–To. Need Cancel/Cancelled reflect current ticket state (not date-scoped — a cancellation stays open until resolved).
          Daily LTP = tickets entered Date From–To that are still open and aged {describeAgingBuckets(agingBuckets).toLowerCase()} ÷ all tickets entered Date From–To that are still open. Monthly LTP = same aged-and-still-open tickets among those entered since day 1 of the month ÷ every ticket entered this month (any status).
        </p>
      </div>

      {!multiRegion && (
        <div className="flex gap-2 mb-6">
          {(["ltp", "operations"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setSubTab(t)}
              className={`text-sm font-semibold px-4 py-1.5 rounded-md ${
                subTab === t ? "bg-blue-500/20 text-blue-300 border border-blue-500/40" : "text-muted-foreground hover:bg-white/5 border border-transparent"
              }`}
            >
              {t === "ltp" ? "LTP" : "Operations"}
            </button>
          ))}
        </div>
      )}

      {multiRegion && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          {regionSummary.map((r) => (
            <div key={r.region} className="panel p-4">
              <p className="text-sm font-semibold mb-3">{r.region} <span className="text-xs font-normal text-muted-foreground">({r.locationCount} locations)</span></p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div><p className="text-lg font-bold text-blue-300">{r.avgLTP !== null ? `${r.avgLTP}%` : "—"}</p><p className="text-[9px] text-muted-foreground uppercase">Avg LTP</p></div>
                <div><p className="text-lg font-bold">{r.assigned}</p><p className="text-[9px] text-muted-foreground uppercase">Assigned</p></div>
                <div><p className="text-lg font-bold text-green-400">{r.completed}</p><p className="text-[9px] text-muted-foreground uppercase">Completed</p></div>
                <div><p className="text-lg font-bold text-yellow-300">{r.compPct !== null ? `${r.compPct.toFixed(1)}%` : "—"}</p><p className="text-[9px] text-muted-foreground uppercase">Comp%</p></div>
                <div><p className="text-lg font-bold text-orange-300">{r.needCancel}</p><p className="text-[9px] text-muted-foreground uppercase">Need Cancel</p></div>
                <div><p className="text-lg font-bold text-red-300">{r.cancelled}</p><p className="text-[9px] text-muted-foreground uppercase">Cancelled</p></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {multiRegion ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          {[
            ["Avg Daily LTP", `${avgLTP}%`, "text-blue-300"],
            ["Total Assigned", totalAssigned, "text-foreground"],
            ["Total Completed", totalCompleted, "text-green-300"],
            ["Overall Comp%", `${overallComp}%`, "text-yellow-300"],
            ["Need Cancel", totalNeedCancel, "text-orange-300"],
            ["Cancelled", totalCancelled, "text-red-300"],
          ].map(([l, v, c]) => (
            <div key={l as string} className="panel p-4 text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{l}</p>
              <p className={`text-2xl font-bold ${c}`}>{v}</p>
            </div>
          ))}
        </div>
      ) : (
        <>
          {showLtpSection && (
            <div className="panel p-4 text-center w-48 mb-6">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Avg Daily LTP</p>
              <p className="text-2xl font-bold text-blue-300">{avgLTP}%</p>
            </div>
          )}
          {showOpsSection && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
              {[
                ["Total Assigned", totalAssigned, "text-foreground"],
                ["Total Completed", totalCompleted, "text-green-300"],
                ["Overall Comp%", `${overallComp}%`, "text-yellow-300"],
                ["Need Cancel", totalNeedCancel, "text-orange-300"],
                ["Cancelled", totalCancelled, "text-red-300"],
              ].map(([l, v, c]) => (
                <div key={l as string} className="panel p-4 text-center">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{l}</p>
                  <p className={`text-2xl font-bold ${c}`}>{v}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {showLtpSection && ltpChartData.length > 0 && (
        <div className="panel p-4 mb-4">
          <p className="text-sm font-semibold mb-1">
            Daily LTP % by Location <span className="text-xs font-normal text-muted-foreground ml-2">🟢 ≥50%  🟡 40–49%  🔴 &lt;40%</span>
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={ltpChartData} margin={{ left: -10 }}>
              <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 9 }} angle={-25} textAnchor="end" height={55} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(_: any, name: any, props: any) => [`${props.payload.lateCount} of ${props.payload.pendingCount} tickets`, name]}
              />
              <ReferenceLine y={50} stroke="#34d399" strokeDasharray="4 2" label={{ value: "50%", fill: "#34d399", fontSize: 10 }} />
              <ReferenceLine y={40} stroke="#facc15" strokeDasharray="4 2" label={{ value: "40%", fill: "#facc15", fontSize: 10 }} />
              <Bar dataKey="dailyLTP" radius={[4, 4, 0, 0]} name="Daily LTP" minPointSize={3}>
                {ltpChartData.map((entry, i) => <Cell key={i} fill={ltpColor(entry.dailyLTP)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {showLtpSection && (
        <div className="panel overflow-x-auto p-0 mb-4">
          <div className="px-4 py-3 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-sm">Daily LTP Breakdown</span>
              <select value={ltpMonth} onChange={(e) => setLtpMonth(e.target.value)} className="glass-input text-sm py-1 px-2 rounded-md">
                {LTP_MONTHS.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
            </div>
            <button
              onClick={() => exportDailyLtpToXlsx(dailyLtpRows, describeAgingBuckets(agingBuckets), ltpMonth, exportFilePrefix)}
              className="btn text-sm px-3 flex items-center gap-1.5"
            >
              <Download className="h-3.5 w-3.5" /> Download XLSX
            </button>
          </div>
          <p className="px-4 pt-2 text-[10px] text-muted-foreground">
            Grouped by the day each ticket was created; {describeAgingBuckets(agingBuckets)} and Pending reflect current status, not a historical snapshot — this system doesn't store day-by-day ticket history.
          </p>
          <table className="w-full text-sm mt-2">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-3 py-3 text-left text-xs text-muted-foreground uppercase whitespace-nowrap">Date</th>
                <th className="px-3 py-3 text-center text-xs text-muted-foreground uppercase whitespace-nowrap">{describeAgingBuckets(agingBuckets)}</th>
                <th className="px-3 py-3 text-center text-xs text-muted-foreground uppercase whitespace-nowrap">Pending</th>
                <th className="px-3 py-3 text-left text-xs text-muted-foreground uppercase whitespace-nowrap">Locations</th>
                <th className="px-3 py-3 text-center text-xs text-muted-foreground uppercase whitespace-nowrap">Month Total</th>
                <th className="px-3 py-3 text-center text-xs text-muted-foreground uppercase whitespace-nowrap">%LTP</th>
              </tr>
            </thead>
            <tbody>
              {dailyLtpRows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">No data for this month.</td></tr>
              ) : dailyLtpRows.map((r, i) => (
                <tr key={r.date} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                  <td className="px-3 py-2 whitespace-nowrap">{dailyDateLabel(r.date)}</td>
                  <td className={TD}>{r.lateCount || "—"}</td>
                  <td className={TD}>{r.pendingCount || "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground max-w-70 truncate" title={r.locations}>{r.locations || "—"}</td>
                  <td className={TD}>{r.monthTotalPending || "—"}</td>
                  <td className={`${TD} font-semibold ${r.ltpPct === null ? "" : r.ltpPct >= 50 ? "text-green-400" : r.ltpPct >= 40 ? "text-yellow-400" : "text-red-400"}`}>
                    {r.ltpPct !== null ? `${r.ltpPct}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            {dailyLtpRows.length > 0 && (
              <tfoot>
                <tr className="border-t border-white/10 bg-white/5 font-semibold">
                  <td className="px-3 py-2">Total</td>
                  <td className={TD}>{dailyLtpTotals.late}</td>
                  <td className={TD}>{dailyLtpTotals.pending}</td>
                  <td className="px-3 py-2"></td>
                  <td className={TD}>{dailyLtpTotals.monthTotal}</td>
                  <td className={TD}>{dailyLtpTotals.ltpPct !== null ? `${dailyLtpTotals.ltpPct}%` : "—"}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {showOpsSection && (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {completionChartData.length > 0 && (
          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Assigned vs Completed by Location</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={completionChartData} margin={{ left: -10 }}>
                <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 9 }} angle={-20} textAnchor="end" height={50} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={LEGEND_STYLE} />
                <Bar dataKey="assigned" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Assigned" />
                <Bar dataKey="completed" fill="#34d399" radius={[4, 4, 0, 0]} name="Completed" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="panel p-4">
          <p className="text-sm font-semibold mb-4">Assigned vs Completed — Daily</p>
          {dailyChartData.length === 0 ? (
            <p className="text-xs text-muted-foreground py-16 text-center">No tickets scheduled in this date range.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={dailyChartData} margin={{ left: -10 }}>
                <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={LEGEND_STYLE} />
                <Bar dataKey="assigned" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Assigned" />
                <Bar dataKey="completed" fill="#34d399" radius={[4, 4, 0, 0]} name="Completed" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
      )}

      {showOpsSection && reasonBreakdown.length > 0 && (
        <div className="panel p-4 mb-4">
          <p className="text-sm font-semibold mb-1">Cancellation Reasons {multiRegion ? "— All Regions" : ""}</p>
          <p className="text-[10px] text-muted-foreground mb-4">Structured reasons recorded when BizOps confirmed a CL-Cancelled ticket, tallied across {filtered.length} location{filtered.length === 1 ? "" : "s"}.</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={reasonBreakdown} margin={{ left: -10 }}>
              <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 9 }} angle={-25} textAnchor="end" height={70} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="value" fill="#f87171" radius={[4, 4, 0, 0]} name="Cancelled" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {showOpsSection && (
      <div className="panel overflow-x-auto p-0">
        <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex justify-between">
          <span>Location Detail</span>
          <span className="text-xs text-muted-foreground">{filtered.length} locations</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              <th className="px-3 py-3 text-left text-xs text-muted-foreground uppercase whitespace-nowrap">Location</th>
              {multiRegion && <th className="px-3 py-3 text-center text-xs text-muted-foreground uppercase whitespace-nowrap">Region</th>}
              {["Daily LTP%", "Monthly LTP%", "Assigned", "Completed", "Comp%", "Staff", "AM Reschedules", "Need Cancel", "Cancelled", "Reasons"].map((h) => (
                <th key={h} className="px-3 py-3 text-center text-xs text-muted-foreground uppercase whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={multiRegion ? 12 : 11} className="px-4 py-12 text-center text-muted-foreground">No data for this date range or filter.</td></tr>
            ) : filtered.map((b, i) => {
              const ltp = b.dailyLTP;
              const ltpCls = ltp === null ? "" : ltp >= 50 ? "text-green-400" : ltp >= 40 ? "text-yellow-400" : "text-red-400";
              return (
                <tr key={`${b.region}-${b.branch}`} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                  <td className="px-3 py-2.5 font-medium whitespace-nowrap">{b.branch}</td>
                  {multiRegion && <td className={`${TD} text-muted-foreground`}>{b.region}</td>}
                  <td className={`${TD} font-semibold ${ltpCls}`} title={`${b.lateCount} of ${b.pendingCount} pending tickets`}>{ltp !== null ? `${ltp}%` : "—"}</td>
                  <td className={`${TD} text-muted-foreground`} title={`${b.monthlyLateCount} of ${b.monthlyTotalCount} tickets entered this month`}>{b.monthlyLTP !== null ? `${b.monthlyLTP}%` : "—"}</td>
                  <td className={TD}>{b.assigned || "—"}</td>
                  <td className={`${TD} text-green-400`}>{b.completed || "—"}</td>
                  <td className={TD}>{b.compPct !== null ? `${b.compPct}%` : "—"}</td>
                  <td className={TD}>{b.staff || "—"}</td>
                  <td className={`${TD} text-orange-400`}>{b.amReschedule || "—"}</td>
                  <td className={`${TD} ${b.needCancel > 0 ? "text-orange-300 font-semibold" : ""}`}>{b.needCancel || "—"}</td>
                  <td className={`${TD} ${b.cancelled > 0 ? "text-red-300 font-semibold" : ""}`}>{b.cancelled || "—"}</td>
                  <td className="px-3 py-2.5 text-center text-xs text-muted-foreground max-w-[220px] truncate" title={b.reasons}>{b.reasons || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
