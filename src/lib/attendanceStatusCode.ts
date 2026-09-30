/**
 * Short attendance codes shared by Employee Monitoring → Attendance Status
 * and the Accounting Dashboard's per-employee Attendance table:
 *   CP  Completed  — checked in and out, not changed by anyone else
 *   CR  Corrected  — checked in and out, and someone other than the employee
 *                    changed it (HR direct edit stamps timecard_entries.
 *                    clocked_in_by; or an approved Time Correction)
 *   PD  Pending    — a Time Correction or PTO / Sick / Unpaid request for
 *                    the day is still awaiting approval
 *   PR  Pending for Review — the system clocked the employee out
 *                    automatically (home geofence or the end-of-day sweep)
 *                    and HR hasn't reviewed it yet
 * Missing days, rest days, holidays and approved leave get no code — the
 * existing status label (Absent / Missing Clock In/Out) already says it.
 */
import type { TimecardCorrectionRow } from "@/lib/supabase/timecardCorrections";

export type AttendanceCode = "CP" | "CR" | "PD" | "PR";

export const ATTENDANCE_CODE_LABEL: Record<AttendanceCode, string> = {
  CP: "Completed",
  CR: "Corrected",
  PD: "Pending",
  PR: "Pending for Review",
};

export const ATTENDANCE_CODE_CLASS: Record<AttendanceCode, string> = {
  CP: "bg-green-500/20 text-green-300 border-green-500/40",
  CR: "bg-violet-500/20 text-violet-300 border-violet-500/40",
  PD: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  PR: "bg-orange-500/20 text-orange-300 border-orange-500/40",
};

/** Line HR's "Mark reviewed" appends to the day's timecard notes. */
export const AUTO_CLOCKOUT_REVIEWED_PREFIX = "[Reviewed auto clock-out — ";

/**
 * Reads the day's timecard notes: was the Time Out written by the system
 * (both auto clock-out paths append "[Auto clock-out HH:MM:SS — …]"), and
 * has HR reviewed it since ("[Reviewed auto clock-out — Name]").
 */
export function autoClockOutInfo(notes: string | null | undefined): { auto: boolean; time: string | null; reviewedBy: string | null } {
  const text = notes ?? "";
  const m = /\[Auto clock-out (\d{1,2}:\d{2})/.exec(text);
  if (!m) return { auto: false, time: null, reviewedBy: null };
  const idx = text.lastIndexOf(AUTO_CLOCKOUT_REVIEWED_PREFIX);
  const reviewedBy = idx >= 0 ? text.slice(idx + AUTO_CLOCKOUT_REVIEWED_PREFIX.length).split("]")[0].trim() || "HR" : null;
  return { auto: true, time: m[1], reviewedBy };
}

/** The last stage approver on an approved Time Correction (manager / HR / accounting), or the overall reviewer. */
export function correctionApproverId(c: TimecardCorrectionRow): string | null {
  const stages = [
    { by: c.managerReviewedBy, at: c.managerReviewedAt, ok: c.managerStatus === "approved" },
    { by: c.hrReviewedBy, at: c.hrReviewedAt, ok: c.hrStatus === "approved" },
    { by: c.accountingReviewedBy, at: c.accountingReviewedAt, ok: c.accountingStatus === "approved" },
  ].filter((st) => st.ok && st.by);
  stages.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  return stages[0]?.by ?? c.reviewedBy ?? null;
}

/**
 * Code for one employee-day. `correctedById` is who changed it (or null);
 * `pending` is true when a correction or leave request for the day is
 * awaiting approval; `excused` covers rest days, holidays and approved leave.
 */
export function attendanceCodeFor(args: {
  checkIn: string;
  checkOut: string;
  pending: boolean;
  excused: boolean;
  correctedById: string | null;
  /** System auto clock-out not yet reviewed by HR (and not since corrected). */
  needsReview?: boolean;
  isFuture?: boolean;
  isToday?: boolean;
}): AttendanceCode | null {
  if (args.isFuture) return null;
  if (args.pending) return "PD";
  if (args.checkIn && args.checkOut) return args.correctedById ? "CR" : args.needsReview ? "PR" : "CP";
  return null;
}
