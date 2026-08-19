/**
 * Supabase employee-requests service — Employee Self-Service "My Requests"
 * tab, and Payroll Dispute on the mobile tech app. Covers attendance
 * disputes, payroll inquiries, and payroll disputes (see migrations 0034
 * and 0182). PTO requests and time corrections are handled by pto.ts and
 * timecardCorrections.ts respectively — this table exists for the request
 * types that didn't have a real table yet.
 */

import { supabase } from "./client";
import { getCompanyUsers } from "./users";
import { createNotification } from "./notifications";

/** "payroll_dispute" (0182) is reviewed the same way attendance_dispute is
 *  (Approve/Reject) — distinct from payroll_inquiry, which is a general
 *  question closed with a single "Respond & Close". */
export type EmployeeRequestType = "attendance_dispute" | "payroll_inquiry" | "payroll_dispute";
export type EmployeeRequestStatus = "pending" | "approved" | "rejected" | "closed";

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
  };
}

const SELECT_COLUMNS =
  "id, profile_id, request_type, details, status, requested_by, reviewed_by, reviewed_at, review_note, created_at, pay_period, total_received, total_expected, missing_amount, dispute_reason, attachments";

/** All attendance-dispute/payroll-inquiry requests for the caller's company (RLS-scoped), newest first. */
export async function getCompanyEmployeeRequests(): Promise<EmployeeRequestRow[]> {
  const { data, error } = await supabase
    .from("employee_requests")
    .select(SELECT_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("getCompanyEmployeeRequests error:", error.message);
    return [];
  }
  return (data ?? []).map(mapRow);
}

/**
 * Submit a new attendance dispute, payroll inquiry, or payroll dispute on
 * behalf of an employee (profileId). The payroll-dispute-only fields are
 * optional since attendance_dispute/payroll_inquiry never set them.
 */
export async function createEmployeeRequest(input: {
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
}): Promise<void> {
  const { error } = await supabase.from("employee_requests").insert({
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
  reviewNote?: string
): Promise<void> {
  const { error } = await supabase
    .from("employee_requests")
    .update({
      status,
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
      review_note: reviewNote || null,
    })
    .eq("id", id);
  if (error) {
    console.error("updateEmployeeRequestStatus error:", error.message);
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
    if (p.id === input.senderId) return false;
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
