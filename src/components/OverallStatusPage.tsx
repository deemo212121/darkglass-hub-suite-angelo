import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Printer, Download, Search, X } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  loadOverallStatusData,
  EMPTY_OVERALL_STATUS,
  type OverallStatusData,
  type RankingRow,
  type DonutSlice,
} from "@/lib/overallStatusData";

/**
 * Overall Status dashboard. Layout mirrors janeyyy16/usapp's OverallStatusPage
 * (filters → line chart → 3 donuts → 2 ranking tables) but every number is
 * computed live from the company's tickets via `loadOverallStatusData`.
 */

// Custom Tooltip for the Ticket Statistics chart. The default Recharts
// tooltip lists every active line (TOTAL + every ticket source) regardless
// of whether that source had any tickets on the hovered date/month — with
// ~10 sources that renders a tooltip taller than the 190px chart, which then
// visually floats over the donut cards below it. Filtering to only the
// nonzero entries keeps it to the handful of sources actually active on
// that point; maxHeight+scroll is a safety net for the rare day/month where
// most sources are active at once.
function StatTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const nonZero = payload.filter((p: any) => Number(p.value) > 0);
  return (
    <div
      style={{
        background: "rgba(15,23,42,0.95)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 8,
        color: "#fff",
        padding: "8px 10px",
        fontSize: 11,
        maxHeight: 200,
        overflowY: "auto",
      }}
    >
      <p style={{ fontWeight: 600, marginBottom: 4 }}>{label}</p>
      {nonZero.length === 0 ? (
        <p style={{ color: "#94a3b8" }}>No activity.</p>
      ) : (
        nonZero.map((p: any) => (
          <p key={p.dataKey} style={{ color: p.color, margin: "2px 0" }}>
            {p.name}: {p.value}
          </p>
        ))
      )}
    </div>
  );
}

