import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Download, Loader2, Search } from "lucide-react";
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
import * as XLSX from "xlsx";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getCompanyUsers } from "@/lib/supabase/users";
import { getTicketAuditLog } from "@/lib/supabase/tickets";
import { getCsrTeamComposition } from "@/lib/supabase/csrTeams";
import { getAllAgentNotes } from "@/lib/supabase/csrAgentNotes";
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
  warnings: number; // approved warning notes, narrowed by Date From/To like everything else here
  mistakes: number; // approved mistake notes, narrowed by Date From/To like everything else here
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

export function ReportCSRDaily({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [teams, setTeams] = useState<TeamMeta[]>([]);

  // Top-bar filters
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [profiles, auditLog, composition, allNotes] = await Promise.all([
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
          getAllAgentNotes().catch((err) => {
            console.error("Failed to load agent notes:", err);
            return [];
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

        // Only approved notes count toward the official tally — same rule as
        // the agent detail page — narrowed by Date From/To, or all-time when blank.
        const warningCount = new Map<string, number>();
        const mistakeCount = new Map<string, number>();
        for (const n of allNotes) {
          if (n.status !== "approved") continue;
          const day = n.createdAt.slice(0, 10);
          if (dateFrom && day < dateFrom) continue;
          if (dateTo && day > dateTo) continue;
          if (n.type === "warning") warningCount.set(n.agentProfileId, (warningCount.get(n.agentProfileId) ?? 0) + 1);
          if (n.type === "mistake") mistakeCount.set(n.agentProfileId, (mistakeCount.get(n.agentProfileId) ?? 0) + 1);
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
            warnings: warningCount.get(p.id) ?? 0,
            mistakes: mistakeCount.get(p.id) ?? 0,
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

  // Primary filtered list (top-bar filters)
  const primaryFiltered = useMemo<Agent[]>(() => {
    let a = agents;
    if (teamFilter) a = a.filter((x) => x.teamKey === teamFilter);
    if (locationFilter)
      a = a.filter((x) => x.locations.some((l) => l.toLowerCase().includes(locationFilter.toLowerCase())));
    return a;
  }, [agents, teamFilter, locationFilter]);

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
            totalWarnings: ta.reduce((s, a) => s + a.warnings, 0),
            totalMistakes: ta.reduce((s, a) => s + a.mistakes, 0),
          };
        })
        .filter((s) => s.count > 0),
    [teams, primaryFiltered, teamFilter],
  );

  const teamBarData = teamSummaries.map((s) => ({
    name: s.team.name,
    Schedule: s.totalSchedule,
    Update: s.totalUpdate,
    Warnings: s.totalWarnings,
    Mistakes: s.totalMistakes,
  }));
  const companyTotals = useMemo(() => ({
    agents: primaryFiltered.length,
    schedule: primaryFiltered.reduce((s, a) => s + a.schedule, 0),
    update: primaryFiltered.reduce((s, a) => s + a.update, 0),
    warnings: primaryFiltered.reduce((s, a) => s + a.warnings, 0),
    mistakes: primaryFiltered.reduce((s, a) => s + a.mistakes, 0),
  }), [primaryFiltered]);

  const exportToXlsx = () => {
    const sheet: (string | number)[][] = [
      ["CSR Daily Report"],
      [`Period: ${dateFrom || "All time"} to ${dateTo || "All time"}`],
      [`Generated: ${new Date().toLocaleString()}`],
      [],
      ["Summary"],
      ["Metric", "Value"],
      ["Total Agents", companyTotals.agents],
      ["Schedule", companyTotals.schedule],
      ["Update", companyTotals.update],
      ["Warnings", companyTotals.warnings],
      ["Mistakes", companyTotals.mistakes],
      [],
      ["By Team"],
      ["Team", "Agents", "Schedule", "Update", "Warnings", "Mistakes"],
      ...teamSummaries.map((s) => [s.team.name, s.count, s.totalSchedule, s.totalUpdate, s.totalWarnings, s.totalMistakes]),
      [],
      ["Schedule Trend — Last 10 Days"],
      ["Date", "Schedule"],
      ...trend.map((t) => [t.date, t.schedule]),
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(sheet);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "CSR Report");
    XLSX.writeFile(workbook, `csr-daily-report_${dateFrom || "all"}_to_${dateTo || "all"}.xlsx`);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link
            to="/m/$module"
            params={{ module: mod.slug }}
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
            <button onClick={exportToXlsx} className="btn text-sm px-3 mb-0.5 flex items-center gap-1.5 ml-auto">
              <Download className="h-3.5 w-3.5" /> Download XLSX
            </button>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            Schedule/Update counts reflect ticket status &amp; reschedule changes made by each CSR (from the ticket audit trail); Warnings/Mistakes reflect approved notes only. Leave Date From/To blank for all-time totals, or narrow either.
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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-6">
            {teamSummaries.map((s) => (
              <div key={s.team.key} className="panel p-2.5">
                <p className="text-xs font-semibold mb-1.5 truncate" style={{ color: s.team.color }}>
                  {s.team.name}
                </p>
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px]">
                  <span className="text-muted-foreground">Agents</span>
                  <span className="text-right font-medium">{s.count}</span>
                  <span className="text-muted-foreground">Schedule</span>
                  <span className="text-right text-green-300">{s.totalSchedule}</span>
                  <span className="text-muted-foreground">Update</span>
                  <span className="text-right text-orange-300">{s.totalUpdate}</span>
                  <span className="text-muted-foreground">Warnings</span>
                  <span className="text-right text-yellow-300">{s.totalWarnings}</span>
                  <span className="text-muted-foreground">Mistakes</span>
                  <span className="text-right text-red-300">{s.totalMistakes}</span>
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
                <Bar dataKey="Warnings" fill="#facc15" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Mistakes" fill="#f87171" radius={[4, 4, 0, 0]} />
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

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            ["Total Agents", companyTotals.agents, "text-white"],
            ["Schedule", companyTotals.schedule, "text-green-300"],
            ["Update", companyTotals.update, "text-orange-300"],
            ["Warnings", companyTotals.warnings, "text-yellow-300"],
            ["Mistakes", companyTotals.mistakes, "text-red-300"],
          ].map(([label, value, color]) => (
            <div key={label as string} className="panel p-3 text-center">
              <p className={`text-lg font-bold ${color}`}>{value}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{label}</p>
            </div>
          ))}
        </div>
        </>
        )}
      </main>
    </div>
  );
}
