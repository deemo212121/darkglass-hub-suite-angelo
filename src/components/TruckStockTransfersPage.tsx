/**
 * Branch Transfers — status/location tracking + Parts Manager approval
 * for Truck Stock branch-to-branch transfer requests (migration 0164,
 * src/lib/supabase/truckStockTransfers.ts). Embedded as a tab inside
 * PartInventory.tsx, alongside Part Inventory, Truck Stock, and Truck
 * Stock Requests.
 *
 * Unlike the Truck Stock Requests tab (ticket-driven pulls, visible only
 * to approvers), this tab is visible to EVERYONE with Part Inventory
 * access — a plain Parts requester needs to see their own request's
 * status/location too ("where is the parts right now"), not just
 * whoever can approve it. Approve/Reject/Mark Received actions are
 * still gated per-row to the destination branch's own Parts Manager (or
 * Admin/SuperAdmin), via canApproveTruckStockTransfer.
 */

import { useEffect, useMemo, useState } from "react";
import { CheckCircle, XCircle, Clock, PackageCheck, Truck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getMyFullProfile } from "@/lib/supabase/users";
import { incrementTruckStock } from "@/lib/supabase/truckStock";
import { canApproveTruckStockTransfer, notifyRequesterOfTransferDecision, notifyRequesterOfTransferReceived } from "@/lib/truckStockNotify";
import {
  getTruckStockTransferRequests,
  approveTruckStockTransferRequest,
  rejectTruckStockTransferRequest,
  markTruckStockTransferReceived,
  type TruckStockTransferRow,
} from "@/lib/supabase/truckStockTransfers";

