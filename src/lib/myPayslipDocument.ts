/**
 * An employee's own payslip — the same document Employee Self Service shows
 * (payslipTemplate.ts), built from one of their payroll runs (getMyPayslips).
 *
 * Shared so the mobile app's Stub button and the desktop Self Service page
 * build exactly the same payslip:
 *   loadPayslipDailyRows  — the day-by-day duty rows (real attendance for the
 *                           run's period, each day at the rate in effect)
 *   assemblePayslipData   — the template's data from those rows + the run
 *   buildMyPayslipData    — both, fetching everything itself (mobile)
 *   downloadPayslipPdf    — renders it to a PDF and saves it
 */
import {
  getAttendanceForRange,
  getMyProfileSchedule,
  splitRegularOvertimeWeekly,
  CSR_WEEKLY_OVERTIME_THRESHOLD,
} from "@/lib/supabase/timecards";
import { getCompanyHolidaysInRange } from "@/lib/supabase/companyHolidays";
import { getPendingCorrectionsInRange } from "@/lib/supabase/timecardCorrections";
import { getCompanyPtoRequests } from "@/lib/supabase/pto";
import { getSalaryHistory, entryEffectiveOn, payRateHistory } from "@/lib/supabase/salary";
import { getMyFullProfile, getProfileEmployeeInfo } from "@/lib/supabase/users";
import { getMyPayrollNotes } from "@/lib/supabase/payrollNotes";
import type { MyPayslipRow } from "@/lib/supabase/payslips";
import { ROLE_LABELS, hasAnyTechnicianPayRole } from "@/lib/roleLabels";
import {
  PAYSLIP_STYLES,
  formatClockTime,
  offDaysInRange,
  ptoDaysInRange,
  renderPayslipBodyHtml,
  type EmployeePayslipData,
  type PayslipDailyRow,
} from "@/lib/payslipTemplate";

export type PayslipSchedule = Awaited<ReturnType<typeof getMyProfileSchedule>>;

/**
 * The payslip's day-by-day duty breakdown: real attendance for the run's
 * exact pay period, each day at the hourly rate effective that date (the
 * run's stored rate only when no salary-history entry covers it). Regular vs
 * OT is split per Sunday–Saturday week at 40 hours — the same rule the
 * payslip's gross uses (everyone, PH included, OT at 1.5×, since 2026-10-22).
 * Fixed salary still shows attendance; the template labels it separately.
 */
export async function loadPayslipDailyRows(opts: {
  profileId: string;
  uid: string | null;
  role: string | null;
  extraRoles: string[] | null | undefined;
  payslip: MyPayslipRow;
}): Promise<{ rows: PayslipDailyRow[]; schedule: PayslipSchedule | null }> {
  const { profileId, uid, role, extraRoles, payslip } = opts;
  const [schedule, salaryHistory] = await Promise.all([
    uid ? getMyProfileSchedule(uid) : Promise.resolve(null),
    getSalaryHistory(profileId),
  ]);
  const rateHistory = payRateHistory(salaryHistory, hasAnyTechnicianPayRole(role, extraRoles ?? []));
  const holidays = await getCompanyHolidaysInRange(payslip.periodStart, payslip.periodEnd).catch(() => []);
  const pendingCorrections = await getPendingCorrectionsInRange(payslip.periodStart, payslip.periodEnd).catch(() => []);
  const attendance = await getAttendanceForRange(profileId, payslip.periodStart, payslip.periodEnd, {
    requiredCheckIn: schedule?.requiredCheckIn,
    requiredCheckOut: schedule?.requiredCheckOut,
    workingHours: schedule?.workingHours,
    mealMinutes: schedule?.mealMinutes,
    daysOff: schedule?.offDays,
    holidayDates: holidays.map((h) => h.date),
    pendingCorrectionDates: pendingCorrections.filter((c) => c.profileId === profileId).map((c) => c.workDate),
  });
  const split = splitRegularOvertimeWeekly(
    attendance.map((r) => ({ date: r.date, rawHours: r.hoursWorked })),
    {},
    8,
    CSR_WEEKLY_OVERTIME_THRESHOLD,
  );
  const rows: PayslipDailyRow[] = attendance
    .filter((r) => r.hoursWorked > 0)
    .map((r) => {
      const { regular, overtime } = split.get(r.date) ?? { regular: r.hoursWorked, overtime: 0 };
      const effective = entryEffectiveOn(rateHistory, r.date);
      const rate = effective ? (effective.compensationType === "hourly" ? effective.hourlyRate : 0) : payslip.hourlyRate;
      return {
        date: r.date,
        clockIn: r.clockIn,
        clockOut: r.clockOut,
        mealStart: r.mealStart,
        mealEnd: r.mealEnd,
        hours: r.hoursWorked,
        rate,
        amount: regular * rate + overtime * rate * 1.5,
      };
    });
  return { rows, schedule };
}

const escapeHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The template's data for one run, from its daily rows and the employee's details. */
export function assemblePayslipData(opts: {
  payslip: MyPayslipRow;
  dailyRows: PayslipDailyRow[];
  schedule: Pick<PayslipSchedule, "requiredCheckIn" | "requiredCheckOut" | "mealMinutes"> | null;
  displayName: string;
  email: string;
  role: string | null;
  hireDate: string | null;
  offDays: number[];
  assignedBranch: string;
  ptoRequests: { profileId: string; status: string; ptoType: string; startDate: string; endDate: string }[];
  /** Payroll's note for this period (migration 0399), when there is one. */
  periodNote: string | null | undefined;
}): EmployeePayslipData {
  const { payslip, dailyRows, schedule } = opts;
  const counts = dailyRows.length;
  const totalHours = dailyRows.reduce((s, r) => s + r.hours, 0);
  const offDays = offDaysInRange(opts.offDays, payslip.periodStart, payslip.periodEnd);
  const ptoUsed = ptoDaysInRange(opts.ptoRequests, payslip.periodStart, payslip.periodEnd, false);
  const sickLeave = ptoDaysInRange(opts.ptoRequests, payslip.periodStart, payslip.periodEnd, true);
  return {
    name: opts.displayName || "Employee",
    department: ROLE_LABELS[opts.role || ""] || opts.role || "",
    period: `${payslip.periodStart} to ${payslip.periodEnd}`,
    generatedDate: payslip.generatedAt ? new Date(payslip.generatedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "",
    dailyRows,
    grossPay: payslip.grossPay,
    netPay: payslip.netPay,
    email: opts.email || "—",
    hireDate: opts.hireDate || "—",
    workingHoursLabel:
      schedule?.requiredCheckIn && schedule?.requiredCheckOut ? `${formatClockTime(schedule.requiredCheckIn)} - ${formatClockTime(schedule.requiredCheckOut)}` : "—",
    breakLabel: schedule?.mealMinutes ? `${schedule.mealMinutes} mins Break` : "—",
    hourlyRate: payslip.hourlyRate,
    compensationType: payslip.compensationType,
    annualSalary: payslip.annualSalary,
    counts,
    totalHours,
    average: counts > 0 ? totalHours / counts : 0,
    offDays,
    ptoUsed,
    sickLeave,
    totalDays: offDays + ptoUsed,
    extraPay: payslip.extraPay,
    notes: [opts.periodNote, payslip.notes].filter(Boolean).map((t) => escapeHtml(String(t))).join("\n\n"),
    adjustments: payslip.adjustments,
    // Same US/PH split as AccountingDashboard.tsx's payrollRows: anyone not
    // assigned to the Philippines branch is treated as US.
    isUS: opts.assignedBranch !== "Philippines",
  };
}

/** Everything for one run, fetched here — for screens that don't already hold it (the mobile app). */
export async function buildMyPayslipData(opts: {
  profileId: string;
  uid: string | null;
  role: string | null;
  extraRoles?: string[] | null;
  displayName: string;
  payslip: MyPayslipRow;
}): Promise<EmployeePayslipData> {
  const { profileId, uid, payslip } = opts;
  const [{ rows, schedule }, profile, info, pto, notes] = await Promise.all([
    loadPayslipDailyRows({ profileId, uid, role: opts.role, extraRoles: opts.extraRoles, payslip }),
    uid ? getMyFullProfile(uid).catch(() => null) : Promise.resolve(null),
    getProfileEmployeeInfo(profileId).catch(() => null),
    getCompanyPtoRequests().catch(() => []),
    getMyPayrollNotes(profileId).catch(() => []),
  ]);
  return assemblePayslipData({
    payslip,
    dailyRows: rows,
    schedule,
    displayName: opts.displayName || profile?.displayName || "",
    email: profile?.email || "",
    role: opts.role,
    hireDate: info?.hireDate || null,
    offDays: schedule?.offDays ?? [],
    assignedBranch: profile?.assignedBranch ?? "",
    ptoRequests: pto.filter((r) => r.profileId === profileId),
    periodNote: notes.find((n) => n.periodStart === payslip.periodStart && n.periodEnd === payslip.periodEnd)?.body,
  });
}

/** Renders the payslip to a PDF and saves it (a download on desktop and Android; iOS opens it to save or share). */
export async function downloadPayslipPdf(data: EmployeePayslipData): Promise<void> {
  const { captureHtmlToPdfBlob } = await import("@/lib/pdfCapture");
  const blob = await captureHtmlToPdfBlob(renderPayslipBodyHtml(data), PAYSLIP_STYLES);
  const safe = (s: string) => s.replace(/[^\w.-]+/g, "_");
  const name = `Payslip_${safe(data.name)}_${safe(data.period.replace(" to ", "_to_"))}.pdf`;
  const file = new File([blob], name, { type: "application/pdf" });
  // Phones: the share sheet saves to Files / Downloads reliably where a link
  // download is ignored (iOS in-app browsers, home-screen apps).
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (typeof nav.share === "function" && nav.canShare?.({ files: [file] }) && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    try {
      await nav.share({ files: [file], title: name });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      // Share failed for another reason — fall through to a plain download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
