/**
 * Saves one company signer's part of a custom-form submission — shared by
 * CustomFormsPanel's Complete dialog and the direct signing link
 * (/complete-form/<submissionId>, CompleteCustomFormPage). Uploads the new
 * signature/files, merges them into the saved answers, then either leaves it
 * awaiting the remaining signers (several company signers — see
 * customFormSections.ts) or, once the last part is in, marks it completed
 * and saves the finished document.
 */
import { ELEMENT_REGISTRY } from "@/lib/formElements";
import { uploadCustomFormFile } from "@/lib/firebase/storage";
import { saveSubmissionDocument } from "@/lib/documentTemplates/saveDocument";
import { inSigningOrder, isSignerSectionComplete, signerSectionName, splitSignerSections } from "@/lib/customFormSections";
import {
  companyFields, completeCustomFormSubmission, saveCustomFormCompanyPart,
  type CustomForm, type CustomFormResponseValue, type CustomFormSubmission,
} from "@/lib/supabase/customForms";

export interface CompanyPartResult {
  submission: CustomFormSubmission;
  /** Who still has to sign, in signing order (e.g. ["Justin Lee"]) — empty once it's complete. */
  waitingOn: string[];
  /** Completed, but the finished document couldn't be saved (View PDF builds it again). */
  documentError: boolean;
}

export async function saveCompanyPart(
  form: CustomForm,
  submission: CustomFormSubmission,
  values: Record<string, unknown>,
  completedBy: string
): Promise<CompanyPartResult> {
  const responses: Record<string, CustomFormResponseValue> = { ...submission.responses };
  for (const field of companyFields(form)) {
    const v = values[field.id];
    if (ELEMENT_REGISTRY[field.type]?.isFileField) {
      if (v instanceof File) {
        const { url, fullPath } = await uploadCustomFormFile(form.companyId, form.id, submission.id, v);
        responses[field.id] = { url, path: fullPath, fileName: v.name, mimeType: v.type, size: v.size };
      }
    } else if (v !== undefined) {
      responses[field.id] = v as CustomFormResponseValue;
    }
  }

  // Several company signers (e.g. the CEO, then HR): save this part, and
  // only complete — and save the finished document — once the last is in.
  const sections = splitSignerSections(companyFields(form));
  const waitingOn = sections.length > 1 ? inSigningOrder(sections).filter((s) => !isSignerSectionComplete(s, responses)).map(signerSectionName) : [];
  if (waitingOn.length) {
    await saveCustomFormCompanyPart(submission.id, responses);
    return { submission: { ...submission, responses }, waitingOn, documentError: false };
  }

  await completeCustomFormSubmission(submission.id, responses, completedBy);
  const now = new Date().toISOString();
  const completed: CustomFormSubmission = { ...submission, responses, completedAt: now, pdfUrl: null };
  try {
    const { url } = await saveSubmissionDocument(form, completed);
    return { submission: { ...completed, pdfUrl: url, pdfGeneratedAt: now }, waitingOn: [], documentError: false };
  } catch (err) {
    console.error("Completed, but saving the document failed:", err);
    return { submission: completed, waitingOn: [], documentError: true };
  }
}
