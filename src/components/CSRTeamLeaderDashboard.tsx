/**
 * CSR Team Leader Dashboard — a personalized view for a CSR (agent or team
 * leader) of their own numbers plus their team's, side by side.
 *
 * - Personal Tracker: my own Schedule/Update counts (from the ticket audit
 *   trail) and my most recent ticket activity.
 * - Team Dashboard: whichever team Team Composition currently has me on —
 *   every member's individual numbers plus team totals. Since this reads
 *   Team Composition fresh on every load, it automatically reflects
 *   whoever is actually on the team right now, with no separate wiring.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle, ChevronLeft, Clock, Loader2, MessageSquare, Users } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { getCompanyUsers, getMyProfileId } from "@/lib/supabase/users";
import { getCompanyTickets, getTicketAuditLog } from "@/lib/supabase/tickets";
import { getCsrTeamComposition } from "@/lib/supabase/csrTeams";
import { parseBranchAccess } from "@/lib/locations";

interface Member {
  id: string;
  name: string;
  isLeader: boolean;
  schedule: number;
  update: number;
}

interface RecentEntry {
  ticketNo: string;
  action: string;
  field: string;
  when: string;
}

const ACTION_LABELS: Record<string, string> = {
  status_change: "Status Change",
  reassign: "Technician Reassigned",
  reschedule: "Rescheduled",
};

const branchesOf = (assignedBranch: string | null, branchAccess: string | null): string[] => {
  const raw = [assignedBranch ?? "", ...parseBranchAccess(branchAccess)];
  return Array.from(new Set(raw.map((s) => s.trim()).filter(Boolean)));
};

export function CSRTeamLeaderDashboard({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const { uid } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [myId, setMyId] = useState<string | null>(null);
  const [myName, setMyName] = useState("");
  const [myIsLeader, setMyIsLeader] = useState(false);
  const [myLocations, setMyLocations] = useState<string[]>([]);
  const [mySchedule, setMySchedule] = useState(0);
  const [myUpdate, setMyUpdate] = useState(0);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [locationsExpanded, setLocationsExpanded] = useState(false);

  const [teamName, setTeamName] = useState("");
  const [teamColor, setTeamColor] = useState("#3b82f6");
  const [members, setMembers] = useState<Member[]>([]);
  const [isCsr, setIsCsr] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        if (!uid) { setLoading(false); return; }

        const [myProfileId, profiles, composition, auditLog, tickets] = await Promise.all([
          getMyProfileId(uid),
          getCompanyUsers(),
          getCsrTeamComposition().catch((err) => {
            console.error("Failed to load CSR team composition:", err);
            return { teams: [], members: [] };
          }),
          getTicketAuditLog({ startDate: dateFrom || undefined, endDate: dateTo || undefined }),
          getCompanyTickets(),
        ]);
        if (cancelled) return;
        if (!myProfileId) { setError("Could not find your profile."); setLoading(false); return; }
        setMyId(myProfileId);

        const me = profiles.find((p) => p.id === myProfileId);
        if (!me) { setError("Could not find your profile."); setLoading(false); return; }
        const meExtras = me.extra_roles || [];
        const meIsCsr = me.role === "CSR_AGENT" || me.role === "CSR_TEAM_LEADER" || meExtras.includes("CSR_AGENT") || meExtras.includes("CSR_TEAM_LEADER");
        setIsCsr(meIsCsr);
        setMyName(me.display_name || me.username || me.email || "You");
        setMyIsLeader(me.role === "CSR_TEAM_LEADER" || meExtras.includes("CSR_TEAM_LEADER"));
        setMyLocations(branchesOf(me.assigned_branch, me.branch_access));

        // Schedule = reschedule actions, Update = status_change actions —
        // same definitions used on the CSR Dashboard / Daily Report.
        const scheduleCount = new Map<string, number>();
        const updateCount = new Map<string, number>();
        for (const e of auditLog) {
          if (!e.changedBy) continue;
          if (e.action === "reschedule") scheduleCount.set(e.changedBy, (scheduleCount.get(e.changedBy) ?? 0) + 1);
          if (e.action === "status_change") updateCount.set(e.changedBy, (updateCount.get(e.changedBy) ?? 0) + 1);
        }
        setMySchedule(scheduleCount.get(myProfileId) ?? 0);
        setMyUpdate(updateCount.get(myProfileId) ?? 0);

        const ticketMeta = new Map<string, string>();
        for (const t of tickets as any[]) if (t._id) ticketMeta.set(t._id, t.ticketNo);
        setRecent(
          auditLog
            .filter((e) => e.changedBy === myProfileId)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 15)
            .map((e) => ({ ticketNo: ticketMeta.get(e.ticketId) || "—", action: e.action, field: e.field, when: e.createdAt })),
        );

        const teamOf = new Map<string, string>();
        for (const m of composition.members) teamOf.set(m.profileId, m.teamId);
        const myTeamId = teamOf.get(myProfileId) ?? null;
        const team = composition.teams.find((t) => t.id === myTeamId);
        setTeamName(team?.name ?? "");
        setTeamColor(team?.color ?? "#3b82f6");

        const roster = profiles.filter((p) => {
          const extras = p.extra_roles || [];
          return p.role === "CSR_AGENT" || p.role === "CSR_TEAM_LEADER" || extras.includes("CSR_AGENT") || extras.includes("CSR_TEAM_LEADER");
        });
        const teamMembers: Member[] = myTeamId
          ? roster
              .filter((p) => teamOf.get(p.id) === myTeamId)
              .map((p) => ({
                id: p.id,
                name: p.display_name || p.username || p.email,
                isLeader: p.role === "CSR_TEAM_LEADER" || (p.extra_roles || []).includes("CSR_TEAM_LEADER"),
                schedule: scheduleCount.get(p.id) ?? 0,
                update: updateCount.get(p.id) ?? 0,
              }))
              .sort((a, b) => (b.schedule + b.update) - (a.schedule + a.update))
          : [];
        setMembers(teamMembers);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load your dashboard.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [uid, dateFrom, dateTo]);

  const teamTotals = useMemo(
    () => members.reduce((acc, m) => ({ schedule: acc.schedule + m.schedule, update: acc.update + m.update }), { schedule: 0, update: 0 }),
    [members],
  );

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <div className="flex items-center gap-3 mb-2">
          <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">{sub.title}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">{myName ? `Signed in as ${myName}` : sub.description}</p>
          </div>
        </div>

        {/* Filters */}
        <div className="panel p-4 mb-6 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Date From</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="glass-input mt-1 w-full" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Date To</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="glass-input mt-1 w-full" />
            </div>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            Schedule/Update counts reflect ticket status &amp; reschedule changes (from the ticket audit trail), optionally narrowed by Date From/To.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
        )}

        {loading ? (
          <div className="panel p-8 mb-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your dashboard…
          </div>
        ) : !isCsr ? (
          <p className="panel p-8 text-center text-sm text-muted-foreground">
            This dashboard is for CSR Agents and CSR Team Leaders. Your account isn't set up with either role — ask your manager to update it in User Management if that's not right.
          </p>
        ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ── Personal Tracker ── */}
          <div className="panel p-4">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold">Personal Tracker</h3>
              <span className="text-xs text-muted-foreground">{myIsLeader ? "Team Leader" : "CSR Agent"}</span>
            </div>

            {myLocations.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-4">
                {(locationsExpanded ? myLocations : myLocations.slice(0, 6)).map((loc) => (
                  <span key={loc} className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/15 text-blue-300 border border-blue-500/20">
                    {loc}
                  </span>
                ))}
                {myLocations.length > 6 && (
                  <button
                    type="button"
                    onClick={() => setLocationsExpanded((v) => !v)}
                    className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/10 text-muted-foreground border border-white/15 hover:bg-white/15 hover:text-foreground transition-colors"
                  >
                    {locationsExpanded ? "Show less" : `+${myLocations.length - 6} more`}
                  </button>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="panel p-3 text-center">
                <div className="flex justify-center mb-1 text-muted-foreground"><CheckCircle className="h-4 w-4" /></div>
                <p className="text-2xl font-bold text-green-300">{mySchedule}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Schedule</p>
              </div>
              <div className="panel p-3 text-center">
                <div className="flex justify-center mb-1 text-muted-foreground"><MessageSquare className="h-4 w-4" /></div>
                <p className="text-2xl font-bold text-purple-300">{myUpdate}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Update</p>
              </div>
            </div>

            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">My Recent Activity</p>
            <div className="rounded-lg border border-white/10 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-white/5 border-b border-white/10">
                    <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground">Ticket</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground">Action</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground">When</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.length === 0 ? (
                    <tr><td colSpan={3} className="px-2 py-6 text-center text-muted-foreground">No recent activity in this range.</td></tr>
                  ) : recent.map((r, i) => (
                    <tr key={i} className="border-b border-white/5">
                      <td className="px-2 py-1.5 font-mono text-blue-400">{r.ticketNo}</td>
                      <td className="px-2 py-1.5">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30">
                          {ACTION_LABELS[r.action] ?? r.action}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">{new Date(r.when).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Team Dashboard ── */}
          <div className="panel p-4">
            <div className="flex items-center gap-2 mb-4">
              <Users className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold">Team Dashboard</h3>
              {teamName && (
                <span className="text-xs font-semibold" style={{ color: teamColor }}>{teamName}</span>
              )}
            </div>

            {!teamName ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                You're not currently placed on a team. Ask your manager to add you via Team Composition on the CSR Dashboard.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="panel p-3 text-center">
                    <p className="text-2xl font-bold">{members.length}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Agents</p>
                  </div>
                  <div className="panel p-3 text-center">
                    <p className="text-2xl font-bold text-green-300">{teamTotals.schedule}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Schedule</p>
                  </div>
                  <div className="panel p-3 text-center">
                    <p className="text-2xl font-bold text-purple-300">{teamTotals.update}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Update</p>
                  </div>
                </div>

                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Team Members</p>
                <div className="rounded-lg border border-white/10 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-white/5 border-b border-white/10">
                        <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground">Name</th>
                        <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground">Role</th>
                        <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground">Schedule</th>
                        <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground">Update</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((m) => (
                        <tr key={m.id} className={`border-b border-white/5 ${m.id === myId ? "bg-primary/10" : ""}`}>
                          <td className="px-2 py-1.5 font-medium">
                            {m.name}{m.id === myId && <span className="text-muted-foreground"> (you)</span>}
                          </td>
                          <td className="px-2 py-1.5 text-muted-foreground">{m.isLeader ? "Team Leader" : "CSR Agent"}</td>
                          <td className="px-2 py-1.5 text-right text-green-400">{m.schedule}</td>
                          <td className="px-2 py-1.5 text-right">{m.update}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
        )}
      </main>
    </div>
  );
}
