/**
 * Fill W-9 — opened from the deep link a Team Messenger message sends (see
 * ReportHRDaily.tsx's "W-8/W-9/W-4 Forms" tab "Send W-9 Request" flow).
 * Same architecture as FillW4Page.tsx: renders the REAL official PDF's
 * pages to canvases via pdf.js, with input overlays at each field's own
 * coordinates on page 1 (the only page with real fields) — no redrawn
 * lookalike. Submitting fills that same real PDF's own fields via
 * fillW9Pdf and sends the result back to HR. All 6 pages are shown so the
 * person filling it in can reference the IRS's own instructions (pages
 * 2-6 have no fields and render read-only).
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import { getSignableDocument, signDocument, type SignableDocument } from "@/lib/supabase/signableDocuments";
import { uploadSignableDocumentSignature, uploadW9Form } from "@/lib/firebase/storage";
import { fillW9Pdf, loadBlankW9Bytes } from "@/lib/w9PdfFill";
import type { W9FormData, W9TaxClassification } from "@/lib/w9FormTemplate";
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
// src/assets/w9-blank.pdf page 1 — the exact numbers w9PdfFill.ts's field
// mapping was derived from. The signature/date row has no real field (see
// w9PdfFill.ts's header comment) — those coordinates are estimated from
// the actual "Signature of / U.S. person"/"Date" caption text positions.
const RECT = {
  name: { x: 59, y: 660, w: 517, h: 14 },
  businessName: { x: 59, y: 636, w: 517, h: 14 },
  classIndividual: { x: 73, y: 604, w: 10, h: 10 },
  classCCorp: { x: 180, y: 604, w: 10, h: 10 },
  classSCorp: { x: 252, y: 604, w: 10, h: 10 },
  classPartnership: { x: 324, y: 604, w: 10, h: 10 },
  classTrustEstate: { x: 389, y: 604, w: 10, h: 10 },
  classLlc: { x: 73, y: 590, w: 10, h: 10 },
  llcCode: { x: 418, y: 589, w: 29, h: 11 },
  classOther: { x: 73, y: 554, w: 10, h: 10 },
  otherText: { x: 162, y: 552, w: 284, h: 12 },
  exemptPayeeCode: { x: 544, y: 588, w: 32, h: 12 },
  fatcaCode: { x: 501, y: 552, w: 75, h: 12 },
  foreignPartners: { x: 441, y: 521, w: 10, h: 10 },
  requesterNameAddress: { x: 390, y: 468, w: 186, h: 38 },
  address: { x: 59, y: 492, w: 329, h: 14 },
  cityStateZip: { x: 59, y: 468, w: 329, h: 14 },
  accountNumbers: { x: 59, y: 444, w: 517, h: 14 },
  ssnPart1: { x: 418, y: 396, w: 43, h: 24 },
  ssnPart2: { x: 475, y: 396, w: 29, h: 24 },
  ssnPart3: { x: 518, y: 396, w: 58, h: 24 },
  einPart1: { x: 418, y: 348, w: 29, h: 24 },
  einPart2: { x: 461, y: 348, w: 101, h: 24 },
  signature: { x: 160, y: 198, w: 210, h: 16 },
  dateSigned: { x: 420, y: 198, w: 140, h: 14 },
} as const;

const SIG_EXTRA_HEIGHT = 0;

const fmtDateSigned = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${d.getFullYear()}`;

const BLANK_FORM: W9FormData = {
  employeeId: "",
  name: "",
  businessName: "",
  taxClassification: "",
  llcTaxClassificationCode: "",
  otherClassificationText: "",
  foreignPartnersCheckbox: false,
  exemptPayeeCode: "",
  fatcaExemptionCode: "",
  address: "",
  cityStateZip: "",
  accountNumbers: "",
  requesterNameAddress: "",
  ssnPart1: "",
  ssnPart2: "",
  ssnPart3: "",
  einPart1: "",
  einPart2: "",
  dateSigned: "",
  signatureDataUrl: "",
};

export function FillW9Page({ docId }: Props) {
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

  const [form, setForm] = useState<W9FormData>({ ...BLANK_FORM });

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
        if (!document || document.documentType !== "w9") {
          setError("This document doesn't exist or has been removed.");
        } else {
          setDoc(document);
          const existing = document.formData as Partial<W9FormData>;
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
        const [pdfjsLib, bytes] = await Promise.all([import("pdfjs-dist"), loadBlankW9Bytes()]);
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

  const updateField = <K extends keyof W9FormData>(key: K, value: W9FormData[K]) => setForm((f) => ({ ...f, [key]: value }));

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
    if (!form.name.trim()) return "Enter your name.";
    if (!form.taxClassification) return "Select a federal tax classification.";
    if (form.taxClassification === "llc" && !form.llcTaxClassificationCode.trim()) return "Enter the LLC's tax classification code (C, S, or P).";
    if (!form.address.trim() || !form.cityStateZip.trim()) return "Fill in your address.";
    if (!form.ssnPart1.trim() && !form.einPart1.trim()) return "Enter either your SSN or EIN.";
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
      const finalData: W9FormData = { ...form, dateSigned: signedAt, signatureDataUrl: dataUrl };
      const entry = { name: displayName || form.name || "Signed", url: signatureUrl, signedAt };

      const pdfBytes = await fillW9Pdf(finalData, sigBytes);
      const pdfUrl = await uploadW9Form(companyId, finalData.name, new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" }));

      await signDocument(doc.id, "employee", entry, pdfUrl, finalData as unknown as Record<string, any>);

      if (doc.createdBy) {
        const thread = await getOrCreateDmThread(myProfileId, doc.createdBy);
        const filename = `W-9 - ${finalData.name}.pdf`;
        await sendMessage({
          dmThreadId: thread.id,
          senderId: myProfileId,
          senderName: displayName || "Employee",
          body: `📄 W-9 form for ${finalData.name} has been completed and submitted: [${filename}](${pdfUrl})`,
        });
      }

      setDoc({ ...doc, status: "signed", pdfUrl, formData: finalData as unknown as Record<string, any>, signatures: { employee: entry }, signedAt });
      void logActivity({ action: "w9_form_signed", targetType: "employee", targetLabel: finalData.name });
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

  const setClassification = (c: W9TaxClassification) => updateField("taxClassification", form.taxClassification === c ? "" : c);

  const singleLineInput = (field: keyof W9FormData, rect: { x: number; y: number; w: number; h: number }, disabled?: boolean) => (
    <input
      key={field}
      style={overlayStyle(rect)}
      className={overlayInputCls}
      disabled={disabled}
      value={form[field] as string}
      onChange={(e) => updateField(field, e.target.value as W9FormData[typeof field])}
    />
  );

  const textAreaInput = (field: keyof W9FormData, rect: { x: number; y: number; w: number; h: number }) => (
    <textarea
      key={field}
      style={overlayStyle(rect)}
      className={`${overlayInputCls} resize-none`}
      value={form[field] as string}
      onChange={(e) => updateField(field, e.target.value as W9FormData[typeof field])}
    />
  );

  /** Individual per-character boxes (SSN/EIN) matching the printed grid, so each digit lines up with its own printed cell instead of bunching left in one wide field. */
  const digitBoxRefs = useRef<Record<string, (HTMLInputElement | null)[]>>({});
  const digitBoxes = (field: keyof W9FormData, rect: { x: number; y: number; w: number; h: number }, length: number) => {
    const value = (form[field] as string) || "";
    const chars = Array.from({ length }, (_, i) => value[i] ?? "");
    if (!digitBoxRefs.current[field]) digitBoxRefs.current[field] = [];
    const boxWidth = rect.w / length;
    return (
      <div key={field} style={{ ...overlayStyle(rect), display: "flex" }}>
        {chars.map((ch, i) => (
          <input
            key={i}
            ref={(el) => { digitBoxRefs.current[field][i] = el; }}
            value={ch}
            maxLength={1}
            inputMode="numeric"
            style={{ width: boxWidth * scale }}
            className={`${overlayInputCls} text-center`}
            onChange={(e) => {
              const next = e.target.value.replace(/[^0-9]/g, "").slice(-1);
              const newChars = [...chars];
              newChars[i] = next;
              updateField(field, newChars.join("") as W9FormData[typeof field]);
              if (next && i < length - 1) digitBoxRefs.current[field][i + 1]?.focus();
            }}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !chars[i] && i > 0) digitBoxRefs.current[field][i - 1]?.focus();
            }}
          />
        ))}
      </div>
    );
  };

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
            <p className="text-xs text-muted-foreground mb-3">Fill in your information directly on the form below, draw your signature, then submit. Enter either your SSN or EIN, whichever applies.</p>

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
                      {singleLineInput("name", RECT.name)}
                      {singleLineInput("businessName", RECT.businessName)}

                      <button type="button" style={overlayStyle(RECT.classIndividual)} onClick={() => setClassification("individual")} className={checkboxCls}>{form.taxClassification === "individual" ? "✔" : ""}</button>
                      <button type="button" style={overlayStyle(RECT.classCCorp)} onClick={() => setClassification("c_corp")} className={checkboxCls}>{form.taxClassification === "c_corp" ? "✔" : ""}</button>
                      <button type="button" style={overlayStyle(RECT.classSCorp)} onClick={() => setClassification("s_corp")} className={checkboxCls}>{form.taxClassification === "s_corp" ? "✔" : ""}</button>
                      <button type="button" style={overlayStyle(RECT.classPartnership)} onClick={() => setClassification("partnership")} className={checkboxCls}>{form.taxClassification === "partnership" ? "✔" : ""}</button>
                      <button type="button" style={overlayStyle(RECT.classTrustEstate)} onClick={() => setClassification("trust_estate")} className={checkboxCls}>{form.taxClassification === "trust_estate" ? "✔" : ""}</button>
                      <button type="button" style={overlayStyle(RECT.classLlc)} onClick={() => setClassification("llc")} className={checkboxCls}>{form.taxClassification === "llc" ? "✔" : ""}</button>
                      {singleLineInput("llcTaxClassificationCode", RECT.llcCode, form.taxClassification !== "llc")}
                      <button type="button" style={overlayStyle(RECT.classOther)} onClick={() => setClassification("other")} className={checkboxCls}>{form.taxClassification === "other" ? "✔" : ""}</button>
                      {singleLineInput("otherClassificationText", RECT.otherText, form.taxClassification !== "other")}

                      {singleLineInput("exemptPayeeCode", RECT.exemptPayeeCode)}
                      {singleLineInput("fatcaExemptionCode", RECT.fatcaCode)}

                      <button type="button" style={overlayStyle(RECT.foreignPartners)} onClick={() => updateField("foreignPartnersCheckbox", !form.foreignPartnersCheckbox)} className={checkboxCls}>{form.foreignPartnersCheckbox ? "✔" : ""}</button>

                      {singleLineInput("address", RECT.address)}
                      {singleLineInput("cityStateZip", RECT.cityStateZip)}
                      {singleLineInput("accountNumbers", RECT.accountNumbers)}
                      {textAreaInput("requesterNameAddress", RECT.requesterNameAddress)}

                      {digitBoxes("ssnPart1", RECT.ssnPart1, 3)}
                      {digitBoxes("ssnPart2", RECT.ssnPart2, 2)}
                      {digitBoxes("ssnPart3", RECT.ssnPart3, 4)}
                      {digitBoxes("einPart1", RECT.einPart1, 2)}
                      {digitBoxes("einPart2", RECT.einPart2, 7)}

                      <canvas
                        ref={sigCanvasRef}
                        width={420}
                        height={80}
                        onPointerDown={startDraw}
                        onPointerMove={moveDraw}
                        onPointerUp={endDraw}
                        onPointerLeave={endDraw}
                        className="absolute touch-none cursor-crosshair"
                        style={{
                          left: RECT.signature.x * scale,
                          top: (PAGE_HEIGHT - RECT.signature.y - RECT.signature.h - SIG_EXTRA_HEIGHT) * scale,
                          width: RECT.signature.w * scale,
                          height: (RECT.signature.h + SIG_EXTRA_HEIGHT) * scale,
                        }}
                      />
                      <div style={overlayStyle(RECT.dateSigned)} className="flex items-end justify-center font-bold text-[#00008B]">
                        {fmtDateSigned(new Date())}
                      </div>
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
