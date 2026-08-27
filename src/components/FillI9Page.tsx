/**
 * Fill I-9 â opened from the deep link a Team Messenger message sends (see
 * ReportHRDaily.tsx's "Form I-9" tab "Send I-9 Request" flow). Same
 * architecture as FillW4Page.tsx: renders the REAL official PDF's pages to
 * canvases via pdf.js, with input overlays at each field's own coordinates
 * â no redrawn lookalike. Submitting fills that same real PDF's own Section
 * 1 fields via fillI9Pdf and sends the result back to HR.
 *
 * Only Section 1 (page 1's employee half) is fillable here â Section 2 (the
 * employer/AR document-review half, further down the same page) is
 * completed separately afterward by HR, see i9FormTemplate.ts's header
 * comment for why this form is a genuine two-party flow. Page 2 ("Lists of
 * Acceptable Documents") is shown read-only for reference, same treatment
 * FillW4Page.tsx gives its non-fillable worksheet pages. Pages 3-4
 * (Supplement A/B â preparer/translator certification, reverification and
 * rehire) aren't relevant to a new hire's own submission and aren't shown.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import { getSignableDocument, signDocument, type SignableDocument } from "@/lib/supabase/signableDocuments";
import { uploadSignableDocumentSignature, uploadI9Form, refreshStorageAuthToken } from "@/lib/firebase/storage";
import { fillI9Pdf, loadBlankI9Bytes } from "@/lib/i9PdfFill";
import type { I9CitizenshipStatus, I9FormData } from "@/lib/i9FormTemplate";
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
/** Only Section 1's page and the reference "Lists of Acceptable Documents" page are shown â see header comment. */
const VISIBLE_PAGES = 2;

const STATE_OPTIONS = [
  "", "AL", "AK", "AS", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "GU", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND",
  "MP", "OH", "OK", "OR", "PA", "PR", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VI", "VA", "WA", "WV", "WI", "WY",
  "CAN", "MEX",
];

// Field rectangles (PDF user-space units, origin bottom-left), extracted via
// pdf-lib's acroField.getWidgets()[0].getRectangle() on src/assets/i-9.pdf â
// same technique w4FormTemplate.ts's rects were derived from. Section 1 only
// (y=605 down to the signature/date row at y=421); Section 2 (y=342 down to
// y=53) is left showing the blank PDF underneath with no overlay, since the
// employee doesn't fill it in.
const SECTION1_RECT = {
  lastName: { x: 43, y: 605, w: 156, h: 15 },
  firstName: { x: 204, y: 605, w: 138, h: 15 },
  middleInitial: { x: 348, y: 605, w: 65, h: 15 },
  otherLastNames: { x: 420, y: 605, w: 156, h: 15 },
  address: { x: 42, y: 580, w: 186, h: 14 },
  aptNumber: { x: 234, y: 580, w: 66, h: 14 },
  city: { x: 306, y: 580, w: 149, h: 14 },
  state: { x: 461, y: 580, w: 41, h: 14 },
  zip: { x: 510, y: 580, w: 65, h: 14 },
  dateOfBirth: { x: 42, y: 554, w: 99, h: 14 },
  email: { x: 264, y: 554, w: 186, h: 14 },
  ssn: { x: 150, y: 553, w: 105, h: 14 },
  phone: { x: 456, y: 553, w: 119, h: 14 },
  citizenCheckbox: { x: 182, y: 523, w: 9, h: 9 },
  noncitizenNationalCheckbox: { x: 182, y: 511, w: 9, h: 9 },
  lprCheckbox: { x: 182, y: 499, w: 9, h: 9 },
  lprANumber: { x: 391, y: 498, w: 185, h: 11 },
  authorizedCheckbox: { x: 182, y: 487, w: 9, h: 9 },
  workAuthExpDate: { x: 390, y: 484, w: 59, h: 13 },
  uscisANumber: { x: 181, y: 444, w: 83, h: 11 },
  i94Number: { x: 277, y: 444, w: 107, h: 11 },
  foreignPassport: { x: 397, y: 444, w: 179, h: 11 },
  signature: { x: 44, y: 421, w: 320, h: 22 },
  dateSigned: { x: 372, y: 421, w: 102, h: 13 },
} as const;

