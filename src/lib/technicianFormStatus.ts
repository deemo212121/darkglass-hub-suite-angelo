/**
 * A frozen technician's own "which Technician-tab forms do I still need to
 * sign" list — powers FrozenAccountModal.tsx on both desktop and mobile.
 * Mirrors TechnicianFormChecklistPage.tsx's done/missing logic exactly
 * (same TECHNICIAN_FORM_TYPES list, same signed/confirmed = done rule,
 * same exemption carve-out) but scoped to one profile instead of the whole
 * company, via getSignableDocumentsForRecipient. Requires migration 0224
 * (a technician can only read their OWN technician_form_exemptions rows).
 */
import { getSignableDocumentsForRecipient, type SignableDocument, type SignableDocumentType } from "@/lib/supabase/signableDocuments";
import { getTechnicianFormExemptions } from "@/lib/supabase/technicianFormExemptions";
import { SIGNABLE_DOCUMENT_REGISTRY, TECHNICIAN_FORM_TYPES } from "@/lib/signableDocumentRegistry";

export interface IncompleteTechForm {
  type: SignableDocumentType;
  label: string;
  /** true = sent and awaiting signature; false = never sent yet. */
  pending: boolean;
  /** Set only when pending — the doc to link straight to (internalPath + "/" + docId). Nothing to link to yet when not sent. */
  docId: string | null;
}

function isComplete(doc: SignableDocument | undefined): boolean {
  return doc?.status === "signed" || doc?.status === "confirmed";
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
    if (isComplete(doc)) continue;
    incomplete.push({ type, label: SIGNABLE_DOCUMENT_REGISTRY[type]?.label ?? type, pending: !!doc, docId: doc?.id ?? null });
  }
  return incomplete;
}
