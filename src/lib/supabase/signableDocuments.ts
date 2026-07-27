import { supabase } from "./client";
import { deleteAgentNote } from "./csrAgentNotes";

export type SignableDocumentType = "warning_form" | "w8ben" | "w4" | "w9";
export type SignatureSlot = "employee" | "manager" | "senior_manager" | "hr_staff";
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

/** Every warning-form document company-wide, most recent first — feeds the "Sent Warning Forms" tracking table in ReportHRDaily.tsx. */
export async function getSignableDocuments(documentType: SignableDocumentType = "warning_form"): Promise<SignableDocument[]> {
  const { data, error } = await supabase
    .from("hr_signable_documents")
    .select(SELECT)
    .eq("document_type", documentType)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRow);
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
  const { error } = await supabase.from("hr_signable_documents").update(update).eq("id", id);
  if (error) throw new Error(error.message);
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
  const { error } = await supabase
    .from("hr_signable_documents")
    .update({
      recipient_id: target.recipientId ?? null,
      recipient_name: target.recipientId ? null : target.recipientName,
      recipient_slot: recipientSlot,
      form_data: formData,
      status: "pending_signature",
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
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
  const { error } = await supabase
    .from("hr_signable_documents")
    .update({ status: "confirmed", agent_note_id: agentNoteId, confirmed_at: new Date().toISOString() })
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
