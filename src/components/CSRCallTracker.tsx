import { useState, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Phone, Search } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { exportToCSV } from "@/lib/csvExport";
import { csrReportData } from "@/lib/reportData";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

const ALL_DATES = Object.keys(csrReportData).sort();
const ALL_TEAMS = ["TEAM DANIELA", "TEAM ROBYN", "TEAM ROCHELLE", "TEAM SHANE"];
const TEAM_COLORS: Record<string, string> = {
  "TEAM DANIELA": "#3b82f6", "TEAM ROBYN": "#34d399",
  "TEAM ROCHELLE": "#a78bfa", "TEAM SHANE": "#fb923c",
};
const fmtDate = (s: string) => {
  const c = s.trim().replace(/^0/, "");
  return c.length === 3 ? `${c[0]}/${c.slice(1)}/26` : `${c.slice(0, -2)}/${c.slice(-2)}/26`;
};

export function CSRCallTracker({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [date, setDate] = useState(ALL_DATES[ALL_DATES.length - 1]);
  const [teamFilter, setTeamFilter] = useState("");
  const [nameSearch, setNameSearch] = useState("");
  const [taskFilter, setTaskFilter] = useState("");

  const allAgents: any[] = useMemo(() => (csrReportData as any)[date]?.agents || [], [date]);

  const filtered = useMemo(() => {
    let a = allAgents;
    if (teamFilter) a = a.filter((x: any) => x.team === teamFilter);
    if (taskFilter) a = a.filter((x: any) => x.task === taskFilter);
    if (nameSearch) a = a.filter((x: any) => x.name.toLowerCase().includes(nameSearch.toLowerCase()));
    return a;
  }, [allAgents, teamFilter, taskFilter, nameSearch]);

  // Derived call metrics: schedule = calls scheduled, attempt = calls attempted, update = cx updated
  const agentRows = useMemo(() => filtered.map((a: any) => ({
    name: a.name,
    team: a.team,
    task: a.task,
    ticketsHandled: (a.schedule || 0) + (a.attempt || 0) + (a.update || 0),
    schedule: a.schedule || 0,
    attempt: a.attempt || 0,
    update: a.update || 0,
    total: a.total || 0,
    gh: a.gh || 0,
  })), [filtered]);

  const totals = useMemo(() => agentRows.reduce((acc, r) => ({
    ticketsHandled: acc.ticketsHandled + r.ticketsHandled,
    schedule: acc.schedule + r.schedule,
    attempt: acc.attempt + r.attempt,
    update: acc.update + r.update,
  }), { ticketsHandled: 0, schedule: 0, attempt: 0, update: 0 }), [agentRows]);

  const barData = agentRows.slice(0, 14).map(r => ({
    name: r.name.split(" ")[0],
    Schedule: r.schedule,
    Attempt: r.attempt,
    Update: r.update,
  }));

  const teamSummary = useMemo(() => (teamFilter ? [teamFilter] : ALL_TEAMS).map(t => {
    const ta = allAgents.filter((a: any) => a.team === t);
    return {
      team: t,
      agents: ta.length,
      schedule: ta.reduce((s: number, a: any) => s + (Number(a.schedule) || 0), 0),
      attempt: ta.reduce((s: number, a: any) => s + (Number(a.attempt) || 0), 0),
      update: ta.reduce((s: number, a: any) => s + (Number(a.update) || 0), 0),
    };
  }).filter(t => t.agents > 0), [allAgents, teamFilter]);

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/m/$module/$submodule" params={{ module: "dashboard", submodule: "csr-dashboard" }} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4" /></Link>
          <div className="flex items-center gap-2"><Phone className="h-5 w-5 text-pink-400" /><h1 className="text-2xl font-bold">{sub.title}</h1></div>
        </div>

        {/* Filters */}
        <div className="panel mb-6"><div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</label>
            <select value={date} onChange={e => setDate(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md">
              {ALL_DATES.map(d => <option key={d} value={d}>{fmtDate(d)}</option>)}
            </select></div>
          <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Team</label>
            <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md">
              <option value="">All Teams</option>{ALL_TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
            </select></div>
          <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Task</label>
            <select value={taskFilter} onChange={e => setTaskFilter(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md">
              <option value="">All</option><option value="In">In</option><option value="Out">Out</option><option value="Absent">Absent</option>
            </select></div>
          <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Agent</label>
            <div className="relative"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input value={nameSearch} onChange={e => setNameSearch(e.target.value)} placeholder="Search name…" className="glass-input text-sm py-1.5 pl-8 pr-3 rounded-md w-36" /></div></div>
          {(teamFilter || taskFilter || nameSearch) && <button onClick={() => { setTeamFilter(""); setTaskFilter(""); setNameSearch(""); }} className="btn text-sm px-3 mb-0.5">Clear</button>}
        </div></div>

        {/* Summary KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total Tickets Handled", value: totals.ticketsHandled, color: "text-white" },
            { label: "Scheduled", value: totals.schedule, color: "text-green-300" },
            { label: "Attempted", value: totals.attempt, color: "text-purple-300" },
            { label: "Updated Cx", value: totals.update, color: "text-cyan-300" },
          ].map(k => (
            <div key={k.label} className="panel p-4 text-center">
              <p className={`text-3xl font-bold ${k.color}`}>{k.value}</p>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mt-1">{k.label}</p>
            </div>
          ))}
        </div>

        {/* Team summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {teamSummary.map(t => (
            <div key={t.team} className="panel p-4" style={{ borderTop: `2px solid ${TEAM_COLORS[t.team] || "#94a3b8"}` }}>
              <p className="text-xs font-bold mb-2" style={{ color: TEAM_COLORS[t.team] }}>{t.team}</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <span className="text-muted-foreground">Agents</span><span className="text-right font-medium">{t.agents}</span>
                <span className="text-muted-foreground">Schedule</span><span className="text-right text-green-300">{t.schedule}</span>
                <span className="text-muted-foreground">Attempt</span><span className="text-right text-purple-300">{t.attempt}</span>
                <span className="text-muted-foreground">Update</span><span className="text-right text-cyan-300">{t.update}</span>
                <span className="text-muted-foreground">Total Calls</span><span className="text-right font-semibold">{t.schedule + t.attempt + t.update}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Chart */}
        <div className="panel p-4 mb-4">
          <p className="text-sm font-semibold mb-4">Calls & Tickets Per Agent (top 14)</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={barData} margin={{ left: -10 }}>
              <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6 }} />
              <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
              <Bar dataKey="Schedule" fill="#34d399" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Attempt" fill="#a78bfa" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Update" fill="#22d3ee" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Agent table */}
        <div className="panel p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 flex justify-between items-center">
            <span className="font-semibold text-sm">Agent Call Log</span>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              {agentRows.length} agents
              <button onClick={() => exportToCSV("call_tracker", ["Team", "Name", "Task", "Schedule", "Attempt", "Update", "Tickets Handled", "GH"],
                agentRows.map(r => [r.team, r.name, r.task, r.schedule, r.attempt, r.update, r.ticketsHandled, r.gh]))}
                title="Download CSV" className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              </button>
            </span>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-white/10 bg-white/5">
              {["Team", "Agent", "Task", "Schedule", "Attempt", "Update", "Tickets Handled", "GH"].map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-xs text-muted-foreground uppercase whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {agentRows.length === 0
                ? <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">No records.</td></tr>
                : agentRows.map((r, i) => (
                  <tr key={i} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap" style={{ color: TEAM_COLORS[r.team] || "#94a3b8" }}>{r.team}</td>
                    <td className="px-3 py-2.5 font-medium whitespace-nowrap">{r.name}</td>
                    <td className="px-3 py-2.5"><span className={`px-1.5 py-0.5 rounded text-xs font-medium ${r.task === "In" ? "bg-green-500/20 text-green-300" : r.task === "Out" ? "bg-blue-500/20 text-blue-300" : r.task === "Absent" ? "bg-red-500/20 text-red-300" : "bg-white/10 text-muted-foreground"}`}>{r.task || "—"}</span></td>
                    <td className="px-3 py-2.5 text-right text-green-400 font-semibold">{r.schedule}</td>
                    <td className="px-3 py-2.5 text-right text-purple-400">{r.attempt}</td>
                    <td className="px-3 py-2.5 text-right text-cyan-400">{r.update}</td>
                    <td className="px-3 py-2.5 text-right font-bold text-white">{r.ticketsHandled}</td>
                    <td className="px-3 py-2.5 text-right text-blue-400">{r.gh}</td>
                  </tr>
                ))}
              {agentRows.length > 0 && (
                <tr className="border-t border-white/20 bg-white/5 font-semibold">
                  <td className="px-3 py-2.5 text-xs text-muted-foreground uppercase" colSpan={3}>Totals</td>
                  <td className="px-3 py-2.5 text-right text-green-300">{totals.schedule}</td>
                  <td className="px-3 py-2.5 text-right text-purple-300">{totals.attempt}</td>
                  <td className="px-3 py-2.5 text-right text-cyan-300">{totals.update}</td>
                  <td className="px-3 py-2.5 text-right text-white">{totals.ticketsHandled}</td>
                  <td className="px-3 py-2.5"></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
