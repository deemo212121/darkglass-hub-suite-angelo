/**
 * Fill W-4 — opened from the deep link a Team Messenger message sends (see
 * ReportHRDaily.tsx's "W-8/W-9/W-4 Forms" tab "Send W-4 Request" flow).
 * Same architecture as FillW8benPage.tsx: renders the REAL official PDF's
 * pages to canvases via pdf.js, with input overlays at each field's own
 * coordinates — no redrawn lookalike. Submitting fills that same real PDF's
 * own fields via fillW4Pdf and sends the result back to HR.
 *
 * All 5 pages are shown (the recipient may want to check the worksheets
 * while filling in Step 2/3/4), but only 3 have real fillable fields:
 * page 1 (the Employee's Withholding Certificate itself), page 3 (Multiple
 * Jobs Worksheet), and page 4 (Deductions Worksheet). Pages 2 and 5
 * (general instructions / Privacy Act notice) have no fields and render
 * read-only.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import { getSignableDocument, signDocument, type SignableDocument } from "@/lib/supabase/signableDocuments";
import { uploadSignableDocumentSignature, uploadW4Form } from "@/lib/firebase/storage";
import { fillW4Pdf, loadBlankW4Bytes } from "@/lib/w4PdfFill";
import type { W4FilingStatus, W4FormData } from "@/lib/w4FormTemplate";
import { getOrCreateDmThread, sendMessage } from "@/lib/supabase/messaging";
import { logActivity } from "@/lib/supabase/hrActivityLog";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

interface Props {
  docId: string;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

// Field rectangles (PDF user-space units, origin bottom-left), extracted
// via pdf-lib's acroField.getWidgets()[0].getRectangle() on
// src/assets/w4-blank.pdf — the exact numbers w4PdfFill.ts's field mapping
// was derived from, cross-checked against the user's own field-by-page
// breakdown. The signature/date row has no real field (see w4PdfFill.ts's
// header comment) — those coordinates are estimated from the actual
// "Employee's signature"/"Date" caption text positions instead.
const PAGE1_RECT = {
  firstNameMiddleInitial: { x: 95, y: 684, w: 178, h: 14 },
  lastName: { x: 275, y: 684, w: 200, h: 14 },
  ssn: { x: 476, y: 684, w: 100, h: 14 },
  address: { x: 95, y: 660, w: 380, h: 14 },
  cityStateZip: { x: 95, y: 636, w: 380, h: 14 },
  filingSingle: { x: 115, y: 626, w: 10, h: 10 },
  filingMarried: { x: 115, y: 614, w: 10, h: 10 },
  filingHoh: { x: 115, y: 602, w: 10, h: 10 },
  multipleJobs: { x: 563, y: 379, w: 10, h: 10 },
  step3Children: { x: 418, y: 300, w: 64, h: 12 },
  step3OtherDependents: { x: 418, y: 288, w: 64, h: 12 },
  step3Total: { x: 511, y: 264, w: 65, h: 12 },
  step4a: { x: 511, y: 228, w: 65, h: 12 },
  step4b: { x: 511, y: 192, w: 65, h: 12 },
  step4c: { x: 511, y: 174, w: 65, h: 12 },
  exempt: { x: 563, y: 128, w: 10, h: 10 },
  signature: { x: 100, y: 93, w: 340, h: 20 },
  dateSigned: { x: 465, y: 93, w: 110, h: 14 },
} as const;

/** Page 3 — Multiple Jobs Worksheet. */
const MJW_RECT = {
  mjwLine1: { x: 511, y: 588, w: 65, h: 12 },
  mjwLine2a: { x: 511, y: 498, w: 65, h: 12 },
  mjwLine2b: { x: 511, y: 438, w: 65, h: 12 },
  mjwLine2c: { x: 511, y: 414, w: 65, h: 12 },
  mjwLine3: { x: 504, y: 378, w: 72, h: 12 },
  mjwLine4: { x: 511, y: 330, w: 65, h: 12 },
} as const;

