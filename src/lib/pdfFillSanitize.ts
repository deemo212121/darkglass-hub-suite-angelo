/**
 * pdf-lib's StandardFonts (Helvetica/HelveticaBold, used by every
 * `*PdfFill.ts` script) only support WinAnsi encoding. The moment a value
 * reaches `form.updateFieldAppearances()` or `page.drawText()` containing a
 * character outside that encoding — a checkmark, most emoji, some symbols a
 * mobile keyboard's autocorrect/paste can insert — pdf-lib throws
 * synchronously (`WinAnsi cannot encode "X" (0xNNNN)`), aborting the whole
 * PDF fill/submission. Reproduced for real with a stray "✓" a user had typed
 * into a plain text field. Every free-typed value drawn into a PDF (AcroForm
 * field or direct page.drawText) should be passed through this first so one
 * unsupported character never blocks submission.
 *
 * Uses the embedded font's own `encodeText` to decide what's safe, rather
 * than a hand-maintained WinAnsi table, so it always matches exactly what
 * that font can actually render.
 */
import type { PDFFont } from "pdf-lib";

const COMMON_SUBSTITUTIONS: Record<string, string> = {
  "✓": "X", "✔": "X", "☑": "X", "✅": "X",
  "✗": "X", "✘": "X", "☒": "X", "❌": "X",
};

export function sanitizeForFont(value: string | undefined | null, font: PDFFont): string {
  if (!value) return "";
  let out = "";
  for (const ch of value) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += COMMON_SUBSTITUTIONS[ch] ?? "";
    }
  }
  return out;
}
