/**
 * Supabase employee-requests service — Employee Self-Service "My Requests"
 * tab, and Payroll Dispute / Ticket Time Dispute on the mobile tech app.
 * Covers attendance disputes (legacy, no longer created — see
 * ticket_time_dispute below), payroll inquiries, payroll disputes, and
 * ticket time disputes (see migrations 0034, 0182, 0207). PTO requests and
 * time corrections are handled by pto.ts and timecardCorrections.ts
 * respectively — this table exists for the request types that didn't have
 * a real table yet.
 */

import { supabase } from "./client";
import { getCompanyUsers } from "./users";
import { createNotification } from "./notifications";
import { requireRejectReason } from "@/lib/rejectReason";
import { isAttendanceManagerTierRole } from "@/lib/roleLabels";

/** "payroll_dispute" (0182) is reviewed the same way attendance_dispute is
 *  (Approve/Reject) — distinct from payroll_inquiry, which is a general
 *  question closed with a single "Respond & Close".
 *  "ticket_time_dispute" (0207) replaced the old plain-text attendance
 *  dispute flow — "attendance_dispute" stays in this union only so old rows
 *  still type-check/read correctly; the mobile UI no longer creates new ones. */
export type EmployeeRequestType = "attendance_dispute" | "payroll_inquiry" | "payroll_dispute" | "ticket_time_dispute";
export type EmployeeRequestStatus = "pending" | "approved" | "rejected" | "closed";
export type ExceptionReportType = "missed_workday" | "late_early" | "missed_visit" | "other";
export type HrPaperworkStatus = "pending" | "approved" | "additional_review_required";

export interface EmployeeRequestAttachment {
  url: string;
  name: string;
}

export interface EmployeeRequestRow {
  id: string;
  profileId: string;
  requestType: EmployeeRequestType;
  details: string;
  status: EmployeeRequestStatus;
  requestedBy: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
  /** payroll_dispute only (0183) — null/blank on attendance_dispute/payroll_inquiry rows. */
  payPeriod: string | null;
  totalReceived: number | null;
  totalExpected: number | null;
  missingAmount: number | null;
  disputeReason: string | null;
  attachments: EmployeeRequestAttachment[];
  /** payroll_dispute only (0185) — the ticket the dispute is about, if any. */
  ticketNo: string | null;
  /** payroll_dispute only (0186) — the real payroll period this dispute's
   *  missing amount belongs to, "YYYY-MM-DD". Only set when submitted via
   *  the mobile On Hold Tickets Dispute tab, which already knows the exact
   *  payroll run — a free-text-payPeriod dispute leaves these null and
   *  can't be auto-injected into payroll on approve. */
  periodStart: string | null;
  periodEnd: string | null;
  /** payroll_dispute only (0186) — the tech_custom_pay_items row Approve
   *  created to actually add missingAmount into that period's Tech
   *  Activity Report, so Revert-to-Pending can find and delete it again. */
  customPayItemId: string | null;
  /** ticket_time_dispute only (0207) — the technician's claimed actual
   *  start/end time for the disputed ticket, written straight onto that
   *  ticket's onsite_arrived_at/onsite_done_at on Approve. Null on every
   *  other request type. */
  disputedStartTime: string | null;
  disputedEndTime: string | null;
  /** ticket_time_dispute only (migration 0307) — "time_dispute" (default,
   *  original flow: same-day failed check-in, disputedStartTime/EndTime
   *  above carry the claimed hours) or "reschedule" (the ticket moved to a
   *  different day entirely; disputedStartTime/EndTime stay null and
   *  rescheduleActualDay/rescheduleDate carry the dates instead — see
   *  setTicketOnsiteCheckIn's null-guard at both approval call sites). */
  disputeMode: "time_dispute" | "reschedule";
  rescheduleActualDay: string | null;
  rescheduleDate: string | null;
  // "Employee Attendance & Visit Exception Report" fields — ticket_time_
  // dispute only (migration 0305), folded directly into this same request
  // instead of a separate document type, same treatment migration 0304 gave
  // Time Correction Request. See ticketDisputeReportPdf.ts.
  exceptionType: ExceptionReportType | null;
  otherDescription: string;
  exceptionCustomerName: string;
  exceptionScheduledTime: string;
  exceptionActionTaken: string;
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
  /** payroll_dispute only (migration 0372) — set when Accounting approved it
   *  with changed amounts ("Modify"): the employee's own figures as submitted.
   *  totalReceived / totalExpected / missingAmount above then hold the
   *  approved (modified) values. All null for a dispute never modified. */
  originalTotalReceived: number | null;
  originalTotalExpected: number | null;
  originalMissingAmount: number | null;
  modifiedBy: string | null;
  modifiedAt: string | null;
}

