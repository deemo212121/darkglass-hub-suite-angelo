/**
 * Public fill-out page for a "public" custom form (see CustomFormBuilder.tsx's
 * access toggle) — reachable at /apply/$slug with NO login required, the
 * self-built equivalent of opening a Jotform link today. Deliberately has
 * no AppHeader/ModuleNavigator chrome (see __root.tsx's hideChrome check)
 * since a visitor here has no AHS account at all.
 *
 * Talks only to /api/custom-forms (src/lib/server/customFormsBridge.ts) —
 * never touches Supabase directly, since an anonymous browser has no
 * session for RLS to scope to.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import logo from "@/assets/Admin Hub Solutions Logo no Text.png";
import { ELEMENT_REGISTRY, type CustomFormField } from "@/lib/formElements";
import { CustomFormRenderer, type CustomFormRendererValue } from "@/components/CustomFormRenderer";
import { uploadSubmissionToDriveIfConfigured } from "@/lib/documentTemplates/driveUpload";
import type { DocumentTemplate } from "@/lib/documentTemplates/types";
import type { CustomFormResponseValue } from "@/lib/supabase/customForms";

interface Props {
  slug: string;
}

interface PublicForm {
  id: string;
  title: string;
  description: string | null;
  fields: CustomFormField[];
  documentTemplate: DocumentTemplate | null;
  driveUploadEnabled: boolean;
}

export function ApplyFormPage({ slug }: Props) {
  const [form, setForm] = useState<PublicForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/custom-forms?slug=${encodeURIComponent(slug)}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(res.status === 404 ? "This form doesn't exist or is no longer available." : (body.error || "Failed to load form."));
        }
        const data = (await res.json()) as PublicForm;
        if (!cancelled) setForm(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load form.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  const handleSubmit = async (values: Record<string, CustomFormRendererValue>, submitterName: string | null) => {
    if (!form) return;
    const fd = new FormData();
    const plain: Record<string, unknown> = {};
    for (const field of form.fields) {
      const v = values[field.id];
      if (ELEMENT_REGISTRY[field.type]?.isFileField) {
        if (v instanceof File) fd.append(`file_${field.id}`, v);
      } else if (v !== undefined) {
        plain[field.id] = v;
      }
    }
    fd.append("responses", JSON.stringify(plain));
    fd.append("submitterName", submitterName ?? "");

    const submittedAt = new Date().toISOString();
    const res = await fetch(`/api/custom-forms?slug=${encodeURIComponent(slug)}`, { method: "POST", body: fd });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Failed to submit form.");
    }
    setSubmitted(true);
    // Best-effort — a PDF not landing in Drive isn't worth failing an
    // already-saved submission over, so this is fire-and-forget.
    const { submissionId } = (await res.json().catch(() => ({}))) as { submissionId?: string };
    if (submissionId) void uploadSubmissionToDriveIfConfigured(form.documentTemplate, form, { id: submissionId, responses: plain as Record<string, CustomFormResponseValue>, submittedAt });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-2xl">
        <div className="flex justify-center mb-4">
          <img src={logo} alt="Admin Hub Solutions" className="h-10 w-auto opacity-80" />
        </div>

        {loading ? (
          <div className="panel p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading form…
          </div>
        ) : error && !form ? (
          <div className="panel p-6 text-sm text-red-300 text-center">{error}</div>
        ) : !form ? null : submitted ? (
          <div className="panel p-8 text-center">
            <p className="text-base font-semibold">✅ Submitted — thank you!</p>
          </div>
        ) : (
          <div className="panel p-5">
            <h1 className="text-lg font-bold mb-1">{form.title}</h1>
            {form.description && <p className="text-sm text-muted-foreground mb-4">{form.description}</p>}
            <CustomFormRenderer fields={form.fields} onSubmit={handleSubmit} />
          </div>
        )}
      </div>
    </div>
  );
}
