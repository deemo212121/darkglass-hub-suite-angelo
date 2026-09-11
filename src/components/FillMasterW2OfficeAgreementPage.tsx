/**
 * Fill Master W-2 Office & Logistics Comprehensive Policy, Conduct &
 * Agreement — opened from the deep link ReportHRDaily.tsx's "Master W-2
 * Office Agreement" tab "Send Request" flow sends. HTML/CSS document (no
 * source PDF to overlay — see masterW2OfficeAgreementFormTemplate.ts's
 * header comment), rendered live as a preview of exactly what gets
 * captured to PDF on submit, same "preview what's about to be signed"
 * pattern SignActionPlanFormPage.tsx uses.
 *
 * Genuine two-party document: only the employee half is filled here; the
 * employer/HR countersignature happens separately afterward
 * (ReportHRDaily.tsx's "Complete Employer Signature" dialog, or
 * ManagerReviewPage.tsx for a non-HR manager it's been reassigned to). No
 * license/SSN photo capture here — that requirement is specific to the
 * Technician version (FillMasterW2AgreementPage.tsx).
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import { getSignableDocument, signDocument, type SignableDocument } from "@/lib/supabase/signableDocuments";
import { uploadSignableDocumentSignature, uploadMasterW2OfficeAgreementForm, refreshStorageAuthToken } from "@/lib/firebase/storage";
import { captureHtmlToPdfBlob, loadAssetDataUrl } from "@/lib/pdfCapture";
import {
  MASTER_W2_OFFICE_AGREEMENT_BRANCHES,
  masterW2OfficeAgreementStyles,
  buildMasterW2OfficeAgreementBodyMarkup,
  type MasterW2OfficeAgreementFormData,
} from "@/lib/masterW2OfficeAgreementFormTemplate";
import { getOrCreateDmThread, sendMessage } from "@/lib/supabase/messaging";
import { logActivity } from "@/lib/supabase/hrActivityLog";
import { getHrNotificationSettings } from "@/lib/supabase/companySettings";
import { notifyHrRoleUsers } from "@/lib/supabase/hrRoleNotify";
import { useSignaturePad } from "@/hooks/useSignaturePad";
import { SignaturePadControls } from "@/components/SignaturePad";

interface Props {
  docId: string;
}

const BLANK_FORM: MasterW2OfficeAgreementFormData = {
  employeeId: "",
  employeeName: "",
  firstName: "",
  middleName: "",
  lastName: "",
  branch: "",
  effectiveDate: "",
  addressStreet: "",
  addressCity: "",
  addressState: "",
  addressZip: "",
  phone: "",
  email: "",
  employeeDateSigned: "",
  employeeSignatureDataUrl: "",
  employerDateSigned: "",
  employerSignatureDataUrl: "",
};

export function FillMasterW2OfficeAgreementPage({ docId }: Props) {
  const { ready, uid, displayName } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [doc, setDoc] = useState<SignableDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [logoDataUrl, setLogoDataUrl] = useState("");

  const [form, setForm] = useState<MasterW2OfficeAgreementFormData>({ ...BLANK_FORM });

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
        if (!document || document.documentType !== "master_w2_office_agreement") {
          setError("This document doesn't exist or has been removed.");
        } else {
          setDoc(document);
          const existing = document.formData as Partial<MasterW2OfficeAgreementFormData>;
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

  const updateField = <K extends keyof MasterW2OfficeAgreementFormData>(key: K, value: MasterW2OfficeAgreementFormData[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const validate = (): string | null => {
    if (!form.firstName.trim()) return "Enter your first name.";
    if (!form.lastName.trim()) return "Enter your last name.";
    if (!form.branch) return "Select your branch/office.";
    if (!form.effectiveDate) return "Enter the effective date.";
    if (!form.addressStreet.trim() || !form.addressCity.trim() || !form.addressState.trim() || !form.addressZip.trim()) return "Fill in your complete home address.";
    if (!form.phone.trim()) return "Enter your phone number.";
    if (!form.email.trim()) return "Enter your email address.";
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
      const finalData: MasterW2OfficeAgreementFormData = {
        ...form,
        employeeName,
        employeeDateSigned: signedAt,
        employeeSignatureDataUrl: dataUrl,
      };
      const entry = { name: displayName || employeeName || "Signed", url: signatureUrl, signedAt };

      const pdfBlob = await captureHtmlToPdfBlob(buildMasterW2OfficeAgreementBodyMarkup(finalData, logoDataUrl), masterW2OfficeAgreementStyles);
      const pdfUrl = await uploadMasterW2OfficeAgreementForm(companyId, employeeName, pdfBlob);

      await signDocument(doc.id, "employee", entry, pdfUrl, finalData as unknown as Record<string, any>);

      if (doc.createdBy) {
        const thread = await getOrCreateDmThread(myProfileId, doc.createdBy);
        await sendMessage({
          dmThreadId: thread.id,
          senderId: myProfileId,
          senderName: displayName || "Employee",
          body: `📋 Master W-2 Office & Logistics Comprehensive Policy, Conduct & Agreement for ${employeeName} has been signed, and is ready for the employer signature: ${pdfUrl}`,
        });
      }

      getHrNotificationSettings()
        .then(({ taxForms }) => {
          if (!taxForms) return;
          const excludeIds = doc.createdBy ? [doc.createdBy] : [];
          void notifyHrRoleUsers(myProfileId, displayName || "Employee", excludeIds, `📋 Master W-2 Office & Logistics Comprehensive Policy, Conduct & Agreement for ${employeeName} has been signed — the employer signature is ready to be added.`);
        })
        .catch((err) => console.error("[master-w2-office-agreement] hr notify check failed:", err));

      setDoc({ ...doc, status: "signed", pdfUrl, formData: finalData as unknown as Record<string, any>, signatures: { employee: entry }, signedAt });
      void logActivity({ action: "master_w2_office_agreement_signed", targetType: "employee", targetLabel: employeeName });
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
            <h1 className="text-lg font-bold mb-1">Master W-2 Office Agreement</h1>
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
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Branch / Office</label>
                <select className="glass-input text-sm py-1.5 px-3 rounded-md w-full" value={form.branch} onChange={(e) => updateField("branch", e.target.value)}>
                  <option value="">Select…</option>
                  {MASTER_W2_OFFICE_AGREEMENT_BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Effective Date</label>
                <input type="date" className="glass-input text-sm py-1.5 px-3 rounded-md w-full" value={form.effectiveDate} onChange={(e) => updateField("effectiveDate", e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-3">
              <div className="sm:col-span-2">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Street Address</label>
                <input className="glass-input text-sm py-1.5 px-3 rounded-md w-full" value={form.addressStreet} onChange={(e) => updateField("addressStreet", e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">City</label>
                <input className="glass-input text-sm py-1.5 px-3 rounded-md w-full" value={form.addressCity} onChange={(e) => updateField("addressCity", e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">State</label>
                  <input className="glass-input text-sm py-1.5 px-3 rounded-md w-full" value={form.addressState} onChange={(e) => updateField("addressState", e.target.value)} />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Zip</label>
                  <input className="glass-input text-sm py-1.5 px-3 rounded-md w-full" value={form.addressZip} onChange={(e) => updateField("addressZip", e.target.value)} />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Phone Number</label>
                <input className="glass-input text-sm py-1.5 px-3 rounded-md w-full" value={form.phone} onChange={(e) => updateField("phone", e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Email Address</label>
                <input type="email" className="glass-input text-sm py-1.5 px-3 rounded-md w-full" value={form.email} onChange={(e) => updateField("email", e.target.value)} />
              </div>
            </div>

            <p className="text-xs text-muted-foreground mb-2">Read the agreement below, then sign at the bottom.</p>
            <div className="overflow-x-auto bg-white/5 rounded-md p-4 flex justify-center">
              <style dangerouslySetInnerHTML={{ __html: masterW2OfficeAgreementStyles }} />
              <div dangerouslySetInnerHTML={{ __html: buildMasterW2OfficeAgreementBodyMarkup(form, logoDataUrl) }} />
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