function mapRow(row: any): EmployeeRequestRow {
  return {
    id: row.id,
    profileId: row.profile_id,
    requestType: row.request_type,
    details: row.details ?? "",
    status: row.status,
    requestedBy: row.requested_by ?? null,
    reviewedBy: row.reviewed_by ?? null,
    reviewedAt: row.reviewed_at ?? null,
    reviewNote: row.review_note ?? null,
    createdAt: row.created_at,
    payPeriod: row.pay_period ?? null,
    totalReceived: row.total_received === null || row.total_received === undefined ? null : Number(row.total_received),
    totalExpected: row.total_expected === null || row.total_expected === undefined ? null : Number(row.total_expected),
    missingAmount: row.missing_amount === null || row.missing_amount === undefined ? null : Number(row.missing_amount),
    disputeReason: row.dispute_reason ?? null,
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    ticketNo: row.ticket_no ?? null,
    periodStart: row.period_start ?? null,
    periodEnd: row.period_end ?? null,
    customPayItemId: row.custom_pay_item_id ?? null,
    disputedStartTime: row.disputed_start_time ?? null,
    disputedEndTime: row.disputed_end_time ?? null,
    disputeMode: row.dispute_mode ?? "time_dispute",
    rescheduleActualDay: row.reschedule_actual_day ?? null,
    rescheduleDate: row.reschedule_date ?? null,
    exceptionType: row.exception_type ?? null,
    otherDescription: row.other_description ?? "",
    exceptionCustomerName: row.exception_customer_name ?? "",
    exceptionScheduledTime: row.exception_scheduled_time ?? "",
    exceptionActionTaken: row.exception_action_taken ?? "",
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
    originalTotalReceived: row.original_total_received == null ? null : Number(row.original_total_received),
    originalTotalExpected: row.original_total_expected == null ? null : Number(row.original_total_expected),
    originalMissingAmount: row.original_missing_amount == null ? null : Number(row.original_missing_amount),
    modifiedBy: row.modified_by ?? null,
    modifiedAt: row.modified_at ?? null,
  };
}

const SELECT_COLUMNS =
  "id, profile_id, request_type, details, status, requested_by, reviewed_by, reviewed_at, review_note, created_at, pay_period, total_received, total_expected, missing_amount, dispute_reason, attachments, ticket_no, period_start, period_end, custom_pay_item_id, disputed_start_time, disputed_end_time, dispute_mode, reschedule_actual_day, reschedule_date, exception_type, other_description, exception_customer_name, exception_scheduled_time, exception_action_taken, employee_signature_url, employee_signature_name, employee_signed_at, manager_comments, manager_signature_url, manager_signature_name, manager_signed_at, hr_paperwork_status, hr_signature_url, hr_signature_name, hr_signed_at, hr_received_date, hr_reviewer_name, pdf_url";
// Migration 0372's Modify columns — selected separately so request screens
// keep working (without the Modify details) until that migration is run.
const MODIFY_COLUMNS = ", original_total_received, original_total_expected, original_missing_amount, modified_by, modified_at";
let modifyColumnsMissing = false;

// Supabase caps an unbounded select at 1000 rows — a company's full request
// history can exceed that. Page through in chunks of 1000.
const PAGE_SIZE = 1000;

