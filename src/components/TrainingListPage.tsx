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
import { createPortal } from "react-dom";
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
import {
  getCompanyUsers,
  getEmployeeInfoByProfileIds,
  getTrainingEndDatesByProfileIds,
  getProfileEmployeeInfo,
  saveProfileEmployeeInfo,
  updateCompanyUser,
  type ProfileRow,
  type EmployeeInfo,
} from "@/lib/supabase/users";
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

interface MasterListTraineeRow {
  profileId: string;
  name: string;
  branch: string | null;
  phone: string | null;
  email: string | null;
  // Full employee_info JSON, not just hireDate — saveProfileEmployeeInfo
  // replaces the whole blob, so editing hireDate must merge onto this
  // rather than overwrite bank/address/etc. with a blank object.
  employeeInfo: EmployeeInfo;
  trainingEndDate: string | null;
  staffNote: string | null;
  isActive: boolean;
}

/** A single "Current Trainee" row from EITHER source — hr_candidates (candidate set) or Master List's Trainee tab (masterList set), never both. */
interface UnifiedRow {
  key: string;
  name: string;
  branch: string | null;
  phone: string | null;
  email: string | null;
  startDate: string | null;
  fieldStartDate: string | null;
  timeIn: string | null;
  timeOut: string | null;
  candidate?: Candidate;
  masterList?: MasterListTraineeRow;
}

interface UnifiedBranchGroup {
  branch: string;
  rows: UnifiedRow[];
}

interface QuitStoppedRow {
  key: string;
  name: string;
  branch: string | null;
  dateLeft: string | null;
  reason: string | null;
}

