import { supabase } from "./client";
import { deleteAgentNote } from "./csrAgentNotes";
import { getTechnicianFormExemptions } from "./technicianFormExemptions";
import { setProfileFrozen } from "./users";
import {
  TECHNICIAN_FORM_TYPES,
  SIGNABLE_DOCUMENT_REGISTRY,
  isTechnicianExemptFromForm,
  getDocumentReviewStatus,
} from "@/lib/signableDocumentRegistry";

export type SignableDocumentType = "warning_form" | "w8ben" | "w4" | "w9" | "w4r" | "i9" | "wage_ack" | "car_iq_agreement" | "vehicle_agreement" | "employee_confidentiality" | "meal_rest_break" | "pto_ack" | "parts_responsibility" | "mileage_fuel" | "location_consent" | "damage" | "contractor_data" | "contractor_data_us" | "direct_deposit" | "promotion_form" | "action_plan_form" | "termination_form" | "substance_screening" | "flash_technician_travel" | "nda_form" | "vehicle_use_agreement" | "contractor_addendum";
/** "executive" only applies to promotion_form documents (see migration 0166) — every other document type just never uses that slot. */
export type SignatureSlot = "employee" | "manager" | "senior_manager" | "hr_staff" | "executive";
export type SignableDocumentStatus = "pending_signature" | "signed" | "confirmed" | "cancelled";

export interface SignatureEntry {
  name: string;
  url: string;
  signedAt: string;
}

export interface SignableDocument {
  id: string;
  companyId: string;
  documentType: SignableDocumentType;
  formData: Record<string, any>;
  signatures: Partial<Record<SignatureSlot, SignatureEntry>>;
  status: SignableDocumentStatus;
  /** Null for an external (no-login) recipient — see recipientName instead. */
  recipientId: string | null;
  /** Set only for an external recipient (no AHS profile) — a name HR typed in, not looked up from `employees`. */
  recipientName: string | null;
  recipientSlot: SignatureSlot;
  pdfUrl: string | null;
  agentNoteId: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  signedAt: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
}

// Joins the creator's name directly (rather than relying on the app's
// `employees` list, which deliberately excludes SUPERADMIN accounts —
// a warning form created while signed in as one would otherwise always
// show a blank "Issued By").
const SELECT =
  "id, company_id, document_type, form_data, signatures, status, recipient_id, recipient_name, recipient_slot, pdf_url, agent_note_id, created_by, created_at, signed_at, confirmed_at, cancelled_at, creator:created_by (display_name, username)";

function mapRow(r: any): SignableDocument {
  return {
    id: r.id,
    companyId: r.company_id,
    documentType: r.document_type,
    formData: r.form_data,
    signatures: r.signatures ?? {},
    status: r.status,
    recipientId: r.recipient_id,
    recipientName: r.recipient_name,
    recipientSlot: r.recipient_slot,
    pdfUrl: r.pdf_url,
    agentNoteId: r.agent_note_id,
    createdBy: r.created_by,
    createdByName: r.creator?.display_name || r.creator?.username || null,
    createdAt: r.created_at,
    signedAt: r.signed_at,
    confirmedAt: r.confirmed_at,
    cancelledAt: r.cancelled_at,
  };
}

/** Exactly one of recipientId (existing AHS teammate — the normal, login-gated flow) or recipientName (a freely-typed name, no AHS account — see createExternalSignableDocument's header comment on why that path opens a separate no-login link) should be set. */
export async function createSignableDocument(input: {
  documentType: SignableDocumentType;
  formData: Record<string, any>;
  recipientId?: string;
  recipientName?: string;
  recipientSlot: SignatureSlot;
  pdfUrl: string;
}): Promise<SignableDocument> {
  const { data, error } = await supabase
    .from("hr_signable_documents")
    .insert({
      document_type: input.documentType,
      form_data: input.formData,
      recipient_id: input.recipientId ?? null,
      recipient_name: input.recipientName ?? null,
      recipient_slot: input.recipientSlot,
      pdf_url: input.pdfUrl,
    })
    .select(SELECT)
    .single();
  if (error) throw new Error(error.message);
  return mapRow(data);
}

