/**
 * "This technician's payroll has been reviewed for this pay period" — set
 * when Finance clicks Done at the end of the Office Payroll review wizard
 * (attendance detail -> Tech Activity Report -> Done). Drives the
 * "Reviewed ✓" badge on the Accounting Dashboard's Office Payroll table.
 * Period-scoped (see migration 0218): a mark belongs to one
 * (profile, period_start, period_end).
 */
import { supabase } from "./client";

export interface PayrollReviewMark {
  reviewedAt: string;
  reviewedByName: string | null;
}

/** profile_id -> mark, for one pay period. */
export async function getPayrollReviewMarks(periodStart: string, periodEnd: string): Promise<Map<string, PayrollReviewMark>> {
  const { data, error } = await supabase
    .from("payroll_review_marks")
    .select("profile_id, reviewed_at, reviewed_by_name")
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd);
  if (error) throw new Error(error.message);
  const out = new Map<string, PayrollReviewMark>();
  for (const r of (data ?? []) as Array<{ profile_id: string; reviewed_at: string; reviewed_by_name: string | null }>) {
    out.set(r.profile_id, { reviewedAt: r.reviewed_at, reviewedByName: r.reviewed_by_name });
  }
  return out;
}

export async function markPayrollReviewed(
  profileId: string,
  periodStart: string,
  periodEnd: string,
  reviewedBy: string | null,
  reviewedByName: string | null,
): Promise<void> {
  const { error } = await supabase.from("payroll_review_marks").upsert(
    {
      profile_id: profileId,
      period_start: periodStart,
      period_end: periodEnd,
      reviewed_by: reviewedBy,
      reviewed_by_name: reviewedByName,
    },
    { onConflict: "company_id,profile_id,period_start,period_end" },
  );
  if (error) throw new Error(error.message);
}

export async function clearPayrollReviewMark(profileId: string, periodStart: string, periodEnd: string): Promise<void> {
  const { error } = await supabase
    .from("payroll_review_marks")
    .delete()
    .eq("profile_id", profileId)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd);
  if (error) throw new Error(error.message);
}
