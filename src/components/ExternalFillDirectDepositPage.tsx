/**
 * External Fill Direct Deposit Authorization — the no-login counterpart to
 * FillDirectDepositPage.tsx, opened from the link ReportHRDaily.tsx's
 * "Send Request" panel generates when HR picks "External Link" instead of
 * an AHS teammate. No AHS account needed: talks only to
 * /api/signable-documents (see externalSignableDocuments.ts /
 * signableDocumentsBridge.ts), which only ever serves/accepts documents
 * that have no linked AHS profile (recipient_id IS NULL).
 *
 * Same plain-HTML-form + live-preview layout as FillDirectDepositPage.tsx
 * (there's no source PDF here — see directDepositFormTemplate.ts's header
 * comment). The PDF is built entirely client-side via the same pure
 * buildDirectDepositBodyMarkup/captureHtmlToPdfBlob used by the logged-in
 * flow, then POSTed already-finished to the server bridge, which uploads
 * it and notifies HR — no DM step here since there's no sender profile.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import logo from "@/assets/Admin Hub Solutions Logo no Text.png";
import { getExternalSignableDocument, submitExternalSignature, type ExternalSignableDocument } from "@/lib/supabase/externalSignableDocuments";
import { captureHtmlToPdfBlob, loadAssetDataUrl } from "@/lib/pdfCapture";
import {
  buildDirectDepositBodyMarkup,
  directDepositStyles,
  DIRECT_DEPOSIT_STATES,
  DIRECT_DEPOSIT_COUNTRIES,
  DIRECT_DEPOSIT_ACCOUNT_TYPES,
  type DirectDepositFormData,
} from "@/lib/directDepositFormTemplate";

interface Props {
  docId: string;
}

const BLANK_FORM: DirectDepositFormData = {
  employeeId: "",
  employeeName: "",
  firstName: "",
  middleName: "",
  lastName: "",
  streetAddress: "",
  city: "",
  state: "",
  zipCode: "",
  country: "",
  bankName: "",
  accountNumber: "",
  routingNumber: "",
  accountType: "",
  dateSigned: "",
  signatureDataUrl: "",
};

const inputCls = "glass-input text-sm py-1.5 px-3 rounded-md w-full";
const labelCls = "text-[10px] font-semibold text-muted-foreground uppercase tracking-wide";

export function ExternalFillDirectDepositPage({ docId }: Props) {
  const [doc, setDoc] = useState<ExternalSignableDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedPdfUrl, setSubmittedPdfUrl] = useState<string | null>(null);
  const [logoDataUrl, setLogoDataUrl] = useState("");

  const [form, setForm] = useState<DirectDepositFormData>({ ...BLANK_FORM });

  const sigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const hasDrawnRef = useRef(false);

  useEffect(() => {
    loadAssetDataUrl(() => import("@/assets/us-in-home-services-logo.png")).then(setLogoDataUrl);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const document = await getExternalSignableDocument(docId);
        if (cancelled) return;
        if (!document || document.documentType !== "direct_deposit") {
          setError("This link isn't valid, or the document doesn't use link-based signing.");
        } else {
          setDoc(document);
          const existing = document.formData as Partial<DirectDepositFormData>;
          setForm((prev) => ({ ...prev, ...existing, employeeName: existing.employeeName || document.recipientName || "" }));
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load document.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [docId]);

  const updateField = <K extends keyof DirectDepositFormData>(key: K, value: DirectDepositFormData[K]) => setForm((f) => ({ ...f, [key]: value }));

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
    if (!form.firstName.trim()) return "Enter your first name.";
    if (!form.middleName.trim()) return "Enter your middle name (or N/A).";
    if (!form.lastName.trim()) return "Enter your last name.";
    if (!form.streetAddress.trim() || !form.city.trim() || !form.state || !form.zipCode.trim() || !form.country) return "Fill in your complete address.";
    if (!form.bankName.trim()) return "Enter the name of your bank.";
    if (!form.accountNumber.trim()) return "Enter your account number.";
    if (!/^\d{9}$/.test(form.routingNumber.trim())) return "Enter your 9-digit routing number.";
    if (!form.accountType) return "Select the type of account.";
    if (!hasDrawnRef.current) return "Please draw your signature.";
    return null;
  };

  const handleSubmit = async () => {
    if (!doc || !sigCanvasRef.current) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const employeeName = [form.firstName, form.middleName, form.lastName].filter(Boolean).join(" ");
      const dataUrl = sigCanvasRef.current.toDataURL("image/png");
      const signatureBlob = await (await fetch(dataUrl)).blob();
      const signedAt = new Date().toISOString();
      const finalData: DirectDepositFormData = { ...form, employeeName, dateSigned: signedAt, signatureDataUrl: dataUrl };

      const pdfBlob = await captureHtmlToPdfBlob(
        buildDirectDepositBodyMarkup(finalData, logoDataUrl, { name: employeeName, url: dataUrl, signedAt }),
        directDepositStyles
      );

      const { pdfUrl } = await submitExternalSignature(docId, { signatureBlob, pdfBlob, formData: finalData as unknown as Record<string, any> });

      setSubmittedPdfUrl(pdfUrl);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit form.");
    } finally {
      setSubmitting(false);
    }
  };

  const previewData: DirectDepositFormData = useMemo(
    () => ({ ...form, employeeName: [form.firstName, form.middleName, form.lastName].filter(Boolean).join(" ") }),
    [form]
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-4">
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
            {submittedPdfUrl && (
              <a href={submittedPdfUrl} target="_blank" rel="noreferrer noopener" className="text-blue-300 hover:text-blue-200 underline text-sm">
                View the completed PDF
              </a>
            )}
            {!submittedPdfUrl && <p className="text-xs text-muted-foreground">You can close this page now.</p>}
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="panel p-4 flex-1 min-w-0">
              <p className="text-xs text-muted-foreground mb-4">Please make sure to fill out the form correctly. Thank you!</p>

              <div className="flex flex-col gap-4">
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Name</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div><label className={labelCls}>First Name*</label><input className={inputCls} value={form.firstName} onChange={(e) => updateField("firstName", e.target.value)} /></div>
                    <div><label className={labelCls}>Middle Name* <span className="normal-case font-normal">(N/A if none)</span></label><input className={inputCls} value={form.middleName} onChange={(e) => updateField("middleName", e.target.value)} /></div>
                    <div><label className={labelCls}>Last Name*</label><input className={inputCls} value={form.lastName} onChange={(e) => updateField("lastName", e.target.value)} /></div>
                  </div>
                </div>

                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Address</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2"><label className={labelCls}>Street Address*</label><input className={inputCls} value={form.streetAddress} onChange={(e) => updateField("streetAddress", e.target.value)} /></div>
                    <div><label className={labelCls}>City*</label><input className={inputCls} value={form.city} onChange={(e) => updateField("city", e.target.value)} /></div>
                    <div>
                      <label className={labelCls}>State*</label>
                      <select className={inputCls} value={form.state} onChange={(e) => updateField("state", e.target.value)}>
                        <option value="">Please Select</option>
                        {DIRECT_DEPOSIT_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div><label className={labelCls}>Zip Code*</label><input className={inputCls} value={form.zipCode} onChange={(e) => updateField("zipCode", e.target.value)} /></div>
                    <div>
                      <label className={labelCls}>Country*</label>
                      <select className={inputCls} value={form.country} onChange={(e) => updateField("country", e.target.value)}>
                        <option value="">Please Select</option>
                        {DIRECT_DEPOSIT_COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Bank Account</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div><label className={labelCls}>Name of Bank*</label><input className={inputCls} value={form.bankName} onChange={(e) => updateField("bankName", e.target.value)} /></div>
                    <div><label className={labelCls}>Account #*</label><input className={inputCls} value={form.accountNumber} onChange={(e) => updateField("accountNumber", e.target.value)} /></div>
                    <div><label className={labelCls}>9-Digit Routing #*</label><input className={inputCls} maxLength={9} value={form.routingNumber} onChange={(e) => updateField("routingNumber", e.target.value.replace(/\D/g, "").slice(0, 9))} /></div>
                    <div>
                      <label className={labelCls}>Type of Account*</label>
                      <select className={inputCls} value={form.accountType} onChange={(e) => updateField("accountType", e.target.value)}>
                        <option value="">Please Select</option>
                        {DIRECT_DEPOSIT_ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">US In Home Services is hereby authorized to directly deposit my pay to the account listed above. This authorization will remain in effect until I modify or cancel it in writing.</p>

                <div>
                  <label className={labelCls}>Contractor's Signature</label>
                  <canvas
                    ref={sigCanvasRef}
                    width={500}
                    height={130}
                    onPointerDown={startDraw}
                    onPointerMove={moveDraw}
                    onPointerUp={endDraw}
                    onPointerLeave={endDraw}
                    className="bg-white rounded-md border border-white/15 w-full max-w-md touch-none cursor-crosshair mt-1"
                  />
                  <button onClick={clearSignature} className="btn text-xs px-3 py-1.5 mt-2">Clear signature</button>
                </div>

                {error && (
                  <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{error}</p>
                )}

                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 w-fit"
                >
                  {submitting ? "Submitting…" : "Submit"}
                </button>
              </div>
            </div>

            <div className="lg:w-[420px] shrink-0">
              <div className="panel p-4 sticky top-4">
                <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Live Preview</h2>
                <div className="overflow-auto bg-white/5 rounded-md p-2" style={{ maxHeight: "80vh" }}>
                  <div style={{ transform: "scale(0.45)", transformOrigin: "top left", width: "816px" }}>
                    <style dangerouslySetInnerHTML={{ __html: directDepositStyles }} />
                    <div dangerouslySetInnerHTML={{ __html: buildDirectDepositBodyMarkup(previewData, logoDataUrl, undefined) }} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
