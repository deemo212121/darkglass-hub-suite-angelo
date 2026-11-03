/**
 * Technician incentives — the rules (no Supabase client; the page and the
 * data layer in supabase/techIncentives.ts share them).
 *
 * When a technician reaches 6 months, counted from their start date (the
 * later of the Master List Hire Date and their HR Hiring training / start
 * date — the same "attendance starts on" day as everywhere else; with
 * neither, they aren't counted until HR adds one):
 *   - HR Incentive, $100, to the HR recruiter credited with the hire
 *     (Colleen, Wincel or Kyle — HR picks; the Hiring record's creator
 *     fills it in when it's one of them);
 *   - Branch Manager Incentive, $500, when the technician is still
 *     employed and their 6-month average grade is C or better (the
 *     Technician Performance grade, averaged over every graded pay period
 *     in the 6 months);
 *   - Technician Matching Incentive, $500 to the technician, added the
 *     moment the Branch Manager's incentive is approved.
 * HR submits, Accounting approves, and approving puts it on payroll.
 * Counts technicians whose 6-month mark is on or after the program start.
 */

export type IncentiveKind = "hr" | "branch_manager" | "technician_match";

export const INCENTIVE_AMOUNT: Record<IncentiveKind, number> = { hr: 100, branch_manager: 500, technician_match: 500 };

export const INCENTIVE_LABEL: Record<IncentiveKind, string> = {
  hr: "HR Incentive",
  branch_manager: "Branch Manager Incentive",
  technician_match: "Technician Matching Incentive",
};

/** Technicians reaching 6 months on or after this day count. */
export const INCENTIVE_PROGRAM_START = "2026-11-03";

/** HR recruiters who earn the HR Incentive, by profile id. To add someone, add them here. */
export const HR_INCENTIVE_RECRUITERS: Record<string, string> = {
  "e4fede96-7f43-495c-968e-9c285c507a00": "Colleen Tac-on",
  "18ca4ceb-5fca-43f3-b25c-9e5e7f45e40a": "Wincel Franz Carusca",
  "4fd23d15-8f70-415e-bb20-2d485345efb0": "Kyle Jomarc Sicat",
};

/** Technician Performance points for a C (5–6 pts) — the Branch Manager Incentive needs the 6-month average at or above this. */
export const MIN_GRADE_POINTS = 5;

/** `iso` plus `months` calendar months; a day the month doesn't have becomes its last day (Aug 31 + 6 → Feb 28). */
export function addMonthsISO(iso: string, months: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

export const sixMonthDate = (startDate: string) => addMonthsISO(startDate, 6);

/** Days from `today` until `target` (negative once it's passed). */
export function daysUntil(target: string, today: string): number {
  return Math.round((Date.parse(`${target}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}
