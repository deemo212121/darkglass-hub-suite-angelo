/**
 * Supabase timecard corrections service — Attendance Monitoring "Corrections" tab.
 * See migration 0028: timecard_corrections + an append-only
 * timecard_correction_history audit trail populated by a DB trigger.
 *
 * Approval is staged (0098_timecard_correction_two_stage_approval.sql,
 * quorum rule updated by 0270_timecard_correction_two_of_three_quorum.sql):
 * Manager, HR, and Accounting (the FINANCE role app-wide) can each review
 * independently at any time — none of the three is gated behind another
 * going first, so an unavailable manager doesn't stall a correction that
 * needs to land fast. Overall approval needs ANY 2 of the 3 stages to
 * approve; any single stage rejecting still rejects the whole request. The
 * legacy `status` column is derived server-side by a trigger from the three
 * stage columns, so existing code checking `status === "approved"` keeps
 * working unchanged.
 */

import { supabase } from "./client";
import { createNotification } from "./notifications";
import { getCompanyUsers } from "./users";
import { isAttendanceManagerTierRole } from "@/lib/roleLabels";

export type CorrectionStatus = "pending" | "approved" | "rejected";
export type CorrectionStage = "manager" | "hr" | "accounting";
export type ExceptionType = "missed_workday" | "late_early" | "missed_visit" | "other";
export type HrPaperworkStatus = "pending" | "approved" | "additional_review_required";

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
  // "Employee Attendance & Visit Exception Report" fields — folded directly
  // into this same request instead of a separate document type (see
  // timecardCorrectionPdf.ts). exceptionType/employee signature are
  // captured at submission; managerSignature is captured the instant the
  // manager stage is approved (any of the 5 places that can approve it);
  // the HR signature is a SEPARATE track from hrStatus (the quorum vote) —
  // see migration 0304's header comment for why.
  exceptionType: ExceptionType | null;
  otherDescription: string;
  employeeSignatureUrl: string | null;
  employeeSignatureName: string | null;
  employeeSignedAt: string | null;
  managerComments: string;
  managerSignatureUrl: string | null;
  managerSignatureName: string | null;
  managerSignedAt: string | null;
  hrPaperworkStatus: HrPaperworkStatus;
  hrSignatureUrl: string | null;
  hrSignatureName: string | null;
  hrSignedAt: string | null;
  hrReceivedDate: string | null;
  hrReviewerName: string | null;
  pdfUrl: string | null;
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
  "id, profile_id, work_date, original_check_in, original_check_out, corrected_check_in, corrected_check_out, original_meal_start, original_meal_end, corrected_meal_start, corrected_meal_end, reason, status, requested_by, reviewed_by, reviewed_at, created_at, manager_id, manager_status, manager_reviewed_by, manager_reviewed_at, hr_status, hr_reviewed_by, hr_reviewed_at, accounting_status, accounting_reviewed_by, accounting_reviewed_at, exception_type, other_description, employee_signature_url, employee_signature_name, employee_signed_at, manager_comments, manager_signature_url, manager_signature_name, manager_signed_at, hr_paperwork_status, hr_signature_url, hr_signature_name, hr_signed_at, hr_received_date, hr_reviewer_name, pdf_url";

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
    exceptionType: row.exception_type ?? null,
    otherDescription: row.other_description ?? "",
    employeeSignatureUrl: row.employee_signature_url ?? null,
    employeeSignatureName: row.employee_signature_name ?? null,
    employeeSignedAt: row.employee_signed_at ?? null,
    managerComments: row.manager_comments ?? "",
    managerSignatureUrl: row.manager_signature_url ?? null,
    managerSignatureName: row.manager_signature_name ?? null,
    managerSignedAt: row.manager_signed_at ?? null,
    hrPaperworkStatus: row.hr_paperwork_status ?? "pending",
    hrSignatureUrl: row.hr_signature_url ?? null,
    hrSignatureName: row.hr_signature_name ?? null,
    hrSignedAt: row.hr_signed_at ?? null,
    hrReceivedDate: row.hr_received_date ?? null,
    hrReviewerName: row.hr_reviewer_name ?? null,
    pdfUrl: row.pdf_url ?? null,
  };
}

// Supabase caps an unbounded select at 1000 rows — a company's full
// correction (or correction-history) log can exceed that. Page through in
// chunks of 1000.
const PAGE_SIZE = 1000;

/** All timecard corrections for the caller's company (RLS-scoped), newest first. */
export async function getCompanyTimecardCorrections(): Promise<TimecardCorrectionRow[]> {
  const all: TimecardCorrectionRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("timecard_corrections")
      .select(SELECT_COLUMNS)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error("getCompanyTimecardCorrections error:", error.message);
      return [];
    }
    all.push(...(data ?? []).map(mapRow));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

