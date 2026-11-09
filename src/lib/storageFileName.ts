/**
 * A file name that Supabase Storage accepts inside an object key. Storage
 * answers "Invalid key" for any key with a non-ASCII character, so a CV named
 * "José-Walss-resume.pdf" failed to upload outright. Accents are dropped
 * (José → Jose, Peña → Pena) and anything else outside letters, digits,
 * spaces and . _ - ( ) becomes "_", so the name stays readable.
 */
export function storageFileName(name: string): string {
  const cleaned = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._\-() ]+/g, "_")
    .trim();
  return cleaned || "file";
}
