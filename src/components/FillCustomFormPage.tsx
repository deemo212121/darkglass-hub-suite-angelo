/**
 * Fill-out page for an "internal" custom form (see CustomFormBuilder.tsx's
 * access toggle) — reachable at /fill-form/$formId, requires login like
 * FillW4Page.tsx etc., but unlike those single-purpose pages this renders
 * whatever field schema the form was built with (CustomFormRenderer).
 *
 * File-bearing answers (file/signature fields) upload straight to Firebase
 * Storage using the caller's own authenticated session (uploadCustomFormFile,
 * same pattern as every other authenticated upload in this app), then the
 * submission itself is written directly via the authenticated Supabase
 * client under normal company RLS — no serverless endpoint needed for this
 * path, unlike the public /apply/$slug route.
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { FillFormSignInRequired } from "@/components/FillFormSignInRequired";
import { randomId } from "@/lib/utils";
import { companyFields, getCustomForm, notifyInternalSubmission, submitCustomFormResponse, type CustomForm } from "@/lib/supabase/customForms";
import { saveSubmissionDocument, submissionDocumentFileName } from "@/lib/documentTemplates/saveDocument";
import { uploadCustomFormFile } from "@/lib/firebase/storage";
import { uploadSubmissionToDriveIfConfigured } from "@/lib/documentTemplates/driveUpload";
import { ELEMENT_REGISTRY } from "@/lib/formElements";
import { getMyProfileId } from "@/lib/supabase/users";
import { companySignerNames, notifyCustomFormSigned } from "@/lib/customFormCompletion";
import { CustomFormRenderer, type CustomFormRendererValue } from "@/components/CustomFormRenderer";
import { hasOwnLetterhead } from "@/lib/documentTemplates/generate";
import usihsLogo from "@/assets/us-in-home-services-logo.png";

interface Props {
  formId: string;
}

export function FillCustomFormPage({ formId }: Props) {
  const { ready, uid, companyId, displayName } = useAuth();
  const [form, setForm] = useState<CustomForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  // What was just submitted — for the "Download a copy" buttons on the thank-you screen.
  const [copy, setCopy] = useState<{ responses: Record<string, any>; submittedAt: string; submitterName: string | null } | null>(null);
  const [copyBusy, setCopyBusy] = useState<"pdf" | "word" | null>(null);

  useEffect(() => {
    if (!ready || !uid) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const doc = await getCustomForm(formId);
        if (cancelled) return;
        if (!doc || doc.access !== "internal" || doc.status !== "published") {
          setError("This form doesn't exist or isn't available right now.");
        } else {
          setForm(doc);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load form.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ready, uid, formId]);

  const handleSubmit = async (values: Record<string, CustomFormRendererValue>, submitterName: string | null) => {
    if (!form || !companyId) return;
    // Just a Storage folder name for file/signature uploads below — not the
    // eventual DB row's real id (Postgres assigns that on insert), which is
    // why the notify call after the insert below uses a separately-returned id.
    const uploadFolderId = randomId();
    const responses: Record<string, any> = {};
    for (const field of form.fields) {
      const v = values[field.id];
      if (ELEMENT_REGISTRY[field.type]?.isFileField) {
        if (v instanceof File) {
          const { url, fullPath } = await uploadCustomFormFile(companyId, form.id, uploadFolderId, v);
          responses[field.id] = { url, path: fullPath, fileName: v.name, mimeType: v.type, size: v.size };
        }
      } else if (v !== undefined) {
        responses[field.id] = v;
      }
    }
    const submittedAt = new Date().toISOString();
    const { id: submissionId } = await submitCustomFormResponse({ formId: form.id, formTitle: form.title, submitterName, responses });
    setCopy({ responses, submittedAt, submitterName });
    setSubmitted(true);
    // Both best-effort — HR not finding out immediately, or the PDF not
    // landing in Drive, isn't worth failing an already-saved submission
    // over, so both are fire-and-forget.
    notifyInternalSubmission(submissionId).catch((err) => console.error("[fill-form] HR notify failed (submission was still saved):", err));
    void uploadSubmissionToDriveIfConfigured(form.documentTemplate, form, { id: submissionId, responses, submittedAt });
    // Team Messenger reply to the form's creator (and HR), like the other
    // HR forms — who signed, and who's still to sign; see notifyCustomFormSigned.
    const myProfileId = uid ? await getMyProfileId(uid).catch(() => null) : null;
    const signerName = submitterName || displayName || "Someone";
    const submission = { id: submissionId, formTitle: form.title, submitterName, responses, submittedAt };
    // One-party form: it's done now, so file its document. A form with
    // "Filled in by: Company" fields is filed when HR completes it instead.
    if (companyFields(form).length === 0) {
      saveSubmissionDocument(form, { id: submissionId, responses, submittedAt, submitterName })
        .then(({ url }) => { if (myProfileId) void notifyCustomFormSigned({ form, submission, signerProfileId: myProfileId, signerName, waitingOn: [], pdfUrl: url }); })
        .catch((err) => {
          console.error("[fill-form] Saving the document failed (submission was still saved — HR can open it from Custom Forms):", err);
          if (myProfileId) void notifyCustomFormSigned({ form, submission, signerProfileId: myProfileId, signerName, waitingOn: [] });
        });
    } else if (myProfileId) {
      void notifyCustomFormSigned({ form, submission, signerProfileId: myProfileId, signerName, waitingOn: companySignerNames(form) });
    }
  };

  const downloadCopy = async (kind: "pdf" | "word") => {
    if (!form || !copy) return;
    setCopyBusy(kind);
    try {
      const blob = kind === "pdf"
        ? await (await import("@/lib/documentTemplates/generate")).generateSubmissionDocumentPdf(form, copy)
        : await (await import("@/lib/documentTemplates/docx")).generateSubmissionDocx(form, copy);
      const name = submissionDocumentFileName(form, copy);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = kind === "pdf" ? name : name.replace(/\.pdf$/, ".docx");
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      console.error("[fill-form] Couldn't build the copy:", err);
    } finally {
      setCopyBusy(null);
    }
  };

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
            <Loader2 className="h-4 w-4 animate-spin" /> Loading form…
          </div>
        ) : error && !form ? (
          <div className="panel p-6 text-sm text-red-300">{error}</div>
        ) : !form ? null : submitted ? (
          <div className="panel p-6 text-center">
            <p className="text-sm font-semibold">✅ Submitted — thanks!</p>
            {copy && (
              <div className="mt-3 flex items-center justify-center gap-2">
                <span className="text-xs text-muted-foreground">Download a copy:</span>
                {(["pdf", "word"] as const).map((kind) => (
                  <button key={kind} type="button" disabled={!!copyBusy} onClick={() => void downloadCopy(kind)} className="btn text-xs px-2.5 py-1.5 flex items-center gap-1 disabled:opacity-50">
                    {copyBusy === kind && <Loader2 className="h-3 w-3 animate-spin" />} {kind === "pdf" ? "PDF" : "Word"}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="panel p-4 sm:p-5">
            <h1 className="text-lg font-bold mb-1">{form.title}</h1>
            {form.description && <p className="text-sm text-muted-foreground mb-4">{form.description}</p>}
            {/* Paper view — the form as the document it becomes (same logo and layout as its PDF). */}
            <CustomFormRenderer
              fields={form.fields}
              onSubmit={handleSubmit}
              paper={{
                header: (
                  <>
                    {!hasOwnLetterhead(form.fields) && <img src={usihsLogo} alt="US In Home Services" className="h-[100px] w-[100px] mx-auto mb-5" />}
                    {/* The PDF prints the form's title only when the form has no heading of its own. */}
                    {!form.fields.some((f) => f.type === "heading" && !f.hidden) && <h2 className="text-center mb-4">{form.title}</h2>}
                  </>
                ),
              }}
            />
          </div>
        )}
      </main>
    </div>
  );
}
