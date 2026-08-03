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
import { getCustomForm, notifyInternalSubmission, submitCustomFormResponse, type CustomForm } from "@/lib/supabase/customForms";
import { uploadCustomFormFile } from "@/lib/firebase/storage";
import { uploadSubmissionToDriveIfConfigured } from "@/lib/documentTemplates/driveUpload";
import { ELEMENT_REGISTRY } from "@/lib/formElements";
import { CustomFormRenderer, type CustomFormRendererValue } from "@/components/CustomFormRenderer";

interface Props {
  formId: string;
}

export function FillCustomFormPage({ formId }: Props) {
  const { ready, uid, companyId } = useAuth();
  const [form, setForm] = useState<CustomForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

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
    const uploadFolderId = crypto.randomUUID();
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
    setSubmitted(true);
    // Both best-effort — HR not finding out immediately, or the PDF not
    // landing in Drive, isn't worth failing an already-saved submission
    // over, so both are fire-and-forget.
    notifyInternalSubmission(submissionId).catch((err) => console.error("[fill-form] HR notify failed (submission was still saved):", err));
    void uploadSubmissionToDriveIfConfigured(form.documentTemplate, form, { id: submissionId, responses, submittedAt });
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-2xl mx-auto p-4">
        <Link to="/home" className="btn text-xs px-2.5 py-1.5 flex items-center gap-1 w-fit mb-4">
          <ChevronLeft className="h-3.5 w-3.5" /> Home
        </Link>

        {loading ? (
          <div className="panel p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading form…
          </div>
        ) : error && !form ? (
          <div className="panel p-6 text-sm text-red-300">{error}</div>
        ) : !form ? null : submitted ? (
          <div className="panel p-6 text-center">
            <p className="text-sm font-semibold">✅ Submitted — thanks!</p>
          </div>
        ) : (
          <div className="panel p-5">
            <h1 className="text-lg font-bold mb-1">{form.title}</h1>
            {form.description && <p className="text-sm text-muted-foreground mb-4">{form.description}</p>}
            <CustomFormRenderer fields={form.fields} onSubmit={handleSubmit} />
          </div>
        )}
      </main>
    </div>
  );
}
