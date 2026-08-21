/**
 * Fills the REAL, official IRS Form W-4R PDF (src/assets/fw4r.pdf) using its
 * own native AcroForm fields — same approach as w4PdfFill.ts. Field names
 * are the generic `f1_NN` the IRS's PDF generator assigns, nested under
 * grouping subforms (topmostSubform[0].Page1[0], with name/address/city
 * further nested under Line1a[0]) — no human-readable naming, so the
 * mapping below was derived by inspecting each field's on-page position
 * against the visible line labels (extracted via pdf.js's text-position
 * API: "1a First name and middle initial"/"Last name" sit directly above
 * f1_01/f1_02, "1b Social security number" above f1_05 — maxLength=11
 * confirms it, a formatted "XXX-XX-XXXX" — "Address"/"City or town, state,
 * and ZIP code" above f1_03/f1_04, and Line 2's "Enter the rate as a whole
 * number" digit-dots sit directly above f1_06, maxLength=3 confirming a
 * 0-100 percentage).
 *
 * There is no AcroForm field at all for the "Sign Here" row's "Your
 * signature" / "Date" line (confirmed by full field inspection — only 6
 * fields exist on the whole form) — the IRS's own form expects a
 * handwritten signature there, same as W-4/W-9. Both are instead drawn
 * directly onto the page at coordinates derived from the actual position of
 * the "Your signature (This form is not valid unless you sign it.)" / "Date"
 * caption text (extracted via pdf.js's text-position API).
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { W4RFormData } from "./w4rFormTemplate";

const P = (n: string) => `topmostSubform[0].Page1[0].${n}`;

const fmtDate = (v: string) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}-${d.getFullYear()}`;
};

export async function loadBlankW4RBytes(): Promise<Uint8Array> {
  const mod = await import("@/assets/fw4r.pdf");
  const res = await fetch(mod.default);
  return new Uint8Array(await res.arrayBuffer());
}

export async function fillW4RPdf(data: W4RFormData, signaturePngBytes?: Uint8Array): Promise<Uint8Array> {
  const blankBytes = await loadBlankW4RBytes();
  const pdfDoc = await PDFDocument.load(blankBytes);
  const form = pdfDoc.getForm();

  const setText = (name: string, value: string) => {
    try {
      form.getTextField(name).setText(value ?? "");
    } catch (err) {
      console.error(`W-4R PDF: failed to set field ${name}:`, err);
    }
  };

  setText(P("Line1a[0].f1_01[0]"), data.firstNameMiddleInitial);
  setText(P("Line1a[0].f1_02[0]"), data.lastName);
  // maxLength=11 on the real PDF field — a formatted "XXX-XX-XXXX" (9 digits
  // + 2 dashes), unlike I-9's raw-digit SSN field.
  setText(P("f1_05[0]"), data.ssn);
  setText(P("Line1a[0].f1_03[0]"), data.address);
  setText(P("Line1a[0].f1_04[0]"), data.cityStateZip);
  // maxLength=3 on the real PDF field — a whole number 0-100, clamped here
  // rather than left to error out mid-fill (same defensive pattern as
  // i9PdfFill.ts's middle-initial/SSN fields).
  setText(P("f1_06[0]"), (data.withholdingRatePercent || "").slice(0, 3));

  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  form.updateFieldAppearances(helveticaBold);

  // "Sign Here" row's signature/date have no AcroForm field on this PDF at
  // all (see header comment) — drawn directly onto the page instead, same
  // dark-blue bold convention every other filled-in value on this form
  // family uses. Coordinates are estimated from the "Your signature (This
  // form is not valid unless you sign it.)" caption at y≈468 and "Date"
  // caption at x≈448,y≈468 (both extracted via pdf.js) — the actual blank
  // writing space sits just above that caption row.
  const page1 = pdfDoc.getPage(0);
  const dateStr = fmtDate(data.dateSigned);
  if (dateStr) {
    page1.drawText(dateStr, { x: 448, y: 474, size: 9, font: helveticaBold, color: rgb(0, 0, 0.545) });
  }
  if (signaturePngBytes) {
    const png = await pdfDoc.embedPng(signaturePngBytes);
    const maxW = 360;
    const maxH = 22;
    const scale = Math.min(maxW / png.width, maxH / png.height, 1);
    page1.drawImage(png, { x: 74, y: 472, width: png.width * scale, height: png.height * scale });
  }

  // Locking every field is safe now — HR never edits this generated PDF
  // directly (fillW4RPdf is always re-run from scratch instead).
  for (const field of form.getFields()) {
    field.enableReadOnly();
  }

  return pdfDoc.save();
}
