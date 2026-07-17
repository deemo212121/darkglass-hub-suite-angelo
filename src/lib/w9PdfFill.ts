/**
 * Fills the REAL, official IRS Form W-9 PDF (src/assets/w9-blank.pdf) using
 * its own native AcroForm fields — same approach as w4PdfFill.ts. Field
 * names are the generic `f1_NN`/`c1_N` the IRS's PDF generator assigns,
 * nested under grouping subforms (Boxes3a-b_ReadOrder, Address_ReadOrder)
 * — there's no human-readable naming, so the mapping below was derived by
 * inspecting each field's on-page position against the visible line labels
 * (e.g. f1_03 has maxLen=1, matching the single-letter LLC classification
 * code; f1_11/f1_12/f1_13 have maxLen 3/2/4, matching the SSN's XXX-XX-XXXX
 * split boxes; f1_14/f1_15 have maxLen 2/7, matching the EIN's XX-XXXXXXX
 * split boxes).
 *
 * There is no AcroForm field at all for Part II's "Signature of U.S.
 * person" / "Date" line (confirmed by full field inspection) — the IRS's
 * own form expects a handwritten signature there. Both are instead drawn
 * directly onto the page at coordinates derived from the actual position
 * of the "Signature of / U.S. person" and "Date" caption text (extracted
 * via pdf.js's text-position API), since there's no field rectangle to
 * anchor to — same situation as the W-4's Step 5.
 *
 * Called once, when the person submits (FillW9Page.tsx) — there's no later
 * "requester completes a section" step the way the W-4 has an Employers
 * Only box, so unlike w4PdfFill.ts this only ever runs once per document.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { W9FormData } from "./w9FormTemplate";

const P = (n: string) => `topmostSubform[0].Page1[0].${n}`;

const fmtDate = (v: string) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}-${d.getFullYear()}`;
};

export async function loadBlankW9Bytes(): Promise<Uint8Array> {
  const mod = await import("@/assets/w9-blank.pdf");
  const res = await fetch(mod.default);
  return new Uint8Array(await res.arrayBuffer());
}

export async function fillW9Pdf(data: W9FormData, signaturePngBytes?: Uint8Array): Promise<Uint8Array> {
  const blankBytes = await loadBlankW9Bytes();
  const pdfDoc = await PDFDocument.load(blankBytes);
  const form = pdfDoc.getForm();

  const setText = (name: string, value: string) => {
    try {
      form.getTextField(P(name)).setText(value ?? "");
    } catch (err) {
      console.error(`W-9 PDF: failed to set field ${name}:`, err);
    }
  };
  const setCheck = (name: string, checked: boolean) => {
    try {
      const box = form.getCheckBox(P(name));
      if (checked) box.check();
      else box.uncheck();
    } catch (err) {
      console.error(`W-9 PDF: failed to set checkbox ${name}:`, err);
    }
  };

  // Line 1/2
  setText("f1_01[0]", data.name);
  setText("f1_02[0]", data.businessName);

  // Line 3a — tax classification (check only one)
  setCheck("Boxes3a-b_ReadOrder[0].c1_1[0]", data.taxClassification === "individual");
  setCheck("Boxes3a-b_ReadOrder[0].c1_1[1]", data.taxClassification === "c_corp");
  setCheck("Boxes3a-b_ReadOrder[0].c1_1[2]", data.taxClassification === "s_corp");
  setCheck("Boxes3a-b_ReadOrder[0].c1_1[3]", data.taxClassification === "partnership");
  setCheck("Boxes3a-b_ReadOrder[0].c1_1[4]", data.taxClassification === "trust_estate");
  setCheck("Boxes3a-b_ReadOrder[0].c1_1[5]", data.taxClassification === "llc");
  setText("Boxes3a-b_ReadOrder[0].f1_03[0]", data.taxClassification === "llc" ? data.llcTaxClassificationCode : "");
  setCheck("Boxes3a-b_ReadOrder[0].c1_1[6]", data.taxClassification === "other");
  setText("Boxes3a-b_ReadOrder[0].f1_04[0]", data.taxClassification === "other" ? data.otherClassificationText : "");

  // Line 3b
  setCheck("Boxes3a-b_ReadOrder[0].c1_2[0]", data.foreignPartnersCheckbox);

  // Line 4 — Exemptions
  setText("f1_05[0]", data.exemptPayeeCode);
  setText("f1_06[0]", data.fatcaExemptionCode);

  // Line 5/6/7
  setText("Address_ReadOrder[0].f1_07[0]", data.address);
  setText("Address_ReadOrder[0].f1_08[0]", data.cityStateZip);
  setText("f1_10[0]", data.accountNumbers);

  // "Requester's name and address (optional)"
  setText("f1_09[0]", data.requesterNameAddress);

  // Part I — TIN (SSN or EIN, whichever applies)
  setText("f1_11[0]", data.ssnPart1);
  setText("f1_12[0]", data.ssnPart2);
  setText("f1_13[0]", data.ssnPart3);
  setText("f1_14[0]", data.einPart1);
  setText("f1_15[0]", data.einPart2);

  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  form.updateFieldAppearances(helveticaBold);

  // Part II's signature/date have no AcroForm field on this PDF at all
  // (see header comment) — drawn directly onto the page instead, same
  // dark-blue bold convention every other filled-in value on this form
  // uses. Coordinates here are NOT guessed from text positions this time —
  // they're read from the page's actual drawn rule lines (decoded the
  // content stream directly): the "Sign Here" row is a real bordered box
  // spanning y=192 to y=216, with vertical dividers at x=72 (before the
  // "Signature of U.S. person" cell) and x=381 (before the "Date" cell).
  // The caption text sits low in that row, so the actual writing space is
  // to the RIGHT of the caption words, using the row's full height — not
  // squeezed into the sliver above the caption like earlier attempts
  // assumed.
  const page1 = pdfDoc.getPage(0);
  const dateStr = fmtDate(data.dateSigned);
  if (dateStr) {
    page1.drawText(dateStr, { x: 420, y: 198, size: 9, font: helveticaBold, color: rgb(0, 0, 0.545) });
  }
  if (signaturePngBytes) {
    const png = await pdfDoc.embedPng(signaturePngBytes);
    const maxW = 210;
    const maxH = 16;
    const scale = Math.min(maxW / png.width, maxH / png.height, 1);
    page1.drawImage(png, { x: 160, y: 198, width: png.width * scale, height: png.height * scale });
  }

  for (const field of form.getFields()) {
    field.enableReadOnly();
  }

  return pdfDoc.save();
}
