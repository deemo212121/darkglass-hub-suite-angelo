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
  uploadBytesResumable,
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
  size: number;       // bytes (compressed size, once compression is in place)
  /** Display name / email of whoever uploaded this file. */
  uploadedBy?: string;
  /** Visit number the photo is associated with (e.g. "1", "2"). Optional. */
  visitNo?: string;
  /** Pixel dimensions of the stored (compressed) image, if known. */
  width?: number;
  height?: number;
  /** Size in bytes before client-side compression, if known. */
  originalSize?: number;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Upload one photo for a ticket. Returns the stored photo info. Accepts
 * optional metadata so we can stamp who uploaded the file, which visit it
 * belongs to, and (once compression is in place) the compressed image's
 * real dimensions and pre-compression size.
 *
 * Takes a Blob rather than a File since the caller compresses the photo
 * client-side first (see src/lib/imageCompression.ts) — the compressed
 * output is a Blob with no `name`, hence the separate `fileName` param.
 *
 * `onProgress` (0-100) is wired to Firebase's resumable-upload progress
 * events so callers can show a real per-file upload percentage.
 */
export async function uploadTicketPhoto(
  companyId: string,
  ticketNo: string,
  blob: Blob,
  fileName: string,
  meta?: { uploadedBy?: string; visitNo?: string; width?: number; height?: number; originalSize?: number },
  onProgress?: (percent: number) => void,
): Promise<TicketPhoto> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/tickets/${ticketNo}`;
  const objectName = `${Date.now()}-${sanitizeFileName(fileName)}`;
  const objectRef = ref(storage, `${folder}/${objectName}`);

  const uploadedAt = new Date().toISOString();
  const customMetadata: Record<string, string> = { uploadedAt };
  if (meta?.uploadedBy) customMetadata.uploadedBy = meta.uploadedBy;
  if (meta?.visitNo) customMetadata.visitNo = meta.visitNo;
  if (meta?.width) customMetadata.width = String(meta.width);
  if (meta?.height) customMetadata.height = String(meta.height);
  if (meta?.originalSize) customMetadata.originalSize = String(meta.originalSize);

  const task = uploadBytesResumable(objectRef, blob, {
    contentType: blob.type || "application/octet-stream",
    customMetadata,
  });

  await new Promise<void>((resolve, reject) => {
    task.on(
      "state_changed",
      (snapshot) => {
        if (onProgress) onProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100));
      },
      reject,
      () => resolve(),
    );
  });

  const url = await getDownloadURL(task.snapshot.ref);
  return {
    name: objectName,
    fullPath: task.snapshot.ref.fullPath,
    url,
    uploadedAt,
    size: blob.size,
    uploadedBy: meta?.uploadedBy,
    visitNo: meta?.visitNo,
    width: meta?.width,
    height: meta?.height,
    originalSize: meta?.originalSize,
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
      const width = meta?.customMetadata?.width ? Number(meta.customMetadata.width) : undefined;
      const height = meta?.customMetadata?.height ? Number(meta.customMetadata.height) : undefined;
      const originalSize = meta?.customMetadata?.originalSize ? Number(meta.customMetadata.originalSize) : undefined;
      return {
        name: item.name,
        fullPath: item.fullPath,
        url,
        uploadedAt: meta?.customMetadata?.uploadedAt ?? meta?.timeCreated ?? "",
        size: meta?.size ?? 0,
        uploadedBy: meta?.customMetadata?.uploadedBy ?? undefined,
        visitNo: meta?.customMetadata?.visitNo ?? undefined,
        width,
        height,
        originalSize,
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
 * Upload one file/signature answer from an in-house custom form submission
 * (see CustomFormRenderer.tsx) — only used for the internal (logged-in)
 * fill path, which already has an authenticated Firebase session same as
 * every other upload in this file. Public (anonymous) submissions instead
 * go through api/custom-forms.ts, which has no client session to upload
 * with. Stored under companies/{companyId}/custom-forms/{formId}/{submissionId}/.
 */
export async function uploadCustomFormFile(
  companyId: string,
  formId: string,
  submissionId: string,
  file: File
): Promise<{ url: string; fullPath: string }> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/custom-forms/${formId}/${submissionId}`;
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
 * Uploads an image embedded directly in a form's design (the Image
 * element's "Upload" option, see src/lib/formElements/basicInputs.tsx) —
 * deliberately NOT keyed by a form id, since a brand-new unsaved form
 * doesn't have one yet. Stored under companies/{companyId}/custom-forms/_assets/.
 */
