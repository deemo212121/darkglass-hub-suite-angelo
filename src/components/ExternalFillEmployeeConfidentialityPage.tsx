/**
 * External Fill Employee Confidentiality and Non-Disclosure Agreement — the
 * no-login counterpart to FillEmployeeConfidentialityPage.tsx, opened from
 * the link ReportHRDaily.tsx's "Send Request" panel generates when HR picks
 * "External Link" instead of an AHS teammate. No AHS account needed: talks
 * only to /api/signable-documents (see externalSignableDocuments.ts /
 * signableDocumentsBridge.ts), which only ever serves/accepts documents
 * that have no linked AHS profile (recipient_id IS NULL).
 *
 * Same real-PDF overlay rendering as FillEmployeeConfidentialityPage.tsx
 * (identical field rects). The PDF is built entirely client-side via the
 * same pure fillEmployeeConfidentialityPdf used by the logged-in flow, then
 * POSTed already-finished to the server bridge, which uploads it and
 * notifies HR — no DM step here since there's no sender profile.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import logo from "@/assets/Admin Hub Solutions Logo no Text.png";
import { getExternalSignableDocument, submitExternalSignature, type ExternalSignableDocument } from "@/lib/supabase/externalSignableDocuments";
import { fillEmployeeConfidentialityPdf, loadBlankEmployeeConfidentialityBytes } from "@/lib/employeeConfidentialityPdfFill";
import { EMPLOYEE_CONFIDENTIALITY_BRANCHES, type EmployeeConfidentialityFormData } from "@/lib/employeeConfidentialityFormTemplate";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

interface Props {
  docId: string;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

// Same field rectangles as FillEmployeeConfidentialityPage.tsx — see that
// file's header comment for how these were derived.
const PAGE1_RECT = {
  dateSigned: { x: 327, y: 646, w: 150, h: 13 },
  employeeName: { x: 215, y: 529, w: 330, h: 14 },
  address: { x: 201, y: 504, w: 344, h: 14 },
  city: { x: 175, y: 479, w: 120, h: 13 },
  state: { x: 313, y: 479, w: 60, h: 13 },
  zip: { x: 403, y: 479, w: 80, h: 13 },
  branch: { x: 193, y: 454, w: 250, h: 14 },
} as const;

const PAGE2_RECT = {
  dateSigned: { x: 102, y: 302, w: 170, h: 13 },
  signature: { x: 177, y: 320, w: 280, h: 24 },
} as const;

const fmtDateSigned = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;

const BLANK_FORM: EmployeeConfidentialityFormData = {
  employeeId: "",
  employeeName: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  branch: "",
  dateSigned: "",
  signatureDataUrl: "",
};

export function ExternalFillEmployeeConfidentialityPage({ docId }: Props) {
  const [doc, setDoc] = useState<ExternalSignableDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedPdfUrl, setSubmittedPdfUrl] = useState<string | null>(null);

  const [pageLoading, setPageLoading] = useState(true);
  const [scale, setScale] = useState(1.3);
  const [numPages, setNumPages] = useState(0);
  const pdfDocRef = useRef<any>(null);
  const pageCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);

  const [form, setForm] = useState<EmployeeConfidentialityFormData>({ ...BLANK_FORM });

  const sigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const hasDrawnRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const document = await getExternalSignableDocument(docId);
        if (cancelled) return;
        if (!document || document.documentType !== "employee_confidentiality") {
          setError("This link isn't valid, or the document doesn't use link-based signing.");
        } else {
          setDoc(document);
          const existing = document.formData as Partial<EmployeeConfidentialityFormData>;
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
        const [pdfjsLib, bytes] = await Promise.all([import("pdfjs-dist"), loadBlankEmployeeConfidentialityBytes()]);
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

  const updateField = <K extends keyof EmployeeConfidentialityFormData>(key: K, value: EmployeeConfidentialityFormData[K]) => setForm((f) => ({ ...f, [key]: value }));

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = sigCanvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };
  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawingRef.current = true;
    const ctx = sigCanvasRef.current!.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const moveDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const ctx = sigCanvasRef.current!.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.stroke();
    hasDrawnRef.current = true;
  };
  const endDraw = () => { drawingRef.current = false; };
  const clearSignature = () => {
    const c = sigCanvasRef.current;
    if (!c) return;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    hasDrawnRef.current = false;
  };

  const validate = (): string | null => {
    if (!form.employeeName.trim()) return "Enter your full name.";
    if (!form.address.trim()) return "Enter your address.";
    if (!form.city.trim()) return "Enter your city.";
    if (!form.state.trim()) return "Enter your state.";
    if (!form.zip.trim()) return "Enter your zip code.";
    if (!form.branch) return "Select your branch.";
    if (!hasDrawnRef.current) return "Please draw your signature.";
    return null;
  };

  const handleSubmit = async () => {
    if (!doc || !sigCanvasRef.current) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const dataUrl = sigCanvasRef.current.toDataURL("image/png");
      const signatureBlob = await (await fetch(dataUrl)).blob();
      const signedAt = new Date().toISOString();
      const finalData: EmployeeConfidentialityFormData = { ...form, dateSigned: signedAt, signatureDataUrl: dataUrl };

      const sigBytes = new Uint8Array(await signatureBlob.arrayBuffer());
      const pdfBytes = await fillEmployeeConfidentialityPdf(finalData, sigBytes);
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
            <p className="text-xs text-muted-foreground mb-3">
              Read the agreement below, fill in your information, draw your signature, then submit.
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

                  {!pageLoading && pageNum === 1 && (
                    <>
                      <div style={overlayStyle(PAGE1_RECT.dateSigned)} className="flex items-center font-bold text-[#00008B]">
                        {fmtDateSigned(new Date())}
                      </div>

                      <input
                        style={overlayStyle(PAGE1_RECT.employeeName)}
                        className={overlayInputCls}
                        value={form.employeeName}
                        onChange={(e) => updateField("employeeName", e.target.value)}
                      />

                      <input
                        style={overlayStyle(PAGE1_RECT.address)}
                        className={overlayInputCls}
                        value={form.address}
                        onChange={(e) => updateField("address", e.target.value)}
                      />

                      <input
                        style={overlayStyle(PAGE1_RECT.city)}
                        className={overlayInputCls}
                        value={form.city}
                        onChange={(e) => updateField("city", e.target.value)}
                      />

                      <input
                        style={overlayStyle(PAGE1_RECT.state)}
                        className={overlayInputCls}
                        value={form.state}
                        onChange={(e) => updateField("state", e.target.value)}
                      />

                      <input
                        style={overlayStyle(PAGE1_RECT.zip)}
                        className={overlayInputCls}
                        value={form.zip}
                        onChange={(e) => updateField("zip", e.target.value)}
                      />

                      <select
                        style={overlayStyle(PAGE1_RECT.branch)}
                        className={`${overlayInputCls} appearance-none`}
                        value={form.branch}
                        onChange={(e) => updateField("branch", e.target.value)}
                      >
                        <option value="">Select…</option>
                        {EMPLOYEE_CONFIDENTIALITY_BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </>
                  )}

                  {!pageLoading && pageNum === 2 && (
                    <>
                      <div style={overlayStyle(PAGE2_RECT.dateSigned)} className="flex items-center font-bold text-[#00008B]">
                        {fmtDateSigned(new Date())}
                      </div>

                      <canvas
                        ref={sigCanvasRef}
                        width={440}
                        height={100}
                        onPointerDown={startDraw}
                        onPointerMove={moveDraw}
                        onPointerUp={endDraw}
                        onPointerLeave={endDraw}
                        className="absolute touch-none cursor-crosshair"
                        style={{
                          left: PAGE2_RECT.signature.x * scale,
                          top: (PAGE_HEIGHT - PAGE2_RECT.signature.y - PAGE2_RECT.signature.h) * scale,
                          width: PAGE2_RECT.signature.w * scale,
                          height: PAGE2_RECT.signature.h * scale,
                        }}
                      />
                    </>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 mt-2 justify-center">
              <button onClick={clearSignature} className="btn text-xs px-3 py-1.5">Clear signature</button>
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
