import { trainingWindow } from "@/lib/fieldStartDate";
import { centsSummaryTotal, groupCustomPayLines } from "@/lib/payRounding";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { X, Plus, Trash2, Loader2, Maximize2, FileText, StickyNote } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { buildOvertimeDisplay, type OvertimeDisplayWeek } from "@/lib/techOvertimeDisplay";
import { getEmployeeFileUrl, getPaystubForPeriod, type EmployeeFileRow } from "@/lib/supabase/employeeFiles";
import { addPayrollPeriodNote, deletePayrollPeriodNote, getPayrollPeriodNotes, type PayrollPeriodNote } from "@/lib/supabase/payrollPeriodNotes";
import type { EmployeePayrollRow } from "@/components/AccountingDashboard";
import { getAttendanceForRange, computeMealTimeCredit, splitRegularOvertimeWeekly, startOfWeekSunday, addDaysISO, CSR_WEEKLY_OVERTIME_THRESHOLD } from "@/lib/supabase/timecards";
import { getSalaryHistory, rateEffectiveOn, type SalaryEntryRow } from "@/lib/supabase/salary";
import { stateMinWageOn, COMMISSION_COUNTS_TOWARD_STATE_MIN } from "@/lib/stateMinWage";
import { computeStateHourlyMatch } from "@/lib/stateHourlyMatch";
import { isMealAlwaysPaidRole } from "@/lib/roleLabels";
import {
  REPAIR_TYPES,
  DEFAULT_REPAIR_TYPE,
  getTechRedoTickets,
  getTechOnHoldTickets,
  getTechAssistedTickets,
  getTechSecondTechTickets,
  getTechCustomPayItems,
  addTechCustomPayItem,
  updateTechCustomPayItem,
  deleteTechCustomPayItem,
  looksLikeReimbursementLabel,
  upsertResolvedTechRepairRate,
  type TechRepairRate,
  type TechRedoTicket,
  type TechAssistedTicket,
  type TechSecondTechTicket,
  type TechCustomPayItem,
} from "@/lib/supabase/techPayroll";
import { getCompanyEmployeeRequests, type EmployeeRequestRow } from "@/lib/supabase/employeeRequests";
import { getMileageEntries, mileageEffectiveTotal } from "@/lib/supabase/mileage";
import type { PayrollReviewAmounts } from "@/lib/supabase/payrollReviewBreakdowns";
import { getTechTaxLines, addTechTaxLine, updateTechTaxLine, deleteTechTaxLine, taxLineAmount, type TechTaxLine, type TechTaxMode } from "@/lib/supabase/techTaxLines";
import { toast } from "sonner";

interface Props {
  row: EmployeePayrollRow;
  /** profiles.employee_info.hireDate ("YYYY-MM-DD") — same field HR's Master List edits. Null when never set. */
  hireDate: string | null;
  periodStart: string;
  periodEnd: string;
  techRepairRates: TechRepairRate[];
  /** Re-fetches the parent's rate table (and everything derived from it) after an inline rate edit here. */
  onRatesChanged: () => void;
  /** Re-fetches the parent's tech_custom_pay_items (and the real grossPay
   *  derived from it — see AccountingDashboard.tsx's payrollRows) after a
   *  custom line is added/edited/removed here, so it counts toward the
   *  actual payroll total right away instead of only this modal's preview. */
  onCustomItemsChanged: () => void;
  onManualPayBlur: (
    row: EmployeePayrollRow,
    field: "ldtCount" | "mileage" | "trainingValue" | "owIncentivePct",
    value: string
  ) => Promise<void>;
  savingManualKey: string | null;
  /** Corrects an auto-counted category's Value (a REPAIR_TYPES entry or "Two Tech") — see tech_category_overrides, migration 0133. */
  onCategoryOverrideBlur: (profileId: string, category: string, value: string) => Promise<void>;
  savingCategoryOverrideKey: string | null;
  onClose: () => void;
  /** Office Payroll review wizard only — when set, a footer with "← Prev" / "Done" replaces the bare close. `onPrev` returns to the attendance detail step; `onDone` records the review mark and closes back to the Office Payroll table. */
  onPrev?: () => void;
  /** Receives this report's pay broken into Finance's summary columns (Reviewed Periods tab, migration 0392). */
  onDone?: (breakdown: PayrollReviewAmounts) => void;
  doneBusy?: boolean;
  /** Saves ("state") or clears ("company") this technician/period's Hourly + OT pay-mode override — see payroll_hourly_ot_overrides. When omitted, the Company/State comparison box shows read-only totals with no switch. */
  onSetHourlyOtMode?: (mode: "company" | "state", stateTotal: number, regularAmount?: number | null) => void | Promise<void>;
  /** The Regular $ part saved with this technician's State override (migration 0400), or null when not saved yet. */
  stateRegularAmount?: number | null;
  hourlyOtModeBusy?: boolean;
  /** True while any of the parent's period-scoped bulk fetches — including
   *  the ones a custom-line/manual-pay/category-override edit here
   *  triggers — are still in flight. Blocks the State-mode auto-refresh
   *  effect below from firing off a companyHourlyOtTotal/stateHourlyOtTotal
   *  computed from stale, pre-edit data. See AccountingDashboard.tsx's
   *  periodDataLoading. */
  periodDataSettling?: boolean;
  /** View only (Technical Assistant Director's Tech Payroll view): every input, rate, line and switch disabled. Pass no onSetHourlyOtMode / onDone with it so nothing saves on open either. */
  readOnly?: boolean;
  /** Set when this pay period's payroll cutoff has passed (Admin → Payroll
   *  Locks, migration 0469): every input is disabled like readOnly, but the
   *  paystub viewer and Internal Notes stay open. The text says when it locked. */
  lockedNotice?: string | null;
}

// Tech Activity Reports changed this page session that still need an
// Internal Note explaining why — keyed by technician + period, kept at
// module level so going ← Prev and back doesn't forget the edits.
const reportsNeedingNote = new Set<string>();

