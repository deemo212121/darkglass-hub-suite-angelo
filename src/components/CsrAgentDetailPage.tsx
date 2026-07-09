/**
 * Employee Detail — a single employee's stats + activity, opened in a new
 * tab from the CSR Team Dashboard's member list or the HR Employee
 * Directory. Any manager-flavored role can attach a warning or mistake
 * note here, optionally referencing a ticket number; a department
 * manager reviews it first, then HR makes the final call — except HR/
 * Admin/Superadmin submissions, which fast-track straight to approved
 * since they already hold final authority. Works for any employee, not
 * just CSR staff — Recent Activity is empty for non-CSR roles since it
 * reflects ticket audit-trail activity.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle, ChevronLeft, Clock, Loader2, Trash2, Users, XCircle } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { normalizeRole, ROLE_LABELS } from "@/lib/roleLabels";
import { getCompanyUsers } from "@/lib/supabase/users";
import { getCompanyTickets, getTicketAuditLog } from "@/lib/supabase/tickets";
import { getCsrTeamComposition } from "@/lib/supabase/csrTeams";
import { addAgentNote, deleteAgentNote, getAgentNotes, reviewAgentNote, type CsrAgentNote } from "@/lib/supabase/csrAgentNotes";
import { parseBranchAccess } from "@/lib/locations";

const ACTION_LABELS: Record<string, string> = {
  status_change: "Status Change",
  reassign: "Technician Reassigned",
  reschedule: "Rescheduled",
};

// Any manager-flavored role can submit a warning/mistake for review — this
// page is used for every employee, not just CSR staff.
const MANAGER_ROLES = new Set([
  "CSR_TEAM_LEADER", "CSR_MANAGER", "MANAGER", "ADMIN", "SUPERADMIN", "HR",
  "BRANCH_MANAGER", "SENIOR_BRANCH_MANAGER", "TECHNICIAN_MANAGER",
  "CLAIMS_MANAGER", "PARTS_MANAGER", "BIZOPS_MANAGER", "BIZOPS_SENIOR_MANAGER",
]);
// Two-stage review, matching the real chain of command (e.g. for CSR staff:
// Team Leader submits -> CSR Manager reviews first -> HR makes the final
// call). Stage 1 = the employee's department-level manager, acting on
// 'pending'; stage 2 = HR, acting on 'manager_approved'. Admin/Superadmin
// sit in both stages so they're never blocked.
const STAGE1_ROLES = new Set([
  "CSR_MANAGER", "BRANCH_MANAGER", "SENIOR_BRANCH_MANAGER", "TECHNICIAN_MANAGER",
  "CLAIMS_MANAGER", "PARTS_MANAGER", "BIZOPS_MANAGER", "BIZOPS_SENIOR_MANAGER",
  "MANAGER", "ADMIN", "SUPERADMIN",
]);
const STAGE2_ROLES = new Set(["HR", "ADMIN", "SUPERADMIN"]);

const STATUS_BADGE: Record<CsrAgentNote["status"], string> = {
  pending: "bg-slate-500/20 text-slate-300 border-slate-500/30",
  manager_approved: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  approved: "bg-green-500/20 text-green-300 border-green-500/30",
  rejected: "bg-red-500/20 text-red-300 border-red-500/30",
};
const STATUS_LABEL: Record<CsrAgentNote["status"], string> = {
  pending: "Pending Manager Review",
  manager_approved: "Awaiting HR",
  approved: "Approved",
  rejected: "Rejected",
};

const branchesOf = (assignedBranch: string | null, branchAccess: string | null): string[] => {
  const raw = [assignedBranch ?? "", ...parseBranchAccess(branchAccess)];
  return Array.from(new Set(raw.map((s) => s.trim()).filter(Boolean)));
};

interface RecentEntry {
  ticketNo: string;
  action: string;
  when: string;
}

export function CsrAgentDetailPage({ agentId }: { agentId: string }) {
  const { role: myRole, ready } = useAuth();
  const normalizedMyRole = normalizeRole(myRole);
  const canManage = ready && MANAGER_ROLES.has(normalizedMyRole);
  const canStage1Review = ready && STAGE1_ROLES.has(normalizedMyRole);
  const canStage2Review = ready && STAGE2_ROLES.has(normalizedMyRole);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [roleLabel, setRoleLabel] = useState("");
  const [locations, setLocations] = useState<string[]>([]);
  const [teamName, setTeamName] = useState("");
  const [teamColor, setTeamColor] = useState("#3b82f6");
  const [recent, setRecent] = useState<RecentEntry[]>([]);

  const [notes, setNotes] = useState<CsrAgentNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(true);
  // Also determines what type gets submitted while that tab is active.
  const [noteTypeTab, setNoteTypeTab] = useState<"mistake" | "warning">("mistake");
  const [noteTicket, setNoteTicket] = useState("");
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const loadNotes = async () => {
    try {
      setNotesLoading(true);
      setNotes(await getAgentNotes(agentId));
    } catch (err) {
      console.error("Failed to load agent notes:", err);
    } finally {
      setNotesLoading(false);
    }
  };

  useEffect(() => {
    // This route opens in a fresh browser tab, so the Supabase auth session
    // hasn't necessarily finished restoring from storage yet — firing these
    // RLS-scoped queries before `ready` races ahead of the session and comes
    // back empty, which looked like "Agent not found" for a real agent.
    if (!ready) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [profiles, composition, auditLog, tickets] = await Promise.all([
          getCompanyUsers(),
          getCsrTeamComposition().catch(() => ({ teams: [], members: [] })),
          getTicketAuditLog(),
          getCompanyTickets(),
        ]);
        if (cancelled) return;

        const profile = profiles.find((p) => p.id === agentId);
        if (!profile) { setError("Agent not found."); setLoading(false); return; }

        setName(profile.display_name || profile.username || profile.email || "Unknown");
        const extras = profile.extra_roles || [];
        const normalizedProfileRole = normalizeRole(profile.role);
        setRoleLabel(
          normalizedProfileRole === "CSR_TEAM_LEADER" || extras.includes("CSR_TEAM_LEADER")
            ? "Team Leader"
            : ROLE_LABELS[normalizedProfileRole] ?? profile.role ?? "Employee",
        );
        setLocations(branchesOf(profile.assigned_branch, profile.branch_access));

        const teamOf = new Map(composition.members.map((m) => [m.profileId, m.teamId]));
        const myTeamId = teamOf.get(agentId);
        const team = composition.teams.find((t) => t.id === myTeamId);
        setTeamName(team?.name ?? "");
        setTeamColor(team?.color ?? "#3b82f6");

        const ticketMeta = new Map<string, string>();
        for (const t of tickets as any[]) if (t._id) ticketMeta.set(t._id, t.ticketNo);
        const mine = auditLog.filter((e) => e.changedBy === agentId);
        setRecent(
          mine
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 20)
            .map((e) => ({ ticketNo: ticketMeta.get(e.ticketId) || "—", action: e.action, when: e.createdAt })),
        );
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load agent.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    loadNotes();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, ready]);

  const submitNote = async () => {
    if (!noteText.trim()) return;
    try {
      setSavingNote(true);
      await addAgentNote({
        agentProfileId: agentId,
        type: noteTypeTab,
        ticketNo: noteTicket,
        note: noteText,
        // HR/Admin/Superadmin already hold final review authority — no need
        // to route their own submission through a department manager first.
        fastTrackToApproved: canStage2Review,
      });
      setNoteTicket("");
      setNoteText("");
      await loadNotes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save note.");
    } finally {
      setSavingNote(false);
    }
  };

  const removeNote = async (id: string) => {
    try {
      await deleteAgentNote(id);
      await loadNotes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete note.");
    }
  };

  const reviewNote = async (id: string, status: "manager_approved" | "approved" | "rejected") => {
    try {
      await reviewAgentNote(id, status);
      await loadNotes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update review status.");
    }
  };

  // Only approved notes count as the agent's official record.
  const warningCount = useMemo(() => notes.filter((n) => n.type === "warning" && n.status === "approved").length, [notes]);
  const mistakeCount = useMemo(() => notes.filter((n) => n.type === "mistake" && n.status === "approved").length, [notes]);

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-1 max-w-[900px] mx-auto w-full px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/home" className="btn hover:bg-white/15">
            <ChevronLeft className="h-4 w-4" /> Home
          </Link>
        </div>

        {loading ? (
          <div className="panel p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading agent…
          </div>
        ) : error ? (
          <div className="panel p-8 text-center text-sm text-red-300">{error}</div>
        ) : (
          <>
            <div className="panel p-4 mb-4">
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-2xl font-bold">{name}</h1>
                <span className="text-xs text-muted-foreground">{roleLabel}</span>
                {teamName && <span className="text-xs font-semibold" style={{ color: teamColor }}>{teamName}</span>}
              </div>
              {locations.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {locations.map((loc) => (
                    <span key={loc} className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/15 text-blue-300 border border-blue-500/20">
                      {loc}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="panel p-3 text-center">
                <div className="flex justify-center mb-1 text-muted-foreground"><AlertTriangle className="h-4 w-4" /></div>
                <p className="text-2xl font-bold text-yellow-300">{warningCount}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Warnings</p>
              </div>
              <div className="panel p-3 text-center">
                <div className="flex justify-center mb-1 text-muted-foreground"><Users className="h-4 w-4" /></div>
                <p className="text-2xl font-bold text-orange-300">{mistakeCount}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Mistakes</p>
              </div>
            </div>

            {/* Recent Activity */}
            <div className="panel p-4 mb-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" /> Recent Activity
              </p>
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
                      <tr><td colSpan={3} className="px-2 py-6 text-center text-muted-foreground">No recent activity.</td></tr>
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

            {/* Warnings / Mistakes */}
            <div className="panel p-4">
              <div className="flex items-center gap-1 mb-3 border-b border-white/10">
                {([
                  { key: "mistake", label: "Mistake Logs" },
                  { key: "warning", label: "Warning Logs" },
                ] as const).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setNoteTypeTab(tab.key)}
                    className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide border-b-2 -mb-px transition-colors ${noteTypeTab === tab.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {canManage && (
                <div className="rounded-lg border border-white/10 bg-white/5 p-3 mb-4 space-y-2">
                  <input
                    value={noteTicket}
                    onChange={(e) => setNoteTicket(e.target.value)}
                    placeholder="Ticket # (optional)"
                    className="glass-input text-xs w-full"
                  />
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="What happened?"
                    rows={2}
                    className="glass-input text-xs w-full"
                  />
                  <button
                    type="button"
                    onClick={submitNote}
                    disabled={savingNote || !noteText.trim()}
                    className="btn bg-primary/15 border-primary/40 text-primary hover:bg-primary/25 text-xs disabled:opacity-50"
                  >
                    {savingNote ? "Sending…" : canStage2Review ? `Issue ${noteTypeTab === "warning" ? "Warning" : "Mistake"}` : "Send to Manager for Review"}
                  </button>
                  <p className="text-[10px] text-muted-foreground">
                    {canStage2Review
                      ? `This counts against ${name.split(" ")[0] || "this employee"} immediately — you have final review authority.`
                      : `This won't count against ${name.split(" ")[0] || "this employee"} until a manager approves it.`}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                {notesLoading ? (
                  <p className="text-xs text-muted-foreground py-2">Loading notes…</p>
                ) : notes.filter((n) => n.type === noteTypeTab).length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">No {noteTypeTab === "warning" ? "warnings" : "mistakes"} on file.</p>
                ) : notes.filter((n) => n.type === noteTypeTab).map((n) => (
                  <div key={n.id} className="rounded-lg border border-white/10 bg-white/5 p-3 flex items-start gap-3">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${n.type === "warning" ? "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30" : "bg-orange-500/20 text-orange-300 border border-orange-500/30"}`}>
                      {n.type === "warning" ? "Warning" : "Mistake"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs">{n.note}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {n.ticketNo && <>Ticket <span className="font-mono text-blue-400">{n.ticketNo}</span> · </>}
                        {n.createdByName || "Unknown"} · {new Date(n.createdAt).toLocaleString()}
                        {n.managerReviewedByName && (
                          <> · Manager: {n.managerReviewedByName}{n.managerReviewedAt ? ` · ${new Date(n.managerReviewedAt).toLocaleString()}` : ""}</>
                        )}
                        {n.status !== "pending" && n.status !== "manager_approved" && n.reviewedByName && (
                          <> · HR: {n.reviewedByName}{n.reviewedAt ? ` · ${new Date(n.reviewedAt).toLocaleString()}` : ""}</>
                        )}
                      </p>
                    </div>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 border ${STATUS_BADGE[n.status]}`}>
                      {STATUS_LABEL[n.status]}
                    </span>
                    {canStage1Review && n.status === "pending" && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button type="button" onClick={() => reviewNote(n.id, "manager_approved")} title="Approve — sends to HR for the final call" className="text-muted-foreground hover:text-green-400 transition-colors">
                          <CheckCircle className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => reviewNote(n.id, "rejected")} title="Reject" className="text-muted-foreground hover:text-red-400 transition-colors">
                          <XCircle className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                    {canStage2Review && n.status === "manager_approved" && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button type="button" onClick={() => reviewNote(n.id, "approved")} title="HR final approval" className="text-muted-foreground hover:text-green-400 transition-colors">
                          <CheckCircle className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => reviewNote(n.id, "rejected")} title="HR reject" className="text-muted-foreground hover:text-red-400 transition-colors">
                          <XCircle className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                    {canManage && n.status === "pending" && (
                      <button type="button" onClick={() => removeNote(n.id)} title="Retract" className="shrink-0 text-muted-foreground hover:text-red-400 transition-colors">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
