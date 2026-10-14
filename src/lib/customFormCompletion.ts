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
import { getAppUrl } from "@/lib/appUrl";
import { getOrCreateDmThread, sendMessage } from "@/lib/supabase/messaging";
import { notifyHrRoleUsers } from "@/lib/supabase/hrRoleNotify";
import { getHrNotificationSettings } from "@/lib/supabase/companySettings";
import { submissionDocumentFileName } from "@/lib/documentTemplates/saveDocument";
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

/** The form's company parts in signing order, by who signs them (e.g. ["HR", "Justin Lee"]) — ["the company"] for a single unnamed part, [] when there's none. */
export function companySignerNames(form: Pick<CustomForm, "fields">): string[] {
  const sections = splitSignerSections(companyFields(form));
  if (!sections.length) return [];
  if (sections.length === 1 && !sections[0].heading?.config?.signer?.name) return ["the company"];
  return inSigningOrder(sections).map(signerSectionName);
}

/**
 * The Team Messenger reply when someone signs a custom form — the same as
 * the other HR forms: a DM from the signer to whoever set the form up (its
 * creator), plus every HR account when HR's signed-forms notification
 * setting is on. Says who signed and who's still to sign (with the signing
 * link to pass on), or links the finished PDF once everyone has. Best effort
 * — a failed message never fails the signing itself.
 */
export async function notifyCustomFormSigned(args: {
  form: CustomForm;
  submission: Pick<CustomFormSubmission, "id" | "formTitle" | "submitterName" | "responses" | "submittedAt">;
  signerProfileId: string;
  signerName: string;
  /** What they signed, e.g. "HR" — omitted for the person filling it in. */
  part?: string;
  waitingOn: string[];
  pdfUrl?: string | null;
}): Promise<void> {
  try {
    const { form, submission, signerProfileId, signerName, part, waitingOn, pdfUrl } = args;
    // "<title> for <person>" — just the title when it already names them (e.g. "… — Yujung (Chris) Yong").
    const formTitle = submission.formTitle || form.title;
    const who = submission.submitterName || "someone";
    const title = submission.submitterName && formTitle.includes(submission.submitterName) ? formTitle : `${formTitle} for ${who}`;
    const signed = part ? `${signerName} signed the ${part} part` : `${signerName} signed it`;
    const body = waitingOn.length
      ? `📄 ${title}: ${signed}. Still waiting on: ${waitingOn.join(", ")} — signing link: [Open to sign](${getAppUrl()}/complete-form/${submission.id})`
      : pdfUrl
        ? `📄 ${title} has been signed by everyone: [${submissionDocumentFileName(form, submission)}](${pdfUrl})`
        : `📄 ${title} has been signed by everyone.`;
    if (form.createdBy && form.createdBy !== signerProfileId) {
      const thread = await getOrCreateDmThread(signerProfileId, form.createdBy);
      await sendMessage({ dmThreadId: thread.id, senderId: signerProfileId, senderName: signerName, body });
    }
    const { taxForms } = await getHrNotificationSettings();
    if (taxForms) await notifyHrRoleUsers(signerProfileId, signerName, form.createdBy ? [form.createdBy] : [], body);
  } catch (err) {
    console.error("[custom-forms] signed-message failed (the signature itself was saved):", err);
  }
}

export async function saveCompanyPart(
  form: CustomForm,
  submission: CustomFormSubmission,
  values: Record<string, unknown>,
  completedBy: string,
  signerName: string
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
  // The part(s) this person just signed — for the messenger reply.
  const part = sections.length > 1
    ? sections.filter((s) => !isSignerSectionComplete(s, submission.responses) && isSignerSectionComplete(s, responses)).map(signerSectionName).join(", ") || undefined
    : undefined;
  if (waitingOn.length) {
    await saveCustomFormCompanyPart(submission.id, responses);
    const saved = { ...submission, responses };
    void notifyCustomFormSigned({ form, submission: saved, signerProfileId: completedBy, signerName, part, waitingOn });
    return { submission: saved, waitingOn, documentError: false };
  }

  await completeCustomFormSubmission(submission.id, responses, completedBy);
  const now = new Date().toISOString();
  const completed: CustomFormSubmission = { ...submission, responses, completedAt: now, pdfUrl: null };
  try {
    const { url } = await saveSubmissionDocument(form, completed);
    void notifyCustomFormSigned({ form, submission: completed, signerProfileId: completedBy, signerName, part, waitingOn: [], pdfUrl: url });
    return { submission: { ...completed, pdfUrl: url, pdfGeneratedAt: now }, waitingOn: [], documentError: false };
  } catch (err) {
    console.error("Completed, but saving the document failed:", err);
    void notifyCustomFormSigned({ form, submission: completed, signerProfileId: completedBy, signerName, part, waitingOn: [] });
    return { submission: completed, waitingOn: [], documentError: true };
  }
}