function fmt(amount: number) {
  return `$${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/**
 * The legacy "Tech Activity Report" — a per-technician payroll breakdown
 * opened from the Tech Payroll table's Action column. Restyled in this
 * app's dark theme rather than the legacy light UI, but keeps the same
 * report structure: an itemized Payment Item / Value / Pay Rate / Payment
 * table plus a stats + Redo/2nd-Tech side panel. The Activity Calendar
 * section of the legacy report isn't built here — see conversation history
 * for why (needs new daily-granularity data this app doesn't collect yet).
 *
 * Every rate cell here is directly editable (upsertResolvedTechRepairRate) —
 * unlike Tech Payroll Setup's rate editor, which always edits/creates a
 * specific (repairType, branch) row, this edits whichever rate is actually
 * in effect for this technician's branch, falling back to creating one
 * scoped to their branch if nothing configured applies yet.
 */
export function TechActivityReportModal({
  row,
  hireDate,
  periodStart,
  periodEnd,
  techRepairRates,
  onRatesChanged,
  onCustomItemsChanged,
  onManualPayBlur,
  savingManualKey,
  onCategoryOverrideBlur,
  savingCategoryOverrideKey,
  onClose,
  onPrev,
  onDone,
  doneBusy,
  onSetHourlyOtMode,
  stateRegularAmount,
  hourlyOtModeBusy,
  periodDataSettling,
  readOnly = false,
  lockedNotice = null,
}: Props) {
  const inputsLocked = readOnly || !!lockedNotice;
  const { employee, techManual, techCategoryCounts, techCarryover, ticketsAssigned, ticketsCompleted, workingDays, twoTechCount, hoursWorked, overtimeHours, hourlyRate, techHourlyPay, techHourlyPayStraight, techHourlyPayOtPremium, techWeightedRegularRate, techWeeklyOt, techGuaranteedSalaryTarget, techHolidayPremium, techIncludablePay, mileageRateOverride, carIqSwitch } = row;
  const branch = employee.assigned_branch || "";

  // Live Company-vs-State comparison for the Hourly Pay figure — fetched
  // fresh here (just this technician's own per-day attendance/state, plus
  // one seed week for the weekly-overtime split below), since
  // AccountingDashboard.tsx's payrollRows only has period-aggregate hours
  // with no per-day state granularity to check a floor against.
  const [periodDayInfo, setPeriodDayInfo] = useState<{ date: string; rawHours: number; state?: string }[]>([]);
  // Starts true: until the per-day attendance below has loaded, the State
  // match is computed off zero days (State = Company, Regular $ = 0), and the
  // auto-save effect further down must not save those placeholder numbers.
  // Starting false let it run on the very first render and lock in a bad
  // override (e.g. Joshua Sanders 10/25-11/07: 899.49 / 0), which then kept
  // Done disabled behind a permanent "Saving...".
  const [loadingStateComparison, setLoadingStateComparison] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoadingStateComparison(true);
    const mealAlwaysPaid = isMealAlwaysPaidRole(employee.role, employee.extraRoles);
    getAttendanceForRange(employee.id, startOfWeekSunday(periodStart), periodEnd)
      .then((rows) => {
        if (cancelled) return;
        setPeriodDayInfo(
          rows
            .filter((r) => r.hoursWorked > 0)
            .map((r) => ({
              date: r.date,
              // Same raw-hours-before-the-weekly-split input dailyHoursSplitByDate
              // uses — paid meal credit folded in BEFORE regular/OT get split,
              // matching the reference spreadsheet's "Regular Hr + Meal Time"
              // bucket instead of just the bare punch duration.
              rawHours: r.hoursWorked + computeMealTimeCredit({ checkIn: r.clockIn, checkOut: r.clockOut, mealStart: r.mealStart, mealEnd: r.mealEnd }, mealAlwaysPaid),
              state: r.state,
            }))
        );
      })
      .catch((err) => console.error("Failed to load per-day states for the pay comparison:", err))
      .finally(() => { if (!cancelled) setLoadingStateComparison(false); });
    return () => { cancelled = true; };
    // employee.role/extraRoles intentionally excluded — row.employee is a
    // freshly-built object every time AccountingDashboard.tsx re-renders
    // (payrollRows isn't memoized), so extraRoles gets a new array
    // reference on every render even when its contents never change. Depending
    // on it here restarted (and cancelled) this fetch before it could ever
    // finish, leaving periodDayInfo permanently empty. A technician's role
    // doesn't change while this modal is open, so employee.id is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee.id, periodStart, periodEnd]);

  // This technician's full rate-change history — lets the Min/OT floor
  // checks below apply whichever rate was ACTUALLY effective on each day
  // (rateEffectiveOn, same lookup the Attendance table already uses),
  // instead of `hourlyRate` (a single flat rate for the whole period) once
  // a mid-period rate change means different days were really paid at
  // different rates.
  const [salaryHistory, setSalaryHistory] = useState<SalaryEntryRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    getSalaryHistory(employee.id)
      .then((history) => { if (!cancelled) setSalaryHistory(history); })
      .catch((err) => console.error("Failed to load salary history for the pay comparison:", err));
    return () => { cancelled = true; };
  }, [employee.id]);
  const rateOnDate = (date: string): number => rateEffectiveOn(salaryHistory, date) || hourlyRate;

  // Real per-day regular/overtime split — same flat-40-hrs/week rule
  // AccountingDashboard.tsx/EmployeePayrollDetailModal.tsx use for
  // Technician-tier roles — so a day's overtime is only weighed against
  // THAT day's own state floor instead of a period-blended one.
  const dailySplit = useMemo(
    () => splitRegularOvertimeWeekly(periodDayInfo.map((d) => ({ date: d.date, rawHours: d.rawHours })), {}, 8, CSR_WEEKLY_OVERTIME_THRESHOLD),
    [periodDayInfo]
  );

  // The State match itself — lib/stateHourlyMatch.ts, the same code the
  // payroll table runs for every technician as payroll loads, so State mode
  // no longer waits for this report to be opened.
  const {
    stateMinFloor,
    companyRegularPayBlended,
    companyHourlyOtTotal,
    matchMin,
    commissionAppliedToFloor,
    requiredPremiumAfterMinMatch,
    stateOtFloorPremium,
    matchOt,
    stateHourlyOtTotal,
  } = useMemo(
    () =>
      computeStateHourlyMatch({
        days: periodDayInfo.map((d) => ({ date: d.date, ...(dailySplit.get(d.date) ?? { regular: 0, overtime: 0 }), state: d.state })),
        periodStart,
        periodEnd,
        rateOnDate,
        hoursWorked,
        overtimeHours,
        techWeightedRegularRate,
        techIncludablePay,
        techHourlyPayStraight,
        techHourlyPayOtPremium,
        techWeeklyOt,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [periodDayInfo, dailySplit, periodStart, periodEnd, salaryHistory, hourlyRate, hoursWorked, overtimeHours, techWeightedRegularRate, techIncludablePay, techHourlyPayStraight, techHourlyPayOtPremium, techWeeklyOt],
  );
  // Overtime hours this period (training days included) — the trainee check below uses it.
  const premiumHours = periodDayInfo.reduce((sum, day) => {
    if (day.date < periodStart || day.date > periodEnd) return sum;
    return sum + (dailySplit.get(day.date)?.overtime ?? 0);
  }, 0);
  // Whether the saved payroll_hourly_ot_overrides row (techHourlyPay, from
  // the parent) is currently a State-mode override rather than the flat
  // company calc — used both by the Company/State toggle UI below and by
  // the auto-refresh effect right after it.
  const appliedIsState = Math.abs(techHourlyPay - companyHourlyOtTotal) > 0.005;
  const stateMatchRequired = stateHourlyOtTotal > companyHourlyOtTotal + 0.005;
  // The Regular $ part of the State total (regular hours at the company rate
  // + the state regular-hours match) — saved with the override (migration
  // 0400) so the dashboard's gross pay rounds Regular $ and OT $ separately,
  // exactly like Total Payment here.
  const stateRegularShare = companyRegularPayBlended + matchMin;
  const regularBackfillTried = useRef(false);
  // The Regular $ part only blocks Done until its one fill-in attempt has
  // been made — if that save doesn't stick, the TOTAL (what's actually paid)
  // is still right, so Done must not stay disabled forever behind "Saving...".
  const stateSavePending = !!onSetHourlyOtMode && stateMatchRequired &&
    (Math.abs(techHourlyPay - stateHourlyOtTotal) > 0.005 ||
      (!regularBackfillTried.current &&
        (stateRegularAmount == null || Math.abs(stateRegularAmount - stateRegularShare) > 0.0005)));
  const lastStateSaveAttempt = useRef("");

  // Automatically select State when a match is due, and keep saved State
  // amounts current after edits. Wait for period data and pending saves.
  useEffect(() => {
    if (!onSetHourlyOtMode) return;
    if (!appliedIsState && !stateMatchRequired) return;
    if (hourlyOtModeBusy || loadingStateComparison) return;
    // A custom line / training value / category count edit made from this
    // very modal refetches the parent's bulk data (techIncludablePay,
    // techWeightedRegularRate, and everything derived from them) on its own
    // async round trip — stateHourlyOtTotal here can still be computed off
    // the PRE-edit row for a moment after the edit resolves. Auto-saving
    // during that gap would lock in a transitional number, then get
    // overwritten again once the real refetch lands a beat later — visibly
    // "changing on its own" exactly like the stale-override bug this effect
    // exists to fix. Wait for every in-flight period load to settle first.
    if (periodDataSettling) return;
    const totalDrifted = Math.abs(techHourlyPay - stateHourlyOtTotal) > 0.005;
    // An override saved before migration 0400 (or by the detail step's Next,
    // which doesn't know the split) has no Regular $ part yet — fill it in
    // once per open.
    const regularMissing =
      stateRegularAmount !== undefined &&
      (stateRegularAmount == null || Math.abs(stateRegularAmount - stateRegularShare) > 0.0005) &&
      !regularBackfillTried.current;
    if (!totalDrifted && !regularMissing) {
      lastStateSaveAttempt.current = "";
      return;
    }
    const signature = JSON.stringify([periodStart, periodEnd, techHourlyPay, stateHourlyOtTotal, stateRegularAmount, stateRegularShare]);
    if (lastStateSaveAttempt.current === signature) return;
    lastStateSaveAttempt.current = signature;
    if (regularMissing) regularBackfillTried.current = true;
    void onSetHourlyOtMode("state", stateHourlyOtTotal, stateRegularShare);
    // Keyed on the two numbers being compared, not on onSetHourlyOtMode (a
    // fresh inline closure from the parent every render) — the guard above
    // makes this idempotent once the override catches up, so re-running it
    // on every parent render would just be wasted work, not a correctness
    // issue either way.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateHourlyOtTotal, techHourlyPay, appliedIsState, stateMatchRequired, hourlyOtModeBusy, loadingStateComparison, periodDataSettling, stateRegularAmount, stateRegularShare]);

  // Trainee daily $100 guarantee, recomputed HERE against each day's real
  // EFFECTIVE rate (state floor if higher than the company rate on file —
  // same per-day floor lookup as stateMinFloor above), rather than using
  // row.techTraineeMatch (AccountingDashboard.tsx), which has no per-day
  // state data and sizes the shortfall against the bare company rate. That
  // understates a trainee's actual pay on any day a state floor bumped
  // their rate up — e.g. Bilal Poole, 2026-08-28: Virginia's $12.77 floor
  // already pays him $153.72 for the day (well past $100), but the
  // Company-only calc sees only 12.037 hrs * $7.25 = $87.27 and manufactures
  // a phantom $12.73 shortfall against the $100 target.
  const TRAINEE_DAILY_MATCH_TARGET = 100;
  const techTraineeMatch = useMemo(() => {
    const window = trainingWindow(employee.hrTrainingStart, employee.hrFieldStart, hireDate, employee.isTrainee);
    const trainingEndDate = window.end;
    if (!trainingEndDate) return 0;
    let match = 0;
    for (const d of periodDayInfo) {
      if (d.date < periodStart || d.date > periodEnd) continue;
      if (window.start && d.date < window.start) continue;
      if (d.date > trainingEndDate) continue;
      const split = dailySplit.get(d.date) ?? { regular: 0, overtime: 0 };
      const dayHours = split.regular + split.overtime;
      if (dayHours <= 0) continue;
      const companyRate = rateOnDate(d.date);
      const floorRate = stateMinWageOn(d.state, d.date);
      const effectiveRate = floorRate != null ? Math.max(floorRate, companyRate) : companyRate;
      // The day's overtime premium counts toward the $100 too (training-day
      // OT now earns it — see premiumHours), so the guarantee only tops up
      // what the day's full pay still falls short by.
      const actualDailyPay = dayHours * effectiveRate + split.overtime * 0.5 * Math.max(effectiveRate, techWeightedRegularRate);
      if (actualDailyPay < TRAINEE_DAILY_MATCH_TARGET) {
        match += TRAINEE_DAILY_MATCH_TARGET - actualDailyPay;
      }
    }
    return match;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodDayInfo, dailySplit, periodStart, periodEnd, hireDate, employee.hrTrainingStart, employee.hrFieldStart, employee.isTrainee, salaryHistory, hourlyRate, techWeightedRegularRate]);

  // The Guaranteed Minimum Salary Match, recomputed HERE (rather than using
  // row.techGuaranteedSalaryMatch from AccountingDashboard.tsx) because that
  // module has no per-day attendance/state data to compute companyHourlyOtTotal
  // itself for every technician — only this modal, opened for one technician
  // at a time, ever fetches that; this local copy has to match
  // AccountingDashboard.tsx's formula, not diverge from it.
  //
  // Keyed off companyHourlyOtTotal, NOT stateHourlyOtTotal — company policy
  // (2026-09-23) treats the state minimum-wage floor match as separate money
  // that doesn't count toward satisfying the salary guarantee; it's still
  // paid in full via the Hourly Pay line/Min Wage Floor Check box above once
  // State mode is applied, just not counted toward this comparison. See the
  // matching comment in AccountingDashboard.tsx's own copy of this calc.
  //
  // techHolidayPremium is folded into the earned baseline too, for the same
  // reason as in AccountingDashboard.tsx's own copy of this calc — it's
  // paid as its own line further down (techGrossTotal), so leaving it out
  // here sizes the match as if it hadn't been earned yet and overpays by
  // exactly that amount whenever the guarantee triggers.
  // Earned Toward Minimum ("A" — Company Hourly/OT + Includable + Holiday
  // Premium) — broken out as its own value so the match's derivation
  // (Per-Cutoff Minimum minus this) is visible on the report, not just the
  // final Match to pay figure.
  const techEarnedTowardMinimum = companyHourlyOtTotal + techIncludablePay + techHolidayPremium;
  const techGuaranteedSalaryMatch = techGuaranteedSalaryTarget > 0
    ? Math.max(techGuaranteedSalaryTarget - techEarnedTowardMinimum, 0)
    : 0;

  // Temporary, NOT persisted — lets HR type in a what-if Completed Tickets
  // count to sanity-check the payroll math (Payment column, Ratio,
  // Avg Daily Completion, Subtotal/Total) without needing real ticket data
  // to produce a non-zero count. Resets whenever this modal moves to a
  // different technician/period so a test number never bleeds across
  // reports.
  const [completedTicketsOverride, setCompletedTicketsOverride] = useState<number | null>(null);
  useEffect(() => setCompletedTicketsOverride(null), [employee.id, row]);
  const effectiveTicketsCompleted = completedTicketsOverride ?? ticketsCompleted;

  const techRateFor = (category: string): number => {
    const exact = techRepairRates.find((r) => r.repairType === category && r.branch === branch);
    if (exact) return exact.amount;
    const anyBranch = techRepairRates.find((r) => r.repairType === category && !r.branch);
    return anyBranch ? anyBranch.amount : 0;
  };

  const [redoTickets, setRedoTickets] = useState<TechRedoTicket[]>([]);
  const [onHoldTickets, setOnHoldTickets] = useState<TechRedoTicket[]>([]);
  const [assistedTickets, setAssistedTickets] = useState<TechAssistedTicket[]>([]);
  const [secondTechTickets, setSecondTechTickets] = useState<TechSecondTechTicket[]>([]);
  const [customItems, setCustomItems] = useState<TechCustomPayItem[]>([]);
  // One number per distinct work_date this technician drove in the period
  // (mileageEffectiveTotal — a day's several mileage_entries rows, one per
  // ticket, all share the same day total, so this is deduped by date, not
  // a raw entry count) — feeds the >200/>300/>400 mile day-count panel.
  const [mileageDayTotals, setMileageDayTotals] = useState<number[]>([]);
  const [loadingExtras, setLoadingExtras] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingExtras(true);
    const nameKey = employee.full_name.trim().toLowerCase();
    Promise.all([
      getTechRedoTickets(periodStart, periodEnd),
      getTechOnHoldTickets(periodStart, periodEnd),
      getTechAssistedTickets(periodStart, periodEnd),
      getTechSecondTechTickets(periodStart, periodEnd),
      getTechCustomPayItems(employee.id, periodStart, periodEnd),
      getMileageEntries(branch),
    ])
      .then(([redoByTech, onHoldByTech, assistedByTech, secondTechByTech, custom, mileageEntries]) => {
        if (cancelled) return;
        setRedoTickets(redoByTech.get(nameKey) ?? []);
        setOnHoldTickets(onHoldByTech.get(nameKey) ?? []);
        setAssistedTickets(assistedByTech.get(nameKey) ?? []);
        setSecondTechTickets(secondTechByTech.get(nameKey) ?? []);
        setCustomItems(custom);
        // Existing lines whose label says reimbursement/deduction but are
        // still Includable get corrected (see looksLikeReimbursementLabel).
        const misflagged = inputsLocked ? [] : custom.filter((i) => i.isWageIncludable && looksLikeReimbursementLabel(i.label));
        if (misflagged.length > 0) {
          void Promise.all(misflagged.map((i) => updateTechCustomPayItem(i.id, { isWageIncludable: false })))
            .then(() => {
              if (cancelled) return;
              const ids = new Set(misflagged.map((i) => i.id));
              setCustomItems((prev) => prev.map((i) => (ids.has(i.id) ? { ...i, isWageIncludable: false } : i)));
              onCustomItemsChanged();
              toast.info(`Switched ${misflagged.length} line${misflagged.length === 1 ? "" : "s"} to Reimbursement: ${misflagged.map((i) => i.label).join(", ")}`);
            })
            .catch((err) => console.error("Failed to correct reimbursement lines:", err));
        }
        const totalByDate = new Map<string, number>();
        for (const e of mileageEntries) {
          if (e.deletedAt) continue;
          if (e.profileId ? e.profileId !== employee.id : (e.technicianName || "").trim().toLowerCase() !== nameKey) continue;
          if (e.workDate < periodStart || e.workDate > periodEnd) continue;
          totalByDate.set(e.workDate, mileageEffectiveTotal(e));
        }
        setMileageDayTotals(Array.from(totalByDate.values()));
      })
      .catch((err) => console.error("Failed to load Tech Activity Report extras:", err))
      .finally(() => { if (!cancelled) setLoadingExtras(false); });
    return () => { cancelled = true; };
  }, [employee.id, employee.full_name, periodStart, periodEnd, branch]);

  const mileageThresholdCounts = useMemo(
    () => [200, 300, 400].map((threshold) => ({ threshold, count: mileageDayTotals.filter((m) => m > threshold).length })),
    [mileageDayTotals],
  );

  // Approved Dispute Tickets — every payroll_dispute approved for THIS
  // technician, regardless of the period currently selected above. Shown
  // unscoped (not filtered to periodStart/periodEnd) since a dispute's own
  // linked period (set at submit time — see MobilePayrollDisputeView) can
  // easily differ from whatever period this report happens to be open to,
  // which is exactly what made a just-approved dispute look "missing"
  // before this list existed.
  const [approvedDisputes, setApprovedDisputes] = useState<EmployeeRequestRow[]>([]);
  const [loadingDisputes, setLoadingDisputes] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoadingDisputes(true);
    getCompanyEmployeeRequests()
      .then((rows) => {
        if (cancelled) return;
        setApprovedDisputes(
          rows.filter((r) => r.requestType === "payroll_dispute" && r.status === "approved" && r.profileId === employee.id)
        );
      })
      .catch((err) => console.error("Failed to load approved dispute tickets:", err))
      .finally(() => { if (!cancelled) setLoadingDisputes(false); });
    return () => { cancelled = true; };
  }, [employee.id]);

  const [savingRateKey, setSavingRateKey] = useState<string | null>(null);
  const handleRateBlur = async (category: string, value: string) => {
    const amount = Number(value) || 0;
    if (amount === techRateFor(category)) return;
    setSavingRateKey(category);
    try {
      await upsertResolvedTechRepairRate(techRepairRates, category, branch, amount);
      markChanged();
      onRatesChanged();
    } catch (err) {
      alert(`Failed to save rate: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingRateKey(null);
    }
  };

  const [savingCustomId, setSavingCustomId] = useState<string | null>(null);
  const handleAddCustomLine = async () => {
    try {
      const created = await addTechCustomPayItem(employee.id, periodStart, periodEnd, customItems.length);
      setCustomItems((prev) => [...prev, created]);
      markChanged();
      onCustomItemsChanged();
    } catch (err) {
      alert(`Failed to add line: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };
  // Car IQ History (migration 0319) detected this technician's Car IQ
  // status changed partway through the period — mileageRateOverride's
  // single rate above only covers one side of that switch, so the OTHER
  // side's mileage needs its own line at its own rate. There's no reliable
  // day-by-day mileage breakdown to auto-split the existing total by date
  // (see AccountingDashboard.tsx's carIqSwitch computation), so this adds a
  // blank, pre-labeled/pre-rated custom line and leaves the actual mileage
  // figure for whoever's running payroll to type in, same as the regular
  // Mileage figure always has been. Not wage-includable, matching the
  // regular Mileage line (a reimbursement, not part of the FLSA weighted
  // rate — see techIncludablePay, AccountingDashboard.tsx).
  const handleAddCarIqSplitLine = async () => {
    if (!carIqSwitch) return;
    try {
      const created = await addTechCustomPayItem(employee.id, periodStart, periodEnd, customItems.length);
      const label = `Mileage (Car IQ $${carIqSwitch.rateAfter.toFixed(2)}/mi, from ${carIqSwitch.date})`;
      await updateTechCustomPayItem(created.id, { label, rate: carIqSwitch.rateAfter, isWageIncludable: false });
      setCustomItems((prev) => [...prev, { ...created, label, rate: carIqSwitch.rateAfter, isWageIncludable: false }]);
      markChanged();
      onCustomItemsChanged();
    } catch (err) {
      alert(`Failed to add Car IQ mileage line: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };
  // Sunday workweeks this period touches — a custom line can be tagged
  // with the one it was earned in (migration 0383) so it feeds that week's
  // own FLSA regular rate instead of being spread over the period.
  const periodWeeks = useMemo(() => {
    const weeks: string[] = [];
    if (!periodStart || !periodEnd) return weeks;
    for (let w = startOfWeekSunday(periodStart); w <= periodEnd; w = addDaysISO(w, 7)) weeks.push(w);
    return weeks;
  }, [periodStart, periodEnd]);
  const weekLabel = (weekStart: string) => `Wk ${Number(weekStart.slice(5, 7))}/${Number(weekStart.slice(8, 10))}`;

  // Paystub side-by-side (Accounting -> Paystubs upload for this period) and
  // Accounting's internal notes on this period (migration 0465). Hidden in
  // the view-only report.
  const { role: myRole, extraRoles: myExtraRoles } = useAuth();
  // Internal Notes can't be edited; only Admin / SuperAdmin delete them
  // (migration 0470). IT carries Super Admin.
  const canDeleteNotes = [myRole, ...(myExtraRoles ?? [])].some((r) => r === "ADMIN" || r === "SUPERADMIN" || r === "SUPERSUPERADMIN" || r === "IT");

  const [paystub, setPaystub] = useState<EmployeeFileRow | null>(null);
  const [paystubUrl, setPaystubUrl] = useState<string | null>(null);
  const [paystubLoading, setPaystubLoading] = useState(!readOnly);
  const [paystubError, setPaystubError] = useState<string | null>(null);
  const [comparePaystub, setComparePaystub] = useState(false);
  useEffect(() => {
    if (readOnly) return;
    let cancelled = false;
    setPaystubLoading(true);
    setPaystubError(null);
    setPaystub(null);
    setPaystubUrl(null);
    getPaystubForPeriod(employee.id, periodStart, periodEnd)
      .then(async (file) => {
        if (cancelled) return;
        setPaystub(file);
        if (file) {
          const url = await getEmployeeFileUrl(file.storagePath);
          if (!cancelled) setPaystubUrl(url);
        }
      })
      .catch((err) => { if (!cancelled) setPaystubError(err instanceof Error ? err.message : "Couldn't load the paystub."); })
      .finally(() => { if (!cancelled) setPaystubLoading(false); });
    return () => { cancelled = true; };
  }, [employee.id, periodStart, periodEnd, readOnly]);

  const [notes, setNotes] = useState<PayrollPeriodNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(!readOnly);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  // Any change made on this report needs an Internal Note saying why before
  // Done — cleared by the next note saved, set again by any later change.
  const noteKey = `${employee.id}|${periodStart}|${periodEnd}`;
  const [needsNote, setNeedsNote] = useState(() => reportsNeedingNote.has(noteKey));
  useEffect(() => { setNeedsNote(reportsNeedingNote.has(noteKey)); }, [noteKey]);
  const noteInputRef = useRef<HTMLTextAreaElement>(null);
  const markChanged = () => {
    if (inputsLocked) return;
    reportsNeedingNote.add(noteKey);
    setNeedsNote(true);
  };
  const loadNotes = async () => {
    try {
      setNotes(await getPayrollPeriodNotes(employee.id, periodStart, periodEnd));
      setNotesError(null);
    } catch (err) {
      setNotesError(err instanceof Error ? err.message : "Couldn't load notes.");
    } finally {
      setNotesLoading(false);
    }
  };
  useEffect(() => {
    if (readOnly) return;
    setNotesLoading(true);
    void loadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee.id, periodStart, periodEnd, readOnly]);
  const saveNote = async () => {
    if (!noteDraft.trim() || savingNote) return;
    setSavingNote(true);
    try {
      await addPayrollPeriodNote(employee.id, periodStart, periodEnd, noteDraft);
      reportsNeedingNote.delete(noteKey);
      setNeedsNote(false);
      setNoteDraft("");
      await loadNotes();
    } catch (err) {
      setNotesError(err instanceof Error ? err.message : "Couldn't save the note.");
    } finally {
      setSavingNote(false);
    }
  };
  const removeNote = async (id: string) => {
    if (!confirm("Delete this note?")) return;
    try {
      await deletePayrollPeriodNote(id);
      await loadNotes();
    } catch (err) {
      setNotesError(err instanceof Error ? err.message : "Couldn't delete the note.");
    }
  };
  const fmtStubDate = (d: string | null) => (d ? `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}` : "\u2014");

  // Company-mode display split of the Hourly + OT figure (display only — the
  // amounts paid, Total Payment and Reviewed Periods are unchanged):
  //   Hourly Pay               = regular hours × flat rate
  //   Overtime Pay (week)      = OT hours × base rate × 1.5
  //   OT on Incentive Pay      = OT hours × (weekly regular rate − base rate) × 0.5
  // which adds up to the same straight-time + weighted 0.5x premium as before
  // (OT hrs × base + OT hrs × regular rate × 0.5). Rounding: each week's two
  // lines add up to its rounded straight-time + rounded premium, and Hourly
  // Pay takes the rounded straight-time total minus those, so the lines sum
  // to exactly what the old Hourly Pay + OT Premium lines showed.
  const overtimeDisplay = buildOvertimeDisplay({
    hourlyRate,
    hoursWorked,
    overtimeHours,
    straightPay: techHourlyPayStraight,
    otPremium: techHourlyPayOtPremium,
    weightedRegularRate: techWeightedRegularRate,
    weeklyOt: techWeeklyOt,
    paidLeaveHours: row.techPaidLeaveHours,
    paidLeavePay: row.techPaidLeavePay,
  });
  const incentiveDetail = (w: OvertimeDisplayWeek) =>
    w.straightPay != null && w.weekHours != null
      ? `Week of ${w.label.slice(3)}: regular rate = (straight-time ${fmt(w.straightPay)} + includable ${fmt(w.includablePay ?? 0)}) ÷ ${w.weekHours.toFixed(3)} hrs = ${fmt(w.regularRate)}/hr. Incentive pay raises the overtime rate above 1.5 × the base rate; this line is that difference. Includable pay counts in the week its custom line is tagged with; untagged pay (and ticket pay) is spread over the weeks by hours.`
      : "Overtime premium on incentive pay: the FLSA weighted regular rate (straight-time wages plus this period's includable incentive/bonus pay, divided by total hours) above the flat hourly rate, × 0.5."
  const handleCustomLineBlur = async (item: TechCustomPayItem, fields: { label?: string; value?: number; rate?: number; isWageIncludable?: boolean; workWeekStart?: string | null }) => {
    // Typing a reimbursement/deduction label switches the line to
    // Reimbursement (unless the type was picked in this same edit).
    if (fields.label !== undefined && fields.isWageIncludable === undefined && item.isWageIncludable && looksLikeReimbursementLabel(fields.label)) {
      fields = { ...fields, isWageIncludable: false };
    }
    setSavingCustomId(item.id);
    try {
      await updateTechCustomPayItem(item.id, fields);
      setCustomItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...fields } : i)));
      if ((Object.keys(fields) as (keyof typeof fields)[]).some((k) => (item[k] ?? null) !== (fields[k] ?? null))) markChanged();
      onCustomItemsChanged();
    } catch (err) {
      alert(`Failed to save line: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingCustomId(null);
    }
  };
  const handleDeleteCustomLine = async (item: TechCustomPayItem) => {
    setSavingCustomId(item.id);
    try {
      await deleteTechCustomPayItem(item.id);
      setCustomItems((prev) => prev.filter((i) => i.id !== item.id));
      markChanged();
      onCustomItemsChanged();
    } catch (err) {
      alert(`Failed to remove line: ${err instanceof Error ? err.message : "Unknown error"}`);
      setSavingCustomId(null);
    }
  };

  // Tax lines (migration 0395) — below Total Payment, display-only: they
  // give Net Pay After Tax and never change Total Payment or anything above.
  const [taxLines, setTaxLines] = useState<TechTaxLine[]>([]);
  const [savingTaxId, setSavingTaxId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setTaxLines([]);
    getTechTaxLines(employee.id, periodStart, periodEnd).then((lines) => {
      if (!cancelled) setTaxLines(lines);
    });
    return () => {
      cancelled = true;
    };
  }, [employee.id, periodStart, periodEnd]);
  const handleAddTaxLine = async () => {
    try {
      const created = await addTechTaxLine(employee.id, periodStart, periodEnd, taxLines.length);
      setTaxLines((prev) => [...prev, created]);
      markChanged();
    } catch (err) {
      alert(`Failed to add tax line: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };
  const handleTaxLineChange = async (line: TechTaxLine, fields: { label?: string; mode?: TechTaxMode; amount?: number }) => {
    setSavingTaxId(line.id);
    try {
      await updateTechTaxLine(line.id, fields);
      setTaxLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, ...fields } : l)));
      markChanged();
    } catch (err) {
      alert(`Failed to save tax line: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingTaxId(null);
    }
  };
  const handleDeleteTaxLine = async (line: TechTaxLine) => {
    setSavingTaxId(line.id);
    try {
      await deleteTechTaxLine(line.id);
      setTaxLines((prev) => prev.filter((l) => l.id !== line.id));
      markChanged();
    } catch (err) {
      alert(`Failed to remove tax line: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingTaxId(null);
    }
  };

  // Includes DEFAULT_REPAIR_TYPE so its $ still counts toward the totals below
  // (it was already part of Total Net before this report existed) — just not
  // rendered as its own row, since almost every completed ticket falls into
  // it and it isn't part of the legacy report this is modeled on.
  const categoryPayments = useMemo(
    () => REPAIR_TYPES.map((type) => ({ type, count: techCategoryCounts[type] ?? 0, rate: techRateFor(type), payment: (techCategoryCounts[type] ?? 0) * techRateFor(type) })),
    [techCategoryCounts, techRepairRates, branch]
  );
  const visibleCategoryPayments = categoryPayments.filter((c) => c.type !== DEFAULT_REPAIR_TYPE);
  const twoTechRate = techRateFor("Two Tech");
  const twoTechPayment = twoTechCount * twoTechRate;
  const customLinesTotal = customItems.reduce((s, i) => s + i.value * i.rate, 0);
  // Confirmed late ticket completions (see late_ticket_completions /
  // LateTicketCompletionModal.tsx) not yet paid out — already folded into
  // ticketsCompleted above (so Completed Tickets treats them like any
  // other completed ticket), priced here at today's rate and shown ONE ROW
  // PER TICKET below (never grouped by repair type) so it's obvious both
  // which specific ticket this is and that it came from an earlier,
  // already-closed period rather than this one's own work.
  const carryoverTotal = techCarryover.reduce((s, co) => s + techRateFor(co.repairType), 0);

  // ticketsCompleted (from the parent row) is already net of both redo and
  // on-hold exclusions (getTechCompletedRepairCounts excludes redo'd and
  // payroll-on-hold tickets outright). Redo gets pulled out as its own row
  // above ("Redo Reduction") rather than folded into this row's arithmetic —
  // a redo ticket isn't a pay-eligibility question the way an on-hold ticket
  // is, it's just not this technician's ticket to be paid for at all. So
  // completedBeforeHold ("already excludes redo, not yet excludes on hold")
  // is this row's own gross, and only the on-hold subtraction shows here.
  const completedBeforeHold = ticketsCompleted + onHoldTickets.length;
  const completedTicketsRate = techRateFor("Completed Tickets");
  const completedTicketsPayment = effectiveTicketsCompleted * completedTicketsRate;
  // 0 by default (see BASE_RATE_TYPES) — only pays anything once a rate is
  // configured for a company that wants a consolation amount per redo.
  const redoReductionRate = techRateFor("Redo Reduction");
  const redoReductionPayment = redoTickets.length * redoReductionRate;

  const subtotal =
    categoryPayments.reduce((s, c) => s + c.payment, 0) +
    techManual.ldtPay + techManual.mileagePay + techManual.trainingPay +
    twoTechPayment + completedTicketsPayment + redoReductionPayment + customLinesTotal + carryoverTotal + row.techHourlyPay + techGuaranteedSalaryMatch + techHolidayPremium + techTraineeMatch;
  const owIncentivePay = (techManual.owIncentivePct / 100) * subtotal;

  // Finance's payroll-summary columns (Accounting Dashboard → Reviewed
  // Periods, saved on Done). They add up to totalPayment:
  // regular + OT + bonus + commission + reimbursements + salary match
  // − deductions − pre-tax insurance.
  const reviewBreakdown = useMemo((): PayrollReviewAmounts => {
    const lines = groupCustomPayLines(customItems);
    const bonus = owIncentivePay + lines.bonus;
    const customCommission = lines.commission;
    const deduction = lines.deduction;
    const pretaxInsurance = lines.pretaxInsurance;
    const reimb = techManual.mileagePay + lines.reimbursement;
    const commission =
      categoryPayments.reduce((s, c) => s + c.payment, 0) + techManual.ldtPay + techManual.trainingPay +
      twoTechPayment + completedTicketsPayment + redoReductionPayment + carryoverTotal + customCommission;
    // row.techHourlyPay is what's actually paid for hours (the State total
    // when State mode is applied). Regular = regular hours at the company
    // rate + the state regular match; everything else in it is OT.
    const isFixedPay = row.compensationType === "fixed";
    const regularHourly = isFixedPay ? row.techHourlyPay : companyRegularPayBlended + (appliedIsState ? matchMin : 0);
    return {
      regularPay: regularHourly + techTraineeMatch + techHolidayPremium,
      otPay: isFixedPay ? 0 : row.techHourlyPay - regularHourly,
      bonus,
      commission,
      ptoPay: 0,
      deduction,
      mileageOtherReimb: reimb,
      pretaxInsurance,
      salaryMatch: techGuaranteedSalaryMatch,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owIncentivePay, customItems, techManual, categoryPayments, twoTechPayment, completedTicketsPayment, redoReductionPayment, carryoverTotal, row.techHourlyPay, row.compensationType, companyRegularPayBlended, appliedIsState, matchMin, techTraineeMatch, techHolidayPremium, techGuaranteedSalaryMatch]);

  // Total Payment: each summary column rounded to the cent, then added up —
  // how Finance's summary (and so Payroll History and the payslip) totals
  // it; rounding only the grand total could land a cent off (Joshua Malloch
  // 9/27–10/10: $2,323.38 here vs $2,323.37). The dashboard's gross pay
  // rounds the same way.
  const totalPayment = centsSummaryTotal(reviewBreakdown);

  const ratioPct = ticketsAssigned > 0 ? (effectiveTicketsCompleted / ticketsAssigned) * 100 : 0;
  const avgDailyCompletion = effectiveTicketsCompleted / Math.max(1, workingDays);
  const avgDailyMiles = techManual.mileage / Math.max(1, workingDays);

  // [appearance:textfield] + the two ::-webkit-*-spin-button rules hide the
  // native up/down increment/decrement arrows every type="number" input here
  // otherwise shows — purely cosmetic, doesn't affect typing/blur-to-save.
  const rateCellClass = "w-20 bg-slate-800/50 border border-white/10 rounded px-1.5 py-1 text-right text-xs text-white focus:border-blue-500 focus:outline-none disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`bg-slate-900 border border-white/15 rounded-xl w-full ${comparePaystub ? "max-w-[98vw] h-[94vh] max-h-[94vh]" : "max-w-6xl max-h-[90vh]"} flex flex-col shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-slate-950 rounded-t-xl">
          <div>
            <p className="font-semibold text-white">Tech Activity Report of {employee.full_name}</p>
            <p className="text-xs text-slate-400">
              {periodStart} – {periodEnd}{branch ? ` · ${branch}` : ""}
              {readOnly && <span className="ml-2 rounded border border-white/15 bg-white/5 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-slate-300">View only</span>}
              {!readOnly && lockedNotice && <span className="ml-2 rounded border border-red-400/30 bg-red-500/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-red-300">🔒 Locked</span>}
            </p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 transition">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5">
          {!readOnly && lockedNotice && (
            <p className="mb-4 rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              🔒 {lockedNotice} Nothing on this report can be changed. You can still view the paystub and add Internal Notes; an Admin can reopen the period from Admin → Payroll Locks.
            </p>
          )}
          <fieldset disabled={inputsLocked} className="m-0 min-w-0 border-0 p-0">
          <div className={`grid gap-5 ${comparePaystub ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : "lg:grid-cols-[1fr_320px]"}`}>
            {/* Payroll Detail Report */}
            <div className="overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full text-sm min-w-[520px]">
                <thead>
                  <tr className="bg-white/5 border-b border-white/10">
                    <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase">Payment Item</th>
                    <th className="px-3 py-2 text-right text-xs text-slate-400 uppercase">Value</th>
                    <th className="px-3 py-2 text-right text-xs text-slate-400 uppercase">Pay Rate</th>
                    <th className="px-3 py-2 text-right text-xs text-slate-400 uppercase">Payment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  <tr title="Tickets flagged tickets.redo (a manager-flagged re-dispatch of a prior failed repair) are pulled out here and never count toward this technician's Completed Tickets at all — see the Redo list on the right for exactly which ones. The rate is 0 by default; set one only if this company pays a consolation amount per redo.">
                    <td className="px-3 py-2 text-slate-300">Redo Reduction</td>
                    <td className="px-3 py-2 text-right text-slate-300">{redoTickets.length}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {savingRateKey === "Redo Reduction" && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                        <input
                          key={`Redo Reduction:${redoReductionRate}`}
                          type="number" min={0} step={0.01}
                          defaultValue={redoReductionRate}
                          disabled={savingRateKey === "Redo Reduction"}
                          onBlur={(e) => handleRateBlur("Redo Reduction", e.target.value)}
                          className={rateCellClass}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-200">{fmt(redoReductionPayment)}</td>
                  </tr>
                  <tr title="Completed, non-redo tickets minus any currently On Hold for payroll via the Mileage tab — a manual hold, or the automatic rule that holds pay until mileage photos are uploaded. This rate is paid flat on every remaining one, in addition to each ticket's own repair-type rate below. See the On Hold panel on the right for exactly which tickets those are — a hold is reversible and moves back into this count once released.">
                    <td className="px-3 py-2 text-slate-300">Completed Tickets</td>
                    <td className="px-3 py-2 text-right text-slate-300">
                      <div className="flex items-center justify-end gap-1.5">
                        <input
                          type="number" min={0} step={1}
                          value={completedTicketsOverride ?? ticketsCompleted}
                          onChange={(e) => setCompletedTicketsOverride(e.target.value === "" ? 0 : Number(e.target.value))}
                          className={`${rateCellClass} ${completedTicketsOverride !== null ? "border-amber-500/60 text-amber-300" : ""}`}
                        />
                        {completedTicketsOverride !== null && (
                          <button type="button" onClick={() => setCompletedTicketsOverride(null)} className="text-[10px] text-slate-500 hover:text-slate-300 underline">
                            reset
                          </button>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        real: {completedBeforeHold} − {onHoldTickets.length} = {ticketsCompleted}
                        {completedTicketsOverride !== null && <span className="text-amber-400"> (testing {completedTicketsOverride}, not saved)</span>}
                      </div>
                      {onHoldTickets.length > 0 && (
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          {onHoldTickets.length} on hold — missing photos or a manual hold
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {savingRateKey === "Completed Tickets" && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                        <input
                          key={`Completed Tickets:${completedTicketsRate}`}
                          type="number" min={0} step={0.01}
                          defaultValue={completedTicketsRate}
                          disabled={savingRateKey === "Completed Tickets"}
                          onBlur={(e) => handleRateBlur("Completed Tickets", e.target.value)}
                          className={rateCellClass}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-200">{fmt(completedTicketsPayment)}</td>
                  </tr>

                  {Math.abs(techHourlyPay - (techHourlyPayStraight + techHourlyPayOtPremium)) > 0.005 ? (
                    <>
                      <tr title="Regular worked hours at the company rate plus the regular-hours state match. PTO is shown separately below. Same split as Reviewed Periods.">
                        <td className="px-3 py-2 text-slate-300">Regular Pay (including State match)</td>
                        <td className="px-3 py-2 text-right text-slate-300">{Math.max(hoursWorked - (row.techPaidLeaveHours ?? 0), 0).toFixed(3)}</td>
                        <td className="px-3 py-2 text-right text-slate-300">Company + State match</td>
                        <td className="px-3 py-2 text-right text-slate-200">{fmt(stateRegularShare - (row.techPaidLeavePay ?? 0))}</td>
                      </tr>
                      {overtimeHours > 0 && (
                        <tr title="OT hours at the company rate, plus the weighted OT premium and additional state OT match. Same split as Reviewed Periods; already included in Total Payment.">
                          <td className="px-3 py-2 text-slate-300">OT Pay (including State match)</td>
                          <td className="px-3 py-2 text-right text-slate-300">{overtimeHours.toFixed(3)} OT</td>
                          <td className="px-3 py-2 text-right text-slate-300">Base + premium + State match</td>
                          <td className="px-3 py-2 text-right text-slate-200">{fmt(techHourlyPay - stateRegularShare)}</td>
                        </tr>
                      )}
                    </>
                  ) : (
                    <>
                      <tr title="Regular hours worked this period at this technician's flat hourly rate. Overtime hours are paid on their own Overtime Pay lines below. Set via their name link on the Tech Payroll table → Add Rate Change, same as an office employee's rate.">
                        <td className="px-3 py-2 text-slate-300">Hourly Pay</td>
                        <td className="px-3 py-2 text-right text-slate-300">{overtimeDisplay.hourlyHours.toFixed(3)}</td>
                        <td className="px-3 py-2 text-right text-slate-300">{fmt(hourlyRate)}/hr</td>
                        <td className="px-3 py-2 text-right text-slate-200">{fmt(overtimeDisplay.hourlyAmount)}</td>
                      </tr>
                      {overtimeDisplay.weeks.map((w) => (
                        <Fragment key={w.key}>
                          <tr title={`${w.label}: ${w.hours.toFixed(3)} overtime hours at ${fmt(w.baseRate)}/hr × 1.5.`}>
                            <td className="px-3 py-2 text-slate-300">Overtime Pay ({w.label})</td>
                            <td className="px-3 py-2 text-right text-slate-300">{w.hours.toFixed(3)} OT</td>
                            <td className="px-3 py-2 text-right text-slate-300">{fmt(w.baseRate)}/hr × 1.5</td>
                            <td className="px-3 py-2 text-right text-slate-200">{fmt(w.otAmount)}</td>
                          </tr>
                          {w.incentiveAmount > 0.004 && (
                            <tr title={incentiveDetail(w)}>
                              <td className="px-3 py-2 pl-6 text-slate-400">OT on Incentive Pay ({w.label})</td>
                              <td className="px-3 py-2 text-right text-slate-400">{w.hours.toFixed(3)} OT</td>
                              <td className="px-3 py-2 text-right text-slate-400">({fmt(w.regularRate)} − {fmt(w.baseRate)}) × 0.5</td>
                              <td className="px-3 py-2 text-right text-slate-200">{fmt(w.incentiveAmount)}</td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </>
                  )}
                  {(row.techPaidLeavePay ?? 0) > 0 && (
                    <tr title="Approved paid PTO. Excluded from worked hours and the weighted OT rate; counted once toward the paid-day guarantee.">
                      <td className="px-3 py-2 text-slate-300">PTO Pay</td>
                      <td className="px-3 py-2 text-right text-slate-300">{(row.techPaidLeaveHours ?? 0).toFixed(3)} paid leave hours</td>
                      <td className="px-3 py-2 text-right text-slate-300">Paid leave</td>
                      <td className="px-3 py-2 text-right text-slate-200">{fmt(row.techPaidLeavePay ?? 0)}</td>
                    </tr>
                  )}
                  {techGuaranteedSalaryMatch > 0.005 && (
                    <tr title="A Guaranteed Minimum in Salary History (in effect by the end of this period) acts as a floor under their hourly + incentive pay — the shortfall between the guarantee for eligible paid dates (worked days plus approved paid PTO, capped at 10) and their actual earned compensation (excluding reimbursements) this period, checked against the state-matched total (see the Guaranteed Minimum Salary Match box).">
                      <td className="px-3 py-2 text-slate-300">Guaranteed Minimum Salary Match</td>
                      <td className="px-3 py-2 text-right text-slate-300">—</td>
                      <td className="px-3 py-2 text-right text-slate-300">{fmt(techGuaranteedSalaryTarget)}/cutoff</td>
                      <td className="px-3 py-2 text-right text-slate-200">{fmt(techGuaranteedSalaryMatch)}</td>
                    </tr>
                  )}
                  {techHolidayPremium > 0.005 && (
                    <tr title="Extra 0.5x premium for hours actually worked on a recognized company holiday, on top of normal straight/OT pay for those hours.">
                      <td className="px-3 py-2 text-slate-300">Holiday Premium</td>
                      <td className="px-3 py-2 text-right text-slate-300">—</td>
                      <td className="px-3 py-2 text-right text-slate-300">×0.5</td>
                      <td className="px-3 py-2 text-right text-slate-200">{fmt(techHolidayPremium)}</td>
                    </tr>
                  )}
                  {techTraineeMatch > 0.005 && (
                    <tr title="Trainee daily $100 guarantee: any day within this technician's trainee window (hireDate through Training End Date) whose actual pay -- at whichever rate was really in effect that day, including any state minimum-wage floor -- fell short of $100 is topped up to $100. A day that already earned $100+ keeps its full actual pay -- this is a floor, not a flat replacement.">
                      <td className="px-3 py-2 text-slate-300">Trainee Daily Match</td>
                      <td className="px-3 py-2 text-right text-slate-300">—</td>
                      <td className="px-3 py-2 text-right text-slate-300">$100/day</td>
                      <td className="px-3 py-2 text-right text-slate-200">{fmt(techTraineeMatch)}</td>
                    </tr>
                  )}

                  {(["ldtCount", "mileage", "trainingValue"] as const).map((field) => {
                    const meta = {
                      ldtCount: { label: "LDT", rateKey: "LDT", value: techManual.ldtCount, pay: techManual.ldtPay },
                      mileage: { label: "Mileage", rateKey: "Mileage", value: techManual.mileage, pay: techManual.mileagePay },
                      trainingValue: { label: "Training Paid", rateKey: "Training Paid", value: techManual.trainingValue, pay: techManual.trainingPay },
                    }[field];
                    const savingValue = savingManualKey === `${employee.id}:${field}`;
                    const savingRate = savingRateKey === meta.rateKey;
                    // Car IQ tab (2026-09-24): once this technician has a
                    // Car IQ status on file, their Mileage rate is locked to
                    // $0.20/$0.40 (see mileageRateOverride, AccountingDashboard.tsx)
                    // instead of the shared per-branch Branch Rates figure —
                    // shown read-only here so it can't be typed back over.
                    const rateLocked = field === "mileage" && mileageRateOverride != null;
                    const displayedRate = rateLocked ? (mileageRateOverride as number) : techRateFor(meta.rateKey);
                    return (
                      <tr key={field}>
                        <td className="px-3 py-2 text-slate-300">{meta.label}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {savingValue && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                            <input
                              key={`${field}:${meta.value}`}
                              type="number" min={0}
                              defaultValue={meta.value || ""}
                              disabled={savingValue}
                              placeholder="0"
                              onBlur={(e) => { const changed = (Number(e.target.value) || 0) !== (Number(meta.value) || 0); void onManualPayBlur(row, field, e.target.value).then(() => { if (changed) markChanged(); }); }}
                              className={rateCellClass}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1.5" title={rateLocked ? "Locked by this technician's Car IQ status — change it on the Accounting Dashboard's Car IQ tab, not here." : undefined}>
                            {savingRate && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                            <input
                              key={`${meta.rateKey}:${displayedRate}`}
                              type="number" min={0} step={0.01}
                              defaultValue={displayedRate}
                              disabled={savingRate || rateLocked}
                              onBlur={(e) => handleRateBlur(meta.rateKey, e.target.value)}
                              className={rateCellClass}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right text-slate-200">{fmt(meta.pay)}</td>
                      </tr>
                    );
                  })}

                  {carIqSwitch && (
                    <tr>
                      <td colSpan={4} className="px-3 py-2 bg-amber-950/30 border-y border-amber-500/30">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <p className="text-[11px] text-amber-300">
                            Car IQ status changed on {carIqSwitch.date} this period — the Mileage line above (${carIqSwitch.rateBefore.toFixed(2)}/mi) only covers days before that.
                            Add a second line at ${carIqSwitch.rateAfter.toFixed(2)}/mi for the mileage driven from {carIqSwitch.date} onward.
                          </p>
                          <button
                            type="button"
                            onClick={() => void handleAddCarIqSplitLine()}
                            className="shrink-0 px-2.5 py-1 rounded bg-amber-600/80 hover:bg-amber-600 text-white text-[11px] font-semibold whitespace-nowrap"
                          >
                            + Add Car IQ mileage line
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}

                  {visibleCategoryPayments.map(({ type, count, rate, payment }) => {
                    const savingValue = savingCategoryOverrideKey === `${employee.id}:${type}`;
                    return (
                      <tr key={type}>
                        <td className="px-3 py-2 text-slate-300">{type}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {savingValue && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                            <input
                              key={`${type}:count:${count}`}
                              type="number" min={0}
                              defaultValue={count || ""}
                              placeholder="0"
                              disabled={savingValue}
                              onBlur={(e) => { const changed = (Number(e.target.value) || 0) !== (Number(count) || 0); void onCategoryOverrideBlur(employee.id, type, e.target.value).then(() => { if (changed) markChanged(); }); }}
                              className={rateCellClass}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {savingRateKey === type && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                            <input
                              key={`${type}:${rate}`}
                              type="number" min={0} step={0.01}
                              defaultValue={rate}
                              disabled={savingRateKey === type}
                              onBlur={(e) => handleRateBlur(type, e.target.value)}
                              className={rateCellClass}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right text-slate-200">{fmt(payment)}</td>
                      </tr>
                    );
                  })}

                  {techCarryover.length > 0 && (
                    <tr title="Confirmed by Claims — each reached Claimed/Completed after its own scheduled week had already ended. Priced at today's rate; not part of this period's own category counts.">
                      <td className="px-3 py-2 align-top text-amber-300">Carried Over Tickets</td>
                      <td className="px-3 py-2 text-right text-slate-300" colSpan={2}>
                        {techCarryover.map((co) => {
                          const rate = techRateFor(co.repairType);
                          return (
                            <div key={co.lateTicketCompletionId} className="whitespace-nowrap">
                              <Link to="/ticket/$ticketNo" params={{ ticketNo: co.ticketNo }} target="_blank" rel="noreferrer" className="font-mono text-amber-300 underline hover:text-amber-200">
                                {co.ticketNo}
                              </Link>{" "}
                              <span className="text-slate-400">({co.periodStart} to {co.periodEnd}) — {fmt(rate)}</span>
                            </div>
                          );
                        })}
                      </td>
                      <td className="px-3 py-2 text-right align-top text-slate-200">{fmt(carryoverTotal)}</td>
                    </tr>
                  )}

                  <tr title="Completed visits this period where this technician was the assisting (2nd) technician on someone else's ticket.">
                    <td className="px-3 py-2 text-slate-300">Two Tech</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {savingCategoryOverrideKey === `${employee.id}:Two Tech` && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                        <input
                          key={`Two Tech:count:${twoTechCount}`}
                          type="number" min={0}
                          defaultValue={twoTechCount || ""}
                          placeholder="0"
                          disabled={savingCategoryOverrideKey === `${employee.id}:Two Tech`}
                          onBlur={(e) => { const changed = (Number(e.target.value) || 0) !== (Number(twoTechCount) || 0); void onCategoryOverrideBlur(employee.id, "Two Tech", e.target.value).then(() => { if (changed) markChanged(); }); }}
                          className={rateCellClass}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {savingRateKey === "Two Tech" && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                        <input
                          key={`Two Tech:${twoTechRate}`}
                          type="number" min={0} step={0.01}
                          defaultValue={twoTechRate}
                          disabled={savingRateKey === "Two Tech"}
                          onBlur={(e) => handleRateBlur("Two Tech", e.target.value)}
                          className={rateCellClass}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-200">{fmt(twoTechPayment)}</td>
                  </tr>

                  {customItems.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2">
                        <input
                          key={`label:${item.id}:${item.label}`}
                          type="text"
                          defaultValue={item.label}
                          placeholder="(custom program)"
                          disabled={savingCustomId === item.id}
                          onBlur={(e) => handleCustomLineBlur(item, { label: e.target.value })}
                          className="w-full bg-slate-800/50 border border-white/10 rounded px-2 py-1 text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          key={`value:${item.id}:${item.value}`}
                          type="number"
                          defaultValue={item.value || ""}
                          placeholder="0"
                          disabled={savingCustomId === item.id}
                          onBlur={(e) => handleCustomLineBlur(item, { value: Number(e.target.value) || 0 })}
                          className={rateCellClass}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <select
                            title="Includable: a real wage (commission, completed tickets) — feeds the FLSA weighted regular rate used for the OT premium. Reimbursement: a stipend, expense reimbursement, or unrelated deduction (a copay, a chargeback) paid/withheld on top of wages, not as part of them — excluded from that rate."
                            value={item.isWageIncludable ? "includable" : "reimbursement"}
                            disabled={savingCustomId === item.id}
                            onChange={(e) => handleCustomLineBlur(item, { isWageIncludable: e.target.value === "includable" })}
                            className="bg-slate-800/50 border border-white/10 rounded px-1 py-1 text-[10px] text-slate-300 focus:border-blue-500 focus:outline-none disabled:opacity-50"
                          >
                            <option value="includable">Includable</option>
                            <option value="reimbursement">Reimbursement</option>
                          </select>
                          {periodWeeks.length > 1 && (
                            <select
                              title="The workweek this pay was earned in. An Includable line counts toward THAT week's regular rate for the OT premium (FLSA sets it per week). Whole period = spread over the weeks by hours."
                              value={item.workWeekStart ?? ""}
                              disabled={savingCustomId === item.id}
                              onChange={(e) => handleCustomLineBlur(item, { workWeekStart: e.target.value || null })}
                              className="bg-slate-800/50 border border-white/10 rounded px-1 py-1 text-[10px] text-slate-300 focus:border-blue-500 focus:outline-none disabled:opacity-50"
                            >
                              <option value="">Whole period</option>
                              {periodWeeks.map((w) => (
                                <option key={w} value={w}>{weekLabel(w)}</option>
                              ))}
                            </select>
                          )}
                          <input
                            key={`rate:${item.id}:${item.rate}`}
                            type="number" step={0.01}
                            defaultValue={item.rate || ""}
                            placeholder="0"
                            disabled={savingCustomId === item.id}
                            onBlur={(e) => handleCustomLineBlur(item, { rate: Number(e.target.value) || 0 })}
                            className={rateCellClass}
                          />
                          <button
                            onClick={() => handleDeleteCustomLine(item)}
                            disabled={savingCustomId === item.id}
                            title="Remove line"
                            className="text-red-400 hover:text-red-300 disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right text-slate-200">{fmt(item.value * item.rate)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={4} className="px-3 py-2">
                      <button
                        onClick={handleAddCustomLine}
                        className="inline-flex items-center gap-1 text-xs font-medium text-blue-400 hover:text-blue-300"
                      >
                        <Plus className="h-3.5 w-3.5" /> Add custom line
                      </button>
                    </td>
                  </tr>

                  <tr title="Percentage bonus applied on top of everything above.">
                    <td className="px-3 py-2 text-slate-300">OW Incentive</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {savingManualKey === `${employee.id}:owIncentivePct` && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                        <input
                          key={`owIncentivePct:${techManual.owIncentivePct}`}
                          type="number" min={0} max={100} step={0.1}
                          defaultValue={techManual.owIncentivePct || ""}
                          placeholder="0"
                          disabled={savingManualKey === `${employee.id}:owIncentivePct`}
                          onBlur={(e) => { const changed = (Number(e.target.value) || 0) !== (Number(techManual.owIncentivePct) || 0); void onManualPayBlur(row, "owIncentivePct", e.target.value).then(() => { if (changed) markChanged(); }); }}
                          className="w-16 bg-slate-800/50 border border-white/10 rounded px-1.5 py-1 text-right text-xs text-white focus:border-blue-500 focus:outline-none disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <span className="text-xs text-slate-400">%</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600">—</td>
                    <td className="px-3 py-2 text-right text-slate-200">{fmt(owIncentivePay)}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr className="border-t border-white/20 bg-white/5">
                    <td colSpan={3} className="px-3 py-3 text-sm font-semibold text-slate-200">Total Payment</td>
                    <td className="px-3 py-3 text-right text-base font-bold text-green-300">{fmt(totalPayment)}</td>
                  </tr>
                  {taxLines.map((line) => (
                    <tr key={line.id}>
                      <td className="px-3 py-2">
                        <input
                          key={`taxLabel:${line.id}:${line.label}`}
                          type="text"
                          defaultValue={line.label}
                          placeholder="Tax"
                          disabled={savingTaxId === line.id}
                          onBlur={(e) => e.target.value !== line.label && handleTaxLineChange(line, { label: e.target.value })}
                          className="w-full bg-slate-800/50 border border-white/10 rounded px-2 py-1 text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
                        />
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-slate-500">
                        {line.mode === "percent" ? `${line.amount}% of ${fmt(totalPayment)}` : "fixed"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <select
                            title="Percent of Total Payment, or a fixed dollar amount"
                            value={line.mode}
                            disabled={savingTaxId === line.id}
                            onChange={(e) => handleTaxLineChange(line, { mode: e.target.value as TechTaxMode })}
                            className="bg-slate-800/50 border border-white/10 rounded px-1 py-1 text-[10px] text-slate-300 focus:border-blue-500 focus:outline-none disabled:opacity-50"
                          >
                            <option value="percent">%</option>
                            <option value="fixed">$ Fixed</option>
                          </select>
                          <input
                            key={`taxAmount:${line.id}:${line.amount}`}
                            type="number" min={0} step={0.01}
                            defaultValue={line.amount || ""}
                            placeholder="0"
                            disabled={savingTaxId === line.id}
                            onBlur={(e) => (Number(e.target.value) || 0) !== line.amount && handleTaxLineChange(line, { amount: Number(e.target.value) || 0 })}
                            className={rateCellClass}
                          />
                          <button
                            onClick={() => handleDeleteTaxLine(line)}
                            disabled={savingTaxId === line.id}
                            title="Remove tax line"
                            className="text-red-400 hover:text-red-300 disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right text-red-300">{fmt(-taxLineAmount(line, totalPayment))}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={4} className="px-3 py-2">
                      <button
                        onClick={handleAddTaxLine}
                        className="inline-flex items-center gap-1 text-xs font-medium text-blue-400 hover:text-blue-300"
                      >
                        <Plus className="h-3.5 w-3.5" /> Add tax line
                      </button>
                    </td>
                  </tr>
                  {taxLines.length > 0 && (
                    <tr className="border-t border-white/20 bg-white/5">
                      <td colSpan={3} className="px-3 py-3 text-sm font-semibold text-slate-200">Net Pay After Tax</td>
                      <td className="px-3 py-3 text-right text-base font-bold text-emerald-300">
                        {fmt(totalPayment - taxLines.reduce((sum, l) => sum + taxLineAmount(l, totalPayment), 0))}
                      </td>
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>

            {/* Stats + Redo / 2nd Tech panel (the paystub takes its place while comparing) */}
            <div className={`space-y-3 ${comparePaystub && paystub ? "hidden" : ""}`}>
              {[
                ["Total Working Days", workingDays],
                ["Total Assigned Tickets", ticketsAssigned],
                ["Complete Ratio", ticketsAssigned > 0 ? `${ratioPct.toFixed(1)}%` : "—"],
                ["Avg. Daily Completion", `${avgDailyCompletion.toFixed(1)} tickets`],
                ["Avg. Daily Miles", `${avgDailyMiles.toFixed(1)} miles`],
              ].map(([label, value]) => (
                <div key={label as string} className="bg-slate-800/50 border border-white/10 rounded-lg px-3 py-2.5">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide">{label}</p>
                  <p className="text-lg font-bold text-white mt-0.5">{value}</p>
                </div>
              ))}

              <div className="bg-slate-800/50 border border-white/10 rounded-lg px-3 py-2.5">
                <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1.5">Redo</p>
                {loadingExtras ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
                ) : redoTickets.length === 0 ? (
                  <p className="text-xs text-slate-500">None</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {redoTickets.map((t) => (
                      <Link key={t.ticketId} to="/ticket/$ticketNo" params={{ ticketNo: t.ticketNo }} target="_blank" className="text-xs text-blue-400 hover:text-blue-300 hover:underline">
                        {t.ticketNo}
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-slate-800/50 border border-white/10 rounded-lg px-3 py-2.5">
                <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1.5">On Hold (Mileage)</p>
                {loadingExtras ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
                ) : onHoldTickets.length === 0 ? (
                  <p className="text-xs text-slate-500">None</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {onHoldTickets.map((t) => (
                      <Link key={t.ticketId} to="/ticket/$ticketNo" params={{ ticketNo: t.ticketNo }} target="_blank" className="text-xs text-blue-400 hover:text-blue-300 hover:underline">
                        {t.ticketNo}
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-slate-800/50 border border-white/10 rounded-lg px-3 py-2.5">
                <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1.5">2nd Tech (assisted this tech)</p>
                {loadingExtras ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
                ) : assistedTickets.length === 0 ? (
                  <p className="text-xs text-slate-500">None</p>
                ) : (
                  <div className="flex flex-col gap-1">
    {assistedTickets.map((t) => (
                      <Link key={t.ticketId} to="/ticket/$ticketNo" params={{ ticketNo: t.ticketNo }} target="_blank" className="text-xs text-blue-400 hover:text-blue-300 hover:underline">
                        {t.secondTechnician} · {t.ticketNo}
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-slate-800/50 border border-white/10 rounded-lg px-3 py-2.5">
                <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1.5">2nd Tech (this tech assisted on)</p>
                {loadingExtras ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
                ) : secondTechTickets.length === 0 ? (
                  <p className="text-xs text-slate-500">None</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {secondTechTickets.map((t) => (
                      <Link key={t.ticketId} to="/ticket/$ticketNo" params={{ ticketNo: t.ticketNo }} target="_blank" className="text-xs text-blue-400 hover:text-blue-300 hover:underline">
                        {t.primaryTechnician} · {t.ticketNo}
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-slate-800/50 border border-white/10 rounded-lg px-3 py-2.5">
                <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1.5">Approved Dispute Tickets</p>
                {loadingDisputes ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
                ) : approvedDisputes.length === 0 ? (
                  <p className="text-xs text-slate-500">None</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {approvedDisputes.map((d) => (
                      <div key={d.id} className="text-xs">
                        <div className="flex items-center justify-between gap-2">
                          {d.ticketNo ? (
                            <Link to="/ticket/$ticketNo" params={{ ticketNo: d.ticketNo }} target="_blank" className="text-blue-400 hover:text-blue-300 hover:underline">
                              {d.ticketNo}
                            </Link>
                          ) : (
                            <span className="text-slate-300">{d.payPeriod || "No ticket #"}</span>
                          )}
                          {d.missingAmount != null && <span className="text-green-300 font-semibold">{fmt(d.missingAmount)}</span>}
                        </div>
                        <p className="text-slate-500">
                          {d.periodStart && d.periodEnd ? `${d.periodStart} – ${d.periodEnd}` : d.payPeriod || "No linked period"}
                          {d.customPayItemId ? " · added to payroll" : " · not auto-added"}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-slate-800/50 border border-white/10 rounded-lg px-3 py-2.5">
                <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1.5">Start Date</p>
                <p className="text-xs text-slate-300">
                  {hireDate ? new Date(`${hireDate}T00:00:00`).toLocaleDateString("en-US") : "Not on file"}
                </p>
              </div>

              {companyHourlyOtTotal > 0 && (() => {
                return (
                  <>
                    <div className="bg-slate-800/50 border border-white/10 rounded-lg px-3 py-2.5" title="Regular + meal hours at each day's own assigned state minimum wage, vs. those same regular hours at the flat company rate — same Min-floor check as the reference payroll workbook. Excludes OT hours' flat pay, which would otherwise pad this comparison and hide a real regular-hours shortfall.">
                      <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1.5">Min Wage Floor Check</p>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">State Req Min Floor</span>
                        <span className="text-slate-200">{fmt(stateMinFloor)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs mt-0.5">
                        <span className="text-slate-400">Company PD Min</span>
                        <span className="text-slate-200">{fmt(companyRegularPayBlended)}</span>
                      </div>
                      {COMMISSION_COUNTS_TOWARD_STATE_MIN && commissionAppliedToFloor > 0.005 && (
                        <div className="flex items-center justify-between text-xs mt-0.5" title="Commission counts toward the state minimum, checked per week (payroll workbook method — COMMISSION_COUNTS_TOWARD_STATE_MIN in stateMinWage.ts). This much of it went to covering the state floor instead of being topped up.">
                          <span className="text-slate-400">Commission Counted</span>
                          <span className="text-slate-200">{fmt(commissionAppliedToFloor)}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-xs mt-1 pt-1 border-t border-white/10">
                        <span className="text-slate-400">Match to pay</span>
                        <span className={matchMin > 0.005 ? "text-amber-300 font-semibold" : "text-slate-200"}>{fmt(matchMin)}</span>
                      </div>
                    </div>

                    <div className="bg-slate-800/50 border border-white/10 rounded-lg px-3 py-2.5" title="Two checks, the higher one is owed: (1) once the Min-floor match above adds pay, the regular rate the OT premium is based on is recomputed with it folded in; (2) every OT hour is paid at least 1.5x the minimum wage of the state it was worked in (beyond its straight time at the company rate). Match to pay is the higher of the two minus the OT premium already paid.">
                      <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1.5">
                        OT Match After Min{loadingStateComparison ? " (loading…)" : ""}
                      </p>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">Required Premium After Match</span>
                        <span className="text-slate-200">{fmt(requiredPremiumAfterMinMatch)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs mt-0.5">
                        <span className="text-slate-400">OT at 1.5× State Min</span>
                        <span className="text-slate-200">{fmt(stateOtFloorPremium)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs mt-0.5">
                        <span className="text-slate-400">Company PD OT</span>
                        <span className="text-slate-200">{fmt(techHourlyPayOtPremium)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs mt-1 pt-1 border-t border-white/10">
                        <span className="text-slate-400">Match to pay</span>
                        <span className={matchOt > 0.005 ? "text-amber-300 font-semibold" : "text-slate-200"}>{fmt(matchOt)}</span>
                      </div>
                    </div>

                    <div className="bg-slate-800/50 border border-white/10 rounded-lg px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <p className="text-[10px] text-slate-400 uppercase tracking-wide" title="Company + any Min/OT match owed above — not the full grossPay total below.">
                          Hourly + OT Pay
                        </p>
                        {onSetHourlyOtMode && (
                          <div className="flex items-center rounded-full bg-slate-900 border border-white/10 p-0.5 text-[10px] shrink-0">
                            <button
                              type="button"
                              disabled={stateMatchRequired || hourlyOtModeBusy || loadingStateComparison || periodDataSettling}
                              title={loadingStateComparison ? "Still loading this technician's per-day state comparison — wait for it to finish before switching modes." : undefined}
                              onClick={() => { const changed = appliedIsState; void Promise.resolve(onSetHourlyOtMode("company", companyHourlyOtTotal)).then(() => { if (changed) markChanged(); }); }}
                              className={`px-2 py-0.5 rounded-full transition disabled:opacity-50 ${!(appliedIsState || stateMatchRequired) ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300"}`}
                            >
                              Company
                            </button>
                            <button
                              type="button"
                              disabled={stateMatchRequired || hourlyOtModeBusy || loadingStateComparison || periodDataSettling}
                              title={loadingStateComparison ? "Still loading this technician's per-day state comparison — wait for it to finish before switching modes." : undefined}
                              onClick={() => { const changed = !appliedIsState; void Promise.resolve(onSetHourlyOtMode("state", stateHourlyOtTotal, stateRegularShare)).then(() => { if (changed) markChanged(); }); }}
                              className={`px-2 py-0.5 rounded-full transition disabled:opacity-50 ${(appliedIsState || stateMatchRequired) ? "bg-emerald-700 text-white" : "text-slate-500 hover:text-slate-300"}`}
                            >
                              State
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">Company</span>
                        <span className={!appliedIsState ? "text-emerald-300 font-semibold" : "text-slate-200"}>{fmt(companyHourlyOtTotal)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs mt-0.5">
                        <span className="text-slate-400">State</span>
                        <span className={appliedIsState ? "text-emerald-300 font-semibold" : "text-slate-200"}>{fmt(stateHourlyOtTotal)}</span>
                      </div>
                      {stateMatchRequired && (
                        <p className="text-[10px] text-amber-300 mt-1 pt-1 border-t border-white/10">
                          State match selected automatically. Selection locked.{stateSavePending ? " Saving…" : ""}
                        </p>
                      )}
                    </div>
                  </>
                );
              })()}

              {techGuaranteedSalaryTarget > 0 && (
                <div className="bg-slate-800/50 border border-white/10 rounded-lg px-3 py-2.5" title="A Guaranteed Minimum in Salary History (in effect by the end of this period) acts as a floor under their hourly + incentive pay — if actual earned compensation (excluding reimbursements and any state minimum-wage floor match) falls short of the guarantee for eligible paid dates (worked days plus approved paid PTO, capped at 10), the shortfall is added on top, already folded into grossPay/Total Payment below. Earned Toward Minimum = Company Hourly/OT + Includable + Holiday Premium — company-rate earnings before any state floor match, which is paid separately and doesn't count toward this guarantee.">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1.5">Guaranteed Minimum Salary Match</p>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Earned Toward Minimum</span>
                    <span className="text-slate-200">{fmt(techEarnedTowardMinimum)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs mt-1">
                    <span className="text-slate-400">Minimum ({row.techGuaranteedPaidDays ?? 0} of 10 paid days)</span>
                    <span className="text-slate-200">{fmt(techGuaranteedSalaryTarget)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs mt-1 pt-1 border-t border-white/10">
                    <span className="text-slate-400">Match to pay</span>
                    <span className={techGuaranteedSalaryMatch > 0.005 ? "text-amber-300 font-semibold" : "text-slate-200"}>{fmt(techGuaranteedSalaryMatch)}</span>
                  </div>
                </div>
              )}

              <div className="bg-slate-800/50 border border-white/10 rounded-lg px-3 py-2.5" title="How many days in this period this technician's total drive that day (Mileage tab's Total Mileage, adjustments/overrides included) exceeded each threshold — not a raw mileage_entries row count, since a day with several tickets still shares one day total.">
                <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1.5">Days Over Mileage Threshold</p>
                {loadingExtras ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
                ) : (
                  <div className="flex flex-col gap-1">
                    {mileageThresholdCounts.map(({ threshold, count }) => (
                      <div key={threshold} className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">&gt;{threshold} miles</span>
                        <span className={count > 0 ? "text-amber-300 font-semibold" : "text-slate-300"}>{count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {!readOnly && (
                <div className="bg-slate-800/50 border border-white/10 rounded-lg px-3 py-2.5" title="This period's paystub from Accounting -> Paystubs. Click it to open it next to this report.">
                  <div className="mb-1.5 flex items-center justify-between">
                    <p className="text-[10px] text-slate-400 uppercase tracking-wide">Paystub</p>
                    {paystub && <span className="text-[10px] text-slate-500">Paid {fmtStubDate(paystub.payDate)}</span>}
                  </div>
                  {paystubLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
                  ) : paystubError ? (
                    <p className="text-xs text-red-300">{paystubError}</p>
                  ) : !paystub ? (
                    <p className="text-xs text-slate-500">No paystub uploaded for this period yet.</p>
                  ) : (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setComparePaystub(true)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setComparePaystub(true); } }}
                      className="group relative block w-full cursor-pointer overflow-hidden rounded border border-white/10 bg-white"
                    >
                      {paystubUrl ? (
                        <iframe src={`${paystubUrl}#toolbar=0&navpanes=0&view=FitH`} title="Paystub preview" className="pointer-events-none h-56 w-full" tabIndex={-1} />
                      ) : (
                        <div className="flex h-56 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></div>
                      )}
                      <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-xs font-semibold text-white opacity-0 transition group-hover:bg-black/50 group-hover:opacity-100">
                        <Maximize2 className="mr-1.5 h-4 w-4" /> Compare side by side
                      </span>
                    </div>
                  )}
                  {paystub && (
                    <p className="mt-1.5 text-[10px] text-slate-500">
                      Stub period {fmtStubDate(paystub.periodStart)} – {fmtStubDate(paystub.periodEnd)}{paystub.status !== "published" ? " · not published yet" : ""}
                    </p>
                  )}
                </div>
              )}
            </div>

            {comparePaystub && paystub && (
              <div className="sticky top-0 flex h-[calc(94vh-11rem)] flex-col rounded-lg border border-white/10 bg-slate-950 lg:col-start-2 lg:row-start-1">
                <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-white">
                    <FileText className="h-3.5 w-3.5 text-slate-400" />
                    Paystub · paid {fmtStubDate(paystub.payDate)} · period {fmtStubDate(paystub.periodStart)} – {fmtStubDate(paystub.periodEnd)}
                  </p>
                  <div className="flex items-center gap-2">
                    {paystubUrl && (
                      <a href={paystubUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-300 hover:text-blue-200">Open in new tab</a>
                    )}
                    <span role="button" tabIndex={0} onClick={() => setComparePaystub(false)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setComparePaystub(false); } }} className="cursor-pointer rounded bg-slate-700 px-2 py-1 text-[11px] font-semibold text-white hover:bg-slate-600">
                      Close paystub
                    </span>
                  </div>
                </div>
                {paystubUrl ? (
                  <iframe src={`${paystubUrl}#navpanes=0&view=FitH`} title="Paystub" className="min-h-0 flex-1 rounded-b-lg bg-white" />
                ) : (
                  <div className="flex flex-1 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
                )}
              </div>
            )}
          </div>
          </fieldset>

          {!readOnly && (
            <div className="mt-5 rounded-lg border border-white/10 bg-slate-800/30">
              <div className="flex flex-wrap items-center gap-1.5 border-b border-white/10 px-4 py-2.5">
                <StickyNote className="h-4 w-4 text-amber-300" />
                <p className="text-sm font-semibold text-white">Internal Notes</p>
                <span className="text-[11px] text-slate-500">Accounting only · not on the paystub or shown to the employee</span>
              </div>
              <div className="flex flex-col gap-2 px-4 py-3">
                {notesLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                ) : notes.length === 0 ? (
                  <p className="text-xs text-slate-500">No notes for this period yet.</p>
                ) : (
                  notes.map((n) => (
                    <div key={n.id} className="rounded-md border border-white/10 bg-slate-900/60 px-3 py-2">
                      <p className="whitespace-pre-wrap text-sm text-slate-200">{n.body}</p>
                      <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
                        <span>
                          By: <span className="text-slate-300">{n.createdByName || "Unknown"}</span>
                          {" · "}When: <span className="text-slate-300">{new Date(n.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                        </span>
                        {canDeleteNotes && (
                          <button type="button" onClick={() => void removeNote(n.id)} className="text-slate-500 hover:text-red-300" title="Delete this note (Admin / SuperAdmin)">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
                {notesError && <p className="text-xs text-red-300">{notesError}</p>}
                {needsNote && (
                  <p className="text-xs text-amber-300">This report was changed. Add a note saying what changed and why; Done stays off until you do.</p>
                )}
                <div className="flex items-end gap-2">
                  <textarea
                    ref={noteInputRef}
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void saveNote(); } }}
                    rows={2}
                    placeholder={needsNote ? "Required: explain what was changed on this report and why..." : "Add a note for Accounting (e.g. paystub vs AHS difference, what was sent back to payroll)..."}
                    className={`min-h-[2.75rem] flex-1 resize-y rounded-md border ${needsNote ? "border-amber-500/70" : "border-white/10"} bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none`}
                  />
                  <button
                    type="button"
                    onClick={() => void saveNote()}
                    disabled={!noteDraft.trim() || savingNote}
                    className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                  >
                    {savingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add note"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {(onPrev || onDone) && (
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-white/10 bg-slate-950 rounded-b-xl">
            {onPrev ? (
              <button
                type="button"
                onClick={onPrev}
                className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold transition"
              >
                ← Prev
              </button>
            ) : <span />}
            {onDone && needsNote && (
              <button
                type="button"
                onClick={() => { noteInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); noteInputRef.current?.focus(); }}
                className="ml-auto text-xs text-amber-300 underline-offset-2 hover:underline"
              >
                Changes made: add an Internal Note to enable Done
              </button>
            )}
            {onDone && (
              <button
                type="button"
                onClick={() => onDone(reviewBreakdown)}
                disabled={doneBusy || hourlyOtModeBusy || loadingStateComparison || periodDataSettling || stateSavePending || needsNote}
                title={needsNote ? "Changes were made on this report. Add an Internal Note explaining why first." : undefined}
                className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold transition disabled:opacity-50 flex items-center gap-2"
              >
                {doneBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Done
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
