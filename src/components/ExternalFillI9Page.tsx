/**
 * External Fill I-9 (Section 1) — the no-login counterpart to
 * FillI9Page.tsx, opened from the link ReportHRDaily.tsx's "Send I-9
 * Request" panel generates when HR picks "External Link" instead of an AHS
 * teammate. No AHS account needed: talks only to /api/signable-documents
 * (see externalSignableDocuments.ts / signableDocumentsBridge.ts), which
 * only ever serves/accepts documents that have no linked AHS profile
 * (recipient_id IS NULL).
 *
 * Only Section 1 is fillable here, same as FillI9Page.tsx — Section 2
 * (document review + HR's own signature) always happens inside
 * ReportHRDaily.tsx by a logged-in HR user, regardless of whether Section 1
 * came from a teammate or an external link, so there's no "external"
 * variant of Section 2 to build.
 *
 * The PDF is built entirely client-side via the same pure fillI9Pdf used by
 * the logged-in flow, then POSTed already-finished to the server bridge,
 * which uploads it and notifies HR — no DM step here since there's no
 * sender profile.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import logo from "@/assets/Admin Hub Solutions Logo no Text.png";
import { getExternalSignableDocument, submitExternalSignature, type ExternalSignableDocument } from "@/lib/supabase/externalSignableDocuments";
import { fillI9Pdf, loadBlankI9Bytes } from "@/lib/i9PdfFill";
import type { I9CitizenshipStatus, I9FormData } from "@/lib/i9FormTemplate";
import { useSignaturePad } from "@/hooks/useSignaturePad";
import { SignaturePadControls } from "@/components/SignaturePad";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

interface Props {
  docId: string;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const VISIBLE_PAGES = 2;

const STATE_OPTIONS = [
  "", "AL", "AK", "AS", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "GU", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND",
  "MP", "OH", "OK", "OR", "PA", "PR", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VI", "VA", "WA", "WV", "WI", "WY",
  "CAN", "MEX",
];

// Same field rectangles as FillI9Page.tsx — see that file's header comment
// for how these were derived.
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

export function ExternalFillI9Page({ docId }: Props) {
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

  const [form, setForm] = useState<I9FormData>({ ...BLANK_FORM });

  const sigPad = useSignaturePad({ defaultName: `${form.firstName} ${form.lastName}`.trim(), width: 440, height: 100 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const document = await getExternalSignableDocument(docId);
        if (cancelled) return;
        if (!document || document.documentType !== "i9") {
          setError("This link isn't valid, or the document doesn't use link-based signing.");
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
  }, [docId]);

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
      const signatureBlob = await (await fetch(dataUrl)).blob();
      const signedAt = new Date().toISOString();
      const employeeName = `${form.firstName} ${form.lastName}`.trim();
      const finalData: I9FormData = { ...form, employeeName, employeeDateSigned: signedAt, employeeSignatureDataUrl: dataUrl };

      const sigBytes = new Uint8Array(await signatureBlob.arrayBuffer());
      const pdfBytes = await fillI9Pdf(finalData, sigBytes);
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
        ) : !doc ? null : submitted || doc.status === "signed" || doc.status === "confirmed" ? (
          <div className="panel p-6 text-center">
            <p className="text-sm font-semibold mb-2">✅ Section 1 submitted{submitted ? " and sent back to HR" : ""}.</p>
            <p className="text-xs text-muted-foreground mb-2">HR will complete Section 2 (document review) separately.</p>
            {submittedPdfUrl && (
              <a href={submittedPdfUrl} target="_blank" rel="noreferrer noopener" className="text-blue-300 hover:text-blue-200 underline text-sm">
                View the completed PDF
              </a>
            )}
          </div>
        ) : (
          <div className="panel p-4">
            <p className="text-xs text-muted-foreground mb-3">
              Fill in Section 1 (your own information) directly on the form below, add your signature, then submit. Section 2, further down the same page, is completed separately by HR after you submit. Page 2 (Lists of Acceptable Documents) is shown for reference.
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

                      <button type="button" style={overlayStyle(SECTION1_RECT.citizenCheckbox)} onClick={() => setCitizenshipStatus("citizen")} className={checkboxCls}>{form.citizenshipStatus === "citizen" ? "✔" : ""}</button>
                      <button type="button" style={overlayStyle(SECTION1_RECT.noncitizenNationalCheckbox)} onClick={() => setCitizenshipStatus("noncitizen_national")} className={checkboxCls}>{form.citizenshipStatus === "noncitizen_national" ? "✔" : ""}</button>
                      <button type="button" style={overlayStyle(SECTION1_RECT.lprCheckbox)} onClick={() => setCitizenshipStatus("lawful_permanent_resident")} className={checkboxCls}>{form.citizenshipStatus === "lawful_permanent_resident" ? "✔" : ""}</button>
                      {form.citizenshipStatus === "lawful_permanent_resident" && singleLineInput("lprANumber", SECTION1_RECT.lprANumber)}
                      <button type="button" style={overlayStyle(SECTION1_RECT.authorizedCheckbox)} onClick={() => setCitizenshipStatus("noncitizen_authorized")} className={checkboxCls}>{form.citizenshipStatus === "noncitizen_authorized" ? "✔" : ""}</button>
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
              {submitting ? "Submitting…" : "Submit"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
