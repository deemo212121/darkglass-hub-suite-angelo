/**
 * Firebase Storage helpers for ticket photos.
 *
 * Files are stored under: companies/{companyId}/tickets/{ticketNo}/{timestamp}-{filename}
 * so they are naturally namespaced per company + ticket. We list/delete by that
 * path prefix, so no separate metadata table is required.
 */

import {
  ref,
  uploadBytes as sdkUploadBytes,
  uploadBytesResumable as sdkUploadBytesResumable,
  getDownloadURL as sdkGetDownloadURL,
  listAll,
  deleteObject,
  getMetadata,
  updateMetadata,
  type StorageReference,
  type UploadMetadata,
} from "firebase/storage";
import { storage, auth, isFirebaseReady } from "./config";
import { describeStoragePath, logAppError } from "@/lib/appErrorLog";

// A failed upload is saved to the app error log (migration 0387) for AHS
// Server Status — what the person was uploading, the error, their device —
// then rethrown unchanged so each caller's own error handling still runs.
function logUploadFailure(objectRef: StorageReference, err: unknown) {
  if (objectRef.fullPath.includes("/status-checks/")) return; // Server Status's own test
  const { area, action } = describeStoragePath(objectRef.fullPath);
  logAppError(area, action, err);
}

/*
 * Same-origin upload fallback. Some networks / browsers can't reach
 * firebasestorage.googleapis.com at all (an office web filter, a carrier, a
 * privacy extension): the SDK retries until it gives up with
 * storage/retry-limit-exceeded — signing pages failed with "Couldn't reach the
 * file storage service" and mobile ticket photos sat on "Waiting to sync"
 * forever, while everyone else's uploads went through. When that happens the
 * same bytes go to /api/storage-upload on the app's own domain instead
 * (src/lib/server/storageUploadBridge.ts), which writes the same object path
 * with the service account and returns the same kind of download URL. After
 * one fallback succeeds, the rest of the session goes straight there.
 *
 * Every upload in this file goes through uploadWithFallback (via the
 * uploadBytes / getDownloadURL wrappers below — same names and call shape as
 * the SDK's — or uploadTicketPhoto), so all of them get the fallback and the
 * error log. The switch to the app server is logged too, so Server Status
 * shows whose device can't reach Storage even though their upload worked.
 */
let preferServerUpload = false;
const serverUploadUrls = new WeakMap<StorageReference, string>();

function isStorageUnreachable(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "storage/retry-limit-exceeded";
}

function isStorageRefusal(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "storage/unauthorized" || code === "storage/unauthenticated";
}

/**
 * A direct upload refused with storage/unauthorized — two causes seen on
 * technicians' phones, both handled here before it's reported as a failure:
 *  1. The file is already stored: the upload finished but the phone never
 *     heard back, and sending it again was refused (Zac Coisman,
 *     HIS20261037917556, 2026-10-21 — four photos saved at 9:05, the resend
 *     at 9:56 refused, so he picked them again and they were saved twice).
 *     Same name and same size already there → it's done.
 *  2. The sign-in token went stale (Matt Simmons, SA-5279519, 2026-10-19) →
 *     refresh it and try once more.
 * True when the file ends up stored.
 */
async function recoverFromRefusal(objectRef: StorageReference, data: Blob | Uint8Array | ArrayBuffer, direct: () => Promise<void>): Promise<boolean> {
  const size = data instanceof Blob ? data.size : data.byteLength;
  try {
    const existing = await getMetadata(objectRef);
    if (existing.size === size) return true;
  } catch {
    // not stored yet, or can't be read either — try a fresh token below
  }
  try {
    await Promise.race([auth?.currentUser?.getIdToken(true), new Promise((resolve) => setTimeout(resolve, 10_000))]);
    await direct();
    return true;
  } catch {
    return false;
  }
}