const fmtDateSigned = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;

const BLANK_FORM: I9FormData = {
  employeeId: "",
  employeeName: "",
  firstName: "",
  middleInitial: "",
  lastName: "",
  otherLastNames: "",
  address: "",
  aptNumber: "",
  city: "",
  state: "",
  zip: "",
  dateOfBirth: "",
  ssn: "",
  email: "",
  phone: "",
  citizenshipStatus: "",
  lprANumber: "",
  workAuthExpDate: "",
  uscisANumber: "",
  i94Number: "",
  foreignPassport: "",
  employeeDateSigned: "",
  employeeSignatureDataUrl: "",
  documentChoice: "",
  listADocTitle1: "",
  listAIssuing1: "",
  listADocNumber1: "",
  listAExp1: "",
  listADocTitle2: "",
  listAIssuing2: "",
  listADocNumber2: "",
  listAExp2: "",
  listADocTitle3: "",
  listAIssuing3: "",
  listADocNumber3: "",
  listAExp3: "",
  listBDocTitle1: "",
  listBIssuing1: "",
  listBDocNumber1: "",
  listBExp1: "",
  listCDocTitle1: "",
  listCIssuing1: "",
  listCDocNumber1: "",
  listCExp1: "",
  additionalInfo: "",
  altProcedureCheckbox: false,
  firstDayEmployed: "",
  employerNameTitle: "",
  employerSignatureDataUrl: "",
  section2DateSigned: "",
  businessName: "",
  businessAddress: "",
};

