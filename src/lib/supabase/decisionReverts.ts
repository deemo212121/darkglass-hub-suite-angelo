/**
 * Reverting a decision back to Pending, with a required note (migration 0431).
 * The database functions check who's allowed and write the permanent record;
 * this tells the employee and refreshes whatever depends on the change.
 */
import { supabase } from "./client";
import { createNotification } from "./notifications";
import { logModuleActivity } from "./moduleActivityLog";
import { refreshTicketAfterOnsiteRevert, setTicketOnsiteCheckIn } from "./tickets";
import { resetMileageRouteConfirmation } from "./mileage";
import { applyCorrectionToTimecard, restoreOriginalTimecard, type TimecardCorrectionRow } from "./timecardCorrections";
import { REVERT_STAGE_LABEL, type RevertRecordType, type RevertStage } from "@/lib/decisionRevertRules";

export interface DecisionRevert {
  id: string;
  recordType: RevertRecordType;
  recordId: string;
  stage: RevertStage | null;
  subjectName: string | null;
  label: string | null;
  previousStatus: string;
  previousDecidedByName: string | null;
  previousNote: string | null;
  revertedByName: string | null;
  note: string;
  details: Record<string, any>;
  createdAt: string;
}

const REQUESTS_LINK = "/m/dashboard/employee-self-service?tab=requests";

function friendly(error: { code?: string; message: string }): Error {
  if (error.code === "PGRST202" || error.code === "42883") return new Error("Revert needs the database update first (migration 0431).");
  return new Error(error.message);
}

/** Newest first. Empty if migration 0431 hasn't been run. */
export async function getDecisionReverts(recordType?: RevertRecordType): Promise<DecisionRevert[]> {
  let query = supabase.from("decision_reverts").select("*").order("created_at", { ascending: false }).limit(1000);
  if (recordType) query = query.eq("record_type", recordType);
  const { data, error } = await query;
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    recordType: r.record_type,
    recordId: r.record_id,
    stage: r.stage ?? null,
    subjectName: r.subject_name ?? null,
    label: r.label ?? null,
    previousStatus: r.previous_status,
    previousDecidedByName: r.previous_decided_by_name ?? null,
    previousNote: r.previous_note ?? null,
    revertedByName: r.reverted_by_name ?? null,
    note: r.note,
    details: r.details ?? {},
    createdAt: r.created_at,
  }));
}

/** Reverts one step of a Time-Off request. Returns the request's status afterwards. */
export async function revertPtoStage(
  request: { id: string; profileId: string; startDate: string; endDate: string },
  stage: RevertStage,
  note: string,
  by: { profileId: string | null; name: string }
): Promise<string> {
  const { data, error } = await supabase.rpc("revert_pto_stage", { p_id: request.id, p_stage: stage, p_note: note.trim() });
  if (error) throw friendly(error);
  const dates = request.startDate === request.endDate ? request.startDate : `${request.startDate} to ${request.endDate}`;
  await createNotification({
    recipientId: request.profileId,
    senderId: by.profileId ?? "",
    senderName: by.name,
    body: `↩️ ${by.name} reverted the ${REVERT_STAGE_LABEL[stage]} decision on your leave request (${dates}). Reason: ${note.trim()}`,
    linkTo: REQUESTS_LINK,
  }).catch((err) => console.error("Failed to notify about the leave revert:", err));
  void logModuleActivity({
    module: "attendance-monitoring",
    actorName: by.name,
    action: "pto_stage_reverted",
    targetType: "pto_request",
    targetId: request.id,
    targetLabel: dates,
    details: { stage, note: note.trim(), statusAfter: data },
  });
  return data as string;
}

/**
 * Reverts one step of a Time Correction. The timecard follows the overall
 * status: back to the actual times if it's no longer approved, or on to the
 * corrected times if reverting a rejection leaves it approved.
 */
