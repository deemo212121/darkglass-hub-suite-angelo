/**
 * Truck Stock branch-to-branch transfer requests (migration 0164) —
 * distinct from truckStockRequests.ts (ticket-driven pulls). This moves
 * existing Truck Stock inventory from one branch to another, gated by the
 * DESTINATION branch's Parts Manager, with a 4-state status that tracks
 * where the parts physically are: pending -> approved (in transit) ->
 * received, or rejected.
 */

import { supabase } from "./client";

export type TruckStockTransferStatus = "pending" | "approved" | "rejected" | "received";

export interface TruckStockTransferRow {
  id: string;
  partNo: string;
  description: string;
  manufacturer: string;
  quantity: number;
  fromBranch: string;
  toBranch: string;
  status: TruckStockTransferStatus;
  notes: string;
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
  "id, part_no, description, manufacturer, quantity, from_branch, to_branch, status, notes, " +
  "requested_by, requested_at, reviewed_by, reviewed_at, rejection_reason, received_by, received_at, " +
  "requester:requested_by(display_name, username), reviewer:reviewed_by(display_name, username), receiver:received_by(display_name, username)";

function fromRow(r: any): TruckStockTransferRow {
  return {
    id: r.id,
    partNo: r.part_no ?? "",
    description: r.description ?? "",
    manufacturer: r.manufacturer ?? "",
    quantity: Number(r.quantity ?? 0),
    fromBranch: r.from_branch ?? "",
    toBranch: r.to_branch ?? "",
    status: r.status,
    notes: r.notes ?? "",
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

/** Create a pending transfer request. company_id/requested_by auto-stamped server-side. */
export async function createTruckStockTransferRequest(input: {
  partNo: string;
  description?: string;
  manufacturer?: string;
  quantity: number;
  fromBranch: string;
  toBranch: string;
  notes?: string;
}): Promise<string> {
  const { data, error } = await supabase
    .from("truck_stock_transfer_requests")
    .insert({
      part_no: input.partNo.trim(),
      description: input.description?.trim() || null,
      manufacturer: input.manufacturer?.trim() || null,
      quantity: Math.max(1, Math.trunc(input.quantity || 1)),
      from_branch: input.fromBranch.trim(),
      to_branch: input.toBranch.trim(),
      notes: input.notes?.trim() || null,
    })
    .select("id")
    .single();
  if (error) {
    console.error("createTruckStockTransferRequest error:", error.message);
    throw new Error(error.message);
  }
  return data.id as string;
}

export async function getTruckStockTransferRequests(status?: TruckStockTransferStatus): Promise<TruckStockTransferRow[]> {
  let query = supabase.from("truck_stock_transfer_requests").select(SELECT).order("requested_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) {
    console.error("getTruckStockTransferRequests error:", error.message);
    throw new Error(error.message);
  }
  return (data ?? []).map(fromRow);
}

/** Approve a pending request — marks it "in transit," no stock quantity moves yet. */
export async function approveTruckStockTransferRequest(id: string, reviewerId: string | null): Promise<void> {
  const { error } = await supabase
    .from("truck_stock_transfer_requests")
    .update({ status: "approved", reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("approveTruckStockTransferRequest error:", error.message);
    throw new Error(error.message);
  }
}

/** Reject a pending request — caller is responsible for also restoring the source branch's reserved quantity. */
export async function rejectTruckStockTransferRequest(id: string, reviewerId: string | null, reason?: string): Promise<void> {
  const { error } = await supabase
    .from("truck_stock_transfer_requests")
    .update({
      status: "rejected",
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
      rejection_reason: reason?.trim() || null,
    })
    .eq("id", id);
  if (error) {
    console.error("rejectTruckStockTransferRequest error:", error.message);
    throw new Error(error.message);
  }
}

/** Mark an approved (in-transit) request as physically received — caller is responsible for also incrementing the destination branch's on-hand quantity. */
export async function markTruckStockTransferReceived(id: string, receiverId: string | null): Promise<void> {
  const { error } = await supabase
    .from("truck_stock_transfer_requests")
    .update({ status: "received", received_by: receiverId, received_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("markTruckStockTransferReceived error:", error.message);
    throw new Error(error.message);
  }
}