async function uploadViaServer(objectRef: StorageReference, data: Blob | Uint8Array | ArrayBuffer, metadata?: UploadMetadata): Promise<string> {
  const user = auth?.currentUser;
  if (!user) throw Object.assign(new Error("Not signed in"), { code: "storage/unauthenticated" });
  const token = await user.getIdToken();
  const body = data instanceof Blob ? data : new Blob([data as BlobPart]);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": metadata?.contentType || body.type || "application/octet-stream",
  };
  if (metadata?.customMetadata && Object.keys(metadata.customMetadata).length) {
    headers["X-Custom-Metadata"] = encodeURIComponent(JSON.stringify(metadata.customMetadata));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    let res: Response;
    try {
      res = await fetch(`/api/storage-upload?path=${encodeURIComponent(objectRef.fullPath)}`, { method: "POST", headers, body, signal: controller.signal });
    } catch {
      // The app's own server is unreachable too — genuinely offline.
      throw Object.assign(new Error("Couldn't reach the file storage service or the app server."), { code: "storage/retry-limit-exceeded" });
    }
    const out = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !out.url) {
      throw Object.assign(new Error(out.error || `Upload failed (HTTP ${res.status})`), { code: res.status === 401 ? "storage/unauthenticated" : undefined });
    }
    return out.url;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs `direct` (the SDK upload); if Storage can't be reached, sends the file
 * through the app server instead. Returns the server's download URL when the
 * fallback was used, null when the direct upload worked. Failures (and the
 * first switch to the app server) go to the app error log.
 */
async function uploadWithFallback(objectRef: StorageReference, data: Blob | Uint8Array | ArrayBuffer, metadata: UploadMetadata | undefined, direct: () => Promise<void>): Promise<string | null> {
  let switching = false;
  if (!preferServerUpload) {
    try {
      await direct();
      return null;
    } catch (err) {
      if (isStorageRefusal(err) && (await recoverFromRefusal(objectRef, data, direct))) return null;
      if (!isStorageUnreachable(err)) {
        logUploadFailure(objectRef, err);
        throw err;
      }
      console.warn("Firebase Storage unreachable — uploading through the app server instead:", err);
      switching = true;
    }
  }
  try {
    const url = await uploadViaServer(objectRef, data, metadata);
    if (switching) {
      preferServerUpload = true;
      logUploadFailure(objectRef, new Error("Couldn't reach Firebase Storage from this device (storage/retry-limit-exceeded) — saved through the app server instead; the rest of this session uploads that way."));
    }
    return url;
  } catch (err) {
    logUploadFailure(objectRef, err);
    throw err;
  }
}

/** The SDK's uploadBytes, with the app-server fallback and the error log. */
async function uploadBytes(objectRef: StorageReference, data: Blob | Uint8Array | ArrayBuffer, metadata?: UploadMetadata): Promise<{ ref: StorageReference }> {
  const url = await uploadWithFallback(objectRef, data, metadata, async () => {
    await sdkUploadBytes(objectRef, data, metadata);
  });
  if (url) serverUploadUrls.set(objectRef, url);
  return { ref: objectRef };
}

/** The SDK's getDownloadURL — for a file that went through the fallback, the URL the server already returned (asking Storage for it would hit the same unreachable host). */
function getDownloadURL(objectRef: StorageReference): Promise<string> {
  const url = serverUploadUrls.get(objectRef);
  return url ? Promise.resolve(url) : sdkGetDownloadURL(objectRef);
}

/**
 * Force-refreshes the signed-in user's Firebase ID token before a batch of
 * Storage uploads. Some of the HR "Fill*Page" forms (Employee Data,
 * Employee Confidentiality, etc.) do several uploads in a row — SSN card,
 * driver's license front+back, a signature, then the final generated PDF —
 * and on a slow mobile connection that whole sequence can take long enough
 * for the token backing the LAST upload to have gone stale, even though
 * the user is still genuinely signed in. storage.rules requires
 * request.auth != null for every write, so a stale token surfaces as
 * "storage/unauthorized" on whichever upload happens to run last, not as
 * an auth error the user would recognize. Best-effort: swallow failures
 * (offline, etc.) rather than blocking the upload that follows — a failed
 * refresh just leaves whatever token was already there.
 */
export async function refreshStorageAuthToken(): Promise<void> {
  try {
    // Capped at 10s — a refresh that never answers mustn't hold up the upload after it.
    await Promise.race([auth?.currentUser?.getIdToken(true), new Promise((resolve) => setTimeout(resolve, 10_000))]);
  } catch {
    // best-effort — see doc comment above
  }
}

