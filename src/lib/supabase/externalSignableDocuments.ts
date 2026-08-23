/**
 * Client-side wrapper around /api/signable-documents (see
 * src/lib/server/signableDocumentsBridge.ts) — the no-login counterpart to
 * signableDocuments.ts's getSignableDocument/signDocument, used by every
 * External Fill*Page.tsx (W-8BEN/W-4/W-9/W-4R/I-9 Section 1). Only ever
 * serves/accepts a document with recipient_id IS NULL (see the bridge's own
 * header comment) — a document sent through the normal (real-teammate) flow
 * can never be opened here.
 *
 * Unlike the logged-in flow, the PDF is built entirely client-side (the
 * pure fillXPdf functions only need pdf-lib + the blank template asset, no
 * auth) and POSTed already-finished — the server just uploads it and
 * patches the row with a service-role key, since an anonymous visitor has
 * no Supabase session for RLS to scope to. The server also handles
 * notifying the document's creator/HR afterward, so callers don't need
 * their own DM/notification step (there's no profile to send a DM from
 * anyway).
 */
import type { SignableDocumentType } from "./signableDocuments";

export interface ExternalSignableDocument {
  id: string;
  documentType: SignableDocumentType;
  formData: Record<string, any>;
  signatures: Record<string, { name: string; url: string; signedAt: string }>;
  status: string;
  recipientSlot: string;
  recipientName: string | null;
}

/** Null if the id doesn't exist, isn't externally-signable, or the request otherwise fails — callers show a generic "link isn't valid" message either way. */
export async function getExternalSignableDocument(id: string): Promise<ExternalSignableDocument | null> {
  const res = await fetch(`/api/signable-documents?id=${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  return (await res.json()) as ExternalSignableDocument;
}

/**
 * Uploads the signature PNG + the already-built PDF, and persists formData
 * (the recipient's filled-in answers) — all via the server bridge's
 * service-role key. `attachments`, if given, is a field-name → File[] map
 * (e.g. `{ ssnCardUrls: [frontFile, backFile] }`) appended as repeated
 * `attachment_{fieldName}` entries — the bridge uploads each and merges the
 * resulting URLs back into that same field name in form_data (see
 * signableDocumentsBridge.ts's header comment). Throws with the server's
 * own error message on failure.
 */
export async function submitExternalSignature(
  id: string,
  input: { signatureBlob: Blob; pdfBlob: Blob; formData: Record<string, any>; attachments?: Record<string, File[]> }
): Promise<{ pdfUrl: string }> {
  const body = new FormData();
  body.set("signatureFile", input.signatureBlob, "signature.png");
  body.set("pdfFile", input.pdfBlob, "signed.pdf");
  body.set("formData", JSON.stringify(input.formData));
  for (const [fieldName, files] of Object.entries(input.attachments ?? {})) {
    for (const file of files) body.append(`attachment_${fieldName}`, file, file.name);
  }
  const res = await fetch(`/api/signable-documents?id=${encodeURIComponent(id)}&action=sign`, { method: "POST", body });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || "Failed to submit signature.");
  }
  return (await res.json()) as { pdfUrl: string };
}
