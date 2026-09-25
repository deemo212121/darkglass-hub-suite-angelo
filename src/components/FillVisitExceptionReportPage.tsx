/**
 * Sign the Employee Attendance & Visit Exception Report — opened from the
 * deep link a Team Messenger message sends (see AbsentListPage.tsx's
 * VisitExceptionReportTab "Send Visit Exception Report" flow). Same
 * architecture as FillDamagePage.tsx: renders the REAL official PDF's
 * pages to canvases via pdf.js, with overlays at each field's own
 * coordinates — no redrawn lookalike. Unlike Damage, none of the content
 * fields are editable here — HR already filled in everything (employee
 * info, exception category, and the Detailed Reason built from whichever
 * automatic condition triggered) when sending it, matching the Employee
 * Acknowledgment text on the document itself ("I confirm that the
 * information provided above is accurate and truthful," not "here is my
 * explanation"). The technician only reviews and signs. The Manager/SBM
 * signature is completed separately afterward by HR, in person with the
 * manager, from the same tab this was sent from.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { FillFormSignInRequired } from "@/components/FillFormSignInRequired";
import { getMyProfileId, getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getSignableDocument, signDocument, type SignableDocument } from "@/lib/supabase/signableDocuments";
import { uploadSignableDocumentSignature, uploadVisitExceptionReportForm, refreshStorageAuthToken } from "@/lib/firebase/storage";
import { fillVisitExceptionReportPdf, loadBlankVisitExceptionReportBytes } from "@/lib/visitExceptionReportPdfFill";
import type { VisitExceptionReportFormData } from "@/lib/visitExceptionReportFormTemplate";
import { getOrCreateDmThread, sendMessage } from "@/lib/supabase/messaging";
import { logActivity } from "@/lib/supabase/hrActivityLog";
import { getHrNotificationSettings } from "@/lib/supabase/companySettings";
import { notifyHrRoleUsers } from "@/lib/supabase/hrRoleNotify";
import { getEntryForDate } from "@/lib/supabase/timecards";
import { createTimecardCorrection } from "@/lib/supabase/timecardCorrections";
import { resolveTeamLeadOrManager } from "@/lib/notifyRouting";
import { createNotification } from "@/lib/supabase/notifications";
import { useSignaturePad } from "@/hooks/useSignaturePad";
import { useResponsivePdfScale } from "@/hooks/useResponsivePdfScale";
import { SignaturePadControls } from "@/components/SignaturePad";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

interface Props {
  docId: string;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

// Mirrors MobileTechApp.tsx's own Time Correction screen (same name, kept
// as its own copy per that file's comment — neither file exports it).
function isCheckOutBeforeCheckIn(checkIn: string, checkOut: string): boolean {
  return !!checkIn && !!checkOut && checkOut <= checkIn;
}

const fmtDateDisplay = (v: string) => {
  if (!v) return "";
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const d = dateOnly ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])) : new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString();
};

const BLANK_FORM: VisitExceptionReportFormData = {
  employeeId: "",
  employeeName: "",
  employeeIdNumber: "",
  jobTitle: "",
  department: "",
  directManager: "",
  dateOfIncident: "",
  reasonMissedWorkday: false,
  reasonLateEarly: false,
  reasonMissedAppointment: false,
  reasonOther: false,
  reasonOtherText: "",
  detailedReason: "",
  customerName: "",
  scheduledTime: "",
  actionTaken: "",
  employeeDateSigned: "",
  employeeSignatureDataUrl: "",
  managerComments: "",
  managerDateSigned: "",
  managerSignatureDataUrl: "",
};

export function FillVisitExceptionReportPage({ docId }: Props) {
  const { ready, uid, displayName, role } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [doc, setDoc] = useState<SignableDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [pageLoading, setPageLoading] = useState(true);
  const { scale, containerRef } = useResponsivePdfScale(PAGE_WIDTH);
  const [numPages, setNumPages] = useState(0);
  const pdfDocRef = useRef<any>(null);
  const pageCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);

  const [form, setForm] = useState<VisitExceptionReportFormData>({ ...BLANK_FORM });

  // Optional "file a Time Correction alongside this" step — only offered
  // when HR marked the exception as Late Arrival / Early Departure, since
  // that's the one category where the punch itself might need fixing (a
  // missed workday/appointment doesn't have a "corrected time" to propose).
  // Genuinely optional per the request that added this: some Late/Early
  // reports don't need a punch fix at all (e.g. already corrected another
  // way), so leaving both fields blank just skips it, not an error.
  const [originalEntry, setOriginalEntry] = useState<{ checkIn: string; checkOut: string } | null>(null);
  const [correctedCheckIn, setCorrectedCheckIn] = useState("");
  const [correctedCheckOut, setCorrectedCheckOut] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [correctionFiled, setCorrectionFiled] = useState(false);

  const sigPad = useSignaturePad({ defaultName: form.employeeName, width: 440, height: 100 });

  useEffect(() => {
    if (!myProfileId || !form.reasonLateEarly || !form.dateOfIncident) return;
    let cancelled = false;
    getEntryForDate(myProfileId, form.dateOfIncident)
      .then((entry) => { if (!cancelled) setOriginalEntry({ checkIn: entry?.checkIn || "", checkOut: entry?.checkOut || "" }); })
      .catch((err) => console.error("[visit-exception-report] load original punch failed:", err));
    return () => { cancelled = true; };
  }, [myProfileId, form.reasonLateEarly, form.dateOfIncident]);

  useEffect(() => {
    if (!ready || !uid) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [profileId, document] = await Promise.all([getMyProfileId(uid), getSignableDocument(docId)]);
        if (cancelled) return;
        setMyProfileId(profileId);
        if (!document || document.documentType !== "visit_exception_report") {
          setError("This document doesn't exist or has been removed.");
        } else {
          setDoc(document);
          const existing = document.formData as Partial<VisitExceptionReportFormData>;
          setForm((prev) => ({ ...prev, ...existing }));
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load document.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ready, uid, docId]);

  useEffect(() => {
    if (loading || error || submitted) return;
    let cancelled = false;
    (async () => {
      try {
        const [pdfjsLib, bytes] = await Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), loadBlankVisitExceptionReportBytes()]);
        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
        if (cancelled) return;
        pdfDocRef.current = pdf;
        setNumPages(pdf.numPages);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load the form.");
      }
    })();
    return () => { cancelled = true; };
  }, [loading, error, submitted]);

  useEffect(() => {
    if (!numPages || !pdfDocRef.current) return;
    let cancelled = false;
    (async () => {
      setPageLoading(true);
      try {
        const dpr = window.devicePixelRatio || 1;
        for (let i = 1; i <= numPages; i++) {
          const page = await pdfDocRef.current.getPage(i);
          const viewport = page.getViewport({ scale });
          const canvas = pageCanvasRefs.current[i - 1];
          if (!canvas || cancelled) return;
          canvas.width = viewport.width * dpr;
          canvas.height = viewport.height * dpr;
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          const ctx = canvas.getContext("2d")!;
          ctx.scale(dpr, dpr);
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to render the form.");
      } finally {
        if (!cancelled) setPageLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [numPages, scale]);

  // Whether they've actually started filing a correction — Late/Early is a
  // necessary but not sufficient condition, since it's optional (see the
  // state comment above).
  const filingCorrection = form.reasonLateEarly && (!!correctedCheckIn.trim() || !!correctedCheckOut.trim());

  const validate = (): string | null => {
    if (!sigPad.hasContent()) return "Please add your signature.";
    if (filingCorrection) {
      if (!correctionReason.trim()) return "Add a reason for the time correction, or clear the corrected time fields to skip it.";
      const effectiveCheckIn = correctedCheckIn || originalEntry?.checkIn || "";
      const effectiveCheckOut = correctedCheckOut || originalEntry?.checkOut || "";
      if (isCheckOutBeforeCheckIn(effectiveCheckIn, effectiveCheckOut)) return `Corrected check out (${effectiveCheckOut}) is before check in (${effectiveCheckIn}). Double-check the time.`;
    }
    return null;
  };

  const handleSubmit = async () => {
    if (!doc || !myProfileId) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    const dataUrl = sigPad.toDataURL();
    if (!dataUrl) {
      setError("Please add your signature.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const companyId = doc.companyId;
      await refreshStorageAuthToken();
      const sigBytes = new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
      const signatureUrl = await uploadSignableDocumentSignature(companyId, doc.id, "employee", dataUrl);
      const signedAt = new Date().toISOString();
      const finalData: VisitExceptionReportFormData = { ...form, employeeDateSigned: signedAt, employeeSignatureDataUrl: dataUrl };
      const entry = { name: displayName || form.employeeName || "Signed", url: signatureUrl, signedAt };

      const pdfBytes = await fillVisitExceptionReportPdf(finalData, sigBytes);
      const pdfUrl = await uploadVisitExceptionReportForm(companyId, form.employeeName, new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" }));

      await signDocument(doc.id, "employee", entry, pdfUrl, finalData as unknown as Record<string, any>);

      // Filing the correction is a separate, best-effort side action —
      // caught on its own so a failure here (e.g. a network blip) surfaces
      // as its own warning instead of rolling back the signature that just
      // succeeded, since the document is the primary thing being submitted.
      if (filingCorrection) {
        try {
          const companyProfiles = await getCompanyUsers();
          const myProfile = companyProfiles.find((p) => p.id === myProfileId) ?? null;
          const managerProfile = myProfile ? await resolveTeamLeadOrManager(myProfile, companyProfiles) : null;
          await createTimecardCorrection({
            profileId: myProfileId,
            workDate: form.dateOfIncident,
            originalCheckIn: originalEntry?.checkIn || "",
            originalCheckOut: originalEntry?.checkOut || "",
            correctedCheckIn,
            correctedCheckOut,
            reason: correctionReason.trim(),
            requestedBy: myProfileId,
            managerId: managerProfile?.id ?? null,
          });
          const recipients = new Map<string, ProfileRow>();
          if (managerProfile && managerProfile.id !== myProfileId) recipients.set(managerProfile.id, managerProfile);
          for (const p of companyProfiles) {
            if (!p.is_active) continue;
            const primary = (p.role || "").toUpperCase();
            if (primary === "HR" || primary === "FINANCE") recipients.set(p.id, p);
          }
          await Promise.all(
            Array.from(recipients.values()).map((r) =>
              createNotification({
                recipientId: r.id,
                senderId: myProfileId,
                senderName: displayName || form.employeeName || "Employee",
                body: `🕐 New Time Correction Request from ${displayName || form.employeeName} for ${form.dateOfIncident}, filed alongside a Visit Exception Report.`,
                linkTo: "/m/dashboard/attendance-monitoring?tab=corrections",
              }).catch((err) => console.error("Failed to notify", r.id, err))
            )
          );
          setCorrectionFiled(true);
        } catch (err) {
          setCorrectionError(err instanceof Error ? err.message : "The report was signed, but the time correction failed to submit — file it separately from Time Correction.");
        }
      }

      if (doc.createdBy) {
        const thread = await getOrCreateDmThread(myProfileId, doc.createdBy);
        const filename = `Employee Attendance and Visit Exception Report - ${form.employeeName}.pdf`;
        await sendMessage({
          dmThreadId: thread.id,
          senderId: myProfileId,
          senderName: displayName || "Employee",
          body: `📄 Employee Attendance & Visit Exception Report for ${form.employeeName} has been signed, and is ready for the Manager/SBM signature: [${filename}](${pdfUrl})`,
        });
      }

      getHrNotificationSettings()
        .then(({ taxForms }) => {
          if (!taxForms) return;
          const excludeIds = doc.createdBy ? [doc.createdBy] : [];
          void notifyHrRoleUsers(myProfileId, displayName || "Employee", excludeIds, `📄 Employee Attendance & Visit Exception Report for ${form.employeeName} has been signed — the Manager/SBM signature is ready to be added.`);
        })
        .catch((err) => console.error("[visit-exception-report] hr notify check failed:", err));

      setDoc({ ...doc, status: "signed", pdfUrl, formData: finalData as unknown as Record<string, any>, signatures: { employee: entry }, signedAt });
      void logActivity({ action: "visit_exception_report_signed", targetType: "employee", targetLabel: form.employeeName });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit form.");
    } finally {
      setSubmitting(false);
    }
  };

  const isRecipient = !!doc && !!myProfileId && doc.recipientId === myProfileId;
  const isSuperadmin = role === "SUPERSUPERADMIN";

  const overlayStyle = (x: number, yFromBottom: number, w: number, h: number): React.CSSProperties => ({
    position: "absolute",
    left: x * scale,
    top: (PAGE_HEIGHT - yFromBottom - h) * scale,
    width: w * scale,
    fontSize: `${8 * scale}px`,
    fontWeight: 700,
    color: "#00008B",
    pointerEvents: "none",
  });

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-4xl mx-auto p-4">
        <Link to="/home" className="btn text-xs px-2.5 py-1.5 flex items-center gap-1 w-fit mb-4">
          <ChevronLeft className="h-3.5 w-3.5" /> Home
        </Link>

        {(ready && !uid) ? (
          <FillFormSignInRequired />
        ) : loading ? (
          <div className="panel p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading document…
          </div>
        ) : error && !doc ? (
          <div className="panel p-6 text-sm text-red-300">{error}</div>
        ) : !doc ? null : !isRecipient && !isSuperadmin ? (
          <div className="panel p-6 text-sm text-muted-foreground">This document isn't addressed to your account.</div>
        ) : submitted || doc.status === "signed" || doc.status === "confirmed" ? (
          <div className="panel p-6 text-center">
            <p className="text-sm font-semibold mb-2">✅ Submitted{submitted ? " and sent back to HR" : ""}.</p>
            <p className="text-xs text-muted-foreground mb-2">HR will add the Manager/SBM signature separately.</p>
            {correctionFiled && <p className="text-xs text-emerald-300 mb-2">🕐 Your time correction request was also submitted for manager review.</p>}
            {correctionError && <p className="text-xs text-amber-300 mb-2">{correctionError}</p>}
            {doc.pdfUrl && (
              <a href={doc.pdfUrl} target="_blank" rel="noreferrer noopener" className="text-blue-300 hover:text-blue-200 underline text-sm">
                View the completed PDF
              </a>
            )}
          </div>
        ) : (
          <div className="panel p-4">
            <p className="text-xs text-muted-foreground mb-3">
              Review the information below (filled in by HR) and add your signature to confirm it's accurate, then submit.
            </p>

            <div ref={containerRef} className="overflow-x-auto flex flex-col items-center bg-white/5 rounded-md p-4 gap-4">
              {Array.from({ length: numPages || 1 }, (_, i) => i + 1).map((pageNum) => (
                <div key={pageNum} className="relative bg-white shadow-lg" style={{ width: PAGE_WIDTH * scale, height: PAGE_HEIGHT * scale }}>
                  <canvas ref={(el) => { pageCanvasRefs.current[pageNum - 1] = el; }} className="absolute inset-0" />
                  {pageLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm text-muted-foreground gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading form…
                    </div>
                  )}

                  {!pageLoading && pageNum === 1 && (
                    <>
                      <div style={overlayStyle(196.5, 624.2, 220, 12)}>{form.employeeName}</div>
                      <div style={overlayStyle(430.5, 624.2, 130, 12)}>{form.employeeIdNumber}</div>
                      <div style={overlayStyle(196.5, 561.8, 220, 12)}>{form.jobTitle}</div>
                      <div style={overlayStyle(430.5, 561.8, 130, 12)}>{form.department}</div>
                      <div style={overlayStyle(196.5, 499.4, 220, 12)}>{form.directManager}</div>
                      <div style={overlayStyle(428, 499.4, 130, 12)}>{fmtDateDisplay(form.dateOfIncident)}</div>
                      {/* Checkbox marks — same 4 coordinates fillVisitExceptionReportPdf's checkbox1() draws "X" at, so what the employee sees checked here matches the actual submitted PDF. */}
                      {form.reasonMissedWorkday && <div style={overlayStyle(81.7, 421.8, 12, 12)}>X</div>}
                      {form.reasonLateEarly && <div style={overlayStyle(315.7, 421.8, 12, 12)}>X</div>}
                      {form.reasonMissedAppointment && <div style={overlayStyle(81.7, 375.2, 12, 12)}>X</div>}
                      {form.reasonOther && <div style={overlayStyle(315.7, 375.2, 12, 12)}>X</div>}
                      {form.reasonOther && <div style={overlayStyle(313.5, 359.4, 220, 12)}>{form.reasonOtherText}</div>}
                      {/* Detailed Reason — same box the "Detailed Reason for Absence / Missed Visit:" label introduces, below the checkboxes. Matches fillVisitExceptionReportPdf's own text block (first line at y=246, wrapping down), not overlapping the checkboxes above it. */}
                      <div style={{ ...overlayStyle(79.5, 190, 460, 70), whiteSpace: "pre-wrap", fontWeight: 400, fontSize: `${9 * scale}px` }}>
                        {form.detailedReason}
                      </div>
                      <div style={overlayStyle(195, 138.4, 300, 12)}>{form.customerName}</div>
                      <div style={overlayStyle(187, 122.6, 300, 12)}>{form.scheduledTime}</div>
                      <div style={overlayStyle(302, 99.3, 230, 12)}>{form.actionTaken}</div>
                    </>
                  )}

                  {!pageLoading && pageNum === 2 && (
                    <>
                      <canvas
                        {...sigPad.canvasProps}
                        style={{
                          position: "absolute",
                          left: 200 * scale,
                          top: (PAGE_HEIGHT - 531 - 16) * scale,
                          width: 150 * scale,
                          height: 16 * scale,
                        }}
                      />
                      <div style={overlayStyle(415, 535.5, 100, 12)}>{fmtDateDisplay(new Date().toISOString().slice(0, 10))}</div>
                    </>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-center mt-2">
              <SignaturePadControls pad={sigPad} />
            </div>

            {form.reasonLateEarly && (
              <div className="mt-4 rounded-md border border-white/10 bg-white/5 p-3">
                <p className="text-sm font-semibold">File a Time Correction (optional)</p>
                <p className="text-xs text-muted-foreground mt-0.5 mb-3">
                  This was marked Late Arrival / Early Departure. If your check-in or check-out for {fmtDateDisplay(form.dateOfIncident)} needs fixing, enter the corrected time below and it'll be submitted to your manager along with this report. Leave both blank to skip.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                      Corrected Check In {originalEntry?.checkIn ? `(was ${originalEntry.checkIn})` : ""}
                    </label>
                    <input type="time" value={correctedCheckIn} onChange={(e) => setCorrectedCheckIn(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md w-full mt-1" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                      Corrected Check Out {originalEntry?.checkOut ? `(was ${originalEntry.checkOut})` : ""}
                    </label>
                    <input type="time" value={correctedCheckOut} onChange={(e) => setCorrectedCheckOut(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md w-full mt-1" />
                  </div>
                </div>
                {filingCorrection && (
                  <div className="mt-3">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Reason for the correction</label>
                    <textarea
                      value={correctionReason}
                      onChange={(e) => setCorrectionReason(e.target.value)}
                      rows={2}
                      placeholder="Why the punch needs correcting"
                      className="glass-input text-sm py-1.5 px-3 rounded-md w-full mt-1"
                    />
                  </div>
                )}
              </div>
            )}

            {error && (
              <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2 mt-3">{error}</p>
            )}

            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white mt-3 disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Submit to HR"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
