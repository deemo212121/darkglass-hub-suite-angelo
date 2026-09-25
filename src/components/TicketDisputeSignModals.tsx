/**
 * Shared signature-capture modals for the "Employee Attendance & Visit
 * Exception Report" fields folded into Ticket Time Dispute (migration
 * 0305) — mirrors CorrectionSignModals.tsx exactly, adapted for
 * EmployeeRequestRow. Kept as its own file rather than reused: Ticket Time
 * Dispute has no resolved managerId on the row (unlike timecard_corrections)
 * and its manager-stage access gate is a plain role-tier check
 * (isFullRequestsAdmin in TicketTimeDisputesTab.tsx), not the manager-
 * hierarchy fallback timecard_corrections uses — so there's no shared
 * "employeeInfoFor" to lean on, and the manager-sign submit has to redo the
 * ticket-onsite-checkin side effect TicketTimeDisputesTab.tsx's own plain
 * approve path already does.
 *
 * TicketDisputeManagerSignModal replaces a plain "Approve" click: signing
 * writes the disputed start/end time onto the ticket FIRST (same ordering
 * the plain-approve path already uses — the request should never end up
 * marked "approved" if that write fails), then records the signature and
 * flips status to "approved" in one update (signTicketDisputeManager).
 *
 * TicketDisputeHrSignModal is a SEPARATE action from the underlying
 * approve/reject — see signTicketDisputeHrPaperwork's own doc comment.
 */
import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { useSignaturePad } from "@/hooks/useSignaturePad";
import { SignaturePadControls } from "@/components/SignaturePad";
import { getRoleDepartmentBreakdown } from "@/lib/roleLabels";
import { resolveTeamLeadOrManager } from "@/lib/notifyRouting";
import type { ProfileRow } from "@/lib/supabase/users";
import { signTicketDisputeManager, signTicketDisputeHrPaperwork, type EmployeeRequestRow } from "@/lib/supabase/employeeRequests";
import { setTicketOnsiteCheckIn } from "@/lib/supabase/tickets";
import { resetMileageRouteConfirmation } from "@/lib/supabase/mileage";
import { buildTicketDisputeManagerSignaturePdf, buildTicketDisputeHrSignaturePdf, type TicketDisputeEmployeeInfo } from "@/lib/ticketDisputeReportPdf";

export async function resolveEmployeeInfo(request: EmployeeRequestRow, profiles: ProfileRow[]): Promise<TicketDisputeEmployeeInfo> {
  const p = profiles.find((x) => x.id === request.profileId) ?? null;
  const manager = p ? await resolveTeamLeadOrManager(p, profiles) : null;
  const { roleLabel } = getRoleDepartmentBreakdown(p?.role ?? null);
  return {
    employeeName: p?.display_name || p?.email || "",
    technicianId: p?.technician_id || "",
    jobTitle: roleLabel,
    department: p?.assigned_branch || "",
    directManagerName: manager?.display_name || manager?.email || "",
  };
}

interface SignModalBaseProps {
  request: EmployeeRequestRow;
  companyId: string | null;
  profiles: ProfileRow[];
  reviewerId: string | null;
  reviewerName: string;
  onClose: () => void;
  /** Called after a successful sign — caller should refetch and close. */
  onSigned: () => void;
}

