/**
 * Reports module — Branch Daily Report. Modeled on the company's existing
 * "Branch Daily Update" spreadsheet: branches grouped under the Senior
 * Branch Manager who owns them (assigned via the "Manage Assignments"
 * panel, HR-and-above only — see seniorBranchManagerAssignments.ts), each
 * with a shared notes box, an Urgency call, and a Pending Tickets/Number
 * of Techs snapshot for the selected day.
 *
 * Edit rights (mirrors can_edit_branch_daily_report() in migration 0284 —
 * kept in sync by hand, real enforcement is the RLS policy, this is just
 * for disabling controls the request would be rejected for anyway):
 *   - HR and above: every branch, everything.
 *   - Senior Branch Manager: notes + urgency, but only for branches
 *     assigned to them.
 *   - Branch Manager: notes only (never urgency), only their own
 *     assigned_branch.
 *   - Everyone else with access to this page: read-only.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, Pencil, RefreshCw, Settings, Trash2, X } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { BrandedLoader } from "@/components/BrandedLoader";
import { ACTIVE_LOCATIONS } from "@/lib/locations";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getCompanyTickets } from "@/lib/supabase/tickets";
import { statusGroupOf } from "@/lib/ticketData";
import { TECHNICIAN_PAY_ROLES, normalizeRole } from "@/lib/roleLabels";
import {
  getBranchDailyReports,
  getBranchDailyReportNotes,
  addBranchDailyReportNote,
  updateBranchDailyReportNote,
  deleteBranchDailyReportNote,
  setBranchDailyReportUrgency,
  refreshBranchDailyReportCounts,
  type BranchDailyReport,
  type BranchDailyReportNote,
  type BranchReportUrgency,
} from "@/lib/supabase/branchDailyReports";
import {
  getSeniorBranchManagerAssignments,
  assignBranchToSeniorManager,
  unassignBranch,
} from "@/lib/supabase/seniorBranchManagerAssignments";

const URGENCY_LABEL: Record<BranchReportUrgency, string> = { low: "Low", moderate: "Moderate", high: "High" };
const URGENCY_CLASS: Record<BranchReportUrgency, string> = {
  low: "bg-green-500/20 text-green-300 border-green-500/40",
  moderate: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  high: "bg-red-500/20 text-red-300 border-red-500/40",
};

const todayStr = () => new Date().toISOString().slice(0, 10);

const HR_AND_ABOVE = new Set(["HR", "ADMIN", "SUPERADMIN", "SUPERSUPERADMIN"]);
const hasRole = (role: string | null, extraRoles: string[], set: Set<string>) =>
  (role && set.has(normalizeRole(role))) || extraRoles.some((r) => set.has(normalizeRole(r)));

export function BranchDailyReportPage({ mod }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const { role: myRole, extraRoles: myExtraRoles, uid } = useAuth();

  const [date, setDate] = useState(todayStr());
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [assignments, setAssignments] = useState<{ id: string; profileId: string; branch: string }[]>([]);
  const [reports, setReports] = useState<BranchDailyReport[]>([]);
  const [notesByReport, setNotesByReport] = useState<Map<string, BranchDailyReportNote[]>>(new Map());
  const [tickets, setTickets] = useState<Awaited<ReturnType<typeof getCompanyTickets>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [busyBranch, setBusyBranch] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, a, r, t] = await Promise.all([
        getCompanyUsers(),
        getSeniorBranchManagerAssignments(),
        getBranchDailyReports(date),
        getCompanyTickets(),
      ]);
      setUsers(u);
      setAssignments(a);
      setReports(r);
      setTickets(t);
      const notes = await getBranchDailyReportNotes(r.map((row) => row.id));
      const grouped = new Map<string, BranchDailyReportNote[]>();
      for (const n of notes) grouped.set(n.reportId, [...(grouped.get(n.reportId) ?? []), n]);
      setNotesByReport(grouped);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load branch daily reports.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [date]);

  const me = useMemo(() => users.find((u) => u.firebase_uid === uid) || null, [users, uid]);
  const myDisplayName = me?.display_name || "HR";
  const isHrAndAbove = hasRole(myRole, myExtraRoles, HR_AND_ABOVE);
  const isSeniorBranchManager = hasRole(myRole, myExtraRoles, new Set(["SENIOR_BRANCH_MANAGER"]));
  const isBranchManager = hasRole(myRole, myExtraRoles, new Set(["BRANCH_MANAGER"]));
  const myAssignedBranches = useMemo(
    () => (me ? new Set(assignments.filter((a) => a.profileId === me.id).map((a) => a.branch)) : new Set<string>()),
    [assignments, me],
  );

  const canEditNotes = (branch: string) => {
    if (isHrAndAbove) return true;
    if (isSeniorBranchManager && myAssignedBranches.has(branch)) return true;
    if (isBranchManager && me?.assigned_branch === branch) return true;
    return false;
  };
  const canEditUrgency = (branch: string) => isHrAndAbove || (isSeniorBranchManager && myAssignedBranches.has(branch));
  const isToday = date === todayStr();

  const reportByBranch = useMemo(() => new Map(reports.map((r) => [r.branch, r])), [reports]);
  const seniorManagers = useMemo(
    () => users.filter((u) => hasRole(u.role, u.extra_roles ?? [], new Set(["SENIOR_BRANCH_MANAGER"]))),
    [users],
  );
  const sbmByBranch = useMemo(() => new Map(assignments.map((a) => [a.branch, a.profileId])), [assignments]);

  // Group every real branch under its owning Senior Branch Manager; branches with none land in "Unassigned".
  const groups = useMemo(() => {
    const byManager = new Map<string, { managerName: string; branches: string[] }>();
    const unassigned: string[] = [];
    for (const branch of ACTIVE_LOCATIONS) {
      const sbmId = sbmByBranch.get(branch);
      const sbm = sbmId ? users.find((u) => u.id === sbmId) : null;
      if (sbm) {
        const key = sbm.id;
        if (!byManager.has(key)) byManager.set(key, { managerName: sbm.display_name || sbm.email, branches: [] });
        byManager.get(key)!.branches.push(branch);
      } else {
        unassigned.push(branch);
      }
    }
    const entries = Array.from(byManager.values()).sort((a, b) => a.managerName.localeCompare(b.managerName));
    if (unassigned.length) entries.push({ managerName: "Unassigned", branches: unassigned });
    return entries;
  }, [sbmByBranch, users]);

  const techsFor = (branch: string) =>
    users
      .filter((u) => u.is_active && u.assigned_branch === branch && TECHNICIAN_PAY_ROLES.has(normalizeRole(u.role)))
      .map((u) => u.display_name || u.email)
      .sort((a, b) => a.localeCompare(b));

  const countsFor = (branch: string) => {
    const pendingTickets = tickets.filter((t) => t.location === branch && statusGroupOf(t.status) === "open").length;
    const numberOfTechs = techsFor(branch).length;
    return { pendingTickets, numberOfTechs };
  };

  const [techListBranch, setTechListBranch] = useState<string | null>(null);

  const handleAddNote = async (branch: string) => {
    const text = (noteDrafts[branch] || "").trim();
    if (!text || !me) return;
    setBusyBranch(branch);
    try {
      await addBranchDailyReportNote(branch, date, me.id, myDisplayName, text);
      setNoteDrafts((prev) => ({ ...prev, [branch]: "" }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save note.");
    } finally {
      setBusyBranch(null);
    }
  };

  const handleEditNote = async (branch: string, noteId: string, text: string) => {
    setBusyBranch(branch);
    try {
      await updateBranchDailyReportNote(noteId, text);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update note.");
    } finally {
      setBusyBranch(null);
    }
  };

  const handleDeleteNote = async (branch: string, noteId: string) => {
    if (!window.confirm("Delete this note?")) return;
    setBusyBranch(branch);
    try {
      await deleteBranchDailyReportNote(noteId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete note.");
    } finally {
      setBusyBranch(null);
    }
  };

  const handleSetUrgency = async (branch: string, urgency: BranchReportUrgency) => {
    setBusyBranch(branch);
    try {
      await setBranchDailyReportUrgency(branch, date, urgency, myDisplayName);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set urgency.");
    } finally {
      setBusyBranch(null);
    }
  };

  const handleRefreshCounts = async (branch: string) => {
    setBusyBranch(branch);
    try {
      await refreshBranchDailyReportCounts(branch, date, countsFor(branch));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh counts.");
    } finally {
      setBusyBranch(null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-4 sm:px-6 py-8">
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <button onClick={goBack} className="btn hover:bg-white/15">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h1 className="text-2xl font-bold">Branch Daily Report</h1>
          {isHrAndAbove && (
            <button onClick={() => setAssignOpen(true)} className="btn text-xs px-2.5 py-1.5 ml-auto flex items-center gap-1.5">
              <Settings className="h-3.5 w-3.5" /> Manage Assignments
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-6">
          Branches grouped by their Senior Branch Manager. Branch Managers add updates for their own branch; Senior Branch Managers review, set Urgency, and can add updates for every branch assigned to them.
        </p>

        <div className="panel mb-6 p-4 flex flex-wrap items-center gap-3">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="glass-input text-sm py-1.5 px-3 rounded-md w-44"
          />
          {!isToday && (
            <button onClick={() => setDate(todayStr())} className="btn text-xs px-2.5 py-1.5">Today</button>
          )}
          <button onClick={() => void load()} className="btn text-xs px-2.5 py-1.5 flex items-center gap-1.5" disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>

        {error && <p className="mb-4 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{error}</p>}

        {loading ? (
          <div className="panel p-10 flex items-center justify-center"><BrandedLoader /></div>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <div key={group.managerName} className="panel p-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-white/10 bg-white/5">
                  <h2 className="font-semibold text-sm">{group.managerName}</h2>
                </div>
                <div className="divide-y divide-white/5">
                  {group.branches.map((branch) => {
                    const report = reportByBranch.get(branch);
                    const editableNotes = canEditNotes(branch);
                    const editableUrgency = canEditUrgency(branch);
                    const busy = busyBranch === branch;
                    const counts = report?.countsCapturedAt
                      ? { pendingTickets: report.pendingTickets ?? 0, numberOfTechs: report.numberOfTechs ?? 0 }
                      : countsFor(branch);
                    return (
                      <div key={branch} className="p-4 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap mb-2">
                            <span className="font-semibold text-sm">{branch}</span>
                            {report?.urgency && (
                              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${URGENCY_CLASS[report.urgency]}`}>
                                {URGENCY_LABEL[report.urgency]}
                              </span>
                            )}
                          </div>
                          {(() => {
                            const notes = report ? notesByReport.get(report.id) ?? [] : [];
                            return notes.length > 0 ? (
                              <div className="space-y-1.5 mb-2">
                                {notes.map((note) => (
                                  <NoteRow
                                    key={note.id}
                                    note={note}
                                    isMine={!!me && note.authorId === me.id}
                                    canModerate={isHrAndAbove}
                                    busy={busy}
                                    onSave={(text) => handleEditNote(branch, note.id, text)}
                                    onDelete={() => handleDeleteNote(branch, note.id)}
                                  />
                                ))}
                              </div>
                            ) : !editableNotes ? (
                              <p className="text-xs text-muted-foreground mb-2">No update yet.</p>
                            ) : null;
                          })()}
                          {editableNotes && (
                            <div className="flex flex-col sm:flex-row gap-2">
                              <textarea
                                value={noteDrafts[branch] || ""}
                                onChange={(e) => setNoteDrafts((prev) => ({ ...prev, [branch]: e.target.value }))}
                                placeholder="Notes on hiring, training, issue techs, clock in times…"
                                rows={2}
                                className="glass-input text-xs py-1.5 px-3 rounded-md flex-1 resize-y"
                              />
                              <button
                                onClick={() => void handleAddNote(branch)}
                                disabled={busy || !(noteDrafts[branch] || "").trim()}
                                className="btn text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 self-start"
                              >
                                Add
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="flex flex-row lg:flex-col gap-3 lg:w-44">
                          <div className="flex-1 lg:flex-none">
                            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Urgency</label>
                            <select
                              value={report?.urgency || ""}
                              onChange={(e) => e.target.value && void handleSetUrgency(branch, e.target.value as BranchReportUrgency)}
                              disabled={!editableUrgency || busy}
                              className="glass-input text-xs py-1.5 px-2 rounded-md w-full disabled:opacity-50"
                            >
                              <option value="">—</option>
                              <option value="low">Low</option>
                              <option value="moderate">Moderate</option>
                              <option value="high">High</option>
                            </select>
                          </div>
                          <div className="flex gap-3 text-xs">
                            <div>
                              <div className="text-muted-foreground text-[10px] uppercase">Pending</div>
                              <div className="font-semibold">{counts.pendingTickets}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground text-[10px] uppercase">Techs</div>
                              <button
                                type="button"
                                onClick={() => setTechListBranch(branch)}
                                className="font-semibold text-blue-300 hover:text-blue-200 hover:underline"
                              >
                                {counts.numberOfTechs}
                              </button>
                            </div>
                          </div>
                          {isToday && editableNotes && (
                            <button
                              onClick={() => void handleRefreshCounts(branch)}
                              disabled={busy}
                              className="btn text-[10px] px-2 py-1 flex items-center gap-1 self-start disabled:opacity-50"
                            >
                              <RefreshCw className="h-3 w-3" /> Refresh counts
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {assignOpen && (
        <AssignmentsModal
          seniorManagers={seniorManagers}
          assignments={assignments}
          onClose={() => setAssignOpen(false)}
          onChanged={load}
        />
      )}

      {techListBranch && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setTechListBranch(null)}>
          <div className="panel w-full max-w-sm p-0" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <h3 className="font-semibold text-sm">{techListBranch} — Technicians</h3>
              <button onClick={() => setTechListBranch(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-4">
              {techsFor(techListBranch).length === 0 ? (
                <p className="text-xs text-muted-foreground">No active technicians assigned to this branch.</p>
              ) : (
                <ul className="space-y-1.5">
                  {techsFor(techListBranch).map((name) => (
                    <li key={name} className="text-sm">{name}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NoteRow({
  note,
  isMine,
  canModerate,
  busy,
  onSave,
  onDelete,
}: {
  note: BranchDailyReportNote;
  isMine: boolean;
  canModerate: boolean;
  busy: boolean;
  onSave: (text: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const time = new Date(note.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  if (editing) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-md px-3 py-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          className="glass-input text-xs py-1.5 px-2 rounded-md w-full resize-y mb-1.5"
        />
        <div className="flex gap-2">
          <button
            onClick={() => { onSave(draft); setEditing(false); }}
            disabled={busy || !draft.trim()}
            className="btn text-[10px] px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
          >
            Save
          </button>
          <button onClick={() => { setDraft(note.body); setEditing(false); }} className="btn text-[10px] px-2 py-1">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white/5 border border-white/10 rounded-md px-3 py-2 flex items-start gap-2">
      <p className="text-xs whitespace-pre-wrap flex-1">
        <span className="font-semibold">{note.authorName}</span>{" "}
        <span className="text-muted-foreground">({time}{note.edited ? ", edited" : ""}):</span> {note.body}
      </p>
      {(isMine || canModerate) && (
        <div className="flex gap-1 shrink-0">
          {isMine && (
            <button onClick={() => setEditing(true)} disabled={busy} title="Edit" className="text-muted-foreground hover:text-foreground disabled:opacity-50">
              <Pencil className="h-3 w-3" />
            </button>
          )}
          <button onClick={onDelete} disabled={busy} title="Delete" className="text-muted-foreground hover:text-red-300 disabled:opacity-50">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

function AssignmentsModal({
  seniorManagers,
  assignments,
  onClose,
  onChanged,
}: {
  seniorManagers: ProfileRow[];
  assignments: { id: string; profileId: string; branch: string }[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ownerOf = (branch: string) => assignments.find((a) => a.branch === branch)?.profileId || "";

  const handleChange = async (branch: string, profileId: string) => {
    setBusy(true);
    setError(null);
    try {
      if (profileId) await assignBranchToSeniorManager(profileId, branch);
      else await unassignBranch(branch);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update assignment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="panel w-full max-w-xl max-h-[85vh] overflow-y-auto p-0">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between sticky top-0 bg-background">
          <h3 className="font-semibold text-sm">Assign Branches to Senior Branch Managers</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        {error && <p className="mx-4 mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{error}</p>}
        <div className="p-4 space-y-2">
          {ACTIVE_LOCATIONS.map((branch) => (
            <div key={branch} className="flex items-center gap-3">
              <span className="text-sm flex-1">{branch}</span>
              <select
                value={ownerOf(branch)}
                onChange={(e) => void handleChange(branch, e.target.value)}
                disabled={busy}
                className="glass-input text-xs py-1.5 px-2 rounded-md w-56 disabled:opacity-50"
              >
                <option value="">— Unassigned —</option>
                {seniorManagers.map((sbm) => (
                  <option key={sbm.id} value={sbm.id}>{sbm.display_name || sbm.email}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
