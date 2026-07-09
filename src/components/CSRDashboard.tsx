import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { CsrTeamComposition } from "@/components/CsrTeamComposition";
import { useAuth } from "@/lib/auth";
import { normalizeRole } from "@/lib/roleLabels";
import {
  AlertTriangle,
  CheckCircle,
  ChevronLeft,
  Loader2,
  MessageSquare,
  Search,
  Users,
  XCircle,
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
import { getCompanyUsers } from "@/lib/supabase/users";
import { getTicketAuditLog } from "@/lib/supabase/tickets";
import { getCsrTeamComposition } from "@/lib/supabase/csrTeams";
import { getPendingAgentNotes, reviewAgentNote, type CsrAgentNote } from "@/lib/supabase/csrAgentNotes";
import { LOCATIONS, mergeLocationOptions, parseBranchAccess } from "@/lib/locations";

const COLORS = ["#3b82f6", "#34d399", "#a78bfa", "#fb923c", "#f472b6", "#facc15"];
// Stage 1 of the two-stage review chain (Team Leader submits -> CSR
// Manager reviews first -> HR makes the final call). This panel only
// handles stage 1 — items CSR Managers weigh in on before they go to HR.
const STAGE1_REVIEWER_ROLES = new Set(["CSR_MANAGER", "MANAGER", "ADMIN", "SUPERADMIN"]);

interface Agent {
  id: string;
  name: string;
  teamKey: string | null; // null = not yet placed on a team (Team Composition)
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

export function CSRDashboard({ mod }: { mod: ModuleDef; sub: SubModuleDef }) {
  const { role, ready } = useAuth();
  const navigate = useNavigate();
  const normalizedRole = normalizeRole(role);
  // CSR Agents and Team Leaders don't get the org-wide manager overview —
  // they land on their own Personal + Team dashboard instead.
  const shouldRedirectToPersonalDashboard = normalizedRole === "CSR_AGENT" || normalizedRole === "CSR_TEAM_LEADER";
  const isCsrManager = normalizedRole === "CSR_MANAGER";
  const canReviewNotes = ready && STAGE1_REVIEWER_ROLES.has(normalizedRole);

  useEffect(() => {
    if (ready && shouldRedirectToPersonalDashboard) {
      navigate({ to: "/m/$module/$submodule", params: { module: "dashboard", submodule: "csr-team-leader-dashboard" } });
    }
  }, [ready, shouldRedirectToPersonalDashboard, navigate]);

  const [pendingNotes, setPendingNotes] = useState<CsrAgentNote[]>([]);
  const [pendingNotesLoading, setPendingNotesLoading] = useState(true);
  const loadPendingNotes = async () => {
    try {
      setPendingNotesLoading(true);
      // getPendingAgentNotes() returns both stages — this panel is stage 1 only.
      setPendingNotes((await getPendingAgentNotes()).filter((n) => n.status === "pending"));
    } catch (err) {
      console.error("Failed to load pending agent notes:", err);
    } finally {
      setPendingNotesLoading(false);
    }
  };
  useEffect(() => {
    if (canReviewNotes) loadPendingNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReviewNotes]);
  const decideNote = async (id: string, status: "manager_approved" | "rejected") => {
    try {
      await reviewAgentNote(id, status);
      await loadPendingNotes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update review status.");
    }
  };

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [teams, setTeams] = useState<TeamMeta[]>([]);

  // ── Filters ──
  const [locationSearchFilter, setLocationSearchFilter] = useState("All Locations");
  const [teamFilter, setTeamFilter] = useState<string>("");
  const [agentSearch, setAgentSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showPieLabels, setShowPieLabels] = useState(true);
  const [showTeamComposition, setShowTeamComposition] = useState(false);

  const locationOptions = useMemo(
    () => ["All Locations", ...mergeLocationOptions(LOCATIONS, agents.flatMap((a) => a.locations))],
    [agents],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        // Team composition lives in its own tables (added by a migration that
        // may not have been run yet) — fetch it separately so a missing/broken
        // csr_teams table degrades to "no teams assigned" instead of blanking
        // out the whole roster and KPIs below.
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

        const teamOf = new Map<string, string>(); // profileId -> teamId
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
            teamKey: teamOf.get(p.id) ?? null,
            locations: branchesOf(p.assigned_branch, p.branch_access),
            schedule: scheduleCount.get(p.id) ?? 0,
            update: updateCount.get(p.id) ?? 0,
          }));

        setAgents(roster);
        setTeams(composition.teams.map((t) => ({ key: t.id, name: t.name, color: t.color })));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load CSR Dashboard data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [dateFrom, dateTo]);

  const filteredAgents = useMemo(() => {
    return agents.filter((a) => {
      const matchLocation = locationSearchFilter === "All Locations" || a.locations.includes(locationSearchFilter);
      const matchTeam = !teamFilter || a.teamKey === teamFilter;
      const q = agentSearch.toLowerCase();
      const matchSearch = !q || a.name.toLowerCase().includes(q);
      return matchLocation && matchTeam && matchSearch;
    });
  }, [agents, locationSearchFilter, teamFilter, agentSearch]);

  const totals = useMemo(
    () =>
      filteredAgents.reduce(
        (acc, a) => ({
          agents: acc.agents + 1,
          schedule: acc.schedule + a.schedule,
          update: acc.update + a.update,
        }),
        { agents: 0, schedule: 0, update: 0 },
      ),
    [filteredAgents],
  );

  const teamData = useMemo(
    () =>
      teams
        .map((t) => {
          const ta = filteredAgents.filter((a) => a.teamKey === t.key);
          return {
            key: t.key,
            name: t.name,
            color: t.color,
            agents: ta.length,
            schedule: ta.reduce((s, a) => s + a.schedule, 0),
            update: ta.reduce((s, a) => s + a.update, 0),
          };
        })
        .filter((t) => t.agents > 0),
    [teams, filteredAgents],
  );

  const agentNameById = useMemo(() => new Map(agents.map((a) => [a.id, a.name])), [agents]);

  const locationBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    filteredAgents.forEach((a) => {
      a.locations.forEach((loc) => {
        map[loc] = (map[loc] || 0) + 1;
      });
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [filteredAgents]);

  // Waiting on auth to resolve, or mid-redirect to the personal dashboard —
  // don't flash the manager-only overview in either case.
  if (!ready || shouldRedirectToPersonalDashboard) {
    return (
      <div className="min-h-screen flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

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
            { slug: "csr-team-leader-dashboard", label: "My Team Dashboard", icon: "🧑‍💼" },
            { slug: "csr-daily-report", label: "CSR Daily Report", icon: "📋" },
            { slug: "csr-status-summary", label: "Status Summary", icon: "📊" },
          ]
            // CSR Managers oversee every team, not one of their own — the
            // personal/team dashboard doesn't apply to them.
            .filter((item) => !(isCsrManager && item.slug === "csr-team-leader-dashboard"))
            .map((item) => (
            <Link
              key={item.slug}
              to="/m/$module/$submodule"
              params={{ module: "dashboard", submodule: item.slug }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-sm font-medium transition-colors"
            >
              <span>{item.icon}</span>{item.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setShowTeamComposition((v) => !v)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${showTeamComposition ? "border-primary/40 bg-primary/15 text-primary" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
          >
            <span>👥</span>Team Composition
          </button>
        </div>

        {/* Pending warning/mistake submissions awaiting a manager's decision. */}
        {canReviewNotes && (
          <div className="panel p-4 mb-6">
            <p className="text-sm font-semibold mb-3 flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 text-yellow-400" /> Pending Reviews
              {pendingNotes.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-yellow-500/15 text-yellow-300 border border-yellow-500/25">{pendingNotes.length}</span>
              )}
            </p>
            {pendingNotesLoading ? (
              <p className="text-xs text-muted-foreground py-2">Loading…</p>
            ) : pendingNotes.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">Nothing waiting on review.</p>
            ) : (
              <div className="space-y-2">
                {pendingNotes.map((n) => (
                  <div key={n.id} className="rounded-lg border border-white/10 bg-white/5 p-3 flex items-start gap-3">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${n.type === "warning" ? "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30" : "bg-orange-500/20 text-orange-300 border border-orange-500/30"}`}>
                      {n.type === "warning" ? "Warning" : "Mistake"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs">
                        <span className="font-semibold">{agentNameById.get(n.agentProfileId) || "Unknown agent"}</span> — {n.note}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {n.ticketNo && <>Ticket <span className="font-mono text-blue-400">{n.ticketNo}</span> · </>}
                        Submitted by {n.createdByName || "Unknown"} · {new Date(n.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => decideNote(n.id, "manager_approved")}
                        title="Sends to HR for the final decision"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-green-500/15 text-green-300 border border-green-500/30 hover:bg-green-500/25 transition-colors"
                      >
                        <CheckCircle className="h-3 w-3" /> Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => decideNote(n.id, "rejected")}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25 transition-colors"
                      >
                        <XCircle className="h-3 w-3" /> Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {showTeamComposition && <CsrTeamComposition />}

        {!showTeamComposition && (<>
        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
        )}

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
                {locationOptions.map((s) => (
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
                {teams.map((t) => (
                  <option key={t.key} value={t.key}>{t.name}</option>
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
          <p className="mt-2 text-[10px] text-muted-foreground">
            Schedule/Update counts reflect ticket status &amp; reschedule changes made by each CSR (from the ticket audit trail), optionally narrowed by Date From/To.
          </p>
        </div>

        {loading ? (
          <div className="panel p-8 mb-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading CSR Dashboard…
          </div>
        ) : agents.length === 0 ? (
          <p className="panel p-8 mb-6 text-center text-sm text-muted-foreground">
            No CSR Agents or CSR Team Leaders found. Add them in User Management with role "CSR Agent" or "CSR Team Leader" first.
          </p>
        ) : (
        <>
        {/* KPI cards */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: "Agents", value: totals.agents, color: "text-white", icon: <Users className="h-4 w-4" /> },
            { label: "Schedule", value: totals.schedule, color: "text-green-300", icon: <CheckCircle className="h-4 w-4" /> },
            { label: "Update", value: totals.update, color: "text-purple-300", icon: <MessageSquare className="h-4 w-4" /> },
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
                {/* Team names move to the legend row below instead of
                    crowding the axis as tick labels. */}
                <XAxis dataKey="name" tick={false} axisLine={{ stroke: "rgba(148,163,184,0.3)" }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 6, color: "#0f172a", fontSize: 12, fontWeight: 600, boxShadow: "0 4px 12px rgba(0,0,0,0.3)" }} />
                <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                <Bar dataKey="schedule" fill="#34d399" radius={[4, 4, 0, 0]} name="Schedule" />
                <Bar dataKey="update" fill="#a78bfa" radius={[4, 4, 0, 0]} name="Update" />
              </BarChart>
            </ResponsiveContainer>
            {/* Team legend — which bar group is which team, plus each
                team's Agents/Schedule/Update, so this replaces the old
                per-team card grid entirely. */}
            <div className="mt-3 pt-3 border-t border-white/10 divide-y divide-white/5">
              {teamData.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2 text-center">
                  No agents placed on a team yet — use Team Composition to assign them.
                </p>
              ) : teamData.map((t) => (
                <div key={t.key} className="flex items-center gap-3 py-1.5 px-1 hover:bg-white/5 rounded">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: t.color }} />
                  <span className="text-xs font-semibold flex-1 min-w-0 truncate" style={{ color: t.color }}>{t.name}</span>
                  <span className="text-[10px] text-muted-foreground w-16 text-right shrink-0">{t.agents} agent{t.agents === 1 ? "" : "s"}</span>
                  <span className="text-[10px] text-green-300 w-14 text-right shrink-0">Sch {t.schedule}</span>
                  <span className="text-[10px] text-purple-300 w-14 text-right shrink-0">Upd {t.update}</span>
                </div>
              ))}
            </div>
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
        </>
        )}
        </>)}
      </main>
    </div>
  );
}