export function TrainingListPage({ embedded }: { embedded?: boolean } = {}) {
  const navigate = useNavigate();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [branchRoles, setBranchRoles] = useState<BranchRoles[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [masterListTrainees, setMasterListTrainees] = useState<MasterListTraineeRow[]>([]);
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

      // Master List's "Trainee" tab (employment_type = 'trainee') is the
      // authoritative live source for who's currently a trainee — someone
      // can be flagged straight on their account (a re-hire, a manual
      // correction) without ever getting a proper "training" status row in
      // hr_candidates, which would otherwise make them invisible here.
      // Merged into "Current Trainee" below (deduped by phone against
      // hr_candidates rows). hireDate (employee_info) stands in for Start
      // Date, training_end_date (0297) for Field Start.
      const traineeProfiles = profileRows.filter((p) => p.employment_type === "trainee");
      if (traineeProfiles.length > 0) {
        const ids = traineeProfiles.map((p) => p.id);
        const [infoByProfileId, trainingEndByProfileId] = await Promise.all([
          getEmployeeInfoByProfileIds(ids),
          getTrainingEndDatesByProfileIds(ids),
        ]);
        setMasterListTrainees(
          traineeProfiles.map((p) => ({
            profileId: p.id,
            name: p.display_name || p.email || "Unnamed",
            branch: p.assigned_branch || null,
            phone: p.phone_number || null,
            email: p.email || null,
            employeeInfo: infoByProfileId.get(p.id) || {},
            trainingEndDate: trainingEndByProfileId.get(p.id) || null,
            staffNote: p.staff_note ?? null,
            isActive: p.is_active,
          }))
        );
      } else {
        setMasterListTrainees([]);
      }
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

  // Only trainingStartDate falling inside the selected window counts —
  // field start (or lack of one) is irrelevant here. A Sept 16 starter with
  // no field start yet stays in Sept's list, not carried forward into
  // October just because they haven't field-started.
  const cohort = useMemo(
    () =>
      candidates.filter(
        (c) =>
          c.trainingStartDate &&
          c.trainingStartDate >= dateFrom &&
          c.trainingStartDate <= dateTo &&
          !NOT_CONTINUING_EXCLUDED_STATUSES.has(c.status)
      ),
    [candidates, dateFrom, dateTo]
  );
  // "Current Trainee" is a UNION of two sources, not just hr_candidates:
  // hr_candidates rows in the selected window, PLUS Master List's Trainee
  // tab (employment_type='trainee') filtered the same exact-range way
  // (hireDate standing in for trainingStartDate) and deduped by phone
  // against candidates already counted — someone who came through the
  // normal hiring flow AND is flagged trainee on their account should only
  // appear once.
  const unifiedCurrentTraineeGroups = useMemo<UnifiedBranchGroup[]>(() => {
    const fromCandidates: UnifiedRow[] = cohort.map((c) => ({
      key: c.id,
      name: c.name,
      branch: c.branch,
      phone: c.phone,
      email: c.email,
      startDate: c.trainingStartDate,
      fieldStartDate: c.trainingEndDate,
      timeIn: c.trainingTimeIn,
      timeOut: c.trainingTimeOut,
      candidate: c,
    }));
    const alreadyShownPhones = new Set(fromCandidates.map((r) => normalizePhone(r.phone)).filter(Boolean));
    const fromMasterList: UnifiedRow[] = masterListTrainees
      .filter((t) => {
        // Same "not still continuing" exclusion as hr_candidates' own
        // NOT_CONTINUING_EXCLUDED_STATUSES — once Quit/Stopped sets a
        // terminateDate (and deactivates the account), they stop showing
        // up here, same as a withdrawn candidate does.
        if (t.employeeInfo.terminateDate) return false;
        const hireDate = t.employeeInfo.hireDate || null;
        return hireDate && hireDate >= dateFrom && hireDate <= dateTo && !(t.phone && alreadyShownPhones.has(normalizePhone(t.phone)));
      })
      .map((t) => ({
        key: `profile:${t.profileId}`,
        name: t.name,
        branch: t.branch,
        phone: t.phone,
        email: t.email,
        startDate: t.employeeInfo.hireDate || null,
        fieldStartDate: t.trainingEndDate,
        timeIn: null,
        timeOut: null,
        masterList: t,
      }));
    const byBranch = new Map<string, UnifiedRow[]>();
    for (const row of [...fromCandidates, ...fromMasterList]) {
      const key = row.branch || "Unassigned";
      if (!byBranch.has(key)) byBranch.set(key, []);
      byBranch.get(key)!.push(row);
    }
    return Array.from(byBranch.entries())
      .map(([branch, rows]) => ({ branch, rows }))
      .sort((a, b) => a.branch.localeCompare(b.branch));
  }, [cohort, masterListTrainees, dateFrom, dateTo]);

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

  // Everyone marked Quit/Stopped (either source) whose date-left falls in
  // the selected window — same exact-range convention as Current Trainee.
  const quitStoppedGroups = useMemo(() => {
    const fromCandidates: QuitStoppedRow[] = candidates
      .filter((c) => c.status === "withdrawn" && c.withdrawnDate && c.withdrawnDate >= dateFrom && c.withdrawnDate <= dateTo)
      .map((c) => ({ key: c.id, name: c.name, branch: c.branch, dateLeft: c.withdrawnDate, reason: c.notes }));
    const fromMasterList: QuitStoppedRow[] = masterListTrainees
      .filter((t) => t.employeeInfo.terminateDate && t.employeeInfo.terminateDate >= dateFrom && t.employeeInfo.terminateDate <= dateTo)
      .map((t) => ({ key: `profile:${t.profileId}`, name: t.name, branch: t.branch, dateLeft: t.employeeInfo.terminateDate || null, reason: t.staffNote }));
    const byBranch = new Map<string, QuitStoppedRow[]>();
    for (const row of [...fromCandidates, ...fromMasterList]) {
      const key = row.branch || "Unassigned";
      if (!byBranch.has(key)) byBranch.set(key, []);
      byBranch.get(key)!.push(row);
    }
    return Array.from(byBranch.entries())
      .map(([branch, rows]) => ({ branch, rows }))
      .sort((a, b) => a.branch.localeCompare(b.branch));
  }, [candidates, masterListTrainees, dateFrom, dateTo]);

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
            <UnifiedBranchTable
              title="Current Trainee"
              groups={unifiedCurrentTraineeGroups}
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

            <QuitStoppedTable groups={quitStoppedGroups} emptyMessage={`No one quit/stopped for ${rangeLabel}.`} />
          </div>
        )}
      </main>
    </>
  );
}

