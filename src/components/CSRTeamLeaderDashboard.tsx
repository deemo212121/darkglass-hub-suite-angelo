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
import { AlertTriangle, CheckCircle, ChevronLeft, Clock, Loader2, MessageSquare, ShieldAlert, Users } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { getCompanyUsers, getMyProfileId } from "@/lib/supabase/users";
import { getCompanyTickets, getTicketAuditLog } from "@/lib/supabase/tickets";
import { getCsrTeamComposition } from "@/lib/supabase/csrTeams";
import { getAgentNotes, getNotesSubmittedBy, type CsrAgentNote, type CsrAgentNoteStatus } from "@/lib/supabase/csrAgentNotes";
import { parseBranchAccess } from "@/lib/locations";

interface Member {
  id: string;
  name: string;
  isLeader: boolean;
  schedule: number;
  update: number;
}

// A row in "My Recent Activity" is either a real ticket action (from the
// audit trail) or a warning/mistake I submitted about a teammate — merged
// into one timeline so submitting a note shows up right alongside my
// ticket work, with its review outcome once a manager decides on it.
interface RecentEntry {
  kind: "ticket" | "note";
  ticketNo: string;
  action: string;
  when: string;
  resolution?: CsrAgentNoteStatus;
  agentName?: string;
}

const ACTION_LABELS: Record<string, string> = {
  status_change: "Status Change",
  reassign: "Technician Reassigned",
  reschedule: "Rescheduled",
};