export function TruckStockTransfersPanel({ highlightRequestId }: { highlightRequestId?: string } = {}) {
  const { uid, role, extraRoles, displayName } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [myAssignedBranch, setMyAssignedBranch] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<"pending" | "approved" | "received" | "rejected">("pending");
  const [pending, setPending] = useState<TruckStockTransferRow[]>([]);
  const [approved, setApproved] = useState<TruckStockTransferRow[]>([]);
  const [received, setReceived] = useState<TruckStockTransferRow[]>([]);
  const [rejected, setRejected] = useState<TruckStockTransferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<TruckStockTransferRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
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

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, a, rec, rej] = await Promise.all([
        getTruckStockTransferRequests("pending"),
        getTruckStockTransferRequests("approved"),
        getTruckStockTransferRequests("received"),
        getTruckStockTransferRequests("rejected"),
      ]);
      setPending(p);
      setApproved(a);
      setReceived(rec);
      setRejected(rej);
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
    const inPending = pending.some((r) => r.id === highlightRequestId);
    const inApproved = approved.some((r) => r.id === highlightRequestId);
    const inReceived = received.some((r) => r.id === highlightRequestId);
    const inRejected = rejected.some((r) => r.id === highlightRequestId);
    if (!inPending && !inApproved && !inReceived && !inRejected) return;
    setSubTab(inPending ? "pending" : inApproved ? "approved" : inReceived ? "received" : "rejected");
    setFlashId(highlightRequestId);
    const scroll = () => document.getElementById(`truck-stock-transfer-${highlightRequestId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t1 = setTimeout(scroll, 50);
    const t2 = setTimeout(() => setFlashId(null), 3000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightRequestId, loading, pending, approved, received, rejected]);

  const canActOn = (toBranch: string) => canApproveTruckStockTransfer(role, extraRoles, myAssignedBranch, toBranch);

  const handleApprove = async (req: TruckStockTransferRow) => {
    setBusyId(req.id);
    try {
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
      // Give the reserved quantity back to the source branch — it was
      // decremented immediately at request time.
      await incrementTruckStock({ branch: rejectTarget.fromBranch, partNo: rejectTarget.partNo, qty: rejectTarget.quantity });
      await rejectTruckStockTransferRequest(rejectTarget.id, myProfileId, rejectReason);
      void notifyRequesterOfTransferDecision({
        requesterId: rejectTarget.requestedBy,
        approved: false,
        partNo: rejectTarget.partNo,
        qty: rejectTarget.quantity,
        fromBranch: rejectTarget.fromBranch,
        toBranch: rejectTarget.toBranch,
        reason: rejectReason,
        reviewerName: displayName,
        reviewerId: myProfileId,
        requestId: rejectTarget.id,
      });
      setRejectTarget(null);
      setRejectReason("");
      await load();
    } catch (err) {
      alert(`Failed to reject: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleMarkReceived = async (req: TruckStockTransferRow) => {
    setBusyId(req.id);
    try {
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
      await load();
    } catch (err) {
      alert(`Failed to mark received: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyId(null);
    }
  };

  const stats = useMemo(
    () => ({ pending: pending.length, inTransit: approved.length }),
    [pending, approved],
  );

  const rows = subTab === "pending" ? pending : subTab === "approved" ? approved : subTab === "received" ? received : rejected;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4">
          <div className="flex items-center gap-2 text-amber-300"><Clock className="h-4 w-4" /><span className="text-xs font-semibold uppercase tracking-wide">Pending Approval</span></div>
          <p className="text-2xl font-bold text-white mt-1">{stats.pending}</p>
        </div>
        <div className="rounded-xl border border-sky-400/30 bg-sky-500/10 p-4">
          <div className="flex items-center gap-2 text-sky-300"><Truck className="h-4 w-4" /><span className="text-xs font-semibold uppercase tracking-wide">In Transit</span></div>
          <p className="text-2xl font-bold text-white mt-1">{stats.inTransit}</p>
        </div>
      </div>

      <div className="flex gap-2 border-b border-white/10">
        <button type="button" onClick={() => setSubTab("pending")} className={`px-4 py-2 text-sm font-semibold border-b-2 transition flex items-center gap-1.5 ${subTab === "pending" ? "border-amber-500 text-amber-300" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
          Pending
          {pending.length > 0 && <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30">{pending.length}</span>}
        </button>
        <button type="button" onClick={() => setSubTab("approved")} className={`px-4 py-2 text-sm font-semibold border-b-2 transition flex items-center gap-1.5 ${subTab === "approved" ? "border-sky-500 text-sky-300" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
          In Transit
          {approved.length > 0 && <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-sky-500/20 text-sky-300 border border-sky-500/30">{approved.length}</span>}
        </button>
        <button type="button" onClick={() => setSubTab("received")} className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${subTab === "received" ? "border-emerald-500 text-emerald-300" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
          Received
        </button>
        <button type="button" onClick={() => setSubTab("rejected")} className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${subTab === "rejected" ? "border-rose-500 text-rose-300" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
          Rejected
        </button>
      </div>

      {error && <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>}

      <div className="rounded-xl border border-white/10 bg-white/5 overflow-x-auto">
        <table className="w-full text-xs text-white">
          <thead className="bg-slate-900/60 text-slate-300">
            <tr>
              <th className="px-3 py-2 text-left">Part No</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-left">From → To</th>
              <th className="px-3 py-2 text-left">Requested By</th>
              <th className="px-3 py-2 text-left">Requested At</th>
              {subTab !== "pending" && <th className="px-3 py-2 text-left">Reviewed By</th>}
              {subTab !== "pending" && <th className="px-3 py-2 text-left">Reviewed At</th>}
              {subTab === "received" && <th className="px-3 py-2 text-left">Received By</th>}
              {subTab === "received" && <th className="px-3 py-2 text-left">Received At</th>}
              {subTab === "rejected" && <th className="px-3 py-2 text-left">Reason</th>}
              {(subTab === "pending" || subTab === "approved") && <th className="px-3 py-2 w-44"></th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">
                {subTab === "pending" ? "No pending transfer requests." : subTab === "approved" ? "Nothing in transit." : subTab === "received" ? "No completed transfers yet." : "No rejected requests yet."}
              </td></tr>
            ) : (
              rows.map((r) => {
                const mayAct = canActOn(r.toBranch);
                return (
                  <tr key={r.id} id={`truck-stock-transfer-${r.id}`} className={`border-t border-white/5 hover:bg-white/5 transition-colors duration-500 ${flashId === r.id ? "bg-amber-500/20" : ""}`}>
                    <td className="px-3 py-2 font-mono">{r.partNo}</td>
                    <td className="px-3 py-2 text-right font-semibold">{r.quantity}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.fromBranch} <span className="text-slate-500">→</span> {r.toBranch}</td>
                    <td className="px-3 py-2">{r.requestedByName || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-400">{new Date(r.requestedAt).toLocaleString()}</td>
                    {subTab !== "pending" && <td className="px-3 py-2">{r.reviewedByName || "—"}</td>}
                    {subTab !== "pending" && <td className="px-3 py-2 whitespace-nowrap text-slate-400">{r.reviewedAt ? new Date(r.reviewedAt).toLocaleString() : "—"}</td>}
                    {subTab === "received" && <td className="px-3 py-2">{r.receivedByName || "—"}</td>}
                    {subTab === "received" && <td className="px-3 py-2 whitespace-nowrap text-slate-400">{r.receivedAt ? new Date(r.receivedAt).toLocaleString() : "—"}</td>}
                    {subTab === "rejected" && <td className="px-3 py-2 text-rose-200 max-w-xs" title={r.rejectionReason || ""}>{r.rejectionReason || "—"}</td>}
                    {subTab === "pending" && (
                      <td className="px-3 py-2">
                        {mayAct ? (
                          <div className="flex items-center justify-end gap-1">
                            <button type="button" onClick={() => handleApprove(r)} disabled={busyId === r.id} className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-40">
                              <CheckCircle className="h-3 w-3" /> Approve
                            </button>
                            <button type="button" onClick={() => { setRejectTarget(r); setRejectReason(""); }} disabled={busyId === r.id} className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25 disabled:opacity-40">
                              <XCircle className="h-3 w-3" /> Reject
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-500">Awaiting {r.toBranch}'s Parts Manager</span>
                        )}
                      </td>
                    )}
                    {subTab === "approved" && (
                      <td className="px-3 py-2">
                        {mayAct ? (
                          <div className="flex items-center justify-end">
                            <button type="button" onClick={() => handleMarkReceived(r)} disabled={busyId === r.id} className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-40">
                              <PackageCheck className="h-3 w-3" /> Mark Received
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-500">In transit to {r.toBranch}</span>
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
            <h3 className="text-sm font-semibold mb-1">Reject transfer request</h3>
            <p className="text-xs text-slate-400 mb-3">
              {rejectTarget.partNo} × {rejectTarget.quantity} from {rejectTarget.fromBranch} to {rejectTarget.toBranch}. The reserved quantity goes back into {rejectTarget.fromBranch}'s Truck Stock.
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
              <button type="button" onClick={handleReject} disabled={busyId === rejectTarget.id} className="flex-1 rounded bg-rose-600 hover:bg-rose-500 disabled:opacity-40 px-3 py-2 text-sm font-semibold">
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
