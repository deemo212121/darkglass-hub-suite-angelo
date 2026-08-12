/**
 * Truck Stock Requests — one unified queue for every cross-branch Truck
 * Stock movement: ticket-driven pulls (migration 0047,
 * truckStockRequests.ts — a part gets CONSUMED on a repair) and branch
 * restocks (migration 0164, truckStockTransfers.ts — inventory just
 * RELOCATES from one branch's shelf to another's). These used to be two
 * separate tabs; merged into one list with a "Reason" column so a Parts
 * Manager (or a requester tracking their own request) sees every unit
 * leaving/entering their branch in one place — nothing falls through the
 * cracks between "used on a job" and "sent to restock another branch."
 *
 * The two kinds still have genuinely different mechanics under the hood,
 * but both now share the same 4-stage "where is the part right now"
 * status: pending -> approved (in transit) -> received (complete), or
 * rejected at the pending stage.
 *   - Pull: approving stamps the ticket's Part Transaction line PO Made
 *     (same INH-… auto PO number the old immediate-pull path used), but
 *     that's not completion — the part still has to physically reach
 *     the TICKET's own branch. That branch confirms Mark Received,
 *     which promotes the Part Transaction line PO Made -> Part Ready.
 *   - Transfer: approving only marks it "in transit" — the destination
 *     branch has to separately confirm Mark Received (the point its own
 *     Truck Stock quantity actually increments) before it's complete.
 * Both reserve (decrement) the source branch's Truck Stock immediately
 * at request time and restore it on rejection.
 *
 * Visible to everyone with Part Inventory access (a requester needs to
 * see their own request's status, not just whoever can approve it).
 * Approve/Reject only render for the SOURCE branch's Parts Manager (the
 * one giving up the stock); Mark Received only renders for the
 * DESTINATION branch's Parts Manager (a transfer's explicit toBranch,
 * or a pull's ticket.location) — see canActOn below.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle, XCircle, Clock, Package, Truck, PackageCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getMyFullProfile } from "@/lib/supabase/users";
import { getPartById, updateTicketPart, logTicketAuditEntry } from "@/lib/supabase/tickets";
import { getTruckStock, incrementTruckStock, type TruckStockRow } from "@/lib/supabase/truckStock";
import {
  notifyRequesterOfPullDecision,
  notifyRequesterOfPullReceived,
  notifyPartsManagerOfPullInTransit,
  notifyRequesterOfTransferDecision,
  notifyRequesterOfTransferReceived,
  canApproveTruckStockPull,
} from "@/lib/truckStockNotify";
import {
  getTruckStockPullRequests,
  approveTruckStockPullRequest,
  rejectTruckStockPullRequest,
  markTruckStockPullRequestReceived,
  type TruckStockPullRequestRow,
} from "@/lib/supabase/truckStockRequests";
import {
  getTruckStockTransferRequests,
  approveTruckStockTransferRequest,
  rejectTruckStockTransferRequest,
  markTruckStockTransferReceived,
  type TruckStockTransferRow,
} from "@/lib/supabase/truckStockTransfers";

type Bucket = "pending" | "in_transit" | "completed" | "rejected";

interface UnifiedRow {
  id: string;
  kind: "pull" | "transfer";
  bucket: Bucket;
  partNo: string;
  quantity: number;
  branch: string;
  toBranch: string | null;
  storageLocation: string;
  ticketNo: string | null;
  /** Assigned technician on the ticket this pull is for — null for a transfer (no ticket involved). */
  ticketTechnician: string | null;
  requestedByName: string;
  requestedAt: string;
  reviewedByName: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  receivedByName: string;
  receivedAt: string | null;
  pull: TruckStockPullRequestRow | null;
  transfer: TruckStockTransferRow | null;
}

