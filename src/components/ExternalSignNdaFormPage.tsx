/**
 * External Sign Non-Disclosure Agreement — the no-login counterpart to
 * SignNdaFormPage.tsx, mirroring ExternalSignActionPlanFormPage.tsx (talks
 * only to /api/signable-documents, since an anonymous visitor has no
 * Supabase session for RLS to scope to). Same 4-step Back/Next/Submit
 * wizard as the logged-in version — see ndaFormTemplate.ts's header
 * comment and SignNdaFormPage.tsx's own header comment for the full shape.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import logo from "@/assets/Admin Hub Solutions Logo no Text.png";
import { captureHtmlPagesToPdfBlob, loadAssetDataUrl } from "@/lib/pdfCapture";
import { buildNdaFormPages, ndaFormStyles, type NdaFormData } from "@/lib/ndaFormTemplate";
import { NdaPage1Editable } from "@/components/NdaPage1Editable";
import { useSignaturePad } from "@/hooks/useSignaturePad";
import { SignaturePadControls } from "@/components/SignaturePad";

interface Props {
  docId: string;
}

interface ExternalDoc {
  id: string;
  documentType: string;
  formData: NdaFormData;
  signatures: Partial<Record<string, { name: string; url: string; signedAt: string }>>;
  status: string;
  recipientName: string | null;
}

const BLANK_FORM: NdaFormData = {
  employeeId: "",
  employeeName: "",
  nationality: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  branch: "",
  dateSigned: "",
};

const TOTAL_STEPS = 4;

export function ExternalSignNdaFormPage({ docId }: Props) {
  const [doc, setDoc] = useState<ExternalDoc | null>(null);
  const [companyLogo, setCompanyLogo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState(false);
  const [step, setStep] = useState(1);

  const [form, setForm] = useState<NdaFormData>({ ...BLANK_FORM });

  const sigPad = useSignaturePad({ width: 640, height: 180 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [logoUrl, res] = await Promise.all([
          loadAssetDataUrl(() => import("@/assets/us-in-home-services-logo.png")),
          fetch(`/api/signable-documents?id=${encodeURIComponent(docId)}`),
        ]);
        if (cancelled) return;
        setCompanyLogo(logoUrl);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(res.status === 404 ? "This link isn't valid, or the document doesn't use link-based signing." : (body.error || "Failed to load document."));
          return;
        }
        const d = (await res.json()) as ExternalDoc;
        setDoc(d);
        setForm((prev) => ({ ...prev, ...d.formData, dateSigned: d.formData?.dateSigned || new Date().toISOString() }));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load document.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [docId]);

  const updateField = <K extends keyof NdaFormData>(key: K, value: NdaFormData[K]) => setForm((f) => ({ ...f, [key]: value }));

  const step1Error = (): string | null => {
    if (!form.employeeName.trim()) return "Enter your full name.";
    if (!form.nationality.trim()) return "Enter your nationality.";
    if (!form.address.trim()) return "Enter your street address.";
    if (!form.city.trim()) return "Enter your city.";
    if (!form.state.trim()) return "Enter your state.";
    if (!form.zip.trim()) return "Enter your zip code.";
    if (!form.dateSigned.trim()) return "Pick the date.";
    return null;
  };

  const goNext = () => {
    if (step === 1) {
      const err = step1Error();
      if (err) { setError(err); return; }
    }
    setError(null);
    setStep((s) => Math.min(TOTAL_STEPS, s + 1));
  };

  const goBack = () => {
    setError(null);
    setStep((s) => Math.max(1, s - 1));
  };

  const handleConfirmSign = async () => {
    if (!doc) return;
    const fieldsError = step1Error();
    if (fieldsError) {
      setError(fieldsError);
      return;
    }
    if (!sigPad.hasContent()) {
      setError("Please add your signature.");
      return;
    }
    const dataUrl = sigPad.toDataURL();
    if (!dataUrl) {
      setError("Please add your signature.");
      return;
    }
    setSigning(true);
    setError(null);
    try {
      const signedAt = new Date().toISOString();
      // The document's own "Date" field is whatever the recipient picked on
      // page 1 (see NdaPage1Editable) — signedAt below is a separate audit
      // timestamp, not what's printed on the PDF.
      const finalData: NdaFormData = { ...form };
      const signatureBlob = await (await fetch(dataUrl)).blob();
      const captureSignatures = { employee: { name: doc.recipientName || form.employeeName || "Signed", url: dataUrl, signedAt } };
      const pages = buildNdaFormPages(finalData, companyLogo, captureSignatures.employee);
      const pdfBlob = await captureHtmlPagesToPdfBlob(pages, ndaFormStyles);

      const body = new FormData();
      body.set("signatureFile", signatureBlob, "signature.png");
      body.set("pdfFile", pdfBlob, "signed.pdf");
      body.set("formData", JSON.stringify(finalData));
      const res = await fetch(`/api/signable-documents?id=${encodeURIComponent(docId)}&action=sign`, { method: "POST", body });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || "Failed to submit signature.");
      }

      setDoc({ ...doc, status: "signed", formData: finalData, signatures: captureSignatures });
      setSigned(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit signature.");
    } finally {
      setSigning(false);
    }
  };

  // Reflects whatever's currently on the signature pad (drawn or typed) in
  // every page's preview, not just at final submit — so once the recipient
  // signs at step 4, stepping back to pages 1-3 shows it already stamped
  // there, same as the final PDF will.
  const livePreviewSignature = sigPad.hasContent()
    ? { name: doc?.recipientName || form.employeeName || "Signed", url: sigPad.toDataURL() || "", signedAt: form.dateSigned }
    : undefined;
  const currentPages = buildNdaFormPages(form, companyLogo, livePreviewSignature);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto p-4">
        <div className="flex justify-center mb-4">
          <img src={logo} alt="Admin Hub Solutions" className="h-10 w-auto opacity-80" />
        </div>

        {loading ? (
          <div className="panel p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading document…
          </div>
        ) : error && !doc ? (
          <div className="panel p-6 text-sm text-red-300">{error}</div>
        ) : !doc ? null : signed || doc.status === "signed" ? (
          <div className="panel p-6 text-center">
            <p className="text-sm font-semibold mb-2">✅ Signed{signed ? " and sent back to HR" : ""}.</p>
            <p className="text-xs text-muted-foreground">You can close this page now.</p>
          </div>
        ) : (
          <div className="panel p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-end">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Page {step} of {TOTAL_STEPS}</span>
            </div>

            <div className="overflow-x-auto bg-white/5 p-4 flex justify-center">
              <div style={{ transform: "scale(0.78)", transformOrigin: "top center" }}>
                <style dangerouslySetInnerHTML={{ __html: ndaFormStyles }} />
                {step === 1 ? (
                  <NdaPage1Editable data={form} logoDataUrl={companyLogo} updateField={updateField} signatureUrl={livePreviewSignature?.url} />
                ) : (
                  <div dangerouslySetInnerHTML={{ __html: currentPages[step - 1] }} />
                )}
              </div>
            </div>

            {/* Visible on every step, not just step 4 — signing early lets
                the recipient page back through 1-3 and see it already
                stamped on the live preview above, instead of only finding
                out how it looks after reaching the last page. */}
            <div className="p-4 border-t border-white/10">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Signature</label>
              <canvas
                {...sigPad.canvasProps}
                className={`bg-white rounded-md border border-white/15 block mx-auto w-full max-w-xl ${sigPad.canvasProps.className}`}
              />
              <div className="mt-2">
                <SignaturePadControls pad={sigPad} />
              </div>
            </div>

            {error && (
              <p className="mx-4 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2 mt-3">{error}</p>
            )}

            <div className="p-4 border-t border-white/10 flex items-center justify-between gap-2">
              <button
                onClick={goBack}
                disabled={step === 1 || signing}
                className="btn text-sm px-4 py-2 disabled:opacity-40"
              >
                Back
              </button>
              {step < TOTAL_STEPS ? (
                <button
                  onClick={goNext}
                  className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white"
                >
                  Next
                </button>
              ) : (
                <button
                  onClick={handleConfirmSign}
                  disabled={signing}
                  className="btn text-sm px-4 py-2 bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
                >
                  {signing ? "Submitting…" : "Submit"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
