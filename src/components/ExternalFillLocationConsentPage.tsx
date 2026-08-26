/**
 * External Fill Employee Mobile App Location Sharing Consent Agreement —
 * the no-login counterpart to FillLocationConsentPage.tsx, opened from
 * the link ReportHRDaily.tsx's "Send Request" panel generates when HR
 * picks "External Link" instead of an AHS teammate. No AHS account
 * needed: talks only to /api/signable-documents (see
 * externalSignableDocuments.ts / signableDocumentsBridge.ts), which only
 * ever serves/accepts documents that have no linked AHS profile
 * (recipient_id IS NULL).
 *
 * Same real-PDF overlay rendering as FillLocationConsentPage.tsx
 * (identical field rects). The PDF is built entirely client-side via the
 * same pure fillLocationConsentPdf used by the logged-in flow, then
 * POSTed already-finished to the server bridge, which uploads it and
 * notifies HR — no DM step here since there's no sender profile.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import logo from "@/assets/Admin Hub Solutions Logo no Text.png";
import { getExternalSignableDocument, submitExternalSignature, type ExternalSignableDocument } from "@/lib/supabase/externalSignableDocuments";
import { fillLocationConsentPdf, loadBlankLocationConsentBytes } from "@/lib/locationConsentPdfFill";
import type { LocationConsentFormData } from "@/lib/locationConsentFormTemplate";
import { useSignaturePad } from "@/hooks/useSignaturePad";
import { useResponsivePdfScale } from "@/hooks/useResponsivePdfScale";
import { SignaturePadControls } from "@/components/SignaturePad";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

interface Props {
  docId: string;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

// Same field rectangles as FillLocationConsentPage.tsx — see that file's
// header comment for how these were derived.
const PAGE1_RECT = {
  employeeName: { x: 159.4, y: 667.5, w: 203.3, h: 14 },
  positionTitle: { x: 150.8, y: 642.5, w: 203.5, h: 14 },
  effectiveDate: { x: 146.4, y: 617.6, w: 203.3, h: 14 },
} as const;

const PAGE2_RECT = {
  signature: { x: 177.2, y: 692.5, w: 203.3, h: 20 },
  dateSigned: { x: 412.5, y: 692.5, w: 89.7, h: 13 },
} as const;

const fmtDateSigned = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;

const BLANK_FORM: LocationConsentFormData = {
  employeeId: "",
  employeeName: "",
  positionTitle: "",
  effectiveDate: "",
  employeeDateSigned: "",
  employeeSignatureDataUrl: "",
  employerDateSigned: "",
  employerSignatureDataUrl: "",
};

export function ExternalFillLocationConsentPage({ docId }: Props) {
  const [doc, setDoc] = useState<ExternalSignableDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedPdfUrl, setSubmittedPdfUrl] = useState<string | null>(null);

  const [pageLoading, setPageLoading] = useState(true);
  const { scale, containerRef } = useResponsivePdfScale(PAGE_WIDTH);
  const [numPages, setNumPages] = useState(0);
  const pdfDocRef = useRef<any>(null);
  const pageCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);

  const [form, setForm] = useState<LocationConsentFormData>({ ...BLANK_FORM });

  const sigPad = useSignaturePad({ defaultName: form.employeeName, width: 440, height: 100 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const document = await getExternalSignableDocument(docId);
        if (cancelled) return;
        if (!document || document.documentType !== "location_consent") {
          setError("This link isn't valid, or the document doesn't use link-based signing.");
        } else {
          setDoc(document);
          const existing = document.formData as Partial<LocationConsentFormData>;
          setForm((prev) => ({ ...prev, ...existing, employeeName: existing.employeeName || document.recipientName || "" }));
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load document.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [docId]);

  useEffect(() => {
    if (loading || error || submitted) return;
    let cancelled = false;
    (async () => {
      try {
        const [pdfjsLib, bytes] = await Promise.all([import("pdfjs-dist"), loadBlankLocationConsentBytes()]);
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

  const updateField = <K extends keyof LocationConsentFormData>(key: K, value: LocationConsentFormData[K]) => setForm((f) => ({ ...f, [key]: value }));

  const validate = (): string | null => {
    if (!form.employeeName.trim()) return "Enter your name.";
    if (!form.positionTitle.trim()) return "Enter your position/title.";
    if (!form.effectiveDate.trim()) return "Enter the effective date.";
    if (!sigPad.hasContent()) return "Please add your signature.";
    return null;
  };

  const handleSubmit = async () => {
    if (!doc) return;
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
      const signatureBlob = await (await fetch(dataUrl)).blob();
      const signedAt = new Date().toISOString();
      const finalData: LocationConsentFormData = { ...form, employeeDateSigned: signedAt, employeeSignatureDataUrl: dataUrl };

      const sigBytes = new Uint8Array(await signatureBlob.arrayBuffer());
      const pdfBytes = await fillLocationConsentPdf(finalData, sigBytes);
      const pdfBlob = new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" });

      const { pdfUrl } = await submitExternalSignature(docId, { signatureBlob, pdfBlob, formData: finalData as unknown as Record<string, any> });

      setSubmittedPdfUrl(pdfUrl);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit form.");
    } finally {
      setSubmitting(false);
    }
  };

  const overlayStyle = (r: { x: number; y: number; w: number; h: number }): React.CSSProperties => ({
    position: "absolute",
    left: r.x * scale,
    top: (PAGE_HEIGHT - r.y - r.h) * scale,
    width: r.w * scale,
    height: r.h * scale,
    fontSize: `${7 * scale}px`,
  });

  const overlayInputCls = "bg-blue-50/60 border border-blue-300/70 rounded-[2px] outline-none p-0 font-bold font-sans text-[#00008B] focus:bg-blue-100/80 focus:border-blue-400";

  const singleLineInput = (field: keyof LocationConsentFormData, rect: { x: number; y: number; w: number; h: number }) => (
    <input
      key={field}
      style={overlayStyle(rect)}
      className={overlayInputCls}
      value={form[field] as string}
      onChange={(e) => updateField(field, e.target.value as LocationConsentFormData[typeof field])}
    />
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto p-4">
        <div className="flex justify-center mb-4">
          <img src={logo} alt="Admin Hub Solutions" className="h-10 w-auto opacity-80" />
        </div>

        {loading ? (
          <div className="panel p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading document…
          </div>
        ) : error && !doc ? (
          <div className="panel p-6 text-sm text-red-300">{error}</div>
        ) : !doc ? null : submitted || doc.status === "signed" ? (
          <div className="panel p-6 text-center">
            <p className="text-sm font-semibold mb-2">✅ Submitted{submitted ? " and sent back to HR" : ""}.</p>
            <p className="text-xs text-muted-foreground mb-2">HR will add the employer/representative signature separately.</p>
            {submittedPdfUrl && (
              <a href={submittedPdfUrl} target="_blank" rel="noreferrer noopener" className="text-blue-300 hover:text-blue-200 underline text-sm">
                View the completed PDF
              </a>
            )}
            {!submittedPdfUrl && <p className="text-xs text-muted-foreground">You can close this page now.</p>}
          </div>
        ) : (
          <div className="panel p-4">
            <p className="text-xs text-muted-foreground mb-3">
              Fill in your name, position/title, and the effective date, review the terms, add your signature, then submit.
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
                      {singleLineInput("employeeName", PAGE1_RECT.employeeName)}
                      {singleLineInput("positionTitle", PAGE1_RECT.positionTitle)}
                      <input
                        type="date"
                        style={overlayStyle(PAGE1_RECT.effectiveDate)}
                        className={overlayInputCls}
                        value={form.effectiveDate}
                        onChange={(e) => updateField("effectiveDate", e.target.value)}
                      />
                    </>
                  )}

                  {!pageLoading && pageNum === 2 && (
                    <>
                      <canvas
                        {...sigPad.canvasProps}
                        style={{
                          position: "absolute",
                          left: PAGE2_RECT.signature.x * scale,
                          top: (PAGE_HEIGHT - PAGE2_RECT.signature.y - PAGE2_RECT.signature.h) * scale,
                          width: PAGE2_RECT.signature.w * scale,
                          height: PAGE2_RECT.signature.h * scale,
                        }}
                      />
                      <div style={overlayStyle(PAGE2_RECT.dateSigned)} className="flex items-center font-bold text-[#00008B]">
                        {fmtDateSigned(new Date())}
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
              {submitting ? "Submitting…" : "Submit"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
