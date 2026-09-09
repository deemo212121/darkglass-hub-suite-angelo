/**
 * Fill Vehicle Use Agreement — a brand-new, single-party acknowledgment
 * form (distinct from the existing Company Vehicle Use Agreement type),
 * opened from the deep link a Team Messenger message sends (see
 * ReportHRDaily.tsx's "Send Request" flow). No source PDF — same
 * from-scratch HTML template + live preview technique as
 * FillContractorDataUsPage.tsx, just a much smaller field set (no file
 * uploads): First/Last Name, Date, Branch, then sign.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import { getSignableDocument, signDocument, type SignableDocument } from "@/lib/supabase/signableDocuments";
import { uploadSignableDocumentSignature, uploadVehicleUseAgreementForm, refreshStorageAuthToken } from "@/lib/firebase/storage";
import { captureHtmlToPdfBlob, loadAssetDataUrl } from "@/lib/pdfCapture";
import {
  buildVehicleUseAgreementBodyMarkup,
  vehicleUseAgreementStyles,
  VEHICLE_USE_AGREEMENT_BRANCHES,
  VEHICLE_USE_AGREEMENT_CLAUSES,
  type VehicleUseAgreementFormData,
} from "@/lib/vehicleUseAgreementFormTemplate";
import { getOrCreateDmThread, sendMessage } from "@/lib/supabase/messaging";
import { logActivity } from "@/lib/supabase/hrActivityLog";
import { getHrNotificationSettings } from "@/lib/supabase/companySettings";
import { notifyHrRoleUsers } from "@/lib/supabase/hrRoleNotify";
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

function withTimeout<T>(promise: Promise<T>, ms: number, step: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${step} is taking too long — check your connection and try again.`)),
      ms
    );
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

const inputCls = "glass-input text-sm py-1.5 px-3 rounded-md w-full";
const labelCls = "text-[10px] font-semibold text-muted-foreground uppercase tracking-wide";

export function FillVehicleUseAgreementPage({ docId }: Props) {
  const { ready, uid, displayName, role } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [doc, setDoc] = useState<SignableDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitStep, setSubmitStep] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [logoDataUrl, setLogoDataUrl] = useState("");

  const [form, setForm] = useState<VehicleUseAgreementFormData>({ ...BLANK_FORM });

  const employeeName = [form.firstName, form.lastName].filter(Boolean).join(" ");
  const sigPad = useSignaturePad({ defaultName: employeeName, width: 500, height: 130 });

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
        if (!document || document.documentType !== "vehicle_use_agreement") {
          setError("This document doesn't exist or has been removed.");
        } else {
          setDoc(document);
          const existing = document.formData as Partial<VehicleUseAgreementFormData>;
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

      setSubmitStep("Uploading signature…");
      const signatureUrl = await withTimeout(
        uploadSignableDocumentSignature(companyId, doc.id, "employee", dataUrl),
        30_000,
        "Uploading signature"
      );
      const signedAt = new Date().toISOString();
      const finalData: VehicleUseAgreementFormData = { ...form, employeeName, dateSigned: signedAt, signatureDataUrl: dataUrl };
      const entry = { name: displayName || employeeName || "Signed", url: signatureUrl, signedAt };

      setSubmitStep("Generating document…");
      const pdfBlob = await withTimeout(
        captureHtmlToPdfBlob(buildVehicleUseAgreementBodyMarkup(finalData, logoDataUrl, entry), vehicleUseAgreementStyles),
        30_000,
        "Generating document"
      );
      const pdfUrl = await withTimeout(uploadVehicleUseAgreementForm(companyId, employeeName, pdfBlob), 60_000, "Uploading document");

      setSubmitStep("Saving…");
      await withTimeout(
        signDocument(doc.id, "employee", entry, pdfUrl, finalData as unknown as Record<string, any>),
        20_000,
        "Saving"
      );

      if (doc.createdBy) {
        try {
          const thread = await getOrCreateDmThread(myProfileId, doc.createdBy);
          const filename = `Vehicle Use Agreement - ${employeeName}.pdf`;
          await sendMessage({
            dmThreadId: thread.id,
            senderId: myProfileId,
            senderName: displayName || "Employee",
            body: `📄 Vehicle Use Agreement for ${employeeName} has been submitted: [${filename}](${pdfUrl})`,
          });
        } catch (notifyErr) {
          console.error("[vehicle-use-agreement] DM notify to creator failed:", notifyErr);
        }
      }

      getHrNotificationSettings()
        .then(({ taxForms }) => {
          if (!taxForms) return;
          const excludeIds = doc.createdBy ? [doc.createdBy] : [];
          void notifyHrRoleUsers(myProfileId, displayName || "Employee", excludeIds, `📄 Vehicle Use Agreement for ${employeeName} has been submitted.`);
        })
        .catch((err) => console.error("[vehicle-use-agreement] hr notify check failed:", err));

      setDoc({ ...doc, status: "signed", pdfUrl, formData: finalData as unknown as Record<string, any>, signatures: { employee: entry }, signedAt });
      void logActivity({ action: "vehicle_use_agreement_signed", targetType: "employee", targetLabel: employeeName });
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

  const previewData: VehicleUseAgreementFormData = useMemo(
    () => ({ ...form, employeeName: [form.firstName, form.lastName].filter(Boolean).join(" ") }),
    [form]
  );

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-6xl mx-auto p-4">
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
                  {submitting ? (submitStep || "Submitting…") : "Submit to HR"}
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
      </main>
    </div>
  );
}
