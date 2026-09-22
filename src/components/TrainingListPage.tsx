/**
 * HR module -> Training List. Back to the grouped Area/Count/Date summary
 * shape (two sections: "Current Trainee" and "{Month} Field Starts",
 * branch rows with a clickable trainee count) — the flat, one-row-per-
 * trainee sortable/searchable table tried in between made the page too
 * busy for what's really a quick per-branch headcount view; editing moved
 * into the detail popup instead of living inline in the summary table.
 *
 * Source of truth is hr_candidates (getCandidates), NOT profiles — this is
 * a monthly HIRING COHORT report (everyone whose training activity landed
 * in the selected month, whether they're still training, already graduated
 * to the field, or dropped out), not a live "who's a trainee right now"
 * roster. A candidate keeps its trainingStartDate/trainingEndDate on record
 * even after status moves on to "hired", which is exactly why someone who
 * already graduated to the field still shows up in the month they trained.
 *
 * Column mapping (verified against a real September sheet HR provided):
 *  - "Current Trainee" Date        -> candidate.trainingStartDate
 *  - "{Month} Field Starts" Date   -> candidate.trainingEndDate (when HR
 *    sets a candidate's training end date, that's the date they actually
 *    moved to full field work). Bucketed into the nearest upcoming (or
 *    current) month so the section label stays accurate on its own.
 *  - "Senior Manager" / "Branch Manager" -> General Information's per-
 *    branch leadership directory (getBranchRoles/upsertBranchRole) — shown
 *    and editable in the detail popup, not the summary table (this sheet
 *    doesn't have room for them as columns).
 *
 * Clicking a branch's Count opens a popup listing each trainee behind it —
 * name, dates (editable), leadership (editable, branch-wide), phone,
 * email, notes — plus a "Quit/Stopped" action that calls the same two
 * writes the Hiring tab's own withdrawal flow uses (updateCandidateStatus
 * + updateCandidateNotes). Editing a date goes through
 * updateCandidateTrainingDates, NOT updateCandidateStatus — that RPC only
 * ever writes these dates as a side effect of setting status to "training",
 * which would wrongly revert an already-hired trainee back to "training".
 *
 * Dispatched from m.$module.$submodule.tsx for custom === "training-list";
 * the route already renders <AppHeader /> and gates access to ADMIN / HR
 * (DASHBOARD_ROLE_GATES).
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, GraduationCap, Loader2, RefreshCw, UserX, X } from "lucide-react";
import {
  getCandidates,
  updateCandidateTrainingDates,
  updateCandidateStatus,
  updateCandidateNotes,
  type Candidate,
} from "@/lib/supabase/hrCandidates";
import { getBranchRoles, upsertBranchRole, type BranchRoles } from "@/lib/supabase/generalInfo";

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDateOnly(iso: string): Date | null {
  const m = DATE_ONLY.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// A date-only string parses as UTC midnight; formatting it back out in a
// US (UTC-behind) browser rolls it back a day. Parse the y/m/d parts
// directly into a local Date instead — same fix applied across every form
// template this session (see e.g. masterPhContractorAgreementFormTemplate.ts).
function fmtDateShort(iso: string | null): string {
  if (!iso) return "—";
  const d = parseDateOnly(iso) ?? new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function monthNameOnly(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long" });
}

function shiftMonthKey(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "Sept 24, 2026" / "A and B" / "A, B, and C" — matches how HR already
 *  hand-writes multiple dates for one branch on the sheet this mirrors. */
function joinDates(dates: string[]): string {
  const formatted = dates.map((d) => fmtDateShort(d));
  if (formatted.length === 0) return "—";
  if (formatted.length === 1) return formatted[0];
  if (formatted.length === 2) return `${formatted[0]} and ${formatted[1]}`;
  return `${formatted.slice(0, -1).join(", ")}, and ${formatted[formatted.length - 1]}`;
}

const NOT_CONTINUING_EXCLUDED_STATUSES = new Set<Candidate["status"]>(["withdrawn", "rejected", "cancelled"]);

