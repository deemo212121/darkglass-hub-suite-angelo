/**
 * Fill the Flash travel form — opened from the deep link a Team Messenger
 * message sends (see ReportHRDaily.tsx's Flash travel tab "Send Request"
 * flow). Same architecture as FillMileageFuelPage.tsx: renders the REAL
 * official PDF's pages to canvases via pdf.js, with an overlay at each
 * blank's own coordinates — no redrawn lookalike. Submitting draws the
 * collected values directly onto that same real PDF via
 * fillFlashTechnicianTravelPdf (no AcroForm fields) and sends it back to HR.
 *
 * Two documents, by form_data.templateVersion (see flashTechnicianTravelPdfFill.ts):
 *   - Version 2, "Flash Tech Travel & Expense Policy Agreement" (every
 *     unsigned document is signed in this one): printed name, Employee ID
 *     (pre-filled from the profile's technician ID, editable), signature and
 *     date. No employer line, so it's marked complete as soon as it's signed.
 *   - Version 1, "Flash Technician Travel & Out-of-State Policy" (A4): only
 *     ever shown here already signed; its employer signature is added
 *     separately by HR.
 */
import { InlinePdfLink } from "@/components/InlinePdfViewer";
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { FillFormSignInRequired } from "@/components/FillFormSignInRequired";
import { getMyProfileId, getProfileTechnicianId } from "@/lib/supabase/users";
import { confirmSignableDocument, getSignableDocument, signDocument, type SignableDocument } from "@/lib/supabase/signableDocuments";
import { uploadSignableDocumentSignature, uploadFlashTechnicianTravelForm } from "@/lib/firebase/storage";
import { fillFlashTechnicianTravelPdf, flashTravelLayout, loadBlankFlashTechnicianTravelBytes, FLASH_TRAVEL_CURRENT_VERSION, FLASH_TRAVEL_TITLE } from "@/lib/flashTechnicianTravelPdfFill";
import type { FlashTechnicianTravelFormData } from "@/lib/flashTechnicianTravelFormTemplate";
import { getOrCreateDmThread, sendMessage } from "@/lib/supabase/messaging";
import { logActivity } from "@/lib/supabase/hrActivityLog";
import { getHrNotificationSettings } from "@/lib/supabase/companySettings";
import { notifyHrRoleUsers } from "@/lib/supabase/hrRoleNotify";
import { useSignaturePad } from "@/hooks/useSignaturePad";
import { SignaturePadControls } from "@/components/SignaturePad";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

interface Props {
  docId: string;
}

const OLD_TITLE = "Flash Technician Travel & Out-of-State Policy";

const fmtDateSignedDisplay = (d: Date) => d.toLocaleDateString("en-US");

const BLANK_FORM: FlashTechnicianTravelFormData = {
  employeeId: "",
  employeeName: "",
  employeeDateSigned: "",
  employeeSignatureDataUrl: "",
  employerDateSigned: "",
  employerSignatureDataUrl: "",
};