/**
 * A Storage upload error in words the signer can act on (the raw Firebase
 * messages are cryptic), with its code kept for anyone diagnosing it.
 */
export function describeStorageError(err: unknown): string {
  const code = (err as { code?: string } | null)?.code ?? "";
  if (code === "storage/retry-limit-exceeded")
    return "Couldn't reach the file storage service — the connection timed out. Check the internet connection (or try another network or browser) and submit again. (storage/retry-limit-exceeded)";
  if (code === "storage/unauthorized" || code === "storage/unauthenticated")
    return `Your login session has expired — refresh the page (or sign in again) and submit again. (${code})`;
  if (code === "storage/canceled") return "The upload was cancelled — submit again. (storage/canceled)";
  if (code === "storage/quota-exceeded") return "File storage is full — tell an admin. (storage/quota-exceeded)";
  const message = err instanceof Error ? err.message : String(err ?? "Unknown error");
  return code ? `${message} (${code})` : message;
}

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
  /** What the photo shows — a key from lib/photoTypes.ts (e.g. "model_serial"); empty on photos uploaded before types existed. */
  photoType?: string;
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
  meta?: { uploadedBy?: string; visitNo?: string; width?: number; height?: number; originalSize?: number; photoType?: string },
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
  if (meta?.photoType) customMetadata.photoType = meta.photoType;

  const metadata: UploadMetadata = { contentType: blob.type || "application/octet-stream", customMetadata };
  let directUrl = "";
  const serverUrl = await uploadWithFallback(objectRef, blob, metadata, async () => {
    const task = sdkUploadBytesResumable(objectRef, blob, metadata);
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
    directUrl = await sdkGetDownloadURL(task.snapshot.ref);
  });
  if (serverUrl) onProgress?.(100);
  // directUrl is empty when the photo turned out to be stored already (recoverFromRefusal) — ask for its link.
  const url = serverUrl ?? (directUrl || (await sdkGetDownloadURL(objectRef)));

  return {
    name: objectName,
    fullPath: objectRef.fullPath,
    url,
    uploadedAt,
    size: blob.size,
    uploadedBy: meta?.uploadedBy,
    visitNo: meta?.visitNo,
    width: meta?.width,
    height: meta?.height,
    originalSize: meta?.originalSize,
    photoType: meta?.photoType,
  };
}

/** Set (or change) what an already-uploaded ticket photo shows — keeps every other detail on it. */
export async function setTicketPhotoType(fullPath: string, photoType: string): Promise<void> {
  if (!isFirebaseReady() || !storage) throw new Error("Firebase Storage not configured");
  const objectRef = ref(storage, fullPath);
  const current = await getMetadata(objectRef);
  await updateMetadata(objectRef, { customMetadata: { ...(current.customMetadata ?? {}), photoType } });
}

/**
 * Cheap existence check for a ticket's photos — just lists the folder and
 * checks item count, skipping the per-file getDownloadURL/getMetadata
 * calls listTicketPhotos does for every photo. Meant for checking MANY
 * tickets at once (e.g. Accounting Dashboard's Mileage tab auto-hold
 * rule below), where fetching full photo details for tickets nobody's
 * actually viewing yet would be wasteful.
 */
