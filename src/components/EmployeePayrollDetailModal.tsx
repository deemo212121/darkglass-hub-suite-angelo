import { Fragment, useEffect, useMemo, useState } from "react";
import { X, Plus, Pencil, Check, Loader2, ExternalLink, ChevronDown, ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getAttendanceForRange, saveEntry, getProfileIdByFirebaseUid, type AttendanceRow } from "@/lib/supabase/timecards";
import { getTicketAttendanceForTechnician, type TicketAttendanceRow } from "@/lib/supabase/technicianWhereabouts";
import { getCompanyEmployeeRequests } from "@/lib/supabase/employeeRequests";
import { getVisitDiagnosisByTicketIds } from "@/lib/supabase/tickets";
import { getMileageEntries, setMileageEstimateTime, type MileageEntry } from "@/lib/supabase/mileage";
import {
  getSalaryHistory,
  addSalaryEntry,
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

// Same per-day threshold AccountingDashboard.tsx's computeHoursMap already
// uses to split regular vs. overtime for the real payroll totals (8
// hours/day, not a weekly-rolling threshold) — kept in sync with that
// value here so this table's per-day breakdown matches what actually gets
// paid, not a different invented rule.
const REGULAR_HOURS_PER_DAY = 8;
const OVERTIME_MULTIPLIER = 1.5;

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
  "missing-meal": "Meal Not Taken",
  "day-off": "Rest Day",
};
const STATUS_COLOR: Record<AttendanceRow["status"], string> = {
  present: "text-green-300",
  absent: "text-red-300",
  "missing-in": "text-yellow-300",
  "missing-out": "text-yellow-300",
  "missing-meal": "text-orange-300",
  "day-off": "text-slate-400",
};

