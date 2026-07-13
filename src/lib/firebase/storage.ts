/**
 * Firebase Storage helpers for ticket photos.
 *
 * Files are stored under: companies/{companyId}/tickets/{ticketNo}/{timestamp}-{filename}
 * so they are naturally namespaced per company + ticket. We list/delete by that
 * path prefix, so no separate metadata table is required.
 */

import {
  ref,
  uploadBytes,
  getDownloadURL,
  listAll,
  deleteObject,
  getMetadata,
} from "firebase/storage";
import { storage, isFirebaseReady } from "./config";

export interface TicketPhoto {
  name: string;       // storage object name (unique)
  fullPath: string;   // full storage path (used for delete)
  url: string;        // download URL
  uploadedAt: string; // ISO timestamp from metadata
  size: number;       // bytes
  /** Display name / email of whoever uploaded this file. */
  uploadedBy?: string;
  /** Visit number the photo is associated with (e.g. "1", "2"). Optional. */
  visitNo?: string;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Upload one photo for a ticket. Returns the stored photo info. Accepts
 * optional metadata so we can stamp who uploaded the file and which visit
 * it belongs to.
 */
export async function uploadTicketPhoto(
  companyId: string,
  ticketNo: string,
  file: File,
  meta?: { uploadedBy?: string; visitNo?: string }
): Promise<TicketPhoto> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/tickets/${ticketNo}`;
  const objectName = `${Date.now()}-${sanitizeFileName(file.name)}`;
  const objectRef = ref(storage, `${folder}/${objectName}`);

  const uploadedAt = new Date().toISOString();
  const customMetadata: Record<string, string> = { uploadedAt };
  if (meta?.uploadedBy) customMetadata.uploadedBy = meta.uploadedBy;
  if (meta?.visitNo) customMetadata.visitNo = meta.visitNo;

  const snapshot = await uploadBytes(objectRef, file, {
    contentType: file.type || "application/octet-stream",
    customMetadata,
  });
  const url = await getDownloadURL(snapshot.ref);
  return {
    name: objectName,
    fullPath: snapshot.ref.fullPath,
    url,
    uploadedAt,
    size: file.size,
    uploadedBy: meta?.uploadedBy,
    visitNo: meta?.visitNo,
  };
}

/**
 * List all photos stored for a ticket (company-scoped by path).
 */
export async function listTicketPhotos(
  companyId: string,
  ticketNo: string
): Promise<TicketPhoto[]> {
  if (!isFirebaseReady() || !storage) {
    return [];
  }
  const folder = `companies/${companyId}/tickets/${ticketNo}`;
  const folderRef = ref(storage, folder);
  const res = await listAll(folderRef);

  const photos = await Promise.all(
    res.items.map(async (item) => {
      const [url, meta] = await Promise.all([
        getDownloadURL(item),
        getMetadata(item).catch(() => null),
      ]);
      return {
        name: item.name,
        fullPath: item.fullPath,
        url,
        uploadedAt: meta?.customMetadata?.uploadedAt ?? meta?.timeCreated ?? "",
        size: meta?.size ?? 0,
        uploadedBy: meta?.customMetadata?.uploadedBy ?? undefined,
        visitNo: meta?.customMetadata?.visitNo ?? undefined,
      } as TicketPhoto;
    })
  );
  // Newest first.
  return photos.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

/**
 * Delete a photo by its full storage path.
 */
export async function deleteTicketPhoto(fullPath: string): Promise<void> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  await deleteObject(ref(storage, fullPath));
}


/**
 * Upload one onboarding document file for an applicant/employee. Stored
 * under companies/{companyId}/onboarding-documents/{profileId}/{category}/,
 * so files are naturally namespaced per company + applicant + category —
 * same convention as ticket photos above. The Supabase `onboarding_documents`
 * table tracks which category/applicant a given upload belongs to; this
 * function only puts the bytes in Storage and returns the download URL +
 * full path for that table row.
 */
export async function uploadOnboardingDocument(
  companyId: string,
  profileId: string,
  category: string,
  file: File
): Promise<{ url: string; fullPath: string }> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/onboarding-documents/${profileId}/${category}`;
  const objectName = `${Date.now()}-${sanitizeFileName(file.name)}`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, file, {
    contentType: file.type || "application/octet-stream",
    customMetadata: { uploadedAt: new Date().toISOString() },
  });
  const url = await getDownloadURL(snapshot.ref);
  return { url, fullPath: snapshot.ref.fullPath };
}

/**
 * Delete an onboarding document file by its full storage path.
 */
export async function deleteOnboardingDocumentFile(fullPath: string): Promise<void> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  await deleteObject(ref(storage, fullPath));
}

/**
 * Upload a customer signature PNG (from a canvas data URL) for a ticket.
 * Stored under companies/{companyId}/tickets/{ticketNo}/signatures/.
 * Returns the public download URL (store this in the billing record).
 */
export async function uploadTicketSignature(
  companyId: string,
  ticketNo: string,
  dataUrl: string
): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  // Convert the data URL to a Blob.
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const folder = `companies/${companyId}/tickets/${ticketNo}/signatures`;
  const objectName = `${Date.now()}-signature.png`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, blob, {
    contentType: "image/png",
    customMetadata: { uploadedAt: new Date().toISOString() },
  });
  return getDownloadURL(snapshot.ref);
}
