/**
 * Truck Stock Requests — Parts Manager approval queue for Truck Stock pulls
 * (see migration 0047, src/lib/supabase/truckStockRequests.ts). Embedded as
 * a tab inside PartInventory.tsx alongside Part Inventory and Truck Stock.
 *
 * A non-privileged requester's "fulfill in-house" click on a ticket reserves
 * the stock immediately but leaves the Part Transaction line "Need PO" and
 * lands a 'pending' row here. Approving marks that line PO Made (same
 * INH-… auto PO number and audit-log shape the old immediate-pull path
 * used, so Truck Stock's "where is this part used" popup still resolves
 * correctly). Rejecting restores the reserved quantity and reverts the
 * line to Need PO.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle, XCircle, Clock, Package, Truck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import { getPartById, updateTicketPart, logTicketAuditEntry } from "@/lib/supabase/tickets";
import { getTruckStock, incrementTruckStock, type TruckStockRow } from "@/lib/supabase/truckStock";
import { notifyRequesterOfPullDecision } from "@/lib/truckStockNotify";
import {
  getTruckStockPullRequests,
  approveTruckStockPullRequest,
  rejectTruckStockPullRequest,
  type TruckStockPullRequestRow,
} from "@/lib/supabase/truckStockRequests";

export function TruckStockRequestsPanel({ highlightRequestId }: { highlightRequestId?: string } = {}) {
  const { uid } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<"pending" | "approved" | "rejected">("pending");
  const [pending, setPending] = useState<TruckStockPullRequestRow[]>([]);
  const [approved, setApproved] = useState<TruckStockPullRequestRow[]>([]);
  const [rejected, setRejected] = useState<TruckStockPullRequestRow[]>([]);
  const [stock, setStock] = useState<TruckStockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<TruckStockPullRequestRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  // Arrived here from a bell-icon notification about a specific request —
  // once data loads, jump to whichever sub-tab actually has it and flash a
  // highlight so it isn't just "somewhere in this list."
  const [flashId, setFlashId] = useState<string | null>(null);

  useEffect(() => {
    if (uid) getMyProfileId(uid).then(setMyProfileId).catch(() => setMyProfileId(null));
  }, [uid]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, a, r, s] = await Promise.all([
        getTruckStockPullRequests("pending"),
        getTruckStockPullRequests("approved"),
        getTruckStockPullRequests("rejected"),
        getTruckStock(),
      ]);
      setPending(p);
      setApproved(a);
      setRejected(r);
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
    const inPending = pending.some((r) => r.id === highlightRequestId);
    const inApproved = approved.some((r) => r.id === highlightRequestId);
    const inRejected = rejected.some((r) => r.id === highlightRequestId);
    if (!inPending && !inApproved && !inRejected) return;
    setSubTab(inPending ? "pending" : inApproved ? "approved" : "rejected");
    setFlashId(highlightRequestId);
    const scroll = () => document.getElementById(`truck-stock-request-${highlightRequestId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t1 = setTimeout(scroll, 50);
    const t2 = setTimeout(() => setFlashId(null), 3000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightRequestId, loading, pending, approved, rejected]);

  const stats = useMemo(() => {
    const available = stock.filter((s) => s.status === "in_stock").reduce((sum, s) => sum + s.quantity, 0);
    const inUse = stock.filter((s) => s.status === "in_use").reduce((sum, s) => sum + s.quantity, 0);
    return { available, inUse };
  }, [stock]);

  const handleApprove = async (req: TruckStockPullRequestRow) => {
    setBusyId(req.id);
    try {
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
      await incrementTruckStock({ branch: rejectTarget.branch, partNo: rejectTarget.partNo, qty: rejectTarget.quantity });
      const part = await getPartById(rejectTarget.partId);
      if (part) {
        const noteAdd = `Truck Stock pull rejected by Parts Manager${rejectReason ? `: ${rejectReason}` : "."}`;
        await updateTicketPart(rejectTarget.partId, {
          ...part,
          status: "Need PO",
          note: part.note ? `${part.note}\n${noteAdd}` : noteAdd,
        });
      }
      await rejectTruckStockPullRequest(rejectTarget.id, myProfileId, rejectReason);
      void notifyRequesterOfPullDecision({
        requesterId: rejectTarget.requestedBy,
        approved: false,
        partNo: rejectTarget.partNo,
        qty: rejectTarget.quantity,
        ticketNo: rejectTarget.ticketNo,
        reason: rejectReason,
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

  const rows = subTab === "pending" ? pending : subTab === "approved" ? approved : rejected;
  const colCount = subTab === "pending" ? 7 : subTab === "approved" ? 8 : 9;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4">
          <div className="flex items-center gap-2 text-amber-300"><Clock className="h-4 w-4" /><span className="text-xs font-semibold uppercase tracking-wide">Pending Requests</span></div>
          <p className="text-2xl font-bold text-white mt-1">{pending.length}</p>
        </div>
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4">
          <div className="flex items-center gap-2 text-emerald-300"><Package className="h-4 w-4" /><span className="text-xs font-semibold uppercase tracking-wide">Available (Truck Stock)</span></div>
          <p className="text-2xl font-bold text-white mt-1">{stats.available}</p>
        </div>
        <div className="rounded-xl border border-sky-400/30 bg-sky-500/10 p-4">
          <div className="flex items-center gap-2 text-sky-300"><Truck className="h-4 w-4" /><span className="text-xs font-semibold uppercase tracking-wide">In Use (Truck Stock)</span></div>
          <p className="text-2xl font-bold text-white mt-1">{stats.inUse}</p>
        </div>
      </div>

      <div className="flex gap-2 border-b border-white/10">
        <button
          type="button"
          onClick={() => setSubTab("pending")}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition flex items-center gap-1.5 ${subTab === "pending" ? "border-amber-500 text-amber-300" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          Pending
          {pending.length > 0 && <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30">{pending.length}</span>}
        </button>
        <button
          type="button"
          onClick={() => setSubTab("approved")}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${subTab === "approved" ? "border-emerald-500 text-emerald-300" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          Approved
        </button>
        <button
          type="button"
          onClick={() => setSubTab("rejected")}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${subTab === "rejected" ? "border-rose-500 text-rose-300" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          Rejected
        </button>
      </div>

      {error && <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>}

      <div className="rounded-xl border border-white/10 bg-white/5 overflow-x-auto">
        <table className="w-full text-xs text-white">
          <thead className="bg-slate-900/60 text-slate-300">
            <tr>
              <th className="px-3 py-2 text-left">Part No</th>
              <th className="px-3 py-2 text-left">Ticket</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-left">Branch</th>
              <th className="px-3 py-2 text-left">Requested By</th>
              <th className="px-3 py-2 text-left">Requested At</th>
              {subTab === "approved" && <th className="px-3 py-2 text-left">Approved By</th>}
              {subTab === "approved" && <th className="px-3 py-2 text-left">Approved At</th>}
              {subTab === "rejected" && <th className="px-3 py-2 text-left">Rejected By</th>}
              {subTab === "rejected" && <th className="px-3 py-2 text-left">Rejected At</th>}
              {subTab === "rejected" && <th className="px-3 py-2 text-left">Reason</th>}
              {subTab === "pending" && <th className="px-3 py-2 w-40"></th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={colCount} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={colCount} className="px-3 py-8 text-center text-slate-400">{subTab === "pending" ? "No pending requests." : subTab === "approved" ? "No approved requests yet." : "No rejected requests yet."}</td></tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.id}
                  id={`truck-stock-request-${r.id}`}
                  className={`border-t border-white/5 hover:bg-white/5 transition-colors duration-500 ${flashId === r.id ? "bg-amber-500/20" : ""}`}
                >
                  <td className="px-3 py-2 font-mono">{r.partNo}</td>
                  <td className="px-3 py-2 font-mono">
                    {r.ticketNo ? (
                      <Link to="/ticket/$ticketNo" params={{ ticketNo: r.ticketNo }} className="text-blue-400 hover:text-blue-300 hover:underline">{r.ticketNo}</Link>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">{r.quantity}</td>
                  <td className="px-3 py-2">{r.branch}{r.storageLocation ? ` @ ${r.storageLocation}` : ""}</td>
                  <td className="px-3 py-2">{r.requestedByName || "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-400">{new Date(r.requestedAt).toLocaleString()}</td>
                  {subTab === "approved" && <td className="px-3 py-2">{r.reviewedByName || "—"}</td>}
                  {subTab === "approved" && <td className="px-3 py-2 whitespace-nowrap text-slate-400">{r.reviewedAt ? new Date(r.reviewedAt).toLocaleString() : "—"}</td>}
                  {subTab === "rejected" && <td className="px-3 py-2">{r.reviewedByName || "—"}</td>}
                  {subTab === "rejected" && <td className="px-3 py-2 whitespace-nowrap text-slate-400">{r.reviewedAt ? new Date(r.reviewedAt).toLocaleString() : "—"}</td>}
                  {subTab === "rejected" && <td className="px-3 py-2 text-rose-200 max-w-xs" title={r.rejectionReason || ""}>{r.rejectionReason || "—"}</td>}
                  {subTab === "pending" && (
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => handleApprove(r)}
                          disabled={busyId === r.id}
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-40"
                        >
                          <CheckCircle className="h-3 w-3" /> Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => { setRejectTarget(r); setRejectReason(""); }}
                          disabled={busyId === r.id}
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25 disabled:opacity-40"
                        >
                          <XCircle className="h-3 w-3" /> Reject
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {rejectTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={() => setRejectTarget(null)}>
          <div className="w-full max-w-md rounded-xl border border-white/10 bg-slate-950 text-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-1">Reject pull request</h3>
            <p className="text-xs text-slate-400 mb-3">
              {rejectTarget.partNo} × {rejectTarget.quantity} from {rejectTarget.branch} for ticket {rejectTarget.ticketNo}. The reserved quantity goes back into Truck Stock and the Part Transaction line reverts to Need PO.
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
