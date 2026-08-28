/**
 * Fill Flash Technician Travel & Out-of-State Policy — opened from the
 * deep link a Team Messenger message sends (see ReportHRDaily.tsx's
 * "Flash Technician Travel" tab "Send Request" flow). Same architecture as
 * FillMileageFuelPage.tsx: renders the REAL official PDF's pages to
 * canvases via pdf.js, with an input overlay at each blank's own
 * coordinates — no redrawn lookalike. Submitting draws the collected
 * values directly onto that same real PDF via fillFlashTechnicianTravelPdf
 * (this PDF has no AcroForm fields either) and sends the result back to HR.
 *
 * Simpler than most of this family: the source document collects no name/
 * branch/etc. anywhere — just a plain acknowledgment paragraph followed by
 * the signature block on the last page — so this page only needs a
 * signature pad and a date, both there. The "Employer Representative
 * Signature" line lives right underneath on that same page, completed
 * separately afterward by HR inside ReportHRDaily.tsx's "Complete Employer
 * Signature" dialog — shown here read-only (the blank PDF page underneath,
 * no overlay).
 *
 * This source PDF is A4 (595.56 x 842.04pt), not the US Letter size most
 * of this app's other HR PDFs use — PAGE_WIDTH/PAGE_HEIGHT below reflect
 * that; don't copy the 612x792 constants from a Letter-sized sibling.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import { getSignableDocument, signDocument, type SignableDocument } from "@/lib/supabase/signableDocuments";
import { uploadSignableDocumentSignature, uploadFlashTechnicianTravelForm } from "@/lib/firebase/storage";
import { fillFlashTechnicianTravelPdf, loadBlankFlashTechnicianTravelBytes } from "@/lib/flashTechnicianTravelPdfFill";
import type { FlashTechnicianTravelFormData } from "@/lib/flashTechnicianTravelFormTemplate";
import { getOrCreateDmThread, sendMessage } from "@/lib/supabase/messaging";
import { logActivity } from "@/lib/supabase/hrActivityLog";
import { getHrNotificationSettings } from "@/lib/supabase/companySettings";
import { notifyHrRoleUsers } from "@/lib/supabase/hrRoleNotify";
import { useSignaturePad } from "@/hooks/useSignaturePad";
import { SignaturePadControls } from "@/components/SignaturePad";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

interface Props {
  docId: string;
}

const PAGE_WIDTH = 595.56;
const PAGE_HEIGHT = 842.04;

// Field rectangles (PDF user-space units, origin bottom-left), calibrated
// against src/assets/Flash Technician Travel & Out-of-State Policy 1.pdf
// via pdfjs-dist text-item positions + pdf-lib Helvetica width metrics —
// see flashTechnicianTravelPdfFill.ts's header comment. Both signature
// lines live on the last page (index 2 / page 3).
const PAGE3_RECT = {
  signature: { x: 183, y: 716, w: 200, h: 26 },
  dateSigned: { x: 424, y: 716, w: 90, h: 14 },
} as const;

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
        const [pdfjsLib, bytes] = await Promise.all([import("pdfjs-dist"), loadBlankFlashTechnicianTravelBytes()]);
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
      const finalData: FlashTechnicianTravelFormData = { ...form, employeeName, employeeDateSigned: signedAt, employeeSignatureDataUrl: dataUrl };
      const entry = { name: employeeName, url: signatureUrl, signedAt };

      const pdfBytes = await fillFlashTechnicianTravelPdf(finalData, sigBytes);
      const pdfUrl = await uploadFlashTechnicianTravelForm(companyId, employeeName, new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" }));

      await signDocument(doc.id, "employee", entry, pdfUrl, finalData as unknown as Record<string, any>);

      if (doc.createdBy) {
        const thread = await getOrCreateDmThread(myProfileId, doc.createdBy);
        const filename = `Flash Technician Travel & Out-of-State Policy - ${employeeName}.pdf`;
        await sendMessage({
          dmThreadId: thread.id,
          senderId: myProfileId,
          senderName: displayName || "Employee",
          body: `📄 Flash Technician Travel & Out-of-State Policy for ${employeeName} has been signed, and is ready for the employer/representative signature: [${filename}](${pdfUrl})`,
        });
      }

      getHrNotificationSettings()
        .then(({ taxForms }) => {
          if (!taxForms) return;
          const excludeIds = doc.createdBy ? [doc.createdBy] : [];
          void notifyHrRoleUsers(myProfileId, displayName || "Employee", excludeIds, `📄 Flash Technician Travel & Out-of-State Policy for ${employeeName} has been signed — the employer/representative signature is ready to be added.`);
        })
        .catch((err) => console.error("[flash-technician-travel] hr notify check failed:", err));

      setDoc({ ...doc, status: "signed", pdfUrl, formData: finalData as unknown as Record<string, any>, signatures: { employee: entry }, signedAt });
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
    top: (PAGE_HEIGHT - r.y - r.h) * scale,
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

        {loading ? (
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
            <p className="text-xs text-muted-foreground mb-2">HR will add the employer/representative signature separately.</p>
            {doc.pdfUrl && (
              <a href={doc.pdfUrl} target="_blank" rel="noreferrer noopener" className="text-blue-300 hover:text-blue-200 underline text-sm">
                View the completed PDF
              </a>
            )}
          </div>
        ) : (
          <div className="panel p-4">
            <p className="text-xs text-muted-foreground mb-3">
              Read the Flash Technician Travel & Out-of-State Policy below, add your signature at the bottom, then submit.
            </p>

            <div className="overflow-x-auto flex flex-col items-center bg-white/5 rounded-md p-4 gap-4">
              {Array.from({ length: numPages || 1 }, (_, i) => i + 1).map((pageNum) => (
                <div key={pageNum} className="relative bg-white shadow-lg" style={{ width: PAGE_WIDTH * scale, height: PAGE_HEIGHT * scale }}>
                  <canvas ref={(el) => { pageCanvasRefs.current[pageNum - 1] = el; }} className="absolute inset-0" />
                  {pageLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm text-muted-foreground gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading form…
                    </div>
                  )}

                  {!pageLoading && pageNum === numPages && (
                    <>
                      <canvas
                        {...sigPad.canvasProps}
                        style={{
                          position: "absolute",
                          left: PAGE3_RECT.signature.x * scale,
                          top: (PAGE_HEIGHT - PAGE3_RECT.signature.y - PAGE3_RECT.signature.h) * scale,
                          width: PAGE3_RECT.signature.w * scale,
                          height: PAGE3_RECT.signature.h * scale,
                        }}
                      />
                      <div style={overlayStyle(PAGE3_RECT.dateSigned)} className="flex items-center font-bold text-[#00008B]">
                        {fmtDateSignedDisplay(new Date())}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-center mt-2">
              <SignaturePadControls pad={sigPad} />
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
