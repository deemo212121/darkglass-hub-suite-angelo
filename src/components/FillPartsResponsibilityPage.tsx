/**
 * Fill Parts Responsibility and Technician Floor Protection Acknowledgment
 * Form â opened from the deep link a Team Messenger message sends (see
 * ReportHRDaily.tsx's "Parts Responsibility Form" tab "Send Request"
 * flow). Same architecture as FillMealRestBreakPage.tsx: renders the REAL
 * official PDF's pages to canvases via pdf.js, with input overlays at each
 * blank's own coordinates â no redrawn lookalike. Submitting draws the
 * collected values directly onto that same real PDF via
 * fillPartsResponsibilityPdf (there are no AcroForm fields on this PDF at
 * all â see partsResponsibilityFormTemplate.ts's header comment) and sends
 * the result back to HR.
 *
 * Genuine two-party document, same shape as Acknowledgment of Wage/Meal
 * and Rest Break: only the technician half (name, branch, date,
 * signature) is fillable here. The "Manager/Supervisor Signature" line is
 * completed separately afterward by HR inside ReportHRDaily.tsx's
 * "Complete Manager Signature" dialog â shown here read-only (the blank
 * PDF page underneath, no overlay).
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import { getSignableDocument, signDocument, type SignableDocument } from "@/lib/supabase/signableDocuments";
import { uploadSignableDocumentSignature, uploadPartsResponsibilityForm, refreshStorageAuthToken } from "@/lib/firebase/storage";
import { fillPartsResponsibilityPdf, loadBlankPartsResponsibilityBytes } from "@/lib/partsResponsibilityPdfFill";
import { PARTS_RESPONSIBILITY_BRANCHES, type PartsResponsibilityFormData } from "@/lib/partsResponsibilityFormTemplate";
import { dateBlankPositions } from "@/lib/pdfDateBlankSplit";
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

// Field rectangles (PDF user-space units, origin bottom-left), precisely
// calibrated against src/assets/Parts Responsibility and Technician Floor
// Protection Acknowledgment Form.pdf â see
// partsResponsibilityPdfFill.ts's header comment for how the merged
// First/Middle/Last Name line was split using the PDF's own measured
// underscore-glyph width. This PDF has no real AcroForm fields at all.
const PAGE1_RECT = {
  firstName: { x: 219.8, y: 642.6, w: 99.7, h: 14 },
  middleName: { x: 393.4, y: 642.6, w: 99.7, h: 14 },
  lastName: { x: 107.3, y: 625.7, w: 101.2, h: 14 },
  branch: { x: 233.8, y: 600.7, w: 220, h: 14 },
} as const;

const TECHNICIAN_DATE_X = dateBlankPositions(101.5);

const PAGE2_RECT = {
  dateSignedMM: { x: TECHNICIAN_DATE_X.mm, y: 650.6, w: 30, h: 13 },
  dateSignedDD: { x: TECHNICIAN_DATE_X.dd, y: 650.6, w: 30, h: 13 },
  dateSignedYYYY: { x: TECHNICIAN_DATE_X.yyyy, y: 650.6, w: 50, h: 13 },
  printedName: { x: 208, y: 625.7, w: 290, h: 14 },
  signature: { x: 187.9, y: 600.7, w: 298.5, h: 20 },
} as const;

const fmtDateSignedParts = (d: Date) => ({
  mm: String(d.getMonth() + 1).padStart(2, "0"),
  dd: String(d.getDate()).padStart(2, "0"),
  yyyy: String(d.getFullYear()),
});

const BLANK_FORM: PartsResponsibilityFormData = {
  employeeId: "",
  employeeName: "",
  firstName: "",
  middleName: "",
  lastName: "",
  branch: "",
  technicianDateSigned: "",
  technicianSignatureDataUrl: "",
  managerDateSigned: "",
  managerSignatureDataUrl: "",
};

export function FillPartsResponsibilityPage({ docId }: Props) {
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

  const [form, setForm] = useState<PartsResponsibilityFormData>({ ...BLANK_FORM });

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
        if (!document || document.documentType !== "parts_responsibility") {
          setError("This document doesn't exist or has been removed.");
        } else {
          setDoc(document);
          const existing = document.formData as Partial<PartsResponsibilityFormData>;
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
        const [pdfjsLib, bytes] = await Promise.all([import("pdfjs-dist"), loadBlankPartsResponsibilityBytes()]);
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

  const updateField = <K extends keyof PartsResponsibilityFormData>(key: K, value: PartsResponsibilityFormData[K]) => setForm((f) => ({ ...f, [key]: value }));

  const validate = (): string | null => {
    if (!form.firstName.trim()) return "Enter your first name.";
    if (!form.lastName.trim()) return "Enter your last name.";
    if (!form.branch) return "Select your branch.";
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
      // Force a fresh ID token before this upload sequence — see
      // refreshStorageAuthToken's doc comment (a slow connection can let
      // it go stale between signing in and finally submitting).
      await refreshStorageAuthToken();
      const employeeName = [form.firstName, form.middleName, form.lastName].filter(Boolean).join(" ");
      const sigBytes = new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
      const signatureUrl = await uploadSignableDocumentSignature(companyId, doc.id, "employee", dataUrl);
      const signedAt = new Date().toISOString();
      const finalData: PartsResponsibilityFormData = { ...form, employeeName, technicianDateSigned: signedAt, technicianSignatureDataUrl: dataUrl };
      const entry = { name: displayName || employeeName || "Signed", url: signatureUrl, signedAt };

      const pdfBytes = await fillPartsResponsibilityPdf(finalData, sigBytes);
      const pdfUrl = await uploadPartsResponsibilityForm(companyId, employeeName, new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" }));

      await signDocument(doc.id, "employee", entry, pdfUrl, finalData as unknown as Record<string, any>);

      if (doc.createdBy) {
        const thread = await getOrCreateDmThread(myProfileId, doc.createdBy);
        const filename = `Parts Responsibility and Floor Protection Acknowledgment - ${employeeName}.pdf`;
        await sendMessage({
          dmThreadId: thread.id,
          senderId: myProfileId,
          senderName: displayName || "Employee",
          body: `ð Parts Responsibility and Technician Floor Protection Acknowledgment Form for ${employeeName} has been signed, and is ready for the manager/supervisor signature: [${filename}](${pdfUrl})`,
        });
      }

      getHrNotificationSettings()
        .then(({ taxForms }) => {
          if (!taxForms) return;
          const excludeIds = doc.createdBy ? [doc.createdBy] : [];
          void notifyHrRoleUsers(myProfileId, displayName || "Employee", excludeIds, `ð Parts Responsibility and Technician Floor Protection Acknowledgment Form for ${employeeName} has been signed â the manager/supervisor signature is ready to be added.`);
        })
        .catch((err) => console.error("[parts-responsibility] hr notify check failed:", err));

      setDoc({ ...doc, status: "signed", pdfUrl, formData: finalData as unknown as Record<string, any>, signatures: { employee: entry }, signedAt });
      void logActivity({ action: "parts_responsibility_signed", targetType: "employee", targetLabel: employeeName });
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
  const todayParts = fmtDateSignedParts(new Date());

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-4xl mx-auto p-4">
        <Link to="/home" className="btn text-xs px-2.5 py-1.5 flex items-center gap-1 w-fit mb-4">
          <ChevronLeft className="h-3.5 w-3.5" /> Home
        </Link>

        {loading ? (
          <div className="panel p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading documentâ¦
          </div>
        ) : error && !doc ? (
          <div className="panel p-6 text-sm text-red-300">{error}</div>
        ) : !doc ? null : !isRecipient && !isSuperadmin ? (
          <div className="panel p-6 text-sm text-muted-foreground">This document isn't addressed to your account.</div>
        ) : submitted || doc.status === "signed" || doc.status === "confirmed" ? (
          <div className="panel p-6 text-center">
            <p className="text-sm font-semibold mb-2">â Submitted{submitted ? " and sent back to HR" : ""}.</p>
            <p className="text-xs text-muted-foreground mb-2">HR will add the manager/supervisor signature separately.</p>
            {doc.pdfUrl && (
              <a href={doc.pdfUrl} target="_blank" rel="noreferrer noopener" className="text-blue-300 hover:text-blue-200 underline text-sm">
                View the completed PDF
              </a>
            )}
          </div>
        ) : (
          <div className="panel p-4">
            <p className="text-xs text-muted-foreground mb-3">
              Read the parts responsibility and floor protection policy below, fill in your name and branch, add your signature, then submit.
            </p>

            <div className="overflow-x-auto flex flex-col items-center bg-white/5 rounded-md p-4 gap-4">
              {Array.from({ length: numPages || 1 }, (_, i) => i + 1).map((pageNum) => (
                <div key={pageNum} className="relative bg-white shadow-lg" style={{ width: PAGE_WIDTH * scale, height: PAGE_HEIGHT * scale }}>
                  <canvas ref={(el) => { pageCanvasRefs.current[pageNum - 1] = el; }} className="absolute inset-0" />
                  {pageLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm text-muted-foreground gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading formâ¦
                    </div>
                  )}

                  {!pageLoading && pageNum === 1 && (
                    <>
                      <input
                        style={overlayStyle(PAGE1_RECT.firstName)}
                        className={overlayInputCls}
                        value={form.firstName}
                        onChange={(e) => updateField("firstName", e.target.value)}
                      />
                      <input
                        style={overlayStyle(PAGE1_RECT.middleName)}
                        className={overlayInputCls}
                        value={form.middleName}
                        onChange={(e) => updateField("middleName", e.target.value)}
                      />
                      <input
                        style={overlayStyle(PAGE1_RECT.lastName)}
                        className={overlayInputCls}
                        value={form.lastName}
                        onChange={(e) => updateField("lastName", e.target.value)}
                      />

                      <select
                        style={overlayStyle(PAGE1_RECT.branch)}
                        className={`${overlayInputCls} appearance-none`}
                        value={form.branch}
                        onChange={(e) => updateField("branch", e.target.value)}
                      >
                        <option value="">Selectâ¦</option>
                        {PARTS_RESPONSIBILITY_BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </>
                  )}

                  {!pageLoading && pageNum === 2 && (
                    <>
                      <div style={overlayStyle(PAGE2_RECT.dateSignedMM)} className="flex items-center font-bold text-[#00008B]">{todayParts.mm}</div>
                      <div style={overlayStyle(PAGE2_RECT.dateSignedDD)} className="flex items-center font-bold text-[#00008B]">{todayParts.dd}</div>
                      <div style={overlayStyle(PAGE2_RECT.dateSignedYYYY)} className="flex items-center font-bold text-[#00008B]">{todayParts.yyyy}</div>
                      <div style={overlayStyle(PAGE2_RECT.printedName)} className="flex items-center font-bold text-[#00008B]">
                        {[form.firstName, form.middleName, form.lastName].filter(Boolean).join(" ")}
                      </div>

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
              {submitting ? "Submittingâ¦" : "Submit to HR"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