export function FillI9Page({ docId }: Props) {
  const { ready, uid, displayName, role } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [doc, setDoc] = useState<SignableDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [pageLoading, setPageLoading] = useState(true);
  const { scale, containerRef } = useResponsivePdfScale(PAGE_WIDTH);
  const [numPages, setNumPages] = useState(0);
  const pdfDocRef = useRef<any>(null);
  const pageCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);

  const [form, setForm] = useState<I9FormData>({ ...BLANK_FORM });

  const sigPad = useSignaturePad({ defaultName: `${form.firstName} ${form.lastName}`.trim(), width: 440, height: 100 });

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
        if (!document || document.documentType !== "i9") {
          setError("This document doesn't exist or has been removed.");
        } else {
          setDoc(document);
          const existing = document.formData as Partial<I9FormData>;
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
        const [pdfjsLib, bytes] = await Promise.all([import("pdfjs-dist"), loadBlankI9Bytes()]);
        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
        if (cancelled) return;
        pdfDocRef.current = pdf;
        setNumPages(Math.min(pdf.numPages, VISIBLE_PAGES));
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

  const updateField = <K extends keyof I9FormData>(key: K, value: I9FormData[K]) => setForm((f) => ({ ...f, [key]: value }));

  const validate = (): string | null => {
    if (!form.firstName.trim() || !form.lastName.trim()) return "Enter your name.";
    if (!form.address.trim() || !form.city.trim() || !form.state.trim() || !form.zip.trim()) return "Fill in your address.";
    if (!form.dateOfBirth.trim()) return "Enter your date of birth.";
    if (!form.ssn.trim()) return "Enter your Social Security number.";
    if (!form.citizenshipStatus) return "Select your citizenship / immigration status.";
    if (form.citizenshipStatus === "lawful_permanent_resident" && !form.lprANumber.trim()) return "Enter your USCIS or A-Number.";
    if (form.citizenshipStatus === "noncitizen_authorized" && !form.workAuthExpDate.trim()) return "Enter your work authorization expiration date.";
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
      const sigBytes = new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
      const signatureUrl = await uploadSignableDocumentSignature(companyId, doc.id, "employee", dataUrl);
      const signedAt = new Date().toISOString();
      const employeeName = `${form.firstName} ${form.lastName}`.trim();
      const finalData: I9FormData = { ...form, employeeName, employeeDateSigned: signedAt, employeeSignatureDataUrl: dataUrl };
      const entry = { name: displayName || employeeName || "Signed", url: signatureUrl, signedAt };

      const pdfBytes = await fillI9Pdf(finalData, sigBytes);
      const pdfUrl = await uploadI9Form(companyId, employeeName, new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" }));

      await signDocument(doc.id, "employee", entry, pdfUrl, finalData as unknown as Record<string, any>);

      if (doc.createdBy) {
        const thread = await getOrCreateDmThread(myProfileId, doc.createdBy);
        const filename = `Form I-9 (Section 1) - ${employeeName}.pdf`;
        await sendMessage({
          dmThreadId: thread.id,
          senderId: myProfileId,
          senderName: displayName || "Employee",
          body: `ð Form I-9 Section 1 for ${employeeName} has been completed and submitted, and is ready for Section 2: [${filename}](${pdfUrl})`,
        });
      }

      getHrNotificationSettings()
        .then(({ taxForms }) => {
          if (!taxForms) return;
          const excludeIds = doc.createdBy ? [doc.createdBy] : [];
          void notifyHrRoleUsers(myProfileId, displayName || "Employee", excludeIds, `ð Form I-9 Section 1 for ${employeeName} has been completed â Section 2 is ready to be filled in.`);
        })
        .catch((err) => console.error("[i9] hr notify check failed:", err));

      setDoc({ ...doc, status: "signed", pdfUrl, formData: finalData as unknown as Record<string, any>, signatures: { employee: entry }, signedAt });
      void logActivity({ action: "i9_section1_signed", targetType: "employee", targetLabel: employeeName });
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

  // Conditional fields (work-auth expiration date, A-Number, etc.) only
  // appear after checking a citizenship-status box, which makes them easy to
  // miss against the plain white PDF page â a persistent light highlight
  // (the same convention Acrobat/other PDF fillers use for fillable fields)
  // keeps every field visually discoverable, not just the ones a user
  // happens to click into.
  const overlayInputCls = "bg-blue-50/60 border border-blue-300/70 rounded-[2px] outline-none p-0 font-bold font-sans text-[#00008B] focus:bg-blue-100/80 focus:border-blue-400";
  const checkboxCls = "border border-black/60 bg-blue-50/60 flex items-center justify-center leading-none text-[#00008B] font-bold hover:bg-blue-100/80";

  const setCitizenshipStatus = (status: I9CitizenshipStatus) => updateField("citizenshipStatus", form.citizenshipStatus === status ? "" : status);

  const singleLineInput = (field: keyof I9FormData, rect: { x: number; y: number; w: number; h: number }, maxLength?: number) => (
    <input
      key={field}
      style={overlayStyle(rect)}
      className={overlayInputCls}
      maxLength={maxLength}
      value={form[field] as string}
      onChange={(e) => updateField(field, e.target.value as I9FormData[typeof field])}
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
            <Loader2 className="h-4 w-4 animate-spin" /> Loading documentâ¦
          </div>
        ) : error && !doc ? (
          <div className="panel p-6 text-sm text-red-300">{error}</div>
        ) : !doc ? null : !isRecipient && !isSuperadmin ? (
          <div className="panel p-6 text-sm text-muted-foreground">This document isn't addressed to your account.</div>
        ) : submitted || doc.status === "signed" || doc.status === "confirmed" ? (
          <div className="panel p-6 text-center">
            <p className="text-sm font-semibold mb-2">â Section 1 submitted{submitted ? " and sent back to HR" : ""}.</p>
            <p className="text-xs text-muted-foreground mb-2">HR will complete Section 2 (document review) separately.</p>
            {doc.pdfUrl && (
              <a href={doc.pdfUrl} target="_blank" rel="noreferrer noopener" className="text-blue-300 hover:text-blue-200 underline text-sm">
                View the completed PDF
              </a>
            )}
          </div>
        ) : (
          <div className="panel p-4">
            <p className="text-xs text-muted-foreground mb-3">
              Fill in Section 1 (your own information) directly on the form below, add your signature, then submit. Section 2, further down the same page, is completed separately by HR after you submit. Page 2 (Lists of Acceptable Documents) is shown for reference.
            </p>

            <div ref={containerRef} className="overflow-x-auto flex flex-col items-center bg-white/5 rounded-md p-4 gap-4">
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
                      {singleLineInput("lastName", SECTION1_RECT.lastName)}
                      {singleLineInput("firstName", SECTION1_RECT.firstName)}
                      {singleLineInput("middleInitial", SECTION1_RECT.middleInitial, 1)}
                      {singleLineInput("otherLastNames", SECTION1_RECT.otherLastNames)}
                      {singleLineInput("address", SECTION1_RECT.address)}
                      {singleLineInput("aptNumber", SECTION1_RECT.aptNumber)}
                      {singleLineInput("city", SECTION1_RECT.city)}

                      <select
                        style={overlayStyle(SECTION1_RECT.state)}
                        className={`${overlayInputCls} appearance-none`}
                        value={form.state}
                        onChange={(e) => updateField("state", e.target.value)}
                      >
                        {STATE_OPTIONS.map((s) => <option key={s || "blank"} value={s}>{s}</option>)}
                      </select>

                      {singleLineInput("zip", SECTION1_RECT.zip)}
                      {singleLineInput("dateOfBirth", SECTION1_RECT.dateOfBirth)}
                      {singleLineInput("email", SECTION1_RECT.email)}
                      {singleLineInput("ssn", SECTION1_RECT.ssn)}
                      {singleLineInput("phone", SECTION1_RECT.phone)}

                      <button type="button" style={overlayStyle(SECTION1_RECT.citizenCheckbox)} onClick={() => setCitizenshipStatus("citizen")} className={checkboxCls}>{form.citizenshipStatus === "citizen" ? "â" : ""}</button>
                      <button type="button" style={overlayStyle(SECTION1_RECT.noncitizenNationalCheckbox)} onClick={() => setCitizenshipStatus("noncitizen_national")} className={checkboxCls}>{form.citizenshipStatus === "noncitizen_national" ? "â" : ""}</button>
                      <button type="button" style={overlayStyle(SECTION1_RECT.lprCheckbox)} onClick={() => setCitizenshipStatus("lawful_permanent_resident")} className={checkboxCls}>{form.citizenshipStatus === "lawful_permanent_resident" ? "â" : ""}</button>
                      {form.citizenshipStatus === "lawful_permanent_resident" && singleLineInput("lprANumber", SECTION1_RECT.lprANumber)}
                      <button type="button" style={overlayStyle(SECTION1_RECT.authorizedCheckbox)} onClick={() => setCitizenshipStatus("noncitizen_authorized")} className={checkboxCls}>{form.citizenshipStatus === "noncitizen_authorized" ? "â" : ""}</button>
                      {form.citizenshipStatus === "noncitizen_authorized" && singleLineInput("workAuthExpDate", SECTION1_RECT.workAuthExpDate)}

                      {form.citizenshipStatus === "noncitizen_authorized" && (
                        <>
                          {singleLineInput("uscisANumber", SECTION1_RECT.uscisANumber)}
                          {singleLineInput("i94Number", SECTION1_RECT.i94Number)}
                          {singleLineInput("foreignPassport", SECTION1_RECT.foreignPassport)}
                        </>
                      )}

                      <canvas
                        {...sigPad.canvasProps}
                        style={{
                          position: "absolute",
                          left: SECTION1_RECT.signature.x * scale,
                          top: (PAGE_HEIGHT - SECTION1_RECT.signature.y - SECTION1_RECT.signature.h) * scale,
                          width: SECTION1_RECT.signature.w * scale,
                          height: SECTION1_RECT.signature.h * scale,
                        }}
                      />
                      <div style={overlayStyle(SECTION1_RECT.dateSigned)} className="flex items-end justify-center font-bold text-[#00008B]">
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
              {submitting ? "Submittingâ¦" : "Submit to HR"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
