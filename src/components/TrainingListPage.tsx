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
import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, ChevronLeft, ChevronRight, GraduationCap, Loader2, RefreshCw, UserX, X } from "lucide-react";
import {
  getCandidates,
  updateCandidateTrainingDates,
  updateCandidateTrainingTimes,
  updateCandidateStatus,
  updateCandidateNotes,
  type Candidate,
} from "@/lib/supabase/hrCandidates";
import { getBranchRoles, upsertBranchRole, type BranchRoles } from "@/lib/supabase/generalInfo";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getCompanyTraineeEntries } from "@/lib/supabase/traineeTimecards";
import { getCompanyTimecardEntries } from "@/lib/supabase/timecards";

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

function monthNameOnly(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long" });
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function shiftMonthKey(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function daysInMonth(key: string): number {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

/** Every "YYYY-MM-DD" from `from` to `to` inclusive, local-date arithmetic (see parseDateOnly's own note on why). */
function eachDate(from: string, to: string): string[] {
  const start = parseDateOnly(from);
  const end = parseDateOnly(to);
  if (!start || !end || start > end) return [];
  const dates: string[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    dates.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

/** hr_candidates and profiles share no FK — phone number (digits only) is the only thing linking a candidate to their real employee/timecard account. */
function normalizePhone(phone: string | null | undefined): string {
  return (phone || "").replace(/\D/g, "");
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

export function TrainingListPage({ embedded }: { embedded?: boolean } = {}) {
  const navigate = useNavigate();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [branchRoles, setBranchRoles] = useState<BranchRoles[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selMonth, setSelMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [dayFrom, setDayFrom] = useState(1);
  const [dayTo, setDayTo] = useState(() => daysInMonth(new Date().toISOString().slice(0, 7)));
  const maxDay = daysInMonth(selMonth);
  const effectiveDayFrom = Math.min(dayFrom, maxDay);
  const effectiveDayTo = Math.min(dayTo, maxDay);
  const dateFrom = `${selMonth}-${String(effectiveDayFrom).padStart(2, "0")}`;
  const dateTo = `${selMonth}-${String(effectiveDayTo).padStart(2, "0")}`;
  const dayOptions = useMemo(() => Array.from({ length: maxDay }, (_, i) => i + 1), [maxDay]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [candidateRows, branchRoleRows, profileRows] = await Promise.all([getCandidates(), getBranchRoles(), getCompanyUsers()]);
      setCandidates(candidateRows);
      setBranchRoles(branchRoleRows);
      setProfiles(profileRows);
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

  // Overlap, not an exact match on trainingStartDate — a trainee who
  // started Sept 5 and field-starts Sept 20 is still "current" on every
  // day in between, so any selected window touching [start, fieldStart]
  // (fieldStart open-ended if not set yet) should surface them.
  const cohort = useMemo(
    () =>
      candidates.filter(
        (c) =>
          c.trainingStartDate &&
          c.trainingStartDate <= dateTo &&
          (!c.trainingEndDate || c.trainingEndDate >= dateFrom) &&
          !NOT_CONTINUING_EXCLUDED_STATUSES.has(c.status)
      ),
    [candidates, dateFrom, dateTo]
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

  const rangeLabel = `${fmtDateShort(dateFrom)} – ${fmtDateShort(dateTo)}`;

  return (
    <>
      <main className={embedded ? "" : "max-w-[1000px] mx-auto px-6 py-8"}>
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          {!embedded && (
            <button
              type="button"
              onClick={() => navigate({ to: "/m/$module", params: { module: "hr" } })}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-slate-300 hover:text-white"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          {!embedded && (
            <div className="flex-1 min-w-[200px]">
              <h1 className="flex items-center gap-2 text-xl font-bold text-white">
                <GraduationCap className="h-5 w-5" /> Training List
              </h1>
              <p className="text-sm text-slate-400">Trainee headcount by branch. Click a count to see who's behind it.</p>
            </div>
          )}
          <div className={`flex items-center gap-1.5 shrink-0 ${embedded ? "ml-auto" : ""}`}>
            <button
              type="button"
              onClick={() => setSelMonth((k) => shiftMonthKey(k, -1))}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-slate-300 hover:text-white"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[8.5rem] text-center text-sm font-semibold text-white">{monthLabel(selMonth)}</span>
            <button
              type="button"
              onClick={() => setSelMonth((k) => shiftMonthKey(k, 1))}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-slate-300 hover:text-white"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <span className="text-xs text-slate-500 pl-1">days</span>
            <select
              value={effectiveDayFrom}
              onChange={(e) => setDayFrom(Number(e.target.value))}
              className="bg-white/5 border border-white/15 rounded-md px-2 py-1.5 text-xs text-white [&>option]:bg-slate-900 [&>option]:text-white"
            >
              {dayOptions.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <span className="text-xs text-slate-500">to</span>
            <select
              value={effectiveDayTo}
              onChange={(e) => setDayTo(Number(e.target.value))}
              className="bg-white/5 border border-white/15 rounded-md px-2 py-1.5 text-xs text-white [&>option]:bg-slate-900 [&>option]:text-white"
            >
              {dayOptions.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
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
              emptyMessage={`No trainees for ${rangeLabel}.`}
              branchRoleByName={branchRoleByName}
              onChanged={() => void load()}
              profiles={profiles}
              dateFrom={dateFrom}
              dateTo={dateTo}
            />

            {fieldStartSection && (
              <BranchTable
                title={fieldStartSection.label}
                groups={fieldStartSection.groups}
                dateOf={(c) => c.trainingEndDate}
                emptyMessage=""
                branchRoleByName={branchRoleByName}
                onChanged={() => void load()}
                profiles={profiles}
                dateFrom={dateFrom}
                dateTo={dateTo}
              />
            )}
          </div>
        )}
      </main>
    </>
  );
}

function BranchTable({
  title,
  groups,
  dateOf,
  emptyMessage,
  branchRoleByName,
  onChanged,
  profiles,
  dateFrom,
  dateTo,
}: {
  title: string;
  groups: BranchGroup[];
  dateOf: (row: Candidate) => string | null;
  emptyMessage: string;
  branchRoleByName: Map<string, BranchRoles>;
  onChanged: () => void;
  profiles: ProfileRow[];
  dateFrom: string;
  dateTo: string;
}) {
  const [expandedBranch, setExpandedBranch] = useState<string | null>(null);
  const [expandedTraineeId, setExpandedTraineeId] = useState<string | null>(null);
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
  const handleEditTimeIn = (c: Candidate, time: string) => {
    if (time === (c.trainingTimeIn || "")) return;
    void withEdit(c.id, () => updateCandidateTrainingTimes(c.id, { trainingTimeIn: time || null }));
  };
  const handleEditTimeOut = (c: Candidate, time: string) => {
    if (time === (c.trainingTimeOut || "")) return;
    void withEdit(c.id, () => updateCandidateTrainingTimes(c.id, { trainingTimeOut: time || null }));
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
    <div className="panel overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 bg-white/5">
        <h2 className="text-sm font-bold text-white">{title}</h2>
      </div>

      {saveError && <p className="mx-4 mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">{saveError}</p>}

      {groups.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-400">{emptyMessage}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs font-semibold text-slate-400 uppercase">
              <th className="px-4 py-2 w-8"></th>
              <th className="px-4 py-2">Area</th>
              <th className="px-4 py-2">Count</th>
              <th className="px-4 py-2">Date</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const isOpen = expandedBranch === g.branch;
              return (
                <Fragment key={g.branch}>
                  <tr
                    onClick={() => setExpandedBranch(isOpen ? null : g.branch)}
                    className="border-b border-white/5 last:border-b-0 cursor-pointer hover:bg-white/5"
                  >
                    <td className="px-4 py-2 text-slate-400">
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </td>
                    <td className="px-4 py-2 font-semibold text-white">{g.branch}</td>
                    <td className="px-4 py-2 text-blue-300 font-semibold">{g.rows.length}</td>
                    <td className="px-4 py-2 text-slate-300">{joinDates(g.rows.map(dateOf).filter((d): d is string => !!d))}</td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-white/5 last:border-b-0 bg-black/20">
                      <td colSpan={4} className="px-4 py-3">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-white/10 text-left text-[10px] font-semibold text-slate-400 uppercase whitespace-nowrap">
                              <th className="py-1.5 pr-3">Name</th>
                              <th className="py-1.5 pr-3">Senior Manager</th>
                              <th className="py-1.5 pr-3">Branch Manager</th>
                              <th className="py-1.5 pr-3">Start Date</th>
                              <th className="py-1.5 pr-3">Field Start</th>
                              <th className="py-1.5 pr-3">Time In</th>
                              <th className="py-1.5 pr-3">Time Out</th>
                              <th className="py-1.5 pr-3">Phone / Email</th>
                              <th className="py-1.5 pr-3">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.rows.map((c) => {
                              const leadership = branchRoleByName.get(c.branch || "");
                              const busy = savingId === c.id;
                              const traineeOpen = expandedTraineeId === c.id;
                              return (
                                <Fragment key={c.id}>
                                <tr className="border-b border-white/5 last:border-b-0 align-top" onClick={(e) => e.stopPropagation()}>
                                  <td className="py-1.5 pr-3 font-semibold text-white whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() => setExpandedTraineeId(traineeOpen ? null : c.id)}
                                      title="See their actual day-by-day Time In/Out"
                                      className="inline-flex items-center gap-1 hover:text-blue-300"
                                    >
                                      <ChevronDown className={`h-3 w-3 text-slate-400 transition-transform ${traineeOpen ? "rotate-180" : ""}`} />
                                      {c.name}
                                    </button>
                                  </td>
                                  <td className="py-1.5 pr-3">
                                    <input
                                      type="text"
                                      defaultValue={leadership?.seniorBranchManager || ""}
                                      disabled={busy || !c.branch}
                                      onBlur={(e) => handleEditLeadership(c, "seniorBranchManager", e.target.value)}
                                      title="Branch-wide — also updates General Information's leadership directory for this branch"
                                      className="bg-white/5 border border-white/15 rounded-md px-2 py-1 text-xs text-white w-28"
                                    />
                                  </td>
                                  <td className="py-1.5 pr-3">
                                    <input
                                      type="text"
                                      defaultValue={leadership?.branchManager || ""}
                                      disabled={busy || !c.branch}
                                      onBlur={(e) => handleEditLeadership(c, "branchManager", e.target.value)}
                                      title="Branch-wide — also updates General Information's leadership directory for this branch"
                                      className="bg-white/5 border border-white/15 rounded-md px-2 py-1 text-xs text-white w-28"
                                    />
                                  </td>
                                  <td className="py-1.5 pr-3">
                                    <input
                                      type="date"
                                      defaultValue={c.trainingStartDate || ""}
                                      disabled={busy}
                                      onChange={(e) => handleEditStartDate(c, e.target.value)}
                                      className="bg-white/5 border border-white/15 rounded-md px-2 py-1 text-xs text-white"
                                    />
                                  </td>
                                  <td className="py-1.5 pr-3">
                                    <input
                                      type="date"
                                      defaultValue={c.trainingEndDate || ""}
                                      disabled={busy}
                                      onChange={(e) => handleEditFieldDate(c, e.target.value)}
                                      className="bg-white/5 border border-white/15 rounded-md px-2 py-1 text-xs text-white"
                                    />
                                  </td>
                                  <td className="py-1.5 pr-3">
                                    <input
                                      type="time"
                                      defaultValue={c.trainingTimeIn || ""}
                                      disabled={busy}
                                      onChange={(e) => handleEditTimeIn(c, e.target.value)}
                                      className="bg-white/5 border border-white/15 rounded-md px-2 py-1 text-xs text-white"
                                    />
                                  </td>
                                  <td className="py-1.5 pr-3">
                                    <input
                                      type="time"
                                      defaultValue={c.trainingTimeOut || ""}
                                      disabled={busy}
                                      onChange={(e) => handleEditTimeOut(c, e.target.value)}
                                      className="bg-white/5 border border-white/15 rounded-md px-2 py-1 text-xs text-white"
                                    />
                                  </td>
                                  <td className="py-1.5 pr-3 text-slate-300 whitespace-nowrap">
                                    <div>{c.phone || "—"}</div>
                                    <div className="text-slate-500">{c.email || ""}</div>
                                  </td>
                                  <td className="py-1.5 pr-3">
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
                                {traineeOpen && (
                                  <tr className="border-b border-white/5 last:border-b-0 bg-black/30" onClick={(e) => e.stopPropagation()}>
                                    <td colSpan={9} className="px-3 py-2">
                                      <TraineeDailyPunches candidate={c} profiles={profiles} dateFrom={dateFrom} dateTo={dateTo} />
                                    </td>
                                  </tr>
                                )}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      {quitTarget && (
        <QuitDialog
          candidate={quitTarget}
          onClose={() => setQuitTarget(null)}
          onSaved={() => {
            setQuitTarget(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

/**
 * Real day-by-day Time In/Out, unlike the single manually-typed
 * trainingTimeIn/trainingTimeOut fields above — pulled from
 * trainee_timecard_entries (the same table the trainee punches through on
 * the normal Time Clock, and Attendance Monitoring's "Trainee Attendance"
 * tab reviews). hr_candidates and profiles share no FK, so the only way to
 * find this candidate's employee account is a normalized phone-number
 * match; if that fails (no account yet, or a different number on file),
 * this just says so instead of guessing.
 */
function TraineeDailyPunches({
  candidate,
  profiles,
  dateFrom,
  dateTo,
}: {
  candidate: Candidate;
  profiles: ProfileRow[];
  dateFrom: string;
  dateTo: string;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState(true);
  const [days, setDays] = useState<{ date: string; checkIn: string; checkOut: string }[]>([]);

  // Range shown never depends on whether a matching account was found — it's
  // always every day in [dateFrom, dateTo] clamped to this trainee's actual
  // training window, so the list itself (Sept 1–30, or whatever's selected
  // up top) is stable; only the Time In/Out values are blank when unlinked.
  const rangeStart = candidate.trainingStartDate && candidate.trainingStartDate > dateFrom ? candidate.trainingStartDate : dateFrom;
  const rangeEndRaw = candidate.trainingEndDate && candidate.trainingEndDate < dateTo ? candidate.trainingEndDate : dateTo;
  const rangeEnd = rangeEndRaw < rangeStart ? rangeStart : rangeEndRaw;

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const normalizedPhone = normalizePhone(candidate.phone);
        const profile = normalizedPhone ? profiles.find((p) => normalizePhone(p.phone_number) === normalizedPhone) : undefined;
        if (!cancelled) setLinked(!!profile);
        // Two sources, not one: a trainee still mid-training punches into
        // trainee_timecard_entries, but once their day's approved (or once
        // they've since graduated to a real employment_type, like Alexander
        // here) the real punches live on timecard_entries instead — see
        // approveTraineeDay, which mirrors approved days onto the real
        // table. Real wins when both have something for the same day.
        const [realEntries, traineeEntries] = profile
          ? await Promise.all([getCompanyTimecardEntries(rangeStart, rangeEnd), getCompanyTraineeEntries(rangeStart, rangeEnd)])
          : [[], []];
        const realByDate = new Map(profile ? realEntries.filter((e) => e.profileId === profile.id).map((e) => [e.workDate, e] as const) : []);
        const traineeByDate = new Map(profile ? traineeEntries.filter((e) => e.profileId === profile.id).map((e) => [e.workDate, e] as const) : []);
        const rows = eachDate(rangeStart, rangeEnd).map((date) => {
          const real = realByDate.get(date);
          const trainee = traineeByDate.get(date);
          return { date, checkIn: real?.checkIn || trainee?.checkIn || "", checkOut: real?.checkOut || trainee?.checkOut || "" };
        });
        if (!cancelled) setDays(rows);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load punches.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [candidate.id, candidate.phone, rangeStart, rangeEnd, profiles]);

  if (loading) return <p className="px-1 py-1.5 text-[11px] text-slate-400">Loading punches…</p>;
  if (error) return <p className="px-1 py-1.5 text-[11px] text-red-300">{error}</p>;
  if (days.length === 0) return <p className="px-1 py-1.5 text-[11px] text-slate-400">No days in range.</p>;

  return (
    <div>
      {!linked && (
        <p className="px-1 pb-1.5 text-[11px] text-slate-500">No linked employee account found for this phone number yet — Check In/Out will stay blank until they punch in for real.</p>
      )}
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-white/10 text-left text-[10px] font-semibold text-slate-400 uppercase">
            <th className="py-1 pr-3">Date</th>
            <th className="py-1 pr-3">Check In</th>
            <th className="py-1 pr-3">Check Out</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date} className="border-b border-white/5 last:border-b-0">
              <td className="py-1 pr-3 text-slate-300">{fmtDateShort(d.date)}</td>
              <td className="py-1 pr-3 text-white">{d.checkIn || "—"}</td>
              <td className="py-1 pr-3 text-white">{d.checkOut || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
