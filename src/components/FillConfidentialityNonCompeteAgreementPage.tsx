/**
 * Fill Master Confidentiality, Non-Solicitation, Non-Compete, and
 * Affirmative Duty Agreement — opened from the deep link ReportHRDaily.tsx's
 * "Master Confidentiality & Non-Compete Agreement" tab sends. HTML/CSS document
 * (confidentialityNonCompeteAgreementFormTemplate.ts), rendered live as a
 * preview of exactly what gets captured to PDF on submit — same pattern as
 * FillMasterW2ExecutiveAgreementPage.tsx.
 *
 * Two-party: only the employee half is filled here (legal name, residence,
 * signature; the Effective Date is the day they sign). The employer
 * representative countersigns afterward from HR Paperworks.
 */
import { InlinePdfLink } from "@/components/InlinePdfViewer";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { FillFormSignInRequired } from "@/components/FillFormSignInRequired";
import { getMyProfileId } from "@/lib/supabase/users";
import { getSignableDocument, signDocument, type SignableDocument } from "@/lib/supabase/signableDocuments";
import { uploadSignableDocumentSignature, uploadConfidentialityNonCompeteAgreementForm, refreshStorageAuthToken } from "@/lib/firebase/storage";
import { loadAssetDataUrl } from "@/lib/pdfCapture";
import {
  confidentialityNonCompeteAgreementStyles,
  buildConfidentialityNonCompeteAgreementBodyMarkup,
  captureConfidentialityNonCompeteAgreementPdf,
  confidentialityAgreementTitle,
  CNC_CURRENT_TEMPLATE_VERSION,
  type ConfidentialityNonCompeteAgreementFormData,
} from "@/lib/confidentialityNonCompeteAgreementFormTemplate";
import { getOrCreateDmThread, sendMessage } from "@/lib/supabase/messaging";
import { logActivity } from "@/lib/supabase/hrActivityLog";
import { getHrNotificationSettings } from "@/lib/supabase/companySettings";
import { notifyHrRoleUsers } from "@/lib/supabase/hrRoleNotify";
import { useSignaturePad } from "@/hooks/useSignaturePad";
import { SignaturePadControls } from "@/components/SignaturePad";

interface Props {
  docId: string;
}


const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const BLANK_FORM: ConfidentialityNonCompeteAgreementFormData = {
  employeeId: "",
  employeeName: "",
  residingAddress: "",
  effectiveDate: "",
  employeeDateSigned: "",
  employeeSignatureDataUrl: "",
  employerDateSigned: "",
  employerSignatureDataUrl: "",
  employerPrintedNameTitle: "",
};