interface BranchGroup {
  branch: string;
  rows: Candidate[];
}

function groupByBranch(rows: Candidate[]): BranchGroup[] {
  const byBranch = new Map<string, Candidate[]>();
  for (const row of rows) {
    const key = row.branch || "Unassigned";
    if (!byBranch.has(key)) byBranch.set(key, []);
    byBranch.get(key)!.push(row);
  }
  return Array.from(byBranch.entries())
    .map(([branch, rows]) => ({ branch, rows }))
    .sort((a, b) => a.branch.localeCompare(b.branch));
}

export function TrainingListPage() {
  const navigate = useNavigate();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [branchRoles, setBranchRoles] = useState<BranchRoles[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [targetMonth, setTargetMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [selectedGroup, setSelectedGroup] = useState<{ title: string; rows: Candidate[] } | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [candidateRows, branchRoleRows] = await Promise.all([getCandidates(), getBranchRoles()]);
      setCandidates(candidateRows);
      setBranchRoles(branchRoleRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the training list.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const branchRoleByName = useMemo(() => new Map(branchRoles.map((b) => [b.branch, b])), [branchRoles]);

  const cohort = useMemo(
    () =>
      candidates.filter(
        (c) => c.trainingStartDate && monthKey(c.trainingStartDate) === targetMonth && !NOT_CONTINUING_EXCLUDED_STATUSES.has(c.status)
      ),
    [candidates, targetMonth]
  );
  const currentTraineeGroups = useMemo(() => groupByBranch(cohort), [cohort]);

  // Nearest bucket (by field-start month) that isn't already fully in the
  // past — so this reads "this month" once we're inside it, and "next
  // month" the rest of the time, without anyone manually rolling it over.
  const fieldStartSection = useMemo(() => {
    const withFieldStart = candidates.filter((c) => c.trainingEndDate && !NOT_CONTINUING_EXCLUDED_STATUSES.has(c.status));
    if (withFieldStart.length === 0) return null;
    const thisMonthKey = monthKey(new Date().toISOString().slice(0, 10));
    const keys = Array.from(new Set(withFieldStart.map((c) => monthKey(c.trainingEndDate!)))).sort();
    const targetKey = keys.find((k) => k >= thisMonthKey);
    if (!targetKey) return null;
    const bucketRows = withFieldStart.filter((c) => monthKey(c.trainingEndDate!) === targetKey);
    return { label: `${monthNameOnly(targetKey)} Field Starts`, groups: groupByBranch(bucketRows) };
  }, [candidates]);

  const monthName = monthLabel(targetMonth);

  return (
    <>
      <main className="max-w-[1000px] mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <button
            type="button"
            onClick={() => navigate({ to: "/m/$module", params: { module: "hr" } })}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-slate-300 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex-1 min-w-[200px]">
            <h1 className="flex items-center gap-2 text-xl font-bold text-white">
              <GraduationCap className="h-5 w-5" /> Training List
            </h1>
            <p className="text-sm text-slate-400">Trainee headcount by branch. Click a count to see who's behind it.</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setTargetMonth((k) => shiftMonthKey(k, -1))}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-slate-300 hover:text-white"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[9rem] text-center text-sm font-semibold text-white">{monthName}</span>
            <button
              type="button"
              onClick={() => setTargetMonth((k) => shiftMonthKey(k, 1))}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-slate-300 hover:text-white"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>

        {error && <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2 mb-4">{error}</p>}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
          </div>
        ) : (
          <div className="space-y-8">
            <BranchTable
              title="Current Trainee"
              groups={currentTraineeGroups}
              dateOf={(c) => c.trainingStartDate}
              emptyMessage={`No trainees for ${monthName}.`}
              onSelectBranch={(branch, rows) => setSelectedGroup({ title: `Current Trainee — ${branch}`, rows })}
            />

            {fieldStartSection && (
              <BranchTable
                title={fieldStartSection.label}
                groups={fieldStartSection.groups}
                dateOf={(c) => c.trainingEndDate}
                emptyMessage=""
                onSelectBranch={(branch, rows) => setSelectedGroup({ title: `${fieldStartSection.label} — ${branch}`, rows })}
              />
            )}
          </div>
        )}
      </main>

      {selectedGroup && (
        <TraineeDetailModal
          title={selectedGroup.title}
          rows={selectedGroup.rows}
          branchRoleByName={branchRoleByName}
          onClose={() => setSelectedGroup(null)}
          onChanged={() => void load()}
        />
      )}
    </>
  );
}

function BranchTable({
  title,
  groups,
  dateOf,
  emptyMessage,
  onSelectBranch,
}: {
  title: string;
  groups: BranchGroup[];
  dateOf: (row: Candidate) => string | null;
  emptyMessage: string;
  onSelectBranch: (branch: string, rows: Candidate[]) => void;
}) {
  return (
    <div className="panel overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 bg-white/5">
        <h2 className="text-sm font-bold text-white">{title}</h2>
      </div>
      {groups.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-400">{emptyMessage}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs font-semibold text-slate-400 uppercase">
              <th className="px-4 py-2">Area</th>
              <th className="px-4 py-2">Count</th>
              <th className="px-4 py-2">Date</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.branch} className="border-b border-white/5 last:border-b-0">
                <td className="px-4 py-2 font-semibold text-white">{g.branch}</td>
                <td className="px-4 py-2">
                  <button
                    type="button"
                    onClick={() => onSelectBranch(g.branch, g.rows)}
                    className="text-blue-300 hover:text-blue-200 underline font-semibold"
                  >
                    {g.rows.length}
                  </button>
                </td>
                <td className="px-4 py-2 text-slate-300">{joinDates(g.rows.map(dateOf).filter((d): d is string => !!d))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function TraineeDetailModal({
  title,
  rows,
  branchRoleByName,
  onClose,
  onChanged,
}: {
  title: string;
  rows: Candidate[];
  branchRoleByName: Map<string, BranchRoles>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [quitTarget, setQuitTarget] = useState<Candidate | null>(null);

  const withEdit = async (id: string, fn: () => Promise<void>) => {
    setSavingId(id);
    setSaveError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSavingId(null);
    }
  };

  const handleEditStartDate = (c: Candidate, date: string) => {
    if (date === (c.trainingStartDate || "")) return;
    void withEdit(c.id, () => updateCandidateTrainingDates(c.id, { trainingStartDate: date || null }));
  };
  const handleEditFieldDate = (c: Candidate, date: string) => {
    if (date === (c.trainingEndDate || "")) return;
    void withEdit(c.id, () => updateCandidateTrainingDates(c.id, { trainingEndDate: date || null }));
  };
  // Senior Manager / Branch Manager are branch-wide (General Information),
  // not per-candidate — editing here writes the whole branch's leadership
  // row, preserving every other field on it (a partial upsertBranchRole
  // payload would otherwise blank out Technical Manager/Bizops/etc.).
  const handleEditLeadership = (c: Candidate, field: "seniorBranchManager" | "branchManager", value: string) => {
    const branch = c.branch || "";
    if (!branch) return;
    const existing = branchRoleByName.get(branch);
    if ((existing?.[field] || "") === value) return;
    void withEdit(c.id, () =>
      upsertBranchRole({
        id: existing?.id,
        branch,
        seniorBranchManager: existing?.seniorBranchManager || "",
        branchManager: existing?.branchManager || "",
        technicalManager: existing?.technicalManager || "",
        bizops: existing?.bizops || "",
        regionalTechnicalManager: existing?.regionalTechnicalManager || "",
        partsManager: existing?.partsManager || "",
        assistantPartsManager: existing?.assistantPartsManager || "",
        sortOrder: existing?.sortOrder,
        [field]: value,
      })
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-slate-900 border border-white/10 rounded-lg shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-white">{title}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {saveError && <p className="mx-5 mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">{saveError}</p>}

        <div className="overflow-y-auto flex-1 px-5 py-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs font-semibold text-slate-400 uppercase whitespace-nowrap">
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Senior Manager</th>
                <th className="py-2 pr-3">Branch Manager</th>
                <th className="py-2 pr-3">Start Date</th>
                <th className="py-2 pr-3">Field Start</th>
                <th className="py-2 pr-3">Phone / Email</th>
                <th className="py-2 pr-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const leadership = branchRoleByName.get(c.branch || "");
                const busy = savingId === c.id;
                return (
                  <tr key={c.id} className="border-b border-white/5 last:border-b-0 align-top">
                    <td className="py-2 pr-3 font-semibold text-white whitespace-nowrap">{c.name}</td>
                    <td className="py-2 pr-3">
                      <input
                        type="text"
                        defaultValue={leadership?.seniorBranchManager || ""}
                        disabled={busy || !c.branch}
                        onBlur={(e) => handleEditLeadership(c, "seniorBranchManager", e.target.value)}
                        title="Branch-wide — also updates General Information's leadership directory for this branch"
                        className="bg-white/5 border border-white/15 rounded-md px-2 py-1 text-xs text-white w-28"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="text"
                        defaultValue={leadership?.branchManager || ""}
                        disabled={busy || !c.branch}
                        onBlur={(e) => handleEditLeadership(c, "branchManager", e.target.value)}
                        title="Branch-wide — also updates General Information's leadership directory for this branch"
                        className="bg-white/5 border border-white/15 rounded-md px-2 py-1 text-xs text-white w-28"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="date"
                        defaultValue={c.trainingStartDate || ""}
                        disabled={busy}
                        onChange={(e) => handleEditStartDate(c, e.target.value)}
                        className="bg-white/5 border border-white/15 rounded-md px-2 py-1 text-xs text-white"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="date"
                        defaultValue={c.trainingEndDate || ""}
                        disabled={busy}
                        onChange={(e) => handleEditFieldDate(c, e.target.value)}
                        className="bg-white/5 border border-white/15 rounded-md px-2 py-1 text-xs text-white"
                      />
                    </td>
                    <td className="py-2 pr-3 text-slate-300 whitespace-nowrap">
                      <div>{c.phone || "—"}</div>
                      <div className="text-slate-500">{c.email || ""}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setQuitTarget(c)}
                          title="Mark this trainee as quit/stopped"
                          className="inline-flex items-center gap-1 text-xs text-red-300 hover:text-red-200 disabled:opacity-40"
                        >
                          <UserX className="h-3.5 w-3.5" /> Quit/Stopped
                        </button>
                        {busy && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {quitTarget && (
        <QuitDialog
          candidate={quitTarget}
          onClose={() => setQuitTarget(null)}
          onSaved={() => {
            setQuitTarget(null);
            onChanged();
            onClose();
          }}
        />
      )}
    </div>
  );
}

function QuitDialog({ candidate, onClose, onSaved }: { candidate: Candidate; onClose: () => void; onSaved: () => void }) {
  const [dateLeft, setDateLeft] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateCandidateStatus(candidate.id, "withdrawn", dateLeft);
      if (reason.trim()) await updateCandidateNotes(candidate.id, reason);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-white/10 rounded-lg shadow-2xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-white">Mark {candidate.name} as Quit/Stopped</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Date Left</label>
            <input
              type="date"
              value={dateLeft}
              onChange={(e) => setDateLeft(e.target.value)}
              className="glass-input text-sm py-1.5 px-3 rounded-md w-full"
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Reason</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. No call, no show; Quit; Not taking the job…"
              rows={3}
              className="glass-input text-sm py-1.5 px-3 rounded-md w-full resize-none"
            />
          </div>
          {error && <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} disabled={saving} className="btn text-sm px-4 py-2">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={saving}
              className="btn text-sm px-4 py-2 bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Confirm"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