function fromPull(r: TruckStockPullRequestRow): UnifiedRow {
  return {
    id: r.id,
    kind: "pull",
    bucket: r.status === "pending" ? "pending" : r.status === "approved" ? "in_transit" : r.status === "received" ? "completed" : "rejected",
    partNo: r.partNo,
    quantity: r.quantity,
    branch: r.branch,
    // Destination = the ticket's own branch, i.e. wherever it'll actually be used — not the same as `branch` above (the source it's being pulled FROM).
    toBranch: r.ticketBranch || null,
    storageLocation: r.storageLocation,
    ticketNo: r.ticketNo,
    ticketTechnician: r.ticketTechnician || null,
    requestedByName: r.requestedByName,
    requestedAt: r.requestedAt,
    reviewedByName: r.reviewedByName,
    reviewedAt: r.reviewedAt,
    rejectionReason: r.rejectionReason,
    receivedByName: r.receivedByName,
    receivedAt: r.receivedAt,
    pull: r,
    transfer: null,
  };
}

function fromTransfer(r: TruckStockTransferRow): UnifiedRow {
  return {
    id: r.id,
    kind: "transfer",
    bucket: r.status === "pending" ? "pending" : r.status === "approved" ? "in_transit" : r.status === "received" ? "completed" : "rejected",
    partNo: r.partNo,
    quantity: r.quantity,
    branch: r.fromBranch,
    toBranch: r.toBranch,
    storageLocation: "",
    ticketNo: null,
    ticketTechnician: null,
    requestedByName: r.requestedByName,
    requestedAt: r.requestedAt,
    reviewedByName: r.reviewedByName,
    reviewedAt: r.reviewedAt,
    rejectionReason: r.rejectionReason,
    receivedByName: r.receivedByName,
    receivedAt: r.receivedAt,
    pull: null,
    transfer: r,
  };
}