/** All attendance-dispute/payroll-inquiry requests for the caller's company (RLS-scoped), newest first. */
export async function getCompanyEmployeeRequests(): Promise<EmployeeRequestRow[]> {
  const all: EmployeeRequestRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = () =>
      supabase
        .from("employee_requests")
        .select(modifyColumnsMissing ? SELECT_COLUMNS : SELECT_COLUMNS + MODIFY_COLUMNS)
        .order("created_at", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
    let { data, error } = await page();
    if (error && !modifyColumnsMissing && /original_total_received|modified_at|does not exist/i.test(error.message)) {
      modifyColumnsMissing = true; // migration 0372 not run yet
      ({ data, error } = await page());
    }
    if (error) {
      console.error("getCompanyEmployeeRequests error:", error.message);
      return [];
    }
    all.push(...(data ?? []).map(mapRow));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

/**
 * Submit a new attendance dispute, payroll inquiry, payroll dispute, or
 * ticket time dispute on behalf of an employee (profileId). The type-
 * specific fields are all optional since most request types never set most
 * of them. `id` is optional too — only a ticket_time_dispute submission
 * carrying the Exception Report fields needs to pre-generate it (so the
 * signature/PDF storage paths can be keyed by the row's id before the row
 * exists, same pattern createTimecardCorrection uses); every other caller
 * leaves it out and gets the DB-generated default as before.
 */
export async function createEmployeeRequest(input: {
  id?: string;
  profileId: string;
  requestType: EmployeeRequestType;
  details: string;
  requestedBy: string | null;
  payPeriod?: string;
  totalReceived?: number;
  totalExpected?: number;
  missingAmount?: number;
  disputeReason?: string;
  attachments?: EmployeeRequestAttachment[];
  ticketNo?: string;
  periodStart?: string;
  periodEnd?: string;
  disputedStartTime?: string;
  disputedEndTime?: string;
  disputeMode?: "time_dispute" | "reschedule";
  rescheduleActualDay?: string;
  rescheduleDate?: string;
  exceptionType?: ExceptionReportType;
  otherDescription?: string;
  exceptionCustomerName?: string;
  exceptionScheduledTime?: string;
  exceptionActionTaken?: string;
  employeeSignatureUrl?: string;
  employeeSignatureName?: string;
  pdfUrl?: string;
}): Promise<void> {
  const { error } = await supabase.from("employee_requests").insert({
    ...(input.id ? { id: input.id } : {}),
    profile_id: input.profileId,
    request_type: input.requestType,
    details: input.details,
    status: "pending",
    requested_by: input.requestedBy,
    pay_period: input.payPeriod || null,
    total_received: input.totalReceived ?? null,
    total_expected: input.totalExpected ?? null,
    missing_amount: input.missingAmount ?? null,
    dispute_reason: input.disputeReason || null,
    attachments: input.attachments ?? [],
    ticket_no: input.ticketNo || null,
    period_start: input.periodStart || null,
    period_end: input.periodEnd || null,
    disputed_start_time: input.disputedStartTime || null,
    disputed_end_time: input.disputedEndTime || null,
    dispute_mode: input.disputeMode || "time_dispute",
    reschedule_actual_day: input.rescheduleActualDay || null,
    reschedule_date: input.rescheduleDate || null,
    exception_type: input.exceptionType ?? null,
    other_description: input.otherDescription || null,
    exception_customer_name: input.exceptionCustomerName || null,
    exception_scheduled_time: input.exceptionScheduledTime || null,
    exception_action_taken: input.exceptionActionTaken || null,
    employee_signature_url: input.employeeSignatureUrl ?? null,
    employee_signature_name: input.employeeSignatureName ?? null,
    employee_signed_at: input.employeeSignatureUrl ? new Date().toISOString() : null,
    pdf_url: input.pdfUrl ?? null,
  });
  if (error) {
    console.error("createEmployeeRequest error:", error.message);
    throw new Error(error.message);
  }
}

/** Approve, reject, or close a request — optionally leaving a response note the employee can see. */
export async function updateEmployeeRequestStatus(
  id: string,
  status: EmployeeRequestStatus,
  reviewedBy: string | null,
  reviewNote?: string,
  /** Reviewer's display name for the rejection notification. */
  reviewerName?: string
): Promise<void> {
  // A rejection always carries a reason (shared popup when none was typed) —
  // the employee sees it in Self-Service → My Requests and in the notification.
  const note = status === "rejected" ? await requireRejectReason(reviewNote, "Reason for rejecting this request") : reviewNote;
  const { data, error } = await supabase
    .from("employee_requests")
    .update({
      status,
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
      review_note: note || null,
    })
    .eq("id", id)
    .select("profile_id, request_type, ticket_no")
    .maybeSingle();
  if (error) {
    console.error("updateEmployeeRequestStatus error:", error.message);
    throw new Error(error.message);
  }
  if (status === "rejected" && data?.profile_id) {
    const what =
      data.request_type === "ticket_time_dispute"
        ? `ticket time dispute${data.ticket_no ? ` for ${data.ticket_no}` : ""}`
        : data.request_type === "attendance_dispute"
        ? "attendance dispute"
        : data.request_type === "payroll_dispute"
        ? "payroll dispute"
        : "payroll inquiry";
    await createNotification({
      recipientId: data.profile_id,
      senderId: reviewedBy,
      senderName: reviewerName || "HR",
      body: `❌ Your ${what} was rejected. Reason: ${note}`,
      linkTo: "/m/dashboard/employee-self-service?tab=requests",
    }).catch((err) => console.error("Failed to notify request rejection:", err));
  }
}

/**
 * Approve a ticket_time_dispute AND capture the manager's Exception Report
 * signature in the same update — combines what used to be a plain
 * updateEmployeeRequestStatus("approved") call with the signature fields,
 * mirroring reviewCorrectionStage's own signature param for Time Correction
 * (migration 0304). The caller still does the ticket-onsite-checkin side
 * effect (setTicketOnsiteCheckIn + resetMileageRouteConfirmation) BEFORE
 * calling this, exactly as it already does for a plain approve — this
 * function only owns the employee_requests row itself.
 */
export async function signTicketDisputeManager(
  id: string,
  reviewerId: string,
  signature: { url: string; name: string; comments: string; pdfUrl: string },
  reviewNote?: string
): Promise<void> {
  const { error } = await supabase
    .from("employee_requests")
    .update({
      status: "approved",
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
      review_note: reviewNote || null,
      manager_comments: signature.comments || null,
      manager_signature_url: signature.url,
      manager_signature_name: signature.name,
      manager_signed_at: new Date().toISOString(),
      pdf_url: signature.pdfUrl,
    })
    .eq("id", id);
  if (error) {
    console.error("signTicketDisputeManager error:", error.message);
    throw new Error(error.message);
  }
}

/**
 * The paper form's "5. HR Department Use Only" sign-off — independent of
 * `status` (whoever approved the dispute itself), same reasoning as
 * signCorrectionHrPaperwork for Time Correction: an actual HR person's
 * signature is a separate, deliberate act, not implied by the approval.
 */
export async function signTicketDisputeHrPaperwork(
  id: string,
  reviewerName: string,
  signature: { url: string; name: string },
  hrReceivedDate: string,
  hrActionStatus: Exclude<HrPaperworkStatus, "pending">,
  pdfUrl: string
): Promise<void> {
  const { error } = await supabase
    .from("employee_requests")
    .update({
      hr_paperwork_status: hrActionStatus,
      hr_signature_url: signature.url,
      hr_signature_name: signature.name,
      hr_signed_at: new Date().toISOString(),
      hr_received_date: hrReceivedDate || null,
      hr_reviewer_name: reviewerName,
      pdf_url: pdfUrl,
    })
    .eq("id", id);
  if (error) {
    console.error("signTicketDisputeHrPaperwork error:", error.message);
    throw new Error(error.message);
  }
}

/** Swaps in a freshly re-rendered PDF — no signature/status change, just the file (see ticketDisputeReportPdf.ts's regenerateTicketDisputePdf). */
export async function updateEmployeeRequestPdfUrl(id: string, pdfUrl: string): Promise<void> {
  const { error } = await supabase.from("employee_requests").update({ pdf_url: pdfUrl }).eq("id", id);
  if (error) {
    console.error("updateEmployeeRequestPdfUrl error:", error.message);
    throw new Error(error.message);
  }
}

/**
 * Records (or clears, passing null) which tech_custom_pay_items row a
 * payroll_dispute's Approve action created — see AccountingDashboard.tsx's
 * handlePayrollDisputeAction. Reverting to pending reads this back to know
 * which custom pay line to delete again.
 */
export async function linkPayrollDisputeCustomPayItem(disputeId: string, customPayItemId: string | null): Promise<void> {
  const { error } = await supabase
    .from("employee_requests")
    .update({ custom_pay_item_id: customPayItemId })
    .eq("id", disputeId);
  if (error) {
    console.error("linkPayrollDisputeCustomPayItem error:", error.message);
    throw new Error(error.message);
  }
}

/**
 * Approve a payroll_dispute with corrected amounts ("Modify", migration
 * 0372). The employee's submitted figures are kept in original_* (only the
 * first time — modifying again keeps their true originals), the corrected
 * ones replace total_received / total_expected / missing_amount, and the
 * comment is required so the employee knows why it changed. The caller adds
 * the payroll line for the new missing amount, same as a plain Approve.
 */
export async function modifyPayrollDispute(
  dispute: Pick<EmployeeRequestRow, "id" | "profileId" | "totalReceived" | "totalExpected" | "missingAmount" | "originalTotalReceived" | "originalTotalExpected" | "originalMissingAmount" | "modifiedAt">,
  amounts: { totalReceived: number; totalExpected: number; missingAmount: number },
  reviewedBy: string | null,
  note: string,
  reviewerName?: string
): Promise<void> {
  const comment = note.trim();
  if (!comment) throw new Error("Add a comment explaining the change — the employee sees it.");
  const firstModify = !dispute.modifiedAt;
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("employee_requests")
    .update({
      original_total_received: firstModify ? dispute.totalReceived : dispute.originalTotalReceived,
      original_total_expected: firstModify ? dispute.totalExpected : dispute.originalTotalExpected,
      original_missing_amount: firstModify ? dispute.missingAmount : dispute.originalMissingAmount,
      total_received: amounts.totalReceived,
      total_expected: amounts.totalExpected,
      missing_amount: amounts.missingAmount,
      modified_by: reviewedBy,
      modified_at: now,
      status: "approved",
      reviewed_by: reviewedBy,
      reviewed_at: now,
      review_note: comment,
    })
    .eq("id", dispute.id);
  if (error) {
    console.error("modifyPayrollDispute error:", error.message);
    throw new Error(/original_total_received|modified_at/.test(error.message)
      ? "Modify needs database migration 0372 — ask an admin to run it."
      : error.message);
  }
  const requested = firstModify ? dispute.missingAmount : dispute.originalMissingAmount;
  await createNotification({
    recipientId: dispute.profileId,
    senderId: reviewedBy,
    senderName: reviewerName || "Accounting",
    body: `✏️ YOUR PAYROLL DISPUTE HAS BEEN MODIFIED by ${reviewerName || "Accounting"} — you requested $${(requested ?? 0).toFixed(2)}, approved amount is $${amounts.missingAmount.toFixed(2)}. Comment: ${comment}`,
    linkTo: "/m/dashboard/employee-self-service?tab=requests",
  }).catch((err) => console.error("Failed to notify payroll dispute modification:", err));
}

/** Revert-to-Pending for a modified dispute: put the employee's original figures back and clear the Modify fields. */
export async function restorePayrollDisputeOriginal(
  dispute: Pick<EmployeeRequestRow, "id" | "originalTotalReceived" | "originalTotalExpected" | "originalMissingAmount" | "modifiedAt">
): Promise<void> {
  if (!dispute.modifiedAt) return;
  const { error } = await supabase
    .from("employee_requests")
    .update({
      total_received: dispute.originalTotalReceived,
      total_expected: dispute.originalTotalExpected,
      missing_amount: dispute.originalMissingAmount,
      original_total_received: null,
      original_total_expected: null,
      original_missing_amount: null,
      modified_by: null,
      modified_at: null,
    })
    .eq("id", dispute.id);
  if (error) {
    console.error("restorePayrollDisputeOriginal error:", error.message);
    throw new Error(error.message);
  }
}

/**
 * Notifies every ADMIN/SUPERADMIN/HR/FINANCE in the company (primary or
 * extra role) that a new request needs review — same recipient rule
 * Employee Self-Service's own local notifyManagers() uses, extracted here
 * so the mobile Payroll Dispute view can reuse it without needing the
 * caller to already have the company's profile list loaded.
 */
export async function notifyRequestReviewers(input: {
  body: string;
  linkTo?: string;
  senderId: string | null;
  senderName: string;
}): Promise<void> {
  const profiles = await getCompanyUsers();
  const recipients = profiles.filter((p) => {
    if (p.id === input.senderId || !p.is_active) return false;
    const primary = (p.role || "").toUpperCase();
    if (["ADMIN", "SUPERADMIN", "HR", "FINANCE"].includes(primary)) return true;
    return (p.extra_roles || []).some((r) => ["ADMIN", "SUPERADMIN", "HR", "FINANCE"].includes((r || "").toUpperCase()));
  });
  await Promise.all(
    recipients.map((r) =>
      createNotification({
        recipientId: r.id,
        senderId: input.senderId,
        senderName: input.senderName,
        body: input.body,
        linkTo: input.linkTo || "/m/dashboard/attendance-monitoring",
      }).catch((err) => console.error("Failed to notify", r.id, err))
    )
  );
}

/**
 * Can `viewerProfileId` (with `viewerRole`) review a ticket_time_dispute
 * from `requesterProfileId`? Mirrors canReviewCorrectionStage's manager
 * hierarchy (timecardCorrections.ts) — a manager only sees/acts on their
 * own team's disputes, falling back to that manager's own manager when the
 * direct manager isn't available; ADMIN/SUPERADMIN/HR/FINANCE can act on
 * anyone's. Unlike timecard_corrections, employee_requests has no resolved
 * managerId snapshot on the row — the whole chain is looked up live from
 * profiles.manager_name, same as CorrectionsTab.tsx's own managerChainFor
 * helper does for the identical purpose.
 */
export function canReviewTicketDispute(
  requesterProfileId: string,
  viewerRole: string | null | undefined,
  viewerExtraRoles: string[] | null | undefined,
  viewerDisplayName: string | null | undefined,
  profiles: { id: string; display_name: string | null; manager_name: string | null }[]
): boolean {
  const heldRoles = [viewerRole, ...(viewerExtraRoles ?? [])].map((r) => (r || "").toUpperCase()).filter(Boolean);
  if (heldRoles.some((r) => ["ADMIN", "SUPERADMIN", "HR", "FINANCE"].includes(r))) return true;
  const requester = profiles.find((p) => p.id === requesterProfileId);
  const requesterManagerName = (requester?.manager_name || "").trim().toLowerCase();
  const viewerName = (viewerDisplayName || "").trim().toLowerCase();
  if (requesterManagerName && viewerName && requesterManagerName === viewerName) return true;
  if (requesterManagerName) {
    const requesterManager = profiles.find((p) => (p.display_name || "").trim().toLowerCase() === requesterManagerName);
    const requesterManagersManagerName = (requesterManager?.manager_name || "").trim().toLowerCase();
    if (requesterManagersManagerName && viewerName && requesterManagersManagerName === viewerName) return true;
    // The requester has a manager on file, but the viewer is neither that
    // manager nor their manager — a manager-tier role alone isn't enough
    // once a real chain exists, same as canReviewCorrectionStage's own
    // `if (request.managerId) return false` for the identical reason.
    return false;
  }
  // No manager on file at all for this requester — any manager-tier role
  // can stand in, so the dispute never gets stranded with nobody able to
  // act on it.
  return isAttendanceManagerTierRole(viewerRole, viewerExtraRoles);
}
