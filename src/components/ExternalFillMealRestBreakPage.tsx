/**
 * External Fill Employee Meal and Rest Break Policy Acknowledgment — the
 * no-login counterpart to FillMealRestBreakPage.tsx, opened from the link
 * ReportHRDaily.tsx's "Send Request" panel generates when HR picks
 * "External Link" instead of an AHS teammate. No AHS account needed: talks
 * only to /api/signable-documents (see externalSignableDocuments.ts /
 * signableDocumentsBridge.ts), which only ever serves/accepts documents
 * that have no linked AHS profile (recipient_id IS NULL).
 *
 * Same real-PDF overlay rendering as FillMealRestBreakPage.tsx (identical
 * field rects). The PDF is built entirely client-side via the same pure
 * fillMealRestBreakPdf used by the logged-in flow, then POSTed
 * already-finished to the server bridge, which uploads it and notifies HR
 * — no DM step here since there's no sender profile.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import logo from "@/assets/Admin Hub Solutions Logo no Text.png";
import { getExternalSignableDocument, submitExternalSignature, type ExternalSignableDocument } from "@/lib/supabase/externalSignableDocuments";
import { fillMealRestBreakPdf, loadBlankMealRestBreakBytes } from "@/lib/mealRestBreakPdfFill";
import { MEAL_REST_BREAK_BRANCHES, type MealRestBreakFormData } from "@/lib/mealRestBreakFormTemplate";
import { dateBlankPositions } from "@/lib/pdfDateBlankSplit";
import { useSignaturePad } from "@/hooks/useSignaturePad";
import { useResponsivePdfScale } from "@/hooks/useResponsivePdfScale";
import { SignaturePadControls } from "@/components/SignaturePad";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

interface Props {
  docId: string;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

// Same field rectangles as FillMealRestBreakPage.tsx — see that file's
// header comment for how these were derived.
const EMPLOYEE_DATE_X = dateBlankPositions(101.57);

const PAGE_RECT = {
  firstName: { x: 218, y: 668, w: 99, h: 14 },
  middleName: { x: 390, y: 668, w: 99, h: 14 },
  lastName: { x: 100, y: 650, w: 99, h: 14 },
  branch: { x: 110, y: 626, w: 260, h: 14 },
  signature: { x: 174, y: 264, w: 260, h: 20 },
  dateSignedMM: { x: EMPLOYEE_DATE_X.mm, y: 240, w: 30, h: 13 },
  dateSignedDD: { x: EMPLOYEE_DATE_X.dd, y: 240, w: 30, h: 13 },
  dateSignedYYYY: { x: EMPLOYEE_DATE_X.yyyy, y: 240, w: 50, h: 13 },
} as const;

const fmtDateSignedParts = (d: Date) => ({
  mm: String(d.getMonth() + 1).padStart(2, "0"),
  dd: String(d.getDate()).padStart(2, "0"),
  yyyy: String(d.getFullYear()),
});

const BLANK_FORM: MealRestBreakFormData = {
  employeeId: "",
  employeeName: "",
  firstName: "",
  middleName: "",
  lastName: "",
  branch: "",
  employeeDateSigned: "",
  employeeSignatureDataUrl: "",
  employerDateSigned: "",
  employerSignatureDataUrl: "",
};

export function ExternalFillMealRestBreakPage({ docId }: Props) {
  const [doc, setDoc] = useState<ExternalSignableDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedPdfUrl, setSubmittedPdfUrl] = useState<string | null>(null);

  const [pageLoading, setPageLoading] = useState(true);
  const { scale, containerRef } = useResponsivePdfScale(PAGE_WIDTH);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [form, setForm] = useState<MealRestBreakFormData>({ ...BLANK_FORM });

  const sigPad = useSignaturePad({ width: 440, height: 100 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const document = await getExternalSignableDocument(docId);
        if (cancelled) return;
        if (!document || document.documentType !== "meal_rest_break") {
          setError("This link isn't valid, or the document doesn't use link-based signing.");
        } else {
          setDoc(document);
          const existing = document.formData as Partial<MealRestBreakFormData>;
          setForm((prev) => ({ ...prev, ...existing }));
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
        const [pdfjsLib, bytes] = await Promise.all([import("pdfjs-dist"), loadBlankMealRestBreakBytes()]);
        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
        if (cancelled) return;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
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

  const updateField = <K extends keyof MealRestBreakFormData>(key: K, value: MealRestBreakFormData[K]) => setForm((f) => ({ ...f, [key]: value }));

  const validate = (): string | null => {
    if (!form.firstName.trim()) return "Enter your first name.";
    if (!form.lastName.trim()) return "Enter your last name.";
    if (!form.branch) return "Select your branch.";
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
      const employeeName = [form.firstName, form.middleName, form.lastName].filter(Boolean).join(" ");
      const signatureBlob = await (await fetch(dataUrl)).blob();
      const signedAt = new Date().toISOString();
      const finalData: MealRestBreakFormData = { ...form, employeeName, employeeDateSigned: signedAt, employeeSignatureDataUrl: dataUrl };

      const sigBytes = new Uint8Array(await signatureBlob.arrayBuffer());
      const pdfBytes = await fillMealRestBreakPdf(finalData, sigBytes);
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
  const todayParts = fmtDateSignedParts(new Date());

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
            <p className="text-xs text-muted-foreground mb-2">HR will add the employer signature separately.</p>
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
              Read the break policy below, fill in your name and branch, add your signature, then submit.
            </p>

            <div ref={containerRef} className="overflow-x-auto flex flex-col items-center bg-white/5 rounded-md p-4 gap-4">
              <div className="relative bg-white shadow-lg" style={{ width: PAGE_WIDTH * scale, height: PAGE_HEIGHT * scale }}>
                <canvas ref={canvasRef} className="absolute inset-0" />
                {pageLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm text-muted-foreground gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading form…
                  </div>
                )}

                {!pageLoading && (
                  <>
                    <input
                      style={overlayStyle(PAGE_RECT.firstName)}
                      className={overlayInputCls}
                      value={form.firstName}
                      onChange={(e) => updateField("firstName", e.target.value)}
                    />
                    <input
                      style={overlayStyle(PAGE_RECT.middleName)}
                      className={overlayInputCls}
                      value={form.middleName}
                      onChange={(e) => updateField("middleName", e.target.value)}
                    />
                    <input
                      style={overlayStyle(PAGE_RECT.lastName)}
                      className={overlayInputCls}
                      value={form.lastName}
                      onChange={(e) => updateField("lastName", e.target.value)}
                    />

                    <select
                      style={overlayStyle(PAGE_RECT.branch)}
                      className={`${overlayInputCls} appearance-none`}
                      value={form.branch}
                      onChange={(e) => updateField("branch", e.target.value)}
                    >
                      <option value="">Select…</option>
                      {MEAL_REST_BREAK_BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>

                    <canvas
                      {...sigPad.canvasProps}
                      style={{
                        position: "absolute",
                        left: PAGE_RECT.signature.x * scale,
                        top: (PAGE_HEIGHT - PAGE_RECT.signature.y - PAGE_RECT.signature.h) * scale,
                        width: PAGE_RECT.signature.w * scale,
                        height: PAGE_RECT.signature.h * scale,
                      }}
                    />

                    <div style={overlayStyle(PAGE_RECT.dateSignedMM)} className="flex items-center font-bold text-[#00008B]">{todayParts.mm}</div>
                    <div style={overlayStyle(PAGE_RECT.dateSignedDD)} className="flex items-center font-bold text-[#00008B]">{todayParts.dd}</div>
                    <div style={overlayStyle(PAGE_RECT.dateSignedYYYY)} className="flex items-center font-bold text-[#00008B]">{todayParts.yyyy}</div>
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
