/**
 * Truck Stock — Parts Manager approval-workflow notifications.
 *
 * Every Truck Stock pull now goes through a Parts Manager / Admin approval
 * step (see truckStockRequests.ts) instead of completing immediately, no
 * matter who requests it — submitting and approving are always separate
 * steps, even for the same person. This module pings the approvers when a
 * new request needs review, and pings the requester back once it's
 * approved or rejected.
 *
 * Previously this used sendNotificationToRole()/sendNotificationToUsers()
 * (Firestore's `users_index` collection) — legacy, and never populated by
 * this app's actual Supabase-based user provisioning, so it silently
 * delivered to zero recipients. Rewritten to use the real bell-icon
 * notifications table (src/lib/supabase/notifications.ts), the same one
 * NotificationsMenu.tsx actually reads from.
 */

import { supabase } from "./supabase/client";
import { createNotification } from "./supabase/notifications";

/** Roles that can approve/reject a Truck Stock request at all — who gets
 * notified about a new one, and (combined with a branch match) who can
 * act on it. The Truck Stock Requests tab itself is visible to everyone,
 * not gated by this — see canApproveTruckStockPull for the actual
 * per-row, branch-scoped check. */
const APPROVER_ROLE_CODES = new Set<string>(["PARTS_MANAGER", "ADMIN", "SUPERADMIN"]);

/**
 * Whether the given role/branch can approve/reject a pull request FROM
 * `sourceBranch` (the branch Truck Stock is being decremented at — that
 * branch's own Parts Manager is who actually knows whether that stock is
 * really free to give up). Admin/SuperAdmin can act on any branch, same
 * as every other approval gate in this app.
 */
export function canApproveTruckStockPull(
  primaryRole: string | null | undefined,
  extraRoles: string[] | null | undefined,
  assignedBranch: string | null | undefined,
  sourceBranch: string,
): boolean {
  const all = [primaryRole, ...(extraRoles ?? [])]
    .map((r) => String(r ?? "").trim().toUpperCase())
    .filter(Boolean);
  if (all.some((r) => r === "ADMIN" || r === "SUPERADMIN")) return true;
  if (!all.includes("PARTS_MANAGER")) return false;
  return String(assignedBranch ?? "").trim().toLowerCase() === sourceBranch.trim().toLowerCase();
}

/**
 * Parts Managers assigned to `branch` specifically — falls back to every
 * Parts Manager/Admin/SuperAdmin company-wide if nobody is assigned
 * there, so a request never silently strands with zero possible
 * approvers just because a branch has no Parts Manager on file yet.
 * Shared by both the ticket-driven pull requests below (branch = where
 * stock is being pulled FROM) and the branch transfer requests further
 * down (branch = where stock is being sent TO).
 */
async function findApproverProfileIdsForBranch(branch: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, role, extra_roles, assigned_branch")
    .eq("is_active", true);
  if (error) {
    console.warn("[truckStockNotify] findApproverProfileIdsForBranch error:", error.message);
    return [];
  }
  const rows = data ?? [];
  const isPartsManager = (r: any) => {
    const roles = [r.role, ...(r.extra_roles ?? [])].map((v: unknown) => String(v ?? "").trim().toUpperCase());
    return roles.includes("PARTS_MANAGER");
  };
  const atBranch = rows
    .filter((r: any) => isPartsManager(r) && String(r.assigned_branch ?? "").trim().toLowerCase() === branch.trim().toLowerCase())
    .map((r: any) => r.id as string);
  if (atBranch.length > 0) return atBranch;
  // Fallback: no Parts Manager on file for this branch — notify every
  // company-wide approver instead (Parts Manager anywhere, or Admin/SuperAdmin).
  return rows
    .filter((r: any) => {
      const roles = [r.role, ...(r.extra_roles ?? [])].map((v: unknown) => String(v ?? "").trim().toUpperCase());
      return roles.some((v) => APPROVER_ROLE_CODES.has(v));
    })
    .map((r: any) => r.id as string);
}

/** Ping the source branch's Parts Manager(s) that a pull request needs review. Fire-and-forget. */
export async function notifyPartsManagerOfPullRequest(payload: {
  actorName: string;
  ticketNo: string;
  partNo: string;
  qty: number;
  branch: string;
  storageLocation?: string;
  /** The truck_stock_pull_requests.id this notification is about — lets the
   * Truck Stock Requests tab scroll to and highlight this exact row instead
   * of just landing on the general Pending list. */
  requestId?: string;
}): Promise<void> {
  try {
    const recipientIds = await findApproverProfileIdsForBranch(payload.branch);
    if (recipientIds.length === 0) return;
    const body =
      `${payload.actorName} requested to pull ${payload.qty} × ${payload.partNo} from Truck Stock ` +
      `(${payload.branch}${payload.storageLocation ? ` @ ${payload.storageLocation}` : ""}) for ticket ` +
      `${payload.ticketNo}. Needs your approval.`;
    const linkTo = payload.requestId
      ? `/m/parts/part-inventory?tab=truck-stock-requests&requestId=${encodeURIComponent(payload.requestId)}`
      : "/m/parts/part-inventory?tab=truck-stock-requests";
    await Promise.all(
      recipientIds.map((id) =>
        createNotification({
          recipientId: id,
          senderId: null,
          senderName: payload.actorName,
          body,
          // Deep-links straight into the Truck Stock Requests tab (see the
          // ?tab=/?requestId= handling in PartInventory.tsx) instead of just
          // landing on Part Inventory's default tab, where the pending
          // request isn't visible at all.
          linkTo,
        }).catch((e) => console.warn("[truckStockNotify] notify parts manager failed:", e)),
      ),
    );
  } catch (err) {
    console.warn("[truckStockNotify] notifyPartsManagerOfPullRequest skipped:", err);
  }
}

