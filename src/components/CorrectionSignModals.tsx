/**
 * Shared signature-capture modals for the "Employee Attendance & Visit
 * Exception Report" fields folded into Time Correction Request (migration
 * 0304). Every one of the places that can approve a correction — desktop's
 * CorrectionsTab.tsx, AttendanceMonitoringPage.tsx, ReportHRDaily.tsx,
 * PendingItemDetailModal.tsx, and mobile's Team Approvals — renders these
 * instead of re-implementing the popup, so the manager-signs-on-approve /
 * HR-signs-the-paperwork behavior can never drift between screens.
 *
 * CorrectionManagerSignModal replaces a plain "Approve" click for the
 * manager stage: submitting it both records the signature AND casts the
 * manager's approval vote (reviewCorrectionStage), in one action.
 *
 * CorrectionHrSignModal is a SEPARATE action from the HR stage's ordinary
 * Approve/Reject buttons (which still just vote on the approval quorum,
 * unchanged) — see signCorrectionHrPaperwork's own doc comment for why the
 * paperwork sign-off has to be independent of that quorum vote.
 */
import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { useSignaturePad } from "@/hooks/useSignaturePad";
import { SignaturePadControls } from "@/components/SignaturePad";
import { getRoleDepartmentBreakdown } from "@/lib/roleLabels";
import { reviewCorrectionStage, signCorrectionHrPaperwork, type TimecardCorrectionRow } from "@/lib/supabase/timecardCorrections";
import { buildCorrectionManagerSignaturePdf, buildCorrectionHrSignaturePdf } from "@/lib/timecardCorrectionPdf";

/**
 * Deliberately narrower than the full ProfileRow — some callers (e.g.
 * PendingItemDetailModal.tsx's PendingItemProfileRef) only ever have a
 * minimal roster shape loaded, not every profile column. technician_id/
 * assigned_branch/role are optional here and just fall back to blank/"Other"
 * in the rendered PDF when a caller can't supply them — a full ProfileRow[]
 * still satisfies this structurally, so every other caller needs no change.
 */
export interface MinimalCorrectionProfile {
  id: string;
  display_name: string | null;
  email: string;
  technician_id?: string | null;
  assigned_branch?: string | null;
  role?: string | null;
}

export function employeeInfoFor(correction: TimecardCorrectionRow, profiles: MinimalCorrectionProfile[]) {
  const p = profiles.find((x) => x.id === correction.profileId) ?? null;
  const manager = profiles.find((x) => x.id === correction.managerId) ?? null;
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
  correction: TimecardCorrectionRow;
  companyId: string | null;
  profiles: MinimalCorrectionProfile[];
  reviewerId: string | null;
  reviewerName: string;
  onClose: () => void;
  /** Called after a successful sign — caller should refetch and close. */
  onSigned: () => void;
}

export function CorrectionManagerSignModal({
  correction,
  companyId,
  profiles,
  reviewerId,
  reviewerName,
  onClose,
  onSigned,
  correctedOverride,
}: SignModalBaseProps & {
  /** AttendanceMonitoringPage.tsx's detail modal lets the reviewer adjust the proposed corrected punch before approving — threaded straight through to reviewCorrectionStage's own `corrected` param, independent of the signature. */
  correctedOverride?: { checkIn?: string; checkOut?: string; mealStart?: string; mealEnd?: string };
}) {
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
      const employeeInfo = employeeInfoFor(correction, profiles);
      const { pdfUrl, managerSignatureUrl } = await buildCorrectionManagerSignaturePdf({
        correction, companyId, employeeInfo, managerName: reviewerName, managerComments: comments, managerSignatureDataUrl: dataUrl,
      });
      await reviewCorrectionStage(correction, "manager", "approved", reviewerId, reviewerName, correctedOverride, {
        url: managerSignatureUrl, name: reviewerName, comments, pdfUrl,
      });
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
        <p className="text-xs text-slate-400 mb-3">Signing approves this correction as the manager stage.</p>
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

export function CorrectionHrSignModal({ correction, companyId, profiles, reviewerId, reviewerName, onClose, onSigned }: SignModalBaseProps) {
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
      const employeeInfo = employeeInfoFor(correction, profiles);
      const { pdfUrl, hrSignatureUrl } = await buildCorrectionHrSignaturePdf({
        correction, companyId, employeeInfo, hrReviewerName: reviewerName, hrReceivedDate: receivedDate, hrActionStatus: actionStatus, hrSignatureDataUrl: dataUrl,
      });
      await signCorrectionHrPaperwork(correction.id, reviewerId, reviewerName, { url: hrSignatureUrl, name: reviewerName }, receivedDate, actionStatus, pdfUrl);
      // Signing the paperwork as "Approved" also casts the HR quorum vote
      // (if nobody already has) — this is now the ONLY way to approve as HR
      // on an exception-report row; the plain one-click "Approve (HR)"
      // button is hidden for these rows precisely so it can't be cast
      // without this signature. "Additional Review Required" intentionally
      // does NOT vote — the request stays exactly as undecided as it was.
      if (actionStatus === "approved" && correction.hrStatus === "pending") {
        await reviewCorrectionStage(correction, "hr", "approved", reviewerId, reviewerName);
      }
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
                <input type="radio" name="hrCorrectionActionStatus" checked={actionStatus === "approved"} onChange={() => setActionStatus("approved")} /> Approved
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input type="radio" name="hrCorrectionActionStatus" checked={actionStatus === "additional_review_required"} onChange={() => setActionStatus("additional_review_required")} /> Additional Review Required
              </label>
            </div>
            {actionStatus === "approved" && correction.hrStatus === "pending" && (
              <p className="text-[11px] text-slate-500 mt-1.5">Signing as Approved also casts your HR approval on this request.</p>
            )}
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
