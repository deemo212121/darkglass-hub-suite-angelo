/**
 * Fills the REAL, official IRS Form W-8BEN PDF (src/assets/w8ben-blank.pdf,
 * the exact fillable file the user provided) using its own native AcroForm
 * fields — nothing is redrawn or recreated. This is the only way to keep a
 * government tax form legitimate: the output is the unmodified original
 * document with its own fields populated, not a lookalike.
 *
 * Field names in that PDF are the generic `f_1`..`f_21` the IRS's PDF
 * generator assigns (see topmostSubform[0].Page1[0].*) — there's no
 * human-readable naming, so the mapping below was derived by inspecting
 * each field's on-page position (pdf-lib's acroField.getWidgets()[0]
 * .getRectangle()) against the visible line numbers, then cross-checked
 * against the user's filled sample (e.g. f_9 has maxLen=11, matching an
 * SSN mask; f_12 has maxLen=10, matching MM-DD-YYYY for Date of Birth).
 *
 * f_20 (Part III's signature line) is a PDFSignature field, not a normal
 * text field — pdf-lib can't "fill" that with an image, so the drawn
 * signature is instead stamped directly onto the page at that field's own
 * rectangle. The field itself is left in place, unsigned (see the note
 * below on why removeField()/flatten() aren't used at all here).
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { W8benFormData } from "./w8benFormTemplate";

const F = (n: string) => `topmostSubform[0].Page1[0].${n}`;

const fmtDate = (v: string) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}-${d.getFullYear()}`;
};

export async function loadBlankW8benBytes(): Promise<Uint8Array> {
  const mod = await import("@/assets/w8ben-blank.pdf");
  const res = await fetch(mod.default);
  return new Uint8Array(await res.arrayBuffer());
}

export async function fillW8benPdf(data: W8benFormData, signaturePngBytes?: Uint8Array): Promise<Uint8Array> {
  const blankBytes = await loadBlankW8benBytes();
  const pdfDoc = await PDFDocument.load(blankBytes);
  const form = pdfDoc.getForm();

  const setText = (name: string, value: string) => {
    try {
      form.getTextField(F(name)).setText(value ?? "");
    } catch (err) {
      console.error(`W-8BEN PDF: failed to set field ${name}:`, err);
    }
  };
  const setCheck = (name: string, checked: boolean) => {
    try {
      const box = form.getCheckBox(F(name));
      if (checked) box.check();
      else box.uncheck();
    } catch (err) {
      console.error(`W-8BEN PDF: failed to set checkbox ${name}:`, err);
    }
  };

  // Part I — the recipient's own answers
  setText("f_1[0]", data.employeeName);
  setText("f_2[0]", data.countryOfCitizenship);
  setText("f_3[0]", data.permanentAddress.street);
  setText("f_4[0]", data.permanentAddress.cityStateZip);
  setText("f_5[0]", data.permanentAddress.country);
  setText("f_6[0]", data.mailingAddress.street);
  setText("f_7[0]", data.mailingAddress.cityStateZip);
  setText("f_8[0]", data.mailingAddress.country);
  setText("f_9[0]", data.usTin);
  setCheck("c1_01[0]", data.ftinNotRequired);
  setText("f_10[0]", data.ftin);
  setText("f_11[0]", data.referenceNumbers);
  setText("f_12[0]", fmtDate(data.dateOfBirth));

  // Part II — the recipient's own answers, same as Part I (never a fixed
  // company-standard claim).
  setText("f_13[0]", data.treatyResidentCountry);
  setText("f_14[0]", data.treatyArticleParagraph);
  setText("f_15[0]", data.treatyRate);
  setText("f_16[0]", data.treatyIncomeType);
  setText("f_18[0]", data.treatyAdditionalConditions);
  // f_17 (a narrow, unlabeled trailing field with no corresponding line on
  // the visible form) isn't part of our data model, but every field still
  // needs setText("") called at least once even when left blank — an
  // untouched field has no appearance stream at all, and
  // form.updateFieldAppearances()/flatten() throws ("Unexpected N type:
  // undefined") the moment it reaches one.
  setText("f_17[0]", "");

  // Part III
  setCheck("c1_02[0]", data.certifiedTrue);
  setText("Date[0]", fmtDate(data.dateSigned));
  setText("f_21[0]", data.employeeName);

  if (signaturePngBytes) {
    const sigField = form.getField(F("f_20[0]"));
    const rect = sigField.acroField.getWidgets()[0].getRectangle();
    const png = await pdfDoc.embedPng(signaturePngBytes);
    const scale = Math.min(rect.width / png.width, (rect.height * 2.5) / png.height, 1);
    const page = pdfDoc.getPage(0);
    page.drawImage(png, { x: rect.x, y: rect.y, width: png.width * scale, height: png.height * scale });
    // NOT form.removeField(sigField) — pdf-lib's removeField/flatten both
    // crash ("Unexpected N type: undefined") on this field, since a never-
    // signed PDFSignature widget has no appearance stream to look up. The
    // field is harmless left in place (still unsigned, doesn't render
    // anything); the drawn image above is what actually shows the signature.
  }

  // Every field's own /DA already specifies "/HelveticaLTStd-Bold 8.00 Tf
  // 0.000 0.000 0.502 rg" (bold, dark blue) — that's the form's own native
  // fillable-answer convention, not something we're choosing. pdf-lib can't
  // resolve "HelveticaLTStd-Bold" (a Linotype font-substitution name, not
  // embedded in the PDF) to a usable font object on its own, so we supply
  // the closest real match ourselves — pdf-lib's built-in Bold Helvetica —
  // while updateFieldAppearances still reads each field's own DA for size
  // and color, so the blue/bold/8pt convention is preserved exactly.
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  form.updateFieldAppearances(helveticaBold);

  // Lock every field against further edits once submitted — same intent as
  // flattening (no tampering with a finished, sent-back tax form), but
  // enableReadOnly just sets the AcroForm's read-only bit per field instead
  // of baking text into the page content stream, so it doesn't hit the same
  // appearance-lookup crash flatten() does on the untouched signature field.
  for (const field of form.getFields()) {
    field.enableReadOnly();
  }

  return pdfDoc.save();
}