const RESOLUTION_BADGE: Record<CsrAgentNoteStatus, string> = {
  pending: "bg-slate-500/20 text-slate-300 border-slate-500/30",
  manager_approved: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  approved: "bg-green-500/20 text-green-300 border-green-500/30",
  rejected: "bg-red-500/20 text-red-300 border-red-500/30",
};
const RESOLUTION_LABEL: Record<CsrAgentNoteStatus, string> = {
  pending: "Pending Manager Review",
  manager_approved: "Awaiting HR",
  approved: "Approved",
  rejected: "Rejected",
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
  const [myWarnings, setMyWarnings] = useState(0);
  const [myMistakes, setMyMistakes] = useState(0);
  const [myNotesList, setMyNotesList] = useState<CsrAgentNote[]>([]);
  const [myNoteTab, setMyNoteTab] = useState<"mistake" | "warning">("mistake");
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

        const [submittedNotes, myNotes] = await Promise.all([
          getNotesSubmittedBy(myProfileId).catch((err) => {
            console.error("Failed to load submitted notes:", err);
            return [];
          }),
          getAgentNotes(myProfileId).catch((err) => {
            console.error("Failed to load my agent notes:", err);
            return [];
          }),
        ]);
        if (cancelled) return;

        // Only approved notes count toward the official tally — same rule
        // as the agent detail page — narrowed by Date From/To like everything else here.
        const myNotesInRange = myNotes.filter((n) => {
          const day = n.createdAt.slice(0, 10);
          if (dateFrom && day < dateFrom) return false;
          if (dateTo && day > dateTo) return false;
          return true;
        });
        setMyWarnings(myNotesInRange.filter((n) => n.type === "warning" && n.status === "approved").length);
        setMyMistakes(myNotesInRange.filter((n) => n.type === "mistake" && n.status === "approved").length);
        // Full detail (every status, not just approved) for the transparency
        // log below — an employee should be able to see everything filed
        // against them, not just what's already official.
        setMyNotesList(myNotesInRange.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));

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
        const profileNameById = new Map(profiles.map((p) => [p.id, p.display_name || p.username || p.email]));

        const ticketEntries: RecentEntry[] = auditLog
          .filter((e) => e.changedBy === myProfileId)
          .map((e) => ({ kind: "ticket" as const, ticketNo: ticketMeta.get(e.ticketId) || "—", action: e.action, when: e.createdAt }));
        const noteEntries: RecentEntry[] = submittedNotes
          .filter((n) => {
            const day = n.createdAt.slice(0, 10);
            if (dateFrom && day < dateFrom) return false;
            if (dateTo && day > dateTo) return false;
            return true;
          })
          .map((n) => ({
            kind: "note" as const,
            ticketNo: n.ticketNo || "—",
            action: n.type,
            when: n.createdAt,
            resolution: n.status,
            agentName: profileNameById.get(n.agentProfileId) || "Unknown",
          }));
        setRecent(
          [...ticketEntries, ...noteEntries]
            .sort((a, b) => b.when.localeCompare(a.when))
            .slice(0, 20),
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
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div>
              <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Date From</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="glass-input mt-1 w-full" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Date To</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="glass-input mt-1 w-full" />
            </div>
            <div>
              <button
                type="button"
                onClick={() => { setDateFrom(""); setDateTo(""); }}
                disabled={!dateFrom && !dateTo}
                className={`btn w-full ${!dateFrom && !dateTo ? "bg-primary/20 border-primary/30" : "hover:bg-white/15"}`}
              >
                All Time
              </button>
            </div>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            Schedule/Update counts reflect ticket status &amp; reschedule changes (from the ticket audit trail), optionally narrowed by Date From/To. Leave both blank — or click All Time — to see your full history.
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
        <div className={`grid grid-cols-1 gap-4 ${myIsLeader ? "lg:grid-cols-2" : ""}`}>
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
              <div className="panel p-3 text-center">
                <div className="flex justify-center mb-1 text-muted-foreground"><AlertTriangle className="h-4 w-4" /></div>
                <p className="text-2xl font-bold text-yellow-300">{myWarnings}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Warnings</p>
              </div>
              <div className="panel p-3 text-center">
                <div className="flex justify-center mb-1 text-muted-foreground"><ShieldAlert className="h-4 w-4" /></div>
                <p className="text-2xl font-bold text-orange-300">{myMistakes}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Mistakes</p>
              </div>
            </div>

            {/* Mistake/Warning Logs — full detail (every status, not just
                approved) so it's actually transparent, not just a tally. */}
            <div className="mb-4">
              <div className="flex items-center gap-1 mb-2 border-b border-white/10">
                {([
                  { key: "mistake", label: "Mistake Logs" },
                  { key: "warning", label: "Warning Logs" },
                ] as const).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setMyNoteTab(tab.key)}
                    className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide border-b-2 -mb-px transition-colors ${myNoteTab === tab.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {myNotesList.filter((n) => n.type === myNoteTab).length === 0 ? (
                  <p className="text-xs text-muted-foreground py-3 text-center">No {myNoteTab === "warning" ? "warnings" : "mistakes"} on file in this range.</p>
                ) : myNotesList.filter((n) => n.type === myNoteTab).map((n) => (
                  <div key={n.id} className="rounded-lg border border-white/10 bg-white/5 p-3">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs">{n.note}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {n.ticketNo && <>Ticket <span className="font-mono text-blue-400">{n.ticketNo}</span> · </>}
                          Submitted by {n.createdByName || "Unknown"} · {new Date(n.createdAt).toLocaleString()}
                          {n.managerReviewedByName && <> · Manager: {n.managerReviewedByName}{n.managerReviewedAt ? ` · ${new Date(n.managerReviewedAt).toLocaleString()}` : ""}</>}
                          {n.status !== "pending" && n.status !== "manager_approved" && n.reviewedByName && (
                            <> · HR: {n.reviewedByName}{n.reviewedAt ? ` · ${new Date(n.reviewedAt).toLocaleString()}` : ""}</>
                          )}
                        </p>
                      </div>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 border ${RESOLUTION_BADGE[n.status]}`}>
                        {RESOLUTION_LABEL[n.status]}
                      </span>
                    </div>
                  </div>
                ))}
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
                    <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground">Resolution</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.length === 0 ? (
                    <tr><td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">No recent activity in this range.</td></tr>
                  ) : recent.map((r, i) => (
                    <tr key={i} className="border-b border-white/5">
                      <td className="px-2 py-1.5 font-mono text-blue-400">{r.ticketNo}</td>
                      <td className="px-2 py-1.5">
                        {r.kind === "note" ? (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${r.action === "warning" ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/30" : "bg-orange-500/20 text-orange-300 border-orange-500/30"}`}>
                            {r.action === "warning" ? "Warning" : "Mistake"} for {r.agentName}
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30">
                            {ACTION_LABELS[r.action] ?? r.action}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">{new Date(r.when).toLocaleString()}</td>
                      <td className="px-2 py-1.5">
                        {r.resolution ? (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${RESOLUTION_BADGE[r.resolution]}`}>
                            {RESOLUTION_LABEL[r.resolution]}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Team Dashboard — Team Leaders only ── */}
          {myIsLeader && (
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
                            <a
                              href={`/csr-agent/${m.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:text-blue-300 hover:underline transition cursor-pointer"
                              title={`Open ${m.name}'s stats in a new tab`}
                            >
                              {m.name}
                            </a>
                            {m.id === myId && <span className="text-muted-foreground"> (you)</span>}
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
          )}
        </div>
        )}
      </main>
    </div>
  );
}
