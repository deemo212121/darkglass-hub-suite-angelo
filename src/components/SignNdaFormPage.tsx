/**
 * Sign Non-Disclosure Agreement — opened from the deep link a Team
 * Messenger message sends (see ReportHRDaily.tsx's "Non-Disclosure
 * Agreement" tab "Send" flow). Same shape as
 * FillEmployeeConfidentialityPage.tsx (single recipient fills in their own
 * blank fields and signs, no employer/HR co-signature step) but built with
 * this app's HTML/letterhead pipeline (captureHtmlPagesToPdfBlob) instead
 * of a real-PDF canvas overlay, across 4 real pages — see
 * ndaFormTemplate.ts's header comment for the full breakdown.
 *
 * A 4-step Back/Next/Submit wizard, matching the source document's own
 * paging: step 1 collects the blank identity fields (name/nationality/
 * address/branch); steps 2-3 are read-only acknowledgment pages; step 4
 * shows the final execution block and is where the actual signature is
 * captured (once — then stamped onto every page's repeated "Employee
 * Signature" line in the generated PDF, see ndaFormTemplate.ts).
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import { getSignableDocument, signDocument, type SignableDocument } from "@/lib/supabase/signableDocuments";
import { uploadSignableDocumentSignature, uploadNdaForm, refreshStorageAuthToken } from "@/lib/firebase/storage";
import { captureHtmlPagesToPdfBlob, loadAssetDataUrl } from "@/lib/pdfCapture";
import { buildNdaFormPages, ndaFormStyles, NDA_BRANCHES, type NdaFormData } from "@/lib/ndaFormTemplate";
import { getOrCreateDmThread, sendMessage } from "@/lib/supabase/messaging";
import { logActivity } from "@/lib/supabase/hrActivityLog";
import { getHrNotificationSettings } from "@/lib/supabase/companySettings";
import { notifyHrRoleUsers } from "@/lib/supabase/hrRoleNotify";
import { useSignaturePad } from "@/hooks/useSignaturePad";
import { SignaturePadControls } from "@/components/SignaturePad";

interface Props {
  docId: string;
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

export function SignNdaFormPage({ docId }: Props) {
  const { ready, uid, displayName, role } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [doc, setDoc] = useState<SignableDocument | null>(null);
  const [logo, setLogo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [step, setStep] = useState(1);

  const [form, setForm] = useState<NdaFormData>({ ...BLANK_FORM });

  const sigPad = useSignaturePad({ defaultName: form.employeeName, width: 440, height: 100 });

  useEffect(() => {
    if (!ready || !uid) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [profileId, logoUrl, document] = await Promise.all([
          getMyProfileId(uid),
          loadAssetDataUrl(() => import("@/assets/us-in-home-services-logo.png")),
          getSignableDocument(docId),
        ]);
        if (cancelled) return;
        setMyProfileId(profileId);
        setLogo(logoUrl);
        if (!document || document.documentType !== "nda_form") {
          setError("This document doesn't exist or has been removed.");
        } else {
          setDoc(document);
          const existing = document.formData as Partial<NdaFormData>;
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

  const updateField = <K extends keyof NdaFormData>(key: K, value: NdaFormData[K]) => setForm((f) => ({ ...f, [key]: value }));

  const step1Error = (): string | null => {
    if (!form.employeeName.trim()) return "Enter your full name.";
    if (!form.nationality.trim()) return "Enter your nationality.";
    if (!form.address.trim()) return "Enter your street address.";
    if (!form.city.trim()) return "Enter your city.";
    if (!form.state.trim()) return "Enter your state.";
    if (!form.zip.trim()) return "Enter your zip code.";
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

  const handleSubmit = async () => {
    if (!doc || !myProfileId) return;
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
    setSubmitting(true);
    setError(null);
    try {
      const companyId = doc.companyId;
      // Force a fresh ID token before this upload sequence — see
      // refreshStorageAuthToken's doc comment (a slow connection can let
      // it go stale between signing in and finally submitting).
      await refreshStorageAuthToken();
      const signatureUrl = await uploadSignableDocumentSignature(companyId, doc.id, "employee", dataUrl);
      const signedAt = new Date().toISOString();
      const finalData: NdaFormData = { ...form, dateSigned: signedAt };
      const entry = { name: displayName || form.employeeName || "Signed", url: signatureUrl, signedAt };

      const pages = buildNdaFormPages(finalData, logo, { ...entry, url: dataUrl });
      const pdfBlob = await captureHtmlPagesToPdfBlob(pages, ndaFormStyles);
      const pdfUrl = await uploadNdaForm(companyId, form.employeeName, pdfBlob);

      await signDocument(doc.id, "employee", entry, pdfUrl, finalData as unknown as Record<string, any>);

      if (doc.createdBy) {
        const thread = await getOrCreateDmThread(myProfileId, doc.createdBy);
        const filename = `Non-Disclosure Agreement - ${form.employeeName}.pdf`;
        await sendMessage({
          dmThreadId: thread.id,
          senderId: myProfileId,
          senderName: displayName || "Employee",
          body: `📄 Non-Disclosure Agreement for ${form.employeeName} has been signed: [${filename}](${pdfUrl})`,
        });
      }

      // Opt-in broadcast — reuses the Warning Form's notify toggle (see
      // Notifications Settings, migration 0090) since there's no dedicated
      // NDA setting yet, same fallback SignActionPlanFormPage.tsx uses.
      getHrNotificationSettings()
        .then(({ warningForm }) => {
          if (!warningForm) return;
          const excludeIds = doc.createdBy ? [doc.createdBy] : [];
          void notifyHrRoleUsers(myProfileId, displayName || "Employee", excludeIds, `📄 Non-Disclosure Agreement for ${form.employeeName} has been signed.`);
        })
        .catch((err) => console.error("[nda-form] hr notify check failed:", err));

      setDoc({ ...doc, status: "signed", pdfUrl, formData: finalData as unknown as Record<string, any>, signatures: { employee: entry }, signedAt });
      void logActivity({ action: "nda_form_signed", targetType: "employee", targetLabel: form.employeeName });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit form.");
    } finally {
      setSubmitting(false);
    }
  };

  const isRecipient = !!doc && !!myProfileId && doc.recipientId === myProfileId;
  const isSuperadmin = role === "SUPERSUPERADMIN";

  const inputCls = "glass-input text-sm py-1.5 px-3 rounded-md w-full";

  const currentPages = buildNdaFormPages(form, logo, undefined);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-3xl mx-auto p-4">
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
          <div className="panel p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-end">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Page {step} of {TOTAL_STEPS}</span>
            </div>

            {step === 1 && (
              <div className="p-4 space-y-3 border-b border-white/10">
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Full Name</label>
                    <input value={form.employeeName} onChange={(e) => updateField("employeeName", e.target.value)} className={inputCls} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Nationality</label>
                    <input value={form.nationality} onChange={(e) => updateField("nationality", e.target.value)} className={inputCls} />
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Street Address</label>
                  <input value={form.address} onChange={(e) => updateField("address", e.target.value)} className={inputCls} />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">City</label>
                    <input value={form.city} onChange={(e) => updateField("city", e.target.value)} className={inputCls} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">State</label>
                    <input value={form.state} onChange={(e) => updateField("state", e.target.value)} className={inputCls} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Zip</label>
                    <input value={form.zip} onChange={(e) => updateField("zip", e.target.value)} className={inputCls} />
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Branch (leave blank if PH)</label>
                  <select value={form.branch} onChange={(e) => updateField("branch", e.target.value)} className={inputCls}>
                    <option value="">Please Select</option>
                    {NDA_BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
              </div>
            )}

            <div className="overflow-x-auto bg-white/5 p-4 flex justify-center">
              <div style={{ transform: "scale(0.78)", transformOrigin: "top center" }}>
                <style dangerouslySetInnerHTML={{ __html: ndaFormStyles }} />
                <div dangerouslySetInnerHTML={{ __html: currentPages[step - 1] }} />
              </div>
            </div>

            {step === TOTAL_STEPS && (
              <div className="p-4 border-t border-white/10">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Signature</label>
                <canvas
                  {...sigPad.canvasProps}
                  className={`bg-white rounded-md border border-white/15 w-full max-w-md ${sigPad.canvasProps.className}`}
                />
                <div className="mt-2">
                  <SignaturePadControls pad={sigPad} />
                </div>
              </div>
            )}

            {error && (
              <p className="mx-4 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2 mt-3">{error}</p>
            )}

            <div className="p-4 border-t border-white/10 flex items-center justify-between gap-2">
              <button
                onClick={goBack}
                disabled={step === 1 || submitting}
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
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="btn text-sm px-4 py-2 bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
                >
                  {submitting ? "Submitting…" : "Submit"}
                </button>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
