/**
 * Fill Employee Confidentiality and Non-Disclosure Agreement — opened from
 * the deep link a Team Messenger message sends (see ReportHRDaily.tsx's
 * "Employee Confidentiality Agreement" tab "Send Request" flow). Same
 * architecture as FillVehicleAgreementPage.tsx: renders the REAL official
 * PDF's pages to canvases via pdf.js, with input overlays at each blank's
 * own coordinates — no redrawn lookalike. Submitting draws the collected
 * values directly onto that same real PDF via fillEmployeeConfidentialityPdf
 * (there are no AcroForm fields on this PDF at all — see
 * employeeConfidentialityFormTemplate.ts's header comment) and sends the
 * result back to HR.
 *
 * Single-party, same shape as W-4R/Car IQ/Vehicle Agreement — no
 * employer/HR co-signature step, and no separate "I AGREE" checkbox
 * (signing itself is the agreement here). Fields sit on page 1, signature
 * sits on page 2.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import { getSignableDocument, signDocument, type SignableDocument } from "@/lib/supabase/signableDocuments";
import { uploadSignableDocumentSignature, uploadEmployeeConfidentialityForm } from "@/lib/firebase/storage";
import { fillEmployeeConfidentialityPdf, loadBlankEmployeeConfidentialityBytes } from "@/lib/employeeConfidentialityPdfFill";
import { EMPLOYEE_CONFIDENTIALITY_BRANCHES, type EmployeeConfidentialityFormData } from "@/lib/employeeConfidentialityFormTemplate";
import { getOrCreateDmThread, sendMessage } from "@/lib/supabase/messaging";
import { logActivity } from "@/lib/supabase/hrActivityLog";
import { getHrNotificationSettings } from "@/lib/supabase/companySettings";
import { notifyHrRoleUsers } from "@/lib/supabase/hrRoleNotify";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

interface Props {
  docId: string;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

// Field rectangles (PDF user-space units, origin bottom-left), extracted
// via pdf.js's text-position API against the actual label/blank positions
// on src/assets/EMPLOYEE CONFIDENTIALITY AND NON (1).pdf — the exact
// numbers employeeConfidentialityPdfFill.ts's draw coordinates were derived
// from. This PDF has no real AcroForm fields at all.
// Re-measured against the real PDF text runs (pdf.js getTextContent(),
// calibrated with @napi-rs/canvas's Calibri metrics against each line's
// known total width) — the previous numbers were eyeballed and drifted far
// enough right/wide to overlap neighboring labels (City spilling into
// "State:", Zip landing past its own blank entirely).
const PAGE1_RECT = {
  dateSigned: { x: 327, y: 646, w: 150, h: 13 },
  employeeName: { x: 199, y: 529, w: 299, h: 14 },
  address: { x: 189, y: 504, w: 311, h: 14 },
  city: { x: 169, y: 479, w: 90, h: 13 },
  state: { x: 292, y: 479, w: 54, h: 13 },
  zip: { x: 369, y: 479, w: 66, h: 13 },
  branch: { x: 184, y: 454, w: 248, h: 14 },
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

export function FillEmployeeConfidentialityPage({ docId }: Props) {
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

  const [form, setForm] = useState<EmployeeConfidentialityFormData>({ ...BLANK_FORM });

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
        if (!document || document.documentType !== "employee_confidentiality") {
          setError("This document doesn't exist or has been removed.");
        } else {
          setDoc(document);
          const existing = document.formData as Partial<EmployeeConfidentialityFormData>;
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

          // Page 1's printed Branch line has no blank of its own — it's
          // "Branch: [Please Select Branch from the list provided below]",
          // with the bracketed instruction sitting exactly where the select
          // overlay needs to go. A CSS background on that overlay only
          // approximates covering the printed text underneath (and visibly
          // didn't fully hide it), so paint over that exact region directly
          // on the canvas instead — guaranteed opaque, pixel-precise,
          // painted before the select ever sits on top of it.
          if (i === 1) {
            const r = PAGE1_RECT.branch;
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(
              r.x * scale - 4,
              (PAGE_HEIGHT - r.y - r.h) * scale - 4,
              r.w * scale + 8,
              r.h * scale + 10
            );
          }
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
      const finalData: EmployeeConfidentialityFormData = { ...form, dateSigned: signedAt, signatureDataUrl: dataUrl };
      const entry = { name: displayName || form.employeeName || "Signed", url: signatureUrl, signedAt };

      const pdfBytes = await fillEmployeeConfidentialityPdf(finalData, sigBytes);
      const pdfUrl = await uploadEmployeeConfidentialityForm(companyId, form.employeeName, new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" }));

      await signDocument(doc.id, "employee", entry, pdfUrl, finalData as unknown as Record<string, any>);

      if (doc.createdBy) {
        const thread = await getOrCreateDmThread(myProfileId, doc.createdBy);
        const filename = `Employee Confidentiality and Non-Disclosure Agreement - ${form.employeeName}.pdf`;
        await sendMessage({
          dmThreadId: thread.id,
          senderId: myProfileId,
          senderName: displayName || "Employee",
          body: `📄 Employee Confidentiality and Non-Disclosure Agreement for ${form.employeeName} has been signed: [${filename}](${pdfUrl})`,
        });
      }

      getHrNotificationSettings()
        .then(({ taxForms }) => {
          if (!taxForms) return;
          const excludeIds = doc.createdBy ? [doc.createdBy] : [];
          void notifyHrRoleUsers(myProfileId, displayName || "Employee", excludeIds, `📄 Employee Confidentiality and Non-Disclosure Agreement for ${form.employeeName} has been signed.`);
        })
        .catch((err) => console.error("[employee-confidentiality] hr notify check failed:", err));

      setDoc({ ...doc, status: "signed", pdfUrl, formData: finalData as unknown as Record<string, any>, signatures: { employee: entry }, signedAt });
      void logActivity({ action: "employee_confidentiality_signed", targetType: "employee", targetLabel: form.employeeName });
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
    fontSize: `${7 * scale}px`,
  });

  const overlayInputCls = "bg-blue-50/60 border border-blue-300/70 rounded-[2px] outline-none p-0 font-bold font-sans text-[#00008B] focus:bg-blue-100/80 focus:border-blue-400";

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
              {submitting ? "Submitting…" : "Submit to HR"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
