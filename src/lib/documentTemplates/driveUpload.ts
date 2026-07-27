/**
 * "Every submission gets its generated PDF auto-uploaded to the company's
 * connected Google Drive" (see src/lib/server/googleDriveBridge.ts) —
 * called right after a successful submission by both ApplyFormPage.tsx
 * (public) and FillCustomFormPage.tsx (internal). PDF generation has to
 * happen here, in the submitter's own browser, since it needs
 * html2canvas/a real DOM+canvas — the server can't do this itself.
 *
 * Deliberately silent on any failure (no template configured, company
 * hasn't connected Drive, network hiccup) — this rides on top of an
 * already-successful submission and must never surface as an error to
 * whoever just submitted the form. Errors are logged, not thrown.
 */
import { generateSubmissionPdf } from "./generate";
import type { DocumentTemplate } from "./types";
import type { CustomFormField } from "@/lib/formElements";
import type { CustomFormResponseValue } from "@/lib/supabase/customForms";

export async function uploadSubmissionToDriveIfConfigured(
  documentTemplate: DocumentTemplate | null | undefined,
  form: { fields: CustomFormField[]; driveUploadEnabled?: boolean },
  submission: { id: string; responses: Record<string, CustomFormResponseValue>; submittedAt: string }
): Promise<void> {
  if (!documentTemplate || documentTemplate.blocks.length === 0) return;
  // driveUploadEnabled defaults true for any caller that doesn't pass it (older shape), so this is purely additive — see CustomFormsPanel.tsx's per-form "Drive" toggle.
  if (form.driveUploadEnabled === false) return;
  try {
    const blob = await generateSubmissionPdf(documentTemplate, form, submission);
    const body = new FormData();
    body.set("submissionId", submission.id);
    body.set("file", blob, "submission.pdf");
    const res = await fetch("/api/google-drive?action=upload", { method: "POST", body });
    if (!res.ok) throw new Error(`Drive upload responded ${res.status}`);
  } catch (err) {
    console.error("[drive-upload] failed (submission was still saved):", err);
  }
}
