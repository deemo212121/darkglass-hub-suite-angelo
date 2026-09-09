/**
 * A frozen technician's own "which Technician-tab forms do I still need to
 * sign" list — powers FrozenAccountModal.tsx on both desktop and mobile.
 * Uses signableDocumentRegistry.ts's shared getDocumentReviewStatus, same
 * as TechnicianFormChecklistPage.tsx, but with a narrower definition of
 * "incomplete" than that page's done/missing count: a form sitting in
 * "awaiting_hr" (the technician already signed; it's HR's countersignature
 * that's outstanding, not theirs) is deliberately left OFF this list —
 * there's nothing left for the technician themselves to do, so it
 * shouldn't read as something blocking their unfreeze. Only "not_sent" and
 * "awaiting_employee" (needs the technician's own action) show up here.
 * Scoped to one profile instead of the whole company, via
 * getSignableDocumentsForRecipient. Requires migration 0224 (a technician
 * can only read their OWN technician_form_exemptions rows).
 */
import { getSignableDocumentsForRecipient, type SignableDocument, type SignableDocumentType } from "@/lib/supabase/signableDocuments";
import { getTechnicianFormExemptions } from "@/lib/supabase/technicianFormExemptions";
import { SIGNABLE_DOCUMENT_REGISTRY, TECHNICIAN_FORM_TYPES, getDocumentReviewStatus } from "@/lib/signableDocumentRegistry";

export interface IncompleteTechForm {
  type: SignableDocumentType;
  label: string;
  /** true = sent and awaiting the technician's own signature; false = never sent yet. */
  pending: boolean;
  /** Set only when pending — the doc to link straight to (internalPath + "/" + docId). Nothing to link to yet when not sent. */
  docId: string | null;
}

export async function getMyIncompleteTechForms(profileId: string): Promise<IncompleteTechForm[]> {
  const [docs, exemptions] = await Promise.all([
    getSignableDocumentsForRecipient(profileId),
    getTechnicianFormExemptions(),
  ]);

  // Newest-first, so the first match per type is the current one.
  const latestByType = new Map<SignableDocumentType, SignableDocument>();
  for (const d of docs) {
    if (!latestByType.has(d.documentType)) latestByType.set(d.documentType, d);
  }

  const incomplete: IncompleteTechForm[] = [];
  for (const type of TECHNICIAN_FORM_TYPES) {
    if (exemptions.has(`${profileId}|${type}`)) continue;
    const doc = latestByType.get(type);
    const reviewStatus = getDocumentReviewStatus(type, doc);
    if (reviewStatus === "done" || reviewStatus === "awaiting_hr") continue;
    incomplete.push({ type, label: SIGNABLE_DOCUMENT_REGISTRY[type]?.label ?? type, pending: reviewStatus === "awaiting_employee", docId: doc?.id ?? null });
  }
  return incomplete;
}
