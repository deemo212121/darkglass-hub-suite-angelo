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
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Upload one photo for a ticket. Returns the stored photo info.
 */
export async function uploadTicketPhoto(
  companyId: string,
  ticketNo: string,
  file: File
): Promise<TicketPhoto> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/tickets/${ticketNo}`;
  const objectName = `${Date.now()}-${sanitizeFileName(file.name)}`;
  const objectRef = ref(storage, `${folder}/${objectName}`);

  const snapshot = await uploadBytes(objectRef, file, {
    contentType: file.type || "application/octet-stream",
    customMetadata: { uploadedAt: new Date().toISOString() },
  });
  const url = await getDownloadURL(snapshot.ref);
  return {
    name: objectName,
    fullPath: snapshot.ref.fullPath,
    url,
    uploadedAt: new Date().toISOString(),
    size: file.size,
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