function Donut({ data, title }: { data: DonutSlice[]; title: string }) {
  if (!data || data.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-2">
        <p className="mb-0.5 text-center text-sm font-semibold">{title}</p>
        <p className="text-center text-xs text-slate-400 py-5">No data yet.</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-2">
      <p className="mb-0.5 text-center text-sm font-semibold">{title}</p>
      <ResponsiveContainer width="100%" height={170} debounce={200}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={36}
            outerRadius={64}
            paddingAngle={1}
            label={(entry: any) => `${entry.value}`}
            labelLine={false}
          >
            {data.map((d, i) => (
              <Cell key={i} fill={d.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ background: "rgba(15,23,42,0.95)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#fff" }}
            itemStyle={{ color: "#fff" }}
            labelStyle={{ color: "#fff" }}
            formatter={(value: any, name: any) => [value, name]}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="mt-1 flex flex-wrap justify-center gap-x-1.5 gap-y-0.5 text-[9px] text-slate-400">
        {data.slice(0, 30).map((d, i) => (
          <span key={i} className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: d.color }} />
            {d.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function RankingTable({ title, rows, label, locationFilter }: { title: string; rows: RankingRow[]; label: string; locationFilter: string }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"rank" | "assigned" | "completed" | "cancelled" | "completionRate">("rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [drillDown, setDrillDown] = useState<RankingRow | null>(null);

  // Calendar filter local to this panel only — narrows each tech's
  // Assigned/Completed/Cancelled/Completion Rate to tickets posted within
  // [dateFrom, dateTo], recomputed client-side from the per-ticket dates
  // already carried on each row (completedTickets/cancelledTickets/
  // openTickets). Independent of the page-level Date filter above.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const dateFilteredRows = useMemo(() => {
    if (!dateFrom && !dateTo) return rows;
    const inRange = (created: string) => {
      if (!created) return false;
      if (dateFrom && created < dateFrom) return false;
      if (dateTo && created > dateTo) return false;
      return true;
    };
    return rows
      .map((row) => {
        const completedTickets = row.completedTickets.filter((t) => inRange(t.created));
        const cancelledTickets = row.cancelledTickets.filter((t) => inRange(t.created));
        const openTickets = row.openTickets.filter((t) => inRange(t.created));
        const completed = completedTickets.length;
        const cancelled = cancelledTickets.length;
        const assigned = completed + cancelled + openTickets.length;
        const denom = assigned - cancelled;
        const reasonCounts = new Map<string, number>();
        for (const t of cancelledTickets) {
          const reason = (t.reason || "").trim();
          if (reason && reason !== "—") reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
        }
        const cancellationReasons = Array.from(reasonCounts.entries())
          .sort(([, a], [, b]) => b - a)
          .map(([reason, count]) => `${reason} (${count})`)
          .join(", ");
        return {
          ...row,
          assigned,
          completed,
          cancelled,
          cancellationReasons,
          completionRate: denom > 0 ? Math.round((completed / denom) * 10000) / 100 : null,
          completedTickets,
          cancelledTickets,
          openTickets,
        };
      })
      .filter((row) => row.assigned > 0)
      .sort((a, b) => (b.completionRate ?? -1) - (a.completionRate ?? -1))
      .map((row, i) => ({ ...row, rank: i + 1 }));
  }, [rows, dateFrom, dateTo]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let r = dateFilteredRows.filter((row) => {
      if (locationFilter !== "ALL" && row.office !== locationFilter) return false;
      if (!q) return true;
      return row.name.toLowerCase().includes(q) || row.office.toLowerCase().includes(q);
    });
    r = [...r].sort((a, b) => {
      const av = a[sortKey] ?? -1;
      const bv = b[sortKey] ?? -1;
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return r;
  }, [dateFilteredRows, search, sortKey, sortDir, locationFilter]);

  const toggleSort = (key: "rank" | "assigned" | "completed" | "cancelled" | "completionRate") => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "rank" ? "asc" : "desc"); }
  };
  const arrow = (key: typeof sortKey) => (sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "");

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-2 mb-2">
      <div className="mb-1.5 flex flex-col gap-1.5 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-[10px] text-slate-400">{filtered.length} records out of {dateFilteredRows.length} found</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-md border border-white/15 bg-slate-950 px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
            />
            <span className="text-xs text-slate-400">~</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-md border border-white/15 bg-slate-950 px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
            />
            {(dateFrom || dateTo) && (
              <button
                type="button"
                title="Clear date filter"
                onClick={() => { setDateFrom(""); setDateTo(""); }}
                className="rounded-md border border-white/15 bg-slate-800/70 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <button className="rounded-md border border-white/15 bg-slate-800/70 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700" title="Print" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5" />
          </button>
          <button className="rounded-md border border-white/15 bg-slate-800/70 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700" title="Export CSV" onClick={() => exportCsv(title, filtered, label)}>
            <Download className="h-3.5 w-3.5" />
          </button>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="search in result"
              className="rounded-md border border-white/15 bg-slate-950 pl-7 pr-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </div>
      <div className="overflow-x-auto border border-white/10 rounded-lg">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-blue-900/50 border-b border-blue-500/30">
              <th className="px-2 py-1 text-left font-semibold text-blue-300 cursor-pointer" onClick={() => toggleSort("rank")}>Rank{arrow("rank")}</th>
              <th className="px-2 py-1 text-left font-semibold text-blue-300">{label}</th>
              <th className="px-2 py-1 text-left font-semibold text-blue-300">Office</th>
              <th className="px-2 py-1 text-right font-semibold text-blue-300 cursor-pointer" onClick={() => toggleSort("assigned")}>Number of Tickets Assigned{arrow("assigned")}</th>
              <th className="px-2 py-1 text-right font-semibold text-blue-300 cursor-pointer" onClick={() => toggleSort("completed")}>Completed{arrow("completed")}</th>
              <th className="px-2 py-1 text-right font-semibold text-blue-300 cursor-pointer" onClick={() => toggleSort("cancelled")}>Cancelled{arrow("cancelled")}</th>
              <th className="px-2 py-1 text-left font-semibold text-blue-300">Reason of Cancellation</th>
              <th className="px-2 py-1 text-right font-semibold text-blue-300 cursor-pointer" onClick={() => toggleSort("completionRate")}>Completion Rate{arrow("completionRate")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-2 py-3 text-center text-slate-500">No records.</td>
              </tr>
            ) : (
              filtered.map((row) => (
                <tr
                  key={`${row.rank}-${row.name}-${row.office}`}
                  className="border-b border-white/5 hover:bg-white/5 cursor-pointer"
                  onClick={() => setDrillDown(row)}
                  title="Click for a ticket-by-ticket breakdown"
                >
                  <td className="px-2 py-1 text-slate-400">{row.rank}</td>
                  <td className="px-2 py-1 text-slate-200 font-medium">{row.name}</td>
                  <td className="px-2 py-1 text-slate-300">{row.office}</td>
                  <td className="px-2 py-1 text-right text-slate-200">{row.assigned}</td>
                  <td className="px-2 py-1 text-right text-emerald-300">{row.completed}</td>
                  <td className="px-2 py-1 text-right text-rose-300">{row.cancelled}</td>
                  <td className="px-2 py-1 text-slate-400 max-w-55 truncate" title={row.cancellationReasons}>{row.cancellationReasons || "—"}</td>
                  <td className="px-2 py-1 text-right text-sky-300 font-semibold underline decoration-dotted">{row.completionRate != null ? `${row.completionRate.toFixed(2)}%` : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {drillDown && (
        <TicketBreakdownModal
          row={drillDown}
          onClose={() => setDrillDown(null)}
          scopeLabel={dateFrom || dateTo ? "in the selected date range" : "all-time"}
        />
      )}
    </section>
  );
}

function TicketBreakdownModal({ row, onClose, scopeLabel }: { row: RankingRow; onClose: () => void; scopeLabel: string }) {
  const sections: { label: string; color: string; tickets: (typeof row.completedTickets[number] & { reason?: string })[] }[] = [
    { label: `Completed (${row.completed})`, color: "text-emerald-300", tickets: row.completedTickets },
    { label: `Cancelled (${row.cancelled})`, color: "text-rose-300", tickets: row.cancelledTickets },
    { label: `Still Open (${row.openTickets.length})`, color: "text-amber-300", tickets: row.openTickets },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-white/10 bg-slate-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-white">{row.name}</h3>
            <p className="text-xs text-slate-400">{row.office} — {row.assigned} tickets assigned {scopeLabel}, {row.completionRate != null ? `${row.completionRate.toFixed(2)}%` : "—"} completion rate</p>
          </div>
          <button className="rounded-md border border-white/15 bg-slate-800/70 p-1.5 text-slate-300 hover:bg-slate-700" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {sections.map((section) => (
          <div key={section.label} className="mb-4">
            <p className={`mb-1.5 text-sm font-semibold ${section.color}`}>{section.label}</p>
            {section.tickets.length === 0 ? (
              <p className="text-xs text-slate-500 py-1">None.</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-white/10">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-white/5 border-b border-white/10">
                      <th className="px-2 py-1.5 text-left font-semibold text-slate-400">Ticket No</th>
                      <th className="px-2 py-1.5 text-left font-semibold text-slate-400">Customer</th>
                      <th className="px-2 py-1.5 text-left font-semibold text-slate-400">Status</th>
                      <th className="px-2 py-1.5 text-left font-semibold text-slate-400">Posted</th>
                      {section.tickets.some((t) => "reason" in t) && (
                        <th className="px-2 py-1.5 text-left font-semibold text-slate-400">Reason</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {section.tickets.map((t) => (
                      <tr key={t.ticketNo} className="border-b border-white/5 last:border-0 hover:bg-white/5">
                        <td className="px-2 py-1.5">
                          <Link to="/ticket/$ticketNo" params={{ ticketNo: t.ticketNo }} className="font-mono text-blue-400 hover:underline">
                            {t.ticketNo}
                          </Link>
                        </td>
                        <td className="px-2 py-1.5 text-slate-300">{t.customer || "—"}</td>
                        <td className="px-2 py-1.5 text-slate-300">{t.status}</td>
                        <td className="px-2 py-1.5 text-slate-400">{t.created || "—"}</td>
                        {section.tickets.some((tt) => "reason" in tt) && (
                          <td className="px-2 py-1.5 text-slate-400">{"reason" in t ? t.reason : "—"}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function exportCsv(title: string, rows: RankingRow[], label: string) {
  const header = ["Rank", label, "Office", "Number of Tickets Assigned", "Completed", "Cancelled", "Reason of Cancellation", "Completion Rate"];
  const body = rows.map((r) => [r.rank, r.name, r.office, r.assigned, r.completed, r.cancelled, r.cancellationReasons, r.completionRate ?? ""]);
  const csv = [header, ...body].map((line) => line.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.toLowerCase().replace(/\s+/g, "-")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function OverallStatusPage({ mod, companyId }: { mod: ModuleDef; sub: SubModuleDef; companyId: string | null; }) {
  const [data, setData] = useState<OverallStatusData>(EMPTY_OVERALL_STATUS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statType, setStatType] = useState<"monthly" | "daily">("monthly");
  const [location, setLocation] = useState("ALL");

  // Default date range: last 30 days.
  const today = new Date();
  const thirtyAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const isoDay = (d: Date) => d.toISOString().slice(0, 10);
  const DEFAULT_START = isoDay(thirtyAgo);
  const DEFAULT_END = isoDay(today);
  const [startDate, setStartDate] = useState<string>(DEFAULT_START);
  const [endDate, setEndDate] = useState<string>(DEFAULT_END);

  const clearFilters = () => {
    setLocation("ALL");
    setStartDate(DEFAULT_START);
    setEndDate(DEFAULT_END);
  };

  // Refetch automatically whenever the date range changes — no explicit
  // "Refresh" click needed. Location is filtered client-side (see
  // filteredByLocation below) so it doesn't need a refetch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const next = await loadOverallStatusData({ startDate, endDate });
        if (!cancelled) setData(next);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load overall status data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [startDate, endDate]);

  const statData = statType === "monthly" ? data.monthlyStats : data.dailyStats;
  // Show every line on both monthly and daily — sources come straight from
  // the data so any source present in tickets gets a line on the chart.
  const activeLines = data.statLines;

  // Apply the location filter to the donuts that are location-scoped.
  const filteredByLocation = useMemo(() => {
    if (location === "ALL") return data.pendingByLocation;
    return data.pendingByLocation.filter((d) => d.name === location);
  }, [data.pendingByLocation, location]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-white">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-4 py-3">
        <div className="flex items-center gap-3 mb-2">
          <Link to="/m/$module" params={{ module: mod.slug }} className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-slate-800/70 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700">
            <ChevronLeft className="h-3.5 w-3.5" /> {mod.label}
          </Link>
        </div>

        <div className="mb-2 text-center">
          <h1 className="text-lg font-bold underline">Overall Status</h1>
          {companyId && <p className="mt-0.5 text-[10px] text-slate-400">Company {companyId}</p>}
        </div>

        {/* Filters */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-2 mb-2">
          <div className="flex flex-wrap items-end justify-end gap-2">
            <div>
              <label className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Location</label>
              <select
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="mt-0.5 w-40 rounded-md border border-white/15 bg-slate-950 px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
              >
                {data.allLocationsFilter.map((loc) => <option key={loc} value={loc}>{loc}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-0.5 rounded-md border border-white/15 bg-slate-950 px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <span className="pb-1.5 text-slate-400 text-xs">~</span>
            <div>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-0.5 rounded-md border border-white/15 bg-slate-950 px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <button
              type="button"
              onClick={clearFilters}
              disabled={loading}
              className="rounded-md border border-white/15 bg-slate-800/70 px-3 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
            >
              {loading ? "Loading…" : "Clear Filter"}
            </button>
          </div>
          {error && (
            <p className="mt-2 text-xs text-rose-400">Error: {error}</p>
          )}
        </div>

        {/* Ticket Statistics line chart */}
        <section className="rounded-xl border border-white/10 bg-white/5 p-2 mb-2">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Ticket Statistics ({statType === "monthly" ? "Monthly" : "Daily"})</h2>
            <div className="flex gap-1.5">
              <button
                className={`rounded-md px-2 py-0.5 text-xs font-semibold border ${statType === "monthly" ? "border-blue-400/40 bg-blue-600/30 text-blue-200" : "border-white/15 bg-slate-800/70 text-slate-300 hover:bg-slate-700"}`}
                onClick={() => setStatType("monthly")}
              >
                Monthly
              </button>
              <button
                className={`rounded-md px-2 py-0.5 text-xs font-semibold border ${statType === "daily" ? "border-blue-400/40 bg-blue-600/30 text-blue-200" : "border-white/15 bg-slate-800/70 text-slate-300 hover:bg-slate-700"}`}
                onClick={() => setStatType("daily")}
              >
                Daily
              </button>
            </div>
          </div>
          {statData.length === 0 ? (
            <p className="text-xs text-slate-400 py-5 text-center">No ticket activity recorded for this range.</p>
          ) : (
            <ResponsiveContainer width="100%" height={190} debounce={200}>
              <LineChart data={statData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#cbd5e1" }} />
                <YAxis tick={{ fontSize: 10, fill: "#cbd5e1" }} />
                <Tooltip content={<StatTooltip />} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {activeLines.map((line) => (
                  <Line key={line.key} type="monotone" dataKey={line.key} stroke={line.color} strokeWidth={line.key === "TOTAL" ? 3 : 1.5} dot={{ r: 2 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </section>

        {/* Three donuts */}
        <section className="grid gap-2 mb-2 sm:grid-cols-2 xl:grid-cols-3">
          <Donut data={data.pendingByStatus} title="Pending Tickets by Status" />
          <Donut data={filteredByLocation} title="Pending Tickets by Location" />
          <Donut data={data.csrActivity} title="CSR Activity" />
        </section>

        {/* Ranking table */}
        <RankingTable title="Tech Completion Rate" rows={data.techRanking} label="Tech Name" locationFilter={location} />

        <p className="text-[10px] text-slate-500 italic mb-2">
          All numbers above are computed live from the <code className="text-slate-300">tickets</code> table (company-scoped via RLS). Date pickers and filters narrow the visible records; pull "Refresh" to re-query.
        </p>
      </main>
    </div>
  );
}
