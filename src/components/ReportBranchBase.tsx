import { useState, useMemo } from "react";
import * as XLSX from "xlsx";
import { Download } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend, ReferenceLine } from "recharts";
import { computeBranchRows, computeDailyCounts, type BranchRow } from "@/lib/operationsBranchMetrics";
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

/** Export the rows currently on screen (whatever filters are active) as a real .xlsx workbook. */
function exportBranchRowsToXlsx(rows: BranchRowWithRegion[], multiRegion: boolean, filePrefix: string) {
  const data = rows.map((r) => ({
    ...(multiRegion ? { Region: r.region } : {}),
    Location: r.branch,
    "Daily LTP%": r.dailyLTP ?? "",
    "Monthly LTP%": r.monthlyLTP ?? "",
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

export function ReportBranchBase({ tickets, regionGroups, exportFilePrefix }: Props) {
  const multiRegion = regionGroups.length > 1;
  const allLocations = useMemo(() => regionGroups.flatMap((g) => g.locations), [regionGroups]);

  const [dateFrom, setDateFrom] = useState(daysAgoIso(29));
  const [dateTo, setDateTo] = useState(todayIso());
  const [regionFilter, setRegionFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [ltpThreshold, setLtpThreshold] = useState("");
  const [ltpAgingDays, setLtpAgingDays] = useState(14);

  const activeGroups = regionFilter ? regionGroups.filter((g) => g.region === regionFilter) : regionGroups;
  const locationOptions = regionFilter ? (regionGroups.find((g) => g.region === regionFilter)?.locations ?? []) : allLocations;

  const rows: BranchRowWithRegion[] = useMemo(() => {
    return activeGroups.flatMap((g) => {
      const locs = branchFilter ? [branchFilter] : g.locations;
      return computeBranchRows(tickets, locs, dateFrom, dateTo, ltpAgingDays).map((r) => ({ ...r, region: g.region }));
    });
  }, [tickets, activeGroups, branchFilter, dateFrom, dateTo, ltpAgingDays]);

  const filtered = useMemo(() => {
    let r = rows;
    if (ltpThreshold === "below40") r = r.filter((b) => b.dailyLTP !== null && b.dailyLTP < 40);
    if (ltpThreshold === "below50") r = r.filter((b) => b.dailyLTP !== null && b.dailyLTP < 50);
    if (ltpThreshold === "above50") r = r.filter((b) => b.dailyLTP !== null && b.dailyLTP >= 50);
    return r;
  }, [rows, ltpThreshold]);

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

  const ltpChartData = filtered
    .filter((b) => b.dailyLTP !== null)
    .map((b) => ({ name: multiRegion ? `${b.branch} (${b.region})` : b.branch, dailyLTP: b.dailyLTP as number }))
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
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">LTP Filter</label>
            <select value={ltpThreshold} onChange={(e) => setLtpThreshold(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md">
              <option value="">All LTP</option>
              <option value="below40">Below 40%</option>
              <option value="below50">Below 50%</option>
              <option value="above50">50% and Above</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">LTP Aging (days)</label>
            <input
              type="number"
              min={1}
              value={ltpAgingDays}
              onChange={(e) => setLtpAgingDays(Math.max(1, Number(e.target.value) || 1))}
              className="glass-input text-sm py-1.5 px-3 rounded-md w-24"
            />
          </div>
          {(regionFilter || branchFilter || ltpThreshold) && (
            <button onClick={() => { setRegionFilter(""); setBranchFilter(""); setLtpThreshold(""); }} className="btn text-sm px-3 mb-0.5">Clear</button>
          )}
          <button onClick={() => exportBranchRowsToXlsx(filtered, multiRegion, exportFilePrefix)} className="btn text-sm px-3 mb-0.5 flex items-center gap-1.5">
            <Download className="h-3.5 w-3.5" /> Download XLSX
          </button>
          <span className="text-sm text-muted-foreground mb-0.5">{filtered.length} of {allLocations.length} locations</span>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Assigned/Completed/Staff/AM Reschedules are scoped to Date From–To. LTP% and Need Cancel/Cancelled reflect current ticket state (not date-scoped — a cancellation stays open until resolved).
        </p>
      </div>

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

      {ltpChartData.length > 0 && (
        <div className="panel p-4 mb-4">
          <p className="text-sm font-semibold mb-1">
            Daily LTP % by Location <span className="text-xs font-normal text-muted-foreground ml-2">🟢 ≥50%  🟡 40–49%  🔴 &lt;40%</span>
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={ltpChartData} margin={{ left: -10 }}>
              <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 9 }} angle={-25} textAnchor="end" height={55} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => `${v}%`} />
              <ReferenceLine y={50} stroke="#34d399" strokeDasharray="4 2" label={{ value: "50%", fill: "#34d399", fontSize: 10 }} />
              <ReferenceLine y={40} stroke="#facc15" strokeDasharray="4 2" label={{ value: "40%", fill: "#facc15", fontSize: 10 }} />
              <Bar dataKey="dailyLTP" radius={[4, 4, 0, 0]} name="Daily LTP">
                {ltpChartData.map((entry, i) => <Cell key={i} fill={ltpColor(entry.dailyLTP)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

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
                  <td className={`${TD} font-semibold ${ltpCls}`}>{ltp !== null ? `${ltp}%` : "—"}</td>
                  <td className={`${TD} text-muted-foreground`}>{b.monthlyLTP !== null ? `${b.monthlyLTP}%` : "—"}</td>
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
    </div>
  );
}
