/**
 * "Saved in the system once done" — renders a finished custom form
 * submission's document (generateSubmissionDocumentPdf), uploads it next to
 * the submission's own files in Firebase Storage, and records the URL on
 * the submission (pdf_url, migration 0368). Client-side only, like
 * generate.ts: called from the internal fill page right after a one-party
 * form is submitted, and from HR's Custom Forms tab when a two-party form is
 * completed or an older submission's document is first opened.
 */
import { generateSubmissionDocumentPdf } from "./generate";
import { uploadCustomFormFile } from "@/lib/firebase/storage";
import { saveCustomFormSubmissionPdf, type CustomForm, type CustomFormSubmission } from "@/lib/supabase/customForms";

/** "Information Security Agreement - Daven Hodge.pdf" */
export function submissionDocumentFileName(form: Pick<CustomForm, "title">, submission: Pick<CustomFormSubmission, "submitterName">): string {
  const name = `${form.title} - ${submission.submitterName || "Submission"}`.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return `${name}.pdf`;
}

export async function saveSubmissionDocument(
  form: Pick<CustomForm, "id" | "companyId" | "title" | "fields" | "documentTemplate">,
  submission: Pick<CustomFormSubmission, "id" | "responses" | "submittedAt" | "submitterName">
): Promise<{ url: string; blob: Blob }> {
  const blob = await generateSubmissionDocumentPdf(form, submission);
  const file = new File([blob], submissionDocumentFileName(form, submission), { type: "application/pdf" });
  const { url } = await uploadCustomFormFile(form.companyId, form.id, submission.id, file);
  await saveCustomFormSubmissionPdf(submission.id, url);
  return { url, blob };
}
