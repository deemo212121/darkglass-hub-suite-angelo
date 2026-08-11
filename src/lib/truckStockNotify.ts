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

/** Roles that can approve/reject Truck Stock pull requests — gates both the
 * Truck Stock Requests tab and who gets notified about a new request. */
const APPROVER_ROLE_CODES = new Set<string>(["PARTS_MANAGER", "ADMIN", "SUPERADMIN"]);

/** Roles allowed to approve/reject Truck Stock pull requests — the Truck Stock Requests tab. */
export function canApproveTruckStockPulls(
  primaryRole: string | null | undefined,
  extraRoles: string[] | null | undefined,
): boolean {
  const all = [primaryRole, ...(extraRoles ?? [])]
    .map((r) => String(r ?? "").trim().toUpperCase())
    .filter(Boolean);
  return all.some((r) => APPROVER_ROLE_CODES.has(r));
}

async function findApproverProfileIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, role, extra_roles")
    .eq("is_active", true);
  if (error) {
    console.warn("[truckStockNotify] findApproverProfileIds error:", error.message);
    return [];
  }
  return (data ?? [])
    .filter((r: any) => {
      const roles = [r.role, ...(r.extra_roles ?? [])].map((v: unknown) => String(v ?? "").trim().toUpperCase());
      return roles.some((v) => APPROVER_ROLE_CODES.has(v));
    })
    .map((r: any) => r.id as string);
}

/** Ping every Parts Manager in the company that a pull request needs review. Fire-and-forget. */
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
    const recipientIds = await findApproverProfileIds();
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
      ? `Part ${payload.partNo} for Ticket ${payload.ticketNo} is Approved. Your Truck Stock request (${qtyLabel}) is now PO Made.`
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

// ---------------------------------------------------------------------
// Branch-to-branch Truck Stock transfer requests (migration 0164) —
// distinct workflow from the ticket-driven pulls above: moves existing
// stock from one branch to another, so approval is scoped to the
// DESTINATION branch's own Parts Manager, not any Parts Manager
// company-wide.
// ---------------------------------------------------------------------

const TRANSFER_LINK = "/m/parts/part-inventory?tab=truck-stock-transfers";

/**
 * Whether the given role/branch can approve/reject/mark-received a
 * transfer INTO `toBranch`. Admin/SuperAdmin can act on any branch
 * (company-wide oversight, same as every other approval gate in this
 * app); a Parts Manager can only act on transfers headed to their OWN
 * assigned_branch — they're not authorized to sign off on stock arriving
 * somewhere else.
 */
export function canApproveTruckStockTransfer(
  primaryRole: string | null | undefined,
  extraRoles: string[] | null | undefined,
  assignedBranch: string | null | undefined,
  toBranch: string,
): boolean {
  const all = [primaryRole, ...(extraRoles ?? [])]
    .map((r) => String(r ?? "").trim().toUpperCase())
    .filter(Boolean);
  if (all.some((r) => r === "ADMIN" || r === "SUPERADMIN")) return true;
  if (!all.includes("PARTS_MANAGER")) return false;
  return String(assignedBranch ?? "").trim().toLowerCase() === toBranch.trim().toLowerCase();
}

/**
 * Parts Managers assigned to `toBranch` specifically — falls back to
 * every Parts Manager/Admin/SuperAdmin company-wide if nobody is
 * assigned there, so a request never silently strands with zero
 * possible approvers just because a branch has no Parts Manager on file
 * yet.
 */
async function findDestinationApproverProfileIds(toBranch: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, role, extra_roles, assigned_branch")
    .eq("is_active", true);
  if (error) {
    console.warn("[truckStockNotify] findDestinationApproverProfileIds error:", error.message);
    return [];
  }
  const rows = data ?? [];
  const isPartsManager = (r: any) => {
    const roles = [r.role, ...(r.extra_roles ?? [])].map((v: unknown) => String(v ?? "").trim().toUpperCase());
    return roles.includes("PARTS_MANAGER");
  };
  const atBranch = rows
    .filter((r: any) => isPartsManager(r) && String(r.assigned_branch ?? "").trim().toLowerCase() === toBranch.trim().toLowerCase())
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
    const recipientIds = await findDestinationApproverProfileIds(payload.toBranch);
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
