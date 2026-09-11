/**
 * Standalone "add your signature" link for the manager/employer half of a
 * two-party HR form — the counterpart to the Fill*Page.tsx pages the
 * employee side already has. Exists because "Send to Manager"/"Send to
 * Employer" (ReportHRDaily.tsx's handleSendToEmployer) reassigns the
 * document's recipientId to a real line manager who is very often NOT
 * ADMIN/HR — the only roles allowed into the HR & Recruitment Dashboard
 * (DASHBOARD_ROLE_GATES["hr-dashboard"]) where that step previously had to
 * happen. That manager's DM link pointed straight at a page they had no
 * access to — confirmed live on 2026-09-10 for three real Branch/Senior
 * Branch Managers, none of them ADMIN or HR, each the recipientId on a
 * "Awaiting Manager Signature" Parts Responsibility form they couldn't
 * open. This page instead authorizes on "are you the document's current
 * recipientId" — the same narrow check the employee-side Fill*Page.tsx
 * pages already use, and exactly what the hr_signable_documents_update RLS
 * policy itself checks first (recipient_id = auth_profile_id(), no role
 * involved) — so nothing here needs a role gate at all.
 *
 * Every one of ReportHRDaily.tsx's "*EmployerDialog" handlers for these
 * types is structurally identical: a plain signature pad (no fields to
 * review), reassign-to-self for the RLS "claim", regenerate the PDF with
 * both signatures, signDocument + confirmSignableDocument. UNIFORM_CONFIGS
 * captures the one thing that differs per type (which fill/upload
 * functions, which formData key already holds the employee's signature)
 * instead of duplicating that handler 7 times. parts_responsibility uses
 * different field names (technician/manager instead of employee/employer)
 * so it's handled as its own small case. i9's Section 2 needs real review
 * fields (documents examined, first day employed, business info) — not
 * just a signature — so it isn't wired up here yet; SUPPORTED_TYPES governs
 * which document types show the working flow vs. the "not available here
 * yet" fallback.
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import {
  getSignableDocument,
  reassignSignableDocument,
  signDocument,
  confirmSignableDocument,
  reopenEmployerSignature,
  type SignableDocument,
  type SignableDocumentType,
} from "@/lib/supabase/signableDocuments";
import {
  uploadSignableDocumentSignature,
  uploadPartsResponsibilityForm,
  uploadWageAckForm,
  uploadDamageForm,
  uploadMealRestBreakForm,
  uploadMileageFuelForm,
  uploadLocationConsentForm,
  uploadSubstanceScreeningForm,
  uploadFlashTechnicianTravelForm,
  uploadMasterW2AgreementForm,
  uploadMasterW2OfficeAgreementForm,
  uploadMasterPhContractorAgreementForm,
  refreshStorageAuthToken,
} from "@/lib/firebase/storage";
import { fillPartsResponsibilityPdf } from "@/lib/partsResponsibilityPdfFill";
import { fillWageAckPdf } from "@/lib/wageAckPdfFill";
import { fillDamagePdf } from "@/lib/damagePdfFill";
import { fillMealRestBreakPdf } from "@/lib/mealRestBreakPdfFill";
import { fillMileageFuelPdf } from "@/lib/mileageFuelPdfFill";
import { fillLocationConsentPdf } from "@/lib/locationConsentPdfFill";
import { fillSubstanceScreeningPdf } from "@/lib/substanceScreeningPdfFill";
import { fillFlashTechnicianTravelPdf } from "@/lib/flashTechnicianTravelPdfFill";
import type { PartsResponsibilityFormData } from "@/lib/partsResponsibilityFormTemplate";
import { captureHtmlToPdfBlob, loadAssetDataUrl } from "@/lib/pdfCapture";
import { masterW2AgreementStyles, buildMasterW2AgreementBodyMarkup, type MasterW2AgreementFormData } from "@/lib/masterW2AgreementFormTemplate";
import { masterW2OfficeAgreementStyles, buildMasterW2OfficeAgreementBodyMarkup, type MasterW2OfficeAgreementFormData } from "@/lib/masterW2OfficeAgreementFormTemplate";
import { masterPhContractorAgreementStyles, buildMasterPhContractorAgreementBodyMarkup, type MasterPhContractorAgreementFormData } from "@/lib/masterPhContractorAgreementFormTemplate";
import { useSignaturePad } from "@/hooks/useSignaturePad";
import { SignaturePadControls } from "@/components/SignaturePad";
import { logActivity } from "@/lib/supabase/hrActivityLog";

interface Props {
  docId: string;
}

const TYPE_LABEL: Partial<Record<SignableDocumentType, string>> = {
  parts_responsibility: "Parts Responsibility and Technician Floor Protection Acknowledgment Form",
  wage_ack: "Acknowledgment of Wage & Compensation Structure",
  damage: "Damage, Part Loss, and Tool Penalty Commission Deduction Agreement",
  meal_rest_break: "Employee Meal and Rest Break Policy Acknowledgment",
  mileage_fuel: "Personal Vehicle Mileage and Fuel Policy Agreement",
  location_consent: "Employee Mobile App Location Sharing Consent Agreement",
  substance_screening: "Substance Screening & Conduct Agreement",
  flash_technician_travel: "Flash Technician Travel & Out-of-State Policy",
  master_w2_agreement: "Master W-2 Technician Comprehensive Policy, Consent & Agreement",
  master_w2_office_agreement: "Master W-2 Office & Logistics Comprehensive Policy, Conduct & Agreement",
  master_ph_contractor_agreement: "Master Philippines Independent Contractor Comprehensive Agreement",
};

interface UniformSignConfig {
  /** formData key already holding the employee/technician's own signature — every type but substance_screening uses "employeeSignatureDataUrl". */
  employeeSigField: string;
  fillPdf: (data: any, employeeSigBytes?: Uint8Array, employerSigBytes?: Uint8Array) => Promise<Uint8Array>;
  uploadPdf: (companyId: string, employeeName: string, blob: Blob) => Promise<string>;
  logAction: string;
  nameFallback: string;
}

