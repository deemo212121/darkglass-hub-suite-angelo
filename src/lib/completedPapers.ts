/**
 * HR Paperworks — completed papers. A completed paper has no Delete button,
 * and at AH Solutions only the people below, plus Super Admin, can open it
 * (View / Download PDF). Everyone who can open HR Paperworks still sees it
 * listed, and can still view and delete papers that aren't completed yet.
 * Other companies: everyone who can open HR Paperworks can view it.
 *
 * People are keyed by Firebase uid, which stays the same if someone changes
 * their email. To let someone view completed papers, add them here.
 */
import { isCompanySuperAdminRole } from "./roleLabels";
import { DOCUMENT_TYPES_REQUIRING_EMPLOYER_SIGNATURE } from "./signableDocumentRegistry";
import type { SignableDocumentStatus, SignableDocumentType } from "./supabase/signableDocuments";

const LIMITED_COMPANY = "COMP001";

const COMPLETED_PAPER_VIEWERS: Record<string, string> = {
  ujnXwUP5RAUZY4JL2A8FsDGSQ8s2: "Wincel Franz Carusca",
  ri5rDxKr1gR752cqRKqs59VMj8m2: "Shin Seo (Angella)",
  jKOTfeiKcDfm0wzOhI4MkG6PhCg1: "Justin Lee",
};

/**
 * Papers finished only once HR / the employer / the manager completes them
 * ("confirmed") — for these, "signed" is just the employee's half. Every
 * other type needs only the employee, so "signed" already finishes it
 * (shown as Submitted / Signed).
 */
const COMPLETED_WHEN_CONFIRMED = new Set<SignableDocumentType>([
  ...DOCUMENT_TYPES_REQUIRING_EMPLOYER_SIGNATURE,
  "contractor_addendum",
  "warning_form",
  "promotion_form",
  "action_plan_form",
  "termination_form",
  "compensation_update",
]);

export function isCompletedPaper(doc: { documentType: SignableDocumentType; status: SignableDocumentStatus }): boolean {
  if (doc.status === "confirmed") return true;
  return doc.status === "signed" && !COMPLETED_WHEN_CONFIRMED.has(doc.documentType);
}

/** Whether this person may open completed papers — see the header. An unknown company (still loading) counts as AH Solutions. */
export function canViewCompletedPapers(who: {
  uid: string | null | undefined;
  companyId: string | null | undefined;
  role: string | null | undefined;
  extraRoles: string[] | null | undefined;
}): boolean {
  if (who.companyId && who.companyId !== LIMITED_COMPANY) return true;
  if (isCompanySuperAdminRole(who.role, who.extraRoles)) return true;
  return !!who.uid && Object.prototype.hasOwnProperty.call(COMPLETED_PAPER_VIEWERS, who.uid);
}
