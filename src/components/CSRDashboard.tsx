import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle,
  ChevronLeft,
  Clock,
  MessageSquare,
  Phone,
  Search,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import {
  CSR_AGENTS,
  CSR_MISTAKES,
  CSR_TEAM_COLORS,
  CSR_TEAMS,
  CSR_TREND_10,
  type CSRAgent,
} from "@/lib/csrDashboardData";

const COLORS = ["#3b82f6", "#34d399", "#a78bfa", "#fb923c", "#f472b6", "#facc15"];

const ALL_LOCATIONS = [
  "All Locations",
  "Asheville", "Atlanta", "Birmingham", "Cape Girardeau", "Chattanooga",
  "Columbus", "Dallas", "Destin", "Huntsville", "Jackson, MS", "Jackson, TN",
  "Jacksonville", "Jonesboro", "Knoxville", "Lake Charles", "Little Rock",
  "Louisville", "Memphis", "Mobile", "Montgomery", "Nashville", "New Orleans",
  "Norfolk", "Philippines", "Raleigh", "Richmond", "San Antonio", "Savannah",
  "St. Louis", "Tallahassee", "Wilmington",
];

export function CSRDashboard({ mod }: { mod: ModuleDef; sub: SubModuleDef }) {
  // ── Filters ──
  const [locationSearchFilter, setLocationSearchFilter] = useState("All Locations");
  const [teamFilter, setTeamFilter] = useState<string>("");
  const [agentSearch, setAgentSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showPieLabels, setShowPieLabels] = useState(true);

  // Date filters are wired up for future Supabase queries; sample
  // dataset isn't date-keyed yet so they're informational for now.
  void dateFrom;
  void dateTo;

  const agents = useMemo<CSRAgent[]>(() => {
    return CSR_AGENTS.filter((a) => {
      const matchLocation =
        locationSearchFilter === "All Locations" || (a.locations || []).includes(locationSearchFilter);
      const matchTeam = !teamFilter || a.team === teamFilter;
      const q = agentSearch.toLowerCase();
      const matchSearch = !q || a.name.toLowerCase().includes(q);
      return matchLocation && matchTeam && matchSearch;
    });
  }, [locationSearchFilter, teamFilter, agentSearch]);

  const totals = useMemo(
    () =>
      agents.reduce(
        (acc, a) => ({
          agents: acc.agents + 1,
          schedule: acc.schedule + a.schedule,
          attempt: acc.attempt + a.attempt,
          update: acc.update + a.update,
          warnings: acc.warnings + a.warning,
          mistakes: acc.mistakes + (a.mistake ? 1 : 0),
        }),
        { agents: 0, schedule: 0, attempt: 0, update: 0, warnings: 0, mistakes: 0 },
      ),
    [agents],
  );

  const teamData = useMemo(
    () =>
      CSR_TEAMS.map((t) => {
        const ta = agents.filter((a) => a.team === t);
        return {
          name: t.replace("TEAM ", ""),
          agents: ta.length,
          schedule: ta.reduce((s, a) => s + a.schedule, 0),
          attempt: ta.reduce((s, a) => s + a.attempt, 0),
          mistakes: ta.filter((a) => a.mistake).length,
          warnings: ta.reduce((s, a) => s + a.warning, 0),
        };
      }).filter((t) => t.agents > 0),
    [agents],
  );

  const locationBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    agents.forEach((a) => {
      (a.locations || []).forEach((loc) => {
        map[loc] = (map[loc] || 0) + 1;
      });
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [agents]);

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <div className="flex items-center gap-3 mb-2">
          <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">CSR Dashboard</h1>
            <p className="text-xs text-muted-foreground mt-0.5">{totals.agents} agents active</p>
          </div>
        </div>

        {/* Quick nav */}
        <div className="flex flex-wrap gap-2 mb-6 mt-4">
          {[
            { slug: "csr-daily-report", label: "CSR Daily Report", icon: "📋" },
            { slug: "csr-status-summary", label: "Status Summary", icon: "📊" },
          ].map((item) => (
            <Link
              key={item.slug}
              to="/m/$module/$submodule"
              params={{ module: "dashboard", submodule: item.slug }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-sm font-medium transition-colors"
            >
              <span>{item.icon}</span>{item.label}
            </Link>
          ))}
        </div>

        {/* Filters */}
        <div className="panel p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Location</label>
              <select
                value={locationSearchFilter}
                onChange={(e) => setLocationSearchFilter(e.target.value)}
                className="glass-input mt-1 w-full"
              >
                {ALL_LOCATIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Team</label>
              <select
                value={teamFilter}
                onChange={(e) => setTeamFilter(e.target.value)}
                className="glass-input mt-1 w-full"
              >
                <option value="">All Teams</option>
                {CSR_TEAMS.map((t) => (
                  <option key={t} value={t}>{t.replace("TEAM ", "Team ")}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Agent Name</label>
              <div className="relative mt-1">
                <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={agentSearch}
                  onChange={(e) => setAgentSearch(e.target.value)}
                  placeholder="Search agent…"
                  className="glass-input w-full pl-8"
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Date From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="glass-input mt-1 w-full"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Date To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="glass-input mt-1 w-full"
              />
            </div>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          {[
            { label: "Agents", value: totals.agents, color: "text-white", icon: <Users className="h-4 w-4" /> },
            { label: "Schedule", value: totals.schedule, color: "text-green-300", icon: <CheckCircle className="h-4 w-4" /> },
            { label: "Attempt", value: totals.attempt, color: "text-cyan-300", icon: <Phone className="h-4 w-4" /> },
            { label: "Update", value: totals.update, color: "text-purple-300", icon: <MessageSquare className="h-4 w-4" /> },
            { label: "Warnings", value: totals.warnings, color: totals.warnings > 0 ? "text-red-300" : "text-muted-foreground", icon: <AlertTriangle className="h-4 w-4" /> },
            { label: "Mistakes", value: totals.mistakes, color: totals.mistakes > 0 ? "text-orange-300" : "text-muted-foreground", icon: <Clock className="h-4 w-4" /> },
          ].map((k) => (
            <div key={k.label} className="panel p-4 text-center">
              <div className="flex justify-center mb-1 text-muted-foreground">{k.icon}</div>
              <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{k.label}</p>
            </div>
          ))}
        </div>

        {/* Charts row 1 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          <div className="panel p-4 lg:col-span-2">
            <p className="text-sm font-semibold mb-4">Team Performance</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={teamData} margin={{ left: -10 }}>
                <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 6, color: "#0f172a", fontSize: 12, fontWeight: 600, boxShadow: "0 4px 12px rgba(0,0,0,0.3)" }} />
                <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                <Bar dataKey="schedule" fill="#34d399" radius={[4, 4, 0, 0]} name="Schedule" />
                <Bar dataKey="attempt" fill="#a78bfa" radius={[4, 4, 0, 0]} name="Attempt" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="panel p-4">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold">Location Distribution</p>
              <button
                onClick={() => setShowPieLabels((v) => !v)}
                className={`text-[10px] uppercase tracking-wide px-2 py-1 rounded border transition-colors ${showPieLabels ? "border-white/20 bg-white/10 text-foreground" : "border-white/10 text-muted-foreground hover:text-foreground hover:bg-white/5"}`}
              >
                {showPieLabels ? "Hide Legend" : "Show Legend"}
              </button>
            </div>
            <ResponsiveContainer width="100%" height={showPieLabels ? 340 : 220}>
              <PieChart>
                <Pie
                  data={locationBreakdown}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="45%"
                  outerRadius={80}
                  label={false}
                  labelLine={false}
                >
                  {locationBreakdown.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 6, color: "#0f172a", fontSize: 12, fontWeight: 600, boxShadow: "0 4px 12px rgba(0,0,0,0.3)" }}
                  formatter={(value: any, name: any) => [value, name]}
                />
                {showPieLabels && (
                  <Legend
                    layout="horizontal"
                    verticalAlign="bottom"
                    align="center"
                    wrapperStyle={{ fontSize: 10, color: "var(--foreground)", paddingTop: 8, lineHeight: "1.8" }}
                    formatter={(value) => <span style={{ color: "var(--foreground)" }}>{value}</span>}
                  />
                )}
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 10-Day Trend */}
        <div className="panel p-4 mb-4">
          <p className="text-sm font-semibold mb-4">10-Day Trend</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={CSR_TREND_10} margin={{ left: -10 }}>
              <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 6, color: "#0f172a", fontSize: 12, fontWeight: 600, boxShadow: "0 4px 12px rgba(0,0,0,0.3)" }} />
              <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
              <Bar dataKey="schedule" fill="#34d399" radius={[4, 4, 0, 0]} name="Schedule" />
              <Bar dataKey="attempt" fill="#a78bfa" radius={[4, 4, 0, 0]} name="Attempt" />
              <Bar dataKey="mistakes" fill="#f87171" radius={[4, 4, 0, 0]} name="Mistakes" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Team cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {teamData.map((t) => (
            <div
              key={t.name}
              className="panel p-4"
              style={{ borderLeft: `3px solid ${CSR_TEAM_COLORS["TEAM " + t.name] || "#94a3b8"}` }}
            >
              <p
                className="text-xs font-bold mb-2"
                style={{ color: CSR_TEAM_COLORS["TEAM " + t.name] || "#94a3b8" }}
              >
                TEAM {t.name}
              </p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <span className="text-muted-foreground">Agents</span>
                <span className="text-right font-semibold">{t.agents}</span>
                <span className="text-muted-foreground">Schedule</span>
                <span className="text-right text-green-300">{t.schedule}</span>
                <span className="text-muted-foreground">Attempt</span>
                <span className="text-right">{t.attempt}</span>
                <span className="text-muted-foreground">Warnings</span>
                <span className={`text-right ${t.warnings > 0 ? "text-red-300" : ""}`}>{t.warnings}</span>
                <span className="text-muted-foreground">Mistakes</span>
                <span className={`text-right ${t.mistakes > 0 ? "text-orange-300" : ""}`}>{t.mistakes}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Mistakes log table */}
        <div className="panel p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400" />
            <span className="font-semibold text-sm">Mistakes Log</span>
            <span className="px-2 py-0.5 rounded-full text-xs bg-red-500/15 text-red-400 border border-red-500/25">{CSR_MISTAKES.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-blue-900/40 border-b border-white/10">
                  {["Name", "Mistake", "Date", "Reason", "Action Taken"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left font-semibold text-blue-300">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CSR_MISTAKES.map((m, i) => (
                  <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-4 py-2.5 font-medium text-slate-200">{m.name}</td>
                    <td className="px-4 py-2.5 text-center text-orange-300">{m.mistakes}</td>
                    <td className="px-4 py-2.5 text-slate-300">{m.date}</td>
                    <td className="px-4 py-2.5 text-slate-300">{m.reason}</td>
                    <td className="px-4 py-2.5 text-slate-300">{m.actionTaken}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
