/**
 * Supabase timecard corrections service — Attendance Monitoring "Corrections" tab.
 * See migration 0028: timecard_corrections + an append-only
 * timecard_correction_history audit trail populated by a DB trigger.
 *
 * Approval is staged (0098_timecard_correction_two_stage_approval.sql),
 * mirroring pto_requests' manager+HR pattern but with a different shape:
 * the employee's direct manager reviews first, then EITHER HR or Accounting
 * (the FINANCE role app-wide) gives the final approval — an OR gate, not an
 * AND like PTO's manager+HR. The legacy `status` column is derived
 * server-side by a trigger from the three stage columns, so existing code
 * checking `status === "approved"` keeps working unchanged.
 */

import { supabase } from "./client";
import { createNotification } from "./notifications";
import { getCompanyUsers } from "./users";

export type CorrectionStatus = "pending" | "approved" | "rejected";
export type CorrectionStage = "manager" | "hr" | "accounting";

export interface TimecardCorrectionRow {
  id: string;
  profileId: string;
  workDate: string;
  originalCheckIn: string;
  originalCheckOut: string;
  correctedCheckIn: string;
  correctedCheckOut: string;
  originalMealStart: string;
  originalMealEnd: string;
  correctedMealStart: string;
  correctedMealEnd: string;
  reason: string;
  status: CorrectionStatus;
  requestedBy: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  managerId: string | null;
  managerStatus: CorrectionStatus;
  managerReviewedBy: string | null;
  managerReviewedAt: string | null;
  hrStatus: CorrectionStatus;
  hrReviewedBy: string | null;
  hrReviewedAt: string | null;
  accountingStatus: CorrectionStatus;
  accountingReviewedBy: string | null;
  accountingReviewedAt: string | null;
}

export interface TimecardCorrectionHistoryRow {
  id: string;
  correctionId: string;
  action: string;
  changedBy: string | null;
  previousStatus: string | null;
  newStatus: string | null;
  createdAt: string;
}

const SELECT_COLUMNS =
  "id, profile_id, work_date, original_check_in, original_check_out, corrected_check_in, corrected_check_out, original_meal_start, original_meal_end, corrected_meal_start, corrected_meal_end, reason, status, requested_by, reviewed_by, reviewed_at, created_at, manager_id, manager_status, manager_reviewed_by, manager_reviewed_at, hr_status, hr_reviewed_by, hr_reviewed_at, accounting_status, accounting_reviewed_by, accounting_reviewed_at";

function mapRow(row: any): TimecardCorrectionRow {
  return {
    id: row.id,
    profileId: row.profile_id,
    workDate: row.work_date,
    originalCheckIn: row.original_check_in ?? "",
    originalCheckOut: row.original_check_out ?? "",
    correctedCheckIn: row.corrected_check_in ?? "",
    correctedCheckOut: row.corrected_check_out ?? "",
    originalMealStart: row.original_meal_start ?? "",
    originalMealEnd: row.original_meal_end ?? "",
    correctedMealStart: row.corrected_meal_start ?? "",
    correctedMealEnd: row.corrected_meal_end ?? "",
    reason: row.reason ?? "",
    status: row.status,
    requestedBy: row.requested_by ?? null,
    reviewedBy: row.reviewed_by ?? null,
    reviewedAt: row.reviewed_at ?? null,
    createdAt: row.created_at,
    managerId: row.manager_id ?? null,
    managerStatus: row.manager_status,
    managerReviewedBy: row.manager_reviewed_by ?? null,
    managerReviewedAt: row.manager_reviewed_at ?? null,
    hrStatus: row.hr_status,
    hrReviewedBy: row.hr_reviewed_by ?? null,
    hrReviewedAt: row.hr_reviewed_at ?? null,
    accountingStatus: row.accounting_status,
    accountingReviewedBy: row.accounting_reviewed_by ?? null,
    accountingReviewedAt: row.accounting_reviewed_at ?? null,
  };
}

/** All timecard corrections for the caller's company (RLS-scoped), newest first. */
export async function getCompanyTimecardCorrections(): Promise<TimecardCorrectionRow[]> {
  const { data, error } = await supabase
    .from("timecard_corrections")
    .select(SELECT_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("getCompanyTimecardCorrections error:", error.message);
    return [];
  }
  return (data ?? []).map(mapRow);
}

