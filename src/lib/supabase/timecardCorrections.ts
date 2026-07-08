/**
 * Supabase timecard corrections service — Attendance Monitoring "Corrections" tab.
 * See migration 0028: timecard_corrections + an append-only
 * timecard_correction_history audit trail populated by a DB trigger.
 */

import { supabase } from "./client";
import { createNotification } from "./notifications";

export type CorrectionStatus = "pending" | "approved" | "rejected";

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
  "id, profile_id, work_date, original_check_in, original_check_out, corrected_check_in, corrected_check_out, original_meal_start, original_meal_end, corrected_meal_start, corrected_meal_end, reason, status, requested_by, reviewed_by, reviewed_at, created_at";

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
  });
  if (error) {
    console.error("createTimecardCorrection error:", error.message);
    throw new Error(error.message);
  }
}

/**
 * Approve a correction: marks it approved (history is auto-logged by the DB
 * trigger) AND applies the corrected times to the real timecard_entries row
 * so the employee's actual timecard reflects the fix. Notifies the employee
 * of the outcome.
 */
export async function approveTimecardCorrection(
  correction: Pick<TimecardCorrectionRow, "id" | "profileId" | "workDate">,
  correctedCheckIn: string,
  correctedCheckOut: string,
  reviewerId?: string | null,
  reviewerName?: string | null,
  correctedMealStart?: string,
  correctedMealEnd?: string
): Promise<void> {
  const { error } = await supabase
    .from("timecard_corrections")
    .update({
      status: "approved",
      corrected_check_in: correctedCheckIn || null,
      corrected_check_out: correctedCheckOut || null,
      corrected_meal_start: correctedMealStart || null,
      corrected_meal_end: correctedMealEnd || null,
    })
    .eq("id", correction.id);
  if (error) {
    console.error("approveTimecardCorrection error:", error.message);
    throw new Error(error.message);
  }
  // Merge the corrected punch into the real timecard row — a corrected meal
  // time overrides whatever's there, but if none was given, preserve the
  // existing meal_start/meal_end/notes rather than clobbering them (a plain
  // upsert would null them out since they aren't part of every correction).
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
      check_in: correctedCheckIn || null,
      check_out: correctedCheckOut || null,
      meal_start: correctedMealStart || existing?.meal_start || null,
      meal_end: correctedMealEnd || existing?.meal_end || null,
      notes: existing?.notes ?? null,
    },
    { onConflict: "profile_id,work_date" }
  );
  if (upsertError) {
    console.error("approveTimecardCorrection timecard upsert error:", upsertError.message);
    throw new Error(upsertError.message);
  }
  await createNotification({
    recipientId: correction.profileId,
    senderId: reviewerId || null,
    senderName: reviewerName || "HR",
    body: `✅ Your time correction request for ${correction.workDate} was approved.`,
    linkTo: "/m/dashboard/employee-self-service?tab=requests",
  }).catch((err) => console.error("Failed to notify correction approval:", err));
}

/** Reject a correction — history is auto-logged by the DB trigger. Notifies the employee. */
export async function rejectTimecardCorrection(
  correction: Pick<TimecardCorrectionRow, "id" | "profileId" | "workDate">,
  reviewerId?: string | null,
  reviewerName?: string | null
): Promise<void> {
  const { error } = await supabase
    .from("timecard_corrections")
    .update({ status: "rejected" })
    .eq("id", correction.id);
  if (error) {
    console.error("rejectTimecardCorrection error:", error.message);
    throw new Error(error.message);
  }
  await createNotification({
    recipientId: correction.profileId,
    senderId: reviewerId || null,
    senderName: reviewerName || "HR",
    body: `❌ Your time correction request for ${correction.workDate} was rejected.`,
    linkTo: "/m/dashboard/employee-self-service?tab=requests",
  }).catch((err) => console.error("Failed to notify correction rejection:", err));
}
