/**
 * Employee Monitoring → Visit Exception Report tab. A daily list of
 * technicians with an attendance/visit exception (see
 * src/lib/supabase/visitExceptions.ts for exactly what counts — no clock-
 * out, no on-site check-in or checkout on a scheduled ticket, or a ticket
 * rescheduled that day), each with a "Send Visit Exception Report" action
 * that creates a fully pre-filled hr_signable_documents row (document_type
 * "visit_exception_report") and DMs the technician a fill link — same
 * pattern as every other HR-initiated signable document in this app (see
 * ReportHRDaily.tsx's handleSendDamage for the closest analog).
 *
 * Genuine two-party document: the technician reviews (everything is HR-
 * filled, read-only to them — see FillVisitExceptionReportPage.tsx) and
 * signs first; the Manager/SBM signature is completed afterward, in person
 * with the manager, via this tab's own "Complete Manager Signature"
 * dialog — same shape as damageEmployerDialog in ReportHRDaily.tsx, since
 * profiles.manager_name is free text (no real account to route a second
 * login-required signing step to).
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, Send, PenLine, AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import { getAppUrl } from "@/lib/appUrl";
import { getRoleDepartmentBreakdown } from "@/lib/roleLabels";
import {
  getVisitExceptionsForDate,
  buildVisitExceptionReasonText,
  type VisitExceptionRow,
  type VisitExceptionReason,
} from "@/lib/supabase/visitExceptions";
import {
  createSignableDocument,
  getSignableDocuments,
  getExistingActiveDocumentTypes,
  reassignSignableDocument,
  signDocument,
  confirmSignableDocument,
  type SignableDocument,
} from "@/lib/supabase/signableDocuments";
import { uploadSignableDocumentSignature, uploadVisitExceptionReportForm, refreshStorageAuthToken } from "@/lib/firebase/storage";
import { fillVisitExceptionReportPdf } from "@/lib/visitExceptionReportPdfFill";
import type { VisitExceptionReportFormData } from "@/lib/visitExceptionReportFormTemplate";
import { getOrCreateDmThread, sendMessage } from "@/lib/supabase/messaging";
import { logActivity } from "@/lib/supabase/hrActivityLog";
import { useSignaturePad } from "@/hooks/useSignaturePad";
import { SignaturePadControls } from "@/components/SignaturePad";

const todayIso = () => new Date().toISOString().slice(0, 10);
const yesterdayIso = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
};

const REASON_LABELS: Record<VisitExceptionReason, string> = {
  no_clockout: "No Clock-Out",
  no_checkin: "No Check-In",
  no_checkout: "No Checkout",
  rescheduled: "Rescheduled",
};
const REASON_TONE: Record<VisitExceptionReason, string> = {
  no_clockout: "bg-red-500/20 text-red-300 border-red-500/40",
  no_checkin: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  no_checkout: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  rescheduled: "bg-blue-500/20 text-blue-300 border-blue-500/40",
};

/** Signed by the employee, waiting on the Manager/SBM signature — same
 *  "signed + still on the employee slot, or reopened onto hr_staff" shape
 *  ReportHRDaily.tsx's own isAwaitingEmployerStep uses for every other
 *  two-party document type. */
function isAwaitingManagerStep(doc: { status: string; recipientSlot: string }): boolean {
  return (doc.status === "signed" && doc.recipientSlot === "employee") || (doc.status === "pending_signature" && doc.recipientSlot === "hr_staff");
}

