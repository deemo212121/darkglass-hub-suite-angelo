import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { X, Plus, Pencil, Check, Loader2, ExternalLink, ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getAttendanceForRange, saveEntry, getProfileIdByFirebaseUid, computeScheduledDutyHours, computeMealTimeCredit, startOfWeekSunday, splitRegularOvertimeWeekly, CSR_WEEKLY_OVERTIME_THRESHOLD, hoursDiff, MEAL_ALWAYS_PAID_DEFAULT_HOURS, type AttendanceRow } from "@/lib/supabase/timecards";
import { isMealAlwaysPaidRole, usesFlatWeeklyOvertimeThreshold, hasAnyTechnicianPayRole } from "@/lib/roleLabels";
import { getCompanyHolidaysInRange } from "@/lib/supabase/companyHolidays";
import { getPendingCorrectionsInRange, type TimecardCorrectionRow } from "@/lib/supabase/timecardCorrections";
import { PendingItemDetailModal, type PendingItem } from "@/components/PendingItemDetailModal";
import { getCompanyPtoRequests, isPaidPtoType, type PtoRequestRow, type PtoType } from "@/lib/supabase/pto";
import { getAttendanceNotes } from "@/lib/supabase/attendanceNotes";
import { HR_STATUS_TO_PTO_TYPE } from "@/components/HrCalendarTab";
import { getTicketAttendanceForTechnician, slotSortKey, type TicketAttendanceRow } from "@/lib/supabase/technicianWhereabouts";
import { getCompanyEmployeeRequests } from "@/lib/supabase/employeeRequests";
import { getVisitDiagnosisByTicketIds } from "@/lib/supabase/tickets";
import { getMileageEntries, setMileageEstimateTime, setMileageLegMileage, type MileageEntry } from "@/lib/supabase/mileage";
import { STATE_MIN_WAGE_2026, normalizeStateName, highestRateAmong, FEDERAL_MIN_WAGE } from "@/lib/stateMinWage";
import {
  getSalaryHistory,
  addSalaryEntry,
  deleteSalaryEntry,
  rateEffectiveOn,
  entryEffectiveOn,
  currentRate,
  perCutoffSalary,
  monthlySalary,
  type SalaryEntryRow,
  type SalaryChangeReason,
  type CompensationType,
} from "@/lib/supabase/salary";

interface Props {
  profileId: string;
  employeeName: string;
  department?: string;
  /** Used only to decide the flat-40-hrs/week overtime exception (usesFlatWeeklyOvertimeThreshold) — see dailyHoursSplitByDate below. */
  role?: string;
  extraRoles?: string[] | null;
  /** profiles.tier_level (migration 0162) — same field Master List's "Current Technicians" tab and Staff List's "Tier Level" tab edit. Shown in the Current Rate tile; "Unassigned" when blank. */
  tierLevel?: string | null;
  requiredCheckIn?: string;
  requiredCheckOut?: string;
  workingHours?: number | null;
  mealMinutes?: number | null;
  offDays?: number[];
  /** Pre-computed by the caller via payGraceMinutesFor(country) — see attendanceGrace.ts. Defaults to 0 (no forgiveness) so existing callers aren't required to pass it. */
  graceMinutes?: number;
  /** The payroll period selected on the caller's own page (e.g. genStart/
   *  genEnd on AccountingDashboard, startDate/endDate on
   *  PayrollCalculationPage) — this modal opens scoped to THAT period by
   *  default, not the current calendar month, so what you see here always
   *  matches the period you were just looking at. Falls back to the current
   *  calendar month if omitted. Still freely adjustable via the Start/End
   *  date pickers once open. */
  initialStart?: string;
  initialEnd?: string;
  onClose: () => void;
  /** Called after a rate change is saved, so the caller can refresh its own aggregate payroll view. */
  onRateChanged?: () => void;
  /** When set (Office Payroll's per-technician review wizard), a "Next →" button appears in the footer — advances to the Tech Activity Report. Omitted for office employees and other callers. Called with which toggle was active ("company"/"state") and this modal's own State-matched Hourly + OT total (payViewTotals.compliant.total) — the caller persists that choice as this technician's actual Hourly + OT pay for the period (see payroll_hourly_ot_overrides), since this modal is the only place that computes the state-floor comparison. May return a Promise; the Next button disables (see nextBusy) until it resolves. */
  onNext?: (mode: "company" | "state", stateHourlyOtTotal: number) => void | Promise<void>;
  /** True while the caller's onNext is still saving — disables the Next button so a second click can't race the first (e.g. double-submitting the pay-mode override). */
  nextBusy?: boolean;
  /** Office-side counterpart to onNext — an office employee has no Tech Activity Report step to advance to, so this marks them reviewed directly from here instead (same payroll_review_marks row TechActivityReportModal's own onDone writes). Only rendered when onNext is unset, so a technician never sees both. */
  onDone?: () => void | Promise<void>;
  /** True while the caller's onDone is still saving — disables the Done button so a second click can't race the first. */
  doneBusy?: boolean;
  /**
   * The actual genStart/genEnd the caller's onDone will stamp the review
   * mark under — NOT necessarily the same as this modal's own rangeStart/
   * rangeEnd above (that pair is just this modal's own attendance-history
   * view window, freely adjustable here without affecting the outer page's
   * selected payroll period). Shown next to the Mark Reviewed button so
   * it's never ambiguous which range is actually about to get stamped.
   */
  reviewPeriodStart?: string;
  reviewPeriodEnd?: string;
  /** Sets the page's own Period (genStart/genEnd) to match whatever this modal's own rangeStart/rangeEnd currently show — an explicit, one-click fix so a wrong page period can be corrected without leaving this modal, without silently auto-syncing on every keystroke (which would shift the payroll period for every OTHER employee on the page too, not just the one being viewed here). */
  onSyncReviewPeriod?: (start: string, end: string) => void;
}