export async function revertCorrectionStage(
  correction: TimecardCorrectionRow,
  stage: RevertStage,
  note: string,
  by: { profileId: string | null; name: string }
): Promise<string> {
  const { data, error } = await supabase.rpc("revert_correction_stage", { p_id: correction.id, p_stage: stage, p_note: note.trim() });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") throw new Error("Revert needs the database update first (migration 0432).");
    throw new Error(error.message);
  }
  const { status_before: before, status_after: after } = data as { status_before: string; status_after: string };
  const stageName = REVERT_STAGE_LABEL[stage];
  let timecardError = "";
  try {
    if (before === "approved" && after !== "approved") await restoreOriginalTimecard(correction);
    else if (before !== "approved" && after === "approved") await applyCorrectionToTimecard(correction);
  } catch (err) {
    timecardError = err instanceof Error ? err.message : "unknown error";
  }
  const timecardNote =
    before === "approved" && after !== "approved" ? " Your timecard is back to the actual times."
    : before !== "approved" && after === "approved" ? " It's approved and on your timecard."
    : "";
  await createNotification({
    recipientId: correction.profileId,
    senderId: by.profileId ?? "",
    senderName: by.name,
    body: `↩️ ${by.name} reverted the ${stageName} decision on your time correction for ${correction.workDate}.${timecardNote} Reason: ${note.trim()}`,
    linkTo: REQUESTS_LINK,
  }).catch((err) => console.error("Failed to notify about the correction revert:", err));
  void logModuleActivity({
    module: "attendance-monitoring",
    actorName: by.name,
    action: "timecard_correction_stage_reverted",
    targetType: "timecard_correction",
    targetId: correction.id,
    targetLabel: correction.workDate,
    details: { stage, note: note.trim(), statusBefore: before, statusAfter: after },
  });
  if (timecardError) throw new Error(`The decision was reverted, but the timecard couldn't be updated, so check it by hand: ${timecardError}`);
  return after;
}

/** Reverts a Ticket Dispute to Pending, putting the ticket's on-site times back if a copy was saved. */
export async function revertTicketDispute(
  dispute: { id: string; profileId: string },
  note: string,
  by: { profileId: string | null; name: string }
): Promise<{ timesRestored: boolean }> {
  const { data, error } = await supabase.rpc("revert_ticket_dispute", { p_id: dispute.id, p_note: note.trim() });
  if (error) throw friendly(error);
  const result = data as { ticket_no: string | null; was_approved: boolean; times_restored: boolean };
  if (result.times_restored && result.ticket_no) {
    // Its place in that day's visit order may have moved back.
    await resetMileageRouteConfirmation(result.ticket_no).catch((err) => console.error("Failed to invalidate mileage route order after dispute revert:", err));
    await refreshTicketAfterOnsiteRevert(result.ticket_no).catch((err) => console.error("Failed to refresh the ticket after dispute revert:", err));
  }
  await createNotification({
    recipientId: dispute.profileId,
    senderId: by.profileId ?? "",
    senderName: by.name,
    body: `↩️ ${by.name} reverted the decision on your ticket dispute${result.ticket_no ? ` (ticket ${result.ticket_no})` : ""}. It's back in review. Reason: ${note.trim()}`,
    linkTo: REQUESTS_LINK,
  }).catch((err) => console.error("Failed to notify about the dispute revert:", err));
  void logModuleActivity({
    module: "attendance-monitoring",
    actorName: by.name,
    action: "ticket_dispute_reverted",
    targetType: "ticket_dispute",
    targetId: dispute.id,
    targetLabel: result.ticket_no ? `Ticket ${result.ticket_no}` : "Ticket dispute",
    details: { note: note.trim(), timesRestored: result.times_restored },
  });
  return { timesRestored: result.times_restored };
}

/**
 * Approving a Ticket Dispute: writes the claimed times onto the ticket, first
 * keeping a copy of what's there so a Revert can put it back. A failed copy
 * never blocks the approval; that dispute's Revert just can't restore the times.
 */
export async function applyTicketDisputeTimes(dispute: {
  id: string;
  ticketNo: string | null;
  disputedStartTime: string | null;
  disputedEndTime: string | null;
}): Promise<void> {
  if (!dispute.ticketNo || !dispute.disputedStartTime || !dispute.disputedEndTime) return;
  try {
    const { data: ticket, error: readError } = await supabase.from("tickets").select("onsite_arrived_at, onsite_done_at").eq("ticket_no", dispute.ticketNo).maybeSingle();
    if (readError) throw readError;
    if (ticket) {
      const { error } = await supabase
        .from("employee_requests")
        .update({ original_onsite_arrived_at: ticket.onsite_arrived_at, original_onsite_done_at: ticket.onsite_done_at, original_onsite_saved_at: new Date().toISOString() })
        .eq("id", dispute.id)
        .is("original_onsite_saved_at", null);
      if (error) throw error;
    }
  } catch (err) {
    console.error("Couldn't keep a copy of the ticket's times before the dispute approval:", err);
  }
  // "arrived" first: it clears onsite_done_at, so "done" going first would be wiped out.
  await setTicketOnsiteCheckIn(dispute.ticketNo, "arrived", dispute.disputedStartTime);
  await setTicketOnsiteCheckIn(dispute.ticketNo, "done", dispute.disputedEndTime);
  // The corrected time can move this ticket earlier or later in its day's visit
  // order, so the next Mileage sync should re-chain it instead of skipping it.
  await resetMileageRouteConfirmation(dispute.ticketNo).catch((err) => console.error("Failed to invalidate mileage route order after dispute approval:", err));
}