/**
 * Ping the TICKET's own branch's Parts Manager(s) once a pull is approved —
 * unlike a transfer (where the approver already IS the destination's own
 * PM), a pull's approval comes from the SOURCE branch, so the destination
 * (the branch that'll actually receive and use the part) would otherwise
 * have no way to know to watch for it short of manually browsing the In
 * Transit tab. Fire-and-forget.
 */
export async function notifyPartsManagerOfPullInTransit(payload: {
  actorName: string;
  ticketNo: string;
  partNo: string;
  qty: number;
  sourceBranch: string;
  destBranch: string;
  requestId?: string;
}): Promise<void> {
  try {
    if (!payload.destBranch) return;
    const recipientIds = await findApproverProfileIdsForBranch(payload.destBranch);
    if (recipientIds.length === 0) return;
    const qtyLabel = `${payload.qty} unit${payload.qty === 1 ? "" : "s"}`;
    const body =
      `${qtyLabel} of ${payload.partNo} for Ticket ${payload.ticketNo} approved by ${payload.actorName} — in transit from ` +
      `${payload.sourceBranch} to ${payload.destBranch}. Mark Received once it physically arrives.`;
    const linkTo = payload.requestId
      ? `/m/parts/part-inventory?tab=truck-stock-requests&requestId=${encodeURIComponent(payload.requestId)}`
      : "/m/parts/part-inventory?tab=truck-stock-requests";
    await Promise.all(
      recipientIds.map((id) =>
        createNotification({
          recipientId: id,
          senderId: null,
          senderName: payload.actorName,
          body,
          linkTo,
        }).catch((e) => console.warn("[truckStockNotify] notify destination parts manager (pull in transit) failed:", e)),
      ),
    );
  } catch (err) {
    console.warn("[truckStockNotify] notifyPartsManagerOfPullInTransit skipped:", err);
  }
}

/** Ping the requester once their pull request has been approved or rejected. Fire-and-forget. */
export async function notifyRequesterOfPullDecision(payload: {
  requesterId: string | null;
  approved: boolean;
  partNo: string;
  qty: number;
  ticketNo: string;
  reason?: string;
  reviewerName?: string | null;
  reviewerId?: string | null;
}): Promise<void> {
  try {
    if (!payload.requesterId) return;
    const qtyLabel = `${payload.qty} unit${payload.qty === 1 ? "" : "s"}`;
    const body = payload.approved
      ? `Part ${payload.partNo} for Ticket ${payload.ticketNo} is Approved. Your Truck Stock request (${qtyLabel}) is now PO Made and in transit.`
      : `Part ${payload.partNo} for Ticket ${payload.ticketNo} is Rejected.` +
        `${payload.reason ? ` Reason: ${payload.reason}` : ""} Please order it from a distributor instead.`;
    await createNotification({
      recipientId: payload.requesterId,
      senderId: payload.reviewerId ?? null,
      senderName: payload.reviewerName || "Parts Manager",
      body,
      linkTo: `/ticket/${payload.ticketNo}`,
    });
  } catch (err) {
    console.warn("[truckStockNotify] notifyRequesterOfPullDecision skipped:", err);
  }
}

/** Ping the requester once the ticket's own branch confirms the pulled part actually arrived. Fire-and-forget. */
export async function notifyRequesterOfPullReceived(payload: {
  requesterId: string | null;
  partNo: string;
  qty: number;
  ticketNo: string;
  branch: string;
  receiverName?: string | null;
  receiverId?: string | null;
}): Promise<void> {
  try {
    if (!payload.requesterId) return;
    const qtyLabel = `${payload.qty} unit${payload.qty === 1 ? "" : "s"}`;
    const body = `${qtyLabel} of ${payload.partNo} for Ticket ${payload.ticketNo} arrived from ${payload.branch} — Part Ready.`;
    await createNotification({
      recipientId: payload.requesterId,
      senderId: payload.receiverId ?? null,
      senderName: payload.receiverName || "Parts Manager",
      body,
      linkTo: `/ticket/${payload.ticketNo}`,
    });
  } catch (err) {
    console.warn("[truckStockNotify] notifyRequesterOfPullReceived skipped:", err);
  }
}

