/**
 * Reports module — Branch Daily Report. Modeled on the company's existing
 * "Branch Daily Update" spreadsheet: branches grouped under the Senior
 * Branch Manager who owns them (assigned via the "Manage Branch Access"
 * panel, HR-and-above or a Senior Branch Manager themselves — see
 * seniorBranchManagerAssignments.ts), each with a shared notes box, an
 * Urgency call, a Pending Tickets/Number of Techs snapshot, and a live
 * Hours stat (real hours worked that day per technician assigned to the
 * branch, from their own timecard punch — calcWorkedHours off
 * getCompanyTimecardEntries(date, date), same clock-in/out/meal math every
 * other timecard/payroll page already uses) for the selected day.
 *
 * Edit rights (mirrors can_edit_branch_daily_report() in migration 0284,
 * updated by 0307/0319/0320 for the tiers below — kept in sync by hand,
 * real enforcement is the RLS policy, this is just for disabling controls
 * the request would be rejected for anyway):
 *   - HR and above, AND Technical Assistant Director (0320, per the
 *     user's explicit call — role or extra_roles): every branch,
 *     everything (notes, Urgency, moderate/delete any note, manage SBM
 *     assignments and extra editors company-wide).
 *   - Senior Branch Manager: notes + urgency, but only for branches
 *     assigned to them.
 *   - Branch Manager: notes only (never urgency), only their own
 *     assigned_branch.
 *   - Extra editors (0319): a specific person manually granted notes-only
 *     access to one branch via "Manage Branch Access", regardless of
 *     their own role/assigned_branch.
 *   - No active Branch Manager at a branch: whichever active
 *     technician(s) at that branch hold its highest present technician-pay
 *     tier (Technician < Technician Manager < Technical Assistant
 *     Director < Technical Director) get notes-only rights too, same as a
 *     real Branch Manager would — otherwise a branch with the role vacant
 *     has nobody local who can post an update at all. Never urgency,
 *     same as Branch Manager. If several people share the branch's
 *     highest present tier, all of them qualify (role+branch based, not
 *     tied to one specific person). Superseded by the blanket Technical
 *     Assistant Director grant above once that role holds this tier, but
 *     still the only path in for a plain Technician/Technician Manager/
 *     Technical Director at a branch with no Branch Manager.
 *     That tier pick is only the default (0327): Senior Branch Manager and
 *     above can hand-pick the branch's fallback tech(s) in Manage Branch
 *     Access, which then replaces the tier pick until reset.
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
import { getCompanyTimecardEntries, calcWorkedHours, type CompanyTimecardEntry } from "@/lib/supabase/timecards";
import { TECHNICIAN_PAY_ROLES, ROLE_LABELS, normalizeRole } from "@/lib/roleLabels";
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
  getBranchExtraEditors,
  addBranchExtraEditor,
  removeBranchExtraEditor,
  getBranchFallbackTechs,
  setBranchFallbackTechs,
  type BranchExtraEditor,
  type BranchFallbackTech,
} from "@/lib/supabase/seniorBranchManagerAssignments";

const URGENCY_LABEL: Record<BranchReportUrgency, string> = { low: "Low", moderate: "Moderate", high: "High" };
const URGENCY_CLASS: Record<BranchReportUrgency, string> = {
  low: "bg-green-500/20 text-green-300 border-green-500/40",
  moderate: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  high: "bg-red-500/20 text-red-300 border-red-500/40",
};

const todayStr = () => new Date().toISOString().slice(0, 10);
const fmtHours = (n: number) => (Math.round(n * 10) / 10).toString();

// This page's "full access, every branch, everything" tier — historically
// just HR-and-above, plus Technical Assistant Director since migration
// 0320 (per the user's explicit call). Kept as one set/one `isHrAndAbove`
// flag throughout this file rather than a second parallel check, since
// every place that already trusts HR-and-above on this page (Urgency,
// Manage Branch Access, note moderation, extra-editor management) is
// meant to trust this role exactly the same way here.
const HR_AND_ABOVE = new Set(["HR", "ADMIN", "SUPERADMIN", "SUPERSUPERADMIN", "TECHNICAL_ASSISTANT_DIRECTOR"]);
const hasRole = (role: string | null, extraRoles: string[], set: Set<string>) =>
  (role && set.has(normalizeRole(role))) || extraRoles.some((r) => set.has(normalizeRole(r)));

// Fallback-editor tier order for a branch with no active Branch Manager —
// see can_edit_branch_daily_report() in migration 0307 for the
// server-enforced twin of this. Primary role only, same convention
// techsFor() below already uses (not role-or-extra-roles).
const TECHNICIAN_TIER_ORDER: Record<string, number> = {
  TECHNICIAN: 0,
  TECHNICIAN_MANAGER: 1,
  TECHNICAL_ASSISTANT_DIRECTOR: 2,
  TECHNICAL_DIRECTOR: 3,
};
const roleLabel = (role: string | null | undefined) => ROLE_LABELS[normalizeRole(role || "")] || role || "";
const TECHNICAL_TIER_KNOWN =(role: string | null | undefined) => TECHNICIAN_TIER_ORDER[normalizeRole(role || "")] !== undefined;

export function BranchDailyReportPage({ mod }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const { role: myRole, extraRoles: myExtraRoles, uid } = useAuth();

  const [date, setDate] = useState(todayStr());
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [assignments, setAssignments] = useState<{ id: string; profileId: string; branch: string }[]>([]);
  const [extraEditors, setExtraEditors] = useState<BranchExtraEditor[]>([]);
  const [fallbackPicks, setFallbackPicks] = useState<BranchFallbackTech[]>([]);
  const [reports, setReports] = useState<BranchDailyReport[]>([]);
  const [notesByReport, setNotesByReport] = useState<Map<string, BranchDailyReportNote[]>>(new Map());
  const [tickets, setTickets] = useState<Awaited<ReturnType<typeof getCompanyTickets>>>([]);
  const [timecardEntries, setTimecardEntries] = useState<CompanyTimecardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [busyBranch, setBusyBranch] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, a, r, t, x, tc, fp] = await Promise.all([
        getCompanyUsers(),
        getSeniorBranchManagerAssignments(),
        getBranchDailyReports(date),
        getCompanyTickets(),
        getBranchExtraEditors(),
        getCompanyTimecardEntries(date, date).catch((err) => { console.error("Failed to load timecard entries:", err); return []; }),
        // Missing table (0327 not applied yet) just means "automatic default everywhere".
        getBranchFallbackTechs().catch((err) => { console.warn("Fallback tech picks unavailable:", err); return [] as BranchFallbackTech[]; }),
      ]);
      setUsers(u);
      setAssignments(a);
      setReports(r);
      setTickets(t);
      setExtraEditors(x);
      setFallbackPicks(fp);
      setTimecardEntries(tc);
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

  // Branches with an active Branch Manager already covered — every other
  // branch's highest present technician-pay tier gets fallback edit rights.
  const branchesWithActiveBranchManager = useMemo(() => {
    const set = new Set<string>();
    for (const u of users) {
      if (u.is_active && normalizeRole(u.role) === "BRANCH_MANAGER" && u.assigned_branch) set.add(u.assigned_branch);
    }
    return set;
  }, [users]);
  const highestTechTierByBranch = useMemo(() => {
    const best = new Map<string, number>();
    for (const u of users) {
      if (!u.is_active || !u.assigned_branch) continue;
      const tier = TECHNICIAN_TIER_ORDER[normalizeRole(u.role)];
      if (tier === undefined) continue;
      const current = best.get(u.assigned_branch);
      if (current === undefined || tier > current) best.set(u.assigned_branch, tier);
    }
    return best;
  }, [users]);
  // Hand-picked fallback list per branch (0327) — replaces the tier pick when set.
  const fallbackPicksByBranch = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of fallbackPicks) m.set(p.branch, [...(m.get(p.branch) ?? []), p.profileId]);
    return m;
  }, [fallbackPicks]);
  const isFallbackTechEditor = (branch: string) => {
    if (!me || branchesWithActiveBranchManager.has(branch)) return false;
    const picked = fallbackPicksByBranch.get(branch);
    if (picked) return picked.includes(me.id);
    if (me.assigned_branch !== branch) return false;
    const myTier = TECHNICIAN_TIER_ORDER[normalizeRole(me.role)];
    return myTier !== undefined && myTier === highestTechTierByBranch.get(branch);
  };

  // Manually-granted extra editors (migration 0319) — a specific person
  // given notes-only access to one branch regardless of their own role.
  const myExtraEditorBranches = useMemo(
    () => (me ? new Set(extraEditors.filter((e) => e.profileId === me.id).map((e) => e.branch)) : new Set<string>()),
    [extraEditors, me],
  );

  const canEditNotes = (branch: string) => {
    if (isHrAndAbove) return true;
    if (isSeniorBranchManager && myAssignedBranches.has(branch)) return true;
    if (isBranchManager && me?.assigned_branch === branch) return true;
    if (isFallbackTechEditor(branch)) return true;
    if (myExtraEditorBranches.has(branch)) return true;
    return false;
  };
  // Who may open Manage Assignments / add-remove extra editors for a given
  // branch — HR-and-above (everywhere), or the Senior Branch Manager
  // currently assigned to that specific branch (matches
  // can_manage_branch_extra_editors in migration 0319). SBM assignment
  // itself (which branch belongs to which SBM) is a bit wider — any Senior
  // Branch Manager, not just the one already assigned to that branch, same
  // as the RLS widening in 0319.
  const canManageExtraEditors = (branch: string) => isHrAndAbove || (isSeniorBranchManager && myAssignedBranches.has(branch));
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
      .map((u) => ({ id: u.id, name: u.display_name || u.email }))
      .sort((a, b) => a.name.localeCompare(b.name));

  // Hours worked, per technician, from their real timecard punch for the
  // selected report Date (not a frozen snapshot like pending_tickets/
  // number_of_techs below — a past day's punches are already final, so
  // there's nothing to go stale, and today's total should just keep
  // reflecting whatever's actually been punched so far).
  const hoursByProfile = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of timecardEntries) {
      map.set(e.profileId, calcWorkedHours({ checkIn: e.checkIn, checkOut: e.checkOut, mealStart: e.mealStart, mealEnd: e.mealEnd, notes: "" }));
    }
    return map;
  }, [timecardEntries]);
  const hoursForBranch = (branch: string) =>
    techsFor(branch).reduce((sum, t) => sum + (hoursByProfile.get(t.id) ?? 0), 0);

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
          {(isHrAndAbove || isSeniorBranchManager) && (
            <button onClick={() => setAssignOpen(true)} className="btn text-xs px-2.5 py-1.5 ml-auto flex items-center gap-1.5">
              <Settings className="h-3.5 w-3.5" /> Manage Assignments
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-6">
          Branches grouped by their Senior Branch Manager. Branch Managers add updates for their own branch; Senior Branch Managers review, set Urgency, and can add updates for every branch assigned to them. A branch with no Branch Manager falls back to its highest-tier technician for updates.
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
                            <div>
                              <div className="text-muted-foreground text-[10px] uppercase">Hours</div>
                              <button
                                type="button"
                                onClick={() => setTechListBranch(branch)}
                                title="Real hours worked per technician, from their timecard for this date — click for the breakdown"
                                className="font-semibold text-blue-300 hover:text-blue-200 hover:underline"
                              >
                                {fmtHours(hoursForBranch(branch))}
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
          users={users}
          seniorManagers={seniorManagers}
          assignments={assignments}
          extraEditors={extraEditors}
          branchesWithActiveBranchManager={branchesWithActiveBranchManager}
          highestTechTierByBranch={highestTechTierByBranch}
          fallbackPicksByBranch={fallbackPicksByBranch}
          canManageExtraEditors={canManageExtraEditors}
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
                  {techsFor(techListBranch).map((t) => {
                    const hrs = hoursByProfile.get(t.id);
                    return (
                      <li key={t.id} className="text-sm flex items-center justify-between gap-3">
                        <span>{t.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0">{hrs !== undefined ? `${fmtHours(hrs)} hrs` : "No punch"}</span>
                      </li>
                    );
                  })}
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
  users,
  seniorManagers,
  assignments,
  extraEditors,
  branchesWithActiveBranchManager,
  highestTechTierByBranch,
  fallbackPicksByBranch,
  canManageExtraEditors,
  onClose,
  onChanged,
}: {
  users: ProfileRow[];
  seniorManagers: ProfileRow[];
  assignments: { id: string; profileId: string; branch: string }[];
  extraEditors: BranchExtraEditor[];
  branchesWithActiveBranchManager: Set<string>;
  highestTechTierByBranch: Map<string, number>;
  fallbackPicksByBranch: Map<string, string[]>;
  canManageExtraEditors: (branch: string) => boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which branch's "+ Add person" row is currently open, and who's picked
  // in it — one at a time, closed/reset whenever a different branch's is opened.
  const [addingToBranch, setAddingToBranch] = useState<string | null>(null);
  const [addPickProfileId, setAddPickProfileId] = useState("");
  const ownerOf = (branch: string) => assignments.find((a) => a.branch === branch)?.profileId || "";
  const nameFor = (profileId: string) => users.find((u) => u.id === profileId)?.display_name || users.find((u) => u.id === profileId)?.email || "Unknown";

  const branchManagerFor = (branch: string) =>
    users.find((u) => u.is_active && u.assigned_branch === branch && normalizeRole(u.role) === "BRANCH_MANAGER") || null;
  // Branch techs a manager can pick as fallback — any technician-pay tier at that branch.
  const branchTechsFor = (branch: string) =>
    users.filter((u) => u.is_active && u.assigned_branch === branch && TECHNICAL_TIER_KNOWN(u.role));
  // Which branch's fallback picker is open, and the boxes ticked in it.
  const [editingFallback, setEditingFallback] = useState<string | null>(null);
  const [fallbackDraft, setFallbackDraft] = useState<Set<string>>(new Set());
  const fallbackTechsFor = (branch: string) => {
    if (branchesWithActiveBranchManager.has(branch)) return [];
    const picked = fallbackPicksByBranch.get(branch);
    if (picked) return users.filter((u) => picked.includes(u.id));
    const tier = highestTechTierByBranch.get(branch);
    if (tier === undefined) return [];
    return users.filter(
      (u) => u.is_active && u.assigned_branch === branch && TECHNICIAN_TIER_ORDER[normalizeRole(u.role)] === tier,
    );
  };
  const extraEditorsFor = (branch: string) => extraEditors.filter((e) => e.branch === branch);

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

  const handleAddExtraEditor = async (branch: string) => {
    if (!addPickProfileId) return;
    setBusy(true);
    setError(null);
    try {
      await addBranchExtraEditor(branch, addPickProfileId);
      setAddingToBranch(null);
      setAddPickProfileId("");
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add person.");
    } finally {
      setBusy(false);
    }
  };

  const handleSaveFallback = async (branch: string, profileIds: string[]) => {
    setBusy(true);
    setError(null);
    try {
      await setBranchFallbackTechs(branch, profileIds);
      setEditingFallback(null);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update fallback tech access.");
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveExtraEditor = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await removeBranchExtraEditor(id);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove person.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="panel w-full max-w-2xl max-h-[85vh] overflow-y-auto p-0">
        <div className="px-4 py-3 border-b border-white/10 sticky top-0 bg-background">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">Manage Branch Access</h3>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Assign each branch's Senior Branch Manager, see who else already has access, and add anyone extra who needs it.
          </p>
        </div>
        {error && <p className="mx-4 mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{error}</p>}
        <div className="p-4 space-y-4">
          {ACTIVE_LOCATIONS.map((branch) => {
            const bm = branchManagerFor(branch);
            const fallbackTechs = fallbackTechsFor(branch);
            const branchExtraEditors = extraEditorsFor(branch);
            const canManageHere = canManageExtraEditors(branch);
            const branchTechs = branchTechsFor(branch);
            const isCustomFallback = fallbackPicksByBranch.has(branch);
            const alreadyHasAccess = new Set([
              ...(bm ? [bm.id] : []),
              ...fallbackTechs.map((t) => t.id),
              ...branchExtraEditors.map((e) => e.profileId),
            ]);
            const addCandidates = users.filter((u) => u.is_active && !alreadyHasAccess.has(u.id));
            return (
              <div key={branch} className="border border-white/10 rounded-lg p-3">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-sm font-semibold flex-1">{branch}</span>
                  <select
                    value={ownerOf(branch)}
                    onChange={(e) => void handleChange(branch, e.target.value)}
                    disabled={busy}
                    className="glass-input text-xs py-1.5 px-2 rounded-md w-56 disabled:opacity-50"
                    title="Senior Branch Manager"
                  >
                    <option value="">— Unassigned Senior Branch Manager —</option>
                    {seniorManagers.map((sbm) => (
                      <option key={sbm.id} value={sbm.id}>{sbm.display_name || sbm.email}</option>
                    ))}
                  </select>
                </div>
                <div className="text-[11px] text-muted-foreground space-y-1">
                  <p>
                    <span className="text-slate-400">Branch Manager: </span>
                    {bm ? <span className="text-foreground">{bm.display_name || bm.email}</span> : <span className="italic">None — fallback tech access below</span>}
                  </p>
                  {!bm && (fallbackTechs.length > 0 || (canManageHere && branchTechs.length > 0)) && (
                    <p>
                      <span className="text-slate-400">Fallback tech access: </span>
                      <span className="text-foreground">
                        {fallbackTechs.length > 0 ? fallbackTechs.map((t) => t.display_name || t.email).join(", ") : "—"}
                      </span>
                      <span className="text-slate-500"> {isCustomFallback ? "(picked)" : "(default: highest tier)"}</span>
                      {canManageHere && editingFallback !== branch && (
                        <button
                          type="button"
                          onClick={() => { setEditingFallback(branch); setFallbackDraft(new Set(fallbackTechs.map((t) => t.id))); }}
                          className="ml-2 text-blue-400 hover:text-blue-300"
                        >
                          Edit
                        </button>
                      )}
                    </p>
                  )}
                  {!bm && editingFallback === branch && (
                    <div className="mt-1 rounded-md border border-white/10 bg-white/5 p-2">
                      <p className="text-[10px] text-slate-400 mb-1.5">Pick who gets notes access while this branch has no Branch Manager.</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {branchTechs.map((t) => (
                          <label key={t.id} className="inline-flex items-center gap-1.5 text-[11px] text-foreground">
                            <input
                              type="checkbox"
                              checked={fallbackDraft.has(t.id)}
                              onChange={(e) => setFallbackDraft((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(t.id); else next.delete(t.id);
                                return next;
                              })}
                            />
                            {t.display_name || t.email}
                            <span className="text-slate-500">({roleLabel(t.role)})</span>
                          </label>
                        ))}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void handleSaveFallback(branch, Array.from(fallbackDraft))}
                          disabled={busy || fallbackDraft.size === 0}
                          className="btn text-xs px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                        >
                          Save
                        </button>
                        {isCustomFallback && (
                          <button
                            type="button"
                            onClick={() => void handleSaveFallback(branch, [])}
                            disabled={busy}
                            className="btn text-xs px-2.5 py-1 disabled:opacity-50"
                            title="Go back to the automatic highest-tier pick"
                          >
                            Reset to default
                          </button>
                        )}
                        <button type="button" onClick={() => setEditingFallback(null)} className="btn text-xs px-2.5 py-1">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="mt-2">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Extra people with access</p>
                  {branchExtraEditors.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground italic">No one added.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {branchExtraEditors.map((e) => (
                        <span key={e.id} className="inline-flex items-center gap-1 text-[11px] bg-blue-500/10 border border-blue-500/30 text-blue-200 rounded-full pl-2 pr-1 py-0.5">
                          {nameFor(e.profileId)}
                          {canManageHere && (
                            <button
                              type="button"
                              onClick={() => void handleRemoveExtraEditor(e.id)}
                              disabled={busy}
                              title="Remove"
                              className="hover:text-red-300 disabled:opacity-50"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                  {canManageHere && (
                    addingToBranch === branch ? (
                      <div className="mt-2 flex items-center gap-2">
                        <select
                          value={addPickProfileId}
                          onChange={(e) => setAddPickProfileId(e.target.value)}
                          className="glass-input text-xs py-1.5 px-2 rounded-md flex-1"
                        >
                          <option value="">Select a person…</option>
                          {addCandidates.map((u) => (
                            <option key={u.id} value={u.id}>{u.display_name || u.email}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => void handleAddExtraEditor(branch)}
                          disabled={busy || !addPickProfileId}
                          className="btn text-xs px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                        >
                          Add
                        </button>
                        <button type="button" onClick={() => { setAddingToBranch(null); setAddPickProfileId(""); }} className="btn text-xs px-2.5 py-1.5">
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setAddingToBranch(branch); setAddPickProfileId(""); }}
                        className="mt-2 text-[11px] text-blue-400 hover:text-blue-300"
                      >
                        + Add person
                      </button>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
