/**
 * Employee Monitoring -> Exceeded -> Time Corrections.
 *
 * Three lists: Technician (Technician / Branch Manager / Senior Branch
 * Manager / Technical Director / Technical Assistant Director), US (Parts
 * staff only) and PH (everyone at the Philippines branch) — with how many
 * timecard corrections
 * each filed for the selected month (by the day being corrected). The
 * allowance is MAX_CORRECTIONS_PER_MONTH; anyone over it gets an "Over limit"
 * flag. Clicking a name opens that person's timecards for the month, with
 * the corrected days marked. Admin / HR / Super Admin can mark a correction
 * Exempt (with a reason) so it doesn't count — see correctionExemptions.ts.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Flag, ShieldCheck, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { AppModal } from "@/components/ui-kit/AppModal";
import {
  getCorrectionExemptions,
  exemptCorrection,
  removeCorrectionExemption,
  type CorrectionExemption,
} from "@/lib/supabase/correctionExemptions";
import { ROLE_LABELS, TECHNICIAN_PAY_ROLES, BM_AND_UP_ROLES, normalizeRole } from "@/lib/roleLabels";
import type { ProfileRow } from "@/lib/supabase/users";
import { getCompanyTimecardEntries, type CompanyTimecardEntry } from "@/lib/supabase/timecards";
import {
  getCompanyTimecardCorrections,
  correctionShiftMinutes,
  formatShift,
  type TimecardCorrectionRow,
} from "@/lib/supabase/timecardCorrections";
import { EXCEPTION_TYPE_LABELS, CORRECTION_ISSUE_LABELS } from "@/lib/exceptionVisitReportTemplate";
import { getCompanyPtoRequests, HR_STATUS_TO_PTO_TYPE, type PtoRequestRow, type PtoType } from "@/lib/supabase/pto";
import { getAttendanceNotes, type AttendanceNoteRow } from "@/lib/supabase/attendanceNotes";
import { getCompanyTraineeEntries } from "@/lib/supabase/traineeTimecards";
import { getCompanyHolidaysInRange } from "@/lib/supabase/companyHolidays";
import { EmptyState } from "@/components/ui-kit/EmptyState";
import { TableSkeleton } from "@/components/ui-kit/TableSkeleton";

/** Corrections allowed per person per month; more than this is flagged. */
export const MAX_CORRECTIONS_PER_MONTH = 2;

const PH_BRANCH = "Philippines";

type Region = "TECH" | "US" | "PH";
type GroupKey =
  | "TECHNICIAN"
  | "BRANCH_MANAGER"
  | "SENIOR_BRANCH_MANAGER"
  | "TECHNICAL_DIRECTOR"
  | "TECHNICAL_ASSISTANT_DIRECTOR"
  | "PARTS"
  | "PARTS_TEAM_LEADER"
  | "PARTS_MANAGER"
  | "PARTS_ORDER"
  | "PH";

const REGIONS: { key: Region; label: string }[] = [
  { key: "TECH", label: "Technician" },
  { key: "US", label: "US (Parts)" },
  { key: "PH", label: "PH" },
];

const GROUPS: { key: GroupKey; label: string; region: Region }[] = [
  { key: "TECHNICIAN", label: "Technician", region: "TECH" },
  { key: "BRANCH_MANAGER", label: "Branch Manager", region: "TECH" },
  { key: "SENIOR_BRANCH_MANAGER", label: "Senior Branch Manager", region: "TECH" },
  { key: "TECHNICAL_DIRECTOR", label: "Technical Director", region: "TECH" },
  { key: "TECHNICAL_ASSISTANT_DIRECTOR", label: "Technical Assistant Director", region: "TECH" },
  { key: "PARTS", label: "Parts", region: "US" },
  { key: "PARTS_TEAM_LEADER", label: "Parts Team Leader", region: "US" },
  { key: "PARTS_MANAGER", label: "Parts Manager", region: "US" },
  { key: "PARTS_ORDER", label: "Parts Order", region: "US" },
  { key: "PH", label: "Philippines", region: "PH" },
];

const PARTS_ROLES = new Set(["PARTS", "PARTS_TEAM_LEADER", "PARTS_MANAGER", "PARTS_ORDER"]);

function groupOf(p: ProfileRow): GroupKey | null {
  if (p.assigned_branch === PH_BRANCH) return "PH";
  const role = normalizeRole(p.role);
  if (BM_AND_UP_ROLES.has(role)) return role as GroupKey;
  if (TECHNICIAN_PAY_ROLES.has(role)) return "TECHNICIAN";
  if (PARTS_ROLES.has(role)) return role as GroupKey;
  return null;
}

const regionOf = (g: GroupKey): Region => GROUPS.find((x) => x.key === g)!.region;

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

/** "start|end" range key → its two dates. */
function rangeBounds(range: string): { start: string; end: string } {
  const [start, end] = range.split("|");
  return { start, end };
}

/** How many calendar months a range touches (Oct 15 – Nov 3 = 2). */
function monthsInRange(range: string): number {
  const { start, end } = rangeBounds(range);
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  return Math.max(1, (ey - sy) * 12 + (em - sm) + 1);
}