export function TruckStockRequestsPanel({ highlightRequestId }: { highlightRequestId?: string } = {}) {
  const { uid, displayName, role, extraRoles } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [myAssignedBranch, setMyAssignedBranch] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<Bucket>("pending");
  const [rowsAll, setRowsAll] = useState<UnifiedRow[]>([]);
  const [stock, setStock] = useState<TruckStockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<UnifiedRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  // Arrived here from a bell-icon notification about a specific request —
  // once data loads, jump to whichever sub-tab actually has it and flash a
  // highlight so it isn't just "somewhere in this list."
  const [flashId, setFlashId] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    getMyFullProfile(uid)
      .then((p) => {
        setMyProfileId(p?.profileId ?? null);
        setMyAssignedBranch(p?.assignedBranch ?? null);
      })
      .catch(() => {
        setMyProfileId(null);
        setMyAssignedBranch(null);
      });
  }, [uid]);

  // Which branch gates a row's actions. Approve/Reject (pending) always
  // belongs to the SOURCE branch giving up the stock — for a pull that's
  // row.branch itself; for a transfer, the source is also where it's
  // reserved from, but review is gated to the destination instead (see
  // toBranch below — a transfer's approval already meant "I'll accept
  // this," decided by 0164's design). Mark Received (in_transit) always
  // belongs to the DESTINATION — row.toBranch for both kinds now that a
  // pull's toBranch is the ticket's own branch.
  const canActOn = (row: UnifiedRow) =>
    subTab === "pending"
      ? canApproveTruckStockPull(role, extraRoles, myAssignedBranch, row.kind === "pull" ? row.branch : (row.toBranch as string))
      : canApproveTruckStockPull(role, extraRoles, myAssignedBranch, (row.toBranch as string) ?? row.branch);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [pp, pa, pr, pRec, tp, ta, tr, tRec, s] = await Promise.all([
        getTruckStockPullRequests("pending"),
        getTruckStockPullRequests("approved"),
        getTruckStockPullRequests("rejected"),
        getTruckStockPullRequests("received"),
        getTruckStockTransferRequests("pending"),
        getTruckStockTransferRequests("approved"),
        getTruckStockTransferRequests("rejected"),
        getTruckStockTransferRequests("received"),
        getTruckStock(),
      ]);
      setRowsAll([
        ...pp.map(fromPull), ...pa.map(fromPull), ...pr.map(fromPull), ...pRec.map(fromPull),
        ...tp.map(fromTransfer), ...ta.map(fromTransfer), ...tr.map(fromTransfer), ...tRec.map(fromTransfer),
      ]);
      setStock(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!highlightRequestId || loading) return;
    const found = rowsAll.find((r) => r.id === highlightRequestId);
    if (!found) return;
    setSubTab(found.bucket);
    setFlashId(highlightRequestId);
    const scroll = () => document.getElementById(`truck-stock-request-${highlightRequestId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t1 = setTimeout(scroll, 50);
    const t2 = setTimeout(() => setFlashId(null), 3000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightRequestId, loading, rowsAll]);

  const byBucket = useMemo(() => {
    const out: Record<Bucket, UnifiedRow[]> = { pending: [], in_transit: [], completed: [], rejected: [] };
    for (const r of rowsAll) out[r.bucket].push(r);
    for (const b of Object.keys(out) as Bucket[]) out[b].sort((a, b2) => b2.requestedAt.localeCompare(a.requestedAt));
    return out;
  }, [rowsAll]);

  const stats = useMemo(() => {
    const available = stock.filter((s) => s.status === "in_stock").reduce((sum, s) => sum + s.quantity, 0);
    const inUse = stock.filter((s) => s.status === "in_use").reduce((sum, s) => sum + s.quantity, 0);
    return { available, inUse };
  }, [stock]);

  const handleApprove = async (row: UnifiedRow) => {
    setBusyId(row.id);
    try {
      if (row.kind === "pull" && row.pull) {
        const req = row.pull;
        const part = await getPartById(req.partId);
        if (!part) throw new Error("That Part Transaction line no longer exists on the ticket.");
        const today = new Date().toISOString().slice(0, 10);
        const autoPo = part.poNo || `INH-${req.branch.replace(/\s+/g, "").slice(0, 4).toUpperCase()}-${Date.now().toString().slice(-6)}`;
        const noteAdd = `Truck Stock pull approved by Parts Manager on ${today}.`;
        await updateTicketPart(req.partId, {
          ...part,
          partDist: `In-House (${req.branch})`,
          status: "PO Made",
          poNo: autoPo,
          poDate: part.poDate || today,
          note: part.note ? `${part.note}\n${noteAdd}` : noteAdd,
        });
        await logTicketAuditEntry({
          ticketId: req.ticketId,
          action: "Pulled from Truck Stock",
          field: "Status",
          beforeValue: "Need PO",
          afterValue: `${req.partNo} - Status: PO Made - PO #: ${autoPo} - From: ${req.branch}${req.storageLocation ? ` @ ${req.storageLocation}` : ""}`,
          changedBy: myProfileId,
        });
        await approveTruckStockPullRequest(req.id, myProfileId);
        void notifyRequesterOfPullDecision({
          requesterId: req.requestedBy,
          approved: true,
          partNo: req.partNo,
          qty: req.quantity,
          ticketNo: req.ticketNo,
          reviewerName: displayName,
          reviewerId: myProfileId,
        });
        void notifyPartsManagerOfPullInTransit({
          actorName: displayName || "Parts Manager",
          ticketNo: req.ticketNo,
          partNo: req.partNo,
          qty: req.quantity,
          sourceBranch: req.branch,
          destBranch: req.ticketBranch,
          requestId: req.id,
        });
      } else if (row.transfer) {
        const req = row.transfer;
        await approveTruckStockTransferRequest(req.id, myProfileId);
        void notifyRequesterOfTransferDecision({
          requesterId: req.requestedBy,
          approved: true,
          partNo: req.partNo,
          qty: req.quantity,
          fromBranch: req.fromBranch,
          toBranch: req.toBranch,
          reviewerName: displayName,
          reviewerId: myProfileId,
          requestId: req.id,
        });
      }
      await load();
    } catch (err) {
      alert(`Failed to approve: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    setBusyId(rejectTarget.id);
    try {
      if (rejectTarget.kind === "pull" && rejectTarget.pull) {
        const req = rejectTarget.pull;
        await incrementTruckStock({ branch: req.branch, partNo: req.partNo, qty: req.quantity });
        const part = await getPartById(req.partId);
        if (part) {
          const noteAdd = `Truck Stock pull rejected by Parts Manager${rejectReason ? `: ${rejectReason}` : "."}`;
          await updateTicketPart(req.partId, {
            ...part,
            status: "Need PO",
            note: part.note ? `${part.note}\n${noteAdd}` : noteAdd,
          });
        }
        await rejectTruckStockPullRequest(req.id, myProfileId, rejectReason);
        void notifyRequesterOfPullDecision({
          requesterId: req.requestedBy,
          approved: false,
          partNo: req.partNo,
          qty: req.quantity,
          ticketNo: req.ticketNo,
          reason: rejectReason,
          reviewerName: displayName,
          reviewerId: myProfileId,
        });
      } else if (rejectTarget.transfer) {
        const req = rejectTarget.transfer;
        // Give the reserved quantity back to the source branch — it was
        // decremented immediately at request time.
        await incrementTruckStock({ branch: req.fromBranch, partNo: req.partNo, qty: req.quantity });
        await rejectTruckStockTransferRequest(req.id, myProfileId, rejectReason);
        void notifyRequesterOfTransferDecision({
          requesterId: req.requestedBy,
          approved: false,
          partNo: req.partNo,
          qty: req.quantity,
          fromBranch: req.fromBranch,
          toBranch: req.toBranch,
          reason: rejectReason,
          reviewerName: displayName,
          reviewerId: myProfileId,
          requestId: req.id,
        });
      }
      setRejectTarget(null);
      setRejectReason("");
      await load();
    } catch (err) {
      alert(`Failed to reject: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleMarkReceived = async (row: UnifiedRow) => {
    setBusyId(row.id);
    try {
      if (row.kind === "pull" && row.pull) {
        const req = row.pull;
        // The part has now physically reached the ticket's branch — promote
        // the Part Transaction line the rest of the way, same as a real
        // Marcone PO promotes to Part Ready on physical arrival. Only if it's
        // still PO Made: someone may have manually moved it on since approval
        // (Used, Cancelled, etc.), and that manual call shouldn't be clobbered.
        const part = await getPartById(req.partId);
        if (part && part.status === "PO Made") {
          const today = new Date().toISOString().slice(0, 10);
          const noteAdd = `Received at ${req.ticketBranch || "destination branch"} on ${today}.`;
          await updateTicketPart(req.partId, {
            ...part,
            status: "Part Ready",
            note: part.note ? `${part.note}\n${noteAdd}` : noteAdd,
          });
          await logTicketAuditEntry({
            ticketId: req.ticketId,
            action: "Truck Stock pull received",
            field: "Status",
            beforeValue: "PO Made",
            afterValue: "Part Ready",
            changedBy: myProfileId,
          });
        }
        await markTruckStockPullRequestReceived(req.id, myProfileId);
        void notifyRequesterOfPullReceived({
          requesterId: req.requestedBy,
          partNo: req.partNo,
          qty: req.quantity,
          ticketNo: req.ticketNo,
          branch: req.branch,
          receiverName: displayName,
          receiverId: myProfileId,
        });
      } else if (row.transfer) {
        const req = row.transfer;
        // Parts are now physically at the destination branch — this is the
        // one point where the destination's on-hand quantity actually goes up.
        await incrementTruckStock({ branch: req.toBranch, partNo: req.partNo, qty: req.quantity });
        await markTruckStockTransferReceived(req.id, myProfileId);
        void notifyRequesterOfTransferReceived({
          requesterId: req.requestedBy,
          partNo: req.partNo,
          qty: req.quantity,
          fromBranch: req.fromBranch,
          toBranch: req.toBranch,
          receiverName: displayName,
          receiverId: myProfileId,
          requestId: req.id,
        });
      }
      await load();
    } catch (err) {
      alert(`Failed to mark received: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyId(null);
    }
  };

  const rows = byBucket[subTab];
  const showReviewed = subTab !== "pending";
  const showReceived = subTab === "completed";
  const showReason = subTab === "rejected";
  const showActions = subTab === "pending" || subTab === "in_transit";
  const colCount = 5 + 2 + (showReviewed ? 2 : 0) + (showReceived ? 2 : 0) + (showReason ? 1 : 0) + (showActions ? 1 : 0);

  const BUCKET_LABEL: Record<Bucket, string> = { pending: "Pending", in_transit: "In Transit", completed: "Completed", rejected: "Rejected" };
  const BUCKET_EMPTY: Record<Bucket, string> = {
    pending: "No pending requests.",
    in_transit: "Nothing in transit.",
    completed: "No completed requests yet.",
    rejected: "No rejected requests yet.",
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4">
          <div className="flex items-center gap-2 text-amber-300"><Clock className="h-4 w-4" /><span className="text-xs font-semibold uppercase tracking-wide">Pending</span></div>
          <p className="text-2xl font-bold text-white mt-1">{byBucket.pending.length}</p>
        </div>
        <div className="rounded-xl border border-sky-400/30 bg-sky-500/10 p-4">
          <div className="flex items-center gap-2 text-sky-300"><Truck className="h-4 w-4" /><span className="text-xs font-semibold uppercase tracking-wide">In Transit</span></div>
          <p className="text-2xl font-bold text-white mt-1">{byBucket.in_transit.length}</p>
        </div>
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4">
          <div className="flex items-center gap-2 text-emerald-300"><Package className="h-4 w-4" /><span className="text-xs font-semibold uppercase tracking-wide">Available (Truck Stock)</span></div>
          <p className="text-2xl font-bold text-white mt-1">{stats.available}</p>
        </div>
        <div className="rounded-xl border border-violet-400/30 bg-violet-500/10 p-4">
          <div className="flex items-center gap-2 text-violet-300"><Truck className="h-4 w-4" /><span className="text-xs font-semibold uppercase tracking-wide">In Use (Truck Stock)</span></div>
          <p className="text-2xl font-bold text-white mt-1">{stats.inUse}</p>
        </div>
      </div>

      <div className="flex gap-2 border-b border-white/10">
        {(["pending", "in_transit", "completed", "rejected"] as Bucket[]).map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => setSubTab(b)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition flex items-center gap-1.5 ${
              subTab === b
                ? b === "pending" ? "border-amber-500 text-amber-300"
                : b === "in_transit" ? "border-sky-500 text-sky-300"
                : b === "completed" ? "border-emerald-500 text-emerald-300"
                : "border-rose-500 text-rose-300"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {BUCKET_LABEL[b]}
            {(b === "pending" || b === "in_transit") && byBucket[b].length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-white/10">{byBucket[b].length}</span>
            )}
          </button>
        ))}
      </div>

      {error && <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>}

      <div className="rounded-xl border border-white/10 bg-white/5 overflow-x-auto">
        <table className="w-full text-xs text-white">
          <thead className="bg-slate-900/60 text-slate-300">
            <tr>
              <th className="px-3 py-2 text-left">Part No</th>
              <th className="px-3 py-2 text-left">Ticket No.</th>
              <th className="px-3 py-2 text-left">Technician</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-left">Branch</th>
              <th className="px-3 py-2 text-left">Requested By</th>
              <th className="px-3 py-2 text-left">Requested At</th>
              {showReviewed && <th className="px-3 py-2 text-left">Reviewed By</th>}
              {showReviewed && <th className="px-3 py-2 text-left">Reviewed At</th>}
              {showReceived && <th className="px-3 py-2 text-left">Received By</th>}
              {showReceived && <th className="px-3 py-2 text-left">Received At</th>}
              {showReason && <th className="px-3 py-2 text-left">Reason</th>}
              {showActions && <th className="px-3 py-2 w-44"></th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={colCount} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={colCount} className="px-3 py-8 text-center text-slate-400">{BUCKET_EMPTY[subTab]}</td></tr>
            ) : (
              rows.map((r) => {
                const mayAct = showActions && canActOn(r);
                return (
                  <tr key={r.id} id={`truck-stock-request-${r.id}`} className={`border-t border-white/5 hover:bg-white/5 transition-colors duration-500 ${flashId === r.id ? "bg-amber-500/20" : ""}`}>
                    <td className="px-3 py-2 font-mono">{r.partNo}</td>
                    <td className="px-3 py-2">
                      {r.kind === "pull" ? (
                        r.ticketNo ? (
                          <Link to="/ticket/$ticketNo" params={{ ticketNo: r.ticketNo }} target="_blank" className="text-blue-400 hover:text-blue-300 hover:underline font-mono">{r.ticketNo}</Link>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )
                      ) : (
                        <span className="text-slate-300">Branch Restock</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-300">{r.ticketTechnician || "—"}</td>
                    <td className="px-3 py-2 text-right font-semibold">{r.quantity}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {r.kind === "pull" ? (
                        <>
                          {r.branch}{r.storageLocation ? ` @ ${r.storageLocation}` : ""}
                          {r.toBranch ? <> <span className="text-slate-500">→</span> {r.toBranch}</> : null}
                        </>
                      ) : (
                        <>{r.branch} <span className="text-slate-500">→</span> {r.toBranch}</>
                      )}
                    </td>
                    <td className="px-3 py-2">{r.requestedByName || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-400">{new Date(r.requestedAt).toLocaleString()}</td>
                    {showReviewed && <td className="px-3 py-2">{r.reviewedByName || "—"}</td>}
                    {showReviewed && <td className="px-3 py-2 whitespace-nowrap text-slate-400">{r.reviewedAt ? new Date(r.reviewedAt).toLocaleString() : "—"}</td>}
                    {showReceived && <td className="px-3 py-2">{r.receivedByName || "—"}</td>}
                    {showReceived && <td className="px-3 py-2 whitespace-nowrap text-slate-400">{r.receivedAt ? new Date(r.receivedAt).toLocaleString() : "—"}</td>}
                    {showReason && <td className="px-3 py-2 text-rose-200 max-w-xs" title={r.rejectionReason || ""}>{r.rejectionReason || "—"}</td>}
                    {showActions && (
                      <td className="px-3 py-2">
                        {mayAct ? (
                          subTab === "pending" ? (
                            <div className="flex items-center justify-end gap-1">
                              <button type="button" onClick={() => handleApprove(r)} disabled={busyId === r.id} className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-40">
                                <CheckCircle className="h-3 w-3" /> Approve
                              </button>
                              <button type="button" onClick={() => { setRejectTarget(r); setRejectReason(""); }} disabled={busyId === r.id} className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25 disabled:opacity-40">
                                <XCircle className="h-3 w-3" /> Reject
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end">
                              <button type="button" onClick={() => handleMarkReceived(r)} disabled={busyId === r.id} className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-40">
                                <PackageCheck className="h-3 w-3" /> Mark Received
                              </button>
                            </div>
                          )
                        ) : (
                          <span className="text-[11px] text-slate-500">
                            {subTab === "pending" ? `Awaiting ${r.kind === "pull" ? r.branch : r.toBranch}'s Parts Manager` : `In transit to ${r.toBranch}`}
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {rejectTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={() => setRejectTarget(null)}>
          <div className="w-full max-w-md rounded-xl border border-white/10 bg-slate-950 text-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-1">Reject request</h3>
            <p className="text-xs text-slate-400 mb-3">
              {rejectTarget.kind === "pull" ? (
                <>{rejectTarget.partNo} × {rejectTarget.quantity} from {rejectTarget.branch} for ticket {rejectTarget.ticketNo}. The reserved quantity goes back into Truck Stock and the Part Transaction line reverts to Need PO.</>
              ) : (
                <>{rejectTarget.partNo} × {rejectTarget.quantity} from {rejectTarget.branch} to {rejectTarget.toBranch}. The reserved quantity goes back into {rejectTarget.branch}'s Truck Stock.</>
              )}
            </p>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Reason (optional)</label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              placeholder="Let the requester know why…"
              className="w-full rounded border border-white/15 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-rose-400 resize-none mb-4"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleReject}
                disabled={busyId === rejectTarget.id}
                className="flex-1 rounded bg-rose-600 hover:bg-rose-500 disabled:opacity-40 px-3 py-2 text-sm font-semibold"
              >
                {busyId === rejectTarget.id ? "Rejecting…" : "Reject"}
              </button>
              <button type="button" onClick={() => setRejectTarget(null)} className="flex-1 rounded border border-white/15 hover:bg-white/10 px-3 py-2 text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
