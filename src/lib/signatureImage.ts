/**
 * Readies a Hiring Gmail signature photo for saving: checks it's an image and
 * shrinks anything wider than an email comfortably shows, or too big to store.
 * The result is the data: URL saved on the account (migration 0429).
 */
import { MAX_SIGNATURE_IMAGE_LENGTH } from "@/lib/hiringEmails";

const MAX_WIDTH = 600;

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("That file couldn't be read."));
    reader.readAsDataURL(file);
  });

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file couldn't be read as an image."));
    img.src = src;
  });

export async function prepareSignatureImage(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|gif)$/.test(file.type)) throw new Error("Use a PNG, JPG or GIF image.");
  const original = await readAsDataUrl(file);
  const img = await loadImage(original);
  if (img.naturalWidth <= MAX_WIDTH && original.length <= MAX_SIGNATURE_IMAGE_LENGTH) return original;

  const scale = Math.min(1, MAX_WIDTH / img.naturalWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("That image couldn't be resized here. Try a smaller one.");
  const draw = (type: "image/png" | "image/jpeg") => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (type === "image/jpeg") {
      ctx.fillStyle = "#fff"; // JPG has no transparency
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(type, 0.9);
  };

  let result = draw(file.type === "image/jpeg" ? "image/jpeg" : "image/png");
  if (result.length > MAX_SIGNATURE_IMAGE_LENGTH) result = draw("image/jpeg");
  if (result.length > MAX_SIGNATURE_IMAGE_LENGTH) throw new Error("That image is still too large after shrinking it. Use a smaller one.");
  return result;
}
