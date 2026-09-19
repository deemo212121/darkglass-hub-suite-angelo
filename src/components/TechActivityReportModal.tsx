import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { X, Plus, Trash2, Loader2 } from "lucide-react";
import type { EmployeePayrollRow } from "@/components/AccountingDashboard";
import { getAttendanceForRange, computeMealTimeCredit, splitRegularOvertimeWeekly, startOfWeekSunday, CSR_WEEKLY_OVERTIME_THRESHOLD } from "@/lib/supabase/timecards";
import { STATE_MIN_WAGE_2026 } from "@/lib/stateMinWage";
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
  upsertResolvedTechRepairRate,
  type TechRepairRate,
  type TechRedoTicket,
  type TechAssistedTicket,
  type TechSecondTechTicket,
  type TechCustomPayItem,
} from "@/lib/supabase/techPayroll";
import { getCompanyEmployeeRequests, type EmployeeRequestRow } from "@/lib/supabase/employeeRequests";
import { getMileageEntries, mileageEffectiveTotal } from "@/lib/supabase/mileage";

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
  onDone?: () => void;
  doneBusy?: boolean;
  /** Saves ("state") or clears ("company") this technician/period's Hourly + OT pay-mode override — see payroll_hourly_ot_overrides. When omitted, the Company/State comparison box shows read-only totals with no switch. */
  onSetHourlyOtMode?: (mode: "company" | "state", stateTotal: number) => void | Promise<void>;
  hourlyOtModeBusy?: boolean;
}

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
  hourlyOtModeBusy,
}: Props) {
  const { employee, techManual, techCategoryCounts, techCarryover, ticketsAssigned, ticketsCompleted, workingDays, twoTechCount, hoursWorked, overtimeHours, hourlyRate, techHourlyPay, techHourlyPayStraight, techHourlyPayOtPremium, techWeightedRegularRate } = row;
  const branch = employee.assigned_branch || "";

  // Live Company-vs-State comparison for the Hourly Pay figure — fetched
  // fresh here (just this technician's own per-day attendance/state, plus
  // one seed week for the weekly-overtime split below), since
  // AccountingDashboard.tsx's payrollRows only has period-aggregate hours
  // with no per-day state granularity to check a floor against.
  const [periodDayInfo, setPeriodDayInfo] = useState<{ date: string; rawHours: number; state?: string }[]>([]);
  const [loadingStateComparison, setLoadingStateComparison] = useState(false);
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

  // Real per-day regular/overtime split — same flat-40-hrs/week rule
  // AccountingDashboard.tsx/EmployeePayrollDetailModal.tsx use for
  // Technician-tier roles — so a day's overtime is only weighed against
  // THAT day's own state floor instead of a period-blended one.
  const dailySplit = useMemo(
    () => splitRegularOvertimeWeekly(periodDayInfo.map((d) => ({ date: d.date, rawHours: d.rawHours })), {}, 8, CSR_WEEKLY_OVERTIME_THRESHOLD),
    [periodDayInfo]
  );

  // Min-floor check, same shape as the reference spreadsheet's "Match to
  // pay" table: regular+meal hours at each day's own state floor vs.
  // Company's flat straight-time total (regular hours only — see matchMin
  // below). The OT side isn't an independent floor check against
  // stateOtFloor; it's a cascade off this Min match (see matchOt below).
  const stateMinFloor = useMemo(() => {
    let min = 0;
    for (const d of periodDayInfo) {
      if (d.date < periodStart || d.date > periodEnd) continue;
      // A day with no state assigned isn't "no floor applies" — it means
      // there's no data suggesting anything OTHER than the company rate,
      // so it defaults to hourlyRate rather than being skipped entirely.
      // Skipping it would drop that day out of stateMinFloor while Company
      // PD Min still counts it (unconditional on state), silently
      // understating the state side and hiding a real shortfall on the
      // days that DO have a higher state assigned.
      const floor = (d.state ? STATE_MIN_WAGE_2026.find((s) => s.state === d.state)?.rate : null) ?? hourlyRate;
      const split = dailySplit.get(d.date) ?? { regular: 0, overtime: 0 };
      min += split.regular * floor;
    }
    return min;
  }, [periodDayInfo, dailySplit, periodStart, periodEnd, hourlyRate]);

  const companyHourlyOtTotal = techHourlyPayStraight + techHourlyPayOtPremium;
  // stateMinFloor is regular-hours-only (matches State Req Min Floor's own
  // scope) — comparing it against techHourlyPayStraight (ALL hours,
  // including OT, at the flat rate) would let the OT hours' flat pay
  // artificially pad the comparison and hide a real regular-hours
  // shortfall. Compare against regular hours only (hoursWorked × hourlyRate)
  // instead, same fix as the OT bucket needed in the other direction.
  const matchMin = Math.max(stateMinFloor - hoursWorked * hourlyRate, 0);
  // After a Min-floor top-up, the regular rate the OT premium is based on
  // has to be recomputed with that extra pay folded in (same weighted-rate
  // principle used everywhere else) — then any INCREMENTAL OT premium that
  // higher rate requires, beyond what's already been paid, is owed too.
  // This mirrors the reference payroll workbook's own cascading Min→OT
  // match (Steps 9–11: recompute the regular rate, recompute the required
  // premium at that rate, then take only the difference from what's
  // already paid) rather than an independent state-OT-floor check.
  const totalHoursForMatch = hoursWorked + overtimeHours;
  const regularRateAfterMinMatch = totalHoursForMatch > 0 ? techWeightedRegularRate + matchMin / totalHoursForMatch : techWeightedRegularRate;
  const requiredPremiumAfterMinMatch = overtimeHours * regularRateAfterMinMatch * 0.5;
  const matchOt = Math.max(requiredPremiumAfterMinMatch - techHourlyPayOtPremium, 0);
  const stateHourlyOtTotal = companyHourlyOtTotal + matchMin + matchOt;

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
      onCustomItemsChanged();
    } catch (err) {
      alert(`Failed to add line: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };
  const handleCustomLineBlur = async (item: TechCustomPayItem, fields: { label?: string; value?: number; rate?: number }) => {
    setSavingCustomId(item.id);
    try {
      await updateTechCustomPayItem(item.id, fields);
      setCustomItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...fields } : i)));
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
      onCustomItemsChanged();
    } catch (err) {
      alert(`Failed to remove line: ${err instanceof Error ? err.message : "Unknown error"}`);
      setSavingCustomId(null);
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
    techManual.mileagePay + techManual.trainingPay +
    twoTechPayment + completedTicketsPayment + redoReductionPayment + customLinesTotal + carryoverTotal + row.techHourlyPay;
  const owIncentivePay = (techManual.owIncentivePct / 100) * subtotal;
  const totalPayment = subtotal + owIncentivePay;

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
        className="bg-slate-900 border border-white/15 rounded-xl w-full max-w-6xl max-h-[90vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-slate-950 rounded-t-xl">
          <div>
            <p className="font-semibold text-white">Tech Activity Report of {employee.full_name}</p>
            <p className="text-xs text-slate-400">{periodStart} – {periodEnd}{branch ? ` · ${branch}` : ""}</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 transition">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5">
          <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
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
                    // State-mode override in effect (payroll_hourly_ot_overrides) — an
                    // externally-set total that can't be meaningfully split into
                    // straight/premium pieces, so show it as the one combined figure
                    // it's always been.
                    <tr title="Hours actually worked this period (regular + overtime), State-matched total from the payroll detail step's Compliant/State toggle. Set via their name link on the Tech Payroll table → Add Rate Change.">
                      <td className="px-3 py-2 text-slate-300">Hourly Pay</td>
                      <td className="px-3 py-2 text-right text-slate-300">
                        {hoursWorked.toFixed(1)}{overtimeHours > 0 ? ` + ${overtimeHours.toFixed(1)} OT` : ""}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-300">{fmt(hourlyRate)}/hr</td>
                      <td className="px-3 py-2 text-right text-slate-200">{fmt(techHourlyPay)}</td>
                    </tr>
                  ) : (
                    <>
                      <tr title="All hours worked this period (regular + overtime), once, at this technician's flat hourly rate. Set via their name link on the Tech Payroll table → Add Rate Change, same as an office employee's rate.">
                        <td className="px-3 py-2 text-slate-300">Hourly Pay</td>
                        <td className="px-3 py-2 text-right text-slate-300">
                          {hoursWorked.toFixed(1)}{overtimeHours > 0 ? ` + ${overtimeHours.toFixed(1)} OT` : ""}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-300">{fmt(hourlyRate)}/hr</td>
                        <td className="px-3 py-2 text-right text-slate-200">{fmt(techHourlyPayStraight)}</td>
                      </tr>
                      {overtimeHours > 0 && (
                        <tr title="The extra 0.5x overtime premium, computed off the FLSA weighted regular rate — straight-time wages plus this period's includable incentive/bonus pay (piece-rate, carryover, LDT/Training, Two Tech, MCA, Completed Tickets, custom lines), divided by total hours — instead of the flat hourly rate. Required once a technician earns incentive pay alongside overtime in the same period.">
                          <td className="px-3 py-2 text-slate-300">OT Premium (Weighted Rate)</td>
                          <td className="px-3 py-2 text-right text-slate-300">{overtimeHours.toFixed(1)} OT</td>
                          <td className="px-3 py-2 text-right text-slate-300">{fmt(techWeightedRegularRate)}/hr × 0.5</td>
                          <td className="px-3 py-2 text-right text-slate-200">{fmt(techHourlyPayOtPremium)}</td>
                        </tr>
                      )}
                    </>
                  )}

                  {(["mileage", "trainingValue"] as const).map((field) => {
                    const meta = {
                      mileage: { label: "Mileage", rateKey: "Mileage", value: techManual.mileage, pay: techManual.mileagePay },
                      trainingValue: { label: "Training Paid", rateKey: "Training Paid", value: techManual.trainingValue, pay: techManual.trainingPay },
                    }[field];
                    const savingValue = savingManualKey === `${employee.id}:${field}`;
                    const savingRate = savingRateKey === meta.rateKey;
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
                              onBlur={(e) => onManualPayBlur(row, field, e.target.value)}
                              className={rateCellClass}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {savingRate && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                            <input
                              key={`${meta.rateKey}:${techRateFor(meta.rateKey)}`}
                              type="number" min={0} step={0.01}
                              defaultValue={techRateFor(meta.rateKey)}
                              disabled={savingRate}
                              onBlur={(e) => handleRateBlur(meta.rateKey, e.target.value)}
                              className={rateCellClass}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right text-slate-200">{fmt(meta.pay)}</td>
                      </tr>
                    );
                  })}

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
                              onBlur={(e) => onCategoryOverrideBlur(employee.id, type, e.target.value)}
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
                          onBlur={(e) => onCategoryOverrideBlur(employee.id, "Two Tech", e.target.value)}
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
                          onBlur={(e) => onManualPayBlur(row, "owIncentivePct", e.target.value)}
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
                </tfoot>
              </table>
            </div>

            {/* Stats + Redo / 2nd Tech panel */}
            <div className="space-y-3">
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
                // Currently applied = whichever side techHourlyPay (the
                // real, paid figure) matches. With no override saved yet,
                // that's always Company by construction (see
                // AccountingDashboard.tsx), even on days State would be
                // legally required — so also flag that case (stateIsDue)
                // so it doesn't read as "Company is fine" when it isn't.
                const appliedIsState = Math.abs(techHourlyPay - companyHourlyOtTotal) > 0.005;
                const stateIsDue = !appliedIsState && stateHourlyOtTotal > companyHourlyOtTotal + 0.005;
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
                        <span className="text-slate-200">{fmt(hoursWorked * hourlyRate)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs mt-1 pt-1 border-t border-white/10">
                        <span className="text-slate-400">Match to pay</span>
                        <span className={matchMin > 0.005 ? "text-amber-300 font-semibold" : "text-slate-200"}>{fmt(matchMin)}</span>
                      </div>
                    </div>

                    <div className="bg-slate-800/50 border border-white/10 rounded-lg px-3 py-2.5" title="Once the Min-floor match above adds pay, the regular rate the OT premium is based on has to be recomputed with it folded in — this is the required premium at that recomputed rate, vs. what's already been paid. Not an independent state-OT-floor check; a cascade off the Min match.">
                      <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1.5">
                        OT Match After Min{loadingStateComparison ? " (loading…)" : ""}
                      </p>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">Required Premium After Match</span>
                        <span className="text-slate-200">{fmt(requiredPremiumAfterMinMatch)}</span>
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
                              disabled={hourlyOtModeBusy}
                              onClick={() => onSetHourlyOtMode("company", companyHourlyOtTotal)}
                              className={`px-2 py-0.5 rounded-full transition ${!appliedIsState ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300"}`}
                            >
                              Company
                            </button>
                            <button
                              type="button"
                              disabled={hourlyOtModeBusy}
                              onClick={() => onSetHourlyOtMode("state", stateHourlyOtTotal)}
                              className={`px-2 py-0.5 rounded-full transition ${appliedIsState ? "bg-emerald-700 text-white" : "text-slate-500 hover:text-slate-300"}`}
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
                      {stateIsDue && (
                        <p className="text-[10px] text-amber-300 mt-1 pt-1 border-t border-white/10">
                          State pays {fmt(stateHourlyOtTotal - companyHourlyOtTotal)} more — switch to State.
                        </p>
                      )}
                    </div>
                  </>
                );
              })()}

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
            </div>
          </div>
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
            {onDone && (
              <button
                type="button"
                onClick={onDone}
                disabled={doneBusy}
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
