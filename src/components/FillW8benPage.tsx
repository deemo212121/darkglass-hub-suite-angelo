/**
 * Fill W-8BEN — opened from the deep link a Team Messenger message sends
 * (see ReportHRDaily.tsx's "W-8/W-9/W-4 Forms" tab "Send W-8BEN Request"
 * flow). HR doesn't pre-fill this document — the recipient fills in their
 * own Part I identification fields, certifies, and signs. Part II (Claim of
 * Tax Treaty Benefits) is left entirely blank, same as the rest of the
 * unfilled form.
 *
 * This renders the REAL official PDF's own page 1 to a <canvas> via pdf.js
 * (not a redrawn approximation), then overlays real <input> elements at
 * each field's own coordinates — extracted directly from the PDF's own
 * AcroForm widget rectangles (see w8benPdfFill.ts's field mapping, derived
 * the same way). Typing there looks like typing directly into the actual
 * form because the background IS the actual form. Submitting flattens the
 * collected values into that same real PDF's own fields via fillW8benPdf
 * and sends the result back to HR.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import { getSignableDocument, signDocument, type SignableDocument } from "@/lib/supabase/signableDocuments";
import { uploadSignableDocumentSignature, uploadW8benForm } from "@/lib/firebase/storage";
import { fillW8benPdf, loadBlankW8benBytes } from "@/lib/w8benPdfFill";
import type { W8benAddress, W8benFormData } from "@/lib/w8benFormTemplate";
import { getOrCreateDmThread, sendMessage } from "@/lib/supabase/messaging";
import { logActivity } from "@/lib/supabase/hrActivityLog";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

interface Props {
  docId: string;
}

const BLANK_ADDRESS: W8benAddress = { street: "", cityStateZip: "", country: "" };

// PDF page size + every field's own rectangle (PDF user-space units, origin
// bottom-left), extracted via pdf-lib's acroField.getWidgets()[0]
// .getRectangle() on src/assets/w8ben-blank.pdf — the exact same numbers
// w8benPdfFill.ts's field mapping was derived from.
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

/** Extra room (PDF units) the signature drawing canvas extends upward beyond its nominal field box, so a real hand signature has space while still sitting on the real line. */
const SIG_EXTRA_HEIGHT = 16;