/** "October 2026" for a whole month, otherwise "Oct 3 – Nov 12, 2026". */
function rangeLabel(range: string): string {
  const { start, end } = rangeBounds(range);
  const whole = monthBounds(start.slice(0, 7));
  if (start === whole.start && end === whole.end) return monthLabel(start.slice(0, 7));
  const d = (iso: string, withYear: boolean) => {
    const [y, m, dd] = iso.split("-").map(Number);
    return new Date(y, m - 1, dd).toLocaleDateString(undefined, { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });
  };
  return `${d(start, start.slice(0, 4) !== end.slice(0, 4))} – ${d(end, true)}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function fmtDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function to12h(t: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || "");
  if (!m) return "—";
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** "Forgot to clock", "System Issue", … — the issue picked on the request. */
function issueLabel(c: TimecardCorrectionRow): string | null {
  if (!c.exceptionType) return null;
  const labels: Record<string, string> = { ...EXCEPTION_TYPE_LABELS, ...CORRECTION_ISSUE_LABELS };
  const label = labels[c.exceptionType] ?? c.exceptionType;
  return c.exceptionType === "other" && c.otherDescription ? `Other: ${c.otherDescription}` : label;
}

/** What the request changed, e.g. "In 9:04 AM · Out 5:45 PM" — only the times it actually set. */
function correctedTimes(c: TimecardCorrectionRow): string {
  const parts: string[] = [];
  if (c.correctedCheckIn) parts.push(`In ${to12h(c.correctedCheckIn)}`);
  if (c.correctedMealStart) parts.push(`Meal ${to12h(c.correctedMealStart)}–${to12h(c.correctedMealEnd)}`);
  if (c.correctedCheckOut) parts.push(`Out ${to12h(c.correctedCheckOut)}`);
  return parts.join(" · ");
}

/** Approved and pending corrections count toward the monthly limit; rejected ones changed nothing, and exempt ones were excused. */
function countsTowardLimit(c: TimecardCorrectionRow, activeExemption: Map<string, unknown>): boolean {
  return c.status !== "rejected" && !activeExemption.has(c.id);
}

/** Leave columns, same letters as the Time Off Calendar. A = Unnoticed. */
const LEAVE_COLUMNS: { letter: LeaveLetter; label: string }[] = [
  { letter: "V", label: "Vacation" },
  { letter: "S", label: "Sick" },
  { letter: "P", label: "Personal" },
  { letter: "H", label: "Holiday" },
  { letter: "U", label: "Unpaid" },
  { letter: "B", label: "Bereavement" },
  { letter: "A", label: "Unnoticed + Absent — marked Unnoticed, pending/rejected leave, or a missed workday with nothing filed" },
];
type LeaveLetter = "V" | "S" | "P" | "H" | "U" | "B" | "A";
const PTO_LETTER: Record<PtoType, LeaveLetter> = { vacation: "V", sick: "S", personal: "P", holiday: "H", unpaid: "U", bereavement: "B" };

function nextISO(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/** Why a day landed in A: marked/requested (Unnoticed) vs. nothing at all (Absent). */
type AKind = "unnoticed" | "absent";

/** One counted leave day — what it came from, for the details popup. */
interface LeaveDay {
  date: string;
  letter: LeaveLetter;
  /** The leave request behind it, if any. */
  request: PtoRequestRow | null;
  /** The Absent List HR Status behind it, if any. */
  hrNote: string | null;
  /** Only on A days. */
  aKind?: AKind;
}

/** What the person did on each day of the range — used to spot days with no update at all. */
interface DayActivity {
  /** Days they clocked in (regular or trainee timecard). */
  punched: Set<string>;
  /** Days they filed a time correction for. */
  corrected: Set<string>;
}

/**
 * Working days per leave letter for one person in [start, end]. Per day:
 *  - an approved request counts as its type;
 *  - a pending or rejected (denied) request counts as A (Unnoticed);
 *  - otherwise the Absent List's HR Status — a leave type counts as that
 *    type, Unnoticed (old label "Absent") as A (Unnoticed);
 *  - otherwise, a past workday with no clock-in and no correction filed
 *    counts as A (Absent) — nothing was done about it at all.
 * Rest days (profile off_days, Sat/Sun when unset), company holidays, days
 * before the account existed, today/future days (for Absent) and cancelled
 * requests don't count.
 */
function leaveCounts(
  profile: ProfileRow,
  requests: PtoRequestRow[],
  notes: AttendanceNoteRow[],
  start: string,
  end: string,
  activity: DayActivity | null,
  holidays: Set<string>,
  today: string
): { counts: Record<LeaveLetter, number>; days: LeaveDay[] } {
  const out: Record<LeaveLetter, number> = { V: 0, S: 0, P: 0, H: 0, U: 0, B: 0, A: 0 };
  const rest = new Set(profile.off_days && profile.off_days.length > 0 ? profile.off_days : [0, 6]);
  const isRest = (iso: string) => rest.has(new Date(`${iso}T00:00:00`).getDay());
  const byDay = new Map<string, LeaveDay & { approved: boolean }>();
  for (const r of requests) {
    if (r.status === "cancelled" || !r.startDate || !r.endDate) continue;
    const approved = r.status === "approved";
    const from = r.startDate > start ? r.startDate : start;
    const to = r.endDate < end ? r.endDate : end;
    for (let d = from; d <= to; d = nextISO(d)) {
      if (isRest(d)) continue;
      if (byDay.get(d)?.approved) continue; // an approved request wins the day
      byDay.set(d, approved
        ? { date: d, letter: PTO_LETTER[r.ptoType], request: r, hrNote: null, approved }
        : { date: d, letter: "A", aKind: "unnoticed", request: r, hrNote: null, approved });
    }
  }
  for (const n of notes) {
    if (n.noteDate < start || n.noteDate > end || byDay.has(n.noteDate) || isRest(n.noteDate)) continue;
    if (n.hrNote === "Absent" || n.hrNote === "Unnoticed") {
      byDay.set(n.noteDate, { date: n.noteDate, letter: "A", aKind: "unnoticed", request: null, hrNote: n.hrNote, approved: true });
      continue;
    }
    const t = HR_STATUS_TO_PTO_TYPE[n.hrNote];
    if (t) byDay.set(n.noteDate, { date: n.noteDate, letter: PTO_LETTER[t], request: null, hrNote: n.hrNote, approved: true });
  }
  if (activity) {
    const since = (profile.created_at || "").slice(0, 10);
    const lastPast = end < today ? end : prevISO(today);
    for (let d = start; d <= lastPast; d = nextISO(d)) {
      if (byDay.has(d) || isRest(d) || holidays.has(d) || (since && d < since)) continue;
      if (activity.punched.has(d) || activity.corrected.has(d)) continue;
      byDay.set(d, { date: d, letter: "A", aKind: "absent", request: null, hrNote: null, approved: true });
    }
  }
  const days: LeaveDay[] = [];
  for (const v of byDay.values()) {
    out[v.letter]++;
    days.push({ date: v.date, letter: v.letter, request: v.request, hrNote: v.hrNote, aKind: v.aKind });
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  return { counts: out, days };
}

function prevISO(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d - 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Same-request days collapse into one row in the details popup. */
interface LeaveGroup {
  key: string;
  days: string[];
  request: PtoRequestRow | null;
  hrNote: string | null;
}
function groupLeaveDays(days: LeaveDay[]): LeaveGroup[] {
  const groups: LeaveGroup[] = [];
  const byRequest = new Map<string, LeaveGroup>();
  for (const d of days) {
    if (d.request) {
      let g = byRequest.get(d.request.id);
      if (!g) {
        g = { key: d.request.id, days: [], request: d.request, hrNote: null };
        byRequest.set(d.request.id, g);
        groups.push(g);
      }
      g.days.push(d.date);
    } else {
      groups.push({ key: `${d.hrNote ?? "none"}:${d.date}`, days: [d.date], request: null, hrNote: d.hrNote });
    }
  }
  return groups;
}

const STATUS_STYLE: Record<string, string> = {
  approved: "bg-green-500/15 text-green-300 border-green-500/30",
  pending: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  rejected: "bg-red-500/15 text-red-300 border-red-500/30",
};

interface PersonRow {
  profile: ProfileRow;
  group: GroupKey;
  corrections: TimecardCorrectionRow[];
  /** Corrections that count toward the limit (not exempt). */
  counted: number;
  exemptCount: number;
}

function fmtStamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

type ExemptDialog =
  | { kind: "exempt"; correction: TimecardCorrectionRow; personName: string }
  | { kind: "remove"; correction: TimecardCorrectionRow; personName: string; exemption: CorrectionExemption };

export function ExceededTimeCorrectionsTab({
  profiles,
  canExempt,
  myName,
  myProfileId,
}: {
  profiles: ProfileRow[];
  /** Admin / HR / Super Admin — matches migration 0354's write policy. */
  canExempt: boolean;
  myName: string;
  myProfileId: string | null;
}) {
  const [rangeFrom, setRangeFrom] = useState(monthBounds(currentMonth()).start);
  const [rangeTo, setRangeTo] = useState(monthBounds(currentMonth()).end);
  /** "start|end", in order — the key everything below is computed/cached by. */
  const range = rangeFrom <= rangeTo ? `${rangeFrom}|${rangeTo}` : `${rangeTo}|${rangeFrom}`;
  /** 2 per month, times however many calendar months the range touches. */
  const allowed = MAX_CORRECTIONS_PER_MONTH * monthsInRange(range);
  const [region, setRegion] = useState<Region>("TECH");
  const [search, setSearch] = useState("");
  const [overOnly, setOverOnly] = useState(false);
  const [corrections, setCorrections] = useState<TimecardCorrectionRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [entriesByMonth, setEntriesByMonth] = useState<Map<string, CompanyTimecardEntry[]>>(new Map());
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [exemptions, setExemptions] = useState<CorrectionExemption[]>([]);
  const [ptoRequests, setPtoRequests] = useState<PtoRequestRow[]>([]);
  const [traineeByRange, setTraineeByRange] = useState<Map<string, { profileId: string; workDate: string; checkIn: string }[]>>(new Map());
  const [holidaysByRange, setHolidaysByRange] = useState<Map<string, Set<string>>>(new Map());
  const [leaveDetail, setLeaveDetail] = useState<{ profileId: string; person: string; letter: LeaveLetter } | null>(null);
  const [notesByMonth, setNotesByMonth] = useState<Map<string, AttendanceNoteRow[]>>(new Map());
  const [dialog, setDialog] = useState<ExemptDialog | null>(null);
  const [dialogReason, setDialogReason] = useState("");
  const [dialogSaving, setDialogSaving] = useState(false);

  useEffect(() => {
    getCompanyTimecardCorrections()
      .then(setCorrections)
      .catch(() => setCorrections([]));
    getCorrectionExemptions().then(setExemptions);
    getCompanyPtoRequests()
      .then(setPtoRequests)
      .catch(() => setPtoRequests([]));
  }, []);

  // Absent List HR Status for the range — loaded once per range viewed.
  useEffect(() => {
    if (notesByMonth.has(range)) return;
    let cancelled = false;
    const { start, end } = rangeBounds(range);
    getAttendanceNotes(start, end)
      .then((rows) => !cancelled && setNotesByMonth((prev) => new Map(prev).set(range, rows)))
      .catch(() => !cancelled && setNotesByMonth((prev) => new Map(prev).set(range, [])));
    return () => {
      cancelled = true;
    };
  }, [range, notesByMonth]);

  const leaveByProfile = useMemo(() => {
    const { start, end } = rangeBounds(range);
    const notes = notesByMonth.get(range) ?? [];
    const reqByProfile = new Map<string, PtoRequestRow[]>();
    for (const r of ptoRequests) {
      if (!r.startDate || !r.endDate || r.endDate < start || r.startDate > end) continue;
      if (!reqByProfile.has(r.profileId)) reqByProfile.set(r.profileId, []);
      reqByProfile.get(r.profileId)!.push(r);
    }
    const notesByProfile = new Map<string, AttendanceNoteRow[]>();
    for (const n of notes) {
      if (!notesByProfile.has(n.profileId)) notesByProfile.set(n.profileId, []);
      notesByProfile.get(n.profileId)!.push(n);
    }
    // Absent needs the punches, trainee punches and holidays for the range;
    // until they've loaded, A shows only Unnoticed.
    const punches = entriesByMonth.get(range);
    const trainee = traineeByRange.get(range);
    const holidays = holidaysByRange.get(range) ?? new Set<string>();
    const activityByProfile = new Map<string, DayActivity>();
    if (punches && trainee && corrections) {
      const act = (id: string) => {
        if (!activityByProfile.has(id)) activityByProfile.set(id, { punched: new Set(), corrected: new Set() });
        return activityByProfile.get(id)!;
      };
      for (const e of punches) if (e.checkIn) act(e.profileId).punched.add(e.workDate);
      for (const e of trainee) if (e.checkIn) act(e.profileId).punched.add(e.workDate);
      for (const c of corrections) if (c.workDate >= start && c.workDate <= end) act(c.profileId).corrected.add(c.workDate);
    }
    const ready = !!(punches && trainee && corrections && holidaysByRange.has(range));
    const today = todayISO();
    const map = new Map<string, ReturnType<typeof leaveCounts>>();
    for (const p of profiles)
      map.set(
        p.id,
        leaveCounts(p, reqByProfile.get(p.id) ?? [], notesByProfile.get(p.id) ?? [], start, end, ready ? activityByProfile.get(p.id) ?? { punched: new Set(), corrected: new Set() } : null, holidays, today)
      );
    return map;
  }, [range, ptoRequests, notesByMonth, profiles, entriesByMonth, traineeByRange, holidaysByRange, corrections]);

  const activeExemption = useMemo(() => {
    const map = new Map<string, CorrectionExemption>();
    for (const e of exemptions) if (!e.removedAt) map.set(e.correctionId, e);
    return map;
  }, [exemptions]);
  const exemptionHistory = useMemo(() => {
    const map = new Map<string, CorrectionExemption[]>();
    for (const e of exemptions) {
      if (!map.has(e.correctionId)) map.set(e.correctionId, []);
      map.get(e.correctionId)!.push(e);
    }
    return map;
  }, [exemptions]);

  const openDialog = (d: ExemptDialog) => {
    setDialogReason("");
    setDialog(d);
  };
  const dialogLabel = (d: ExemptDialog) => `${d.personName} — ${fmtDay(d.correction.workDate)}`;
  const saveDialog = async () => {
    if (!dialog) return;
    if (dialog.kind === "exempt" && !dialogReason.trim()) return;
    setDialogSaving(true);
    try {
      if (dialog.kind === "exempt") {
        const row = await exemptCorrection({ correctionId: dialog.correction.id, reason: dialogReason, byName: myName, label: dialogLabel(dialog) });
        setExemptions((prev) => [row, ...prev]);
        toast.success(`Exempted — ${dialog.personName}'s ${fmtDay(dialog.correction.workDate)} correction no longer counts.`);
      } else {
        await removeCorrectionExemption({
          exemptionId: dialog.exemption.id,
          correctionId: dialog.correction.id,
          reason: dialogReason,
          byName: myName,
          byProfileId: myProfileId,
          label: dialogLabel(dialog),
        });
        const now = new Date().toISOString();
        const removedId = dialog.exemption.id;
        setExemptions((prev) =>
          prev.map((e) => (e.id === removedId ? { ...e, removedAt: now, removedByName: myName, removedReason: dialogReason.trim() || null } : e))
        );
        toast.success("Exemption removed — the correction counts again.");
      }
      setDialog(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save — try again.");
    } finally {
      setDialogSaving(false);
    }
  };

  // A range's punches load once, the first time someone in it is opened.
  useEffect(() => {
    if (entriesByMonth.has(range)) return;
    let cancelled = false;
    setEntriesLoading(true);
    const { start, end } = rangeBounds(range);
    getCompanyTimecardEntries(start, end)
      .then((rows) => {
        if (!cancelled) setEntriesByMonth((prev) => new Map(prev).set(range, rows));
      })
      .finally(() => {
        if (!cancelled) setEntriesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range, entriesByMonth]);

  useEffect(() => {
    if (traineeByRange.has(range) && holidaysByRange.has(range)) return;
    let cancelled = false;
    const { start, end } = rangeBounds(range);
    Promise.all([getCompanyTraineeEntries(start, end).catch(() => []), getCompanyHolidaysInRange(start, end).catch(() => [])]).then(([trainee, holidays]) => {
      if (cancelled) return;
      setTraineeByRange((prev) => new Map(prev).set(range, trainee));
      setHolidaysByRange((prev) => new Map(prev).set(range, new Set(holidays.map((h) => h.date))));
    });
    return () => {
      cancelled = true;
    };
  }, [range, traineeByRange, holidaysByRange]);

  const rows = useMemo<PersonRow[]>(() => {
    if (!corrections) return [];
    const { start, end } = rangeBounds(range);
    const byProfile = new Map<string, TimecardCorrectionRow[]>();
    for (const c of corrections) {
      if (c.workDate < start || c.workDate > end) continue;
      if (!byProfile.has(c.profileId)) byProfile.set(c.profileId, []);
      byProfile.get(c.profileId)!.push(c);
    }
    const q = search.trim().toLowerCase();
    const out: PersonRow[] = [];
    for (const p of profiles) {
      if (!p.is_active) continue;
      const group = groupOf(p);
      if (!group) continue;
      if (q && !(p.display_name || p.email || "").toLowerCase().includes(q)) continue;
      const mine = (byProfile.get(p.id) ?? []).sort((a, b) => a.workDate.localeCompare(b.workDate));
      const exemptCount = mine.filter((c) => activeExemption.has(c.id)).length;
      const counted = mine.filter((c) => countsTowardLimit(c, activeExemption)).length;
      if (overOnly && counted <= allowed) continue;
      out.push({ profile: p, group, corrections: mine, counted, exemptCount });
    }
    return out.sort(
      (a, b) => b.counted - a.counted || b.corrections.length - a.corrections.length || (a.profile.display_name || "").localeCompare(b.profile.display_name || "")
    );
  }, [corrections, profiles, range, search, overOnly, activeExemption, allowed]);

  const regionRows = rows.filter((r) => regionOf(r.group) === region);
  const overCount = (list: PersonRow[]) => list.filter((r) => r.counted > allowed).length;

  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-base font-semibold">Exceeded Time Corrections</h2>
      </div>
      <p className="text-xs text-slate-400 mb-4">
        Timecard corrections each person filed for {rangeLabel(range)}, counted by the day being corrected. {MAX_CORRECTIONS_PER_MONTH} a month is the maximum ({allowed} for this range) — anyone over it is flagged. Rejected and exempt corrections don't count. V / S / P / H / U / B / A are leave days in the range — A = Unnoticed (marked, or pending/rejected leave) + Absent (missed workday, nothing filed); click a number for the days. Click a name to see their timecards.
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">From</label>
          <input type="date" value={rangeFrom} onChange={(e) => e.target.value && setRangeFrom(e.target.value)} className="glass-input" />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">To</label>
          <input type="date" value={rangeTo} onChange={(e) => e.target.value && setRangeTo(e.target.value)} className="glass-input" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Search</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Employee name..." className="glass-input w-full" />
        </div>
        <label className="flex items-center gap-2 text-sm pb-2 cursor-pointer select-none">
          <input type="checkbox" checked={overOnly} onChange={(e) => setOverOnly(e.target.checked)} />
          Only over the limit
        </label>
      </div>

      <div className="mb-4 flex gap-2">
        {REGIONS.map(({ key: r, label }) => {
          const over = overCount(rows.filter((x) => regionOf(x.group) === r));
          return (
            <button
              key={r}
              type="button"
              onClick={() => setRegion(r)}
              className={`btn btn-sm ${region === r ? "bg-primary/20 text-primary" : ""}`}
            >
              {label}
              {over > 0 && <span className="rounded-full bg-red-500/20 px-1.5 text-[10px] font-bold text-red-300">{over}</span>}
            </button>
          );
        })}
      </div>

      {corrections === null ? (
        <TableSkeleton rows={6} cols={4} />
      ) : regionRows.length === 0 ? (
        <EmptyState
          compact
          title={overOnly ? "No one is over the limit" : "No employees to show"}
          hint={overOnly ? `Nobody in this list filed more than ${allowed} corrections in ${rangeLabel(range)}.` : undefined}
        />
      ) : (
        <div className="space-y-5">
          {GROUPS.filter((g) => g.region === region).map((g) => {
            const list = regionRows.filter((r) => r.group === g.key);
            if (list.length === 0) return null;
            const total = list.reduce((s, r) => s + r.counted, 0);
            return (
              <section key={g.key}>
                <div className="mb-1.5 flex items-baseline gap-2">
                  <h3 className="text-sm font-semibold">{g.label}</h3>
                  <span className="text-xs text-slate-400">
                    {list.length} {list.length === 1 ? "person" : "people"} · {total} {total === 1 ? "correction" : "corrections"}
                    {overCount(list) > 0 && <span className="text-red-300"> · {overCount(list)} over limit</span>}
                  </span>
                </div>
                <div className="overflow-x-auto rounded-lg border border-white/10">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 font-semibold">Name</th>
                        <th className="px-3 py-2 font-semibold">{g.key === "PH" ? "Role" : "Branch"}</th>
                        <th className="px-3 py-2 font-semibold">Corrections</th>
                        {LEAVE_COLUMNS.map((c) => (
                          <th key={c.letter} className="w-9 px-1 py-2 text-center font-semibold" title={c.label}>
                            {c.letter}
                          </th>
                        ))}
                        <th className="px-3 py-2 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((r) => {
                        const n = r.counted;
                        const over = n > allowed;
                        const open = openId === r.profile.id;
                        const counts = { approved: 0, pending: 0, rejected: 0 } as Record<string, number>;
                        for (const c of r.corrections) counts[c.status] = (counts[c.status] ?? 0) + 1;
                        return (
                          <Fragment key={r.profile.id}>
                            <tr className={`border-b border-white/5 last:border-b-0 ${over ? "bg-red-500/[0.06]" : ""}`}>
                              <td className="px-3 py-2">
                                <button
                                  type="button"
                                  onClick={() => setOpenId(open ? null : r.profile.id)}
                                  className="inline-flex items-center gap-1 font-semibold hover:text-primary"
                                >
                                  {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                  {r.profile.display_name || r.profile.email}
                                </button>
                              </td>
                              <td className="px-3 py-2 text-slate-300">
                                {g.key === "PH" ? ROLE_LABELS[normalizeRole(r.profile.role)] ?? r.profile.role : r.profile.assigned_branch || "—"}
                              </td>
                              <td className="px-3 py-2 tabular-nums">
                                <span className={`font-semibold ${over ? "text-red-300" : n === allowed ? "text-amber-300" : ""}`}>{n}</span>
                                <span className="text-slate-500"> / {allowed}</span>
                                {r.corrections.length > 0 && (
                                  <span className="ml-2 text-[11px] text-slate-400">
                                    {[
                                      ...(["approved", "pending", "rejected"] as const).filter((s) => counts[s]).map((s) => `${counts[s]} ${s}`),
                                      ...(r.exemptCount > 0 ? [`${r.exemptCount} exempt`] : []),
                                    ].join(" · ")}
                                  </span>
                                )}
                              </td>
                              {LEAVE_COLUMNS.map((c) => {
                                const v = leaveByProfile.get(r.profile.id)?.counts[c.letter] ?? 0;
                                return (
                                  <td key={c.letter} className="w-9 px-1 py-2 text-center tabular-nums" title={`${c.label}: ${v} day${v === 1 ? "" : "s"}`}>
                                    {v === 0 ? (
                                      <span className="text-slate-600">·</span>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => setLeaveDetail({ profileId: r.profile.id, person: r.profile.display_name || r.profile.email || "", letter: c.letter })}
                                        className={`min-w-[1.6rem] rounded px-1 font-semibold underline decoration-dotted underline-offset-2 hover:bg-white/10 ${c.letter === "A" ? "text-red-300" : ""}`}
                                      >
                                        {v}
                                      </button>
                                    )}
                                  </td>
                                );
                              })}
                              <td className="px-3 py-2">
                                {over ? (
                                  <span className="inline-flex items-center gap-1 rounded border border-red-500/40 bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-300">
                                    <Flag className="h-3 w-3" /> Over limit
                                  </span>
                                ) : n === allowed ? (
                                  <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300">At limit</span>
                                ) : (
                                  <span className="text-[11px] text-slate-500">OK</span>
                                )}
                              </td>
                            </tr>
                            {open && (
                              <tr className="border-b border-white/5 bg-black/30">
                                <td colSpan={4 + LEAVE_COLUMNS.length} className="px-3 py-3">
                                  <MonthTimecards
                                    range={range}
                                    profileId={r.profile.id}
                                    corrections={r.corrections}
                                    entries={entriesByMonth.get(range)}
                                    loading={entriesLoading && !entriesByMonth.has(range)}
                                    activeExemption={activeExemption}
                                    exemptionHistory={exemptionHistory}
                                    canExempt={canExempt}
                                    onExempt={(c) => openDialog({ kind: "exempt", correction: c, personName: r.profile.display_name || r.profile.email || "" })}
                                    onRemove={(c, e) => openDialog({ kind: "remove", correction: c, exemption: e, personName: r.profile.display_name || r.profile.email || "" })}
                                  />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {leaveDetail && (() => {
        const col = LEAVE_COLUMNS.find((c) => c.letter === leaveDetail.letter)!;
        const days = (leaveByProfile.get(leaveDetail.profileId)?.days ?? []).filter((d) => d.letter === leaveDetail.letter);
        const isA = leaveDetail.letter === "A";
        const sections = isA
          ? [
              { title: "Unnoticed", hint: "Marked Unnoticed on the Absent List, or a leave request that's still pending or was rejected.", days: days.filter((d) => d.aKind === "unnoticed") },
              { title: "Absent", hint: "Missed workday — no clock-in, and nothing was filed or marked.", days: days.filter((d) => d.aKind === "absent") },
            ]
          : [{ title: "", hint: "", days }];
        const dayList = (ds: string[]) => (ds.length === 1 ? fmtDay(ds[0]) : `${fmtDay(ds[0])} – ${fmtDay(ds[ds.length - 1])}`);
        return (
          <AppModal
            size="md"
            title={`${isA ? "Unnoticed + Absent" : col.label} — ${leaveDetail.person}`}
            description={`${days.length} day${days.length === 1 ? "" : "s"} in ${rangeLabel(range)}`}
            onClose={() => setLeaveDetail(null)}
          >
            <div className="space-y-5">
              {sections.map((sec) => (
                <section key={sec.title || "all"}>
                  {sec.title && (
                    <div className="mb-1.5">
                      <h3 className="text-sm font-semibold">
                        {sec.title} <span className="font-normal text-[var(--color-muted-foreground)]">({sec.days.length})</span>
                      </h3>
                      <p className="text-[11px] text-[var(--color-muted-foreground)]">{sec.hint}</p>
                    </div>
                  )}
                  {sec.days.length === 0 ? (
                    <p className="text-[13px] text-[var(--color-muted-foreground)]">None.</p>
                  ) : (
                    <div className="divide-y divide-[var(--color-panel-border)] rounded-lg border border-[var(--color-panel-border)]">
                      {groupLeaveDays(sec.days).map((g) => {
                        const r = g.request;
                        const status = r ? (r.status === "denied" ? "rejected" : r.status) : null;
                        return (
                          <div key={g.key} className="px-3 py-2.5 text-[13px]">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold">{dayList(g.days)}</span>
                              {g.days.length > 1 && <span className="text-[11px] text-[var(--color-muted-foreground)]">{g.days.length} working days</span>}
                              {r ? (
                                <span className={`rounded border px-1.5 py-px text-[11px] font-semibold capitalize ${STATUS_STYLE[status!] ?? ""}`}>{status} request</span>
                              ) : g.hrNote ? (
                                <span className="rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-px text-[11px] font-semibold text-sky-300">Set by HR</span>
                              ) : (
                                <span className="rounded border border-red-500/30 bg-red-500/10 px-1.5 py-px text-[11px] font-semibold text-red-300">No clock-in · nothing filed</span>
                              )}
                            </div>
                            {r && (
                              <div className="mt-1">
                                {LEAVE_COLUMNS.find((c) => c.letter === PTO_LETTER[r.ptoType])?.label} request · {fmtDay(r.startDate)}
                                {r.endDate !== r.startDate ? ` – ${fmtDay(r.endDate)}` : ""}
                                {r.reason && <div className="text-[var(--color-muted-foreground)]">"{r.reason}"</div>}
                              </div>
                            )}
                            {!r && g.hrNote && <div className="mt-1">Absent List HR Status: {g.hrNote}</div>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              ))}
            </div>
          </AppModal>
        );
      })()}

      {dialog && (
        <AppModal
          size="sm"
          title={dialog.kind === "exempt" ? "Exempt this correction?" : "Remove exemption?"}
          description={`${dialogLabel(dialog)}${correctedTimes(dialog.correction) ? ` · ${correctedTimes(dialog.correction)}` : ""}`}
          busy={dialogSaving}
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" onClick={() => setDialog(null)} disabled={dialogSaving} className="btn">
                Cancel
              </button>
              <button
                type="button"
                onClick={saveDialog}
                disabled={dialogSaving || (dialog.kind === "exempt" && !dialogReason.trim())}
                className={dialog.kind === "exempt" ? "btn btn-primary" : "btn btn-danger"}
              >
                {dialogSaving ? "Saving…" : dialog.kind === "exempt" ? "Exempt" : "Remove exemption"}
              </button>
            </>
          }
        >
          <div className="space-y-3 text-sm">
            {dialog.kind === "exempt" ? (
              <p className="text-[13px] text-[var(--color-muted-foreground)]">
                It won't count toward their {MAX_CORRECTIONS_PER_MONTH}-a-month limit. Your name, the time and this reason are recorded.
              </p>
            ) : (
              <p className="text-[13px] text-[var(--color-muted-foreground)]">
                Exempted by {dialog.exemption.exemptedByName || "someone"} on {fmtStamp(dialog.exemption.exemptedAt)}: "{dialog.exemption.reason}". It will count toward their limit again; the exemption stays on record.
              </p>
            )}
            {dialog.correction.reason && (
              <p className="rounded-md border border-[var(--color-panel-border)] px-3 py-2 text-[13px]">
                <span className="font-semibold">Their reason:</span> {dialog.correction.reason}
              </p>
            )}
            <div>
              <label className="mb-1 block text-xs font-semibold">
                {dialog.kind === "exempt" ? "Why is this exempt?" : "Why remove it? (optional)"}
              </label>
              <textarea
                autoFocus
                rows={3}
                value={dialogReason}
                onChange={(e) => setDialogReason(e.target.value)}
                placeholder={dialog.kind === "exempt" ? "e.g. App outage on Oct 2 — no one at the branch could clock in" : ""}
                className="glass-input w-full rounded-md px-3 py-2 text-sm"
              />
            </div>
          </div>
        </AppModal>
      )}
    </div>
  );
}

function MonthTimecards({
  range,
  profileId,
  corrections,
  entries,
  loading,
  activeExemption,
  exemptionHistory,
  canExempt,
  onExempt,
  onRemove,
}: {
  range: string;
  profileId: string;
  corrections: TimecardCorrectionRow[];
  entries: CompanyTimecardEntry[] | undefined;
  loading: boolean;
  activeExemption: Map<string, CorrectionExemption>;
  exemptionHistory: Map<string, CorrectionExemption[]>;
  canExempt: boolean;
  onExempt: (c: TimecardCorrectionRow) => void;
  onRemove: (c: TimecardCorrectionRow, e: CorrectionExemption) => void;
}) {
  if (loading || !entries) return <p className="text-xs text-slate-400">Loading timecards…</p>;
  const mine = entries.filter((e) => e.profileId === profileId).sort((a, b) => a.workDate.localeCompare(b.workDate));
  const correctionByDay = new Map<string, TimecardCorrectionRow[]>();
  for (const c of corrections) {
    if (!correctionByDay.has(c.workDate)) correctionByDay.set(c.workDate, []);
    correctionByDay.get(c.workDate)!.push(c);
  }
  // Days with a correction but no punch row still belong in the list.
  const days = Array.from(new Set([...mine.map((e) => e.workDate), ...correctionByDay.keys()])).sort();
  const entryByDay = new Map(mine.map((e) => [e.workDate, e]));

  let workedMinutes = 0;
  let daysWorked = 0;
  for (const e of mine) {
    if (!e.checkIn) continue;
    daysWorked++;
    const shift = correctionShiftMinutes(e.checkIn, e.checkOut);
    const meal = correctionShiftMinutes(e.mealStart, e.mealEnd) ?? 0;
    if (shift !== null) workedMinutes += Math.max(0, shift - meal);
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-300">
        <span>
          <strong>{rangeLabel(range)}</strong>
        </span>
        <span>Days worked: <strong className="tabular-nums">{daysWorked}</strong></span>
        <span>Hours: <strong className="tabular-nums">{formatShift(workedMinutes)}</strong></span>
        <span>Corrections: <strong className="tabular-nums">{corrections.length}</strong></span>
        {corrections.some((c) => !countsTowardLimit(c, activeExemption)) && (
          <span>Counted: <strong className="tabular-nums">{corrections.filter((c) => countsTowardLimit(c, activeExemption)).length}</strong></span>
        )}
      </div>
      {days.length === 0 ? (
        <p className="text-xs text-slate-400">No timecards in this range.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-1.5 font-semibold">Date</th>
                <th className="px-2 py-1.5 font-semibold">Time In</th>
                <th className="px-2 py-1.5 font-semibold">Meal</th>
                <th className="px-2 py-1.5 font-semibold">Time Out</th>
                <th className="px-2 py-1.5 font-semibold">Hours</th>
                <th className="px-2 py-1.5 font-semibold">Correction</th>
                <th className="px-2 py-1.5 font-semibold">Reason</th>
                <th className="px-2 py-1.5 font-semibold">Exempt</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => {
                const e = entryByDay.get(day);
                const fixes = correctionByDay.get(day) ?? [];
                const shift = e ? correctionShiftMinutes(e.checkIn, e.checkOut) : null;
                const meal = e ? correctionShiftMinutes(e.mealStart, e.mealEnd) ?? 0 : 0;
                return (
                  <tr key={day} className={`border-t border-white/5 ${fixes.length ? "bg-amber-500/[0.05]" : ""}`}>
                    <td className="px-2 py-1.5 whitespace-nowrap">{fmtDay(day)}</td>
                    <td className="px-2 py-1.5 tabular-nums">{e ? to12h(e.checkIn) : "—"}</td>
                    <td className="px-2 py-1.5 tabular-nums">{e && e.mealStart ? `${to12h(e.mealStart)} – ${to12h(e.mealEnd)}` : "—"}</td>
                    <td className="px-2 py-1.5 tabular-nums">{e ? to12h(e.checkOut) : "—"}</td>
                    <td className="px-2 py-1.5 tabular-nums">{shift !== null ? formatShift(Math.max(0, shift - meal)) : "—"}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex flex-col items-start gap-1">
                        {fixes.map((c) => (
                          <span
                            key={c.id}
                            className={`whitespace-nowrap rounded border px-1.5 py-px text-[10px] font-semibold ${STATUS_STYLE[c.status] ?? ""} ${countsTowardLimit(c, activeExemption) ? "" : "opacity-50"}`}
                          >
                            <span className="capitalize">{c.status}</span>
                            {correctedTimes(c) ? ` · ${correctedTimes(c)}` : ""}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 min-w-[220px] max-w-[420px]">
                      <div className="flex flex-col gap-1">
                        {fixes.map((c) => {
                          const issue = issueLabel(c);
                          return (
                            <div key={c.id} className="leading-snug">
                              {issue && <span className="mr-1 font-semibold text-slate-200">{issue}{c.reason ? ":" : ""}</span>}
                              <span className="text-slate-300">{c.reason || (issue ? "" : "—")}</span>
                              {c.status === "rejected" && c.reviewNote && <div className="text-[10px] text-red-300/90">{c.reviewNote}</div>}
                            </div>
                          );
                        })}
                        {fixes.length === 0 && <span className="text-slate-500">—</span>}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 min-w-[220px] max-w-[360px]">
                      <div className="flex flex-col gap-1.5">
                        {fixes.map((c) => {
                          const active = activeExemption.get(c.id);
                          const removed = (exemptionHistory.get(c.id) ?? []).filter((x) => x.removedAt);
                          return (
                            <div key={c.id} className="space-y-0.5">
                              {active ? (
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="inline-flex items-center gap-1 rounded border border-sky-500/40 bg-sky-500/15 px-1.5 py-px text-[10px] font-semibold text-sky-300">
                                    <ShieldCheck className="h-3 w-3" /> Exempt
                                  </span>
                                  {canExempt && (
                                    <button type="button" onClick={() => onRemove(c, active)} className="btn btn-ghost btn-sm !h-6 !px-1.5 text-[11px]" title="Remove exemption">
                                      <Undo2 className="!h-3 !w-3" /> Undo
                                    </button>
                                  )}
                                </div>
                              ) : canExempt && c.status !== "rejected" ? (
                                <button type="button" onClick={() => onExempt(c)} className="btn btn-sm !h-6 !px-2 text-[11px]">
                                  <ShieldCheck className="!h-3 !w-3" /> Exempt
                                </button>
                              ) : (
                                <span className="text-slate-500">—</span>
                              )}
                              {active && (
                                <div className="text-[10px] leading-snug text-slate-400">
                                  "{active.reason}" — {active.exemptedByName || "Unknown"}, {fmtStamp(active.exemptedAt)}
                                </div>
                              )}
                              {removed.map((x) => (
                                <div key={x.id} className="text-[10px] leading-snug text-slate-500">
                                  Was exempt ("{x.reason}" — {x.exemptedByName || "Unknown"}, {fmtStamp(x.exemptedAt)}); removed by {x.removedByName || "Unknown"}, {fmtStamp(x.removedAt!)}
                                  {x.removedReason ? `: "${x.removedReason}"` : ""}
                                </div>
                              ))}
                            </div>
                          );
                        })}
                        {fixes.length === 0 && <span className="text-slate-500">—</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
