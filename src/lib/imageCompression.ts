/**
 * Client-side image compression for ticket photo uploads (technician
 * documentation photos — serial numbers, model numbers, damaged parts,
 * wiring, error codes). Everything here runs in the browser; nothing is
 * imported at module scope that would break the SSR/Cloudflare Worker
 * bundle — browser-image-compression and heic2any are loaded lazily inside
 * compressImage(), which is only ever called from a browser file-input
 * event handler (same lazy-load reasoning as getLeaflet() in mapEngine.ts).
 */

const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "heic", "heif", "webp"];
const HEIC_EXTENSIONS = new Set(["heic", "heif"]);

const MAX_DIMENSION = 1920;
const MAX_SIZE_MB = 1;
const QUALITY = 0.82;

export interface CompressionResult {
  blob: Blob;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  mimeType: string;
  originalSize: number;
  compressedSize: number;
  /** file.lastModified — the closest thing to a "capture date" available
   *  without parsing EXIF, since canvas re-encoding strips EXIF entirely. */
  capturedAt: number;
}

function extOf(fileName: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(fileName);
  return m ? m[1].toLowerCase() : "";
}

/** Rejects anything outside JPG/JPEG/PNG/HEIC/HEIF/WebP. Returns an error message, or null if valid. */
export function validateImageFile(file: File): string | null {
  const ext = extOf(file.name);
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return `"${file.name}" isn't a supported photo format (allowed: JPG, PNG, HEIC, WebP).`;
  }
  return null;
}

let webpSupportPromise: Promise<boolean> | null = null;

/** Feature-detects WebP encode support via canvas.toBlob(); cached for the session. */
export function supportsWebP(): Promise<boolean> {
  if (webpSupportPromise) return webpSupportPromise;
  webpSupportPromise = new Promise((resolve) => {
    if (typeof document === "undefined") { resolve(false); return; }
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    canvas.toBlob(
      (blob) => resolve(Boolean(blob && blob.type === "image/webp")),
      "image/webp",
    );
  });
  return webpSupportPromise;
}

/**
 * HEIC/HEIF can't be decoded by <canvas> in any browser, so it has to be
 * converted to JPEG first — only then can the resize/compress step run.
 */
async function convertHeicToJpeg(file: File): Promise<File> {
  const heic2any = (await import("heic2any")).default;
  const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
  const blob = Array.isArray(converted) ? converted[0] : converted;
  return new File([blob], file.name.replace(/\.(heic|heif)$/i, ".jpg"), { type: "image/jpeg" });
}

/**
 * Resize to a max of 1920px on the long edge (aspect ratio preserved, never
 * cropped/stretched) and re-encode to WebP (falling back to JPEG when the
 * browser can't produce WebP), targeting ~1MB.
 */
export async function compressImage(file: File): Promise<CompressionResult> {
  const originalSize = file.size;
  const capturedAt = file.lastModified;

  const ext = extOf(file.name);
  // HEIC/HEIF can't be decoded by <img> or <canvas> at all — convert to
  // JPEG first so BOTH the "original" dimension read below and the actual
  // compression step operate on the same already-decoded source, rather
  // than running the (slow, WASM) HEIC decode twice.
  const source = HEIC_EXTENSIONS.has(ext) ? await convertHeicToJpeg(file) : file;

  const [originalDims, imageCompression, useWebP] = await Promise.all([
    readImageDimensions(source),
    import("browser-image-compression").then((m) => m.default),
    supportsWebP(),
  ]);

  const compressed = await imageCompression(source, {
    maxWidthOrHeight: MAX_DIMENSION,
    maxSizeMB: MAX_SIZE_MB,
    initialQuality: QUALITY,
    fileType: useWebP ? "image/webp" : "image/jpeg",
    useWebWorker: true,
    preserveExif: false,
  });

  // The library returns a File/Blob, not dimensions — read them back via an
  // offscreen Image.
  const dims = await readImageDimensions(compressed);

  return {
    blob: compressed,
    width: dims.width,
    height: dims.height,
    originalWidth: originalDims.width,
    originalHeight: originalDims.height,
    mimeType: compressed.type || (useWebP ? "image/webp" : "image/jpeg"),
    originalSize,
    compressedSize: compressed.size,
    capturedAt,
  };
}

function readImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({ width: 0, height: 0 });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