export async function getSignableDocument(id: string): Promise<SignableDocument | null> {
  const { data, error } = await supabase.from("hr_signable_documents").select(SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRow(data) : null;
}

// Supabase caps an unbounded select at 1000 rows — a company's full
// signable-document history can exceed that. Page through in chunks of 1000.
const PAGE_SIZE = 1000;

/**
 * A technician missing any of these can't be dispatched on a route — see
 * getTechnicianIdsMissingRouteDocuments below and its callers in
 * ticket.$ticketNo.tsx (the Technician / 2nd Technician assignment
 * dropdowns). Also drives the red "urgent" highlight on these form types in
 * ReportHRDaily.tsx's Automated Forms list.
 */
export const ROUTE_REQUIRED_DOCUMENT_TYPES: SignableDocumentType[] = [
  "substance_screening",
  "parts_responsibility",
  "damage",
  "location_consent",
  "mileage_fuel",
  "i9",
  "w4r",
  "car_iq_agreement",
  "meal_rest_break",
];

/**
 * Of the given technician profile ids, which are missing at least one of
 * ROUTE_REQUIRED_DOCUMENT_TYPES (no row with status "signed" or "confirmed"
 * for that type)? Company-wide via RLS, paginated the same way as
 * getSignableDocuments below since a technician can have several rows per
 * document type (resent/re-signed) once history accumulates.
 */
export async function getTechnicianIdsMissingRouteDocuments(technicianIds: string[]): Promise<Set<string>> {
  if (technicianIds.length === 0) return new Set();
  const completedByTech = new Map<string, Set<SignableDocumentType>>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("hr_signable_documents")
      .select("recipient_id, document_type")
      .in("recipient_id", technicianIds)
      .in("document_type", ROUTE_REQUIRED_DOCUMENT_TYPES)
      .in("status", ["signed", "confirmed"])
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as Array<{ recipient_id: string; document_type: SignableDocumentType }>) {
      const set = completedByTech.get(r.recipient_id) ?? new Set<SignableDocumentType>();
      set.add(r.document_type);
      completedByTech.set(r.recipient_id, set);
    }
    if (!data || data.length < PAGE_SIZE) break;
  }
  const missing = new Set<string>();
  for (const id of technicianIds) {
    const completed = completedByTech.get(id);
    const isComplete = !!completed && ROUTE_REQUIRED_DOCUMENT_TYPES.every((t) => completed.has(t));
    if (!isComplete) missing.add(id);
  }
  return missing;
}