/** The full correction-history audit trail for the company, newest first. */
export async function getCompanyTimecardCorrectionHistory(): Promise<TimecardCorrectionHistoryRow[]> {
  const all: TimecardCorrectionHistoryRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("timecard_correction_history")
      .select("id, correction_id, action, changed_by, previous_status, new_status, created_at")
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error("getCompanyTimecardCorrectionHistory error:", error.message);
      return [];
    }
    all.push(
      ...(data ?? []).map((row: any) => ({
        id: row.id,
        correctionId: row.correction_id,
        action: row.action,
        changedBy: row.changed_by ?? null,
        previousStatus: row.previous_status ?? null,
        newStatus: row.new_status ?? null,
        createdAt: row.created_at,
      }))
    );
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

/** Range query for consumers that need to know WHERE a correction is pending
 * (profileId + date) — mirrors getCompanyHolidaysInRange's shape in
 * companyHolidays.ts. "pending" here is the trigger-derived overall status:
 * not yet reviewed, or manager-approved but still awaiting HR/Accounting.
 * Returns full rows (not just profileId/workDate) so callers that want to
 * show the actual requested correction (reason, corrected times, per-stage
 * status) — e.g. a detail popup — don't need a second fetch. */
export async function getPendingCorrectionsInRange(startDate: string, endDate: string): Promise<TimecardCorrectionRow[]> {
  const { data, error } = await supabase
    .from("timecard_corrections")
    .select(SELECT_COLUMNS)
    .eq("status", "pending")
    .gte("work_date", startDate)
    .lte("work_date", endDate);
  if (error) {
    console.error("getPendingCorrectionsInRange error:", error.message);
    return [];
  }
  return (data ?? []).map(mapRow);
}

/**
 * Can `viewerProfileId` (with `viewerRole`) act on the given approval stage?
 * The manager stage is for the specific resolved direct manager (or anyone
 * with the generic MANAGER role as a stand-in if none was resolved at
 * submission time). HR and Accounting (the FINANCE role app-wide — see
 * dashboardAccess.ts's "accounting-dashboard": ["ADMIN","FINANCE"]) can act
 * at any time — all three stages are open in parallel, not gated behind the
 * manager going first, so an unavailable manager doesn't block a correction
 * that needs to land fast. See sync_timecard_correction_overall_status
 * (migration 0270) for the "any 2 of 3 approve" quorum that decides overall
 * approval from these three independent stage columns. Both SUPERADMIN (a
 * company's own top-tier admin) and SUPERSUPERADMIN (the platform-level
 * role) bypass every stage, same as PTO — a single approval from either is
 * final.
 */
export function canReviewCorrectionStage(
  request: Pick<TimecardCorrectionRow, "managerId">,
  stage: CorrectionStage,
  viewerProfileId: string | null,
  viewerRole: string | null | undefined,
  viewerExtraRoles?: string[] | null,
  /** The viewer's own display_name — only needed for the current-manager
   *  and manager's-manager fallbacks below; every existing caller that
   *  omits it just loses those fallbacks, not correctness for the common
   *  case. */
  viewerDisplayName?: string | null,
  /** The requester's CURRENT manager_name (profiles.manager_name), looked
   *  up fresh by the caller — NOT request.managerId, which is a one-time
   *  snapshot resolved at submission. Mirrors canReviewPtoStage's
   *  requesterCurrentManagerName: request.managerId can go stale (a
   *  reassignment, a CSR team-lead swap, or the resolver picking the wrong
   *  person originally) and would otherwise strand the request with nobody
   *  who has real, current authority over it able to act. */
  requesterCurrentManagerName?: string | null,
  /** The requester's manager's OWN manager_name (profiles.manager_name of
   *  whoever request.managerId resolved to), looked up fresh by the
   *  caller — same "walk up one level" fallback canReviewPtoStage uses.
   *  Lets that person (a senior manager, in practice) also act on the
   *  manager stage when the direct manager is unavailable, scoped only to
   *  this requester's own chain, not senior managers in general. */
  requesterManagersManagerName?: string | null
): boolean {
  // Held roles pile up: a secondary HR/FINANCE/MANAGER role grants that
  // stage's authority just as well as holding it as the primary role.
  const heldRoles = [viewerRole, ...(viewerExtraRoles ?? [])].map((r) => (r || "").toUpperCase()).filter(Boolean);
  const has = (r: string) => heldRoles.includes(r);
  if (has("SUPERADMIN") || has("SUPERSUPERADMIN")) return true;
  if (stage === "manager") {
    if (request.managerId === viewerProfileId) return true;
    const currentManagerName = (requesterCurrentManagerName || "").trim().toLowerCase();
    const managersManagerName = (requesterManagersManagerName || "").trim().toLowerCase();
    const viewerName = (viewerDisplayName || "").trim().toLowerCase();
    if (currentManagerName && viewerName && currentManagerName === viewerName) return true;
    if (managersManagerName && viewerName && managersManagerName === viewerName) return true;
    if (request.managerId) return false;
    // Any attendance manager-tier role (CSR_MANAGER, CSR_TEAM_LEADER,
    // BRANCH_MANAGER, TECHNICIAN_MANAGER, ...) can stand in here, not just
    // the literal "MANAGER" role string — a correction whose managerId
    // never resolved at submission time (no manager_name match, or the CSR
    // team-lead lookup found nobody) still needs SOME manager-tier person
    // able to act on it, and restricting that to one specific role code
    // left every other manager-tier role — CSR chief among them — locked
    // out of ever approving these.
    return isAttendanceManagerTierRole(viewerRole, viewerExtraRoles);
  }
  if (stage === "hr") return has("HR");
  return has("FINANCE");
}