/** Every type here writes the employer half to "employerSignatureDataUrl"/"employerDateSigned" — only the employee-side read field and the fill/upload functions differ. */
const UNIFORM_CONFIGS: Partial<Record<SignableDocumentType, UniformSignConfig>> = {
  wage_ack: { employeeSigField: "employeeSignatureDataUrl", fillPdf: fillWageAckPdf, uploadPdf: uploadWageAckForm, logAction: "wage_ack_employer_signed", nameFallback: "acknowledgment-of-wage" },
  damage: { employeeSigField: "employeeSignatureDataUrl", fillPdf: fillDamagePdf, uploadPdf: uploadDamageForm, logAction: "damage_employer_signed", nameFallback: "damage" },
  meal_rest_break: { employeeSigField: "employeeSignatureDataUrl", fillPdf: fillMealRestBreakPdf, uploadPdf: uploadMealRestBreakForm, logAction: "meal_rest_break_employer_signed", nameFallback: "meal-rest-break" },
  mileage_fuel: { employeeSigField: "employeeSignatureDataUrl", fillPdf: fillMileageFuelPdf, uploadPdf: uploadMileageFuelForm, logAction: "mileage_fuel_employer_signed", nameFallback: "mileage-fuel" },
  location_consent: { employeeSigField: "employeeSignatureDataUrl", fillPdf: fillLocationConsentPdf, uploadPdf: uploadLocationConsentForm, logAction: "location_consent_employer_signed", nameFallback: "location-consent" },
  substance_screening: { employeeSigField: "signatureDataUrl", fillPdf: fillSubstanceScreeningPdf, uploadPdf: uploadSubstanceScreeningForm, logAction: "substance_screening_employer_signed", nameFallback: "substance-screening" },
  flash_technician_travel: { employeeSigField: "employeeSignatureDataUrl", fillPdf: fillFlashTechnicianTravelPdf, uploadPdf: uploadFlashTechnicianTravelForm, logAction: "flash_technician_travel_employer_signed", nameFallback: "flash-technician-travel" },
};

/** Document types this page can complete — see the file header for why i9 isn't here yet. master_w2_agreement/master_w2_office_agreement/master_ph_contractor_agreement are HTML-captured (see masterW2AgreementFormTemplate.ts / masterW2OfficeAgreementFormTemplate.ts / masterPhContractorAgreementFormTemplate.ts), not a pdf-lib byte-fill like the UNIFORM_CONFIGS types, so they're handled as their own cases (handleSubmitMasterW2Agreement/handleSubmitMasterW2OfficeAgreement/handleSubmitMasterPhContractorAgreement) rather than fitting UniformSignConfig's fillPdf shape. */
const SUPPORTED_TYPES = new Set<SignableDocumentType>(["parts_responsibility", "master_w2_agreement", "master_w2_office_agreement", "master_ph_contractor_agreement", ...Object.keys(UNIFORM_CONFIGS) as SignableDocumentType[]]);

