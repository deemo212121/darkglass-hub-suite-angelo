/**
 * Truck Stock pull requests — the Parts Manager approval gate on top of
 * Truck Stock pulls (see migration 0047, widened by 0167). A
 * non-privileged requester's "fulfill in-house" click reserves the stock
 * immediately but creates a 'pending' row here instead of completing the
 * pull. Four-state status, mirroring truckStockTransfers.ts:
 *   pending  -> awaiting the SOURCE branch's Parts Manager.
 *   approved -> source signed off (Part Transaction line stamped PO
 *               Made); the part is now in transit to the ticket's own
 *               branch, not yet physically there.
 *   received -> the ticket's branch confirms physical arrival (Part
 *               Transaction line promotes PO Made -> Part Ready) — this,
 *               not approval, is when the request is actually complete.
 *   rejected -> declined; reserved quantity restored, line reverts to
 *               Need PO.
 */

import { supabase } from "./client";

export type TruckStockPullRequestStatus = "pending" | "approved" | "rejected" | "received";

export interface TruckStockPullRequestRow {
  id: string;
  ticketId: string;
  ticketNo: string;
  /** The ticket's own branch (tickets.location) — where the part is headed, i.e. the destination that must Mark Received. Not the same as `branch` (the source it's being pulled FROM). */
  ticketBranch: string;
  /** The technician assigned to the ticket (tickets.technician) — who this part is actually for. */
  ticketTechnician: string;
  partId: string;
  partNo: string;
  branch: string;
  storageLocation: string;
  quantity: number;
  status: TruckStockPullRequestStatus;
  requestedBy: string | null;
  requestedByName: string;
  requestedAt: string;
  reviewedBy: string | null;
  reviewedByName: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  receivedBy: string | null;
  receivedByName: string;
  receivedAt: string | null;
}

const SELECT =
  "id, ticket_id, part_id, part_no, branch, storage_location, quantity, status, requested_by, requested_at, reviewed_by, reviewed_at, rejection_reason, received_by, received_at, " +
  "tickets!truck_stock_pull_requests_ticket_same_company(ticket_no, location, technician), " +
  "requester:requested_by(display_name, username), reviewer:reviewed_by(display_name, username), receiver:received_by(display_name, username)";

function fromRow(r: any): TruckStockPullRequestRow {
  return {
    id: r.id,
    ticketId: r.ticket_id,
    ticketNo: r.tickets?.ticket_no ?? "",
    ticketBranch: r.tickets?.location ?? "",
    ticketTechnician: r.tickets?.technician ?? "",
    partId: r.part_id,
    partNo: r.part_no ?? "",
    branch: r.branch ?? "",
    storageLocation: r.storage_location ?? "",
    quantity: Number(r.quantity ?? 0),
    status: r.status,
    requestedBy: r.requested_by,
    requestedByName: r.requester?.display_name || r.requester?.username || "",
    requestedAt: r.requested_at,
    reviewedBy: r.reviewed_by,
    reviewedByName: r.reviewer?.display_name || r.reviewer?.username || "",
    reviewedAt: r.reviewed_at,
    rejectionReason: r.rejection_reason,
    receivedBy: r.received_by,
    receivedByName: r.receiver?.display_name || r.receiver?.username || "",
    receivedAt: r.received_at,
  };
}

/** Create a pending pull request. company_id/requested_by auto-stamped server-side. */
export async function createTruckStockPullRequest(input: {
  ticketId: string;
  partId: string;
  partNo: string;
  branch: string;
  storageLocation?: string;
  quantity: number;
}): Promise<string> {
  const { data, error } = await supabase
    .from("truck_stock_pull_requests")
    .insert({
      ticket_id: input.ticketId,
      part_id: input.partId,
      part_no: input.partNo,
      branch: input.branch,
      storage_location: input.storageLocation || null,
      quantity: Math.max(1, Math.trunc(input.quantity || 1)),
    })
    .select("id")
    .single();
  if (error) {
    console.error("createTruckStockPullRequest error:", error.message);
    throw new Error(error.message);
  }
  return data.id as string;
}

export async function getTruckStockPullRequests(status?: TruckStockPullRequestStatus): Promise<TruckStockPullRequestRow[]> {
  let query = supabase.from("truck_stock_pull_requests").select(SELECT).order("requested_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) {
    console.error("getTruckStockPullRequests error:", error.message);
    throw new Error(error.message);
  }
  return (data ?? []).map(fromRow);
}

/** Approve a pending request — caller is responsible for also updating the linked Part Transaction row. */
export async function approveTruckStockPullRequest(id: string, reviewerId: string | null): Promise<void> {
  const { error } = await supabase
    .from("truck_stock_pull_requests")
    .update({ status: "approved", reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("approveTruckStockPullRequest error:", error.message);
    throw new Error(error.message);
  }
}

/** Reject a pending request — caller is responsible for restoring Truck Stock quantity and reverting the part row. */
export async function rejectTruckStockPullRequest(id: string, reviewerId: string | null, reason?: string): Promise<void> {
  const { error } = await supabase
    .from("truck_stock_pull_requests")
    .update({
      status: "rejected",
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
      rejection_reason: reason?.trim() || null,
    })
    .eq("id", id);
  if (error) {
    console.error("rejectTruckStockPullRequest error:", error.message);
    throw new Error(error.message);
  }
}

/** Mark an approved (in-transit) request as physically received at the ticket's branch — caller is responsible for also promoting the linked Part Transaction line PO Made -> Part Ready. */
export async function markTruckStockPullRequestReceived(id: string, receiverId: string | null): Promise<void> {
  const { error } = await supabase
    .from("truck_stock_pull_requests")
    .update({ status: "received", received_by: receiverId, received_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("markTruckStockPullRequestReceived error:", error.message);
    throw new Error(error.message);
  }
}