/**
 * Submit a new correction request on behalf of an employee (profileId).
 * Every submission now carries the "Employee Attendance & Visit Exception
 * Report" fields (exceptionType + the employee's own signature) — see
 * migration 0304 and timecardCorrectionPdf.ts, which builds/uploads the PDF
 * and the signature image BEFORE this call using a client-generated `id` (so
 * the storage path can be keyed by the row's id before the row exists —
 * same pre-generated-key pattern MobileTicketTimeDisputeView already uses
 * for its own attachments) and passes the resulting URLs in here.
 */
export async function createTimecardCorrection(input: {
  id: string;
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
  /**
   * Optional — AttendanceMonitoringPage.tsx's own "file a correction on
   * behalf of an employee" utility (HR/Admin fixing someone's punch
   * directly, the employee not present to sign anything) still creates a
   * plain correction with no exception paperwork. Every technician-facing
   * self-service submission (EmployeeSelfServicePage.tsx, mobile) always
   * provides these — see buildCorrectionSubmissionPdf.
   */
  exceptionType?: ExceptionType;
  otherDescription?: string;
  employeeSignatureUrl?: string;
  employeeSignatureName?: string;
  pdfUrl?: string;
}): Promise<void> {
  const { error } = await supabase.from("timecard_corrections").insert({
    id: input.id,
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
    exception_type: input.exceptionType ?? null,
    other_description: input.otherDescription || null,
    employee_signature_url: input.employeeSignatureUrl ?? null,
    employee_signature_name: input.employeeSignatureName ?? null,
    employee_signed_at: input.employeeSignatureUrl ? new Date().toISOString() : null,
    pdf_url: input.pdfUrl ?? null,
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
 * On final approval (any 2 of the 3 stages approved — read back from the DB
 * after the update, since the overall `status` is derived server-side by a
 * trigger) the corrected punch is merged into the
 * real timecard_entries row, exactly like the old single-stage
 * approveTimecardCorrection used to do immediately. On rejection at any
 * stage, or on just one of the three approving so far, only a notification
 * goes out — nothing is applied to the employee's timecard yet.
 */
export async function reviewCorrectionStage(
  correction: Pick<TimecardCorrectionRow, "id" | "profileId" | "workDate" | "managerId">,
  stage: CorrectionStage,
  decision: "approved" | "rejected",
  reviewerId: string,
  reviewerName: string,
  corrected?: { checkIn?: string; checkOut?: string; mealStart?: string; mealEnd?: string },
  /**
   * Only meaningful when stage === "manager" && decision === "approved" —
   * the paper form's Manager/SBM Review & Approval signature, captured the
   * instant the manager clicks Approve (every one of the 5 places that can
   * approve a correction passes this the same way). `pdfUrl` is the
   * already-rendered-and-uploaded PDF with this signature stamped on
   * (built by timecardCorrectionPdf.ts BEFORE this call, same convention
   * as every other signable-document flow in this app: render/upload in
   * the caller, persist the URL here).
   */
  signature?: { url: string; name: string; comments: string; pdfUrl: string }
): Promise<void> {
  const nowIso = new Date().toISOString();
  const stagePayload: Record<string, unknown> =
    stage === "manager"
      ? { manager_status: decision, manager_reviewed_by: reviewerId, manager_reviewed_at: nowIso }
      : stage === "hr"
        ? { hr_status: decision, hr_reviewed_by: reviewerId, hr_reviewed_at: nowIso }
        : { accounting_status: decision, accounting_reviewed_by: reviewerId, accounting_reviewed_at: nowIso };

  if (stage === "manager" && decision === "approved" && signature) {
    stagePayload.manager_signature_url = signature.url;
    stagePayload.manager_signature_name = signature.name;
    stagePayload.manager_signed_at = nowIso;
    stagePayload.manager_comments = signature.comments || null;
    stagePayload.pdf_url = signature.pdfUrl;
  }

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

  // Exactly one of the three stages has approved so far (still "pending"
  // overall) — ping whoever holds the OTHER two stages that one more
  // approval (from any of them) finalizes it. Manager, HR, and Accounting
  // are symmetric under the 2-of-3 quorum, so this fires regardless of
  // which stage just acted, not just the manager.
  if (updated.status === "pending") {
    try {
      const roster = await getCompanyUsers();
      const requesterName = roster.find((p) => p.id === correction.profileId)?.display_name || "An employee";
      const recipients = roster.filter((p) => {
        if (p.id === reviewerId || !p.is_active) return false;
        const heldRoles = [p.role, ...(p.extra_roles ?? [])].map((r) => (r || "").toUpperCase());
        const isManager = correction.managerId ? p.id === correction.managerId : heldRoles.includes("MANAGER");
        const isHr = heldRoles.includes("HR");
        const isFinance = heldRoles.includes("FINANCE");
        if (stage === "manager") return isHr || isFinance;
        if (stage === "hr") return isManager || isFinance;
        return isManager || isHr; // stage === "accounting"
      });
      const stageDoneLabel = stage === "manager" ? "the manager" : stage === "hr" ? "HR" : "Accounting";
      await Promise.all(
        recipients.map((r) =>
          createNotification({
            recipientId: r.id,
            senderId: reviewerId,
            senderName: reviewerName,
            body: `⏱️ Time correction for ${requesterName} (${correction.workDate}) was approved by ${stageDoneLabel} — one more approval (Manager, HR, or Accounting) finalizes it.`,
            linkTo: "/m/dashboard/attendance-monitoring?tab=corrections",
          })
        )
      );
    } catch (err) {
      console.error("Failed to notify remaining stages of pending correction:", err);
    }
  }
}

/**
 * The paper form's "5. HR Department Use Only" sign-off. This function
 * itself only ever touches the hr_paperwork_* columns — it stays
 * independent of reviewCorrectionStage's hr_status quorum vote at the DB
 * level, since Accounting can still cast that quorum's second vote and
 * finalize the correction without an actual HR person ever touching the
 * paperwork. Callable independently of whether hrStatus/accountingStatus
 * have already resolved the correction — an HR person can catch up on the
 * paperwork after the fact.
 *
 * CorrectionHrSignModal.tsx (the only caller) additionally calls
 * reviewCorrectionStage(..., "hr", "approved") right after this, whenever
 * the action status is "Approved" and hrStatus is still "pending" — signing
 * as HR is the ONLY way to cast the HR quorum vote on an exception-report
 * row, since every plain one-click "Approve (HR)" button in the UI is
 * hidden for those rows precisely so it can't happen without a signature.
 * "Additional Review Required" never votes.
 */
export async function signCorrectionHrPaperwork(
  correctionId: string,
  reviewerId: string,
  reviewerName: string,
  signature: { url: string; name: string },
  hrReceivedDate: string,
  hrActionStatus: Exclude<HrPaperworkStatus, "pending">,
  pdfUrl: string
): Promise<void> {
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("timecard_corrections")
    .update({
      hr_paperwork_status: hrActionStatus,
      hr_signature_url: signature.url,
      hr_signature_name: signature.name,
      hr_signed_at: nowIso,
      hr_received_date: hrReceivedDate || null,
      hr_reviewer_name: reviewerName,
      pdf_url: pdfUrl,
    })
    .eq("id", correctionId);
  if (error) {
    console.error("signCorrectionHrPaperwork error:", error.message);
    throw new Error(error.message);
  }
}

/** Swaps in a freshly re-rendered PDF (see timecardCorrectionPdf.ts's regenerateCorrectionPdf) — no signature/status change, just the file. */
export async function updateCorrectionPdfUrl(correctionId: string, pdfUrl: string): Promise<void> {
  const { error } = await supabase.from("timecard_corrections").update({ pdf_url: pdfUrl }).eq("id", correctionId);
  if (error) {
    console.error("updateCorrectionPdfUrl error:", error.message);
    throw new Error(error.message);
  }
}
