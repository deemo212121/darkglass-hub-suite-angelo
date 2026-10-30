/**
 * Pictures on ServicePower claims. Square Trade needs the ticket's pictures
 * with every claim; SPPN needs them when the unit is unrepairable or its
 * serial number doesn't match (the two boxes on the Pre-Claim, migration
 * 0413). The Pre-Claim (PreClaimModal.tsx) holds Submit to ServicePower
 * until the ticket has them, then sends each one to the claim with
 * ServicePower's Add Document to Claim (Claims Submission guide v1.10 §6 —
 * one file per call, base64).
 */
import type { TicketPhoto } from "@/lib/firebase/storage";
import type { SpClaimDocument } from "@/lib/supabase/claimDetails";
import { PHOTO_TYPES } from "@/lib/photoTypes";

/**
 * ServicePower's document category for a picture — 3 characters (their
 * sample request uses "CG1"). It isn't in the guide and can't be read
 * through the API; it comes from HUB's claim document upload. "" = not
 * known yet: the pictures are still required on the Pre-Claim, but they
 * aren't sent — upload them in HUB meanwhile.
 */
export const SP_PHOTO_DOCUMENT_CATEGORY = "";

type ClaimTicket = { account?: string | null; claimCompany?: string | null; ticketSource?: string | null };
const anyField = (t: ClaimTicket, re: RegExp) => [t.account, t.claimCompany, t.ticketSource].some((v) => re.test(String(v ?? "")));

export const isSquareTradeClaim = (t: ClaimTicket) => anyField(t, /square\s*trade|^\s*sqt\b/i);
/** "SPPN" or "*SPPN" (both are in the data). */
export const isSppnClaim = (t: ClaimTicket) => anyField(t, /\bsppn\b/i);

/** Who needs pictures on this claim, or null when nobody does. */
export function claimPhotoRule(t: ClaimTicket, flags: { unrepairable?: boolean; serialMismatch?: boolean }): "square_trade" | "sppn" | null {
  if (isSquareTradeClaim(t)) return "square_trade";
  if (isSppnClaim(t) && (flags.unrepairable || flags.serialMismatch)) return "sppn";
  return null;
}

export const isImagePhoto = (p: TicketPhoto) => /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(p.name);

const photoLabel = (p: TicketPhoto) => PHOTO_TYPES.find((t) => t.key === p.photoType)?.label || "Picture";

/** The picture as a JPEG (most are saved as WebP), base64 without the data: prefix. Fetched through /api/image-proxy — the bucket sends no CORS headers. */
async function photoAsJpegBase64(url: string): Promise<string> {
  const res = await fetch(`/api/image-proxy?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`couldn't load it (HTTP ${res.status})`);
  const bitmap = await createImageBitmap(await res.blob());
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("couldn't convert it to JPEG");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("couldn't read it"));
    reader.readAsDataURL(blob);
  });
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

/**
 * Sends the ticket's pictures that aren't on the claim yet. Returns the ones
 * ServicePower took (to add to sp_documents) and a line per one it didn't.
 * Stops at the first "category" refusal — every other picture would get the
 * same answer.
 */
export async function sendClaimPhotosToServicePower(
  claim: { manufacturerName: string; claimBatchNumber: number; claimSequenceNumber: number; claimNumber: string },
  photos: TicketPhoto[],
  alreadySent: SpClaimDocument[],
): Promise<{ sent: SpClaimDocument[]; failed: string[] }> {
  const sent: SpClaimDocument[] = [];
  const failed: string[] = [];
  if (!SP_PHOTO_DOCUMENT_CATEGORY) return { sent, failed: ["AHS doesn't have ServicePower's picture category code yet — upload the pictures in HUB."] };
  const { addClaimDocument } = await import("@/lib/servicePowerApiClient");
  const done = new Set(alreadySent.map((d) => d.path));
  for (const photo of photos.filter((p) => isImagePhoto(p) && !done.has(p.fullPath))) {
    const label = photoLabel(photo);
    try {
      const file = await photoAsJpegBase64(photo.url);
      const res = await addClaimDocument(claim, {
        category: SP_PHOTO_DOCUMENT_CATEGORY,
        description: label.slice(0, 60),
        filename: photo.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 96) + ".jpg",
        file,
      });
      if (res.responseCode === "OK") {
        sent.push({ path: photo.fullPath, name: photo.name, documentId: String(res.documentId ?? ""), sentAt: new Date().toISOString() });
        continue;
      }
      const why = res.messages?.map((m) => m.message).join("; ") || "ServicePower didn't take it";
      failed.push(`${label}: ${why}`);
      if (/category/i.test(why)) break;
    } catch (err) {
      failed.push(`${label}: ${err instanceof Error ? err.message : "couldn't send it"}`);
    }
  }
  return { sent, failed };
}