export function VisitExceptionReportTab() {
  const { uid, displayName } = useAuth();
  const [selectedDate, setSelectedDate] = useState(yesterdayIso());
  const [rows, setRows] = useState<VisitExceptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sentDocs, setSentDocs] = useState<SignableDocument[]>([]);

  const loadRows = async (date: string) => {
    setLoading(true);
    setError(null);
    try {
      setRows(await getVisitExceptionsForDate(date));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load exceptions.");
    } finally {
      setLoading(false);
    }
  };
  const loadSentDocs = async () => {
    try {
      setSentDocs(await getSignableDocuments("visit_exception_report"));
    } catch { /* best-effort */ }
  };

  useEffect(() => { void loadRows(selectedDate); void loadSentDocs(); }, [selectedDate]);

  const sentByProfileId = useMemo(() => {
    const map = new Map<string, SignableDocument>();
    for (const d of sentDocs) {
      if (!d.recipientId) continue;
      // Latest active (non-cancelled) send per technician wins — a re-send
      // after a cancelled one shouldn't be shadowed by the old row.
      const existing = map.get(d.recipientId);
      if (!existing || d.createdAt > existing.createdAt) map.set(d.recipientId, d);
    }
    return map;
  }, [sentDocs]);

  // ── Send dialog — review/edit the auto-detected reason before it goes out. ──
  const [sendDialogRow, setSendDialogRow] = useState<VisitExceptionRow | null>(null);
  const [sendReasonText, setSendReasonText] = useState("");
  const [sendChecks, setSendChecks] = useState({ missedWorkday: false, lateEarly: false, missedAppointment: false });
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const openSendDialog = (row: VisitExceptionRow) => {
    setSendDialogRow(row);
    setSendReasonText(buildVisitExceptionReasonText(row, selectedDate));
    setSendChecks({
      // "Missed Workday / Absence" checks by default for every exception
      // type — per an explicit user call, any of these conditions counts
      // as (at least) a missed workday; HR can uncheck it before sending
      // if that's wrong for a given case.
      missedWorkday: true,
      lateEarly: false,
      missedAppointment: row.reasons.includes("no_checkin") || row.reasons.includes("no_checkout") || row.reasons.includes("rescheduled"),
    });
    setSendError(null);
  };

  const handleSend = async () => {
    if (!sendDialogRow || !uid) return;
    setSending(true);
    setSendError(null);
    try {
      const alreadySent = await getExistingActiveDocumentTypes(sendDialogRow.profileId, ["visit_exception_report"]);
      if (alreadySent.length > 0 && !window.confirm(`${sendDialogRow.name} already has an open Visit Exception Report. Send another one anyway?`)) {
        return;
      }

      const ticketDetail = sendDialogRow.tickets[0];
      const formData: VisitExceptionReportFormData = {
        employeeId: sendDialogRow.profileId,
        employeeName: sendDialogRow.name,
        employeeIdNumber: sendDialogRow.technicianId,
        jobTitle: getRoleDepartmentBreakdown(sendDialogRow.role).roleLabel || "Technician",
        department: getRoleDepartmentBreakdown(sendDialogRow.role).department || "—",
        directManager: sendDialogRow.manager,
        dateOfIncident: selectedDate,
        reasonMissedWorkday: sendChecks.missedWorkday,
        reasonLateEarly: sendChecks.lateEarly,
        reasonMissedAppointment: sendChecks.missedAppointment,
        reasonOther: false,
        reasonOtherText: "",
        detailedReason: sendReasonText.trim(),
        customerName: "",
        scheduledTime: ticketDetail?.timeSlot || "",
        actionTaken: ticketDetail?.rescheduleReason || "",
        employeeDateSigned: "",
        employeeSignatureDataUrl: "",
        managerComments: "",
        managerDateSigned: "",
        managerSignatureDataUrl: "",
      };

      const doc = await createSignableDocument({
        documentType: "visit_exception_report",
        formData: formData as unknown as Record<string, any>,
        recipientId: sendDialogRow.profileId,
        recipientSlot: "employee",
        pdfUrl: "",
      });

      const myProfileId = await getMyProfileId(uid);
      if (!myProfileId) throw new Error("Could not resolve your profile.");
      const thread = await getOrCreateDmThread(myProfileId, sendDialogRow.profileId);
      const fillLink = `${getAppUrl()}/fill-visit-exception-report/${doc.id}`;
      await sendMessage({
        dmThreadId: thread.id,
        senderId: myProfileId,
        senderName: displayName || "HR",
        body: `📋 Please review and sign your Employee Attendance & Visit Exception Report for ${selectedDate}: ${fillLink}`,
      });

      void logActivity({ action: "visit_exception_report_sent", targetType: "employee", targetId: sendDialogRow.profileId, targetLabel: sendDialogRow.name });

      setSendDialogRow(null);
      await loadSentDocs();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Failed to send.");
    } finally {
      setSending(false);
    }
  };

  // ── Complete Manager Signature — a plain signature pad + comments field,
  // same "claim, regenerate PDF with both signatures, confirm" shape as
  // ReportHRDaily.tsx's damageEmployerDialog. ──
  const [managerDialogDoc, setManagerDialogDoc] = useState<SignableDocument | null>(null);
  const [managerComments, setManagerComments] = useState("");
  const [managerSaving, setManagerSaving] = useState(false);
  const [managerError, setManagerError] = useState<string | null>(null);
  const managerSigPad = useSignaturePad({ width: 400, height: 120 });

  const openManagerDialog = (doc: SignableDocument) => {
    setManagerDialogDoc(doc);
    setManagerComments("");
    setManagerError(null);
  };

  const handleSaveManagerSignature = async () => {
    if (!managerDialogDoc || !uid) return;
    if (!managerSigPad.hasContent()) {
      setManagerError("Please add the manager's signature.");
      return;
    }
    setManagerSaving(true);
    setManagerError(null);
    try {
      const myProfileId = await getMyProfileId(uid);
      if (!myProfileId) throw new Error("Could not resolve your profile.");

      await reassignSignableDocument(managerDialogDoc.id, { recipientId: myProfileId, recipientName: displayName || "HR" }, "hr_staff");

      const existing = managerDialogDoc.formData as VisitExceptionReportFormData;
      const employeeSigBytes = existing.employeeSignatureDataUrl
        ? new Uint8Array(await (await fetch(existing.employeeSignatureDataUrl)).arrayBuffer())
        : undefined;

      const dataUrl = managerSigPad.toDataURL();
      if (!dataUrl) {
        setManagerError("Please add the manager's signature.");
        return;
      }
      await refreshStorageAuthToken();
      const managerSigBytes = new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
      const signatureUrl = await uploadSignableDocumentSignature(managerDialogDoc.companyId, managerDialogDoc.id, "hr_staff", dataUrl);
      const signedAt = new Date().toISOString();

      const merged: VisitExceptionReportFormData = { ...existing, managerSignatureDataUrl: dataUrl, managerDateSigned: signedAt, managerComments: managerComments.trim() };

      const pdfBytes = await fillVisitExceptionReportPdf(merged, employeeSigBytes, managerSigBytes);
      const pdfUrl = await uploadVisitExceptionReportForm(managerDialogDoc.companyId, existing.employeeName || "visit-exception-report", new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" }));

      const entry = { name: displayName || "HR", url: signatureUrl, signedAt };
      await signDocument(managerDialogDoc.id, "hr_staff", entry, pdfUrl, merged as unknown as Record<string, any>);
      await confirmSignableDocument(managerDialogDoc.id, null);

      void logActivity({ action: "visit_exception_report_manager_signed", targetType: "employee", targetLabel: existing.employeeName || "" });
      setManagerDialogDoc(null);
      await loadSentDocs();
    } catch (err) {
      setManagerError(err instanceof Error ? err.message : "Failed to save signature.");
    } finally {
      setManagerSaving(false);
    }
  };

  return (
    <div className="panel p-0 overflow-hidden">
      <div className="px-4 py-4 border-b border-white/10">
        <h2 className="font-semibold text-sm flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-amber-400" /> Visit Exception Report</h2>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Technicians with no clock-out, no on-site check-in/checkout on a scheduled ticket, or a ticket rescheduled, for the selected day.
        </p>
      </div>

      <div className="px-4 py-3 border-b border-white/10 bg-white/5 flex flex-wrap items-center gap-3">
        <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Date</label>
        <input type="date" value={selectedDate} max={todayIso()} onChange={(e) => setSelectedDate(e.target.value || yesterdayIso())} className="glass-input text-sm py-1.5 px-3 rounded-md" />
        <button onClick={() => void loadRows(selectedDate)} className="btn text-xs px-2.5 py-1.5 flex items-center gap-1.5" disabled={loading}>
          <Loader2 className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
        <span className="ml-auto text-xs text-muted-foreground">{rows.length} technician{rows.length === 1 ? "" : "s"} with an exception</span>
      </div>

      {loading ? (
        <div className="p-8 flex items-center justify-center text-muted-foreground text-sm gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : error ? (
        <div className="p-6 text-sm text-red-300">{error}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-3 py-2 text-left text-[10px] text-muted-foreground uppercase">Name</th>
                <th className="px-3 py-2 text-left text-[10px] text-muted-foreground uppercase">Branch</th>
                <th className="px-3 py-2 text-left text-[10px] text-muted-foreground uppercase">Manager</th>
                <th className="px-3 py-2 text-left text-[10px] text-muted-foreground uppercase">Reasons</th>
                <th className="px-3 py-2 text-left text-[10px] text-muted-foreground uppercase">Tickets</th>
                <th className="px-3 py-2 text-left text-[10px] text-muted-foreground uppercase">Report Status</th>
                <th className="px-3 py-2 text-left text-[10px] text-muted-foreground uppercase">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">No exceptions for {selectedDate}.</td></tr>
              ) : (
                rows.map((r) => {
                  const sent = sentByProfileId.get(r.profileId);
                  const status = !sent ? null : sent.status === "confirmed" ? "done" : isAwaitingManagerStep(sent) ? "awaiting_manager" : "awaiting_employee";
                  return (
                    <tr key={r.profileId} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-3 py-2 font-medium">{r.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.location}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.manager}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {r.reasons.map((reason) => (
                            <span key={reason} className={`text-[10px] px-1.5 py-0.5 rounded-full border ${REASON_TONE[reason]}`}>{REASON_LABELS[reason]}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">{r.tickets.map((t) => t.ticketNo).filter(Boolean).join(", ") || "—"}</td>
                      <td className="px-3 py-2">
                        {status === "done" ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-300 border border-green-500/40">Completed</span>
                        ) : status === "awaiting_manager" ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">Awaiting Manager Sig.</span>
                        ) : status === "awaiting_employee" ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/40">Awaiting Employee Sig.</span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">Not sent</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {status === "awaiting_manager" && sent ? (
                          <button onClick={() => openManagerDialog(sent)} className="btn text-xs px-2.5 py-1.5 flex items-center gap-1.5">
                            <PenLine className="h-3 w-3" /> Complete Manager Sig.
                          </button>
                        ) : !status ? (
                          <button onClick={() => openSendDialog(r)} className="btn text-xs px-2.5 py-1.5 flex items-center gap-1.5">
                            <Send className="h-3 w-3" /> Send Report
                          </button>
                        ) : (
                          sent?.pdfUrl && (
                            <a href={sent.pdfUrl} target="_blank" rel="noreferrer noopener" className="text-blue-400 hover:text-blue-300 hover:underline text-xs">View PDF</a>
                          )
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {sendDialogRow && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setSendDialogRow(null)}>
          <div className="bg-slate-900 border border-white/15 rounded-xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-white/10 bg-slate-950 rounded-t-xl">
              <p className="font-semibold text-white text-sm">Send Visit Exception Report — {sendDialogRow.name}</p>
              <p className="text-xs text-slate-400">{selectedDate}</p>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Exception Category</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sendChecks.missedWorkday} onChange={(e) => setSendChecks((c) => ({ ...c, missedWorkday: e.target.checked }))} /> Missed Workday / Absence</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sendChecks.lateEarly} onChange={(e) => setSendChecks((c) => ({ ...c, lateEarly: e.target.checked }))} /> Late Arrival / Early Departure</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sendChecks.missedAppointment} onChange={(e) => setSendChecks((c) => ({ ...c, missedAppointment: e.target.checked }))} /> Missed Customer Appointment / Home Visit</label>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Detailed Reason</label>
                <textarea value={sendReasonText} onChange={(e) => setSendReasonText(e.target.value)} rows={4} className="glass-input text-sm py-1.5 px-3 rounded-md" />
              </div>
              {sendError && <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{sendError}</p>}
              <div className="flex items-center gap-2 justify-end">
                <button onClick={() => setSendDialogRow(null)} className="btn text-sm px-3 py-1.5">Cancel</button>
                <button onClick={() => void handleSend()} disabled={sending} className="btn text-sm px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
                  {sending ? "Sending…" : "Send to Technician"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {managerDialogDoc && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setManagerDialogDoc(null)}>
          <div className="bg-slate-900 border border-white/15 rounded-xl w-full max-w-lg shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-white/10 bg-slate-950 rounded-t-xl">
              <p className="font-semibold text-white text-sm">Complete Manager Signature</p>
              <p className="text-xs text-slate-400">{(managerDialogDoc.formData as VisitExceptionReportFormData).employeeName}</p>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Manager Comments</label>
                <textarea value={managerComments} onChange={(e) => setManagerComments(e.target.value)} rows={3} className="glass-input text-sm py-1.5 px-3 rounded-md" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Manager / SBM Signature</label>
                <canvas {...managerSigPad.canvasProps} className="bg-white rounded-md border border-white/15 block mx-auto w-full max-w-md" />
                <div className="mt-1"><SignaturePadControls pad={managerSigPad} /></div>
              </div>
              {managerError && <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{managerError}</p>}
              <div className="flex items-center gap-2 justify-end">
                <button onClick={() => setManagerDialogDoc(null)} className="btn text-sm px-3 py-1.5">Cancel</button>
                <button onClick={() => void handleSaveManagerSignature()} disabled={managerSaving} className="btn text-sm px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
                  {managerSaving ? "Saving…" : "Save Signature"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
