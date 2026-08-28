/**
 * External Fill W-8BEN — the no-login counterpart to FillW8benPage.tsx,
 * opened from the link ReportHRDaily.tsx's "Send W-8BEN Request" panel
 * generates when HR picks "External Link" instead of an AHS teammate. No
 * AHS account needed: talks only to /api/signable-documents (see
 * externalSignableDocuments.ts / signableDocumentsBridge.ts), which only
 * ever serves/accepts documents that have no linked AHS profile
 * (recipient_id IS NULL).
 *
 * Same real-PDF overlay rendering as FillW8benPage.tsx (identical field
 * rects). The PDF is built entirely client-side via the same pure
 * fillW8benPdf used by the logged-in flow, then POSTed already-finished to
 * the server bridge, which uploads it and notifies HR — no DM step here
 * since there's no sender profile.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import logo from "@/assets/Admin Hub Solutions Logo no Text.png";
import { getExternalSignableDocument, submitExternalSignature, type ExternalSignableDocument } from "@/lib/supabase/externalSignableDocuments";
import { fillW8benPdf, loadBlankW8benBytes } from "@/lib/w8benPdfFill";
import type { W8benAddress, W8benFormData } from "@/lib/w8benFormTemplate";
import { useSignaturePad } from "@/hooks/useSignaturePad";
import { useResponsivePdfScale } from "@/hooks/useResponsivePdfScale";
import { SignaturePadControls } from "@/components/SignaturePad";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

interface Props {
  docId: string;
}

const BLANK_ADDRESS: W8benAddress = { street: "", cityStateZip: "", country: "" };

// Same field rectangles as FillW8benPage.tsx — see that file's header
// comment for how these were derived.
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792.008;

const RECT = {
  employeeName: { x: 36, y: 540, w: 338, h: 14 },
  countryOfCitizenship: { x: 376, y: 540, w: 200, h: 14 },
  permanentStreet: { x: 36, y: 516, w: 540, h: 14 },
  permanentCityStateZip: { x: 36, y: 492, w: 403, h: 14 },
  permanentCountry: { x: 441, y: 492, w: 135, h: 14 },
  mailingStreet: { x: 36, y: 468, w: 540, h: 14 },
  mailingCityStateZip: { x: 36, y: 444, w: 403, h: 14 },
  mailingCountry: { x: 441, y: 444, w: 135, h: 14 },
  usTin: { x: 65, y: 420, w: 511, h: 12 },
  ftinNotRequired: { x: 563, y: 409, w: 10, h: 10 },
  ftin: { x: 36, y: 396, w: 252, h: 12 },
  referenceNumbers: { x: 36, y: 372, w: 252, h: 12 },
  dateOfBirth: { x: 288, y: 372, w: 200, h: 12 },
  treatyResidentCountry: { x: 238, y: 348, w: 202, h: 12 },
  treatyArticleParagraph: { x: 65, y: 312, w: 111, h: 12 },
  treatyRate: { x: 352, y: 312, w: 22, h: 12 },
  treatyIncomeType: { x: 65, y: 300, w: 504, h: 12 },
  treatyAdditionalConditions: { x: 65, y: 276, w: 511, h: 12 },
  certifiedTrue: { x: 109, y: 97, w: 10, h: 10 },
  signature: { x: 108, y: 72, w: 317, h: 12 },
  dateSigned: { x: 432, y: 72, w: 144, h: 12 },
  printedName: { x: 108, y: 48, w: 317, h: 12 },
} as const;

const SIG_EXTRA_HEIGHT = 16;

const fmtDateSigned = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${d.getFullYear()}`;

export function ExternalFillW8benPage({ docId }: Props) {
  const [doc, setDoc] = useState<ExternalSignableDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedPdfUrl, setSubmittedPdfUrl] = useState<string | null>(null);

  const [pageLoading, setPageLoading] = useState(true);
  const { scale, containerRef } = useResponsivePdfScale(PAGE_WIDTH);
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [form, setForm] = useState<W8benFormData>({
    employeeId: "",
    employeeName: "",
    countryOfCitizenship: "",
    permanentAddress: { ...BLANK_ADDRESS },
    mailingAddress: { ...BLANK_ADDRESS },
    usTin: "",
    ftin: "",
    ftinNotRequired: false,
    referenceNumbers: "",
    dateOfBirth: "",
    treatyResidentCountry: "",
    treatyArticleParagraph: "",
    treatyRate: "",
    treatyIncomeType: "",
    treatyAdditionalConditions: "",
    certifiedTrue: false,
    dateSigned: "",
  });

  const sigPad = useSignaturePad({ defaultName: form.employeeName, width: 440, height: 120 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const document = await getExternalSignableDocument(docId);
        if (cancelled) return;
        if (!document || document.documentType !== "w8ben") {
          setError("This link isn't valid, or the document doesn't use link-based signing.");
        } else {
          setDoc(document);
          const existing = document.formData as Partial<W8benFormData>;
          setForm((prev) => ({
            ...prev,
            ...existing,
            employeeName: existing.employeeName || document.recipientName || "",
            permanentAddress: { ...BLANK_ADDRESS, ...(existing.permanentAddress ?? {}) },
            mailingAddress: { ...BLANK_ADDRESS, ...(existing.mailingAddress ?? {}) },
          }));
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
      setPageLoading(true);
      try {
        const [pdfjsLib, bytes] = await Promise.all([import("pdfjs-dist"), loadBlankW8benBytes()]);
        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale });
        const canvas = bgCanvasRef.current;
        if (!canvas || cancelled) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = viewport.width * dpr;
        canvas.height = viewport.height * dpr;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const ctx = canvas.getContext("2d")!;
        ctx.scale(dpr, dpr);
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to render the form.");
      } finally {
        if (!cancelled) setPageLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loading, error, submitted, scale]);

  const updateField = <K extends keyof W8benFormData>(key: K, value: W8benFormData[K]) => setForm((f) => ({ ...f, [key]: value }));
  const updateAddress = (which: "permanentAddress" | "mailingAddress", key: keyof W8benAddress, value: string) =>
    setForm((f) => ({ ...f, [which]: { ...f[which], [key]: value } }));

  const validate = (): string | null => {
    if (!form.employeeName.trim()) return "Enter the beneficial owner's name.";
    if (!form.countryOfCitizenship.trim()) return "Enter your country of citizenship.";
    if (!form.permanentAddress.street.trim() || !form.permanentAddress.cityStateZip.trim() || !form.permanentAddress.country.trim()) return "Fill in your permanent residence address.";
    if (!form.dateOfBirth.trim()) return "Enter your date of birth.";
    if (!form.certifiedTrue) return "You must check the certification statement.";
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
      const finalData: W8benFormData = { ...form, dateSigned: signedAt };

      const sigBytes = new Uint8Array(await signatureBlob.arrayBuffer());
      const pdfBytes = await fillW8benPdf(finalData, sigBytes);
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
  const checkboxCls = "border border-black/60 bg-blue-50/60 flex items-center justify-center leading-none text-[#00008B] font-bold hover:bg-blue-100/80";

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
            {submittedPdfUrl && (
              <a href={submittedPdfUrl} target="_blank" rel="noreferrer noopener" className="text-blue-300 hover:text-blue-200 underline text-sm">
                View the completed PDF
              </a>
            )}
            {!submittedPdfUrl && <p className="text-xs text-muted-foreground">You can close this page now.</p>}
          </div>
        ) : (
          <div className="panel p-4">
            <p className="text-xs text-muted-foreground mb-3">Fill in your information directly on the form below, add your signature, then submit.</p>

            <div ref={containerRef} className="overflow-x-auto flex justify-center bg-white/5 rounded-md p-4">
              <div className="relative bg-white shadow-lg" style={{ width: PAGE_WIDTH * scale, height: PAGE_HEIGHT * scale }}>
                <canvas ref={bgCanvasRef} className="absolute inset-0" />
                {pageLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm text-muted-foreground gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading form…
                  </div>
                )}

                {!pageLoading && (
                  <>
                    <input style={overlayStyle(RECT.employeeName)} className={overlayInputCls} value={form.employeeName} onChange={(e) => updateField("employeeName", e.target.value)} />
                    <input style={overlayStyle(RECT.countryOfCitizenship)} className={overlayInputCls} value={form.countryOfCitizenship} onChange={(e) => updateField("countryOfCitizenship", e.target.value)} />

                    <input style={overlayStyle(RECT.permanentStreet)} className={overlayInputCls} value={form.permanentAddress.street} onChange={(e) => updateAddress("permanentAddress", "street", e.target.value)} />
                    <input style={overlayStyle(RECT.permanentCityStateZip)} className={overlayInputCls} value={form.permanentAddress.cityStateZip} onChange={(e) => updateAddress("permanentAddress", "cityStateZip", e.target.value)} />
                    <input style={overlayStyle(RECT.permanentCountry)} className={overlayInputCls} value={form.permanentAddress.country} onChange={(e) => updateAddress("permanentAddress", "country", e.target.value)} />

                    <input style={overlayStyle(RECT.mailingStreet)} className={overlayInputCls} value={form.mailingAddress.street} onChange={(e) => updateAddress("mailingAddress", "street", e.target.value)} />
                    <input style={overlayStyle(RECT.mailingCityStateZip)} className={overlayInputCls} value={form.mailingAddress.cityStateZip} onChange={(e) => updateAddress("mailingAddress", "cityStateZip", e.target.value)} />
                    <input style={overlayStyle(RECT.mailingCountry)} className={overlayInputCls} value={form.mailingAddress.country} onChange={(e) => updateAddress("mailingAddress", "country", e.target.value)} />

                    <input style={overlayStyle(RECT.usTin)} className={overlayInputCls} value={form.usTin} onChange={(e) => updateField("usTin", e.target.value)} />
                    <input style={overlayStyle(RECT.ftin)} className={overlayInputCls} value={form.ftin} disabled={form.ftinNotRequired} onChange={(e) => updateField("ftin", e.target.value)} />
                    <button
                      type="button"
                      style={overlayStyle(RECT.ftinNotRequired)}
                      onClick={() => updateField("ftinNotRequired", !form.ftinNotRequired)}
                      className={checkboxCls}
                    >
                      {form.ftinNotRequired ? "✔" : ""}
                    </button>
                    <input style={overlayStyle(RECT.referenceNumbers)} className={overlayInputCls} value={form.referenceNumbers} onChange={(e) => updateField("referenceNumbers", e.target.value)} />
                    <input type="date" style={overlayStyle(RECT.dateOfBirth)} className={overlayInputCls} value={form.dateOfBirth} onChange={(e) => updateField("dateOfBirth", e.target.value)} />

                    <input style={overlayStyle(RECT.treatyResidentCountry)} className={overlayInputCls} value={form.treatyResidentCountry} onChange={(e) => updateField("treatyResidentCountry", e.target.value)} />
                    <input style={overlayStyle(RECT.treatyArticleParagraph)} className={overlayInputCls} value={form.treatyArticleParagraph} onChange={(e) => updateField("treatyArticleParagraph", e.target.value)} />
                    <input style={overlayStyle(RECT.treatyRate)} className={overlayInputCls} value={form.treatyRate} onChange={(e) => updateField("treatyRate", e.target.value)} />
                    <input style={overlayStyle(RECT.treatyIncomeType)} className={overlayInputCls} value={form.treatyIncomeType} onChange={(e) => updateField("treatyIncomeType", e.target.value)} />
                    <input style={overlayStyle(RECT.treatyAdditionalConditions)} className={overlayInputCls} value={form.treatyAdditionalConditions} onChange={(e) => updateField("treatyAdditionalConditions", e.target.value)} />

                    <canvas
                      {...sigPad.canvasProps}
                      style={{
                        position: "absolute",
                        left: RECT.signature.x * scale,
                        top: (PAGE_HEIGHT - RECT.signature.y - RECT.signature.h - SIG_EXTRA_HEIGHT) * scale,
                        width: RECT.signature.w * scale,
                        height: (RECT.signature.h + SIG_EXTRA_HEIGHT) * scale,
                      }}
                    />

                    <button
                      type="button"
                      style={overlayStyle(RECT.certifiedTrue)}
                      onClick={() => updateField("certifiedTrue", !form.certifiedTrue)}
                      className={checkboxCls}
                    >
                      {form.certifiedTrue ? "✔" : ""}
                    </button>
                    <div style={overlayStyle(RECT.dateSigned)} className="flex items-end justify-center font-bold text-[#00008B]">
                      {fmtDateSigned(new Date())}
                    </div>
                    <div style={overlayStyle(RECT.printedName)} className="flex items-end font-bold text-[#00008B]">
                      {form.employeeName}
                    </div>
                  </>
                )}
              </div>
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
