/**
 * "Attendance starts on" — the first day an employee can be counted absent /
 * missing. A brand-new account often exists days before the person actually
 * starts (HR creates it when the hire is confirmed), and before this every
 * scheduled workday in between showed as an absence.
 *
 * It's the LATER of:
 *   - the Master List Hire Date (profiles.employee_info.hireDate), and
 *   - their HR Hiring record's Training Start Date, else Start Date
 *     (hr_candidates — matched to the account by phone first, then email,
 *     same as fieldStartDate.ts's resolveTrainingRecord).
 * Days before it are never counted. A date already in the past changes
 * nothing, so existing employees are unaffected. No date anywhere: counted
 * as before.
 *
 * Pure (no Supabase client) so the Worker's attendance alerts can share it.
 */

export interface AttendanceStartCandidate {
  email: string | null;
  phone: string | null;
  status?: string | null;
  training_start_date: string | null;
  start_date?: string | null;
}

const normalizePhone = (value: string | null | undefined) => {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
};

/** A withdrawn / cancelled application never starts — its dates don't count. */
const isDeadApplication = (status: string | null | undefined) => /withdraw|cancel|reject/i.test(status ?? "");

/** The HR Hiring date (training start, else start) for this account, or null. */
export function hiringStartDate(
  profile: { email: string | null; phone_number?: string | null },
  candidates: AttendanceStartCandidate[]
): string | null {
  const live = candidates.filter((c) => !isDeadApplication(c.status));
  const phone = normalizePhone(profile.phone_number);
  const email = profile.email?.trim().toLowerCase();
  const byPhone = phone ? live.filter((c) => normalizePhone(c.phone) === phone) : [];
  const matches = byPhone.length ? byPhone : email ? live.filter((c) => c.email?.trim().toLowerCase() === email) : [];
  const dates = matches.map((c) => c.training_start_date || c.start_date || null).filter((d): d is string => !!d);
  // Several records (re-application): the most recent date.
  return dates.sort().pop() ?? null;
}

/** The later of the Master List Hire Date and the HR Hiring start, or null when neither is set. */
export function attendanceStartDate(hireDate: string | null | undefined, hiringStart: string | null | undefined): string | null {
  const dates = [hireDate, hiringStart].filter((d): d is string => !!d).map((d) => d.slice(0, 10));
  return dates.sort().pop() ?? null;
}

/** True when `day` (YYYY-MM-DD) is before the employee's attendance start — never counted absent. */
export function isBeforeAttendanceStart(day: string, start: string | null | undefined): boolean {
  return !!start && day < start;
}