/** The full correction-history audit trail for the company, newest first. */
export async function getCompanyTimecardCorrectionHistory(): Promise<TimecardCorrectionHistoryRow[]> {
  const { data, error } = await supabase
    .from("timecard_correction_history")
    .select("id, correction_id, action, changed_by, previous_status, new_status, created_at")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("getCompanyTimecardCorrectionHistory error:", error.message);
    return [];
  }
  return (data ?? []).map((row: any) => ({
    id: row.id,
    correctionId: row.correction_id,
    action: row.action,
    changedBy: row.changed_by ?? null,
    previousStatus: row.previous_status ?? null,
    newStatus: row.new_status ?? null,
    createdAt: row.created_at,
  }));
}

/**
 * Can `viewerProfileId` (with `viewerRole`) act on the given approval stage?
 * The manager stage is for the specific resolved direct manager (or anyone
 * with the generic MANAGER role as a stand-in if none was resolved at
 * submission time). HR and Accounting (the FINANCE role app-wide — see
 * dashboardAccess.ts's "accounting-dashboard": ["ADMIN","FINANCE"]) can only
 * act once the manager has approved, and either one alone is sufficient —
 * this is an OR gate, unlike PTO's manager+HR AND gate. Both SUPERADMIN (a
 * company's own top-tier admin) and SUPERSUPERADMIN (the platform-level
 * role) bypass every stage, same as PTO — a single approval from either is
 * final.
 */
export function canReviewCorrectionStage(
  request: Pick<TimecardCorrectionRow, "managerId" | "managerStatus">,
  stage: CorrectionStage,
  viewerProfileId: string | null,
  viewerRole: string | null | undefined
): boolean {
  const role = (viewerRole || "").toUpperCase();
  if (role === "SUPERADMIN" || role === "SUPERSUPERADMIN") return true;
  if (stage === "manager") {
    if (request.managerId) return request.managerId === viewerProfileId;
    return role === "MANAGER";
  }
  if (request.managerStatus !== "approved") return false;
  if (stage === "hr") return role === "HR";
  return role === "FINANCE";
}

/** Submit a new correction request on behalf of an employee (profileId). */
export async function createTimecardCorrection(input: {
  profileId: string;
  workDate: string;
  originalCheckIn: string;
  originalCheckOut: string;
  correctedCheckIn: string;
  correctedCheckOut: string;
  originalMealStart?: string;
  originalMealEnd?: string;
  correctedMealStart?: string;
  correctedMealEnd?: string;
  reason: string;
  requestedBy: string | null;
  managerId?: string | null;
}): Promise<void> {
  const { error } = await supabase.from("timecard_corrections").insert({
    profile_id: input.profileId,
    work_date: input.workDate,
    original_check_in: input.originalCheckIn || null,
    original_check_out: input.originalCheckOut || null,
    corrected_check_in: input.correctedCheckIn || null,
    corrected_check_out: input.correctedCheckOut || null,
    original_meal_start: input.originalMealStart || null,
    original_meal_end: input.originalMealEnd || null,
    corrected_meal_start: input.correctedMealStart || null,
    corrected_meal_end: input.correctedMealEnd || null,
    reason: input.reason || null,
    status: "pending",
    requested_by: input.requestedBy,
    manager_id: input.managerId ?? null,
  });
  if (error) {
    console.error("createTimecardCorrection error:", error.message);
    throw new Error(error.message);
  }
}

/**
 * Record a manager/HR/Accounting decision on one stage of a correction
 * request. `corrected` optionally updates the proposed corrected punch —
 * any reviewing stage may adjust it, not just whoever submitted it.
 *
 * On final approval (manager approved AND (HR or Accounting) approved —
 * read back from the DB after the update, since the overall `status` is
 * derived server-side by a trigger) the corrected punch is merged into the
 * real timecard_entries row, exactly like the old single-stage
 * approveTimecardCorrection used to do immediately. On rejection at any
 * stage, or on a manager-only approval still awaiting HR/Accounting, only a
 * notification goes out — nothing is applied to the employee's timecard yet.
 */