// ---------------------------------------------------------------------
// Branch-to-branch Truck Stock transfer requests (migration 0164) —
// distinct workflow from the ticket-driven pulls above: moves existing
// stock from one branch to another, so approval is scoped to the
// DESTINATION branch's own Parts Manager, not any Parts Manager
// company-wide. Shares canApproveTruckStockPull/
// findApproverProfileIdsForBranch above (branch = the destination here,
// vs. the source for a pull request) — same role/branch-matching rule
// either way, just a different meaning for which branch is being checked.
// ---------------------------------------------------------------------

// Truck Stock Requests is now one unified tab for both pulls and transfers
// (see TruckStockRequestsPage.tsx) — same deep-link target as
// notifyPartsManagerOfPullRequest below.
const TRANSFER_LINK = "/m/parts/part-inventory?tab=truck-stock-requests";

/** Ping the destination branch's Parts Manager(s) that a transfer request needs review. Fire-and-forget. */
export async function notifyPartsManagerOfTransferRequest(payload: {
  actorName: string;
  partNo: string;
  qty: number;
  fromBranch: string;
  toBranch: string;
  requestId?: string;
}): Promise<void> {
  try {
    const recipientIds = await findApproverProfileIdsForBranch(payload.toBranch);
    if (recipientIds.length === 0) return;
    const body =
      `${payload.actorName} requested to transfer ${payload.qty} × ${payload.partNo} from ${payload.fromBranch} ` +
      `to ${payload.toBranch}. Needs your approval.`;
    const linkTo = payload.requestId ? `${TRANSFER_LINK}&requestId=${encodeURIComponent(payload.requestId)}` : TRANSFER_LINK;
    await Promise.all(
      recipientIds.map((id) =>
        createNotification({
          recipientId: id,
          senderId: null,
          senderName: payload.actorName,
          body,
          linkTo,
        }).catch((e) => console.warn("[truckStockNotify] notify destination parts manager failed:", e)),
      ),
    );
  } catch (err) {
    console.warn("[truckStockNotify] notifyPartsManagerOfTransferRequest skipped:", err);
  }
}

/** Ping the requester once their transfer request has been approved or rejected. Fire-and-forget. */
export async function notifyRequesterOfTransferDecision(payload: {
  requesterId: string | null;
  approved: boolean;
  partNo: string;
  qty: number;
  fromBranch: string;
  toBranch: string;
  reason?: string;
  reviewerName?: string | null;
  reviewerId?: string | null;
  requestId?: string;
}): Promise<void> {
  try {
    if (!payload.requesterId) return;
    const qtyLabel = `${payload.qty} unit${payload.qty === 1 ? "" : "s"}`;
    const body = payload.approved
      ? `Your transfer request for ${qtyLabel} of ${payload.partNo} (${payload.fromBranch} → ${payload.toBranch}) is Approved and now in transit.`
      : `Your transfer request for ${qtyLabel} of ${payload.partNo} (${payload.fromBranch} → ${payload.toBranch}) is Rejected.` +
        `${payload.reason ? ` Reason: ${payload.reason}` : ""}`;
    const linkTo = payload.requestId ? `${TRANSFER_LINK}&requestId=${encodeURIComponent(payload.requestId)}` : TRANSFER_LINK;
    await createNotification({
      recipientId: payload.requesterId,
      senderId: payload.reviewerId ?? null,
      senderName: payload.reviewerName || "Parts Manager",
      body,
      linkTo,
    });
  } catch (err) {
    console.warn("[truckStockNotify] notifyRequesterOfTransferDecision skipped:", err);
  }
}

/** Ping the requester once the destination branch confirms the parts actually arrived. Fire-and-forget. */
export async function notifyRequesterOfTransferReceived(payload: {
  requesterId: string | null;
  partNo: string;
  qty: number;
  fromBranch: string;
  toBranch: string;
  receiverName?: string | null;
  receiverId?: string | null;
  requestId?: string;
}): Promise<void> {
  try {
    if (!payload.requesterId) return;
    const qtyLabel = `${payload.qty} unit${payload.qty === 1 ? "" : "s"}`;
    const body = `${qtyLabel} of ${payload.partNo} arrived at ${payload.toBranch} (from ${payload.fromBranch}) — transfer complete.`;
    const linkTo = payload.requestId ? `${TRANSFER_LINK}&requestId=${encodeURIComponent(payload.requestId)}` : TRANSFER_LINK;
    await createNotification({
      recipientId: payload.requesterId,
      senderId: payload.receiverId ?? null,
      senderName: payload.receiverName || "Parts Manager",
      body,
      linkTo,
    });
  } catch (err) {
    console.warn("[truckStockNotify] notifyRequesterOfTransferReceived skipped:", err);
  }
}