/** MM-DD-YYYY — matches both the field's own label and fillW8benPdf's fmtDate, unlike toLocaleDateString's MM/DD/YYYY slashes. */
const fmtDateSigned = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${d.getFullYear()}`;

export function FillW8benPage({ docId }: Props) {
  const { ready, uid, displayName, role } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [doc, setDoc] = useState<SignableDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [pageLoading, setPageLoading] = useState(true);
  const [scale, setScale] = useState(1.3);
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
        if (!document || document.documentType !== "w8ben") {
          setError("This document doesn't exist or has been removed.");
        } else {
          setDoc(document);
          const existing = document.formData as Partial<W8benFormData>;
          setForm((prev) => ({
            ...prev,
            ...existing,
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
  }, [ready, uid, docId]);

  // Render the real PDF's page 1 onto a <canvas> — this is the visual
  // background the input overlays sit on top of, not a redrawn lookalike.
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
    if (!form.employeeName.trim()) return "Enter the beneficial owner's name.";
    if (!form.countryOfCitizenship.trim()) return "Enter your country of citizenship.";
    if (!form.permanentAddress.street.trim() || !form.permanentAddress.cityStateZip.trim() || !form.permanentAddress.country.trim()) return "Fill in your permanent residence address.";
    if (!form.dateOfBirth.trim()) return "Enter your date of birth.";
    if (!form.certifiedTrue) return "You must check the certification statement.";
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
      const finalData: W8benFormData = { ...form, dateSigned: signedAt };
      const entry = { name: displayName || form.employeeName || "Signed", url: signatureUrl, signedAt };

      // The stored document is the real official PDF's own fields, filled
      // in via pdf-lib (see w8benPdfFill.ts) — never a redrawn lookalike.
      const pdfBytes = await fillW8benPdf(finalData, sigBytes);
      const pdfUrl = await uploadW8benForm(companyId, finalData.employeeName, new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" }));

      // form_data on the doc was just the near-empty shell HR created when
      // sending the request — persist what the recipient actually filled in.
      await signDocument(doc.id, "employee", entry, pdfUrl, finalData as unknown as Record<string, any>);

      if (doc.createdBy) {
        const thread = await getOrCreateDmThread(myProfileId, doc.createdBy);
        const filename = `W-8BEN - ${finalData.employeeName}.pdf`;
        await sendMessage({
          dmThreadId: thread.id,
          senderId: myProfileId,
          senderName: displayName || "Employee",
          body: `📄 W-8BEN form for ${finalData.employeeName} has been completed and submitted: [${filename}](${pdfUrl})`,
        });
      }

      setDoc({ ...doc, status: "signed", pdfUrl, formData: finalData as unknown as Record<string, any>, signatures: { employee: entry }, signedAt });
      void logActivity({ action: "w8ben_form_signed", targetType: "employee", targetLabel: finalData.employeeName });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit form.");
    } finally {
      setSubmitting(false);
    }
  };

  const isRecipient = !!doc && !!myProfileId && doc.recipientId === myProfileId;
  const isSuperadmin = role === "SUPERADMIN";

  /** PDF bottom-left-origin rect → CSS top-left-origin absolute position, at the current display scale. */
  const overlayStyle = (r: { x: number; y: number; w: number; h: number }): React.CSSProperties => ({
    position: "absolute",
    left: r.x * scale,
    top: (PAGE_HEIGHT - r.y - r.h) * scale,
    width: r.w * scale,
    height: r.h * scale,
    fontSize: `${7 * scale}px`,
  });

  const overlayInputCls =
    "bg-transparent border-none outline-none p-0 font-bold font-sans text-[#00008B] focus:bg-blue-50/40";

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
            <p className="text-xs text-muted-foreground mb-3">Fill in your information directly on the form below, draw your signature, then submit.</p>

            <div className="overflow-x-auto flex justify-center bg-white/5 rounded-md p-4">
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
                      className="border border-black/60 bg-transparent flex items-center justify-center leading-none text-[#00008B] font-bold"
                    >
                      {form.ftinNotRequired ? "✔" : ""}
                    </button>
                    <input style={overlayStyle(RECT.referenceNumbers)} className={overlayInputCls} value={form.referenceNumbers} onChange={(e) => updateField("referenceNumbers", e.target.value)} />
                    <input type="date" style={overlayStyle(RECT.dateOfBirth)} className={overlayInputCls} value={form.dateOfBirth} onChange={(e) => updateField("dateOfBirth", e.target.value)} />

                    {/* Part II — Claim of Tax Treaty Benefits, optional, filled in by the recipient like everything else */}
                    <input style={overlayStyle(RECT.treatyResidentCountry)} className={overlayInputCls} value={form.treatyResidentCountry} onChange={(e) => updateField("treatyResidentCountry", e.target.value)} />
                    <input style={overlayStyle(RECT.treatyArticleParagraph)} className={overlayInputCls} value={form.treatyArticleParagraph} onChange={(e) => updateField("treatyArticleParagraph", e.target.value)} />
                    <input style={overlayStyle(RECT.treatyRate)} className={overlayInputCls} value={form.treatyRate} onChange={(e) => updateField("treatyRate", e.target.value)} />
                    <input style={overlayStyle(RECT.treatyIncomeType)} className={overlayInputCls} value={form.treatyIncomeType} onChange={(e) => updateField("treatyIncomeType", e.target.value)} />
                    <input style={overlayStyle(RECT.treatyAdditionalConditions)} className={overlayInputCls} value={form.treatyAdditionalConditions} onChange={(e) => updateField("treatyAdditionalConditions", e.target.value)} />

                    <canvas
                      ref={sigCanvasRef}
                      width={440}
                      height={120}
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

                    {/* Rendered AFTER (so it stacks on top of) the signature canvas — otherwise the enlarged drawing area, which extends upward toward this line, intercepts clicks meant for the checkbox. */}
                    <button
                      type="button"
                      style={overlayStyle(RECT.certifiedTrue)}
                      onClick={() => updateField("certifiedTrue", !form.certifiedTrue)}
                      className="border border-black/60 bg-transparent flex items-center justify-center leading-none text-[#00008B] font-bold"
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