export async function hasTicketPhotos(companyId: string, ticketNo: string): Promise<boolean> {
  if (!isFirebaseReady() || !storage) return false;
  const folder = `companies/${companyId}/tickets/${ticketNo}`;
  try {
    const res = await listAll(ref(storage, folder));
    return res.items.length > 0;
  } catch {
    return false;
  }
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
        photoType: meta?.customMetadata?.photoType ?? undefined,
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
 * Upload a supporting document for a Payroll Dispute (employee_requests,
 * request_type "payroll_dispute" — migration 0182/0183). Stored under
 * companies/{companyId}/payroll-disputes/{disputeKey}/, same
 * client-generated-key-before-insert convention as uploadItTicketScreenshot
 * below — the resulting URL(s) go into that same createEmployeeRequest call.
 */
export async function uploadPayrollDisputeAttachment(companyId: string, disputeKey: string, file: File): Promise<{ url: string; fullPath: string }> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/payroll-disputes/${disputeKey}`;
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
 * Upload proof (photo/PDF) for a Ticket Time Dispute (employee_requests,
 * request_type "ticket_time_dispute" — migration 0207). Same
 * client-generated-key-before-insert convention as
 * uploadPayrollDisputeAttachment above — the resulting URL goes into that
 * same createEmployeeRequest call's `attachments` array.
 */
export async function uploadTicketTimeDisputeAttachment(companyId: string, disputeKey: string, file: File): Promise<{ url: string; fullPath: string }> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/ticket-time-disputes/${disputeKey}`;
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
 * Upload a photo/file backing up a PTO/time-off request (Time Off
 * Calendar's own "Attach photo" field on Add/Edit time off) — a doctor's
 * note, etc. Stored under companies/{companyId}/pto-attachments/{requestId}/,
 * same convention as uploadPayrollDisputeAttachment above. Returns the
 * download URL directly (same as every other upload in this file) — no
 * separate "sign the URL" step needed the way a private Supabase bucket
 * requires, which is what this replaces (see pto.ts's uploadPtoAttachment).
 */
export async function uploadPtoRequestAttachment(companyId: string, requestId: string, file: File): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/pto-attachments/${requestId}`;
  const objectName = `${Date.now()}-${sanitizeFileName(file.name)}`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, file, { contentType: file.type || "application/octet-stream" });
  return getDownloadURL(snapshot.ref);
}

/**
 * Upload a photo/file backing up an HR Status set on Absent List (e.g. a
 * doctor's note) — no formal PTO request exists yet for these, so this is
 * keyed by (profileId, noteDate) instead of a request id. Stored under
 * companies/{companyId}/attendance-note-attachments/{profileId}/{noteDate}/.
 * Returns the download URL directly, same as uploadPtoRequestAttachment
 * above — see that function's comment for why.
 */
export async function uploadAttendanceNoteAttachmentFile(companyId: string, profileId: string, noteDate: string, file: File): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/attendance-note-attachments/${profileId}/${noteDate}`;
  const objectName = `${Date.now()}-${sanitizeFileName(file.name)}`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, file, { contentType: file.type || "application/octet-stream" });
  return getDownloadURL(snapshot.ref);
}

/** Flash Tech trip tracker's Receipts attachment — same single-file-per-row upload shape as uploadAttendanceNoteAttachmentFile above. */
export async function uploadFlashTechTripReceiptFile(companyId: string, tripId: string, file: File): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/flash-tech-trip-receipts/${tripId}`;
  const objectName = `${Date.now()}-${sanitizeFileName(file.name)}`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, file, { contentType: file.type || "application/octet-stream" });
  return getDownloadURL(snapshot.ref);
}

/**
 * Delete a PTO/attendance-note attachment given its download URL — used by
 * the "Remove" action next to View on both the Time Off Calendar and Absent
 * List. Unlike deleteTicketPhoto/deleteOnboardingDocumentFile above, this
 * takes the download URL directly rather than a bare storage path: the two
 * upload functions above only return the URL (no fullPath), and ref()
 * accepts a full https://firebasestorage.googleapis.com/... download URL
 * just as well as a bare path.
 */
export async function deleteAttachmentByUrl(url: string): Promise<void> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  await deleteObject(ref(storage, url));
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

/**
 * Upload a generated Employee Promotion / Role Change Form PDF — same
 * pattern as uploadWarningForm above.
 */
/** Upload a generated Promotion Paper and Wage Increase PDF — same shape as uploadPromotionForm. */
export async function uploadCompensationUpdate(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/compensation-updates`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "compensation-update")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

export async function uploadPromotionForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/promotion-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "promotion-form")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

/**
 * Upload a generated Employee Attendance & Visit Exception Report PDF —
 * same pattern as uploadWarningForm above.
 */
