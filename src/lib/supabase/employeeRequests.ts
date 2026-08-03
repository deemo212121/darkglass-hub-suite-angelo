/**
 * Supabase employee-requests service — Employee Self-Service "My Requests"
 * tab. Covers attendance disputes and payroll inquiries (see migration
 * 0034). PTO requests and time corrections are handled by pto.ts and
 * timecardCorrections.ts respectively — this table exists for the two
 * request types that didn't have a real table yet.
 */

import { supabase } from "./client";

export type EmployeeRequestType = "attendance_dispute" | "payroll_inquiry";
export type EmployeeRequestStatus = "pending" | "approved" | "rejected" | "closed";

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
  };
}

const SELECT_COLUMNS =
  "id, profile_id, request_type, details, status, requested_by, reviewed_by, reviewed_at, review_note, created_at";

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

/** Submit a new attendance dispute or payroll inquiry on behalf of an employee (profileId). */
export async function createEmployeeRequest(input: {
  profileId: string;
  requestType: EmployeeRequestType;
  details: string;
  requestedBy: string | null;
}): Promise<void> {
  const { error } = await supabase.from("employee_requests").insert({
    profile_id: input.profileId,
    request_type: input.requestType,
    details: input.details,
    status: "pending",
    requested_by: input.requestedBy,
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
