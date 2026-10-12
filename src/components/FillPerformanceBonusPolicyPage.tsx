/**
 * Fill the Performance Bonus Policy & Acknowledgment Form — opened from the
 * deep link HR's "Send Request" message (ReportHRDaily.tsx's Performance
 * Bonus Policy tab, New Automation Forms) or the Staff Form Checklist sends.
 * Same architecture as FillFlashTechnicianTravelPage.tsx: the REAL PDF's
 * pages (with the company logo) rendered via pdf.js, the printed name and
 * today's date shown at their blanks, a signature pad below; submitting
 * draws everything onto that same PDF (fillPerformanceBonusPolicyPdf) and
 * sends it back to HR. Technician-only — no employer line, so the signed
 * document is complete.
 */
import { InlinePdfLink } from "@/components/InlinePdfViewer";
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { FillFormSignInRequired } from "@/components/FillFormSignInRequired";
import { getMyProfileId } from "@/lib/supabase/users";
import { getSignableDocument, signDocument, type SignableDocument } from "@/lib/supabase/signableDocuments";
import { uploadSignableDocumentSignature, uploadPerformanceBonusPolicyForm } from "@/lib/firebase/storage";
import {
  fillPerformanceBonusPolicyPdf,
  loadBlankPerformanceBonusPolicyBytes,
  PERFORMANCE_BONUS_LAYOUT,
  PERFORMANCE_BONUS_POLICY_TITLE,
  type PerformanceBonusPolicyFormData,
} from "@/lib/performanceBonusPolicyPdfFill";
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

const { pageWidth: PAGE_WIDTH, pageHeight: PAGE_HEIGHT, rects: RECTS } = PERFORMANCE_BONUS_LAYOUT;
const TITLE = PERFORMANCE_BONUS_POLICY_TITLE;

const BLANK_FORM: PerformanceBonusPolicyFormData = {
  employeeId: "",
  employeeName: "",
  employeeDateSigned: "",
  employeeSignatureDataUrl: "",
};

export function FillPerformanceBonusPolicyPage({ docId }: Props) {
  const { ready, uid, displayName, role } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [doc, setDoc] = useState<SignableDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [pageLoading, setPageLoading] = useState(true);
  const scale = 1.1;
  const [numPages, setNumPages] = useState(0);
  const pdfDocRef = useRef<any>(null);
  const pageCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);

  const [form, setForm] = useState<PerformanceBonusPolicyFormData>({ ...BLANK_FORM });
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
        if (!document || document.documentType !== "performance_bonus_policy") {
          setError("This document doesn't exist or has been removed.");
        } else {
          setDoc(document);
          setForm((prev) => ({ ...prev, ...(document.formData as Partial<PerformanceBonusPolicyFormData>) }));
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
        const [pdfjsLib, bytes] = await Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), loadBlankPerformanceBonusPolicyBytes()]);
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
  }, [numPages]);

  const employeeName = displayName || doc?.recipientName || "";

  const handleSubmit = async () => {
    if (!doc || !myProfileId) return;
    const dataUrl = sigPad.hasContent() ? sigPad.toDataURL() : "";
    if (!dataUrl) {
      setError("Please add your signature.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const companyId = doc.companyId;
      const name = employeeName || "Technician";
      const sigBytes = new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
      const signatureUrl = await uploadSignableDocumentSignature(companyId, doc.id, "employee", dataUrl);
      const signedAt = new Date().toISOString();
      const finalData: PerformanceBonusPolicyFormData = { ...form, employeeName: name, employeeDateSigned: signedAt, employeeSignatureDataUrl: dataUrl };
      const entry = { name, url: signatureUrl, signedAt };

      const pdfBytes = await fillPerformanceBonusPolicyPdf(finalData, sigBytes);
      const pdfUrl = await uploadPerformanceBonusPolicyForm(companyId, name, new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" }));
      await signDocument(doc.id, "employee", entry, pdfUrl, finalData as unknown as Record<string, any>);

      if (doc.createdBy) {
        const thread = await getOrCreateDmThread(myProfileId, doc.createdBy);
        await sendMessage({
          dmThreadId: thread.id,
          senderId: myProfileId,
          senderName: displayName || "Technician",
          body: `📄 ${TITLE} for ${name} has been signed: [${TITLE} - ${name}.pdf](${pdfUrl})`,
        });
      }
      getHrNotificationSettings()
        .then(({ taxForms }) => {
          if (!taxForms) return;
          const excludeIds = doc.createdBy ? [doc.createdBy] : [];
          void notifyHrRoleUsers(myProfileId, displayName || "Technician", excludeIds, `📄 ${TITLE} for ${name} has been signed.`);
        })
        .catch((err) => console.error("[performance-bonus-policy] hr notify check failed:", err));

      setDoc({ ...doc, status: "signed", pdfUrl, formData: finalData as unknown as Record<string, any>, signatures: { employee: entry }, signedAt });
      void logActivity({ action: "performance_bonus_policy_signed", targetType: "employee", targetLabel: name });
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
            {doc.pdfUrl && <InlinePdfLink url={doc.pdfUrl} label="View the completed PDF" className="text-blue-300 hover:text-blue-200 underline text-sm" />}
          </div>
        ) : (
          <div className="panel p-4">
            <h1 className="text-lg font-bold mb-1">{TITLE}</h1>
            <p className="text-xs text-muted-foreground mb-3">Read the policy below, add your signature at the bottom, then submit.</p>

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
                      <div style={overlayStyle(RECTS.name)} className="flex items-center font-bold text-[#00008B]">{employeeName}</div>
                      <div style={overlayStyle(RECTS.dateSigned)} className="flex items-center font-bold text-[#00008B]">{new Date().toLocaleDateString("en-US")}</div>
                    </>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-3">
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Your Signature</label>
              <canvas {...sigPad.canvasProps} className={`bg-white rounded-md border border-white/15 block mx-auto w-full max-w-md ${sigPad.canvasProps.className}`} />
              <div className="mt-2">
                <SignaturePadControls pad={sigPad} />
              </div>
            </div>

            {error && <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2 mt-3">{error}</p>}

            <button onClick={handleSubmit} disabled={submitting} className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white mt-3 disabled:opacity-50">
              {submitting ? "Submitting…" : "Submit to HR"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
