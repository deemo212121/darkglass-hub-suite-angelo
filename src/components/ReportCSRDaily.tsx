import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Eye, Loader2, Search, X } from "lucide-react";
import {
  Bar,
  BarChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { exportToCSV } from "@/lib/csvExport";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getCompanyUsers } from "@/lib/supabase/users";
import { getTicketAuditLog } from "@/lib/supabase/tickets";
import { getCsrTeamComposition } from "@/lib/supabase/csrTeams";
import { parseBranchAccess } from "@/lib/locations";

const UNASSIGNED = "__unassigned__";

interface Agent {
  id: string;
  name: string;
  email: string;
  username: string;
  role: "Team Leader" | "Agent";
  teamKey: string;
  locations: string[];
  schedule: number; // reschedule actions this CSR made (ticket_audit_log)
  update: number; // status_change actions this CSR made (ticket_audit_log)
}

interface TeamMeta {
  key: string;
  name: string;
  color: string;
}

const branchesOf = (assignedBranch: string | null, branchAccess: string | null): string[] => {
  const raw = [assignedBranch ?? "", ...parseBranchAccess(branchAccess)];
  return Array.from(new Set(raw.map((s) => s.trim()).filter(Boolean)));
};

export function ReportCSRDaily({ sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [teams, setTeams] = useState<TeamMeta[]>([]);

  // Top-bar filters
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");

  // Agent table filters
  const [tblNameSearch, setTblNameSearch] = useState("");
  const [tblTeam, setTblTeam] = useState("");
  // Agents can cover 20-30+ locations, which flooded the table when shown
  // inline — the Locations column was replaced with a Details button that
  // opens this agent in a modal instead.
  const [detailsAgent, setDetailsAgent] = useState<Agent | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [profiles, auditLog, composition] = await Promise.all([
          getCompanyUsers(),
          getTicketAuditLog({ startDate: dateFrom || undefined, endDate: dateTo || undefined }),
          getCsrTeamComposition().catch((err) => {
            console.error("Failed to load CSR team composition:", err);
            setError(
              `Team Composition unavailable (${err instanceof Error ? err.message : "unknown error"}). ` +
              `Run the 0027_csr_team_composition.sql migration in Supabase, then reload.`,
            );
            return { teams: [], members: [] };
          }),
        ]);
        if (cancelled) return;

        const teamOf = new Map<string, string>();
        for (const m of composition.members) teamOf.set(m.profileId, m.teamId);

        const scheduleCount = new Map<string, number>();
        const updateCount = new Map<string, number>();
        for (const entry of auditLog) {
          if (!entry.changedBy) continue;
          if (entry.action === "reschedule") scheduleCount.set(entry.changedBy, (scheduleCount.get(entry.changedBy) ?? 0) + 1);
          if (entry.action === "status_change") updateCount.set(entry.changedBy, (updateCount.get(entry.changedBy) ?? 0) + 1);
        }

        const roster: Agent[] = profiles
          .filter((p) => p.is_active !== false)
          .filter((p) => {
            const extras = p.extra_roles || [];
            return p.role === "CSR_AGENT" || p.role === "CSR_TEAM_LEADER" || extras.includes("CSR_AGENT") || extras.includes("CSR_TEAM_LEADER");
          })
          .map((p) => ({
            id: p.id,
            name: p.display_name || p.username || p.email,
            email: p.email || "",
            username: p.username || "",
            role: (p.role === "CSR_TEAM_LEADER" || (p.extra_roles || []).includes("CSR_TEAM_LEADER")) ? "Team Leader" : "Agent",
            teamKey: teamOf.get(p.id) ?? UNASSIGNED,
            locations: branchesOf(p.assigned_branch, p.branch_access),
            schedule: scheduleCount.get(p.id) ?? 0,
            update: updateCount.get(p.id) ?? 0,
          }));

        setAgents(roster);
        setTeams(composition.teams.map((t) => ({ key: t.id, name: t.name, color: t.color })));

        // Compute a real 10-day "Schedule" trend from the same audit entries
        // (reschedule actions), bucketed by day.
        const buckets = new Map<string, number>();
        for (const entry of auditLog) {
          if (entry.action !== "reschedule") continue;
          const d = new Date(entry.createdAt);
          if (isNaN(d.getTime())) continue;
          const key = d.toISOString().slice(0, 10);
          buckets.set(key, (buckets.get(key) ?? 0) + 1);
        }
        setTrend(
          Array.from(buckets.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(-10)
            .map(([date, schedule]) => ({ date: date.slice(5).replace("-", "/"), schedule })),
        );
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load CSR Daily Report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [dateFrom, dateTo]);

  const [trend, setTrend] = useState<{ date: string; schedule: number }[]>([]);

  const teamName = (key: string) => (key === UNASSIGNED ? "Unassigned" : teams.find((t) => t.key === key)?.name || "—");
  const teamColor = (key: string) => (key === UNASSIGNED ? "#64748b" : teams.find((t) => t.key === key)?.color || "#94a3b8");

  // Primary filtered list (top-bar filters)
  const primaryFiltered = useMemo<Agent[]>(() => {
    let a = agents;
    if (teamFilter) a = a.filter((x) => x.teamKey === teamFilter);
    if (locationFilter)
      a = a.filter((x) => x.locations.some((l) => l.toLowerCase().includes(locationFilter.toLowerCase())));
    return a;
  }, [agents, teamFilter, locationFilter]);

  // Table-level filters applied on top of primary
  const filtered = useMemo<Agent[]>(() => {
    return primaryFiltered.filter((a) => {
      if (tblNameSearch && !a.name.toLowerCase().includes(tblNameSearch.toLowerCase())) return false;
      if (tblTeam && a.teamKey !== tblTeam) return false;
      return true;
    });
  }, [primaryFiltered, tblNameSearch, tblTeam]);

  const tblHasFilters = !!(tblNameSearch || tblTeam);
  const clearTblFilters = () => {
    setTblNameSearch("");
    setTblTeam("");
  };

  const teamSummaries = useMemo(
    () =>
      teams
        .filter((t) => !teamFilter || t.key === teamFilter)
        .map((t) => {
          const ta = primaryFiltered.filter((a) => a.teamKey === t.key);
          return {
            team: t,
            count: ta.length,
            totalSchedule: ta.reduce((s, a) => s + a.schedule, 0),
            totalUpdate: ta.reduce((s, a) => s + a.update, 0),
          };
        })
        .filter((s) => s.count > 0),
    [teams, primaryFiltered, teamFilter],
  );

  const teamBarData = teamSummaries.map((s) => ({
    name: s.team.name,
    Schedule: s.totalSchedule,
    Update: s.totalUpdate,
  }));
  const agentBarData = [...primaryFiltered]
    .sort((a, b) => b.schedule - a.schedule)
    .slice(0, 12)
    .map((a) => ({ name: a.name.split(" ")[0], schedule: a.schedule, update: a.update }));

  const handleExportCSV = () => {
    exportToCSV(
      "csr_daily_report",
      ["Team", "Position", "Name", "Locations", "Schedule", "Update"],
      filtered.map((a) => [
        teamName(a.teamKey),
        a.role === "Team Leader" ? "Team Leader" : "CSR Agent",
        a.name,
        a.locations.join("; "),
        a.schedule,
        a.update,
      ]),
    );
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link
            to="/m/$module/$submodule"
            params={{ module: "dashboard", submodule: "csr-dashboard" }}
            className="btn hover:bg-white/15"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-2xl font-bold">{sub.title}</h1>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
        )}

        {/* Top-bar filters */}
        <div className="panel mb-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="glass-input text-sm py-1.5 px-3 rounded-md"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="glass-input text-sm py-1.5 px-3 rounded-md"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Team</label>
              <select
                value={teamFilter}
                onChange={(e) => setTeamFilter(e.target.value)}
                className="glass-input text-sm py-1.5 px-3 rounded-md"
              >
                <option value="">All Teams</option>
                {teams.map((t) => (
                  <option key={t.key} value={t.key}>{t.name}</option>
                ))}
                <option value={UNASSIGNED}>Unassigned</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Location</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input
                  value={locationFilter}
                  onChange={(e) => setLocationFilter(e.target.value)}
                  placeholder="Search location…"
                  className="glass-input text-sm py-1.5 pl-8 pr-3 rounded-md w-44"
                />
              </div>
            </div>
            {(teamFilter || locationFilter || dateFrom || dateTo) && (
              <button
                onClick={() => {
                  setTeamFilter("");
                  setLocationFilter("");
                  setDateFrom("");
                  setDateTo("");
                }}
                className="btn text-sm px-3 mb-0.5"
              >
                Clear
              </button>
            )}
            <span className="text-sm text-muted-foreground mb-0.5">
              {primaryFiltered.length} of {agents.length} agents
            </span>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            Schedule/Update counts reflect ticket status &amp; reschedule changes made by each CSR (from the ticket audit trail), optionally narrowed by Date From/To.
          </p>
        </div>

        {loading ? (
          <div className="panel p-8 mb-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading CSR Daily Report…
          </div>
        ) : agents.length === 0 ? (
          <p className="panel p-8 mb-6 text-center text-sm text-muted-foreground">
            No CSR Agents or CSR Team Leaders found. Add them in User Management with role "CSR Agent" or "CSR Team Leader" first.
          </p>
        ) : (
        <>
        {/* Team summary cards */}
        {teamSummaries.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            {teamSummaries.map((s) => (
              <div key={s.team.key} className="panel p-4">
                <p className="text-xs font-semibold mb-2" style={{ color: s.team.color }}>
                  {s.team.name}
                </p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <span className="text-muted-foreground">Agents</span>
                  <span className="text-right font-medium">{s.count}</span>
                  <span className="text-muted-foreground">Schedule</span>
                  <span className="text-right text-green-300">{s.totalSchedule}</span>
                  <span className="text-muted-foreground">Update</span>
                  <span className="text-right">{s.totalUpdate}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Team Performance Comparison</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={teamBarData} margin={{ left: -10 }}>
                <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--foreground)", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                <Bar dataKey="Schedule" fill="#34d399" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Update" fill="#fb923c" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Schedule Trend — Last 10 Days</p>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trend} margin={{ left: -10 }}>
                <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--foreground)", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                <Line type="monotone" dataKey="schedule" stroke="#34d399" strokeWidth={2} dot={{ r: 3 }} name="Schedule" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {agentBarData.length > 0 && (
          <div className="panel p-4 mb-4">
            <p className="text-sm font-semibold mb-4">Agent — Schedule &amp; Update (top 12)</p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={agentBarData} margin={{ left: -10 }}>
                <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--foreground)", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                <Bar dataKey="schedule" fill="#34d399" radius={[4, 4, 0, 0]} name="Schedule" />
                <Bar dataKey="update" fill="#fb923c" radius={[4, 4, 0, 0]} name="Update" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── Agent Details Table ── */}
        <div className="panel overflow-x-auto p-0">
          {/* Table header with inline filters */}
          <div className="px-4 py-3 border-b border-white/10">
            <div className="flex flex-wrap items-end gap-3">
              <span className="font-semibold text-sm mr-1">Agent Details</span>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Employee Name</label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    value={tblNameSearch}
                    onChange={(e) => setTblNameSearch(e.target.value)}
                    placeholder="Search name…"
                    className="glass-input text-sm py-1.5 pl-8 pr-3 rounded-md w-40"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Team</label>
                <select
                  value={tblTeam}
                  onChange={(e) => setTblTeam(e.target.value)}
                  className="glass-input text-sm py-1.5 px-3 rounded-md"
                >
                  <option value="">All Teams</option>
                  {teams.map((t) => (
                    <option key={t.key} value={t.key}>{t.name}</option>
                  ))}
                  <option value={UNASSIGNED}>Unassigned</option>
                </select>
              </div>
              {tblHasFilters && (
                <button
                  onClick={clearTblFilters}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-white/10 border border-white/10 transition-colors self-end mb-0.5"
                >
                  <X className="h-3.5 w-3.5" />Clear
                </button>
              )}
              <div className="ml-auto flex items-center gap-2 self-end mb-0.5">
                <span className="text-xs text-muted-foreground">
                  {filtered.length}
                  {tblHasFilters && filtered.length !== primaryFiltered.length ? ` of ${primaryFiltered.length}` : ""} agents
                </span>
                <button
                  onClick={handleExportCSV}
                  title="Download CSV"
                  className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-3 py-2.5 text-left text-xs text-muted-foreground uppercase whitespace-nowrap">Team</th>
                <th className="px-3 py-2.5 text-left text-xs text-muted-foreground uppercase whitespace-nowrap">Position</th>
                <th className="px-3 py-2.5 text-left text-xs text-muted-foreground uppercase whitespace-nowrap">Name</th>
                <th className="px-3 py-2.5 text-right text-xs text-muted-foreground uppercase whitespace-nowrap w-24">Schedule</th>
                <th className="px-3 py-2.5 text-right text-xs text-muted-foreground uppercase whitespace-nowrap w-24">Update</th>
                <th className="px-3 py-2.5 text-center text-xs text-muted-foreground uppercase whitespace-nowrap w-20">Details</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    No records match filters.
                  </td>
                </tr>
              ) : (
                filtered.map((a, i) => (
                  <tr
                    key={a.id + i}
                    className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}
                  >
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap" style={{ color: teamColor(a.teamKey) }}>
                      {teamName(a.teamKey)}
                    </td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap text-muted-foreground">
                      {a.role === "Team Leader" ? "Team Leader" : "CSR Agent"}
                    </td>
                    <td className="px-3 py-2.5 font-medium whitespace-nowrap">{a.name}</td>
                    <td className="px-3 py-2.5 text-right text-green-400 w-24">{a.schedule}</td>
                    <td className="px-3 py-2.5 text-right w-24">{a.update}</td>
                    <td className="px-3 py-2.5 text-center w-20">
                      <button
                        type="button"
                        onClick={() => setDetailsAgent(a)}
                        title={`View details for ${a.name}`}
                        className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        </>
        )}

        {/* ── Agent Details Modal ── */}
        {detailsAgent && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setDetailsAgent(null)}>
            <div className="bg-slate-900 border border-white/15 rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-slate-950 rounded-t-xl">
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-blue-400" />
                  <span className="font-semibold">{detailsAgent.name}</span>
                  <span className="text-xs font-semibold" style={{ color: teamColor(detailsAgent.teamKey) }}>{teamName(detailsAgent.teamKey)}</span>
                </div>
                <button onClick={() => setDetailsAgent(null)} className="text-white/30 hover:text-white/70 transition-colors"><X className="h-5 w-5" /></button>
              </div>

              <div className="px-5 py-4 overflow-y-auto space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Role</p>
                    <p className="font-medium">{detailsAgent.role === "Team Leader" ? "Team Leader" : "CSR Agent"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Username</p>
                    <p className="font-medium">{detailsAgent.username || "—"}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Email</p>
                    <p className="font-medium truncate">{detailsAgent.email || "—"}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="panel p-3 text-center">
                    <p className="text-2xl font-bold text-green-300">{detailsAgent.schedule}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Schedule</p>
                  </div>
                  <div className="panel p-3 text-center">
                    <p className="text-2xl font-bold text-purple-300">{detailsAgent.update}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Update</p>
                  </div>
                </div>

                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">
                    Locations <span className="text-muted-foreground/70">({detailsAgent.locations.length})</span>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {detailsAgent.locations.length === 0 ? (
                      <span className="text-sm text-muted-foreground">—</span>
                    ) : detailsAgent.locations.map((loc) => (
                      <span key={loc} className="px-2 py-0.5 rounded text-xs font-medium bg-blue-500/15 text-blue-300 border border-blue-500/20">
                        {loc}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