function addDaysISO(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function currentMonthBounds(): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

// Fallback only, when an employee has no configured schedule to derive
// duty hours from (see dailyHoursSplitByDate below, and
// AccountingDashboard.tsx's computeHoursMap, which this table's per-day
// breakdown is kept in sync with) — otherwise regular vs. overtime is split
// at the PERIOD level against total duty hours, not a flat per-day cap.
const REGULAR_HOURS_PER_DAY = 8;
const OVERTIME_MULTIPLIER = 1.5;

/** "2026-08-30" -> "8/30" — short date for the Weekly Breakdown labels below. */
function fmtShortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${m}/${d}`;
}

/** 7.192 -> "7.1920" — decimal format for displayed hour quantities (Regular/Meal/Overtime/Total Hours, Weekly Breakdown). Used to be a rounded-to-the-minute "H:MM" clock format, which silently threw away real seconds-level precision that the underlying math (used by payment calculations everywhere) already carries — 4 decimal places keeps that precision visible (0.0001hr ≈ 0.36s, well under a full second). */
function fmtDecimal(hours: number): string {
  return hours.toFixed(4);
}

/**
 * Week-over-week hours change for the Weekly Breakdown section — "25.5% less
 * than the previous week" / "57.3% more than the previous week". Null for
 * the first displayed week (no prior week to compare against) or when two
 * consecutive weeks are within rounding of equal.
 */
function fmtWeekOverWeekChange(current: number, previous: number): { text: string; direction: "more" | "less" | "flat" } | null {
  if (previous <= 0) return current > 0 ? { text: "up from 0 hours the previous week", direction: "more" } : null;
  const pct = ((current - previous) / previous) * 100;
  if (Math.abs(pct) < 0.05) return { text: "no change from the previous week", direction: "flat" };
  return { text: `${Math.abs(pct).toFixed(1)}% ${pct > 0 ? "more" : "less"} than the previous week`, direction: pct > 0 ? "more" : "less" };
}

const SALARY_REASON_LABELS: Record<SalaryChangeReason, string> = {
  promotion: "Promotion",
  adjustment: "Adjustment",
  demotion: "Demotion",
  initial: "Initial",
  training_rate: "Training Rate",
};
const STATUS_LABEL: Record<AttendanceRow["status"], string> = {
  present: "Present",
  absent: "Absent",
  "missing-in": "Missing Clock In",
  "missing-out": "Missing Clock Out",
  "missing-meal": "Paid Meal Included",
  "day-off": "Rest Day",
  holiday: "Holiday",
  "pending-correction": "Pending Time Correction Request",
  "paid-leave": "Paid Leave",
  "unpaid-leave": "Unpaid Leave",
};
const STATUS_COLOR: Record<AttendanceRow["status"], string> = {
  present: "text-green-300",
  absent: "text-red-300",
  "missing-in": "text-yellow-300",
  "missing-out": "text-yellow-300",
  "missing-meal": "text-sky-300",
  "day-off": "text-slate-400",
  holiday: "text-purple-300",
  "pending-correction": "text-amber-300",
  "paid-leave": "text-sky-300",
  "unpaid-leave": "text-orange-300",
};
const PTO_TYPE_LABEL: Record<string, string> = {
  vacation: "Vacation Leave",
  sick: "Sick Leave",
  personal: "Personal Leave",
  holiday: "Holiday Leave",
  bereavement: "Bereavement Leave",
  unpaid: "Unpaid Leave",
};
/** "Vacation Leave" etc. when the specific PTO type is known, else the generic STATUS_LABEL fallback ("Paid Leave"/"Unpaid Leave"). */
function statusLabelFor(row: AttendanceRow): string {
  if ((row.status === "paid-leave" || row.status === "unpaid-leave") && row.leaveType) {
    return PTO_TYPE_LABEL[row.leaveType] ?? STATUS_LABEL[row.status];
  }
  return STATUS_LABEL[row.status];
}

export function EmployeePayrollDetailModal({
  profileId,
  employeeName,
  department,
  role,
  extraRoles,
  tierLevel,
  requiredCheckIn,
  requiredCheckOut,
  workingHours,
  mealMinutes,
  offDays,
  graceMinutes = 0,
  initialStart,
  initialEnd,
  onClose,
  onRateChanged,
  onNext,
  nextBusy,
  onDone,
  doneBusy,
  reviewPeriodStart,
  reviewPeriodEnd,
  onSyncReviewPeriod,
}: Props) {
  // Named myRole/myExtraRoles (not role/extraRoles) — those names are
  // already taken by this component's own props above, which describe the
  // EMPLOYEE BEING VIEWED (used for the CSR overtime check below), not the
  // currently logged-in viewer these describe.
  const { uid, displayName, email, role: myRole, extraRoles: myExtraRoles } = useAuth();
  const actorName = displayName || email || "Unknown";
  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const fallbackMonth = currentMonthBounds();
  const [rangeStart, setRangeStart] = useState(initialStart || fallbackMonth.start);
  const [rangeEnd, setRangeEnd] = useState(initialEnd || fallbackMonth.end);
  const [loading, setLoading] = useState(true);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  // Only the partial calendar week BEFORE rangeStart (empty when rangeStart
  // is already a Sunday) — kept separate from `attendance` so nothing else
  // here (the displayed table, totalHours, warnings) sees a widened range;
  // it exists solely to seed the weekly overtime carry-over below for a
  // sub-range that happens to start mid-week. See splitRegularOvertimeWeekly.
  const [seedAttendance, setSeedAttendance] = useState<AttendanceRow[]>([]);
  // Full pending-correction rows for THIS employee, keyed by date — kept
  // around (not just the plain date strings AttendanceRow.status needs) so
  // clicking a "Pending Time Correction Request" status can show the actual
  // request detail + approve/reject inline, same popup Absent List uses.
  const [pendingCorrectionByDate, setPendingCorrectionByDate] = useState<Map<string, TimecardCorrectionRow>>(new Map());
  const [pendingDetailModal, setPendingDetailModal] = useState<{ date: string; item: PendingItem } | null>(null);
  const [history, setHistory] = useState<SalaryEntryRow[]>([]);
  const [ticketRows, setTicketRows] = useState<TicketAttendanceRow[]>([]);
  const [diagnoses, setDiagnoses] = useState<Map<string, string>>(new Map());
  const [mileageEntries, setMileageEntries] = useState<MileageEntry[]>([]);
  // Every PTO request company-wide (loaded once, filtered to this profile
  // below) — same "load once, filter locally" convention as the two fetches
  // above. Feeds paidLeaveDates: an approved, PAID (isPaidPtoType — Sick is
  // always unpaid) day with no punch reads as "paid-leave" (scheduled net
  // hours, at the normal rate) instead of "absent", matching the same
  // crediting rule AccountingDashboard.tsx's computeHoursMap already applies
  // to the real payroll total.
  const [ptoRequests, setPtoRequests] = useState<PtoRequestRow[]>([]);
  // Which Attendance row's date is expanded to show that day's tickets —
  // same expand-on-click pattern Ticket Attendance itself uses, just scoped
  // to one date's tickets instead of a whole technician's range.
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  // Approved Ticket Time Disputes don't count as missing here — same rule
  // Ticket Attendance itself uses. Loaded once (doesn't depend on the date
  // range), not per-load.
  const [disputedTicketNosApproved, setDisputedTicketNosApproved] = useState<Set<string>>(new Set());
  const [showRateForm, setShowRateForm] = useState(false);
  const [rateForm, setRateForm] = useState({
    effectiveDate: new Date().toISOString().slice(0, 10),
    compensationType: "hourly" as CompensationType,
    hourlyRate: "",
    annualSalary: "",
    reason: "adjustment" as SalaryChangeReason,
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [deletingRateId, setDeletingRateId] = useState<string | null>(null);
  // Per-day rate overrides pending save, keyed by date ("YYYY-MM-DD") — the
  // input's raw string value while the user is editing it.
  const [rateEdits, setRateEdits] = useState<Record<string, string>>({});
  const [savingRates, setSavingRates] = useState(false);
  // Manual time correction — one centralized "Edit" toggle for the whole
  // Attendance table: every row's Check In/Meal In/Meal Out/Check Out
  // becomes editable at once, keyed by date, saved together on "Done".
  const [attendanceEditing, setAttendanceEditing] = useState(false);
  const [attendanceEdits, setAttendanceEdits] = useState<Record<string, { checkIn: string; mealStart: string; mealEnd: string; checkOut: string }>>({});
  const [savingAttendanceEdits, setSavingAttendanceEdits] = useState(false);
  // Per-day State assignment — independent per day (technicians hop between
  // states job to job), saved immediately on change rather than staged
  // behind a "Done"/"Save" button like Rate or the punch edits above.
  const [stateEdits, setStateEdits] = useState<Record<string, string>>({});
  const [savingStateFor, setSavingStateFor] = useState<string | null>(null);
  // Calculated = company rate as-is. Compliant = the higher of company rate
  // vs. that day's assigned state's minimum wage — not an equally-valid
  // alternative view, but the legally required number whenever a day's
  // state floor exceeds the company rate. Defaults to Compliant since that's
  // the number that's actually safe to pay.
  const [payView, setPayView] = useState<"calculated" | "compliant">("compliant");

  useEffect(() => {
    if (!uid) return;
    getProfileIdByFirebaseUid(uid).then(setMyProfileId).catch(() => {});
  }, [uid]);

  useEffect(() => {
    getCompanyEmployeeRequests()
      .then((requests) =>
        setDisputedTicketNosApproved(
          new Set(
            requests
              .filter((r) => r.requestType === "ticket_time_dispute" && r.status === "approved" && r.ticketNo)
              .map((r) => r.ticketNo!)
          )
        )
      )
      .catch((err) => console.error("Failed to load ticket time disputes for payroll detail:", err));
    getMileageEntries()
      .then(setMileageEntries)
      .catch((err) => console.error("Failed to load mileage entries for payroll detail:", err));
    getCompanyPtoRequests()
      .then(setPtoRequests)
      .catch((err) => console.error("Failed to load PTO requests for payroll detail:", err));
  }, []);

  // This profile's approved, PAID pto days from FORMAL pto_requests, expanded
  // to individual dates (skipping their own off days) — same expansion
  // AccountingDashboard.tsx's computeHoursMap already does for the real
  // payroll total. Not clipped to rangeStart/rangeEnd since it's threaded
  // into both the main and seed-week getAttendanceForRange calls below, each
  // of which only reads the keys inside its own iterated window anyway.
  //
  // This is NOT the only way leave gets recorded — HR can also set a day's
  // status directly on the Absent List ("HR Status" dropdown, no formal
  // request at all), which writes into attendance_notes.hr_note instead of
  // this table entirely (see HrCalendarTab.tsx's hrPlottedByProfile — the
  // Time Off Calendar's teal "Set by HR (Absent List), no formal request"
  // cells). `load()` below fetches that second source and merges it in
  // (formal request wins if both somehow exist for the same date), so a day
  // marked either way shows correctly here instead of only the formally
  // requested-and-approved half of them.
  const formalPaidLeaveDates = useMemo(() => {
    const map = new Map<string, PtoType>();
    const offDaySet = new Set(offDays ?? []);
    for (const pto of ptoRequests) {
      if (pto.profileId !== profileId || pto.status !== "approved" || !isPaidPtoType(pto.ptoType)) continue;
      for (let d = new Date(`${pto.startDate}T00:00:00`); d <= new Date(`${pto.endDate}T00:00:00`); d.setDate(d.getDate() + 1)) {
        if (offDaySet.has(d.getDay())) continue;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        map.set(key, pto.ptoType);
      }
    }
    return map;
  }, [ptoRequests, profileId, offDays]);

  // Same expansion, but for approved UNPAID (or Sick) requests — kept
  // separate from formalPaidLeaveDates so it can WIN over any paid claim on
  // the same date (a stale approved Vacation request that was never
  // cancelled after an Unpaid one got approved instead, or an HR-plotted
  // note left over from before the formal request existed). See the
  // paidLeaveDates/unpaidLeaveDates merge in load() below.
  const formalUnpaidLeaveDates = useMemo(() => {
    const map = new Map<string, PtoType>();
    const offDaySet = new Set(offDays ?? []);
    for (const pto of ptoRequests) {
      if (pto.profileId !== profileId || pto.status !== "approved" || isPaidPtoType(pto.ptoType)) continue;
      for (let d = new Date(`${pto.startDate}T00:00:00`); d <= new Date(`${pto.endDate}T00:00:00`); d.setDate(d.getDate() + 1)) {
        if (offDaySet.has(d.getDay())) continue;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        map.set(key, pto.ptoType);
      }
    }
    return map;
  }, [ptoRequests, profileId, offDays]);

  const load = async (cancelledRef: { current: boolean }) => {
    setLoading(true);
    setRateEdits({});
    try {
      const seedStart = startOfWeekSunday(rangeStart);
      const seedEnd = addDaysISO(rangeStart, -1);
      const needsSeed = seedStart <= seedEnd;
      const notesStart = needsSeed ? seedStart : rangeStart;
      const [holidays, pendingCorrections, hist, myTicketRows, hrStatusNotes] = await Promise.all([
        getCompanyHolidaysInRange(rangeStart, rangeEnd).catch(() => []),
        getPendingCorrectionsInRange(rangeStart, rangeEnd).catch(() => []),
        getSalaryHistory(profileId),
        getTicketAttendanceForTechnician(employeeName, rangeStart, rangeEnd),
        getAttendanceNotes(notesStart, rangeEnd).catch(() => []),
      ]);
      // Merge in HR-plotted leave (attendance_notes.hr_note, no formal
      // pto_requests row) — a formal request wins if one somehow also
      // covers the same date, same precedence HrCalendarTab.tsx uses. An
      // UNPAID formal request wins over EVERYTHING for its date (a stale
      // approved Vacation request that was never cancelled, or a leftover
      // HR note) — it's deleted out of paidLeaveDates below rather than
      // just never being added, since either of those other two sources
      // could otherwise still be sitting in that map from before the
      // formal Unpaid request existed.
      const paidLeaveDates = new Map<string, PtoType>();
      const unpaidLeaveDates = new Map<string, PtoType>();
      for (const n of hrStatusNotes) {
        if (n.profileId !== profileId) continue;
        const type = HR_STATUS_TO_PTO_TYPE[n.hrNote];
        if (!type) continue;
        (isPaidPtoType(type) ? paidLeaveDates : unpaidLeaveDates).set(n.noteDate, type);
      }
      for (const [date, type] of formalPaidLeaveDates) paidLeaveDates.set(date, type);
      for (const [date, type] of formalUnpaidLeaveDates) {
        unpaidLeaveDates.set(date, type);
        paidLeaveDates.delete(date);
      }
      const seedRows = needsSeed
        ? await getAttendanceForRange(profileId, seedStart, seedEnd, { requiredCheckIn, requiredCheckOut, workingHours, mealMinutes, daysOff: offDays, graceMinutes, paidLeaveDates, unpaidLeaveDates })
        : [];
      const attRows = await getAttendanceForRange(profileId, rangeStart, rangeEnd, {
        requiredCheckIn,
        requiredCheckOut,
        workingHours,
        mealMinutes,
        daysOff: offDays,
        graceMinutes,
        holidayDates: holidays.map((h) => h.date),
        pendingCorrectionDates: pendingCorrections.filter((c) => c.profileId === profileId).map((c) => c.workDate),
        paidLeaveDates,
        unpaidLeaveDates,
      });
      if (cancelledRef.current) return;
      setAttendance(attRows);
      setSeedAttendance(seedRows);
      setPendingCorrectionByDate(new Map(pendingCorrections.filter((c) => c.profileId === profileId).map((c) => [c.workDate, c])));
      setHistory(hist);
      setTicketRows(myTicketRows);
      // Not needed to render the rows themselves — fetched separately so a
      // slow/failed lookup never blocks the times that are already back.
      getVisitDiagnosisByTicketIds(myTicketRows.map((r) => r.ticketId))
        .then(setDiagnoses)
        .catch((err) => console.error("Failed to load ticket diagnoses for payroll detail:", err));
    } catch (err) {
      console.error("Failed to load employee payroll detail:", err);
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    const cancelledRef = { current: false };
    load(cancelledRef);
    return () => { cancelledRef.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, rangeStart, rangeEnd, formalPaidLeaveDates]);

  // Technicians/Branch-Managers/Tech Managers/Technical Directors aren't
  // required to punch Meal In/Out, but their meal break is still paid — see
  // timecards.ts's computeMealTimeCredit. Merged directly into the raw hours
  // fed into dailyHoursSplitByDate below (before the weekly regular/overtime
  // split runs), so it naturally lands as Regular or Overtime with no
  // separate "Meal" bucket in the totals. Kept as its own per-date map too,
  // purely so the table can still show where that 30 minutes came from.
  const mealAlwaysPaid = isMealAlwaysPaidRole(role, extraRoles);
  // Covers seedAttendance too (the partial week before rangeStart, used only
  // for the weekly carry-over below) so a seed day's meal credit correctly
  // counts toward that week's already-used regular quota — not just the
  // displayed days. Eligibility (shift over 6 hours) is judged per day by
  // computeMealTimeCredit itself from that day's own Check In/Out, not a
  // single schedule-wide flag — a short day never gets credited or flagged
  // just because this employee's typical shift runs longer.
  const mealCreditByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of [...seedAttendance, ...attendance]) {
      if (row.status === "paid-leave" || row.status === "day-off" || row.status === "holiday" || !row.hoursWorked) continue;
      const credit = computeMealTimeCredit({ checkIn: row.clockIn, checkOut: row.clockOut, mealStart: row.mealStart, mealEnd: row.mealEnd }, mealAlwaysPaid);
      if (credit > 0) m.set(row.date, credit);
    }
    return m;
  }, [attendance, seedAttendance, mealAlwaysPaid]);
  const totalHours = useMemo(
    () => attendance.reduce((s, r) => s + r.hoursWorked + (mealCreditByDate.get(r.date) ?? 0), 0),
    [attendance, mealCreditByDate]
  );
  // One non-deleted mileage entry per ticket # — same convention Ticket
  // Attendance uses (mileage.ts).
  const mileageByTicketNo = useMemo(() => {
    const map = new Map<string, MileageEntry>();
    for (const e of mileageEntries) {
      if (e.deletedAt || !e.ticketNo || map.has(e.ticketNo)) continue;
      map.set(e.ticketNo, e);
    }
    return map;
  }, [mileageEntries]);
  // Per-day ticket stats — two independent breakdowns of the same day's
  // scheduled tickets: completion + mileage (how many of the day's tickets
  // got both an Arrived and a Done on-site stamp, and the mileage rolled up
  // from just those — DID NOT GO / never-arrived tickets contribute no
  // mileage; Total Mileage is always a pure sum of the per-ticket leg
  // mileage in the expanded breakdown PLUS the day's own drive-home leg
  // (mileage.ts migration 0237 — kept off any one ticket's own legMileage
  // so it never reads as that ticket's drive), never its own editable
  // field), and On-Site Check-In compliance (same Checked In/Missing
  // Check-In/Missing Check-Out definitions Ticket Attendance uses in
  // technicianWhereabouts.ts, just grouped by day instead of summed over
  // the whole range).
  const ticketStatsByDate = useMemo(() => {
    const byDate = new Map<string, TicketAttendanceRow[]>();
    for (const r of ticketRows) {
      if (!byDate.has(r.scheduleDate)) byDate.set(r.scheduleDate, []);
      byDate.get(r.scheduleDate)!.push(r);
    }
    const map = new Map<
      string,
      { scheduled: number; completed: number; totalMileage: number; checkedIn: number; missingCheckIn: number; missingCheckOut: number }
    >();
    for (const [date, dayRows] of byDate) {
      const completedRows = dayRows.filter((r) => r.arrivedAt && r.doneAt);
      map.set(date, {
        scheduled: dayRows.length,
        completed: completedRows.length,
        totalMileage: completedRows.reduce((s, r) => {
          const entry = mileageByTicketNo.get(r.ticketNo);
          return s + (entry?.legMileage ?? 0) + (entry?.homeLegMileage ?? 0);
        }, 0),
        checkedIn: dayRows.filter((r) => r.arrivedAt).length,
        missingCheckIn: dayRows.filter((r) => !r.arrivedAt && r.statusGroup !== "cancelled" && !disputedTicketNosApproved.has(r.ticketNo)).length,
        missingCheckOut: dayRows.filter((r) => r.arrivedAt && !r.doneAt && r.statusGroup !== "cancelled" && !disputedTicketNosApproved.has(r.ticketNo)).length,
      });
    }
    return map;
  }, [ticketRows, mileageByTicketNo, disputedTicketNosApproved]);
  // Full ticket rows per date, for the expanded per-day ticket table —
  // same grouping as ticketStatsByDate above, just keeping the rows instead
  // of collapsing them to counts. Within a day the rows are ordered by the
  // technician's actual route: earliest on-site Arrived stamp first, so the
  // "#" column reads as the real visit sequence. Stops with no Arrived
  // stamp (Missing / DID NOT GO / cancelled) sort to the bottom, keeping
  // their scheduled time-slot order.
  const ticketRowsByDate = useMemo(() => {
    const map = new Map<string, TicketAttendanceRow[]>();
    for (const r of ticketRows) {
      if (!map.has(r.scheduleDate)) map.set(r.scheduleDate, []);
      map.get(r.scheduleDate)!.push(r);
    }
    for (const dayRows of map.values()) {
      dayRows.sort((a, b) => {
        const aT = a.arrivedAt ? new Date(a.arrivedAt).getTime() : Infinity;
        const bT = b.arrivedAt ? new Date(b.arrivedAt).getTime() : Infinity;
        if (aT !== bT) return aT - bT;
        return slotSortKey(a.timeSlot).localeCompare(slotSortKey(b.timeSlot));
      });
    }
    return map;
  }, [ticketRows]);

  // Distinct state(s) actually worked that day, from the customer address of
  // whichever tickets the technician actually checked into (arrivedAt set —
  // a merely scheduled-but-not-visited ticket doesn't say where they really
  // were). When a day spans more than one state, `bestState` is whichever of
  // them has the higher minimum wage — not the most precise answer (that
  // would split pay by which hours landed in which state), but a
  // conservative one: a technician never gets floored to the lower of two
  // states just because that's where they happened to check in first. States
  // with no fixed rate (county-based, e.g. NY/Oregon) are skipped when
  // picking `bestState` since they can't be compared numerically; the
  // "Multi-State" badge below still lists them so a human can review.
  const ticketStateByDate = useMemo(() => {
    const map = new Map<string, { bestState: string | null; states: string[] }>();
    for (const [date, rows] of ticketRowsByDate) {
      const states = Array.from(
        new Set(
          rows
            .filter((r) => r.arrivedAt)
            .map((r) => normalizeStateName(r.state))
            .filter((s): s is string => s != null)
        )
      );
      map.set(date, { bestState: highestRateAmong(states), states });
    }
    return map;
  }, [ticketRowsByDate]);

  // Auto-fills a blank day's State from its tickets — the single state when
  // unambiguous, or the higher-rate one when the day spans more than one
  // (see ticketStateByDate's bestState above). A manual value, once saved —
  // whether by this effect or by hand — is never overwritten again; it
  // becomes authoritative for that day. Self-terminating: once a day's
  // `state` is persisted, `load()`'s next attendance refetch makes that row
  // no longer blank, so this stops touching it.
  const autoFillingStateDates = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (loading) return;
    const toFill = attendance.filter(
      (row) => !row.state && !autoFillingStateDates.current.has(row.date) && ticketStateByDate.get(row.date)?.bestState != null
    );
    if (toFill.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const row of toFill) autoFillingStateDates.current.add(row.date);
      try {
        for (const row of toFill) {
          const derived = ticketStateByDate.get(row.date)!.bestState!;
          await saveEntry(profileId, row.date, {
            checkIn: row.clockIn,
            checkOut: row.clockOut,
            mealStart: row.mealStart,
            mealEnd: row.mealEnd,
            notes: "",
            state: derived,
          });
        }
        if (!cancelled) await load({ current: false });
      } catch (err) {
        console.error("Auto-fill state from tickets failed:", err instanceof Error ? err.message : err);
        for (const row of toFill) autoFillingStateDates.current.delete(row.date);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attendance, ticketStateByDate, loading, profileId]);

  // Estimate Time column — inline pencil-icon edit, same pattern Ticket
  // Attendance itself uses (one free-text field on mileage_entries, no
  // formula/source).
  const [editingEstimateTimeId, setEditingEstimateTimeId] = useState<string | null>(null);
  const [estimateTimeDraft, setEstimateTimeDraft] = useState("");
  const [savingEstimateTimeId, setSavingEstimateTimeId] = useState<string | null>(null);
  const handleSaveEstimateTime = async (entry: MileageEntry) => {
    const value = estimateTimeDraft;
    setSavingEstimateTimeId(entry.id);
    try {
      await setMileageEstimateTime(entry.id, value);
      setMileageEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, estimateTime: value.trim() || null } : e)));
      setEditingEstimateTimeId(null);
    } catch (err) {
      alert(`Failed to save Estimate Time: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingEstimateTimeId(null);
    }
  };

  // Per-ticket Mileage — same inline pencil-edit pattern. Overrides that
  // ticket's leg_mileage; the day's "Total Mileage" column re-sums live.
  const [editingLegMileageId, setEditingLegMileageId] = useState<string | null>(null);
  const [legMileageDraft, setLegMileageDraft] = useState("");
  const [savingLegMileageId, setSavingLegMileageId] = useState<string | null>(null);
  const handleSaveLegMileage = async (entry: MileageEntry) => {
    const trimmed = legMileageDraft.trim();
    const value = trimmed === "" ? null : Number(trimmed);
    if (value != null && !Number.isFinite(value)) {
      alert("Enter a number, or leave blank to reset.");
      return;
    }
    setSavingLegMileageId(entry.id);
    try {
      await setMileageLegMileage(entry.id, value);
      const rounded = value == null ? null : Math.round(value * 10) / 10;
      setMileageEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, legMileage: rounded } : e)));
      setEditingLegMileageId(null);
    } catch (err) {
      alert(`Failed to save Mileage: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingLegMileageId(null);
    }
  };
  const warnings = useMemo(() => attendance.filter((r) => r.status !== "present" && r.status !== "day-off" && r.status !== "paid-leave"), [attendance]);
  // Worked days with no state assigned — the Min Wage Floor Check falls back
  // to the flat company rate for these (see TechActivityReportModal.tsx's
  // stateMinFloor), which understates the true floor whenever the real
  // state (most likely wherever this technician normally works) has a
  // higher minimum wage. Flagged here so Accounting can fill it in rather
  // than the gap going unnoticed — see John Boyette's Little Rock/Arkansas
  // case, where two blank days sat at $7.25 despite every other day that
  // period being Arkansas ($11).
  const unassignedStateDays = useMemo(() => attendance.filter((r) => r.clockIn && !r.state), [attendance]);
  // The entry effective as of the end of the viewed period — used to decide
  // whether this employee is currently paid hourly or a fixed salary, and
  // to show the right numbers for whichever it is.
  const currentEntry = useMemo(() => entryEffectiveOn(history, rangeEnd), [history, rangeEnd]);
  const isCurrentlyFixed = currentEntry?.compensationType === "fixed";

  // Regular vs overtime per day, reset every calendar week (Sunday-Saturday)
  // and capped at THAT week's own scheduled/duty hours
  // (splitRegularOvertimeWeekly) — same weekly rule AccountingDashboard.tsx's
  // computeHoursMap uses for the real payroll totals, not each day capped at
  // 8 hours independently, and not one flat cap pooled across the whole
  // viewed range either. seedAttendance supplies the partial week before
  // rangeStart (if any) purely so this week's carry-over is seeded correctly
  // even when the Start/End pickers are narrowed to a sub-range that starts
  // mid-week — e.g. Thu-Sat after the week's regular quota was already used
  // up Sun-Wed shows 0 new regular for those days, all overtime. Falls back
  // to the flat per-day 8-hour cap only when there's no configured schedule
  // to derive duty hours from.
  // CSR shift start/end times vary person to person and aren't reliably
  // captured in requiredCheckIn/requiredCheckOut, so the scheduled-duty-
  // hours cap doesn't apply cleanly to them — they use a flat 40 hrs/week
  // (standard FLSA overtime) instead. Technician-tier roles use the same
  // flat 40-hr rule too (see roleLabels.ts's usesFlatWeeklyOvertimeThreshold)
  // — their schedule-derived duty cap counts every non-off day toward the
  // weekly budget regardless of attendance, so an absence earlier in the
  // week can shrink the regular-hours room left for the days they DID work
  // and trigger "overtime" well under a real 40-hour week. Same rule as
  // AccountingDashboard.tsx's computeHoursMap and PayrollCalculationPage.tsx.
  const usesFlatWeeklyThreshold = usesFlatWeeklyOvertimeThreshold(role, extraRoles);
  const dailyHoursSplitByDate = useMemo(() => {
    const dutyHours = usesFlatWeeklyThreshold
      ? CSR_WEEKLY_OVERTIME_THRESHOLD
      : computeScheduledDutyHours(requiredCheckIn || "", requiredCheckOut || "", workingHours, mealMinutes, offDays, rangeStart, rangeEnd);
    // Paid-leave days (see AttendanceRow.status) are excluded from the
    // weekly-cap split below and credited back in afterward as flat REGULAR
    // hours instead — same as AccountingDashboard.tsx's computeHoursMap,
    // which adds a pto day's scheduled net hours straight into `regular`
    // unconditionally, never through the weekly overtime cap real punches
    // go through. Running a paid day off through that cap would be wrong
    // two ways: it could get capped away in an already-full week, or push
    // real hours elsewhere in the week into overtime it never actually
    // caused.
    const isPaidLeave = (row: AttendanceRow) => row.status === "paid-leave";
    // Paid meal credit (mealCreditByDate) is added straight into the raw
    // hours here, BEFORE the regular/overtime weekly split — treated exactly
    // like real worked time. It fills whatever room is left in the week's
    // regular quota and only spills into overtime once that quota (real
    // hours + credit, combined) is actually used up — no separate "meal"
    // bucket; the result is just regular/overtime like everywhere else.
    const rawHoursFor = (row: AttendanceRow) => row.hoursWorked + (mealCreditByDate.get(row.date) ?? 0);
    const map = (() => {
      if (dutyHours <= 0) {
        const m = new Map<string, { regular: number; overtime: number }>();
        for (const row of attendance) {
          if (isPaidLeave(row)) continue;
          const hours = rawHoursFor(row);
          m.set(row.date, { regular: Math.min(hours, REGULAR_HOURS_PER_DAY), overtime: Math.max(0, hours - REGULAR_HOURS_PER_DAY) });
        }
        return m;
      }
      const days = [...seedAttendance, ...attendance].filter((row) => !isPaidLeave(row)).map((row) => ({ date: row.date, rawHours: rawHoursFor(row) }));
      return splitRegularOvertimeWeekly(days, { requiredCheckIn, requiredCheckOut, workingHours, mealMinutes, offDays }, 8, usesFlatWeeklyThreshold ? CSR_WEEKLY_OVERTIME_THRESHOLD : undefined);
    })();
    for (const row of attendance) {
      if (!isPaidLeave(row) || !row.hoursWorked) continue;
      const prev = map.get(row.date) ?? { regular: 0, overtime: 0 };
      map.set(row.date, { regular: prev.regular + row.hoursWorked, overtime: prev.overtime });
    }
    return map;
  }, [attendance, seedAttendance, requiredCheckIn, requiredCheckOut, workingHours, mealMinutes, offDays, rangeStart, rangeEnd, usesFlatWeeklyThreshold, mealCreditByDate]);

  // Fixed-salary pay doesn't depend on hours worked at all (see migration
  // 0118) — shows the monthly amount for this calendar-month estimate.
  // Hourly pay is still each day's hours at whichever rate was effective ON
  // that day, so a mid-month raise/promotion is handled automatically
  // instead of needing one flat rate for the whole period. Same per-day
  // figures as the Attendance table's own Payment column below (both read
  // dailyHoursSplitByDate) — kept in sync so this tile's total always matches
  // summing that column by hand. Paid meal credit is merged into `regular`/
  // `overtime` before the split runs, so it's already paid at whichever rate
  // that day's hours land in — no separate meal pay term needed here.
  // Per-day Calculated (company rate as-is) vs. Compliant (state-floor-
  // matched) pay. The state's minimum wage is a legal floor, not a second
  // equally-valid number: whenever THIS DAY's own assigned state's minimum
  // wage exceeds the company rate, the OT premium also has to ride on that
  // higher rate, not just the straight-time hours. Deliberately kept
  // per-day, not blended across the week — a higher-paying state one day
  // shouldn't float the whole week's OT; a technician who hit California on
  // the 27th and Georgia on the 29th gets each day matched against its own
  // state, not the week's single "winning" one. Skips fixed-salary days
  // (rateEffectiveOn returns 0 for those — no per-day hourly rate to compare
  // against a floor; fixed salary is handled as its own flat branch in
  // payViewTotals below).
  const dailyPayByDate = useMemo(() => {
    const map = new Map<string, { companyRate: number; effectiveRate: number; isMatched: boolean; calculatedPay: number; compliantPay: number }>();
    for (const row of attendance) {
      const companyRate = rateEffectiveOn(history, row.date);
      const folded = dailyHoursSplitByDate.get(row.date) ?? { regular: 0, overtime: 0 };
      if (companyRate <= 0) {
        map.set(row.date, { companyRate: 0, effectiveRate: 0, isMatched: false, calculatedPay: 0, compliantPay: 0 });
        continue;
      }
      const stateFloor = row.state ? STATE_MIN_WAGE_2026.find((s) => s.state === row.state)?.rate ?? null : null;
      const isMatched = stateFloor != null && stateFloor > companyRate;
      const effectiveRate = isMatched ? (stateFloor as number) : companyRate;
      map.set(row.date, {
        companyRate,
        effectiveRate,
        isMatched,
        calculatedPay: folded.regular * companyRate + folded.overtime * companyRate * OVERTIME_MULTIPLIER,
        compliantPay: folded.regular * effectiveRate + folded.overtime * effectiveRate * OVERTIME_MULTIPLIER,
      });
    }
    return map;
  }, [attendance, history, dailyHoursSplitByDate]);

  const payViewTotals = useMemo(() => {
    if (isCurrentlyFixed && currentEntry?.annualSalary) {
      const fixed = monthlySalary(currentEntry.annualSalary);
      return {
        calculated: { regularPay: fixed, overtimePay: 0, total: fixed },
        compliant: { regularPay: fixed, overtimePay: 0, total: fixed },
      };
    }
    const totals = {
      calculated: { regularPay: 0, overtimePay: 0, total: 0 },
      compliant: { regularPay: 0, overtimePay: 0, total: 0 },
    };
    for (const row of attendance) {
      const rate = rateEffectiveOn(history, row.date);
      const { regular, overtime } = dailyHoursSplitByDate.get(row.date) ?? { regular: 0, overtime: 0 };
      const effectiveRate = dailyPayByDate.get(row.date)?.effectiveRate ?? rate;
      totals.calculated.regularPay += regular * rate;
      totals.calculated.overtimePay += overtime * rate * OVERTIME_MULTIPLIER;
      totals.compliant.regularPay += regular * effectiveRate;
      totals.compliant.overtimePay += overtime * effectiveRate * OVERTIME_MULTIPLIER;
    }
    totals.calculated.total = totals.calculated.regularPay + totals.calculated.overtimePay;
    totals.compliant.total = totals.compliant.regularPay + totals.compliant.overtimePay;
    return totals;
  }, [attendance, history, dailyHoursSplitByDate, dailyPayByDate, isCurrentlyFixed, currentEntry]);
  const displayedPay = payViewTotals[payView];
  // Flat equivalent of displayedPay — every hour at the same (regular or
  // state-floor-matched) rate, no 1.5× overtime multiplier. This tile can't
  // see a technician's incentive/bonus pay (that's only fetched on the Tech
  // Activity Report step), so it can't compute the real FLSA weighted-
  // regular-rate OT premium — showing displayedPay.total's old flat-×1.5
  // breakdown implied it WAS the final Hourly + OT figure, which is no
  // longer true once that step folds in incentive pay. Dividing overtimePay
  // back down by OVERTIME_MULTIPLIER recovers the flat (1×) equivalent
  // without duplicating the day-by-day rate loop above.
  const displayedPayFlat = displayedPay.regularPay + displayedPay.overtimePay / OVERTIME_MULTIPLIER;
  // Regular/overtime split of totalHours above — same dailyHoursSplitByDate
  // computedPay itself sums (already meal-credit-inclusive, via the raw
  // hours merge above), so this tile's breakdown line always agrees with
  // Est. Pay's own split.
  const totalHoursSplit = useMemo(
    () =>
      attendance.reduce(
        (acc, r) => {
          const { regular, overtime } = dailyHoursSplitByDate.get(r.date) ?? { regular: 0, overtime: 0 };
          return { regular: acc.regular + regular, overtime: acc.overtime + overtime };
        },
        { regular: 0, overtime: 0 }
      ),
    [attendance, dailyHoursSplitByDate]
  );
  // Regular/overtime hours grouped by calendar week (Sunday–Saturday, same
  // boundary splitRegularOvertimeWeekly resets the overtime threshold at) —
  // shown between Salary History and the day-by-day Attendance table so a
  // reviewer can see at a glance which week(s) in a multi-week range a
  // technician's hours actually landed in, without adding up the per-day
  // rows by hand. Sourced from dailyHoursSplitByDate, so it always agrees
  // with the day rows and the Total Hours/Est. Pay tiles above.
  const weeklyBreakdown = useMemo(() => {
    const byWeek = new Map<string, { regular: number; overtime: number }>();
    for (const row of attendance) {
      const { regular, overtime } = dailyHoursSplitByDate.get(row.date) ?? { regular: 0, overtime: 0 };
      if (!regular && !overtime) continue;
      const weekStart = startOfWeekSunday(row.date);
      const prev = byWeek.get(weekStart) ?? { regular: 0, overtime: 0 };
      byWeek.set(weekStart, { regular: prev.regular + regular, overtime: prev.overtime + overtime });
    }
    return [...byWeek.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, hrs]) => ({
        weekStart,
        weekEnd: addDaysISO(weekStart, 6),
        regular: hrs.regular,
        overtime: hrs.overtime,
        total: hrs.regular + hrs.overtime,
      }));
  }, [attendance, dailyHoursSplitByDate]);
  // Per-state OT subtotal within a week, e.g. "11:38 OT · California" +
  // "8:20 OT · Georgia" — since the floor check is per-day (not blended
  // across the week, see dailyPayByDate), a week's total OT can legitimately
  // be split across more than one state's floor. Days assigned to the same
  // state sum together; a day with OT but no assigned state groups under
  // "Unassigned" so a gap in the data stays visible instead of silently
  // dropping those hours from the breakdown.
  const weeklyOtByState = useMemo(() => {
    const byWeek = new Map<string, Map<string, number>>();
    for (const row of attendance) {
      const overtime = dailyHoursSplitByDate.get(row.date)?.overtime ?? 0;
      if (overtime <= 0) continue;
      const weekStart = startOfWeekSunday(row.date);
      if (!byWeek.has(weekStart)) byWeek.set(weekStart, new Map());
      const byState = byWeek.get(weekStart)!;
      const state = row.state || "Unassigned";
      byState.set(state, (byState.get(state) ?? 0) + overtime);
    }
    const map = new Map<string, Array<{ state: string; hours: number }>>();
    for (const [weekStart, byState] of byWeek) {
      map.set(
        weekStart,
        Array.from(byState, ([state, hours]) => ({ state, hours })).sort((a, b) => b.hours - a.hours)
      );
    }
    return map;
  }, [attendance, dailyHoursSplitByDate]);
  const rateNow = useMemo(() => currentRate(history), [history]);

  const submitRateChange = async () => {
    if (!rateForm.effectiveDate) {
      alert("Please enter a valid effective date.");
      return;
    }
    const isFixed = rateForm.compensationType === "fixed";
    const rate = Number(rateForm.hourlyRate);
    const annual = Number(rateForm.annualSalary);
    if (isFixed ? !Number.isFinite(annual) || annual <= 0 : !Number.isFinite(rate) || rate <= 0) {
      alert(isFixed ? "Please enter a valid annual salary." : "Please enter a valid hourly rate.");
      return;
    }
    // Company policy: every technician-tier employee (primary OR secondary
    // role) observes at least the federal minimum wage ($7.25/hr) on their
    // hourly rate. Fixed-salary employees are the one carve-out (isFixed is
    // checked separately from this rate, so this only fires for an hourly
    // entry).
    if (!isFixed && hasAnyTechnicianPayRole(role, extraRoles) && rate < FEDERAL_MIN_WAGE) {
      alert(`Technician-tier hourly rates can't be entered below the federal minimum wage ($${FEDERAL_MIN_WAGE.toFixed(2)}/hr).`);
      return;
    }
    setSaving(true);
    try {
      await addSalaryEntry({
        profileId,
        effectiveDate: rateForm.effectiveDate,
        compensationType: rateForm.compensationType,
        hourlyRate: rate,
        annualSalary: annual,
        reason: rateForm.reason,
        notes: rateForm.notes,
        createdByName: actorName,
      });
      setHistory(await getSalaryHistory(profileId));
      setShowRateForm(false);
      setRateForm({ effectiveDate: new Date().toISOString().slice(0, 10), compensationType: "hourly", hourlyRate: "", annualSalary: "", reason: "adjustment", notes: "" });
      onRateChanged?.();
    } catch (err) {
      alert(`Failed to save rate change: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRateEntry = async (h: SalaryEntryRow) => {
    const rateLabel = h.compensationType === "fixed" && h.annualSalary ? `$${h.annualSalary.toLocaleString()}/yr` : `$${h.hourlyRate.toFixed(2)}/hr`;
    if (!confirm(`Delete this ${rateLabel} entry effective ${h.effectiveDate}? This can't be undone.`)) return;
    setDeletingRateId(h.id);
    try {
      await deleteSalaryEntry(h.id);
      setHistory(await getSalaryHistory(profileId));
      onRateChanged?.();
    } catch (err) {
      alert(`Failed to delete rate entry: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setDeletingRateId(null);
    }
  };

  const handleRateEdit = (date: string, value: string) => {
    setRateEdits((prev) => ({ ...prev, [date]: value }));
  };

  // Only edits that actually differ from the currently-effective rate count
  // as pending — so the Save button doesn't light up for a no-op edit. Days
  // whose effective entry is a fixed salary aren't editable here at all (see
  // the Attendance table's Rate column below) since there's no per-day
  // hourly rate to set for them.
  const pendingRateChanges = useMemo(() => {
    const changes: Array<{ date: string; rate: number }> = [];
    for (const [date, value] of Object.entries(rateEdits)) {
      if (entryEffectiveOn(history, date)?.compensationType === "fixed") continue;
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) continue;
      if (parsed !== rateEffectiveOn(history, date)) changes.push({ date, rate: parsed });
    }
    return changes;
  }, [rateEdits, history]);

  // Each edited day becomes a new dated rate-history entry effective on that
  // day — same mechanism as "Add Rate Change" above, just edited inline.
  // Because rates apply forward until superseded, this changes pay from
  // that date onward (not just the single day) unless a later entry already
  // exists to take back over.
  const handleSaveRateEdits = async () => {
    if (pendingRateChanges.length === 0) return;
    setSavingRates(true);
    try {
      const sorted = [...pendingRateChanges].sort((a, b) => a.date.localeCompare(b.date));
      for (const change of sorted) {
        await addSalaryEntry({
          profileId,
          effectiveDate: change.date,
          hourlyRate: change.rate,
          reason: "adjustment",
          notes: "Edited from Attendance table",
          createdByName: actorName,
        });
      }
      setHistory(await getSalaryHistory(profileId));
      setRateEdits({});
      onRateChanged?.();
    } catch (err) {
      alert(`Failed to save rate changes: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingRates(false);
    }
  };

  const startEditingAttendance = () => {
    const seed: typeof attendanceEdits = {};
    for (const row of attendance) {
      seed[row.date] = { checkIn: row.clockIn, mealStart: row.mealStart, mealEnd: row.mealEnd, checkOut: row.clockOut };
    }
    setAttendanceEdits(seed);
    setAttendanceEditing(true);
  };

  const cancelEditingAttendance = () => {
    setAttendanceEditing(false);
    setAttendanceEdits({});
  };

  const handleAttendanceEdit = (date: string, field: "checkIn" | "mealStart" | "mealEnd" | "checkOut", value: string) => {
    setAttendanceEdits((prev) => ({ ...prev, [date]: { ...prev[date], [field]: value } }));
  };

  // Wipe a day's punches (Check In / Meal / Check Out) in one click — the
  // day recalculates to Absent on the next Done, same as if it had never
  // been clocked. Only stages the change; nothing is written until Done.
  const clearAttendanceRow = (date: string) => {
    setAttendanceEdits((prev) => ({ ...prev, [date]: { checkIn: "", mealStart: "", mealEnd: "", checkOut: "" } }));
  };

  // Manual correction — upserts each changed day's timecard_entries row
  // directly (same saveEntry the self-service Timecard page and proxy
  // clock-in use), so a corrected day recalculates hours/status/pay exactly
  // like a real punch would. Recorded under clocked_in_by (myProfileId) for
  // the same "not a self-punch" audit trail proxy clock-ins already use.
  // Only rows that actually changed get written, to avoid touching the
  // rest of the range on a no-op "Done".
  const saveAttendanceEdits = async () => {
    setSavingAttendanceEdits(true);
    try {
      const changed = attendance.filter((row) => {
        const e = attendanceEdits[row.date];
        return e && (e.checkIn !== row.clockIn || e.mealStart !== row.mealStart || e.mealEnd !== row.mealEnd || e.checkOut !== row.clockOut);
      });
      for (const row of changed) {
        const e = attendanceEdits[row.date];
        await saveEntry(
          profileId,
          row.date,
          { checkIn: e.checkIn, checkOut: e.checkOut, mealStart: e.mealStart, mealEnd: e.mealEnd, notes: "" },
          myProfileId ? { clockedInBy: myProfileId } : undefined
        );
      }
      setAttendanceEditing(false);
      setAttendanceEdits({});
      await load({ current: false });
      onRateChanged?.();
    } catch (err) {
      alert(`Failed to save attendance edits: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingAttendanceEdits(false);
    }
  };

  // State is independently editable per day (unlike Rate, which is
  // effective-dated) — saves immediately on selection rather than being
  // staged behind a "Done"/"Save" button. Existing punches for that day are
  // passed through unchanged so this save doesn't null them out (saveEntry
  // always writes check_in/check_out/meal_start/meal_end from what's given).
  const handleStateChange = async (row: AttendanceRow, value: string) => {
    setStateEdits((prev) => ({ ...prev, [row.date]: value }));
    setSavingStateFor(row.date);
    try {
      await saveEntry(profileId, row.date, {
        checkIn: row.clockIn,
        checkOut: row.clockOut,
        mealStart: row.mealStart,
        mealEnd: row.mealEnd,
        notes: "",
        state: value,
      });
      await load({ current: false });
    } catch (err) {
      alert(`Failed to save state: ${err instanceof Error ? err.message : "Unknown error"}`);
      setStateEdits((prev) => {
        const next = { ...prev };
        delete next[row.date];
        return next;
      });
    } finally {
      setSavingStateFor(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-slate-900 border border-white/15 rounded-xl w-full max-w-[95vw] max-h-[90vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-slate-950 rounded-t-xl">
          <div>
            <p className="font-semibold text-white">{employeeName}</p>
            {department && <p className="text-xs text-slate-400">{department}</p>}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={rangeStart}
              max={rangeEnd || undefined}
              onChange={(e) => setRangeStart(e.target.value)}
              className="bg-slate-800 border border-white/10 rounded px-2 py-1 text-sm text-white"
            />
            <span className="text-slate-500 text-xs">to</span>
            <input
              type="date"
              value={rangeEnd}
              min={rangeStart || undefined}
              onChange={(e) => setRangeEnd(e.target.value)}
              className="bg-slate-800 border border-white/10 rounded px-2 py-1 text-sm text-white"
            />
            <button onClick={onClose} className="text-white/40 hover:text-white/80 transition ml-1">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-slate-800/50 border border-white/10 rounded-lg p-3">
              <p className="text-xs text-slate-400 uppercase">Total Hours</p>
              <p className="text-xl font-bold text-white mt-1">{fmtDecimal(totalHours)}</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {fmtDecimal(totalHoursSplit.regular)} regular + {fmtDecimal(totalHoursSplit.overtime)} overtime
              </p>
            </div>
            <div className="bg-slate-800/50 border border-white/10 rounded-lg p-3">
              <div className="flex items-stretch gap-3">
                <div>
                  <p className="text-xs text-slate-400 uppercase">Current Rate</p>
                  {isCurrentlyFixed && currentEntry?.annualSalary ? (
                    <p className="text-xl font-bold text-white mt-1">
                      ${currentEntry.annualSalary.toLocaleString()}/yr <span className="text-xs font-normal text-slate-400">(${perCutoffSalary(currentEntry.annualSalary).toFixed(2)}/cutoff)</span>
                    </p>
                  ) : (
                    <p className="text-xl font-bold text-white mt-1">${rateNow.toFixed(2)}/hr</p>
                  )}
                </div>
                <div className="border-l border-white/10 pl-3">
                  <p className="text-xs text-slate-400 uppercase">Tier Level</p>
                  <p className="text-xl font-bold text-white mt-1">{tierLevel || "Unassigned"}</p>
                </div>
              </div>
            </div>
            <div className="bg-slate-800/50 border border-white/10 rounded-lg p-3">
              <p className="text-xs text-slate-400 uppercase">Warnings</p>
              <p className="text-xl font-bold text-yellow-300 mt-1">{warnings.length}</p>
            </div>
            <div className="bg-slate-800/50 border border-white/10 rounded-lg p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-slate-400 uppercase">Hourly + OT Pay ({rangeStart} – {rangeEnd})</p>
                {!isCurrentlyFixed && (
                  <div className="flex items-center rounded-full bg-slate-900 border border-white/10 p-0.5 text-[10px]">
                    <button
                      type="button"
                      onClick={() => setPayView("calculated")}
                      title="Company rate as-is, ignoring any state minimum wage floor"
                      className={`px-2 py-0.5 rounded-full transition ${payView === "calculated" ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300"}`}
                    >
                      Company
                    </button>
                    <button
                      type="button"
                      onClick={() => setPayView("compliant")}
                      title="Company rate, matched up to each day's assigned state's minimum wage when it's higher — the number that's actually safe to pay"
                      className={`px-2 py-0.5 rounded-full transition ${payView === "compliant" ? "bg-emerald-700 text-white" : "text-slate-500 hover:text-slate-300"}`}
                    >
                      State
                    </button>
                  </div>
                )}
              </div>
              <p className="text-xl font-bold text-green-300 mt-1">${displayedPayFlat.toFixed(2)}</p>
              {!isCurrentlyFixed && (
                <p className="text-xs text-slate-400 mt-0.5" title="Flat — every hour (regular and overtime alike) at the same rate, no 1.5× multiplier. The Tech Activity Report step computes the real Hourly + OT total, including the FLSA weighted-regular-rate overtime premium once this period's incentive/bonus pay is folded in — this tile is just the state-floor check, not that final figure.">
                  {(totalHoursSplit.regular + totalHoursSplit.overtime).toFixed(4)} hrs flat = ${displayedPayFlat.toFixed(2)}
                </p>
              )}
            </div>
          </div>

          {/* Salary history + add change */}
          <div className="bg-slate-800/30 border border-white/10 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">Salary History</h3>
              <button
                onClick={() => setShowRateForm((v) => !v)}
                className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1"
              >
                <Plus className="h-3 w-3" /> Add Rate Change
              </button>
            </div>
            {showRateForm && (
              <div className="mb-4 space-y-2 bg-slate-900/60 border border-white/10 rounded-lg p-3">
                <div className="grid gap-2 md:grid-cols-4 items-end">
                  <div>
                    <label className="block text-[10px] text-slate-400 uppercase mb-1">Effective Date</label>
                    <input
                      type="date"
                      value={rateForm.effectiveDate}
                      onChange={(e) => setRateForm({ ...rateForm, effectiveDate: e.target.value })}
                      className="w-full bg-slate-800 border border-white/10 rounded px-2 py-1 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 uppercase mb-1">Compensation Type</label>
                    <select
                      value={rateForm.compensationType}
                      onChange={(e) => setRateForm({ ...rateForm, compensationType: e.target.value as CompensationType })}
                      className="w-full bg-slate-800 border border-white/10 rounded px-2 py-1 text-sm text-white"
                    >
                      <option value="hourly">Hourly</option>
                      <option value="fixed">Fixed Salary</option>
                    </select>
                  </div>
                  {rateForm.compensationType === "fixed" ? (
                    <div>
                      <label className="block text-[10px] text-slate-400 uppercase mb-1">Annual Salary ($)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={rateForm.annualSalary}
                        onChange={(e) => setRateForm({ ...rateForm, annualSalary: e.target.value })}
                        className="w-full bg-slate-800 border border-white/10 rounded px-2 py-1 text-sm text-white"
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="block text-[10px] text-slate-400 uppercase mb-1">New Rate ($/hr)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={rateForm.hourlyRate}
                        onChange={(e) => setRateForm({ ...rateForm, hourlyRate: e.target.value })}
                        className="w-full bg-slate-800 border border-white/10 rounded px-2 py-1 text-sm text-white"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-[10px] text-slate-400 uppercase mb-1">Reason</label>
                    <select
                      value={rateForm.reason}
                      onChange={(e) => setRateForm({ ...rateForm, reason: e.target.value as SalaryChangeReason })}
                      className="w-full bg-slate-800 border border-white/10 rounded px-2 py-1 text-sm text-white"
                    >
                      <option value="promotion">Promotion</option>
                      <option value="adjustment">Adjustment</option>
                      <option value="demotion">Demotion</option>
                      <option value="initial">Initial</option>
                      <option value="training_rate">Training Rate</option>
                    </select>
                  </div>
                </div>
                {rateForm.compensationType === "fixed" && Number(rateForm.annualSalary) > 0 && (
                  <p className="text-[11px] text-slate-400">
                    = ${monthlySalary(Number(rateForm.annualSalary)).toFixed(2)}/month · ${perCutoffSalary(Number(rateForm.annualSalary)).toFixed(2)}/cutoff (bi-weekly)
                  </p>
                )}
                <div className="flex justify-end">
                  <button
                    onClick={submitRateChange}
                    disabled={saving}
                    className="px-3 py-1.5 rounded bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-semibold"
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            )}
            {history.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-3">No rate history recorded yet.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 border-b border-white/10">
                    <th className="text-left py-1.5">Effective</th>
                    <th className="text-left py-1.5">Type</th>
                    <th className="text-left py-1.5">Reason</th>
                    <th className="text-left py-1.5">Changed By</th>
                    <th className="text-left py-1.5">Date Changed</th>
                    <th className="text-right py-1.5">Rate</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-b border-white/5">
                      <td className="py-1.5 text-slate-200">{h.effectiveDate}</td>
                      <td className="py-1.5 text-slate-300">{h.compensationType === "fixed" ? "Fixed Salary" : "Hourly"}</td>
                      <td className="py-1.5 text-slate-300">{SALARY_REASON_LABELS[h.reason] ?? h.reason}</td>
                      <td className="py-1.5 text-slate-300">{h.createdByName || "—"}</td>
                      <td className="py-1.5 text-slate-300" title="When this entry was actually recorded, as opposed to the date it takes effect from">
                        {new Date(h.createdAt).toLocaleString()}
                      </td>
                      <td className="py-1.5 text-right text-white font-semibold">
                        {h.compensationType === "fixed" && h.annualSalary
                          ? <>${h.annualSalary.toLocaleString()}/yr <span className="font-normal text-slate-400">(${perCutoffSalary(h.annualSalary).toFixed(2)}/cutoff)</span></>
                          : `$${h.hourlyRate.toFixed(2)}/hr`}
                      </td>
                      <td className="py-1.5 text-right">
                        <button
                          onClick={() => handleDeleteRateEntry(h)}
                          disabled={deletingRateId === h.id}
                          title="Delete this rate entry — for cleaning up a stray duplicate or mistaken entry, not routine edits"
                          className="text-slate-500 hover:text-red-400 disabled:opacity-50"
                        >
                          {deletingRateId === h.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Weekly breakdown + unassigned-state flag */}
          {(weeklyBreakdown.length > 0 || unassignedStateDays.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {weeklyBreakdown.length > 0 && (
            <div className="bg-slate-800/30 border border-white/10 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-white mb-2">Weekly Breakdown</h3>
              <ul className="space-y-1">
                {weeklyBreakdown.map((w, i, arr) => {
                  const change = i > 0 ? fmtWeekOverWeekChange(w.total, arr[i - 1].total) : null;
                  const otByState = payView === "compliant" ? weeklyOtByState.get(w.weekStart) ?? [] : [];
                  return (
                    <li key={w.weekStart} className="text-xs text-slate-300">
                      <div className="flex items-baseline gap-1.5 flex-wrap">
                        <span className="text-slate-400">
                          Week of {fmtShortDate(w.weekStart)}–{fmtShortDate(w.weekEnd)}:
                        </span>
                        <span className="font-semibold text-white">{fmtDecimal(w.total)} hours</span>
                        <span className="text-slate-500">
                          ({fmtDecimal(w.regular)} Reg{w.overtime > 0 ? ` + ${fmtDecimal(w.overtime)} OT` : ""})
                        </span>
                        {change && (
                          <span className={change.direction === "more" ? "text-orange-300" : change.direction === "less" ? "text-emerald-400" : "text-slate-500"}>
                            ({change.text})
                          </span>
                        )}
                      </div>
                      {otByState.length > 0 && (
                        <div className="mt-1 pl-4 flex flex-col gap-0.5">
                          {otByState.map((e) => (
                            <span key={e.state} className="text-[11px] text-amber-300/80">
                              {fmtDecimal(e.hours)} OT · {e.state}
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {unassignedStateDays.length > 0 && (
            <div className="bg-amber-950/20 border border-amber-500/30 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-amber-300 mb-2">
                State Not Assigned — {unassignedStateDays.length} {unassignedStateDays.length === 1 ? "day" : "days"}
              </h3>
              <p className="text-xs text-slate-400 mb-2">
                These worked days fall back to the flat ${rateNow.toFixed(2)}/hr company rate for the Min Wage Floor Check instead of a real state — fill in RateState below if these were worked somewhere with a higher minimum wage.
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {unassignedStateDays.map((r) => (
                  <li key={r.date} className="text-xs px-2 py-0.5 rounded bg-amber-500/10 text-amber-200 border border-amber-500/20">
                    {fmtShortDate(r.date)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          </div>
          )}

          {/* Attendance table */}
          <div className="bg-slate-800/30 border border-white/10 rounded-lg p-4">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold text-white">Attendance — {rangeStart} to {rangeEnd}</h3>
              <div className="flex items-center gap-2">
                {pendingRateChanges.length > 0 && (
                  <button
                    type="button"
                    onClick={handleSaveRateEdits}
                    disabled={savingRates}
                    className="text-xs px-2 py-1 rounded bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white flex items-center gap-1"
                  >
                    {savingRates ? "Saving…" : `Save Rate Changes (${pendingRateChanges.length})`}
                  </button>
                )}
                {attendanceEditing ? (
                  <>
                    <button
                      type="button"
                      onClick={saveAttendanceEdits}
                      disabled={savingAttendanceEdits}
                      className="text-xs px-2 py-1 rounded bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white flex items-center gap-1"
                    >
                      <Check className="h-3 w-3" /> {savingAttendanceEdits ? "Saving…" : "Done Editing"}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditingAttendance}
                      disabled={savingAttendanceEdits}
                      className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={startEditingAttendance}
                    disabled={loading || attendance.length === 0}
                    className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white flex items-center gap-1"
                  >
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                )}
              </div>
            </div>
            <p className="text-[10px] text-slate-500 mb-2">
              Editing a day's rate adds a new rate effective from that date forward (it also applies to later days, until the next rate change). Use Edit above for manual time corrections (Check In/Meal In/Meal Out/Check Out).
            </p>
            {loading ? (
              <p className="text-xs text-slate-400 text-center py-4">Loading…</p>
            ) : attendance.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-4">No attendance records for this period.</p>
            ) : (
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-800">
                    <tr className="text-slate-400 border-b border-white/10">
                      <th className="text-left py-1.5">Date</th>
                      <th className="text-left py-1.5">Check In</th>
                      <th className="text-left py-1.5">Meal In</th>
                      <th className="text-left py-1.5">Meal Out</th>
                      <th className="text-left py-1.5">Check Out</th>
                      <th className="text-right py-1.5">Regular Hour(s)</th>
                      <th className="text-right py-1.5" title="Actual Meal In-to-Meal Out duration for meal-always-paid roles (Technician, Branch/Senior Branch Manager, Tech Manager, Technical Director/Assistant Director) — fully paid whatever it runs, since the break happens inside the clock-in-to-clock-out span and isn't deducted from it. Flagged red past 30 minutes as a conduct flag, not a pay cut. No punch at all pays nothing extra, but also deducts nothing.">Meal Time</th>
                      <th className="text-right py-1.5">Overtime</th>
                      <th className="text-right py-1.5" title="Regular Hour(s) + Meal Time + Overtime">Total Hours</th>
                      <th className="text-right py-1.5">Status</th>
                      <th className="text-right py-1.5">Rate</th>
                      {payView === "compliant" && (
                        <th className="text-left py-1.5" title="State the technician was assigned to for this day — technicians hop between states job to job, so this is set per day, independently of every other day.">State</th>
                      )}
                      <th className="text-right py-1.5">Payment</th>
                      <th className="text-center py-1.5">Scheduled</th>
                      <th className="text-center py-1.5" title="Tickets with both an Arrived and a Done on-site stamp">Completed</th>
                      <th className="text-right py-1.5 pr-4" title="Sum of the completed tickets' leg mileage plus the day's own drive-home leg — excludes DID NOT GO and any ticket missing an arrived/done stamp. Not editable; it rolls up the per-ticket mileage (and the → Home/Branch line) in the breakdown below.">Total Mileage</th>
                      <th className="text-center py-1.5">Checked In</th>
                      <th className="text-center py-1.5" title="Missing Check-In">Missing In</th>
                      <th className="text-center py-1.5" title="Missing Check-Out">Missing Out</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendance.map((row) => {
                      const dayIsFixed = entryEffectiveOn(history, row.date)?.compensationType === "fixed";
                      const edit = attendanceEdits[row.date];
                      const isRestDay = row.status === "day-off" || row.status === "holiday";
                      // dailyHoursSplitByDate's regular/overtime is correct (meal credit
                      // merged into the raw hours BEFORE the weekly cap runs, so the cap
                      // trips on the right day even when credit is what pushes a day over)
                      // but folds credit invisibly into whichever bucket it landed in. For
                      // display, decompose that folded split back into two columns that
                      // reconcile to the folded total:
                      //   Regular   = min(realHours, folded.regular) — real hours fill the
                      //               regular bucket first; only less than realHours if
                      //               real hours alone already used up the day's room.
                      //   Overtime  = folded.overtime, unclipped — the true overtime,
                      //               including any credit that spilled past the cap.
                      // Regular + Overtime === folded.regular + folded.overtime always,
                      // since adding hours to a day never changes its total, only where the
                      // split boundary falls. Payment keeps using the folded split directly,
                      // so credit that spills past the threshold is still paid at the OT
                      // rate. The Meal Time column below is independent of this split — it
                      // shows the real punched break duration, not a derived credit amount
                      // (see actualMealHours).
                      const folded = dailyHoursSplitByDate.get(row.date) ?? { regular: 0, overtime: 0 };
                      const realHours = row.hoursWorked;
                      const regularHours = Math.min(realHours, folded.regular);
                      const overtimeHours = folded.overtime;
                      const totalDayHours = folded.regular + folded.overtime;
                      // The real punched meal duration, purely for display/monitoring —
                      // no longer tied to the pay credit (computeMealTimeCredit already
                      // credits back this exact same duration, so it's fully paid whatever
                      // it is; see timecards.ts). Flagged red past the 30-minute policy
                      // length as a conduct flag, not a pay deduction — the technician is
                      // still paid for the whole clock-in-to-clock-out span either way.
                      const actualMealHours = row.mealStart && row.mealEnd ? Math.max(0, hoursDiff(row.mealStart, row.mealEnd)) : 0;
                      const mealOverPolicy = actualMealHours > MEAL_ALWAYS_PAID_DEFAULT_HOURS;
                      const dayPay = dailyPayByDate.get(row.date);
                      const dayTicketStates = ticketStateByDate.get(row.date);
                      const dayPayment = payView === "compliant" ? dayPay?.compliantPay ?? 0 : dayPay?.calculatedPay ?? 0;
                      const ticketStats = ticketStatsByDate.get(row.date);
                      const dayTicketRows = ticketRowsByDate.get(row.date) || [];
                      // The day's own drive-home leg (mileage.ts migration 0237) — set on
                      // exactly one ticket (whichever was the day's actual last completed
                      // stop), kept out of the per-ticket Mileage column so it never reads
                      // as that one ticket's own drive.
                      const dayHomeLegMileage = dayTicketRows
                        .map((r) => mileageByTicketNo.get(r.ticketNo)?.homeLegMileage)
                        .find((m): m is number => m != null) ?? null;
                      const isExpanded = expandedDate === row.date;
                      return (
                      <Fragment key={row.date}>
                      <tr
                        className={`border-b border-white/5 cursor-pointer hover:bg-white/5 transition${isRestDay ? " opacity-40" : ""}${isExpanded ? " bg-white/5" : ""}`}
                        onClick={() => setExpandedDate((cur) => (cur === row.date ? null : row.date))}
                      >
                        <td className="py-1.5 text-slate-200 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            {isExpanded ? <ChevronDown className="h-3 w-3 text-slate-500" /> : <ChevronRight className="h-3 w-3 text-slate-500" />}
                            {row.date}
                          </span>
                        </td>
                        {attendanceEditing ? (
                          <>
                            <td className="py-1.5" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="time"
                                step="1"
                                value={edit?.checkIn ?? row.clockIn}
                                onChange={(e) => handleAttendanceEdit(row.date, "checkIn", e.target.value)}
                                className="w-24 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-slate-100 focus:outline-none focus:border-blue-500"
                              />
                            </td>
                            <td className="py-1.5" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="time"
                                step="1"
                                value={edit?.mealStart ?? row.mealStart}
                                onChange={(e) => handleAttendanceEdit(row.date, "mealStart", e.target.value)}
                                className="w-24 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-slate-100 focus:outline-none focus:border-blue-500"
                              />
                            </td>
                            <td className="py-1.5" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="time"
                                step="1"
                                value={edit?.mealEnd ?? row.mealEnd}
                                onChange={(e) => handleAttendanceEdit(row.date, "mealEnd", e.target.value)}
                                className="w-24 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-slate-100 focus:outline-none focus:border-blue-500"
                              />
                            </td>
                            <td className="py-1.5" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="time"
                                  step="1"
                                  value={edit?.checkOut ?? row.clockOut}
                                  onChange={(e) => handleAttendanceEdit(row.date, "checkOut", e.target.value)}
                                  className="w-24 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-slate-100 focus:outline-none focus:border-blue-500"
                                />
                                <button
                                  type="button"
                                  onClick={() => clearAttendanceRow(row.date)}
                                  title="Clear this day's Check In / Meal / Check Out"
                                  className="shrink-0 text-slate-500 hover:text-red-400"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className={`py-1.5 ${row.clockIn ? "text-green-300" : "text-slate-500"}`}>{row.clockIn || "—"}</td>
                            <td className={`py-1.5 ${row.mealStart ? "text-orange-300" : "text-slate-500"}`}>{row.mealStart || "—"}</td>
                            <td className={`py-1.5 ${row.mealEnd ? "text-orange-300" : "text-slate-500"}`}>{row.mealEnd || "—"}</td>
                            <td className={`py-1.5 ${row.clockOut ? "text-red-300" : "text-slate-500"}`}>{row.clockOut || "—"}</td>
                          </>
                        )}
                        <td className="py-1.5 text-right text-slate-200">{row.hoursWorked ? fmtDecimal(regularHours) : "—"}</td>
                        <td
                          className={`py-1.5 text-right ${mealOverPolicy ? "text-red-400 font-semibold" : "text-sky-300"}`}
                          title={mealOverPolicy ? "Over the 30-minute paid meal policy — flagged for review. Still fully paid; this isn't a pay deduction." : "Actual meal break taken — fully paid regardless of length (see computeMealTimeCredit)."}
                        >
                          {actualMealHours > 0 ? fmtDecimal(actualMealHours) : "—"}
                        </td>
                        <td className={`py-1.5 text-right ${overtimeHours > 0 ? "text-orange-300 font-semibold" : "text-slate-500"}`}>
                          {overtimeHours > 0 ? fmtDecimal(overtimeHours) : "—"}
                        </td>
                        <td className="py-1.5 text-right text-slate-200">{row.hoursWorked ? fmtDecimal(totalDayHours) : "—"}</td>
                        <td className={`py-1.5 text-right font-semibold ${STATUS_COLOR[row.status]}`}>
                          {row.status === "pending-correction" && pendingCorrectionByDate.has(row.date) ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPendingDetailModal({ date: row.date, item: { type: "correction", data: pendingCorrectionByDate.get(row.date)! } });
                              }}
                              className="underline decoration-dotted underline-offset-2 hover:text-amber-200"
                            >
                              {statusLabelFor(row)}
                            </button>
                          ) : (
                            statusLabelFor(row)
                          )}
                        </td>
                        <td className="py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                          {dayIsFixed ? (
                            <span className="text-slate-500" title="Fixed-salary pay doesn't vary by day — edit it from Salary History above instead">Fixed Salary</span>
                          ) : payView === "compliant" && dayPay?.isMatched ? (
                            <div className="flex items-center justify-end gap-1">
                              <span className="text-slate-500">$</span>
                              <span
                                title={`This day's pay uses ${row.state}'s minimum wage ($${dayPay.effectiveRate.toFixed(2)}/hr) since it's higher than the company rate ($${dayPay.companyRate.toFixed(2)}/hr) — not editable here. Switch to Company view to edit the base rate.`}
                                className="w-16 text-right text-amber-300 font-semibold"
                              >
                                {dayPay.effectiveRate.toFixed(2)}
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              <span className="text-slate-500">$</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                title={`Rate effective ${row.date}`}
                                value={rateEdits[row.date] ?? rateEffectiveOn(history, row.date).toFixed(2)}
                                onChange={(e) => handleRateEdit(row.date, e.target.value)}
                                className="w-16 bg-slate-900 border border-white/10 rounded px-1.5 py-0.5 text-right text-slate-100 focus:outline-none focus:border-blue-500"
                              />
                            </div>
                          )}
                        </td>
                        {payView === "compliant" && (
                          <td className="py-1.5" onClick={(e) => e.stopPropagation()}>
                            <select
                              value={stateEdits[row.date] ?? row.state ?? ""}
                              onChange={(e) => handleStateChange(row, e.target.value)}
                              disabled={savingStateFor === row.date}
                              className="bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-slate-100 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                            >
                              <option value="">—</option>
                              {STATE_MIN_WAGE_2026.map((s) => (
                                <option key={s.state} value={s.state}>{s.state}</option>
                              ))}
                            </select>
                            {savingStateFor === row.date && <Loader2 className="inline-block h-3 w-3 ml-1 animate-spin text-slate-400" />}
                            {dayPay?.isMatched && (
                              <span
                                title={`State minimum wage ($${dayPay.effectiveRate.toFixed(2)}/hr) is higher than the company rate ($${dayPay.companyRate.toFixed(2)}/hr) — pay must be matched up to it for this day.`}
                                className="inline-flex items-center gap-0.5 ml-1 px-1 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-semibold align-middle"
                              >
                                ▲ Floor
                              </span>
                            )}
                            {dayTicketStates && dayTicketStates.states.length > 1 && (
                              <span
                                title={`This day's checked-into tickets span more than one state (${dayTicketStates.states.join(", ")}) — auto-filled with the higher-rate one${dayTicketStates.bestState ? ` (${dayTicketStates.bestState})` : ""}. Review and pick a different one by hand if that's not right.`}
                                className="inline-flex items-center gap-0.5 ml-1 px-1 py-0.5 rounded bg-red-500/20 text-red-300 text-[10px] font-semibold align-middle"
                              >
                                ⚠ Multi-State
                              </span>
                            )}
                          </td>
                        )}
                        <td className="py-1.5 text-right font-semibold text-green-300">
                          {dayIsFixed ? (
                            <span className="text-slate-500 font-normal" title="Fixed-salary pay doesn't vary by day">—</span>
                          ) : row.hoursWorked ? (
                            `$${dayPayment.toFixed(2)}`
                          ) : (
                            <span className="text-slate-500 font-normal">—</span>
                          )}
                        </td>
                        <td className="py-1.5 text-center text-slate-300">{ticketStats ? ticketStats.scheduled : "—"}</td>
                        <td className="py-1.5 text-center text-emerald-300">{ticketStats ? ticketStats.completed : "—"}</td>
                        <td className="py-1.5 pr-4 text-right text-slate-300 whitespace-nowrap">
                          {ticketStats && ticketStats.completed > 0 ? `${ticketStats.totalMileage.toFixed(1)} mi` : <span className="text-slate-500">—</span>}
                        </td>
                        <td className="py-1.5 text-center text-emerald-300">{ticketStats ? ticketStats.checkedIn : "—"}</td>
                        <td className={`py-1.5 text-center ${ticketStats && ticketStats.missingCheckIn > 0 ? "text-red-300 font-semibold" : "text-slate-500"}`}>
                          {ticketStats ? ticketStats.missingCheckIn : "—"}
                        </td>
                        <td className={`py-1.5 text-center ${ticketStats && ticketStats.missingCheckOut > 0 ? "text-yellow-300 font-semibold" : "text-slate-500"}`}>
                          {ticketStats ? ticketStats.missingCheckOut : "—"}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={16} className="px-2 py-3 bg-white/[0.02] border-b border-white/5">
                            {dayTicketRows.length === 0 ? (
                              <p className="text-[11px] text-slate-500 text-center py-2">No tickets scheduled this day.</p>
                            ) : (
                              <table className="w-full text-[11px]">
                                <thead>
                                  <tr className="text-slate-500">
                                    <th className="px-2 py-1 text-left" title="Visit order — sorted by the technician's actual on-site Arrived stamp (earliest first)">#</th>
                                    <th className="px-2 py-1 text-left">Ticket</th>
                                    <th className="px-2 py-1 text-left">Status</th>
                                    <th className="px-2 py-1 text-left">Address</th>
                                    <th className="px-2 py-1 text-left">Estimate Time</th>
                                    <th className="px-2 py-1 text-left">Arrived</th>
                                    <th className="px-2 py-1 text-left">Done</th>
                                    <th className="px-2 py-1 text-right">Mileage</th>
                                    <th className="px-2 py-1 text-left">Map Link</th>
                                    <th className="px-2 py-1 text-left">Diagnosis</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {dayTicketRows.map((r, i) => {
                                    const mEntry = mileageByTicketNo.get(r.ticketNo);
                                    const diagnosis = diagnoses.get(r.ticketId);
                                    const isDisputed = disputedTicketNosApproved.has(r.ticketNo);
                                    const dayHasPassed = r.scheduleDate < todayISO;
                                    const didNotGo = !diagnosis && !r.arrivedAt && dayHasPassed && r.statusGroup !== "cancelled";
                                    const noDiagnosisFound = !diagnosis && !!r.arrivedAt;
                                    const isEditingEstimate = mEntry && editingEstimateTimeId === mEntry.id;
                                    return (
                                      <tr key={r.ticketNo} className="border-t border-white/5">
                                        <td className="px-2 py-1.5 text-slate-500 font-semibold text-center">{i + 1}</td>
                                        <td className="px-2 py-1.5">
                                          <a href={`/ticket/${r.ticketNo}`} target="_blank" rel="noopener noreferrer" className="text-blue-300 hover:text-blue-200 hover:underline">
                                            {r.ticketNo}
                                          </a>
                                        </td>
                                        <td className="px-2 py-1.5 text-slate-300">
                                          {r.timeSlot && <span className="text-slate-500">{r.timeSlot} · </span>}
                                          {r.status}
                                        </td>
                                        <td className="px-2 py-1.5 text-slate-400">{r.address || "—"}</td>
                                        <td className="px-2 py-1.5">
                                          {isEditingEstimate ? (
                                            <div className="flex items-center gap-1">
                                              <input
                                                type="text"
                                                autoFocus
                                                value={estimateTimeDraft}
                                                onChange={(e) => setEstimateTimeDraft(e.target.value)}
                                                onKeyDown={(e) => { if (e.key === "Enter") void handleSaveEstimateTime(mEntry!); if (e.key === "Escape") setEditingEstimateTimeId(null); }}
                                                className="w-20 rounded border border-white/15 bg-slate-800 px-1 py-0.5 text-[11px] text-white"
                                              />
                                              <button
                                                onClick={() => void handleSaveEstimateTime(mEntry!)}
                                                disabled={savingEstimateTimeId === mEntry!.id}
                                                className="text-emerald-400 hover:text-emerald-300 disabled:opacity-40"
                                              >
                                                {savingEstimateTimeId === mEntry!.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                              </button>
                                            </div>
                                          ) : (
                                            <button
                                              onClick={() => {
                                                if (!mEntry) return;
                                                setEditingEstimateTimeId(mEntry.id);
                                                setEstimateTimeDraft(mEntry.estimateTime ?? "");
                                              }}
                                              disabled={!mEntry}
                                              title={mEntry ? "Click to edit" : "Sync mileage first"}
                                              className="flex items-center gap-1 text-slate-300 hover:text-white disabled:text-slate-600 disabled:cursor-not-allowed"
                                            >
                                              {mEntry?.estimateTime || <span className="text-slate-600">—</span>}
                                              {mEntry && <Pencil className="h-2.5 w-2.5 text-slate-500 shrink-0" />}
                                            </button>
                                          )}
                                        </td>
                                        <td className="px-2 py-1.5">
                                          {r.arrivedAt ? (
                                            <span className="text-emerald-300">{new Date(r.arrivedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                                          ) : isDisputed ? (
                                            <span className="text-blue-300">Fixed via dispute</span>
                                          ) : r.statusGroup === "cancelled" ? (
                                            <span className="text-slate-500">—</span>
                                          ) : (
                                            <span className="text-red-300">Missing</span>
                                          )}
                                        </td>
                                        <td className="px-2 py-1.5">
                                          {r.doneAt ? (
                                            <span className="text-emerald-300">{new Date(r.doneAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                                          ) : isDisputed ? (
                                            <span className="text-blue-300">Fixed via dispute</span>
                                          ) : !r.arrivedAt || r.statusGroup === "cancelled" ? (
                                            <span className="text-slate-500">—</span>
                                          ) : (
                                            <span className="text-yellow-300">Missing</span>
                                          )}
                                        </td>
                                        <td className="px-2 py-1.5 text-right text-slate-300">
                                          {mEntry && editingLegMileageId === mEntry.id ? (
                                            <div className="flex items-center justify-end gap-1">
                                              <input
                                                type="number"
                                                step="0.1"
                                                min="0"
                                                autoFocus
                                                value={legMileageDraft}
                                                onChange={(e) => setLegMileageDraft(e.target.value)}
                                                onKeyDown={(e) => { if (e.key === "Enter") void handleSaveLegMileage(mEntry); if (e.key === "Escape") setEditingLegMileageId(null); }}
                                                placeholder="—"
                                                className="w-16 rounded border border-white/15 bg-slate-800 px-1 py-0.5 text-[11px] text-right text-white"
                                              />
                                              <button
                                                onClick={() => void handleSaveLegMileage(mEntry)}
                                                disabled={savingLegMileageId === mEntry.id}
                                                className="text-emerald-400 hover:text-emerald-300 disabled:opacity-40"
                                              >
                                                {savingLegMileageId === mEntry.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                              </button>
                                            </div>
                                          ) : (
                                            <button
                                              onClick={() => {
                                                if (!mEntry) return;
                                                setEditingLegMileageId(mEntry.id);
                                                setLegMileageDraft(mEntry.legMileage != null ? String(mEntry.legMileage) : "");
                                              }}
                                              disabled={!mEntry}
                                              title={mEntry ? "Click to edit this ticket's mileage" : "Sync mileage first"}
                                              className="inline-flex items-center gap-1 text-slate-300 hover:text-white disabled:text-slate-600 disabled:cursor-not-allowed"
                                            >
                                              {mEntry?.legMileage != null ? `${mEntry.legMileage.toFixed(1)} mi` : <span className="text-slate-600">—</span>}
                                              {mEntry && <Pencil className="h-2.5 w-2.5 text-slate-500 shrink-0" />}
                                            </button>
                                          )}
                                        </td>
                                        <td className="px-2 py-1.5">
                                          {mEntry?.googleMapLink ? (
                                            <a href={mEntry.googleMapLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-300 hover:text-blue-200 hover:underline">
                                              Open <ExternalLink className="h-3 w-3" />
                                            </a>
                                          ) : (
                                            <span className="text-slate-600">—</span>
                                          )}
                                        </td>
                                        <td className="px-2 py-1.5 max-w-[220px]">
                                          {diagnosis ? (
                                            <div className="relative group inline-block max-w-full align-top">
                                              <span className="block truncate text-slate-400 cursor-default">{diagnosis}</span>
                                              <div className="pointer-events-none absolute left-0 bottom-full z-50 mb-1.5 w-72 max-w-[min(24rem,80vw)] rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-[11px] leading-relaxed text-slate-200 shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity whitespace-normal">
                                                <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Diagnosis — {r.ticketNo}</p>
                                                {diagnosis}
                                              </div>
                                            </div>
                                          ) : didNotGo ? (
                                            <span className="text-red-300 font-semibold">DID NOT GO</span>
                                          ) : noDiagnosisFound ? (
                                            <span className="text-amber-300 font-semibold">NO DIAGNOSIS FOUND</span>
                                          ) : (
                                            <span className="text-slate-600">—</span>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                  {dayHomeLegMileage != null && (
                                    <tr className="border-t border-white/5" title="The day's final drive home (or back to branch) after the last completed stop — kept separate from any one ticket's own leg mileage.">
                                      <td colSpan={7} className="px-2 py-1.5 text-right text-slate-500 italic">→ Home / Branch</td>
                                      <td className="px-2 py-1.5 text-right text-slate-400">{dayHomeLegMileage.toFixed(1)} mi</td>
                                      <td colSpan={2}></td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                      </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {onNext && (
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-white/10 bg-slate-950 rounded-b-xl">
            <p className="text-xs text-slate-500">Review the clock-in/out and ticket detail above, then continue to the Tech Activity Report.</p>
            <button
              type="button"
              disabled={nextBusy}
              onClick={() => onNext(payView === "compliant" ? "state" : "company", payViewTotals.compliant.total)}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition shrink-0"
            >
              {nextBusy ? "Saving…" : "Next →"}
            </button>
          </div>
        )}
        {!onNext && onDone && (
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-white/10 bg-slate-950 rounded-b-xl">
            <p className="text-xs text-slate-500">
              Review the hours and pay above, then mark this employee reviewed for the period.
              {reviewPeriodStart && reviewPeriodEnd && (
                <span className="block text-slate-400 mt-0.5">
                  Will be stamped for:{" "}
                  <span className={`font-semibold ${reviewPeriodStart > reviewPeriodEnd ? "text-red-300" : "text-slate-300"}`}>
                    {reviewPeriodStart} to {reviewPeriodEnd}
                  </span>
                  {" "}— the page's own Period, not the date range above.
                  {onSyncReviewPeriod && (reviewPeriodStart !== rangeStart || reviewPeriodEnd !== rangeEnd) && (
                    <button
                      type="button"
                      onClick={() => onSyncReviewPeriod(rangeStart, rangeEnd)}
                      className="ml-1.5 text-blue-400 hover:text-blue-300 underline"
                    >
                      Use {rangeStart} to {rangeEnd} instead
                    </button>
                  )}
                </span>
              )}
            </p>
            <button
              type="button"
              disabled={doneBusy}
              onClick={() => onDone()}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition shrink-0"
            >
              {doneBusy ? "Saving…" : "Mark Reviewed"}
            </button>
          </div>
        )}
      </div>
      {pendingDetailModal && (
        <PendingItemDetailModal
          profileName={employeeName}
          date={pendingDetailModal.date}
          item={pendingDetailModal.item}
          profiles={[]}
          myProfileId={myProfileId}
          myRole={myRole}
          myExtraRoles={myExtraRoles ?? []}
          myDisplayName={displayName}
          onClose={() => setPendingDetailModal(null)}
          onReviewed={() => {
            setPendingDetailModal(null);
            load({ current: false });
          }}
        />
      )}
    </div>
  );
}