export async function uploadCustomFormAsset(companyId: string, file: File): Promise<{ url: string; fullPath: string }> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/custom-forms/_assets`;
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
 * Upload a receipt (image or PDF) for an expense record — Tracking Expenses
 * Dashboard. Stored under companies/{companyId}/expenses/{expenseId}/, same
 * convention as onboarding documents/custom form files above. `expenseId`
 * is the real row id when editing an existing expense; for a brand-new one
 * not saved yet, callers use a client-generated placeholder key instead
 * (see ExpenseTrackingPage.tsx) since there's no row id until after insert.
 */
export async function uploadExpenseReceipt(companyId: string, expenseId: string, file: File): Promise<{ url: string; fullPath: string }> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/expenses/${expenseId}`;
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
 * Upload a screenshot for an IT ticket (IT Support page). Stored under
 * companies/{companyId}/it-tickets/{ticketKey}/, same convention as
 * expense receipts above. `ticketKey` is a client-generated placeholder
 * (crypto.randomUUID()) since there's no row id until after the ticket is
 * inserted — the upload happens first, and the resulting URL is included
 * in that same insert (see createItTicket in itTickets.ts).
 */
export async function uploadItTicketScreenshot(companyId: string, ticketKey: string, blob: Blob, fileName: string): Promise<{ url: string; fullPath: string }> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/it-tickets/${ticketKey}`;
  const objectName = `${Date.now()}-${sanitizeFileName(fileName)}`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, blob, {
    contentType: blob.type || "application/octet-stream",
    customMetadata: { uploadedAt: new Date().toISOString() },
  });
  const url = await getDownloadURL(snapshot.ref);
  return { url, fullPath: snapshot.ref.fullPath };
}

/** Delete an expense receipt file by its full storage path — best-effort cleanup when a receipt is replaced or removed. */
export async function deleteExpenseReceiptFile(fullPath: string): Promise<void> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  await deleteObject(ref(storage, fullPath));
}

/**
 * Delete a Jotform-generated document (companies/{companyId}/jotform-documents/…)
 * by its full storage path — used when HR deletes a submission row (e.g. a
 * test/junk one) so the file doesn't linger orphaned in Storage.
 */
export async function deleteJotformDocumentFile(fullPath: string): Promise<void> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  await deleteObject(ref(storage, fullPath));
}

/**
 * Upload a generated Certificate of Employment PDF so it can be linked in a
 * Team Messenger message — same "generate client-side, upload, share a
 * link" pattern as the CV-forwarding feature on the Hiring tab.
 */
export async function uploadCoeCertificate(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/coe-certificates`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "certificate")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

/**
 * Upload a generated Employee Warning Form PDF so it can be linked in a
 * Team Messenger message — same pattern as uploadCoeCertificate above.
 */
export async function uploadWarningForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/warning-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "warning-form")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

export async function uploadW8benForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/w8ben-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "w8ben-form")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

export async function uploadW4Form(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/w4-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "w4-form")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

export async function uploadW9Form(companyId: string, name: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/w9-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(name || "w9-form")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

/**
 * Upload a drawn signature (PNG data URL from a canvas — same capture
 * pattern as the ticket customer-signature pad in MobileTechApp.tsx) for a
 * signable HR document.
 */
export async function uploadSignableDocumentSignature(companyId: string, docId: string, slot: string, dataUrl: string): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const folder = `companies/${companyId}/signable-documents/${docId}`;
  const objectRef = ref(storage, `${folder}/${slot}-${Date.now()}.png`);
  const snapshot = await uploadBytes(objectRef, blob, { contentType: "image/png" });
  return getDownloadURL(snapshot.ref);
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