export function EmployeePayrollDetailModal({
  profileId,
  employeeName,
  department,
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
}: Props) {
  const { uid, displayName, email } = useAuth();
  const actorName = displayName || email || "Unknown";
  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const fallbackMonth = currentMonthBounds();
  const [rangeStart, setRangeStart] = useState(initialStart || fallbackMonth.start);
  const [rangeEnd, setRangeEnd] = useState(initialEnd || fallbackMonth.end);
  const [loading, setLoading] = useState(true);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [history, setHistory] = useState<SalaryEntryRow[]>([]);
  const [ticketRows, setTicketRows] = useState<TicketAttendanceRow[]>([]);
  const [diagnoses, setDiagnoses] = useState<Map<string, string>>(new Map());
  const [mileageEntries, setMileageEntries] = useState<MileageEntry[]>([]);
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
  }, []);

  const load = async (cancelledRef: { current: boolean }) => {
    setLoading(true);
    setRateEdits({});
    try {
      const [attRows, hist, myTicketRows] = await Promise.all([
        getAttendanceForRange(profileId, rangeStart, rangeEnd, { requiredCheckIn, requiredCheckOut, workingHours, mealMinutes, daysOff: offDays, graceMinutes }),
        getSalaryHistory(profileId),
        getTicketAttendanceForTechnician(employeeName, rangeStart, rangeEnd),
      ]);
      if (cancelledRef.current) return;
      setAttendance(attRows);
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
  }, [profileId, rangeStart, rangeEnd]);

  const totalHours = useMemo(() => attendance.reduce((s, r) => s + r.hoursWorked, 0), [attendance]);
  // Per-day ticket On-Site Check-In stats — same Scheduled/Checked In/
  // Missing Check-In/Missing Check-Out definitions Ticket Attendance uses
  // (technicianWhereabouts.ts), just grouped by day instead of summed over
  // the whole range, so each row here lines up with that day's tickets.
  const ticketStatsByDate = useMemo(() => {
    const byDate = new Map<string, TicketAttendanceRow[]>();
    for (const r of ticketRows) {
      if (!byDate.has(r.scheduleDate)) byDate.set(r.scheduleDate, []);
      byDate.get(r.scheduleDate)!.push(r);
    }
    const map = new Map<string, { scheduled: number; checkedIn: number; missingCheckIn: number; missingCheckOut: number }>();
    for (const [date, dayRows] of byDate) {
      map.set(date, {
        scheduled: dayRows.length,
        checkedIn: dayRows.filter((r) => r.arrivedAt).length,
        missingCheckIn: dayRows.filter((r) => !r.arrivedAt && r.statusGroup !== "cancelled" && !disputedTicketNosApproved.has(r.ticketNo)).length,
        missingCheckOut: dayRows.filter((r) => r.arrivedAt && !r.doneAt && r.statusGroup !== "cancelled" && !disputedTicketNosApproved.has(r.ticketNo)).length,
      });
    }
    return map;
  }, [ticketRows, disputedTicketNosApproved]);
  // Full ticket rows per date, for the expanded per-day ticket table —
  // same grouping as ticketStatsByDate above, just keeping the rows instead
  // of collapsing them to counts.
  const ticketRowsByDate = useMemo(() => {
    const map = new Map<string, TicketAttendanceRow[]>();
    for (const r of ticketRows) {
      if (!map.has(r.scheduleDate)) map.set(r.scheduleDate, []);
      map.get(r.scheduleDate)!.push(r);
    }
    return map;
  }, [ticketRows]);
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
  const warnings = useMemo(() => attendance.filter((r) => r.status !== "present" && r.status !== "day-off"), [attendance]);
  // The entry effective as of the end of the viewed period — used to decide
  // whether this employee is currently paid hourly or a fixed salary, and
  // to show the right numbers for whichever it is.
  const currentEntry = useMemo(() => entryEffectiveOn(history, rangeEnd), [history, rangeEnd]);
  const isCurrentlyFixed = currentEntry?.compensationType === "fixed";
  // Fixed-salary pay doesn't depend on hours worked at all (see migration
  // 0118) — shows the monthly amount for this calendar-month estimate.
  // Hourly pay is still each day's hours at whichever rate was effective ON
  // that day, so a mid-month raise/promotion is handled automatically
  // instead of needing one flat rate for the whole period. Same per-day
  // regular/overtime split as the Attendance table's own Payment column
  // below (and AccountingDashboard.tsx's computeHoursMap) — kept in sync
  // so this tile's total always matches summing that column by hand.
  const computedPay = useMemo(() => {
    if (isCurrentlyFixed && currentEntry?.annualSalary) {
      const fixed = monthlySalary(currentEntry.annualSalary);
      return { regularPay: fixed, overtimePay: 0, total: fixed };
    }
    return attendance.reduce(
      (acc, r) => {
        const rate = rateEffectiveOn(history, r.date);
        const regular = Math.min(r.hoursWorked, REGULAR_HOURS_PER_DAY);
        const overtime = Math.max(0, r.hoursWorked - REGULAR_HOURS_PER_DAY);
        const regularPay = regular * rate;
        const overtimePay = overtime * rate * OVERTIME_MULTIPLIER;
        return { regularPay: acc.regularPay + regularPay, overtimePay: acc.overtimePay + overtimePay, total: acc.total + regularPay + overtimePay };
      },
      { regularPay: 0, overtimePay: 0, total: 0 }
    );
  }, [attendance, history, isCurrentlyFixed, currentEntry]);
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
              <p className="text-xl font-bold text-white mt-1">{totalHours.toFixed(1)}</p>
            </div>
            <div className="bg-slate-800/50 border border-white/10 rounded-lg p-3">
              <p className="text-xs text-slate-400 uppercase">Warnings</p>
              <p className="text-xl font-bold text-yellow-300 mt-1">{warnings.length}</p>
            </div>
            <div className="bg-slate-800/50 border border-white/10 rounded-lg p-3">
              <p className="text-xs text-slate-400 uppercase">Current Rate</p>
              {isCurrentlyFixed && currentEntry?.annualSalary ? (
                <p className="text-xl font-bold text-white mt-1">
                  ${currentEntry.annualSalary.toLocaleString()}/yr <span className="text-xs font-normal text-slate-400">(${perCutoffSalary(currentEntry.annualSalary).toFixed(2)}/cutoff)</span>
                </p>
              ) : (
                <p className="text-xl font-bold text-white mt-1">${rateNow.toFixed(2)}/hr</p>
              )}
            </div>
            <div className="bg-slate-800/50 border border-white/10 rounded-lg p-3">
              <p className="text-xs text-slate-400 uppercase">Est. Pay ({rangeStart} – {rangeEnd})</p>
              <p className="text-xl font-bold text-green-300 mt-1">${computedPay.total.toFixed(2)}</p>
              {!isCurrentlyFixed && (
                <p className="text-xs text-slate-400 mt-0.5">
                  ${computedPay.regularPay.toFixed(2)} regular + ${computedPay.overtimePay.toFixed(2)} overtime = ${computedPay.total.toFixed(2)}
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
                    = ${monthlySalary(Number(rateForm.annualSalary)).toFixed(2)}/month · ${perCutoffSalary(Number(rateForm.annualSalary)).toFixed(2)}/cutoff (semi-monthly)
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
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

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
                      <th className="text-right py-1.5">Hours</th>
                      <th className="text-right py-1.5">Overtime</th>
                      <th className="text-right py-1.5">Rate</th>
                      <th className="text-right py-1.5">Status</th>
                      <th className="text-right py-1.5">Payment</th>
                      <th className="text-center py-1.5">Scheduled</th>
                      <th className="text-center py-1.5">Checked In</th>
                      <th className="text-center py-1.5" title="Missing Check-In">Missing In</th>
                      <th className="text-center py-1.5" title="Missing Check-Out">Missing Out</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendance.map((row) => {
                      const dayIsFixed = entryEffectiveOn(history, row.date)?.compensationType === "fixed";
                      const edit = attendanceEdits[row.date];
                      const isRestDay = row.status === "day-off";
                      const regularHours = Math.min(row.hoursWorked, REGULAR_HOURS_PER_DAY);
                      const overtimeHours = Math.max(0, row.hoursWorked - REGULAR_HOURS_PER_DAY);
                      const dayRate = rateEffectiveOn(history, row.date);
                      const dayPayment = regularHours * dayRate + overtimeHours * dayRate * OVERTIME_MULTIPLIER;
                      const ticketStats = ticketStatsByDate.get(row.date);
                      const dayTicketRows = ticketRowsByDate.get(row.date) || [];
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
                              <input
                                type="time"
                                step="1"
                                value={edit?.checkOut ?? row.clockOut}
                                onChange={(e) => handleAttendanceEdit(row.date, "checkOut", e.target.value)}
                                className="w-24 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-slate-100 focus:outline-none focus:border-blue-500"
                              />
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
                        <td className="py-1.5 text-right text-slate-200">{row.hoursWorked ? regularHours.toFixed(1) : "—"}</td>
                        <td className={`py-1.5 text-right ${overtimeHours > 0 ? "text-orange-300 font-semibold" : "text-slate-500"}`}>{overtimeHours > 0 ? overtimeHours.toFixed(1) : "—"}</td>
                        <td className="py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                          {dayIsFixed ? (
                            <span className="text-slate-500" title="Fixed-salary pay doesn't vary by day — edit it from Salary History above instead">Fixed Salary</span>
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
                        <td className={`py-1.5 text-right font-semibold ${STATUS_COLOR[row.status]}`}>{STATUS_LABEL[row.status]}</td>
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
                          <td colSpan={14} className="px-2 py-3 bg-white/[0.02] border-b border-white/5">
                            {dayTicketRows.length === 0 ? (
                              <p className="text-[11px] text-slate-500 text-center py-2">No tickets scheduled this day.</p>
                            ) : (
                              <table className="w-full text-[11px]">
                                <thead>
                                  <tr className="text-slate-500">
                                    <th className="px-2 py-1 text-left">#</th>
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
                                          {mEntry?.legMileage != null ? `${mEntry.legMileage.toFixed(1)} mi` : <span className="text-slate-600">—</span>}
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
      </div>
    </div>
  );
}