export function ManagerReviewPage({ docId }: Props) {
  const { ready, uid, displayName, role } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [doc, setDoc] = useState<SignableDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [reopening, setReopening] = useState(false);

  const sigPad = useSignaturePad({ width: 440, height: 100 });

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
        if (!document) {
          setError("This document doesn't exist or has been removed.");
        } else {
          setDoc(document);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load document.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ready, uid, docId]);

  const isRecipient = !!doc && !!myProfileId && doc.recipientId === myProfileId;
  const isSuperadmin = role === "SUPERSUPERADMIN";
  const isSupportedType = !!doc && SUPPORTED_TYPES.has(doc.documentType);

  const handleSubmitPartsResponsibility = async (dataUrl: string) => {
    if (!doc || !myProfileId) return;
    await reassignSignableDocument(doc.id, { recipientId: myProfileId, recipientName: displayName || "Manager" }, "hr_staff");

    const existing = doc.formData as PartsResponsibilityFormData;
    const technicianSigBytes = existing.technicianSignatureDataUrl
      ? new Uint8Array(await (await fetch(existing.technicianSignatureDataUrl)).arrayBuffer())
      : undefined;

    await refreshStorageAuthToken();
    const managerSigBytes = new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
    const signatureUrl = await uploadSignableDocumentSignature(doc.companyId, doc.id, "hr_staff", dataUrl);
    const signedAt = new Date().toISOString();

    const merged: PartsResponsibilityFormData = { ...existing, managerSignatureDataUrl: dataUrl, managerDateSigned: signedAt };

    const pdfBytes = await fillPartsResponsibilityPdf(merged, technicianSigBytes, managerSigBytes);
    const pdfUrl = await uploadPartsResponsibilityForm(doc.companyId, existing.employeeName || "parts-responsibility", new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" }));

    const entry = { name: displayName || "Manager", url: signatureUrl, signedAt };
    await signDocument(doc.id, "hr_staff", entry, pdfUrl, merged as unknown as Record<string, any>);
    await confirmSignableDocument(doc.id, null);

    void logActivity({ action: "parts_responsibility_manager_signed", targetType: "employee", targetLabel: existing.employeeName || "" });
    setDoc({ ...doc, status: "confirmed", pdfUrl, formData: merged as unknown as Record<string, any> });
  };

  const handleSubmitUniform = async (config: UniformSignConfig, dataUrl: string) => {
    if (!doc || !myProfileId) return;
    await reassignSignableDocument(doc.id, { recipientId: myProfileId, recipientName: displayName || "Manager" }, "hr_staff");

    const existing = doc.formData as Record<string, any>;
    const employeeSigBytes = existing[config.employeeSigField]
      ? new Uint8Array(await (await fetch(existing[config.employeeSigField])).arrayBuffer())
      : undefined;

    await refreshStorageAuthToken();
    const employerSigBytes = new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
    const signatureUrl = await uploadSignableDocumentSignature(doc.companyId, doc.id, "hr_staff", dataUrl);
    const signedAt = new Date().toISOString();

    const merged = { ...existing, employerSignatureDataUrl: dataUrl, employerDateSigned: signedAt };

    const pdfBytes = await config.fillPdf(merged, employeeSigBytes, employerSigBytes);
    const pdfUrl = await config.uploadPdf(doc.companyId, existing.employeeName || config.nameFallback, new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" }));

    const entry = { name: displayName || "Manager", url: signatureUrl, signedAt };
    await signDocument(doc.id, "hr_staff", entry, pdfUrl, merged as Record<string, any>);
    await confirmSignableDocument(doc.id, null);

    void logActivity({ action: config.logAction, targetType: "employee", targetLabel: existing.employeeName || "" });
    setDoc({ ...doc, status: "confirmed", pdfUrl, formData: merged });
  };

  const handleSubmitMasterW2Agreement = async (dataUrl: string) => {
    if (!doc || !myProfileId) return;
    await reassignSignableDocument(doc.id, { recipientId: myProfileId, recipientName: displayName || "Manager" }, "hr_staff");

    const existing = doc.formData as MasterW2AgreementFormData;
    await refreshStorageAuthToken();
    const signatureUrl = await uploadSignableDocumentSignature(doc.companyId, doc.id, "hr_staff", dataUrl);
    const signedAt = new Date().toISOString();

    const merged: MasterW2AgreementFormData = { ...existing, employerSignatureDataUrl: dataUrl, employerDateSigned: signedAt };

    const logo = await loadAssetDataUrl(() => import("@/assets/us-in-home-services-logo.png"));
    const pdfBlob = await captureHtmlToPdfBlob(buildMasterW2AgreementBodyMarkup(merged, logo), masterW2AgreementStyles);
    const pdfUrl = await uploadMasterW2AgreementForm(doc.companyId, existing.employeeName || "master-w2-agreement", pdfBlob);

    const entry = { name: displayName || "Manager", url: signatureUrl, signedAt };
    await signDocument(doc.id, "hr_staff", entry, pdfUrl, merged as unknown as Record<string, any>);
    await confirmSignableDocument(doc.id, null);

    void logActivity({ action: "master_w2_agreement_employer_signed", targetType: "employee", targetLabel: existing.employeeName || "" });
    setDoc({ ...doc, status: "confirmed", pdfUrl, formData: merged as unknown as Record<string, any> });
  };

  const handleSubmitMasterW2OfficeAgreement = async (dataUrl: string) => {
    if (!doc || !myProfileId) return;
    await reassignSignableDocument(doc.id, { recipientId: myProfileId, recipientName: displayName || "Manager" }, "hr_staff");

    const existing = doc.formData as MasterW2OfficeAgreementFormData;
    await refreshStorageAuthToken();
    const signatureUrl = await uploadSignableDocumentSignature(doc.companyId, doc.id, "hr_staff", dataUrl);
    const signedAt = new Date().toISOString();

    const merged: MasterW2OfficeAgreementFormData = { ...existing, employerSignatureDataUrl: dataUrl, employerDateSigned: signedAt };

    const logo = await loadAssetDataUrl(() => import("@/assets/us-in-home-services-logo.png"));
    const pdfBlob = await captureHtmlToPdfBlob(buildMasterW2OfficeAgreementBodyMarkup(merged, logo), masterW2OfficeAgreementStyles);
    const pdfUrl = await uploadMasterW2OfficeAgreementForm(doc.companyId, existing.employeeName || "master-w2-office-agreement", pdfBlob);

    const entry = { name: displayName || "Manager", url: signatureUrl, signedAt };
    await signDocument(doc.id, "hr_staff", entry, pdfUrl, merged as unknown as Record<string, any>);
    await confirmSignableDocument(doc.id, null);

    void logActivity({ action: "master_w2_office_agreement_employer_signed", targetType: "employee", targetLabel: existing.employeeName || "" });
    setDoc({ ...doc, status: "confirmed", pdfUrl, formData: merged as unknown as Record<string, any> });
  };

  const handleSubmitMasterPhContractorAgreement = async (dataUrl: string) => {
    if (!doc || !myProfileId) return;
    await reassignSignableDocument(doc.id, { recipientId: myProfileId, recipientName: displayName || "Manager" }, "hr_staff");

    const existing = doc.formData as MasterPhContractorAgreementFormData;
    await refreshStorageAuthToken();
    const signatureUrl = await uploadSignableDocumentSignature(doc.companyId, doc.id, "hr_staff", dataUrl);
    const signedAt = new Date().toISOString();

    const merged: MasterPhContractorAgreementFormData = { ...existing, employerSignatureDataUrl: dataUrl, employerDateSigned: signedAt };

    const logo = await loadAssetDataUrl(() => import("@/assets/us-in-home-services-logo.png"));
    const pdfBlob = await captureHtmlToPdfBlob(buildMasterPhContractorAgreementBodyMarkup(merged, logo), masterPhContractorAgreementStyles);
    const pdfUrl = await uploadMasterPhContractorAgreementForm(doc.companyId, existing.employeeName || "master-ph-contractor-agreement", pdfBlob);

    const entry = { name: displayName || "Manager", url: signatureUrl, signedAt };
    await signDocument(doc.id, "hr_staff", entry, pdfUrl, merged as unknown as Record<string, any>);
    await confirmSignableDocument(doc.id, null);

    void logActivity({ action: "master_ph_contractor_agreement_employer_signed", targetType: "employee", targetLabel: existing.employeeName || "" });
    setDoc({ ...doc, status: "confirmed", pdfUrl, formData: merged as unknown as Record<string, any> });
  };

  const handleSubmit = async () => {
    if (!doc || !myProfileId) return;
    if (!sigPad.hasContent()) {
      setError("Please add your signature.");
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
      if (doc.documentType === "parts_responsibility") {
        await handleSubmitPartsResponsibility(dataUrl);
      } else if (doc.documentType === "master_w2_agreement") {
        await handleSubmitMasterW2Agreement(dataUrl);
      } else if (doc.documentType === "master_w2_office_agreement") {
        await handleSubmitMasterW2OfficeAgreement(dataUrl);
      } else if (doc.documentType === "master_ph_contractor_agreement") {
        await handleSubmitMasterPhContractorAgreement(dataUrl);
      } else {
        const config = UNIFORM_CONFIGS[doc.documentType];
        if (!config) return;
        await handleSubmitUniform(config, dataUrl);
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save signature.");
    } finally {
      setSubmitting(false);
    }
  };

  // Keeps recipientId (and so isRecipient) untouched — reopenEmployerSignature
  // only resets status/confirmed_at, not who the document is assigned to —
  // so whoever just confirmed it can immediately redo it without needing a
  // fresh DM link.
  const handleReopen = async () => {
    if (!doc) return;
    if (!window.confirm("Re-open this for a new signature? Nothing else on the form changes.")) return;
    setReopening(true);
    setError(null);
    try {
      await reopenEmployerSignature(doc.id);
      setDoc({ ...doc, status: "pending_signature" });
      setSubmitted(false);
      sigPad.clear();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reopen for re-signing.");
    } finally {
      setReopening(false);
    }
  };

  const employeeName = doc ? ((doc.formData as { employeeName?: string })?.employeeName || doc.recipientName || "—") : "—";
  const label = doc ? (TYPE_LABEL[doc.documentType] ?? doc.documentType) : "";

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-lg mx-auto p-4">
        <Link to="/home" className="btn text-xs px-2.5 py-1.5 flex items-center gap-1 w-fit mb-4">
          <ChevronLeft className="h-3.5 w-3.5" /> Home
        </Link>

        {loading ? (
          <div className="panel p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading document…
          </div>
        ) : error && !doc ? (
          <div className="panel p-6 text-sm text-red-300">{error}</div>
        ) : !doc ? null : !isRecipient && !isSuperadmin ? (
          <div className="panel p-6 text-sm text-muted-foreground">
            This form isn't currently assigned to you for review — it may have already been completed, or sent to someone else. Check with HR if you think this is wrong.
          </div>
        ) : !isSupportedType ? (
          <div className="panel p-6 text-sm text-muted-foreground">
            This form type isn't available through this link yet — please ask HR to complete it from the HR &amp; Recruitment Dashboard.
          </div>
        ) : submitted || doc.status === "confirmed" ? (
          <div className="panel p-6 text-center">
            <p className="text-sm font-semibold mb-2">✓ Signed{submitted ? " and sent back to HR" : ""}.</p>
            {doc.pdfUrl && (
              <a href={doc.pdfUrl} target="_blank" rel="noreferrer noopener" className="text-blue-300 hover:text-blue-200 underline text-sm block mb-3">
                View the completed PDF
              </a>
            )}
            {error && (
              <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2 mt-2 mb-2">{error}</p>
            )}
            <button
              onClick={handleReopen}
              disabled={reopening}
              className="btn text-xs px-3 py-1.5 disabled:opacity-50"
              title="Redo your signature — nothing else on the form changes"
            >
              {reopening ? "Reopening…" : "Not right? Re-sign"}
            </button>
          </div>
        ) : (
          <div className="panel p-4">
            <h1 className="text-lg font-bold mb-2">Add Your Signature</h1>
            <p className="text-sm text-muted-foreground mb-4">
              Manager/employer signature for <span className="font-semibold text-foreground">{employeeName}</span>'s {label}.
            </p>

            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Add your signature</label>
            <canvas
              {...sigPad.canvasProps}
              className={`bg-white rounded-md border border-white/15 w-full ${sigPad.canvasProps.className}`}
            />
            <div className="flex justify-center mt-2">
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
              {submitting ? "Saving…" : "Complete & Sign"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