/** Every warning-form document company-wide, most recent first — feeds the "Sent Warning Forms" tracking table in ReportHRDaily.tsx. */
export async function getSignableDocuments(documentType: SignableDocumentType = "warning_form"): Promise<SignableDocument[]> {
  const all: SignableDocument[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("hr_signable_documents")
      .select(SELECT)
      .eq("document_type", documentType)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    all.push(...(data ?? []).map(mapRow));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

/** Every signable document company-wide, ANY type, most recent first —
 *  unlike getSignableDocuments (one type at a time, for a specific tracking
 *  table) this is for feeds that need to see every document type at once,
 *  e.g. the Universal Activity Log's HR tab. */
export async function getAllSignableDocuments(): Promise<SignableDocument[]> {
  const all: SignableDocument[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("hr_signable_documents")
      .select(SELECT)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    all.push(...(data ?? []).map(mapRow));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

/** Every signable document for one recipient, ANY type, most recent first —
 *  the frozen-account "which forms do I still need to sign" popup
 *  (FrozenAccountModal.tsx, via technicianFormStatus.ts) and any other
 *  self-service view that only needs one person's own documents. */
export async function getSignableDocumentsForRecipient(recipientId: string): Promise<SignableDocument[]> {
  const all: SignableDocument[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("hr_signable_documents")
      .select(SELECT)
      .eq("recipient_id", recipientId)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    all.push(...(data ?? []).map(mapRow));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

export interface IncompleteTechForm {
  type: SignableDocumentType;
  label: string;
  /** true = sent and awaiting the technician's own signature; false = never sent yet. */
  pending: boolean;
  /** Set only when pending — the doc to link straight to. Nothing to link to yet when not sent. */
  docId: string | null;
}

/**
 * Which of TECHNICIAN_FORM_TYPES a technician still needs to act on
 * themselves — "not_sent" or "awaiting_employee" only; a form sitting in
 * "awaiting_hr" (they've already signed, HR's countersignature is what's
 * outstanding) is deliberately excluded since it isn't the technician's
 * job anymore. Shared by technicianFormStatus.ts (the frozen-account "what
 * do I still need to do" popup) and signDocument's own auto-unfreeze check
 * below — both need exactly the same "is this technician actually done"
 * answer, kept in one place instead of two.
 */
export async function getIncompleteTechnicianForms(profileId: string): Promise<IncompleteTechForm[]> {
  const [docs, exemptions] = await Promise.all([
    getSignableDocumentsForRecipient(profileId),
    getTechnicianFormExemptions(),
  ]);
  const latestByType = new Map<SignableDocumentType, SignableDocument>();
  for (const d of docs) {
    if (!latestByType.has(d.documentType)) latestByType.set(d.documentType, d);
  }
  const incomplete: IncompleteTechForm[] = [];
  for (const type of TECHNICIAN_FORM_TYPES) {
    const doc = latestByType.get(type);
    if (isTechnicianExemptFromForm(type, !!doc, exemptions.has(`${profileId}|${type}`))) continue;
    const reviewStatus = getDocumentReviewStatus(type, doc);
    if (reviewStatus === "done" || reviewStatus === "awaiting_hr") continue;
    incomplete.push({ type, label: SIGNABLE_DOCUMENT_REGISTRY[type]?.label ?? type, pending: reviewStatus === "awaiting_employee", docId: doc?.id ?? null });
  }
  return incomplete;
}

/**
 * If this profile is currently frozen and has just finished every
 * Technician-tab form that's actually theirs to complete, lifts the freeze
 * automatically — the whole point of freezing is to make sure these get
 * done, so there's no reason to keep them locked out once they have.
 * Called from signDocument below right after a technician-form signature;
 * swallows its own errors (logged, not thrown) so a hiccup in this side
 * effect can never fail the signature the caller actually cares about.
 */
async function maybeAutoUnfreezeTechnician(profileId: string): Promise<void> {
  try {
    const { data: prof, error } = await supabase.from("profiles").select("frozen").eq("id", profileId).maybeSingle();
    if (error || !prof?.frozen) return;
    const incomplete = await getIncompleteTechnicianForms(profileId);
    if (incomplete.length > 0) return;
    await setProfileFrozen(profileId, false, profileId, "Auto-unfrozen (all required forms completed)");
  } catch (err) {
    console.error("Auto-unfreeze check failed:", err);
  }
}

/**
 * Records the recipient's signature and marks the document signed — awaiting
 * HR's review/confirm, not yet an official warning. `formData`, if given,
 * overwrites the stored form_data too — needed for documents like W-8BEN
 * where the recipient fills in the actual fields themselves (HR only sends
 * a near-empty shell), unlike the Warning Form where HR pre-fills everything
 * and the recipient only signs.
 */
export async function signDocument(id: string, slot: SignatureSlot, entry: SignatureEntry, pdfUrl: string, formData?: Record<string, any>): Promise<void> {
  const doc = await getSignableDocument(id);
  if (!doc) throw new Error("Document not found.");
  const signatures = { ...doc.signatures, [slot]: entry };
  const update: Record<string, any> = { signatures, status: "signed", pdf_url: pdfUrl, signed_at: new Date().toISOString() };
  if (formData) update.form_data = formData;
  // .select("id") so a zero-row result (RLS silently filtered the row out
  // rather than raising an error) is actually detectable — without it, a
  // blocked write looks identical to a successful one to the caller.
  const { data, error } = await supabase.from("hr_signable_documents").update(update).eq("id", id).select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("Couldn't save the signature — you may not have permission to update this document.");

  if (slot === "employee" && doc.recipientId && TECHNICIAN_FORM_TYPES.includes(doc.documentType)) {
    await maybeAutoUnfreezeTechnician(doc.recipientId);
  }
}

/**
 * Swaps in a re-generated PDF for an already-signed document — used when HR
 * completes a section the recipient couldn't (e.g. the W-4's "Employers
 * Only" box) after the fact by regenerating the whole PDF fresh from the
 * stored form_data plus the newly-added fields, rather than patching the
 * previously-generated file. `formData`, if given, overwrites the stored
 * form_data too, so the added fields (and future regenerations) build on
 * the complete picture.
 */
export async function updateSignableDocumentPdfUrl(id: string, pdfUrl: string, formData?: Record<string, any>): Promise<void> {
  const update: Record<string, any> = { pdf_url: pdfUrl };
  if (formData) update.form_data = formData;
  const { error } = await supabase.from("hr_signable_documents").update(update).eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Reassigns a document to another recipient/slot for signature ("Send to
 * Next Recipient" / "Send to Another Recipient") — previously captured
 * signatures are untouched. `recipientName` is required (not just for the
 * recipient_name column, which only applies to an external/no-account
 * recipient) because the document's rendered preview/PDF pre-fills the
 * "Name:" line at the target slot from form_data.recipientName, not from
 * the row's own recipient columns — skipping this update would reassign
 * the document but leave the wrong (or blank) name showing until someone
 * actually signs it.
 */
export async function reassignSignableDocument(id: string, target: { recipientId?: string; recipientName: string }, recipientSlot: SignatureSlot): Promise<void> {
  const doc = await getSignableDocument(id);
  if (!doc) throw new Error("Document not found.");
  // Merged, not replaced — a slot's name from an earlier round (e.g. Manager,
  // before this reassign moved it to Senior Manager) must keep showing on
  // the document even though it's no longer the active recipientSlot.
  const recipientNames = { ...(doc.formData as { recipientNames?: Record<string, string> }).recipientNames, [recipientSlot]: target.recipientName };
  const formData = { ...doc.formData, recipientSlot, recipientName: target.recipientName, recipientNames };
  const { data, error } = await supabase
    .from("hr_signable_documents")
    .update({
      recipient_id: target.recipientId ?? null,
      recipient_name: target.recipientId ? null : target.recipientName,
      recipient_slot: recipientSlot,
      form_data: formData,
      status: "pending_signature",
    })
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("Couldn't reassign this document — you may not have permission to update it.");
}

/**
 * HR's final "Confirm Warning" — the moment the warning actually becomes
 * official (see addAgentNote in ReportHRDaily.tsx's handleConfirmWarningForm).
 * agentNoteId is null when the warning is about someone typed in manually
 * rather than picked from the employee list — there's no real profile to
 * attach a conduct note to, so the document itself still finalizes, it
 * just doesn't count toward any employee's official warning history.
 */
export async function confirmSignableDocument(id: string, agentNoteId: string | null): Promise<void> {
  const { data, error } = await supabase
    .from("hr_signable_documents")
    .update({ status: "confirmed", agent_note_id: agentNoteId, confirmed_at: new Date().toISOString() })
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("Couldn't confirm this document — you may not have permission to update it.");
}

/**
 * Undoes an already-confirmed document's employer step ONLY — reopens it
 * for a fresh employer/manager signature while leaving the employee's
 * original signature and formData completely untouched. Used when the
 * employer signature needs to be redone (bad signature capture, wrong
 * date, or any other mistake caught after confirming).
 *
 * Sets status back to "pending_signature" rather than "signed" — by the
 * time a document reaches "confirmed", recipientSlot is already
 * "hr_staff" (set when whoever signed as employer first claimed it via
 * reassignSignableDocument), so "pending_signature" + "hr_staff" is the
 * exact state isAwaitingEmployerStep already recognizes as awaiting an
 * employer signature — same state "Send to Employer" produces, not a new
 * one. The next "Add Employer Signature" claims and overwrites it as
 * normal, no different from a first attempt.
 */
export async function reopenEmployerSignature(id: string): Promise<void> {
  const { error } = await supabase
    .from("hr_signable_documents")
    .update({ status: "pending_signature", confirmed_at: null })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Aborts the document — used both for "Cancel Warning" (pre-confirm) and
 * "Revert Warning" (undoing an already-confirmed one). Either way, if a
 * warning note was logged against it, retracts (deletes) that note too, so
 * the employee's warning count drops back down immediately — the row
 * itself stays (marked cancelled) for an audit trail, just no longer
 * counts against the employee.
 */
export async function cancelSignableDocument(id: string): Promise<void> {
  const doc = await getSignableDocument(id);
  if (!doc) throw new Error("Document not found.");
  if (doc.agentNoteId) {
    await deleteAgentNote(doc.agentNoteId).catch((err) => console.error("Failed to retract warning note on cancel:", err));
  }
  const { error } = await supabase
    .from("hr_signable_documents")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), agent_note_id: null })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Permanently erases the document — for when the whole thing was raised in
 * error and shouldn't leave any trace, not even a "cancelled" row. Retracts
 * the linked warning note first (same as cancel), then hard-deletes the
 * row itself.
 */
export async function deleteSignableDocument(id: string): Promise<void> {
  const doc = await getSignableDocument(id);
  if (!doc) throw new Error("Document not found.");
  if (doc.agentNoteId) {
    await deleteAgentNote(doc.agentNoteId).catch((err) => console.error("Failed to retract warning note on delete:", err));
  }
  const { error } = await supabase.from("hr_signable_documents").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