export function FillFlashTechnicianTravelPage({ docId }: Props) {
  const { ready, uid, displayName, role } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [doc, setDoc] = useState<SignableDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [pageLoading, setPageLoading] = useState(true);
  const [scale, setScale] = useState(1.1);
  const [numPages, setNumPages] = useState(0);
  const pdfDocRef = useRef<any>(null);
  const pageCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);

  const [form, setForm] = useState<FlashTechnicianTravelFormData>({ ...BLANK_FORM });
  const version = form.templateVersion ?? 1;
  const isV2 = version >= 2;
  const layout = flashTravelLayout(version);
  const title = isV2 ? FLASH_TRAVEL_TITLE : OLD_TITLE;

  const sigPad = useSignaturePad({ width: 440, height: 100 });

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
        if (!document || document.documentType !== "flash_technician_travel") {
          setError("This document doesn't exist or has been removed.");
        } else {
          setDoc(document);
          const existing = document.formData as Partial<FlashTechnicianTravelFormData>;
          // Not signed yet: signed in the current agreement. Already signed:
          // keep the version it was signed in.
          const unsigned = document.status === "pending_signature" && document.recipientSlot === "employee";
          let employeeIdNumber = existing.employeeIdNumber;
          if (unsigned && !employeeIdNumber && document.recipientId) {
            employeeIdNumber = await getProfileTechnicianId(document.recipientId).catch(() => "");
          }
          if (cancelled) return;
          setForm((prev) => ({
            ...prev,
            ...existing,
            ...(unsigned ? { templateVersion: FLASH_TRAVEL_CURRENT_VERSION, employeeIdNumber: employeeIdNumber ?? "" } : {}),
          }));
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
        const [pdfjsLib, bytes] = await Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), loadBlankFlashTechnicianTravelBytes(version)]);
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
  }, [loading, error, submitted, version]);

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

  const handleSubmit = async () => {
    if (!doc || !myProfileId) return;
    if (!sigPad.hasContent()) {
      setError("Please add your signature.");
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
      const employeeName = displayName || doc.recipientName || "Employee";
      const sigBytes = new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
      const signatureUrl = await uploadSignableDocumentSignature(companyId, doc.id, "employee", dataUrl);
      const signedAt = new Date().toISOString();
      const finalData: FlashTechnicianTravelFormData = {
        ...form,
        employeeName,
        employeeIdNumber: (form.employeeIdNumber ?? "").trim(),
        employeeDateSigned: signedAt,
        employeeSignatureDataUrl: dataUrl,
      };
      const entry = { name: employeeName, url: signatureUrl, signedAt };

      const pdfBytes = await fillFlashTechnicianTravelPdf(finalData, sigBytes);
      const pdfUrl = await uploadFlashTechnicianTravelForm(companyId, employeeName, new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" }));

      await signDocument(doc.id, "employee", entry, pdfUrl, finalData as unknown as Record<string, any>);
      // The agreement has no employer line — signing it completes it.
      if (isV2) await confirmSignableDocument(doc.id, null);

      const filename = `${title} - ${employeeName}.pdf`;
      if (doc.createdBy) {
        const thread = await getOrCreateDmThread(myProfileId, doc.createdBy);
        await sendMessage({
          dmThreadId: thread.id,
          senderId: myProfileId,
          senderName: displayName || "Employee",
          body: isV2
            ? `📄 ${title} for ${employeeName} has been signed: [${filename}](${pdfUrl})`
            : `📄 ${title} for ${employeeName} has been signed, and is ready for the employer/representative signature: [${filename}](${pdfUrl})`,
        });
      }

      getHrNotificationSettings()
        .then(({ taxForms }) => {
          if (!taxForms) return;
          const excludeIds = doc.createdBy ? [doc.createdBy] : [];
          void notifyHrRoleUsers(
            myProfileId,
            displayName || "Employee",
            excludeIds,
            isV2 ? `📄 ${title} for ${employeeName} has been signed.` : `📄 ${title} for ${employeeName} has been signed — the employer/representative signature is ready to be added.`
          );
        })
        .catch((err) => console.error("[flash-technician-travel] hr notify check failed:", err));

      setDoc({ ...doc, status: isV2 ? "confirmed" : "signed", pdfUrl, formData: finalData as unknown as Record<string, any>, signatures: { employee: entry }, signedAt });
      void logActivity({ action: "flash_technician_travel_signed", targetType: "employee", targetLabel: employeeName });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit form.");
    } finally {
      setSubmitting(false);
    }
  };

  const isRecipient = !!doc && !!myProfileId && doc.recipientId === myProfileId;
  const isSuperadmin = role === "SUPERSUPERADMIN";

  const overlayStyle = (r: { x: number; y: number; w: number; h: number }): React.CSSProperties => ({
    position: "absolute",
    left: r.x * scale,
    top: (layout.pageHeight - r.y - r.h) * scale,
    width: r.w * scale,
    height: r.h * scale,
    fontSize: `${9 * scale}px`,
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
            {!isV2 && <p className="text-xs text-muted-foreground mb-2">HR will add the employer/representative signature separately.</p>}
            {doc.pdfUrl && (
              <InlinePdfLink url={doc.pdfUrl} label="View the completed PDF" className="text-blue-300 hover:text-blue-200 underline text-sm" />
            )}
          </div>
        ) : (
          <div className="panel p-4">
            <h1 className="text-lg font-bold mb-1">{title}</h1>
            <p className="text-xs text-muted-foreground mb-3">
              Read the agreement below{isV2 ? ", check your Employee ID" : ""}, add your signature at the bottom, then submit.
            </p>

            <div className="overflow-x-auto flex flex-col items-center bg-white/5 rounded-md p-4 gap-4">
              {Array.from({ length: numPages || 1 }, (_, i) => i + 1).map((pageNum) => (
                <div key={pageNum} className="relative bg-white shadow-lg" style={{ width: layout.pageWidth * scale, height: layout.pageHeight * scale }}>
                  <canvas ref={(el) => { pageCanvasRefs.current[pageNum - 1] = el; }} className="absolute inset-0" />
                  {pageLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm text-muted-foreground gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading form…
                    </div>
                  )}

                  {!pageLoading && pageNum === numPages && (
                    <>
                      {isV2 && layout.rects.name && (
                        <div style={overlayStyle(layout.rects.name)} className="flex items-center font-bold text-[#00008B]">{displayName || doc.recipientName || ""}</div>
                      )}
                      {isV2 && layout.rects.employeeIdNumber && (
                        <div style={overlayStyle(layout.rects.employeeIdNumber)} className="flex items-center font-bold text-[#00008B]">{form.employeeIdNumber || ""}</div>
                      )}
                      <div style={overlayStyle(layout.rects.dateSigned)} className="flex items-center font-bold text-[#00008B]">
                        {fmtDateSignedDisplay(new Date())}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>

            {isV2 && (
              <div className="mt-3 max-w-md mx-auto">
                <label className="block text-xs font-semibold text-muted-foreground mb-1">Employee ID</label>
                <input
                  value={form.employeeIdNumber ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, employeeIdNumber: e.target.value }))}
                  placeholder="Your technician ID"
                  className="glass-input text-sm py-1.5 px-3 rounded-md w-full"
                />
              </div>
            )}

            {/* Signed at full size here (not squeezed into the printed
                blank's small signature line) — fillFlashTechnicianTravelPdf
                places the captured image into the layout's signature box on
                the real PDF regardless of how large it was drawn on screen. */}
            <div className="mt-3">
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Your Signature</label>
              <canvas
                {...sigPad.canvasProps}
                className={`bg-white rounded-md border border-white/15 block mx-auto w-full max-w-md ${sigPad.canvasProps.className}`}
              />
              <div className="mt-2">
                <SignaturePadControls pad={sigPad} />
              </div>
            </div>

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
