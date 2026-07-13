import { supabase } from "./client";
import { deleteAgentNote } from "./csrAgentNotes";

export type SignableDocumentType = "warning_form";
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
  recipientId: string;
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
  "id, company_id, document_type, form_data, signatures, status, recipient_id, recipient_slot, pdf_url, agent_note_id, created_by, created_at, signed_at, confirmed_at, cancelled_at, creator:created_by (display_name, username)";

function mapRow(r: any): SignableDocument {
  return {
    id: r.id,
    companyId: r.company_id,
    documentType: r.document_type,
    formData: r.form_data,
    signatures: r.signatures ?? {},
    status: r.status,
    recipientId: r.recipient_id,
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

export async function createSignableDocument(input: {
  documentType: SignableDocumentType;
  formData: Record<string, any>;
  recipientId: string;
  recipientSlot: SignatureSlot;
  pdfUrl: string;
}): Promise<SignableDocument> {
  const { data, error } = await supabase
    .from("hr_signable_documents")
    .insert({
      document_type: input.documentType,
      form_data: input.formData,
      recipient_id: input.recipientId,
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

/** Records the recipient's signature and marks the document signed — awaiting HR's review/confirm, not yet an official warning. */
export async function signDocument(id: string, slot: SignatureSlot, entry: SignatureEntry, pdfUrl: string): Promise<void> {
  const doc = await getSignableDocument(id);
  if (!doc) throw new Error("Document not found.");
  const signatures = { ...doc.signatures, [slot]: entry };
  const { error } = await supabase
    .from("hr_signable_documents")
    .update({ signatures, status: "signed", pdf_url: pdfUrl, signed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Reassigns a signed-back document to another recipient/slot for further signature ("Send to Next Recipient") — previously captured signatures are untouched. */
export async function reassignSignableDocument(id: string, recipientId: string, recipientSlot: SignatureSlot): Promise<void> {
  const { error } = await supabase
    .from("hr_signable_documents")
    .update({ recipient_id: recipientId, recipient_slot: recipientSlot, status: "pending_signature" })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** HR's final "Confirm Warning" — the moment the warning actually becomes official (see addAgentNote in ReportHRDaily.tsx's handleConfirmWarningForm). */
export async function confirmSignableDocument(id: string, agentNoteId: string): Promise<void> {
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
