/**
 * Driver's license and Social Security card photos collected on the Master
 * W-2 Technician Agreement (FillMasterW2AgreementPage.tsx) — same private-
 * bucket-plus-path-column pattern as uploadPtoAttachment (pto.ts). No typed
 * SSN field exists anywhere in the app; the photo is the only record of it,
 * so there's never a plaintext SSN in a database column.
 */
import { supabase } from "./client";

export type TechnicianIdDocumentKind = "license" | "ssn_card";

/** Returns the storage path to save on the signable document's formData — not a URL, since the bucket is private (see getTechnicianIdDocumentUrl). */
export async function uploadTechnicianIdDocument(
  companyId: string,
  docId: string,
  kind: TechnicianIdDocumentKind,
  file: File
): Promise<string> {
  const path = `${companyId}/${docId}/${kind}-${Date.now()}_${file.name}`;
  const { error } = await supabase.storage.from("technician-id-documents").upload(path, file, { upsert: true });
  if (error) throw new Error(error.message);
  return path;
}

/** Bucket is private — generate a short-lived signed URL on demand rather than caching one. */
export async function getTechnicianIdDocumentUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from("technician-id-documents").createSignedUrl(path, 3600);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}
