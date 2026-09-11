/**
 * Fill Master Philippines Independent Contractor Comprehensive Agreement —
 * opened from the deep link ReportHRDaily.tsx's "Master PH Contractor
 * Agreement" tab "Send Request" flow sends. HTML/CSS document (no source
 * PDF to overlay — see masterPhContractorAgreementFormTemplate.ts's header
 * comment), rendered live as a preview of exactly what gets captured to PDF
 * on submit, same "preview what's about to be signed" pattern
 * SignActionPlanFormPage.tsx uses.
 *
 * Genuine two-party document: only the contractor half is filled here; the
 * employer/HR countersignature happens separately afterward
 * (ReportHRDaily.tsx's "Complete Employer Signature" dialog, or
 * ManagerReviewPage.tsx for a non-HR manager it's been reassigned to). No
 * license/SSN photo capture.
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import { getSignableDocument, signDocument, type SignableDocument } from "@/lib/supabase/signableDocuments";
import { uploadSignableDocumentSignature, uploadMasterPhContractorAgreementForm, refreshStorageAuthToken } from "@/lib/firebase/storage";
import { captureHtmlToPdfBlob, loadAssetDataUrl } from "@/lib/pdfCapture";
import {
  masterPhContractorAgreementStyles,
  buildMasterPhContractorAgreementBodyMarkup,
  type MasterPhContractorAgreementFormData,
} from "@/lib/masterPhContractorAgreementFormTemplate";
import { getOrCreateDmThread, sendMessage } from "@/lib/supabase/messaging";
import { logActivity } from "@/lib/supabase/hrActivityLog";
import { getHrNotificationSettings } from "@/lib/supabase/companySettings";
import { notifyHrRoleUsers } from "@/lib/supabase/hrRoleNotify";
import { useSignaturePad } from "@/hooks/useSignaturePad";
import { SignaturePadControls } from "@/components/SignaturePad";

interface Props {
  docId: string;
}

const BLANK_FORM: MasterPhContractorAgreementFormData = {
  employeeId: "",
  employeeName: "",
  firstName: "",
  middleName: "",
  lastName: "",
  nationality: "",
  nationalityOther: "",
  addressStreet: "",
  addressCity: "",
  addressState: "",
  addressZip: "",
  addressCountry: "",
  phone: "",
  otherPhone: "",
  email: "",
  dateOfBirth: "",
  startDate: "",
  maritalStatus: "",
  spouseName: "",
  spouseEmployer: "",
  contractorDateSigned: "",
  contractorSignatureDataUrl: "",
  employerDateSigned: "",
  employerSignatureDataUrl: "",
};

export function FillMasterPhContractorAgreementPage({ docId }: Props) {
  const { ready, uid, displayName } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [doc, setDoc] = useState<SignableDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [logoDataUrl, setLogoDataUrl] = useState("");

  const [form, setForm] = useState<MasterPhContractorAgreementFormData>({ ...BLANK_FORM });

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
        if (!document || document.documentType !== "master_ph_contractor_agreement") {
          setError("This document doesn't exist or has been removed.");
        } else {
          setDoc(document);
          const existing = document.formData as Partial<MasterPhContractorAgreementFormData>;
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

  const updateField = <K extends keyof MasterPhContractorAgreementFormData>(key: K, value: MasterPhContractorAgreementFormData[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const validate = (): string | null => {
    if (!form.firstName.trim()) return "Enter your first name.";
    if (!form.lastName.trim()) return "Enter your last name.";
    if (!form.nationality) return "Select your nationality.";
    if (form.nationality === "Other" && !form.nationalityOther.trim()) return "Specify your nationality.";
    if (!form.addressStreet.trim() || !form.addressCity.trim() || !form.addressState.trim() || !form.addressZip.trim() || !form.addressCountry.trim()) return "Fill in your complete current address.";
    if (!form.phone.trim()) return "Enter your phone number.";
    if (!form.email.trim()) return "Enter your email address.";
    if (!form.dateOfBirth) return "Enter your date of birth.";
    if (!form.startDate) return "Enter your start date.";
    if (!form.maritalStatus) return "Select your marital status.";
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
      const signatureUrl = await uploadSignableDocumentSignature(companyId, doc.id, "employee", dataUrl);
      const signedAt = new Date().toISOString();
      const finalData: MasterPhContractorAgreementFormData = {
        ...form,
        employeeName,
        contractorDateSigned: signedAt,
        contractorSignatureDataUrl: dataUrl,
      };
      const entry = { name: displayName || employeeName || "Signed", url: signatureUrl, signedAt };

      const pdfBlob = await captureHtmlToPdfBlob(buildMasterPhContractorAgreementBodyMarkup(finalData, logoDataUrl), masterPhContractorAgreementStyles);
      const pdfUrl = await uploadMasterPhContractorAgreementForm(companyId, employeeName, pdfBlob);

      await signDocument(doc.id, "employee", entry, pdfUrl, finalData as unknown as Record<string, any>);

      if (doc.createdBy) {
        const thread = await getOrCreateDmThread(myProfileId, doc.createdBy);
        await sendMessage({
          dmThreadId: thread.id,
          senderId: myProfileId,
          senderName: displayName || "Contractor",
          body: `📋 Master Philippines Independent Contractor Comprehensive Agreement for ${employeeName} has been signed, and is ready for the employer signature: ${pdfUrl}`,
        });
      }

      getHrNotificationSettings()
        .then(({ taxForms }) => {
          if (!taxForms) return;
          const excludeIds = doc.createdBy ? [doc.createdBy] : [];
          void notifyHrRoleUsers(myProfileId, displayName || "Contractor", excludeIds, `📋 Master Philippines Independent Contractor Comprehensive Agreement for ${employeeName} has been signed — the employer signature is ready to be added.`);
        })
        .catch((err) => console.error("[master-ph-contractor-agreement] hr notify check failed:", err));

      setDoc({ ...doc, status: "signed", pdfUrl, formData: finalData as unknown as Record<string, any>, signatures: { employee: entry }, signedAt });
      void logActivity({ action: "master_ph_contractor_agreement_signed", targetType: "employee", targetLabel: employeeName });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit form.");
    } finally {
      setSubmitting(false);
    }
  };

  const isRecipient = !!doc && !!myProfileId && doc.recipientId === myProfileId;

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
        ) : !doc ? null : !isRecipient ? (
          <div className="panel p-6 text-sm text-muted-foreground">This document isn't addressed to your account.</div>
        ) : submitted || doc.status === "signed" || doc.status === "confirmed" ? (
          <div className="panel p-6 text-center">
            <p className="text-sm font-semibold mb-2">✓ Submitted{submitted ? " and sent to HR" : ""}.</p>
            <p className="text-xs text-muted-foreground mb-2">HR will add the employer signature separately.</p>
            {doc.pdfUrl && (
              <a href={doc.pdfUrl} target="_blank" rel="noreferrer noopener" className="text-blue-300 hover:text-blue-200 underline text-sm">
                View the completed PDF
              </a>
            )}
          </div>
        ) : (
          <div className="panel p-4">
            <h1 className="text-lg font-bold mb-1">Master Philippines Independent Contractor Agreement</h1>
            <p className="text-xs text-muted-foreground mb-4">
              Fill in your information below, read the agreement, then sign and submit.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">First Name</label>
                <input className="glass-input text-sm py-1.5 px-3 rounded-md w-full" value={form.firstName} onChange={(e) => updateField("firstName", e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Middle Name</label>
                <input className="glass-input text-sm py-1.5 px-3 rounded-md w-full" value={form.middleName} onChange={(e) => updateField("middleName", e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Last Name</label>
                <input className="glass-input text-sm py-1.5 px-3 rounded-md w-full" value={form.lastName} onChange={(e) => updateField("lastName", e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Nationality</label>
                <select className="glass-input text-sm py-1.5 px-3 rounded-md w-full" value={form.nationality} onChange={(e) => updateField("nationality", e.target.value)}>
                  <option value="">Select…</option>
                  <option value="Philippines">Philippines</option>
                  <option value="USA">USA</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              {form.nationality === "Other" && (
                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Specify Nationality</label>
                  <input className="glass-input text-sm py-1.5 px-3 rounded-md w-full" value={form.nationalityOther} onChange={(e) => updateField("nationalityOther", e.target.value)} />
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 mb-3">
              <div className="sm:col-span-2">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Street Address</label>
                <input className="glass-input text-sm py-1.5 px-3 rounded-md w-full" value={form.addressStreet} onChange={(e) => updateField("addressStreet", e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">City</label>
                <input className="glass-input text-sm py-1.5 px-3 rounded-md w-full" value={form.addressCity} onChange={(e) => updateField("addressCity", e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">State / Province</label>
                <input className="glass-input text-sm py-1.5 px-3 rounded-md w-full" value={form.addressState} onChange={(e) => updateField("addressState", e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Zip Code</label>
                <input className="glass-input text-sm py-1.5 px-3 rounded-md w-full" value={form.addressZip} onChange={(e) => updateField("addressZip", e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Country</label>
                <input className="glass-input text-sm py-1.5 px-3 rounded-md w-full" value={form.addressCountry} onChange={(e) => updateField("addressCountry", e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Phone Number</label>
                <input className="glass-input text-sm py-1.5 px-3 rounded-md w-full" value={form.phone} onChange={(e) => updateField("phone", e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Other Telephone</label>
                <input className="glass-input text-sm py-1.5 px-3 rounded-md w-full" value={form.otherPhone} onChange={(e) => updateField("otherPhone", e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Email Address</label>
                <input type="email" className="glass-input text-sm py-1.5 px-3 rounded-md w-full" value={form.email} onChange={(e) => updateField("email", e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Date of Birth</label>
                <input type="date" className="glass-input text-sm py-1.5 px-3 rounded-md w-full" value={form.dateOfBirth} onChange={(e) => updateField("dateOfBirth", e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Start Date</label>
                <input type="date" className="glass-input text-sm py-1.5 px-3 rounded-md w-full" value={form.startDate} onChange={(e) => updateField("startDate", e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Marital Status</label>
                <select className="glass-input text-sm py-1.5 px-3 rounded-md w-full" value={form.maritalStatus} onChange={(e) => updateField("maritalStatus", e.target.value)}>
                  <option value="">Select…</option>
                  <option value="Single">Single</option>
                  <option value="Married">Married</option>
                  <option value="Divorced">Divorced</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Spouse's Name</label>
                <input className="glass-input text-sm py-1.5 px-3 rounded-md w-full" value={form.spouseName} onChange={(e) => updateField("spouseName", e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Spouse's Employer</label>
                <input className="glass-input text-sm py-1.5 px-3 rounded-md w-full" value={form.spouseEmployer} onChange={(e) => updateField("spouseEmployer", e.target.value)} />
              </div>
            </div>

            <p className="text-xs text-muted-foreground mb-2">Read the agreement below, then sign at the bottom.</p>
            <div className="overflow-x-auto bg-white/5 rounded-md p-4 flex justify-center">
              <style dangerouslySetInnerHTML={{ __html: masterPhContractorAgreementStyles }} />
              <div dangerouslySetInnerHTML={{ __html: buildMasterPhContractorAgreementBodyMarkup(form, logoDataUrl) }} />
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
