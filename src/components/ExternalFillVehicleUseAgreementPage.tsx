/**
 * External Fill Vehicle Use Agreement — the no-login counterpart to
 * FillVehicleUseAgreementPage.tsx, opened from the link ReportHRDaily.tsx's
 * "Send Request" panel generates when HR picks "External Link" instead of
 * an AHS teammate. No AHS account needed: talks only to
 * /api/signable-documents (see externalSignableDocuments.ts /
 * signableDocumentsBridge.ts), which only ever serves/accepts documents
 * that have no linked AHS profile (recipient_id IS NULL).
 *
 * Same plain-HTML-form + live-preview layout as FillVehicleUseAgreementPage.tsx
 * (there's no source PDF here — see vehicleUseAgreementFormTemplate.ts's
 * header comment). The PDF is built entirely client-side via the same pure
 * buildVehicleUseAgreementBodyMarkup/captureHtmlToPdfBlob used by the
 * logged-in flow, then POSTed already-finished to the server bridge — no
 * DM step here since there's no sender profile.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import logo from "@/assets/Admin Hub Solutions Logo no Text.png";
import { getExternalSignableDocument, submitExternalSignature, type ExternalSignableDocument } from "@/lib/supabase/externalSignableDocuments";
import { captureHtmlToPdfBlob, loadAssetDataUrl } from "@/lib/pdfCapture";
import {
  buildVehicleUseAgreementBodyMarkup,
  vehicleUseAgreementStyles,
  VEHICLE_USE_AGREEMENT_BRANCHES,
  VEHICLE_USE_AGREEMENT_CLAUSES,
  type VehicleUseAgreementFormData,
} from "@/lib/vehicleUseAgreementFormTemplate";
import { useSignaturePad } from "@/hooks/useSignaturePad";
import { SignaturePadControls } from "@/components/SignaturePad";

interface Props {
  docId: string;
}

const BLANK_FORM: VehicleUseAgreementFormData = {
  employeeId: "",
  employeeName: "",
  firstName: "",
  lastName: "",
  branch: "",
  date: "",
  dateSigned: "",
  signatureDataUrl: "",
};

const inputCls = "glass-input text-sm py-1.5 px-3 rounded-md w-full";
const labelCls = "text-[10px] font-semibold text-muted-foreground uppercase tracking-wide";

export function ExternalFillVehicleUseAgreementPage({ docId }: Props) {
  const [doc, setDoc] = useState<ExternalSignableDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedPdfUrl, setSubmittedPdfUrl] = useState<string | null>(null);
  const [logoDataUrl, setLogoDataUrl] = useState("");

  const [form, setForm] = useState<VehicleUseAgreementFormData>({ ...BLANK_FORM });

  const employeeName = [form.firstName, form.lastName].filter(Boolean).join(" ");
  const sigPad = useSignaturePad({ defaultName: employeeName, width: 500, height: 130 });

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
        if (!document || document.documentType !== "vehicle_use_agreement") {
          setError("This link isn't valid, or the document doesn't use link-based signing.");
        } else {
          setDoc(document);
          const existing = document.formData as Partial<VehicleUseAgreementFormData>;
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

  const updateField = <K extends keyof VehicleUseAgreementFormData>(key: K, value: VehicleUseAgreementFormData[K]) => setForm((f) => ({ ...f, [key]: value }));

  const validate = (): string | null => {
    if (!form.firstName.trim()) return "Enter your first name.";
    if (!form.lastName.trim()) return "Enter your last name.";
    if (!form.date) return "Enter the date.";
    if (!form.branch) return "Select your branch.";
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
      const finalData: VehicleUseAgreementFormData = { ...form, employeeName, dateSigned: signedAt, signatureDataUrl: dataUrl };

      const pdfBlob = await captureHtmlToPdfBlob(
        buildVehicleUseAgreementBodyMarkup(finalData, logoDataUrl, { name: employeeName, url: dataUrl, signedAt }),
        vehicleUseAgreementStyles
      );

      const { pdfUrl } = await submitExternalSignature(docId, {
        signatureBlob,
        pdfBlob,
        formData: finalData as unknown as Record<string, any>,
      });

      setSubmittedPdfUrl(pdfUrl);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit form.");
    } finally {
      setSubmitting(false);
    }
  };

  const previewData: VehicleUseAgreementFormData = useMemo(
    () => ({ ...form, employeeName: [form.firstName, form.lastName].filter(Boolean).join(" ") }),
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
                <div className="rounded-md border border-white/10 bg-white/5 p-4 max-h-72 overflow-y-auto">
                  <p className="text-xs text-muted-foreground mb-3">
                    All contractors operating a company owned vehicle agree to operate the vehicle according to the following guidelines. Failure to adhere to these guidelines may result in revocation of a contractor's privilege to operate company vehicles or termination under some circumstances.
                  </p>
                  <p className="text-xs font-semibold mb-2">Agreement:</p>
                  <ol className="list-decimal pl-5 flex flex-col gap-2 text-xs text-muted-foreground">
                    {VEHICLE_USE_AGREEMENT_CLAUSES.map((clause, i) => (
                      <li key={i}>{clause}</li>
                    ))}
                  </ol>
                  <p className="text-xs italic mt-3">This authorization may be terminated by the company at any time.</p>
                </div>

                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Contractor Information</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div><label className={labelCls}>First Name*</label><input className={inputCls} value={form.firstName} onChange={(e) => updateField("firstName", e.target.value)} /></div>
                    <div><label className={labelCls}>Last Name*</label><input className={inputCls} value={form.lastName} onChange={(e) => updateField("lastName", e.target.value)} /></div>
                    <div><label className={labelCls}>Date*</label><input type="date" className={inputCls} value={form.date} onChange={(e) => updateField("date", e.target.value)} /></div>
                    <div>
                      <label className={labelCls}>Branch*</label>
                      <select className={inputCls} value={form.branch} onChange={(e) => updateField("branch", e.target.value)}>
                        <option value="">Please Select</option>
                        {VEHICLE_USE_AGREEMENT_BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                <div>
                  <label className={labelCls}>Contractor's Signature</label>
                  <canvas
                    {...sigPad.canvasProps}
                    className={`bg-white rounded-md border border-white/15 block mx-auto w-full max-w-md mt-1 ${sigPad.canvasProps.className}`}
                  />
                  <div className="mt-2">
                    <SignaturePadControls pad={sigPad} />
                  </div>
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
                    <style dangerouslySetInnerHTML={{ __html: vehicleUseAgreementStyles }} />
                    <div dangerouslySetInnerHTML={{ __html: buildVehicleUseAgreementBodyMarkup(previewData, logoDataUrl, undefined) }} />
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
