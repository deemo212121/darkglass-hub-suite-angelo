/**
 * Fill Employee Meal and Rest Break Policy Acknowledgment — opened from the
 * deep link a Team Messenger message sends (see ReportHRDaily.tsx's "Meal
 * & Rest Break Policy" tab "Send Request" flow). Same architecture as
 * FillWageAckPage.tsx: renders the REAL official PDF's page to a canvas via
 * pdf.js, with input overlays at each blank's own coordinates — no
 * redrawn lookalike. Submitting draws the collected values directly onto
 * that same real PDF via fillMealRestBreakPdf (there are no AcroForm
 * fields on this PDF at all — see mealRestBreakFormTemplate.ts's header
 * comment) and sends the result back to HR.
 *
 * Genuine two-party document, same shape as Acknowledgment of Wage: only
 * the employee half (name, branch, employee signature) is fillable here.
 * The "Employer Representative Signature" line is completed separately
 * afterward by HR inside ReportHRDaily.tsx's "Complete Employer Signature"
 * dialog — shown here read-only (the blank PDF page underneath, no
 * overlay). Unlike Wage Ack, everything (both signature lines included)
 * fits on the one page this PDF has.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import { getSignableDocument, signDocument, type SignableDocument } from "@/lib/supabase/signableDocuments";
import { uploadSignableDocumentSignature, uploadMealRestBreakForm } from "@/lib/firebase/storage";
import { fillMealRestBreakPdf, loadBlankMealRestBreakBytes } from "@/lib/mealRestBreakPdfFill";
import { MEAL_REST_BREAK_BRANCHES, type MealRestBreakFormData } from "@/lib/mealRestBreakFormTemplate";
import { dateBlankPositions } from "@/lib/pdfDateBlankSplit";
import { getOrCreateDmThread, sendMessage } from "@/lib/supabase/messaging";
import { logActivity } from "@/lib/supabase/hrActivityLog";
import { getHrNotificationSettings } from "@/lib/supabase/companySettings";
import { notifyHrRoleUsers } from "@/lib/supabase/hrRoleNotify";
import { useSignaturePad } from "@/hooks/useSignaturePad";
import { useResponsivePdfScale } from "@/hooks/useResponsivePdfScale";
import { SignaturePadControls } from "@/components/SignaturePad";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

interface Props {
  docId: string;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

// Field rectangles (PDF user-space units, origin bottom-left), extracted
// via pdf.js's text-position API against the actual label/blank positions
// on src/assets/EMPLOYEE MEAL AND REST BREAK POLICY ACKNOWLEDGMENT.pdf —
// the exact numbers mealRestBreakPdfFill.ts's draw coordinates were derived
// from. This PDF has no real AcroForm fields at all.
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

export function FillMealRestBreakPage({ docId }: Props) {
  const { ready, uid, displayName, role } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [doc, setDoc] = useState<SignableDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [pageLoading, setPageLoading] = useState(true);
  const { scale, containerRef } = useResponsivePdfScale(PAGE_WIDTH);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [form, setForm] = useState<MealRestBreakFormData>({ ...BLANK_FORM });

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
        if (!document || document.documentType !== "meal_rest_break") {
          setError("This document doesn't exist or has been removed.");
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
  }, [ready, uid, docId]);

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
      const employeeName = [form.firstName, form.middleName, form.lastName].filter(Boolean).join(" ");
      const sigBytes = new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
      const signatureUrl = await uploadSignableDocumentSignature(companyId, doc.id, "employee", dataUrl);
      const signedAt = new Date().toISOString();
      const finalData: MealRestBreakFormData = { ...form, employeeName, employeeDateSigned: signedAt, employeeSignatureDataUrl: dataUrl };
      const entry = { name: displayName || employeeName || "Signed", url: signatureUrl, signedAt };

      const pdfBytes = await fillMealRestBreakPdf(finalData, sigBytes);
      const pdfUrl = await uploadMealRestBreakForm(companyId, employeeName, new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" }));

      await signDocument(doc.id, "employee", entry, pdfUrl, finalData as unknown as Record<string, any>);

      if (doc.createdBy) {
        const thread = await getOrCreateDmThread(myProfileId, doc.createdBy);
        const filename = `Meal and Rest Break Acknowledgment - ${employeeName}.pdf`;
        await sendMessage({
          dmThreadId: thread.id,
          senderId: myProfileId,
          senderName: displayName || "Employee",
          body: `📄 Employee Meal and Rest Break Policy Acknowledgment for ${employeeName} has been signed, and is ready for the employer signature: [${filename}](${pdfUrl})`,
        });
      }

      getHrNotificationSettings()
        .then(({ taxForms }) => {
          if (!taxForms) return;
          const excludeIds = doc.createdBy ? [doc.createdBy] : [];
          void notifyHrRoleUsers(myProfileId, displayName || "Employee", excludeIds, `📄 Employee Meal and Rest Break Policy Acknowledgment for ${employeeName} has been signed — the employer signature is ready to be added.`);
        })
        .catch((err) => console.error("[meal-rest-break] hr notify check failed:", err));

      setDoc({ ...doc, status: "signed", pdfUrl, formData: finalData as unknown as Record<string, any>, signatures: { employee: entry }, signedAt });
      void logActivity({ action: "meal_rest_break_signed", targetType: "employee", targetLabel: employeeName });
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
            <Loader2 className="h-4 w-4 animate-spin" /> Loading document…
          </div>
        ) : error && !doc ? (
          <div className="panel p-6 text-sm text-red-300">{error}</div>
        ) : !doc ? null : !isRecipient && !isSuperadmin ? (
          <div className="panel p-6 text-sm text-muted-foreground">This document isn't addressed to your account.</div>
        ) : submitted || doc.status === "signed" || doc.status === "confirmed" ? (
          <div className="panel p-6 text-center">
            <p className="text-sm font-semibold mb-2">✅ Submitted{submitted ? " and sent back to HR" : ""}.</p>
            <p className="text-xs text-muted-foreground mb-2">HR will add the employer signature separately.</p>
            {doc.pdfUrl && (
              <a href={doc.pdfUrl} target="_blank" rel="noreferrer noopener" className="text-blue-300 hover:text-blue-200 underline text-sm">
                View the completed PDF
              </a>
            )}
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
              {submitting ? "Submitting…" : "Submit to HR"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