export function TicketDisputeManagerSignModal({ request, companyId, profiles, reviewerId, reviewerName, onClose, onSigned }: SignModalBaseProps) {
  const [comments, setComments] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sigPad = useSignaturePad({ width: 400, height: 110, defaultName: reviewerName });

  const handleSubmit = async () => {
    if (!reviewerId || !companyId) { setError("Missing your profile/company — try again in a moment."); return; }
    if (!sigPad.hasContent()) { setError("Please add your signature first."); return; }
    const dataUrl = sigPad.toDataURL();
    if (!dataUrl) { setError("Please add your signature first."); return; }
    setSubmitting(true);
    setError(null);
    try {
      const employeeInfo = await resolveEmployeeInfo(request, profiles);
      const { pdfUrl, managerSignatureUrl } = await buildTicketDisputeManagerSignaturePdf({
        request, companyId, employeeInfo, managerName: reviewerName, managerComments: comments, managerSignatureDataUrl: dataUrl,
      });
      // Ticket write BEFORE the status/signature update — same safety
      // ordering TicketTimeDisputesTab.tsx's own plain approve already
      // uses, so a failed ticket write never leaves this marked approved.
      if (request.ticketNo && request.disputedStartTime && request.disputedEndTime) {
        await setTicketOnsiteCheckIn(request.ticketNo, "arrived", request.disputedStartTime);
        await setTicketOnsiteCheckIn(request.ticketNo, "done", request.disputedEndTime);
        await resetMileageRouteConfirmation(request.ticketNo).catch((err) => console.error("Failed to invalidate mileage route order after dispute approval:", err));
      }
      await signTicketDisputeManager(request.id, reviewerId, { url: managerSignatureUrl, name: reviewerName, comments, pdfUrl });
      onSigned();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit signature.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-lg font-bold text-white">Manager / SBM Review &amp; Approval</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition p-1"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-xs text-slate-400 mb-3">Signing approves this dispute and writes the claimed time onto the ticket.</p>
        <div className="space-y-3 mb-4">
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-1">Manager Comments</label>
            <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={3} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none resize-none" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-2">Your Signature</label>
            <canvas {...sigPad.canvasProps} className={`bg-white rounded-md border border-white/15 block mx-auto w-full max-w-sm ${sigPad.canvasProps.className}`} />
            <div className="mt-2"><SignaturePadControls pad={sigPad} /></div>
          </div>
        </div>
        {error && <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2 mb-3">{error}</p>}
        <div className="flex gap-3">
          <button type="button" onClick={handleSubmit} disabled={submitting} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg transition font-semibold text-sm flex items-center justify-center gap-1.5">
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {submitting ? "Submitting…" : "Confirm & Sign"}
          </button>
          <button onClick={onClose} className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition font-semibold text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function TicketDisputeHrSignModal({ request, companyId, profiles, reviewerId, reviewerName, onClose, onSigned }: SignModalBaseProps) {
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10));
  const [actionStatus, setActionStatus] = useState<"approved" | "additional_review_required">("approved");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sigPad = useSignaturePad({ width: 400, height: 110, defaultName: reviewerName });

  const handleSubmit = async () => {
    if (!reviewerId || !companyId) { setError("Missing your profile/company — try again in a moment."); return; }
    if (!sigPad.hasContent()) { setError("Please add your signature first."); return; }
    const dataUrl = sigPad.toDataURL();
    if (!dataUrl) { setError("Please add your signature first."); return; }
    setSubmitting(true);
    setError(null);
    try {
      const employeeInfo = await resolveEmployeeInfo(request, profiles);
      const { pdfUrl, hrSignatureUrl } = await buildTicketDisputeHrSignaturePdf({
        request, companyId, employeeInfo, hrReviewerName: reviewerName, hrReceivedDate: receivedDate, hrActionStatus: actionStatus, hrSignatureDataUrl: dataUrl,
      });
      await signTicketDisputeHrPaperwork(request.id, reviewerName, { url: hrSignatureUrl, name: reviewerName }, receivedDate, actionStatus, pdfUrl);
      onSigned();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit signature.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-lg font-bold text-white">HR Department Use Only</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition p-1"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3 mb-4">
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-1">Received Date</label>
            <input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-1">Action Status</label>
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input type="radio" name="hrTicketDisputeActionStatus" checked={actionStatus === "approved"} onChange={() => setActionStatus("approved")} /> Approved
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input type="radio" name="hrTicketDisputeActionStatus" checked={actionStatus === "additional_review_required"} onChange={() => setActionStatus("additional_review_required")} /> Additional Review Required
              </label>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-2">Your Signature</label>
            <canvas {...sigPad.canvasProps} className={`bg-white rounded-md border border-white/15 block mx-auto w-full max-w-sm ${sigPad.canvasProps.className}`} />
            <div className="mt-2"><SignaturePadControls pad={sigPad} /></div>
          </div>
        </div>
        {error && <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2 mb-3">{error}</p>}
        <div className="flex gap-3">
          <button type="button" onClick={handleSubmit} disabled={submitting} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg transition font-semibold text-sm flex items-center justify-center gap-1.5">
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {submitting ? "Submitting…" : "Confirm & Sign"}
          </button>
          <button onClick={onClose} className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition font-semibold text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}