/** Page 4 — Deductions Worksheet. */
const DW_RECT = {
  dwLine1a: { x: 511, y: 660, w: 65, h: 12 },
  dwLine1b: { x: 511, y: 624, w: 65, h: 12 },
  dwLine1c: { x: 511, y: 600, w: 65, h: 12 },
  dwLine2: { x: 511, y: 588, w: 65, h: 12 },
  dwLine3a: { x: 511, y: 564, w: 65, h: 12 },
  dwLine3b: { x: 511, y: 540, w: 65, h: 12 },
  dwLine4: { x: 511, y: 528, w: 65, h: 12 },
  dwLine5: { x: 511, y: 492, w: 65, h: 12 },
  dwLine6a: { x: 511, y: 456, w: 65, h: 12 },
  dwLine6b: { x: 511, y: 432, w: 65, h: 12 },
  dwLine6c: { x: 511, y: 396, w: 65, h: 12 },
  dwLine6d: { x: 511, y: 384, w: 65, h: 12 },
  dwLine6e: { x: 511, y: 372, w: 65, h: 12 },
  dwLine7: { x: 511, y: 360, w: 65, h: 12 },
  dwLine8a: { x: 511, y: 336, w: 65, h: 12 },
  dwLine8b: { x: 511, y: 324, w: 65, h: 12 },
  dwLine9: { x: 511, y: 300, w: 65, h: 12 },
  dwLine10: { x: 511, y: 264, w: 65, h: 12 },
  dwLine11: { x: 511, y: 228, w: 65, h: 12 },
  dwLine12: { x: 511, y: 192, w: 65, h: 12 },
  dwLine13: { x: 511, y: 180, w: 65, h: 12 },
  dwLine14: { x: 511, y: 156, w: 65, h: 12 },
  dwLine15: { x: 511, y: 144, w: 65, h: 12 },
} as const;

// Kept tight: "Under penalties of perjury..." sits right above this row at
// y=116.3 (text baseline), and the "Employee's signature" caption is at
// y=81.7 — a real signature stroke can reach the top of a taller box and
// visually collide with that perjury text, so this stays modest.
const SIG_EXTRA_HEIGHT = 0;

