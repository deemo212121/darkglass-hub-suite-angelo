import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, AlertTriangle, Phone, Clock, TrendingUp, Users, CheckCircle, MessageSquare } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { csrReportData } from "@/lib/reportData";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

const ALL_DATES = Object.keys(csrReportData).sort();
const TEAM_COLORS: Record<string, string> = {
  "TEAM DANIELA": "#3b82f6",
  "TEAM ROBYN": "#34d399",
  "TEAM ROCHELLE": "#a78bfa",
  "TEAM SHANE": "#fb923c",
};
const ALL_TEAMS = Object.keys(TEAM_COLORS);
const COLORS = ["#3b82f6", "#34d399", "#a78bfa", "#fb923c", "#f472b6", "#facc15"];

const fmtDate = (s: string) => {
  const c = s.trim().replace(/^0/, "");
  return c.length === 3 ? `${c[0]}/${c.slice(1)}/26` : `${c.slice(0, -2)}/${c.slice(-2)}/26`;
};

export function CSRDashboard({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const latestDate = ALL_DATES[ALL_DATES.length - 1];
  const d = (csrReportData as any)[latestDate] || {};
  const agents: any[] = d.agents || [];

  const totals = useMemo(() => {
    return agents.reduce((acc, a) => ({
      agents: acc.agents + 1,
      gh: acc.gh + (Number(a.gh) || 0),
      schedule: acc.schedule + (Number(a.schedule) || 0),
      attempt: acc.attempt + (Number(a.attempt) || 0),
      update: acc.update + (Number(a.update) || 0),
      warnings: acc.warnings + (Number(a.warning) || 0),
      mistakes: acc.mistakes + (a.mistake && a.mistake !== "null" ? 1 : 0),
    }), { agents: 0, gh: 0, schedule: 0, attempt: 0, update: 0, warnings: 0, mistakes: 0 });
  }, [agents]);

  const teamData = useMemo(() => ALL_TEAMS.map(t => {
    const ta = agents.filter((a: any) => a.team === t);
    return {
      name: t.replace("TEAM ", ""),
      agents: ta.length,
      gh: ta.reduce((s: number, a: any) => s + (Number(a.gh) || 0), 0),
      schedule: ta.reduce((s: number, a: any) => s + (Number(a.schedule) || 0), 0),
      attempt: ta.reduce((s: number, a: any) => s + (Number(a.attempt) || 0), 0),
      mistakes: ta.filter((a: any) => a.mistake && a.mistake !== "null").length,
      warnings: ta.reduce((s: number, a: any) => s + (Number(a.warning) || 0), 0),
    };
  }).filter(t => t.agents > 0), [agents]);

  const taskBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    agents.forEach((a: any) => { const t = a.task || "Unknown"; map[t] = (map[t] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [agents]);

  const trend10 = useMemo(() => ALL_DATES.slice(-10).map(dt => {
    const da = (csrReportData as any)[dt]?.agents || [];
    return {
      date: fmtDate(dt),
      gh: da.reduce((s: number, a: any) => s + (Number(a.gh) || 0), 0),
      schedule: da.reduce((s: number, a: any) => s + (Number(a.schedule) || 0), 0),
      mistakes: da.filter((a: any) => a.mistake && a.mistake !== "null").length,
    };
  }), []);

  const recentMistakes = useMemo(() => agents.filter((a: any) => a.mistake && a.mistake !== "null").slice(0, 6), [agents]);

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <div className="flex items-center gap-3 mb-2">
          <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4" /></Link>
          <div>
            <h1 className="text-2xl font-bold">CSR Dashboard</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Latest: {fmtDate(latestDate)} · {totals.agents} agents active</p>
          </div>
        </div>

        {/* Quick nav to subpages */}
        <div className="flex flex-wrap gap-2 mb-6 mt-4">
          {[
            { slug: "csr-daily-report", label: "CSR Daily Report", icon: "📋" },
            { slug: "call-tracker", label: "Call Tracker", icon: "📞" },
            { slug: "csr-status-summary", label: "Status Summary", icon: "📊" },
          ].map(item => (
            <Link key={item.slug} to="/m/$module/$submodule" params={{ module: "dashboard", submodule: item.slug }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-sm font-medium transition-colors">
              <span>{item.icon}</span>{item.label}
            </Link>
          ))}
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
          {[
            { label: "Agents", value: totals.agents, color: "text-white", icon: <Users className="h-4 w-4" /> },
            { label: "GH Total", value: totals.gh, color: "text-blue-300", icon: <TrendingUp className="h-4 w-4" /> },
            { label: "Schedule", value: totals.schedule, color: "text-green-300", icon: <CheckCircle className="h-4 w-4" /> },
            { label: "Attempt", value: totals.attempt, color: "text-cyan-300", icon: <Phone className="h-4 w-4" /> },
            { label: "Update", value: totals.update, color: "text-purple-300", icon: <MessageSquare className="h-4 w-4" /> },
            { label: "Warnings", value: totals.warnings, color: totals.warnings > 0 ? "text-red-300" : "text-muted-foreground", icon: <AlertTriangle className="h-4 w-4" /> },
            { label: "Mistakes", value: totals.mistakes, color: totals.mistakes > 0 ? "text-orange-300" : "text-muted-foreground", icon: <Clock className="h-4 w-4" /> },
          ].map(k => (
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
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={teamData} margin={{ left: -10 }}>
                <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6 }} />
                <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                <Bar dataKey="gh" fill="#3b82f6" radius={[4, 4, 0, 0]} name="GH" />
                <Bar dataKey="schedule" fill="#34d399" radius={[4, 4, 0, 0]} name="Schedule" />
                <Bar dataKey="attempt" fill="#a78bfa" radius={[4, 4, 0, 0]} name="Attempt" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Task Status</p>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={taskBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, value }) => `${name}: ${value}`} labelLine={false}>
                  {taskBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Trend */}
        <div className="panel p-4 mb-4">
          <p className="text-sm font-semibold mb-4">10-Day Trend</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={trend10} margin={{ left: -10 }}>
              <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6 }} />
              <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
              <Bar dataKey="gh" fill="#3b82f6" radius={[4, 4, 0, 0]} name="GH" />
              <Bar dataKey="schedule" fill="#34d399" radius={[4, 4, 0, 0]} name="Schedule" />
              <Bar dataKey="mistakes" fill="#f87171" radius={[4, 4, 0, 0]} name="Mistakes" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Team cards + recent mistakes */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="grid grid-cols-2 gap-3">
            {teamData.map(t => (
              <div key={t.name} className="panel p-4" style={{ borderLeft: `3px solid ${TEAM_COLORS["TEAM " + t.name] || "#94a3b8"}` }}>
                <p className="text-xs font-bold mb-2" style={{ color: TEAM_COLORS["TEAM " + t.name] || "#94a3b8" }}>TEAM {t.name}</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <span className="text-muted-foreground">Agents</span><span className="text-right font-semibold">{t.agents}</span>
                  <span className="text-muted-foreground">GH</span><span className="text-right text-blue-300">{t.gh}</span>
                  <span className="text-muted-foreground">Schedule</span><span className="text-right text-green-300">{t.schedule}</span>
                  <span className="text-muted-foreground">Attempt</span><span className="text-right">{t.attempt}</span>
                  <span className="text-muted-foreground">Warnings</span><span className={`text-right ${t.warnings > 0 ? "text-red-300" : ""}`}>{t.warnings}</span>
                  <span className="text-muted-foreground">Mistakes</span><span className={`text-right ${t.mistakes > 0 ? "text-orange-300" : ""}`}>{t.mistakes}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Recent mistakes */}
          <div className="panel p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              <span className="font-semibold text-sm">Recent Mistakes</span>
              <span className="px-2 py-0.5 rounded-full text-xs bg-red-500/15 text-red-400 border border-red-500/25">{recentMistakes.length}</span>
            </div>
            {recentMistakes.length === 0
              ? <div className="px-4 py-8 text-center text-muted-foreground text-sm">No mistakes recorded for this date.</div>
              : <div className="divide-y divide-white/5">
                {recentMistakes.map((a: any, i: number) => (
                  <div key={i} className="px-4 py-3 flex items-center gap-3 hover:bg-white/[0.02]">
                    <div className="min-w-[140px]">
                      <p className="text-[10px] font-semibold" style={{ color: TEAM_COLORS[a.team] || "#94a3b8" }}>{(a.team || "").replace("TEAM ", "")}</p>
                      <a href={`/csr/mistake/${encodeURIComponent(a.name)}`} target="_blank" rel="noopener noreferrer"
                        className="text-sm font-medium hover:text-blue-300 hover:underline underline-offset-2 transition-colors">{a.name}</a>
                    </div>
                    <div className="flex-1 text-xs text-red-300 truncate">{a.mistake}</div>
                    {a.warning > 0 && <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-300 border border-yellow-500/25 shrink-0">⚠ {a.warning}</span>}
                  </div>
                ))}
              </div>
            }
          </div>
        </div>
      </main>
    </div>
  );
}
