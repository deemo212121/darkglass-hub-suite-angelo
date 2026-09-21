/**
 * Fill SSN Card — opened from the deep link a Team Messenger message sends
 * (see ReportHRDaily.tsx's "SSN Card" tab "Send Request" flow). Standalone
 * counterpart to the SSN-card field that used to be embedded in Contractor
 * Data Sheet / Master W-2 Technician & Office Agreements — see
 * ssnCardFormTemplate.ts's header comment. Single-party, same shape as
 * FillContractorDataPage.tsx's identification section, trimmed down to
 * just this one document.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { FillFormSignInRequired } from "@/components/FillFormSignInRequired";
import { getMyProfileId } from "@/lib/supabase/users";
import { getSignableDocument, signDocument, type SignableDocument } from "@/lib/supabase/signableDocuments";
import { uploadSignableDocumentSignature, uploadSignableDocumentAttachment, uploadSsnCardForm, refreshStorageAuthToken } from "@/lib/firebase/storage";
import { compressImage } from "@/lib/imageCompression";
import { captureHtmlToPdfBlob, loadAssetDataUrl } from "@/lib/pdfCapture";
import { buildSsnCardFormBodyMarkup, ssnCardFormStyles, type SsnCardFormData } from "@/lib/ssnCardFormTemplate";
import { getOrCreateDmThread, sendMessage } from "@/lib/supabase/messaging";
import { logActivity } from "@/lib/supabase/hrActivityLog";
import { getHrNotificationSettings } from "@/lib/supabase/companySettings";
import { notifyHrRoleUsers } from "@/lib/supabase/hrRoleNotify";
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

async function compressForUpload(file: File): Promise<File> {
  try {
    const result = await compressImage(file);
    const ext = result.mimeType === "image/webp" ? "webp" : result.mimeType === "image/png" ? "png" : "jpg";
    return new File([result.blob], file.name.replace(/\.[^.]+$/, `.${ext}`), { type: result.mimeType });
  } catch (err) {
    console.error("[ssn-card] photo compression failed, uploading original:", err);
    return file;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, step: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${step} is taking too long — check your connection and try again.`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

export function FillSsnCardPage({ docId }: Props) {
  const { ready, uid, displayName, role } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [doc, setDoc] = useState<SignableDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitStep, setSubmitStep] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [logoDataUrl, setLogoDataUrl] = useState("");

  const [form, setForm] = useState<SsnCardFormData>({ ...BLANK_FORM });
  const [cardFiles, setCardFiles] = useState<File[]>([]);

  const sigPad = useSignaturePad({ defaultName: form.employeeName, width: 500, height: 130 });

  useEffect(() => {
    loadAssetDataUrl(() => import("@/assets/us-in-home-services-logo.png")).then(setLogoDataUrl);
  }, []);

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
        if (!document || document.documentType !== "ssn_card_form") {
          setError("This document doesn't exist or has been removed.");
        } else {
          setDoc(document);
          setForm((prev) => ({ ...prev, ...(document.formData as Partial<SsnCardFormData>) }));
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load document.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ready, uid, docId]);

  const updateField = <K extends keyof SsnCardFormData>(key: K, value: SsnCardFormData[K]) => setForm((f) => ({ ...f, [key]: value }));

  const validate = (): string | null => {
    if (!form.employeeName.trim()) return "Enter your full name.";
    if (!form.ssn.trim()) return "Enter your Social Security Number.";
    if (cardFiles.length === 0) return "Upload a photo of your Social Security Card.";
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

      setSubmitStep("Preparing upload…");
      await withTimeout(refreshStorageAuthToken(), 15_000, "Preparing upload");

      setSubmitStep(`Uploading SSN card${cardFiles.length > 1 ? "s" : ""}…`);
      const compressedFiles = await Promise.all(cardFiles.map(compressForUpload));
      const cardPhotoUrls = await withTimeout(
        Promise.all(compressedFiles.map((file, i) => uploadSignableDocumentAttachment(companyId, doc.id, "cardPhotoUrls", i, file))),
        60_000,
        "Uploading SSN card"
      );

      setSubmitStep("Uploading signature…");
      const signatureUrl = await withTimeout(uploadSignableDocumentSignature(companyId, doc.id, "employee", dataUrl), 30_000, "Uploading signature");
      const signedAt = new Date().toISOString();
      const finalData: SsnCardFormData = { ...form, cardPhotoUrls, dateSigned: signedAt, signatureDataUrl: dataUrl };
      const entry = { name: displayName || form.employeeName || "Signed", url: signatureUrl, signedAt };

      setSubmitStep("Generating document…");
      const pdfBlob = await withTimeout(
        captureHtmlToPdfBlob(buildSsnCardFormBodyMarkup(finalData, logoDataUrl, entry), ssnCardFormStyles),
        30_000,
        "Generating document"
      );
      const pdfUrl = await withTimeout(uploadSsnCardForm(companyId, form.employeeName, pdfBlob), 60_000, "Uploading document");

      setSubmitStep("Saving…");
      await withTimeout(signDocument(doc.id, "employee", entry, pdfUrl, finalData as unknown as Record<string, any>), 20_000, "Saving");

      if (doc.createdBy) {
        try {
          const thread = await getOrCreateDmThread(myProfileId, doc.createdBy);
          const filename = `SSN Card - ${form.employeeName}.pdf`;
          await sendMessage({
            dmThreadId: thread.id,
            senderId: myProfileId,
            senderName: displayName || "Employee",
            body: `📄 SSN Card for ${form.employeeName} has been submitted: [${filename}](${pdfUrl})`,
          });
        } catch (notifyErr) {
          console.error("[ssn-card] DM notify to creator failed:", notifyErr);
        }
      }

      getHrNotificationSettings()
        .then(({ taxForms }) => {
          if (!taxForms) return;
          const excludeIds = doc.createdBy ? [doc.createdBy] : [];
          void notifyHrRoleUsers(myProfileId, displayName || "Employee", excludeIds, `📄 SSN Card for ${form.employeeName} has been submitted.`);
        })
        .catch((err) => console.error("[ssn-card] hr notify check failed:", err));

      setDoc({ ...doc, status: "signed", pdfUrl, formData: finalData as unknown as Record<string, any>, signatures: { employee: entry }, signedAt });
      void logActivity({ action: "ssn_card_signed", targetType: "employee", targetLabel: form.employeeName });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit form.");
    } finally {
      setSubmitting(false);
      setSubmitStep(null);
    }
  };

  const isRecipient = !!doc && !!myProfileId && doc.recipientId === myProfileId;
  const isSuperadmin = role === "SUPERSUPERADMIN";

  const previewData: SsnCardFormData = useMemo(
    () => ({ ...form, cardPhotoUrls: cardFiles.map((f) => URL.createObjectURL(f)) }),
    [form, cardFiles]
  );

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-5xl mx-auto p-4">
        <Link to="/home" className="btn text-xs px-2.5 py-1.5 flex items-center gap-1 w-fit mb-4">
          <ChevronLeft className="h-3.5 w-3.5" /> Home
        </Link>

        {(ready && !uid) ? (
          <FillFormSignInRequired />
        ) : loading ? (
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
                  {submitting ? (submitStep || "Submitting…") : "Submit to HR"}
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
      </main>
    </div>
  );
}
