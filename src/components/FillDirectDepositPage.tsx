/**
 * Fill Direct Deposit Authorization — opened from the deep link a Team
 * Messenger message sends (see ReportHRDaily.tsx's "Direct Deposit" tab
 * "Send Request" flow). Same architecture as FillContractorDataPage.tsx —
 * there's no real source PDF here (see directDepositFormTemplate.ts's
 * header comment), so this is a plain HTML form with a live preview of the
 * generated document alongside it.
 *
 * Single-party, same shape as Car IQ/Contractor Data — no employer/HR
 * co-signature step. No file uploads (unlike Contractor Data) — just
 * contact/bank info plus a signature.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import { getSignableDocument, signDocument, type SignableDocument } from "@/lib/supabase/signableDocuments";
import { uploadSignableDocumentSignature, uploadDirectDepositForm } from "@/lib/firebase/storage";
import { captureHtmlToPdfBlob, loadAssetDataUrl } from "@/lib/pdfCapture";
import {
  buildDirectDepositBodyMarkup,
  directDepositStyles,
  DIRECT_DEPOSIT_STATES,
  DIRECT_DEPOSIT_COUNTRIES,
  DIRECT_DEPOSIT_ACCOUNT_TYPES,
  type DirectDepositFormData,
} from "@/lib/directDepositFormTemplate";
import { getOrCreateDmThread, sendMessage } from "@/lib/supabase/messaging";
import { logActivity } from "@/lib/supabase/hrActivityLog";
import { getHrNotificationSettings } from "@/lib/supabase/companySettings";
import { notifyHrRoleUsers } from "@/lib/supabase/hrRoleNotify";
import { useSignaturePad } from "@/hooks/useSignaturePad";
import { SignaturePadControls } from "@/components/SignaturePad";

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

export function FillDirectDepositPage({ docId }: Props) {
  const { ready, uid, displayName, role } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [doc, setDoc] = useState<SignableDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [logoDataUrl, setLogoDataUrl] = useState("");

  const [form, setForm] = useState<DirectDepositFormData>({ ...BLANK_FORM });

  const employeeName = [form.firstName, form.middleName, form.lastName].filter(Boolean).join(" ");
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
        if (!document || document.documentType !== "direct_deposit") {
          setError("This document doesn't exist or has been removed.");
        } else {
          setDoc(document);
          const existing = document.formData as Partial<DirectDepositFormData>;
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

  const updateField = <K extends keyof DirectDepositFormData>(key: K, value: DirectDepositFormData[K]) => setForm((f) => ({ ...f, [key]: value }));

  const validate = (): string | null => {
    if (!form.firstName.trim()) return "Enter your first name.";
    if (!form.middleName.trim()) return "Enter your middle name (or N/A).";
    if (!form.lastName.trim()) return "Enter your last name.";
    if (!form.streetAddress.trim() || !form.city.trim() || !form.state || !form.zipCode.trim() || !form.country) return "Fill in your complete address.";
    if (!form.bankName.trim()) return "Enter the name of your bank.";
    if (!form.accountNumber.trim()) return "Enter your account number.";
    if (!/^\d{9}$/.test(form.routingNumber.trim())) return "Enter your 9-digit routing number.";
    if (!form.accountType) return "Select the type of account.";
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
      const signatureUrl = await uploadSignableDocumentSignature(companyId, doc.id, "employee", dataUrl);
      const signedAt = new Date().toISOString();
      const finalData: DirectDepositFormData = { ...form, employeeName, dateSigned: signedAt, signatureDataUrl: dataUrl };
      const entry = { name: displayName || employeeName || "Signed", url: signatureUrl, signedAt };

      const pdfBlob = await captureHtmlToPdfBlob(
        buildDirectDepositBodyMarkup(finalData, logoDataUrl, entry),
        directDepositStyles
      );
      const pdfUrl = await uploadDirectDepositForm(companyId, employeeName, pdfBlob);

      await signDocument(doc.id, "employee", entry, pdfUrl, finalData as unknown as Record<string, any>);

      if (doc.createdBy) {
        const thread = await getOrCreateDmThread(myProfileId, doc.createdBy);
        const filename = `Direct Deposit Authorization - ${employeeName}.pdf`;
        await sendMessage({
          dmThreadId: thread.id,
          senderId: myProfileId,
          senderName: displayName || "Employee",
          body: `📄 Direct Deposit Authorization for ${employeeName} has been submitted: [${filename}](${pdfUrl})`,
        });
      }

      getHrNotificationSettings()
        .then(({ taxForms }) => {
          if (!taxForms) return;
          const excludeIds = doc.createdBy ? [doc.createdBy] : [];
          void notifyHrRoleUsers(myProfileId, displayName || "Employee", excludeIds, `📄 Direct Deposit Authorization for ${employeeName} has been submitted.`);
        })
        .catch((err) => console.error("[direct-deposit] hr notify check failed:", err));

      setDoc({ ...doc, status: "signed", pdfUrl, formData: finalData as unknown as Record<string, any>, signatures: { employee: entry }, signedAt });
      void logActivity({ action: "direct_deposit_signed", targetType: "employee", targetLabel: employeeName });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit form.");
    } finally {
      setSubmitting(false);
    }
  };

  const isRecipient = !!doc && !!myProfileId && doc.recipientId === myProfileId;
  const isSuperadmin = role === "SUPERSUPERADMIN";

  const previewData: DirectDepositFormData = useMemo(
    () => ({ ...form, employeeName: [form.firstName, form.middleName, form.lastName].filter(Boolean).join(" ") }),
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
                    {...sigPad.canvasProps}
                    className={`bg-white rounded-md border border-white/15 w-full max-w-md mt-1 ${sigPad.canvasProps.className}`}
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
                  {submitting ? "Submitting…" : "Submit to HR"}
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
      </main>
    </div>
  );
}
