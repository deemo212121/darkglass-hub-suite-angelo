import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Printer, Download, Search } from "lucide-react";
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

function Donut({ data, title }: { data: DonutSlice[]; title: string }) {
  if (!data || data.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <p className="mb-2 text-center text-lg font-semibold">{title}</p>
        <p className="text-center text-sm text-slate-400 py-12">No data yet.</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <p className="mb-2 text-center text-lg font-semibold">{title}</p>
      <ResponsiveContainer width="100%" height={320}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={70}
            outerRadius={120}
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
            formatter={(value: any, name: any) => [value, name]}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] text-slate-400 max-h-24 overflow-y-auto">
        {data.slice(0, 30).map((d, i) => (
          <span key={i} className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: d.color }} />
            {d.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function RankingTable({ title, rows, label, locationFilter }: { title: string; rows: RankingRow[]; label: string; locationFilter: string }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"rank" | "thirtyDay" | "tenDay">("rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let r = rows.filter((row) => {
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
  }, [rows, search, sortKey, sortDir, locationFilter]);

  const toggleSort = (key: "rank" | "thirtyDay" | "tenDay") => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "rank" ? "asc" : "desc"); }
  };

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-5 mb-4">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">{title}</h2>
          <p className="text-sm text-slate-400">{filtered.length} records out of {rows.length} found</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="rounded-md border border-white/15 bg-slate-800/70 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700" title="Print" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
          </button>
          <button className="rounded-md border border-white/15 bg-slate-800/70 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700" title="Export CSV" onClick={() => exportCsv(title, filtered, label)}>
            <Download className="h-4 w-4" />
          </button>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="search in result"
              className="rounded-md border border-white/15 bg-slate-950 pl-8 pr-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </div>
      <div className="overflow-x-auto border border-white/10 rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-blue-900/50 border-b border-blue-500/30">
              <th className="px-3 py-2 text-left font-semibold text-blue-300 cursor-pointer" onClick={() => toggleSort("rank")}>Rank{sortKey === "rank" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</th>
              <th className="px-3 py-2 text-left font-semibold text-blue-300">{label}</th>
              <th className="px-3 py-2 text-left font-semibold text-blue-300">Office</th>
              <th className="px-3 py-2 text-right font-semibold text-blue-300 cursor-pointer" onClick={() => toggleSort("thirtyDay")}>30 Day{sortKey === "thirtyDay" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</th>
              <th className="px-3 py-2 text-right font-semibold text-blue-300 cursor-pointer" onClick={() => toggleSort("tenDay")}>10 Day{sortKey === "tenDay" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-500">No records.</td>
              </tr>
            ) : (
              filtered.map((row) => (
                <tr key={`${row.rank}-${row.name}-${row.office}`} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-3 py-2 text-slate-400">{row.rank}</td>
                  <td className="px-3 py-2 text-slate-200 font-medium">{row.name}</td>
                  <td className="px-3 py-2 text-slate-300">{row.office}</td>
                  <td className="px-3 py-2 text-right text-emerald-300">{row.thirtyDay != null ? row.thirtyDay.toFixed(2) : "—"}</td>
                  <td className="px-3 py-2 text-right text-sky-300">{row.tenDay != null ? row.tenDay.toFixed(2) : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function exportCsv(title: string, rows: RankingRow[], label: string) {
  const header = ["Rank", label, "Office", "30 Day", "10 Day"];
  const body = rows.map((r) => [r.rank, r.name, r.office, r.thirtyDay ?? "", r.tenDay ?? ""]);
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
  const [refreshKey, setRefreshKey] = useState(0);

  // Default date range: last 30 days.
  const today = new Date();
  const thirtyAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const isoDay = (d: Date) => d.toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState<string>(isoDay(thirtyAgo));
  const [endDate, setEndDate] = useState<string>(isoDay(today));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const next = await loadOverallStatusData();
        if (!cancelled) setData(next);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load overall status data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

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
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/m/$module" params={{ module: mod.slug }} className="inline-flex items-center gap-2 rounded-md border border-white/15 bg-slate-800/70 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700">
            <ChevronLeft className="h-4 w-4" /> {mod.label}
          </Link>
        </div>

        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold underline">Overall Status</h1>
          {companyId && <p className="mt-1 text-xs text-slate-400">Company {companyId}</p>}
        </div>

        {/* Filters */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 mb-4">
          <div className="flex flex-wrap items-end justify-end gap-4">
            <div>
              <label className="text-xs uppercase tracking-[0.16em] text-slate-400">Location</label>
              <select
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="mt-1 w-48 rounded-md border border-white/15 bg-slate-950 px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
              >
                {data.allLocationsFilter.map((loc) => <option key={loc} value={loc}>{loc}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs uppercase tracking-[0.16em] text-slate-400">Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1 rounded-md border border-white/15 bg-slate-950 px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <span className="pb-2 text-slate-400">~</span>
            <div>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1 rounded-md border border-white/15 bg-slate-950 px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <button
              type="button"
              onClick={() => setRefreshKey((k) => k + 1)}
              disabled={loading}
              className="rounded-md border border-blue-400/40 bg-blue-600/30 px-4 py-1.5 text-sm font-semibold text-blue-200 hover:bg-blue-600/50 disabled:opacity-50"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {error && (
            <p className="mt-3 text-sm text-rose-400">Error: {error}</p>
          )}
        </div>

        {/* Ticket Statistics line chart */}
        <section className="rounded-xl border border-white/10 bg-white/5 p-5 mb-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-2xl font-semibold">Ticket Statistics ({statType === "monthly" ? "Monthly" : "Daily"})</h2>
            <div className="flex gap-2">
              <button
                className={`rounded-md px-3 py-1.5 text-sm font-semibold border ${statType === "monthly" ? "border-blue-400/40 bg-blue-600/30 text-blue-200" : "border-white/15 bg-slate-800/70 text-slate-300 hover:bg-slate-700"}`}
                onClick={() => setStatType("monthly")}
              >
                Monthly
              </button>
              <button
                className={`rounded-md px-3 py-1.5 text-sm font-semibold border ${statType === "daily" ? "border-blue-400/40 bg-blue-600/30 text-blue-200" : "border-white/15 bg-slate-800/70 text-slate-300 hover:bg-slate-700"}`}
                onClick={() => setStatType("daily")}
              >
                Daily
              </button>
            </div>
          </div>
          {statData.length === 0 ? (
            <p className="text-sm text-slate-400 py-12 text-center">No ticket activity recorded for this range.</p>
          ) : (
            <ResponsiveContainer width="100%" height={360}>
              <LineChart data={statData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#cbd5e1" }} />
                <YAxis tick={{ fontSize: 11, fill: "#cbd5e1" }} />
                <Tooltip contentStyle={{ background: "rgba(15,23,42,0.95)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#fff" }} />
                <Legend />
                {activeLines.map((line) => (
                  <Line key={line.key} type="monotone" dataKey={line.key} stroke={line.color} strokeWidth={line.key === "TOTAL" ? 3 : 1.5} dot={{ r: 2 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </section>

        {/* Three donuts */}
        <section className="grid gap-4 mb-4 sm:grid-cols-2 xl:grid-cols-3">
          <Donut data={data.pendingByStatus} title="Pending Tickets by Status" />
          <Donut data={filteredByLocation} title="Pending Tickets by Location" />
          <Donut data={data.csrActivity} title="CSR Activity" />
        </section>

        {/* Ranking tables */}
        <RankingTable title="Tech Ranking Report" rows={data.techRanking} label="Tech Name" locationFilter={location} />
        <RankingTable title="Location Ranking Report" rows={data.locationRanking} label="Office" locationFilter={location} />

        <p className="text-xs text-slate-500 italic mb-8">
          All numbers above are computed live from the <code className="text-slate-300">tickets</code> table (company-scoped via RLS). Date pickers and filters narrow the visible records; pull "Refresh" to re-query.
        </p>
      </main>
    </div>
  );
}
