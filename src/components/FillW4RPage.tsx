/**
 * Fill W-4R — opened from the deep link a Team Messenger message sends (see
 * ReportHRDaily.tsx's "W-8/W-9/W-4/W-4R Forms" tab "Send W-4R Request"
 * flow). Same architecture as FillW4Page.tsx: renders the REAL official
 * PDF's pages to canvases via pdf.js, with input overlays at each field's
 * own coordinates — no redrawn lookalike. Submitting fills that same real
 * PDF's own fields via fillW4RPdf and sends the result back to HR.
 *
 * Only page 1 (the actual submittable Withholding Certificate) has real
 * fillable fields. Pages 2-3 (General Instructions / Marginal Rate Tables /
 * Privacy Act notice) have no fields and render read-only, same treatment
 * FillW9Page.tsx gives its own instruction pages.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import { getSignableDocument, signDocument, type SignableDocument } from "@/lib/supabase/signableDocuments";
import { uploadSignableDocumentSignature, uploadW4RForm } from "@/lib/firebase/storage";
import { fillW4RPdf, loadBlankW4RBytes } from "@/lib/w4rPdfFill";
import type { W4RFormData } from "@/lib/w4rFormTemplate";
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

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

// Field rectangles (PDF user-space units, origin bottom-left), extracted via
// pdf-lib's acroField.getWidgets()[0].getRectangle() on src/assets/fw4r.pdf
// — same technique w4FormTemplate.ts's rects were derived from. The
// signature/date row has no real field (see w4rPdfFill.ts's header comment)
// — those coordinates are estimated from the actual "Your signature"/"Date"
// caption text positions instead.
const PAGE1_RECT = {
  firstNameMiddleInitial: { x: 36, y: 684, w: 215, h: 14 },
  lastName: { x: 253, y: 684, w: 214, h: 14 },
  ssn: { x: 469, y: 684, w: 107, h: 14 },
  address: { x: 36, y: 660, w: 540, h: 14 },
  cityStateZip: { x: 36, y: 636, w: 540, h: 14 },
  withholdingRatePercent: { x: 504, y: 510, w: 58, h: 12 },
  signature: { x: 74, y: 470, w: 360, h: 24 },
  dateSigned: { x: 448, y: 470, w: 120, h: 14 },
} as const;

const fmtDateSigned = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${d.getFullYear()}`;

const BLANK_FORM: W4RFormData = {
  employeeId: "",
  firstNameMiddleInitial: "",
  lastName: "",
  ssn: "",
  address: "",
  cityStateZip: "",
  withholdingRatePercent: "",
  dateSigned: "",
  signatureDataUrl: "",
};

export function FillW4RPage({ docId }: Props) {
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

  const [form, setForm] = useState<W4RFormData>({ ...BLANK_FORM });

  const sigPad = useSignaturePad({ defaultName: `${form.firstNameMiddleInitial} ${form.lastName}`.trim(), width: 440, height: 100 });

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
        if (!document || document.documentType !== "w4r") {
          setError("This document doesn't exist or has been removed.");
        } else {
          setDoc(document);
          const existing = document.formData as Partial<W4RFormData>;
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
        const [pdfjsLib, bytes] = await Promise.all([import("pdfjs-dist"), loadBlankW4RBytes()]);
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

  const updateField = <K extends keyof W4RFormData>(key: K, value: W4RFormData[K]) => setForm((f) => ({ ...f, [key]: value }));

  const validate = (): string | null => {
    if (!form.firstNameMiddleInitial.trim() || !form.lastName.trim()) return "Enter your name.";
    if (!form.ssn.trim()) return "Enter your Social Security number.";
    if (!form.address.trim() || !form.cityStateZip.trim()) return "Fill in your address.";
    if (form.withholdingRatePercent && (Number(form.withholdingRatePercent) < 0 || Number(form.withholdingRatePercent) > 100)) return "Withholding rate must be between 0 and 100.";
    if (!sigPad.hasContent()) return "Please add your signature.";
    return null;
  };

  const handleSubmit = async () => {
    if (!doc || !myProfileId) return;
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
      const companyId = doc.companyId;
      const sigBytes = new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
      const signatureUrl = await uploadSignableDocumentSignature(companyId, doc.id, "employee", dataUrl);
      const signedAt = new Date().toISOString();
      const finalData: W4RFormData = { ...form, dateSigned: signedAt, signatureDataUrl: dataUrl };
      const entry = { name: displayName || `${form.firstNameMiddleInitial} ${form.lastName}`.trim() || "Signed", url: signatureUrl, signedAt };

      const pdfBytes = await fillW4RPdf(finalData, sigBytes);
      const pdfUrl = await uploadW4RForm(companyId, `${finalData.firstNameMiddleInitial} ${finalData.lastName}`.trim(), new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" }));

      await signDocument(doc.id, "employee", entry, pdfUrl, finalData as unknown as Record<string, any>);

      if (doc.createdBy) {
        const thread = await getOrCreateDmThread(myProfileId, doc.createdBy);
        const employeeName = `${finalData.firstNameMiddleInitial} ${finalData.lastName}`.trim();
        const filename = `W-4R - ${employeeName}.pdf`;
        await sendMessage({
          dmThreadId: thread.id,
          senderId: myProfileId,
          senderName: displayName || "Employee",
          body: `📄 W-4R form for ${employeeName} has been completed and submitted: [${filename}](${pdfUrl})`,
        });
      }

      getHrNotificationSettings()
        .then(({ taxForms }) => {
          if (!taxForms) return;
          const excludeIds = doc.createdBy ? [doc.createdBy] : [];
          const employeeName = `${finalData.firstNameMiddleInitial} ${finalData.lastName}`.trim();
          void notifyHrRoleUsers(myProfileId, displayName || "Employee", excludeIds, `📄 W-4R form for ${employeeName} has been completed and submitted.`);
        })
        .catch((err) => console.error("[w4r] hr notify check failed:", err));

      setDoc({ ...doc, status: "signed", pdfUrl, formData: finalData as unknown as Record<string, any>, signatures: { employee: entry }, signedAt });
      void logActivity({ action: "w4r_form_signed", targetType: "employee", targetLabel: `${finalData.firstNameMiddleInitial} ${finalData.lastName}`.trim() });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit form.");
    } finally {
      setSubmitting(false);
    }
  };

  const isRecipient = !!doc && !!myProfileId && doc.recipientId === myProfileId;
  // Platform-level SUPERSUPERADMIN only — the per-company SUPERADMIN role
  // should NOT see every employee's private documents, just its own like ADMIN.
  const isSuperadmin = role === "SUPERSUPERADMIN";

  const overlayStyle = (r: { x: number; y: number; w: number; h: number }): React.CSSProperties => ({
    position: "absolute",
    left: r.x * scale,
    top: (PAGE_HEIGHT - r.y - r.h) * scale,
    width: r.w * scale,
    height: r.h * scale,
    fontSize: `${7 * scale}px`,
  });

  // A persistent light highlight (same convention Acrobat/other PDF fillers
  // use for fillable fields) so every field is visually discoverable, not
  // just the ones a user happens to click into.
  const overlayInputCls = "bg-blue-50/60 border border-blue-300/70 rounded-[2px] outline-none p-0 font-bold font-sans text-[#00008B] focus:bg-blue-100/80 focus:border-blue-400";

  const singleLineInput = (field: keyof W4RFormData, rect: { x: number; y: number; w: number; h: number }, maxLength?: number) => (
    <input
      key={field}
      style={overlayStyle(rect)}
      className={overlayInputCls}
      maxLength={maxLength}
      value={form[field] as string}
      onChange={(e) => updateField(field, e.target.value as W4RFormData[typeof field])}
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
              Fill in your information directly on the form below, add your signature, then submit. Line 2 (withholding rate) is optional — leave it blank to use the default rate. Pages 2-3 are shown for reference.
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
                      {singleLineInput("withholdingRatePercent", PAGE1_RECT.withholdingRatePercent, 3)}

                      <canvas
                        {...sigPad.canvasProps}
                        style={{
                          position: "absolute",
                          left: PAGE1_RECT.signature.x * scale,
                          top: (PAGE_HEIGHT - PAGE1_RECT.signature.y - PAGE1_RECT.signature.h) * scale,
                          width: PAGE1_RECT.signature.w * scale,
                          height: PAGE1_RECT.signature.h * scale,
                        }}
                      />
                      <div style={overlayStyle(PAGE1_RECT.dateSigned)} className="flex items-end justify-center font-bold text-[#00008B]">
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
              {submitting ? "Submitting…" : "Submit to HR"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
