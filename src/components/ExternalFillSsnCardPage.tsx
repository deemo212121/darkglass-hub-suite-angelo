/**
 * External Fill SSN Card — the no-login counterpart to FillSsnCardPage.tsx.
 * See ExternalFillContractorDataPage.tsx's header comment for the shared
 * external-flow shape (server bridge, `attachment_*` files).
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import logo from "@/assets/Admin Hub Solutions Logo no Text.png";
import { getExternalSignableDocument, submitExternalSignature, type ExternalSignableDocument } from "@/lib/supabase/externalSignableDocuments";
import { captureHtmlToPdfBlob, loadAssetDataUrl } from "@/lib/pdfCapture";
import { buildSsnCardFormBodyMarkup, ssnCardFormStyles, type SsnCardFormData } from "@/lib/ssnCardFormTemplate";
import { useSignaturePad } from "@/hooks/useSignaturePad";
import { SignaturePadControls } from "@/components/SignaturePad";

interface Props {
  docId: string;
}

const BLANK_FORM: SsnCardFormData = {
  employeeId: "",
  employeeName: "",
  ssn: "",
  cardPhotoUrls: [],
  dateSigned: "",
  signatureDataUrl: "",
};

const inputCls = "glass-input text-sm py-1.5 px-3 rounded-md w-full";
const labelCls = "text-[10px] font-semibold text-muted-foreground uppercase tracking-wide";

export function ExternalFillSsnCardPage({ docId }: Props) {
  const [doc, setDoc] = useState<ExternalSignableDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedPdfUrl, setSubmittedPdfUrl] = useState<string | null>(null);
  const [logoDataUrl, setLogoDataUrl] = useState("");

  const [form, setForm] = useState<SsnCardFormData>({ ...BLANK_FORM });
  const [cardFiles, setCardFiles] = useState<File[]>([]);

  const sigPad = useSignaturePad({ defaultName: form.employeeName, width: 500, height: 130 });

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
        if (!document || document.documentType !== "ssn_card_form") {
          setError("This link isn't valid, or the document doesn't use link-based signing.");
        } else {
          setDoc(document);
          const existing = document.formData as Partial<SsnCardFormData>;
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

  const updateField = <K extends keyof SsnCardFormData>(key: K, value: SsnCardFormData[K]) => setForm((f) => ({ ...f, [key]: value }));

  const validate = (): string | null => {
    if (!form.employeeName.trim()) return "Enter your full name.";
    if (!form.ssn.trim()) return "Enter your Social Security Number.";
    if (cardFiles.length === 0) return "Upload a photo of your Social Security Card.";
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
      const finalData: SsnCardFormData = { ...form, dateSigned: signedAt, signatureDataUrl: dataUrl };

      const pdfBlob = await captureHtmlToPdfBlob(
        buildSsnCardFormBodyMarkup({ ...finalData, cardPhotoUrls: cardFiles.map((f) => URL.createObjectURL(f)) }, logoDataUrl, { name: form.employeeName, url: dataUrl, signedAt }),
        ssnCardFormStyles
      );

      const { pdfUrl } = await submitExternalSignature(docId, {
        signatureBlob,
        pdfBlob,
        formData: finalData as unknown as Record<string, any>,
        attachments: { cardPhotoUrls: cardFiles },
      });

      setSubmittedPdfUrl(pdfUrl);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit form.");
    } finally {
      setSubmitting(false);
    }
  };

  const previewData: SsnCardFormData = useMemo(
    () => ({ ...form, cardPhotoUrls: cardFiles.map((f) => URL.createObjectURL(f)) }),
    [form, cardFiles]
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto p-4">
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
            {submittedPdfUrl ? (
              <a href={submittedPdfUrl} target="_blank" rel="noreferrer noopener" className="text-blue-300 hover:text-blue-200 underline text-sm">View the completed PDF</a>
            ) : (
              <p className="text-xs text-muted-foreground">You can close this page now.</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="panel p-4 flex-1 min-w-0">
              <p className="text-xs text-muted-foreground mb-4">Please make sure to fill out the form correctly. Thank you!</p>
              <div className="flex flex-col gap-4">
                <div>
                  <label className={labelCls}>Full Name*</label>
                  <input className={inputCls} value={form.employeeName} onChange={(e) => updateField("employeeName", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Social Security Number*</label>
                  <input className={inputCls} value={form.ssn} onChange={(e) => updateField("ssn", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>SSN Card Photo*</label>
                  <input type="file" multiple accept="image/*" className={inputCls} onChange={(e) => setCardFiles(Array.from(e.target.files ?? []))} />
                </div>

                <div>
                  <label className={labelCls}>Signature</label>
                  <canvas {...sigPad.canvasProps} className={`bg-white rounded-md border border-white/15 block mx-auto w-full max-w-md mt-1 ${sigPad.canvasProps.className}`} />
                  <div className="mt-2"><SignaturePadControls pad={sigPad} /></div>
                </div>

                {error && <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{error}</p>}

                <button onClick={handleSubmit} disabled={submitting} className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 w-fit">
                  {submitting ? "Submitting…" : "Submit"}
                </button>
              </div>
            </div>

            <div className="lg:w-[420px] shrink-0">
              <div className="panel p-4 sticky top-4">
                <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Live Preview</h2>
                <div className="overflow-auto bg-white/5 rounded-md p-2" style={{ maxHeight: "80vh" }}>
                  <div style={{ transform: "scale(0.45)", transformOrigin: "top left", width: "816px" }}>
                    <style dangerouslySetInnerHTML={{ __html: ssnCardFormStyles }} />
                    <div dangerouslySetInnerHTML={{ __html: buildSsnCardFormBodyMarkup(previewData, logoDataUrl, undefined) }} />
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