export async function reviewCorrectionStage(
  correction: Pick<TimecardCorrectionRow, "id" | "profileId" | "workDate">,
  stage: CorrectionStage,
  decision: "approved" | "rejected",
  reviewerId: string,
  reviewerName: string,
  corrected?: { checkIn?: string; checkOut?: string; mealStart?: string; mealEnd?: string }
): Promise<void> {
  const nowIso = new Date().toISOString();
  const stagePayload: Record<string, unknown> =
    stage === "manager"
      ? { manager_status: decision, manager_reviewed_by: reviewerId, manager_reviewed_at: nowIso }
      : stage === "hr"
        ? { hr_status: decision, hr_reviewed_by: reviewerId, hr_reviewed_at: nowIso }
        : { accounting_status: decision, accounting_reviewed_by: reviewerId, accounting_reviewed_at: nowIso };

  if (corrected?.checkIn !== undefined) stagePayload.corrected_check_in = corrected.checkIn || null;
  if (corrected?.checkOut !== undefined) stagePayload.corrected_check_out = corrected.checkOut || null;
  if (corrected?.mealStart !== undefined) stagePayload.corrected_meal_start = corrected.mealStart || null;
  if (corrected?.mealEnd !== undefined) stagePayload.corrected_meal_end = corrected.mealEnd || null;

  const { data, error } = await supabase
    .from("timecard_corrections")
    .update(stagePayload)
    .eq("id", correction.id)
    .select(SELECT_COLUMNS)
    .single();
  if (error) {
    console.error("reviewCorrectionStage error:", error.message);
    throw new Error(error.message);
  }
  const updated = mapRow(data);
  const stageLabel = stage === "manager" ? "your manager" : stage === "hr" ? "HR" : "Accounting";

  if (decision === "rejected") {
    await createNotification({
      recipientId: correction.profileId,
      senderId: reviewerId,
      senderName: reviewerName,
      body: `❌ Your time correction request for ${correction.workDate} was rejected by ${stageLabel}.`,
      linkTo: "/m/dashboard/employee-self-service?tab=requests",
    }).catch((err) => console.error("Failed to notify correction rejection:", err));
    return;
  }

  if (updated.status === "approved") {
    // Final approval — merge the corrected punch into the real timecard
    // row. A corrected meal time overrides whatever's there, but if none
    // was given, preserve the existing meal_start/meal_end/notes rather
    // than clobbering them (a plain upsert would null them out since they
    // aren't part of every correction).
    const { data: existing } = await supabase
      .from("timecard_entries")
      .select("meal_start, meal_end, notes")
      .eq("profile_id", correction.profileId)
      .eq("work_date", correction.workDate)
      .maybeSingle();
    const { error: upsertError } = await supabase.from("timecard_entries").upsert(
      {
        profile_id: correction.profileId,
        work_date: correction.workDate,
        check_in: updated.correctedCheckIn || null,
        check_out: updated.correctedCheckOut || null,
        meal_start: updated.correctedMealStart || existing?.meal_start || null,
        meal_end: updated.correctedMealEnd || existing?.meal_end || null,
        notes: existing?.notes ?? null,
      },
      { onConflict: "profile_id,work_date" }
    );
    if (upsertError) {
      console.error("reviewCorrectionStage timecard upsert error:", upsertError.message);
      throw new Error(upsertError.message);
    }
    await createNotification({
      recipientId: correction.profileId,
      senderId: reviewerId,
      senderName: reviewerName,
      body: `✅ Your time correction request for ${correction.workDate} was approved.`,
      linkTo: "/m/dashboard/employee-self-service?tab=requests",
    }).catch((err) => console.error("Failed to notify correction approval:", err));
    return;
  }

  // Manager-only approval so far — ping HR and Accounting that it's their turn.
  if (stage === "manager") {
    try {
      const roster = await getCompanyUsers();
      const requesterName = roster.find((p) => p.id === correction.profileId)?.display_name || "An employee";
      const recipients = roster.filter(
        (p) => ["HR", "FINANCE"].includes((p.role || "").toUpperCase()) && p.id !== reviewerId
      );
      await Promise.all(
        recipients.map((r) =>
          createNotification({
            recipientId: r.id,
            senderId: reviewerId,
            senderName: reviewerName,
            body: `⏱️ Time correction for ${requesterName} (${correction.workDate}) was approved by the manager — awaiting HR or Accounting review.`,
            linkTo: "/m/dashboard/attendance-monitoring?tab=corrections",
          })
        )
      );
    } catch (err) {
      console.error("Failed to notify HR/Accounting of pending correction:", err);
    }
  }
}