/** Read-only log of everyone marked Quit/Stopped (either source) within the selected window — see quitStoppedGroups. */
function QuitStoppedTable({ groups, emptyMessage }: { groups: { branch: string; rows: QuitStoppedRow[] }[]; emptyMessage: string }) {
  return (
    <div className="panel overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 bg-white/5">
        <h2 className="text-sm font-bold text-white">Quit / Stopped</h2>
      </div>
      {groups.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-400">{emptyMessage}</p>
      ) : (
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 text-left text-xs font-semibold text-slate-400 uppercase">
            <th className="px-4 py-2">Area</th>
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Date Left</th>
            <th className="px-4 py-2">Reason</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) =>
            g.rows.map((r, i) => (
              <tr key={r.key} className="border-b border-white/5 last:border-b-0">
                <td className="px-4 py-2 font-semibold text-white">{i === 0 ? g.branch : ""}</td>
                <td className="px-4 py-2 text-slate-300">{r.name}</td>
                <td className="px-4 py-2 text-slate-300">{fmtDateShort(r.dateLeft)}</td>
                <td className="px-4 py-2 text-slate-400">{r.reason || "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      )}
    </div>
  );
}

/**
 * "Current Trainee" — the one section that mixes both sources (hr_candidates
 * AND Master List's Trainee tab, see unifiedCurrentTraineeGroups). Every
 * row's edit handler branches on which source it came from: a candidate row
 * writes through hr_candidates' own update functions exactly like
 * BranchTable below; a Master-List row writes through profiles' own
 * (saveProfileEmployeeInfo for the hire date, updateCompanyUser for the
 * training end date) — same underlying fields Master List itself edits, so
 * a change here shows up there too. Time In/Out (the manual hr_candidates-
 * only fields) simply don't apply to a Master-List row — disabled, not
 * hidden, so the column stays aligned.
 */
function UnifiedBranchTable({
  title,
  groups,
  emptyMessage,
  branchRoleByName,
  onChanged,
  profiles,
  dateFrom,
  dateTo,
}: {
  title: string;
  groups: UnifiedBranchGroup[];
  emptyMessage: string;
  branchRoleByName: Map<string, BranchRoles>;
  onChanged: () => void;
  profiles: ProfileRow[];
  dateFrom: string;
  dateTo: string;
}) {
  const [expandedBranch, setExpandedBranch] = useState<string | null>(null);
  const [expandedTraineeKey, setExpandedTraineeKey] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [quitTarget, setQuitTarget] = useState<UnifiedRow | null>(null);

  const withEdit = async (key: string, fn: () => Promise<void>) => {
    setSavingKey(key);
    setSaveError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSavingKey(null);
    }
  };

  const handleEditStartDate = (row: UnifiedRow, date: string) => {
    if (date === (row.startDate || "")) return;
    if (row.candidate) {
      const id = row.candidate.id;
      void withEdit(row.key, () => updateCandidateTrainingDates(id, { trainingStartDate: date || null }));
    } else if (row.masterList) {
      const { profileId, employeeInfo } = row.masterList;
      void withEdit(row.key, () => saveProfileEmployeeInfo(profileId, { ...employeeInfo, hireDate: date || undefined }));
    }
  };
  const handleEditFieldDate = (row: UnifiedRow, date: string) => {
    if (date === (row.fieldStartDate || "")) return;
    if (row.candidate) {
      const id = row.candidate.id;
      void withEdit(row.key, () => updateCandidateTrainingDates(id, { trainingEndDate: date || null }));
    } else if (row.masterList) {
      const { profileId } = row.masterList;
      void withEdit(row.key, () => updateCompanyUser(profileId, { trainingEndDate: date || null }));
    }
  };
  const handleEditTimeIn = (row: UnifiedRow, time: string) => {
    if (!row.candidate || time === (row.timeIn || "")) return;
    const id = row.candidate.id;
    void withEdit(row.key, () => updateCandidateTrainingTimes(id, { trainingTimeIn: time || null }));
  };
  const handleEditTimeOut = (row: UnifiedRow, time: string) => {
    if (!row.candidate || time === (row.timeOut || "")) return;
    const id = row.candidate.id;
    void withEdit(row.key, () => updateCandidateTrainingTimes(id, { trainingTimeOut: time || null }));
  };
  // Senior Manager / Branch Manager are branch-wide (General Information),
  // not per-row — applies identically regardless of which source a row
  // came from, since it's keyed off the branch name, not the row itself.
  const handleEditLeadership = (row: UnifiedRow, field: "seniorBranchManager" | "branchManager", value: string) => {
    const branch = row.branch || "";
    if (!branch) return;
    const existing = branchRoleByName.get(branch);
    if ((existing?.[field] || "") === value) return;
    void withEdit(row.key, () =>
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
                    <td className="px-4 py-2 text-slate-300">{joinDates(g.rows.map((r) => r.startDate).filter((d): d is string => !!d))}</td>
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
                            {g.rows.map((row) => {
                              const leadership = branchRoleByName.get(row.branch || "");
                              const busy = savingKey === row.key;
                              const traineeOpen = expandedTraineeKey === row.key;
                              return (
                                <Fragment key={row.key}>
                                <tr className="border-b border-white/5 last:border-b-0 align-top" onClick={(e) => e.stopPropagation()}>
                                  <td className="py-1.5 pr-3 font-semibold text-white whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() => setExpandedTraineeKey(traineeOpen ? null : row.key)}
                                      title="See their actual day-by-day Time In/Out"
                                      className="inline-flex items-center gap-1 hover:text-blue-300"
                                    >
                                      <ChevronDown className={`h-3 w-3 text-slate-400 transition-transform ${traineeOpen ? "rotate-180" : ""}`} />
                                      {row.name}
                                    </button>
                                  </td>
                                  <td className="py-1.5 pr-3">
                                    <input
                                      type="text"
                                      defaultValue={leadership?.seniorBranchManager || ""}
                                      disabled={busy || !row.branch}
                                      onBlur={(e) => handleEditLeadership(row, "seniorBranchManager", e.target.value)}
                                      title="Branch-wide — also updates General Information's leadership directory for this branch"
                                      className="bg-white/5 border border-white/15 rounded-md px-2 py-1 text-xs text-white w-28"
                                    />
                                  </td>
                                  <td className="py-1.5 pr-3">
                                    <input
                                      type="text"
                                      defaultValue={leadership?.branchManager || ""}
                                      disabled={busy || !row.branch}
                                      onBlur={(e) => handleEditLeadership(row, "branchManager", e.target.value)}
                                      title="Branch-wide — also updates General Information's leadership directory for this branch"
                                      className="bg-white/5 border border-white/15 rounded-md px-2 py-1 text-xs text-white w-28"
                                    />
                                  </td>
                                  <td className="py-1.5 pr-3">
                                    <input
                                      type="date"
                                      defaultValue={row.startDate || ""}
                                      disabled={busy}
                                      onChange={(e) => handleEditStartDate(row, e.target.value)}
                                      title={row.masterList ? "Master List's Hire Date" : undefined}
                                      className="bg-white/5 border border-white/15 rounded-md px-2 py-1 text-xs text-white"
                                    />
                                  </td>
                                  <td className="py-1.5 pr-3">
                                    <input
                                      type="date"
                                      defaultValue={row.fieldStartDate || ""}
                                      disabled={busy}
                                      onChange={(e) => handleEditFieldDate(row, e.target.value)}
                                      title={row.masterList ? "Master List's Training End Date" : undefined}
                                      className="bg-white/5 border border-white/15 rounded-md px-2 py-1 text-xs text-white"
                                    />
                                  </td>
                                  <td className="py-1.5 pr-3">
                                    <input
                                      type="time"
                                      defaultValue={row.timeIn || ""}
                                      disabled={busy || !row.candidate}
                                      onChange={(e) => handleEditTimeIn(row, e.target.value)}
                                      title={row.masterList ? "Not applicable to a Master List account — see the daily Check In below" : undefined}
                                      className="bg-white/5 border border-white/15 rounded-md px-2 py-1 text-xs text-white disabled:opacity-30"
                                    />
                                  </td>
                                  <td className="py-1.5 pr-3">
                                    <input
                                      type="time"
                                      defaultValue={row.timeOut || ""}
                                      disabled={busy || !row.candidate}
                                      onChange={(e) => handleEditTimeOut(row, e.target.value)}
                                      title={row.masterList ? "Not applicable to a Master List account — see the daily Check Out below" : undefined}
                                      className="bg-white/5 border border-white/15 rounded-md px-2 py-1 text-xs text-white disabled:opacity-30"
                                    />
                                  </td>
                                  <td className="py-1.5 pr-3 text-slate-300 whitespace-nowrap">
                                    <div>{row.phone || "—"}</div>
                                    <div className="text-slate-500">{row.email || ""}</div>
                                  </td>
                                  <td className="py-1.5 pr-3">
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => setQuitTarget(row)}
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
                                      <TraineeDailyPunches
                                        phone={row.phone}
                                        startDate={row.startDate}
                                        endDate={row.fieldStartDate}
                                        directProfileId={row.masterList?.profileId}
                                        profiles={profiles}
                                        dateFrom={dateFrom}
                                        dateTo={dateTo}
                                      />
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
          name={quitTarget.name}
          willDeactivateAccount={
            !!quitTarget.masterList ||
            (!!quitTarget.candidate && profiles.some((p) => normalizePhone(p.phone_number) === normalizePhone(quitTarget.candidate!.phone)))
          }
          onClose={() => setQuitTarget(null)}
          onConfirm={async (dateLeft, reason) => {
            if (quitTarget.candidate) {
              await updateCandidateStatus(quitTarget.candidate.id, "withdrawn", dateLeft);
              if (reason.trim()) await updateCandidateNotes(quitTarget.candidate.id, reason);
              // Deactivate their real account too, if they have one — same
              // phone match TraineeDailyPunches uses. A pure pipeline
              // candidate with no profile yet has nothing to deactivate.
              const normalizedPhone = normalizePhone(quitTarget.candidate.phone);
              const linkedProfile = normalizedPhone ? profiles.find((p) => normalizePhone(p.phone_number) === normalizedPhone) : undefined;
              if (linkedProfile) {
                await updateCompanyUser(linkedProfile.id, { isActive: false });
                // Master List's own Status column reads employee_info.
                // employmentStatus first, is_active only as a fallback when
                // that's unset — so is_active alone leaves Master List
                // showing stale "Active" (see the same fix in
                // ReportHRDaily.tsx's persistEmployeeStatus).
                const info = (await getProfileEmployeeInfo(linkedProfile.id)) || {};
                await saveProfileEmployeeInfo(linkedProfile.id, { ...info, employmentStatus: "inactive", employmentStatusDate: dateLeft, terminateDate: dateLeft });
              }
            } else if (quitTarget.masterList) {
              // No "withdrawn status" concept on a real profile — records
              // the same facts (when, why) onto the fields that ARE there:
              // employee_info.terminateDate (paired with hireDate, same
              // convention as training_end_date/hireDate above),
              // employmentStatus (what Master List's Status column actually
              // reads — see the note above), and staff_note. Also
              // deactivates the account outright (is_active) — per the
              // user's explicit call, quitting should deactivate
              // automatically, not wait on a separate Master List edit.
              await saveProfileEmployeeInfo(quitTarget.masterList.profileId, {
                ...quitTarget.masterList.employeeInfo,
                terminateDate: dateLeft,
                employmentStatus: "inactive",
                employmentStatusDate: dateLeft,
              });
              await updateCompanyUser(quitTarget.masterList.profileId, {
                isActive: false,
                ...(reason.trim() ? { staffNote: reason.trim() } : {}),
              });
            }
            setQuitTarget(null);
            onChanged();
          }}
        />
      )}
    </div>
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
                                      <TraineeDailyPunches
                                        phone={c.phone}
                                        startDate={c.trainingStartDate}
                                        endDate={c.trainingEndDate}
                                        profiles={profiles}
                                        dateFrom={dateFrom}
                                        dateTo={dateTo}
                                      />
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
          name={quitTarget.name}
          willDeactivateAccount={profiles.some((p) => normalizePhone(p.phone_number) === normalizePhone(quitTarget.phone))}
          onClose={() => setQuitTarget(null)}
          onConfirm={async (dateLeft, reason) => {
            await updateCandidateStatus(quitTarget.id, "withdrawn", dateLeft);
            if (reason.trim()) await updateCandidateNotes(quitTarget.id, reason);
            const normalizedPhone = normalizePhone(quitTarget.phone);
            const linkedProfile = normalizedPhone ? profiles.find((p) => normalizePhone(p.phone_number) === normalizedPhone) : undefined;
            if (linkedProfile) await updateCompanyUser(linkedProfile.id, { isActive: false });
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
 * tab reviews). For an hr_candidates row, hr_candidates and profiles share
 * no FK, so the only way to find its employee account is a normalized
 * phone-number match (pass `phone`, leave `directProfileId` unset); a
 * Master-List-sourced row already IS a profile, so its own id is passed
 * directly via `directProfileId`, skipping the phone-match heuristic
 * entirely. If no account can be resolved either way, this just says so
 * instead of guessing.
 */
function TraineeDailyPunches({
  phone,
  startDate,
  endDate,
  directProfileId,
  profiles,
  dateFrom,
  dateTo,
}: {
  phone: string | null;
  startDate: string | null;
  endDate: string | null;
  directProfileId?: string;
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
  const rangeStart = startDate && startDate > dateFrom ? startDate : dateFrom;
  const rangeEndRaw = endDate && endDate < dateTo ? endDate : dateTo;
  const rangeEnd = rangeEndRaw < rangeStart ? rangeStart : rangeEndRaw;

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const normalizedPhone = normalizePhone(phone);
        const profile = directProfileId
          ? profiles.find((p) => p.id === directProfileId)
          : normalizedPhone
          ? profiles.find((p) => normalizePhone(p.phone_number) === normalizedPhone)
          : undefined;
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
  }, [directProfileId, phone, rangeStart, rangeEnd, profiles]);

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

/**
 * Purely a confirmation UI — no idea whether it's marking an hr_candidates
 * row withdrawn or a Master List profile terminated, so it just collects
 * Date Left + Reason and hands them to whichever onConfirm the caller
 * built for its own data model. Same dialog, same fields, either source —
 * per the user's explicit call: "it should be the same quit or stop."
 */
function QuitDialog({
  name,
  willDeactivateAccount,
  onClose,
  onConfirm,
}: {
  name: string;
  /** Whether a linked employee account was found — if so, confirming also flips is_active false on it (same field Master List's own Status column reads). No account found (a pure pipeline candidate) means there's nothing to deactivate. */
  willDeactivateAccount: boolean;
  onClose: () => void;
  onConfirm: (dateLeft: string, reason: string) => Promise<void>;
}) {
  const [dateLeft, setDateLeft] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setSaving(true);
    setError(null);
    try {
      await onConfirm(dateLeft, reason);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  // Portaled to document.body — this page is rendered embedded inside
  // ReportHRDaily's tab content, whose own containers can establish a new
  // containing block for `position: fixed` (a transform/overflow ancestor
  // is enough), which pins the dialog to that scrolled container instead
  // of the real viewport. Same fix as ModuleNavigator/TicketColumnFilter's
  // own portaled overlays elsewhere in this codebase.
  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-white/10 rounded-lg shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-white">Mark {name} as Quit/Stopped</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-slate-400">
            {willDeactivateAccount
              ? "This will also deactivate their linked account (User Management / Master List)."
              : "No linked employee account found yet — this only records their hiring pipeline status, nothing to deactivate."}
          </p>
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
    </div>,
    document.body
  );
}
