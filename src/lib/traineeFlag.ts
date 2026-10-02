/**
 * "Trainee" / "Trainee — not started yet" flag for attendance screens
 * (mobile Clock In Team, Attendance Monitoring → Missing Clock In).
 *
 * A trainee is employment_type "trainee". "Not started yet" means HR's
 * training start date (Hiring → hr_candidates.training_start_date, matched
 * to the profile by phone, then email — same match trainee payroll uses,
 * see fieldStartDate.ts) is still after the day being looked at, so a
 * missing clock-in that day is expected, not an absence.
 */
import { resolveTrainingRecord } from "@/lib/fieldStartDate";
import type { ProfileRow } from "@/lib/supabase/users";

export interface TrainingCandidate {
  email: string | null;
  phone: string | null;
  training_start_date: string | null;
  training_end_date: string | null;
}

export interface TraineeFlag {
  /** Training starts after `day`. */
  notStarted: boolean;
  /** HR's training start date (YYYY-MM-DD), when on file. */
  startDate: string | null;
}

export function traineeFlagFor(
  profile: Pick<ProfileRow, "employment_type" | "email" | "phone_number"> | null | undefined,
  candidates: TrainingCandidate[],
  day: string
): TraineeFlag | null {
  if (!profile || profile.employment_type !== "trainee") return null;
  const start = resolveTrainingRecord({ email: profile.email, phone_number: profile.phone_number, training_end_date: null }, candidates)?.training_start_date ?? null;
  return { notStarted: !!start && day < start, startDate: start };
}

/** "Trainee" or "Trainee — not started (starts Oct 6)". */
export function traineeFlagLabel(flag: TraineeFlag): string {
  if (!flag.notStarted) return "Trainee";
  const when = flag.startDate ? new Date(`${flag.startDate}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
  return `Trainee — not started${when ? ` (starts ${when})` : ""}`;
}
