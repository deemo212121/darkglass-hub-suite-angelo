import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  listAll,
  StorageReference,
  UploadResult,
} from "firebase/storage";
import { storage, isFirebaseReady } from "./config";

/**
 * Firebase Storage service for AH Solutions
 * 
 * Structure:
 * companies/{companyId}/
 *   users/{uid}/profile.jpg
 *   tickets/{ticketId}/before/*.jpg
 *   tickets/{ticketId}/after/*.jpg
 *   parts/{partId}/image.jpg
 *   documents/invoices/{ticketId}_invoice.pdf
 *   documents/receipts/{ticketId}_receipt.pdf
 */

export type FileType = 
  | "profile"
  | "ticket-before"
  | "ticket-after"
  | "part"
  | "invoice"
  | "receipt";

export interface UploadResult {
  path: string;
  url: string;
  filename: string;
}

/**
 * Upload profile picture
 */
export async function uploadProfilePicture(
  companyId: string,
  uid: string,
  file: File
): Promise<UploadResult> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }

  const path = `companies/${companyId}/users/${uid}/profile.jpg`;
  const storageRef = ref(storage, path);

  try {
    const snapshot: UploadResult = await uploadBytes(storageRef, file);
    const url = await getDownloadURL(snapshot.ref);

    return {
      path,
      url,
      filename: "profile.jpg",
    };
  } catch (error) {
    console.error("Error uploading profile picture:", error);
    throw error;
  }
}

/**
 * Upload ticket before/after images
 */
export async function uploadTicketImage(
  companyId: string,
  ticketId: string,
  file: File,
  type: "before" | "after"
): Promise<UploadResult> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }

  const timestamp = Date.now();
  const filename = `${type}_${timestamp}_${file.name}`;
  const path = `companies/${companyId}/tickets/${ticketId}/${type}/${filename}`;
  const storageRef = ref(storage, path);

  try {
    const snapshot: UploadResult = await uploadBytes(storageRef, file);
    const url = await getDownloadURL(snapshot.ref);

    return {
      path,
      url,
      filename,
    };
  } catch (error) {
    console.error(`Error uploading ${type} image:`, error);
    throw error;
  }
}

/**
 * Upload multiple ticket images
 */
export async function uploadTicketImages(
  companyId: string,
  ticketId: string,
  files: File[],
  type: "before" | "after"
): Promise<UploadResult[]> {
  const uploadPromises = files.map((file) =>
    uploadTicketImage(companyId, ticketId, file, type)
  );

  return Promise.all(uploadPromises);
}

/**
 * Upload part image
 */
export async function uploadPartImage(
  companyId: string,
  partId: string,
  file: File
): Promise<UploadResult> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }

  const filename = `part_${Date.now()}_${file.name}`;
  const path = `companies/${companyId}/parts/${partId}/${filename}`;
  const storageRef = ref(storage, path);

  try {
    const snapshot: UploadResult = await uploadBytes(storageRef, file);
    const url = await getDownloadURL(snapshot.ref);

    return {
      path,
      url,
      filename,
    };
  } catch (error) {
    console.error("Error uploading part image:", error);
    throw error;
  }
}

/**
 * Upload invoice document
 */
export async function uploadInvoice(
  companyId: string,
  ticketId: string,
  file: File
): Promise<UploadResult> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }

  const filename = `${ticketId}_invoice_${Date.now()}.pdf`;
  const path = `companies/${companyId}/documents/invoices/${filename}`;
  const storageRef = ref(storage, path);

  try {
    const snapshot: UploadResult = await uploadBytes(storageRef, file);
    const url = await getDownloadURL(snapshot.ref);

    return {
      path,
      url,
      filename,
    };
  } catch (error) {
    console.error("Error uploading invoice:", error);
    throw error;
  }
}

/**
 * Upload receipt document
 */
export async function uploadReceipt(
  companyId: string,
  ticketId: string,
  file: File
): Promise<UploadResult> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }

  const filename = `${ticketId}_receipt_${Date.now()}.pdf`;
  const path = `companies/${companyId}/documents/receipts/${filename}`;
  const storageRef = ref(storage, path);

  try {
    const snapshot: UploadResult = await uploadBytes(storageRef, file);
    const url = await getDownloadURL(snapshot.ref);

    return {
      path,
      url,
      filename,
    };
  } catch (error) {
    console.error("Error uploading receipt:", error);
    throw error;
  }
}

/**
 * Get all images for a ticket (before or after)
 */
export async function getTicketImages(
  companyId: string,
  ticketId: string,
  type: "before" | "after"
): Promise<string[]> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }

  const folderPath = `companies/${companyId}/tickets/${ticketId}/${type}`;
  const folderRef = ref(storage, folderPath);

  try {
    const result = await listAll(folderRef);
    const urlPromises = result.items.map((itemRef) => getDownloadURL(itemRef));
    return Promise.all(urlPromises);
  } catch (error) {
    console.error(`Error getting ${type} images:`, error);
    return [];
  }
}

/**
 * Delete a file from storage
 */
export async function deleteFile(path: string): Promise<void> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }

  const fileRef = ref(storage, path);

  try {
    await deleteObject(fileRef);
  } catch (error) {
    console.error("Error deleting file:", error);
    throw error;
  }
}

/**
 * Get download URL for a file
 */
export async function getFileURL(path: string): Promise<string> {
  if (!isFirebaseReady() || !storage) {
    throw new Error("Firebase Storage not configured");
  }

  const fileRef = ref(storage, path);

  try {
    return await getDownloadURL(fileRef);
  } catch (error) {
    console.error("Error getting file URL:", error);
    throw error;
  }
}

/**
 * Validate file type for upload
 */
export function validateFileType(file: File, type: FileType): boolean {
  const imageTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  const documentTypes = ["application/pdf"];

  switch (type) {
    case "profile":
    case "ticket-before":
    case "ticket-after":
    case "part":
      return imageTypes.includes(file.type);
    case "invoice":
    case "receipt":
      return documentTypes.includes(file.type);
    default:
      return false;
  }
}

/**
 * Validate file size (max 5MB for images, 10MB for documents)
 */
export function validateFileSize(file: File, type: FileType): boolean {
  const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
  const MAX_DOC_SIZE = 10 * 1024 * 1024; // 10MB

  switch (type) {
    case "profile":
    case "ticket-before":
    case "ticket-after":
    case "part":
      return file.size <= MAX_IMAGE_SIZE;
    case "invoice":
    case "receipt":
      return file.size <= MAX_DOC_SIZE;
    default:
      return false;
  }
}
