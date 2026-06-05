import { useState, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Search, X } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { exportToCSV } from "@/lib/csvExport";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

// All CSR statuses from ticket system
const ALL_CSR_STATUSES = [
  "CSR-Assigned to ASC",
  "CSR-Left Message for Cx",
  "CSR-Needs Scheduling",
  "CSR-Acknowledged",
  "CSR-Pending Callback",
  "CSR-Escalated",
  "CSR-Resolved",
  "OP-Waiting for Part",
  "OP-UPDATE HOLD",
  "TR-Need Triage",
  "TR-Need PO",
  "CL-Parts Back Ordered",
];

const STATUS_COLORS: Record<string, string> = {
  "CSR-Assigned to ASC": "#3b82f6",
  "CSR-Left Message for Cx": "#f59e0b",
  "CSR-Needs Scheduling": "#a78bfa",
  "CSR-Acknowledged": "#34d399",
  "CSR-Pending Callback": "#fb923c",
  "CSR-Escalated": "#ef4444",
  "CSR-Resolved": "#22c55e",
  "OP-Waiting for Part": "#60a5fa",
  "OP-UPDATE HOLD": "#fbbf24",
  "TR-Need Triage": "#f472b6",
  "TR-Need PO": "#c084fc",
  "CL-Parts Back Ordered": "#94a3b8",
};

// Simulated CSR status snapshot data — will connect to Supabase
const generateStatusData = () => {
  const data: Record<string, { count: number; agents: string[]; tickets: string[] }> = {};
  ALL_CSR_STATUSES.forEach(s => {
    const count = Math.floor(Math.random() * 45) + 2;
    data[s] = {
      count,
      agents: ["Anna D.", "Jeryan L.", "Rogie O.", "Alona B.", "Ma. Czarina L."].slice(0, Math.floor(Math.random() * 4) + 1),
      tickets: Array.from({ length: Math.min(count, 5) }, (_, i) => `SA-${3700000 + i * 100 + Math.floor(Math.random() * 50)}`),
    };
  });
  return data;
};

const STATUS_DATA = generateStatusData();

export function CSRStatusSummary({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [statusFilter, setStatusFilter] = useState("");
  const [agentSearch, setAgentSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const hasFilters = !!(statusFilter || agentSearch || dateFrom || dateTo);
  const clearFilters = () => { setStatusFilter(""); setAgentSearch(""); setDateFrom(""); setDateTo(""); };

  const filteredStatuses = useMemo(() => {
    let entries = Object.entries(STATUS_DATA);
    if (statusFilter) entries = entries.filter(([s]) => s === statusFilter);
    if (agentSearch) entries = entries.filter(([, v]) => v.agents.some(a => a.toLowerCase().includes(agentSearch.toLowerCase())));
    return entries;
  }, [statusFilter, agentSearch]);

  const totalCount = filteredStatuses.reduce((s, [, v]) => s + v.count, 0);

  const pieData = filteredStatuses.map(([name, v]) => ({ name, value: v.count }));
  const barData = filteredStatuses.map(([name, v]) => ({ name: name.replace("CSR-", "").replace("OP-", "OP: ").replace("TR-", "TR: ").replace("CL-", "CL: "), value: v.count, fill: STATUS_COLORS[name] || "#94a3b8" }));

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/m/$module/$submodule" params={{ module: "dashboard", submodule: "csr-dashboard" }} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4" /></Link>
          <h1 className="text-2xl font-bold">{sub.title}</h1>
          <span className="px-2 py-0.5 rounded text-xs bg-yellow-500/15 text-yellow-300 border border-yellow-500/25">Sample data · connects to Supabase</span>
        </div>

        {/* Filters */}
        <div className="panel mb-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</label>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md min-w-[220px]">
                <option value="">All Statuses</option>
                {ALL_CSR_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select></div>
            <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Agent</label>
              <div className="relative"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input value={agentSearch} onChange={e => setAgentSearch(e.target.value)} placeholder="Search agent…" className="glass-input text-sm py-1.5 pl-8 pr-3 rounded-md w-36" /></div></div>
            <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date From</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" style={{ colorScheme: "dark" }} /></div>
            <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date To</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" style={{ colorScheme: "dark" }} /></div>
            {hasFilters && (
              <button onClick={clearFilters} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-white/10 border border-white/10 transition-colors self-end mb-0.5">
                <X className="h-3.5 w-3.5" />Clear
              </button>
            )}
            <div className="ml-auto flex items-center gap-2 self-end mb-0.5">
              <span className="text-xs text-muted-foreground">{totalCount} total tickets · {filteredStatuses.length} statuses</span>
              <button onClick={() => exportToCSV("csr_status_summary", ["Status", "Count", "Top Agents", "Sample Tickets"],
                filteredStatuses.map(([s, v]) => [s, v.count, v.agents.join(", "), v.tickets.slice(0, 3).join(", ")]))}
                title="Download CSV" className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              </button>
            </div>
          </div>
        </div>

        {/* Status count cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 mb-6">
          {filteredStatuses.map(([status, v]) => (
            <button key={status} onClick={() => setStatusFilter(statusFilter === status ? "" : status)}
              className={`panel p-3 text-left border transition-colors ${statusFilter === status ? "border-white/30 bg-white/10" : "border-transparent hover:border-white/10 hover:bg-white/5"}`}>
              <div className="w-2 h-2 rounded-full mb-2" style={{ background: STATUS_COLORS[status] || "#94a3b8" }} />
              <p className="text-xl font-bold" style={{ color: STATUS_COLORS[status] || "#fff" }}>{v.count}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{status}</p>
            </button>
          ))}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Status Distribution</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={barData} margin={{ left: -10 }}>
                <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 9 }} angle={-20} textAnchor="end" height={50} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6 }} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} name="Tickets">
                  {barData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Pie Breakdown</p>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`} labelLine={false}>
                  {pieData.map((entry, i) => <Cell key={i} fill={STATUS_COLORS[entry.name] || "#94a3b8"} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6 }}
                  formatter={(v: any, n: string) => [v, n]} />
                <Legend wrapperStyle={{ fontSize: 10, color: "#94a3b8" }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Detail table */}
        <div className="panel p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm">Status Detail</div>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-white/10 bg-white/5">
              <th className="px-4 py-2.5 text-left text-xs text-muted-foreground uppercase">Status</th>
              <th className="px-4 py-2.5 text-right text-xs text-muted-foreground uppercase">Count</th>
              <th className="px-4 py-2.5 text-left text-xs text-muted-foreground uppercase">Agents Involved</th>
              <th className="px-4 py-2.5 text-left text-xs text-muted-foreground uppercase">Sample Tickets</th>
            </tr></thead>
            <tbody>
              {filteredStatuses.length === 0
                ? <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">No records match filters.</td></tr>
                : filteredStatuses.sort(([, a], [, b]) => b.count - a.count).map(([status, v], i) => (
                  <tr key={status} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: STATUS_COLORS[status] || "#94a3b8" }} />
                        <span className="text-sm font-medium">{status}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-lg" style={{ color: STATUS_COLORS[status] || "#fff" }}>{v.count}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{v.agents.join(", ")}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {v.tickets.slice(0, 4).map(t => (
                          <span key={t} className="px-1.5 py-0.5 rounded text-[10px] bg-white/10 text-muted-foreground border border-white/10">{t}</span>
                        ))}
                        {v.count > 4 && <span className="text-[10px] text-muted-foreground">+{v.count - 4} more</span>}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