const fmtDateSigned = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${d.getFullYear()}`;

const BLANK_FORM: W4FormData = {
  employeeId: "",
  firstNameMiddleInitial: "",
  lastName: "",
  ssn: "",
  address: "",
  cityStateZip: "",
  filingStatus: "",
  multipleJobsCheckbox: false,
  step3ChildrenAmount: "",
  step3OtherDependentsAmount: "",
  step3TotalAmount: "",
  step4aOtherIncome: "",
  step4bDeductions: "",
  step4cExtraWithholding: "",
  exemptCheckbox: false,
  dateSigned: "",
  signatureDataUrl: "",
  employerNameAndAddress: "",
  employerFirstDateOfEmployment: "",
  employerEin: "",
  mjwLine1: "",
  mjwLine2a: "",
  mjwLine2b: "",
  mjwLine2c: "",
  mjwLine3: "",
  mjwLine4: "",
  dwLine1a: "",
  dwLine1b: "",
  dwLine1c: "",
  dwLine2: "",
  dwLine3a: "",
  dwLine3b: "",
  dwLine4: "",
  dwLine5: "",
  dwLine6a: "",
  dwLine6b: "",
  dwLine6c: "",
  dwLine6d: "",
  dwLine6e: "",
  dwLine7: "",
  dwLine8a: "",
  dwLine8b: "",
  dwLine9: "",
  dwLine10: "",
  dwLine11: "",
  dwLine12: "",
  dwLine13: "",
  dwLine14: "",
  dwLine15: "",
};

export function FillW4Page({ docId }: Props) {
  const { ready, uid, displayName, role } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [doc, setDoc] = useState<SignableDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [pageLoading, setPageLoading] = useState(true);
  const [scale, setScale] = useState(1.3);
  const [numPages, setNumPages] = useState(0);
  const pdfDocRef = useRef<any>(null);
  const pageCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);

  const [form, setForm] = useState<W4FormData>({ ...BLANK_FORM });

  const sigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const hasDrawnRef = useRef(false);

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
        if (!document || document.documentType !== "w4") {
          setError("This document doesn't exist or has been removed.");
        } else {
          setDoc(document);
          const existing = document.formData as Partial<W4FormData>;
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

  // Load the PDF document once (separate from rendering, since we need to
  // know numPages before the per-page <canvas> elements exist in the DOM).
  useEffect(() => {
    if (loading || error || submitted) return;
    let cancelled = false;
    (async () => {
      try {
        const [pdfjsLib, bytes] = await Promise.all([import("pdfjs-dist"), loadBlankW4Bytes()]);
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

  // Render every page once numPages (and so the canvas elements) exist.
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

  const updateField = <K extends keyof W4FormData>(key: K, value: W4FormData[K]) => setForm((f) => ({ ...f, [key]: value }));

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
    if (!form.firstNameMiddleInitial.trim() || !form.lastName.trim()) return "Enter your name.";
    if (!form.ssn.trim()) return "Enter your Social Security number.";
    if (!form.address.trim() || !form.cityStateZip.trim()) return "Fill in your address.";
    if (!form.filingStatus) return "Select a filing status.";
    if (!hasDrawnRef.current) return "Please draw your signature.";
    return null;
  };

  const handleSubmit = async () => {
    if (!doc || !myProfileId || !sigCanvasRef.current) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const companyId = doc.companyId;
      const dataUrl = sigCanvasRef.current.toDataURL("image/png");
      const sigBytes = new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
      const signatureUrl = await uploadSignableDocumentSignature(companyId, doc.id, "employee", dataUrl);
      const signedAt = new Date().toISOString();
      // signatureDataUrl (the raw canvas PNG) is stored alongside the
      // durable Firebase Storage URL so HR's later "Fill Employer Info"
      // regeneration can redraw the signature without a cross-origin fetch
      // — see w4FormTemplate.ts's header comment.
      const finalData: W4FormData = { ...form, dateSigned: signedAt, signatureDataUrl: dataUrl };
      const entry = { name: displayName || `${form.firstNameMiddleInitial} ${form.lastName}`.trim() || "Signed", url: signatureUrl, signedAt };

      const pdfBytes = await fillW4Pdf(finalData, sigBytes);
      const pdfUrl = await uploadW4Form(companyId, `${finalData.firstNameMiddleInitial} ${finalData.lastName}`.trim(), new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" }));

      await signDocument(doc.id, "employee", entry, pdfUrl, finalData as unknown as Record<string, any>);

      if (doc.createdBy) {
        const thread = await getOrCreateDmThread(myProfileId, doc.createdBy);
        const employeeName = `${finalData.firstNameMiddleInitial} ${finalData.lastName}`.trim();
        const filename = `W-4 - ${employeeName}.pdf`;
        await sendMessage({
          dmThreadId: thread.id,
          senderId: myProfileId,
          senderName: displayName || "Employee",
          body: `📄 W-4 form for ${employeeName} has been completed and submitted: [${filename}](${pdfUrl})`,
        });
      }

      setDoc({ ...doc, status: "signed", pdfUrl, formData: finalData as unknown as Record<string, any>, signatures: { employee: entry }, signedAt });
      void logActivity({ action: "w4_form_signed", targetType: "employee", targetLabel: `${finalData.firstNameMiddleInitial} ${finalData.lastName}`.trim() });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit form.");
    } finally {
      setSubmitting(false);
    }
  };

  const isRecipient = !!doc && !!myProfileId && doc.recipientId === myProfileId;
  const isSuperadmin = role === "SUPERADMIN";

  const overlayStyle = (r: { x: number; y: number; w: number; h: number }): React.CSSProperties => ({
    position: "absolute",
    left: r.x * scale,
    top: (PAGE_HEIGHT - r.y - r.h) * scale,
    width: r.w * scale,
    height: r.h * scale,
    fontSize: `${7 * scale}px`,
  });

  const overlayInputCls = "bg-transparent border-none outline-none p-0 font-bold font-sans text-[#00008B] focus:bg-blue-50/40";
  const checkboxCls = "border border-black/60 bg-transparent flex items-center justify-center leading-none text-[#00008B] font-bold";

  const setFilingStatus = (status: W4FilingStatus) => updateField("filingStatus", form.filingStatus === status ? "" : status);

  const singleLineInput = (field: keyof W4FormData, rect: { x: number; y: number; w: number; h: number }) => (
    <input
      key={field}
      style={overlayStyle(rect)}
      className={overlayInputCls}
      value={form[field] as string}
      onChange={(e) => updateField(field, e.target.value as W4FormData[typeof field])}
    />
  );

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
        ) : submitted || doc.status === "signed" ? (
          <div className="panel p-6 text-center">
            <p className="text-sm font-semibold mb-2">✅ Submitted{submitted ? " and sent back to HR" : ""}.</p>
            {doc.pdfUrl && (
              <a href={doc.pdfUrl} target="_blank" rel="noreferrer noopener" className="text-blue-300 hover:text-blue-200 underline text-sm">
                View the completed PDF
              </a>
            )}
          </div>
        ) : (
          <div className="panel p-4">
            <p className="text-xs text-muted-foreground mb-3">
              Fill in your information directly on the form below, draw your signature, then submit. Steps 2-4 only apply if relevant to you — the Multiple Jobs Worksheet (page 3) and Deductions Worksheet (page 4) are shown for reference and are only fillable if you're using them.
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
                      {singleLineInput("firstNameMiddleInitial", PAGE1_RECT.firstNameMiddleInitial)}
                      {singleLineInput("lastName", PAGE1_RECT.lastName)}
                      {singleLineInput("ssn", PAGE1_RECT.ssn)}
                      {singleLineInput("address", PAGE1_RECT.address)}
                      {singleLineInput("cityStateZip", PAGE1_RECT.cityStateZip)}

                      <button type="button" style={overlayStyle(PAGE1_RECT.filingSingle)} onClick={() => setFilingStatus("single_or_mfs")} className={checkboxCls}>{form.filingStatus === "single_or_mfs" ? "✔" : ""}</button>
                      <button type="button" style={overlayStyle(PAGE1_RECT.filingMarried)} onClick={() => setFilingStatus("married_filing_jointly")} className={checkboxCls}>{form.filingStatus === "married_filing_jointly" ? "✔" : ""}</button>
                      <button type="button" style={overlayStyle(PAGE1_RECT.filingHoh)} onClick={() => setFilingStatus("head_of_household")} className={checkboxCls}>{form.filingStatus === "head_of_household" ? "✔" : ""}</button>

                      <button type="button" style={overlayStyle(PAGE1_RECT.multipleJobs)} onClick={() => updateField("multipleJobsCheckbox", !form.multipleJobsCheckbox)} className={checkboxCls}>{form.multipleJobsCheckbox ? "✔" : ""}</button>

                      {singleLineInput("step3ChildrenAmount", PAGE1_RECT.step3Children)}
                      {singleLineInput("step3OtherDependentsAmount", PAGE1_RECT.step3OtherDependents)}
                      {singleLineInput("step3TotalAmount", PAGE1_RECT.step3Total)}

                      {singleLineInput("step4aOtherIncome", PAGE1_RECT.step4a)}
                      {singleLineInput("step4bDeductions", PAGE1_RECT.step4b)}
                      {singleLineInput("step4cExtraWithholding", PAGE1_RECT.step4c)}

                      <button type="button" style={overlayStyle(PAGE1_RECT.exempt)} onClick={() => updateField("exemptCheckbox", !form.exemptCheckbox)} className={checkboxCls}>{form.exemptCheckbox ? "✔" : ""}</button>

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
                          left: PAGE1_RECT.signature.x * scale,
                          top: (PAGE_HEIGHT - PAGE1_RECT.signature.y - PAGE1_RECT.signature.h - SIG_EXTRA_HEIGHT) * scale,
                          width: PAGE1_RECT.signature.w * scale,
                          height: (PAGE1_RECT.signature.h + SIG_EXTRA_HEIGHT) * scale,
                        }}
                      />
                      <div style={overlayStyle(PAGE1_RECT.dateSigned)} className="flex items-end justify-center font-bold text-[#00008B]">
                        {fmtDateSigned(new Date())}
                      </div>
                    </>
                  )}

                  {!pageLoading && pageNum === 3 && (
                    <>
                      {singleLineInput("mjwLine1", MJW_RECT.mjwLine1)}
                      {singleLineInput("mjwLine2a", MJW_RECT.mjwLine2a)}
                      {singleLineInput("mjwLine2b", MJW_RECT.mjwLine2b)}
                      {singleLineInput("mjwLine2c", MJW_RECT.mjwLine2c)}
                      {singleLineInput("mjwLine3", MJW_RECT.mjwLine3)}
                      {singleLineInput("mjwLine4", MJW_RECT.mjwLine4)}
                    </>
                  )}

                  {!pageLoading && pageNum === 4 && (
                    <>
                      {singleLineInput("dwLine1a", DW_RECT.dwLine1a)}
                      {singleLineInput("dwLine1b", DW_RECT.dwLine1b)}
                      {singleLineInput("dwLine1c", DW_RECT.dwLine1c)}
                      {singleLineInput("dwLine2", DW_RECT.dwLine2)}
                      {singleLineInput("dwLine3a", DW_RECT.dwLine3a)}
                      {singleLineInput("dwLine3b", DW_RECT.dwLine3b)}
                      {singleLineInput("dwLine4", DW_RECT.dwLine4)}
                      {singleLineInput("dwLine5", DW_RECT.dwLine5)}
                      {singleLineInput("dwLine6a", DW_RECT.dwLine6a)}
                      {singleLineInput("dwLine6b", DW_RECT.dwLine6b)}
                      {singleLineInput("dwLine6c", DW_RECT.dwLine6c)}
                      {singleLineInput("dwLine6d", DW_RECT.dwLine6d)}
                      {singleLineInput("dwLine6e", DW_RECT.dwLine6e)}
                      {singleLineInput("dwLine7", DW_RECT.dwLine7)}
                      {singleLineInput("dwLine8a", DW_RECT.dwLine8a)}
                      {singleLineInput("dwLine8b", DW_RECT.dwLine8b)}
                      {singleLineInput("dwLine9", DW_RECT.dwLine9)}
                      {singleLineInput("dwLine10", DW_RECT.dwLine10)}
                      {singleLineInput("dwLine11", DW_RECT.dwLine11)}
                      {singleLineInput("dwLine12", DW_RECT.dwLine12)}
                      {singleLineInput("dwLine13", DW_RECT.dwLine13)}
                      {singleLineInput("dwLine14", DW_RECT.dwLine14)}
                      {singleLineInput("dwLine15", DW_RECT.dwLine15)}
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
              {submitting ? "Submitting…" : "Submit to HR"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