export function FillConfidentialityNonCompeteAgreementPage({ docId }: Props) {
  const { ready, uid, displayName } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [doc, setDoc] = useState<SignableDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [logoDataUrl, setLogoDataUrl] = useState("");

  const [form, setForm] = useState<ConfidentialityNonCompeteAgreementFormData>({ ...BLANK_FORM });

  const sigPad = useSignaturePad({ width: 440, height: 100 });

  useEffect(() => {
    if (!ready || !uid) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [profileId, document, logo] = await Promise.all([
          getMyProfileId(uid),
          getSignableDocument(docId),
          loadAssetDataUrl(() => import("@/assets/us-in-home-services-logo.png")),
        ]);
        if (cancelled) return;
        setMyProfileId(profileId);
        setLogoDataUrl(logo);
        if (!document || document.documentType !== "confidentiality_noncompete_agreement") {
          setError("This document doesn't exist or has been removed.");
        } else {
          setDoc(document);
          const existing = document.formData as Partial<ConfidentialityNonCompeteAgreementFormData>;
          // Not signed yet: it's signed in the current wording. Already signed
          // (or reopened for the employer): keep the wording it was signed in.
          const unsigned = document.status === "pending_signature" && document.recipientSlot === "employee";
          setForm((prev) => ({ ...prev, ...existing, ...(unsigned ? { templateVersion: CNC_CURRENT_TEMPLATE_VERSION } : {}) }));
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load document.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ready, uid, docId]);

  // Version 2 has no "residing at" line, so it doesn't ask for an address.
  const noResidenceLine = (form.templateVersion ?? 1) >= 2;
  const agreementTitle = confidentialityAgreementTitle(form.templateVersion);

  const updateField = <K extends keyof ConfidentialityNonCompeteAgreementFormData>(key: K, value: ConfidentialityNonCompeteAgreementFormData[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const validate = (): string | null => {
    if (!form.employeeName.trim()) return "Enter your full legal name.";
    if (!noResidenceLine && !form.residingAddress.trim()) return "Enter the address where you live.";
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
      await refreshStorageAuthToken();

      const signatureUrl = await uploadSignableDocumentSignature(companyId, doc.id, "employee", dataUrl);
      const signedAt = new Date().toISOString();
      const finalData: ConfidentialityNonCompeteAgreementFormData = {
        ...form,
        employeeName: form.employeeName.trim(),
        residingAddress: form.residingAddress.trim(),
        effectiveDate: form.effectiveDate || todayIso(),
        employeeDateSigned: signedAt,
        employeeSignatureDataUrl: dataUrl,
      };
      const entry = { name: displayName || finalData.employeeName || "Signed", url: signatureUrl, signedAt };

      const pdfBlob = await captureConfidentialityNonCompeteAgreementPdf(finalData, logoDataUrl);
      const pdfUrl = await uploadConfidentialityNonCompeteAgreementForm(companyId, finalData.employeeName, pdfBlob);

      await signDocument(doc.id, "employee", entry, pdfUrl, finalData as unknown as Record<string, any>);

      if (doc.createdBy) {
        const thread = await getOrCreateDmThread(myProfileId, doc.createdBy);
        await sendMessage({
          dmThreadId: thread.id,
          senderId: myProfileId,
          senderName: displayName || "Employee",
          body: `📋 ${agreementTitle} for ${finalData.employeeName} has been signed, and is ready for the employer representative's signature: ${pdfUrl}`,
        });
      }

      getHrNotificationSettings()
        .then(({ taxForms }) => {
          if (!taxForms) return;
          const excludeIds = doc.createdBy ? [doc.createdBy] : [];
          void notifyHrRoleUsers(myProfileId, displayName || "Employee", excludeIds, `📋 ${agreementTitle} for ${finalData.employeeName} has been signed — the employer signature is ready to be added.`);
        })
        .catch((err) => console.error("[confidentiality-noncompete-agreement] hr notify check failed:", err));

      setDoc({ ...doc, status: "signed", pdfUrl, formData: finalData as unknown as Record<string, any>, signatures: { employee: entry }, signedAt });
      void logActivity({ action: "confidentiality_noncompete_agreement_signed", targetType: "employee", targetLabel: finalData.employeeName });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit form.");
    } finally {
      setSubmitting(false);
    }
  };

  const isRecipient = !!doc && !!myProfileId && doc.recipientId === myProfileId;
  // Preview shows today as the Effective Date — it becomes the signing day.
  const previewData = { ...form, effectiveDate: form.effectiveDate || todayIso() };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-4xl mx-auto p-4">
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
        ) : !doc ? null : !isRecipient ? (
          <div className="panel p-6 text-sm text-muted-foreground">This document isn't addressed to your account.</div>
        ) : submitted || doc.status === "signed" || doc.status === "confirmed" ? (
          <div className="panel p-6 text-center">
            <p className="text-sm font-semibold mb-2">✓ Submitted{submitted ? " and sent to HR" : ""}.</p>
            <p className="text-xs text-muted-foreground mb-2">The employer representative will add their signature separately.</p>
            {doc.pdfUrl && (
              <InlinePdfLink url={doc.pdfUrl} label="View the completed PDF" className="text-blue-300 hover:text-blue-200 underline text-sm" />
            )}
          </div>
        ) : (
          <div className="panel p-4">
            <h1 className="text-lg font-bold mb-1">{agreementTitle}</h1>
            <p className="text-xs text-muted-foreground mb-4">
              Fill in your information below, read the whole agreement, then sign and submit.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Printed Full Legal Name</label>
                <input className="glass-input text-sm py-1.5 px-3 rounded-md w-full" value={form.employeeName} onChange={(e) => updateField("employeeName", e.target.value)} />
              </div>
              {!noResidenceLine && (
                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Residing At (home address)</label>
                  <input className="glass-input text-sm py-1.5 px-3 rounded-md w-full" value={form.residingAddress} onChange={(e) => updateField("residingAddress", e.target.value)} placeholder="Street, City, State ZIP" />
                </div>
              )}
            </div>

            <p className="text-xs text-muted-foreground mb-2">Read the agreement below, then sign at the bottom.</p>
            <div className="overflow-x-auto bg-white/5 rounded-md p-4 flex justify-center">
              <style dangerouslySetInnerHTML={{ __html: confidentialityNonCompeteAgreementStyles }} />
              <div dangerouslySetInnerHTML={{ __html: buildConfidentialityNonCompeteAgreementBodyMarkup(previewData, logoDataUrl) }} />
            </div>

            <div className="mt-4">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Add your signature</label>
              <canvas
                {...sigPad.canvasProps}
                className={`bg-white rounded-md border border-white/15 w-full ${sigPad.canvasProps.className}`}
              />
              <div className="flex justify-center mt-2">
                <SignaturePadControls pad={sigPad} />
              </div>
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