/**
 * Uploads the "Employee Attendance & Visit Exception Report" PDF generated
 * from a Time Correction Request's own exception-type/reason/signature
 * fields (see timecardCorrectionPdf.ts) — folded directly into the existing
 * correction flow rather than a separate document type, so this still
 * covers every stamp of that PDF (employee submit, manager sign, HR sign).
 */
export async function uploadExceptionVisitReport(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/exception-visit-reports`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "exception-visit-report")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

/** Upload a drawn/typed signature (PNG data URL) for a Time Correction Request's Exception Report — same capture pattern as uploadSignableDocumentSignature. */
export async function uploadTimecardCorrectionSignature(companyId: string, correctionId: string, slot: "employee" | "manager" | "hr_staff" | "accounting", dataUrl: string): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const folder = `companies/${companyId}/timecard-corrections/${correctionId}`;
  const objectRef = ref(storage, `${folder}/${slot}-${Date.now()}.png`);
  const snapshot = await uploadBytes(objectRef, blob, { contentType: "image/png" });
  return getDownloadURL(snapshot.ref);
}

/** Same as uploadTimecardCorrectionSignature, for a Ticket Time Dispute's Exception Report (employee_requests row) instead of a timecard_corrections row. */
export async function uploadEmployeeRequestSignature(companyId: string, requestId: string, slot: "employee" | "manager" | "hr_staff" | "accounting", dataUrl: string): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const folder = `companies/${companyId}/employee-requests/${requestId}`;
  const objectRef = ref(storage, `${folder}/${slot}-${Date.now()}.png`);
  const snapshot = await uploadBytes(objectRef, blob, { contentType: "image/png" });
  return getDownloadURL(snapshot.ref);
}

/** Same as uploadTimecardCorrectionSignature, for a Sick Leave / Unpaid Leave request's Exception Report (pto_requests row) instead of a timecard_corrections row. */
export async function uploadPtoRequestSignature(companyId: string, requestId: string, slot: "employee" | "manager" | "hr_staff" | "accounting", dataUrl: string): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const folder = `companies/${companyId}/pto-requests/${requestId}`;
  const objectRef = ref(storage, `${folder}/${slot}-${Date.now()}.png`);
  const snapshot = await uploadBytes(objectRef, blob, { contentType: "image/png" });
  return getDownloadURL(snapshot.ref);
}

/**
 * Upload a generated 4th Warning — Manager's Action Plan Form PDF — same
 * pattern as uploadWarningForm above.
 */
export async function uploadActionPlanForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/action-plan-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "action-plan-form")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

/**
 * Upload a generated Notice of Termination PDF — same pattern as
 * uploadWarningForm above.
 */
export async function uploadTerminationForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/termination-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "termination-form")}.pdf`;
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

export async function uploadW4RForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/w4r-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "w4r-form")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

export async function uploadWageAckForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/wage-ack-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "wage-ack-form")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

export async function uploadCarIqAgreementForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/car-iq-agreement-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "car-iq-agreement")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

export async function uploadEmployeeConfidentialityForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/employee-confidentiality-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "employee-confidentiality")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

export async function uploadNdaForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/nda-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "nda-form")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

export async function uploadSubstanceScreeningForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/substance-screening-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "substance-screening")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

export async function uploadMealRestBreakForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/meal-rest-break-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "meal-rest-break")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

export async function uploadPtoAckForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/pto-ack-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "pto-ack")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

export async function uploadPartsResponsibilityForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/parts-responsibility-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "parts-responsibility")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

export async function uploadMasterW2AgreementForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/master-w2-agreement-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "master-w2-agreement")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

export async function uploadMasterW2OfficeAgreementForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/master-w2-office-agreement-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "master-w2-office-agreement")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

export async function uploadMasterW2ExecutiveAgreementForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/master-w2-executive-agreement-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "master-w2-executive-agreement")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

export async function uploadConfidentialityNonCompeteAgreementForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/confidentiality-noncompete-agreement-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "confidentiality-noncompete-agreement")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

export async function uploadMasterPhContractorAgreementForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/master-ph-contractor-agreement-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "master-ph-contractor-agreement")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

export async function uploadMileageFuelForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/mileage-fuel-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "mileage-fuel")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

export async function uploadFlashTechnicianTravelForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/flash-technician-travel-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "flash-technician-travel")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

export async function uploadLocationConsentForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/location-consent-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "location-consent")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

export async function uploadContractorAddendumForm(companyId: string, name: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/contractor-addendum-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(name || "contractor-addendum")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

export async function uploadDamageForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/damage-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "damage")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

export async function uploadVisitExceptionReportForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/visit-exception-reports`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "visit-exception-report")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

export async function uploadContractorDataForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/contractor-data-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "contractor-data")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

export async function uploadSsnCardForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/ssn-card-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "ssn-card")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

export async function uploadDriversLicenseForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/drivers-license-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "drivers-license")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

export async function uploadValidIdForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/valid-id-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "valid-id")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

export async function uploadVehicleUseAgreementForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/vehicle-use-agreement-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "vehicle-use-agreement")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

export async function uploadDirectDepositForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/direct-deposit-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "direct-deposit")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

export async function uploadVehicleAgreementForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/vehicle-agreement-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "vehicle-agreement")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

export async function uploadI9Form(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/i9-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "i9-form")}.pdf`;
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
 * Uploads one supporting-document photo (e.g. a Social Security Card or
 * Driver's License front/back image) for a signable document filled out
 * while logged in — Contractor Data's first use of file uploads inside
 * this document family. `fieldName` is the ContractorDataFormData key the
 * upload belongs to (e.g. "ssnCardUrls"), `index` disambiguates multiple
 * files under the same field (front=0, back=1). Same storage path
 * convention/folder as uploadSignableDocumentSignature, and mirrored by
 * signableDocumentsBridge.ts's generic `attachment_*` handling for the
 * no-login external path — see that file's header comment.
 */
export async function uploadSignableDocumentAttachment(companyId: string, docId: string, fieldName: string, index: number, file: File): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/signable-documents/${docId}`;
  const objectRef = ref(storage, `${folder}/${fieldName}-${index}-${Date.now()}.${sanitizeFileName(file.name).split(".").pop() || "bin"}`);
  const snapshot = await uploadBytes(objectRef, file, { contentType: file.type || "application/octet-stream" });
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

export async function uploadPerformanceBonusPolicyForm(companyId: string, employeeName: string, pdfBlob: Blob): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }
  const folder = `companies/${companyId}/performance-bonus-policy-forms`;
  const objectName = `${Date.now()}-${sanitizeFileName(employeeName || "performance-bonus-policy")}.pdf`;
  const objectRef = ref(storage, `${folder}/${objectName}`);
  const snapshot = await uploadBytes(objectRef, pdfBlob, { contentType: "application/pdf" });
  return getDownloadURL(snapshot.ref);
}

/**
 * AHS Server Status — upload test from the signed-in browser: the same
 * Firebase Storage path, sign-in and storage rules every real upload uses
 * (photos, receipts, signatures, PDFs). Uploads a tiny file under the
 * company folder, gets its link, then deletes it. Returns the timings.
 */
export async function runBrowserUploadTest(companyId: string): Promise<{ uploadMs: number; linkMs: number; removed: boolean; path: string }> {
  if (!isFirebaseReady() || !storage) throw new Error("Firebase Storage not configured");
  const objectRef = ref(storage, `companies/${companyId}/status-checks/browser-${Date.now()}.txt`);
  const t0 = performance.now();
  // Straight to Firebase (no app-server fallback) — this tests that route.
  const snapshot = await sdkUploadBytes(objectRef, new Blob(["status check"], { type: "text/plain" }), { contentType: "text/plain" });
  const uploadMs = Math.round(performance.now() - t0);
  const t1 = performance.now();
  await sdkGetDownloadURL(snapshot.ref);
  const linkMs = Math.round(performance.now() - t1);
  // storage.rules' company-folder rule checks the upload size on every write,
  // deletes included (a delete has no size), so the browser usually can't
  // remove it — the page then asks the server to (cleanup-browser-test).
  const removed = await deleteObject(snapshot.ref).then(() => true, () => false);
  return { uploadMs, linkMs, removed, path: snapshot.ref.fullPath };
}
