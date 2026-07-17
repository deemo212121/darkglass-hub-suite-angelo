/**
 * Fills the REAL, official IRS Form W-4 PDF (src/assets/w4-blank.pdf) using
 * its own native AcroForm fields — same approach as w8benPdfFill.ts. Field
 * names are the generic `f1_NN`/`f3_NN`/`f4_NN`/`c1_N` the IRS's PDF
 * generator assigns, nested under grouping subforms (Step1a,
 * Step3_ReadOrder, Page3, Page4) — there's no human-readable naming, so the
 * mapping below was derived by inspecting each field's on-page position
 * against the visible line labels (e.g. f1_05 has maxLen=11, matching an
 * SSN mask; f1_14 has maxLen=10, matching an EIN mask XX-XXXXXXX), then
 * confirmed against the user's own field-by-page breakdown of the form.
 *
 * There is no AcroForm field at all for Step 5's "Employee's signature" /
 * "Date" line on page 1 (confirmed by full field inspection) — the IRS's
 * own form expects a handwritten signature there. Both are instead drawn
 * directly onto the page at coordinates derived from the actual position
 * of the "Employee's signature" and "Date" caption text (extracted via
 * pdf.js's text-position API), since there's no field rectangle to anchor
 * to.
 *
 * This is called TWICE over a document's lifetime, both times regenerating
 * the whole PDF fresh from the local blank template (never patching an
 * already-generated file, which would mean fetching it back from Firebase
 * Storage — a cross-origin read that needs CORS configured on the bucket):
 *   1. When the employee submits (FillW4Page.tsx) — employer fields blank.
 *   2. When HR completes the "Employers Only" box afterward
 *      (ReportHRDaily.tsx's "Fill Employer Info" dialog) — called again
 *      with the ALREADY-STORED formData (a plain same-origin Supabase read)
 *      plus the newly-typed employer fields, redrawing the same signature
 *      from formData.signatureDataUrl (see w4FormTemplate.ts's header
 *      comment for why that's stored as a data: URL alongside the durable
 *      Firebase Storage one).
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { W4FormData } from "./w4FormTemplate";

const P = (n: string) => `topmostSubform[0].Page1[0].${n}`;
const P3 = (n: string) => `topmostSubform[0].Page3[0].${n}`;
const P4 = (n: string) => `topmostSubform[0].Page4[0].${n}`;

const fmtDate = (v: string) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}-${d.getFullYear()}`;
};

export async function loadBlankW4Bytes(): Promise<Uint8Array> {
  const mod = await import("@/assets/w4-blank.pdf");
  const res = await fetch(mod.default);
  return new Uint8Array(await res.arrayBuffer());
}

export async function fillW4Pdf(data: W4FormData, signaturePngBytes?: Uint8Array): Promise<Uint8Array> {
  const blankBytes = await loadBlankW4Bytes();
  const pdfDoc = await PDFDocument.load(blankBytes);
  const form = pdfDoc.getForm();

  const setText = (name: string, value: string) => {
    try {
      form.getTextField(name).setText(value ?? "");
    } catch (err) {
      console.error(`W-4 PDF: failed to set field ${name}:`, err);
    }
  };
  const setCheck = (name: string, checked: boolean) => {
    try {
      const box = form.getCheckBox(name);
      if (checked) box.check();
      else box.uncheck();
    } catch (err) {
      console.error(`W-4 PDF: failed to set checkbox ${name}:`, err);
    }
  };

  // Page 1 — Step 1
  setText(P("Step1a[0].f1_01[0]"), data.firstNameMiddleInitial);
  setText(P("Step1a[0].f1_02[0]"), data.lastName);
  setText(P("f1_05[0]"), data.ssn);
  setText(P("Step1a[0].f1_03[0]"), data.address);
  setText(P("Step1a[0].f1_04[0]"), data.cityStateZip);

  setCheck(P("c1_1[0]"), data.filingStatus === "single_or_mfs");
  setCheck(P("c1_1[1]"), data.filingStatus === "married_filing_jointly");
  setCheck(P("c1_1[2]"), data.filingStatus === "head_of_household");

  // Step 2
  setCheck(P("c1_2[0]"), data.multipleJobsCheckbox);

  // Step 3
  setText(P("Step3_ReadOrder[0].f1_06[0]"), data.step3ChildrenAmount);
  setText(P("Step3_ReadOrder[0].f1_07[0]"), data.step3OtherDependentsAmount);
  setText(P("f1_08[0]"), data.step3TotalAmount);

  // Step 4
  setText(P("f1_09[0]"), data.step4aOtherIncome);
  setText(P("f1_10[0]"), data.step4bDeductions);
  setText(P("f1_11[0]"), data.step4cExtraWithholding);

  // Exempt from Withholding
  setCheck(P("c1_3[0]"), data.exemptCheckbox);

  // "Employers Only" box — blank on the employee's own submission, filled
  // in on the regeneration HR's "Fill Employer Info" dialog triggers.
  setText(P("f1_12[0]"), data.employerNameAndAddress);
  setText(P("f1_13[0]"), fmtDate(data.employerFirstDateOfEmployment));
  setText(P("f1_14[0]"), data.employerEin);

  // Page 3 — Multiple Jobs Worksheet
  setText(P3("f3_01[0]"), data.mjwLine1);
  setText(P3("f3_02[0]"), data.mjwLine2a);
  setText(P3("f3_03[0]"), data.mjwLine2b);
  setText(P3("f3_04[0]"), data.mjwLine2c);
  setText(P3("f3_05[0]"), data.mjwLine3);
  setText(P3("f3_06[0]"), data.mjwLine4);

  // Page 4 — Deductions Worksheet
  setText(P4("f4_01[0]"), data.dwLine1a);
  setText(P4("f4_02[0]"), data.dwLine1b);
  setText(P4("f4_03[0]"), data.dwLine1c);
  setText(P4("f4_04[0]"), data.dwLine2);
  setText(P4("f4_05[0]"), data.dwLine3a);
  setText(P4("f4_06[0]"), data.dwLine3b);
  setText(P4("f4_07[0]"), data.dwLine4);
  setText(P4("f4_08[0]"), data.dwLine5);
  setText(P4("f4_09[0]"), data.dwLine6a);
  setText(P4("f4_10[0]"), data.dwLine6b);
  setText(P4("f4_11[0]"), data.dwLine6c);
  setText(P4("f4_12[0]"), data.dwLine6d);
  setText(P4("f4_13[0]"), data.dwLine6e);
  setText(P4("f4_14[0]"), data.dwLine7);
  setText(P4("f4_15[0]"), data.dwLine8a);
  setText(P4("f4_16[0]"), data.dwLine8b);
  setText(P4("f4_17[0]"), data.dwLine9);
  setText(P4("f4_18[0]"), data.dwLine10);
  setText(P4("f4_19[0]"), data.dwLine11);
  setText(P4("f4_20[0]"), data.dwLine12);
  setText(P4("f4_21[0]"), data.dwLine13);
  setText(P4("f4_22[0]"), data.dwLine14);
  setText(P4("f4_23[0]"), data.dwLine15);

  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  form.updateFieldAppearances(helveticaBold);

  // Step 5's signature/date have no AcroForm field on this PDF at all (see
  // header comment) — drawn directly onto the page instead, same dark-blue
  // bold convention every other filled-in value on this form uses.
  // Coordinates are read from the page's actual drawn rule lines (decoded
  // the content stream directly), not guessed from text positions: the
  // whole Sign Here row is a bordered box spanning y=78 to y=126, with a
  // mid-row divider at y=90 splitting it into the caption below
  // ("Employee's signature...", y=78-90) and the actual blank writing space
  // above (y=90 up to the "Under penalties of perjury..." line at y=116.3).
  // The signature's x also needed fixing — x=60 sat under the "Sign Here"
  // label column entirely (that column ends at x=93.9); the real signature
  // cell starts at x=100.5.
  const page1 = pdfDoc.getPage(0);
  const dateStr = fmtDate(data.dateSigned);
  if (dateStr) {
    page1.drawText(dateStr, { x: 465, y: 93, size: 9, font: helveticaBold, color: rgb(0, 0, 0.545) });
  }
  if (signaturePngBytes) {
    const png = await pdfDoc.embedPng(signaturePngBytes);
    const maxW = 340;
    const maxH = 20;
    const scale = Math.min(maxW / png.width, maxH / png.height, 1);
    page1.drawImage(png, { x: 100, y: 93, width: png.width * scale, height: png.height * scale });
  }

  // Locking every field is safe now regardless of whether the employer box
  // is filled yet — HR never edits this generated PDF directly (see header
  // comment), so there's no more "must stay editable for later" case.
  for (const field of form.getFields()) {
    field.enableReadOnly();
  }

  return pdfDoc.save();
}
