/**
 * Fills the REAL "Substance Screening & Conduct Agreement" PDF
 * (src/assets/SUBSTANCE SCREENING & CONDUCT AGREEMENT.pdf) — like
 * employeeConfidentialityPdfFill.ts, this PDF has NO AcroForm fields at all
 * (confirmed by direct inspection), just plain static text (the agreement
 * body, labels, and blank underscore lines). Every value is drawn directly
 * onto the page at coordinates extracted from the actual label positions
 * (via pdf.js's text-position API).
 *
 * "Company Name:" on page 1 is drawn as fixed static text ("US IN HOME
 * SERVICES"), same convention as ptoAckPdfFill.ts's "Employer:" line —
 * this app is single-company, so there's nothing to ask the recipient.
 *
 * The employee's printed name is already captured by the "Employee Name:"
 * field at the top of page 1, so — same convention as Car IQ/Vehicle
 * Agreement/Employee Confidentiality — only the signature image is drawn
 * onto the bottom "Employee Printed Name & Signature" blank, not a second
 * copy of the typed name. The "Company Representative Signature" line
 * right below it is intentionally left untouched; it's filled by hand
 * later, outside this app.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { SubstanceScreeningFormData } from "./substanceScreeningFormTemplate";
import { addLogoHeader } from "./pdfLogoHeader";

const fmtDate = (v: string) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
};

/** Stamps the company logo and the fixed "Company Name" value into the header of every page — see pdfLogoHeader.ts. Applied here, not just in fillSubstanceScreeningPdf, so the interactive fill page (which renders these same blank bytes straight to canvas via pdf.js) shows both too. */
export async function loadBlankSubstanceScreeningBytes(): Promise<Uint8Array> {
  const mod = await import("@/assets/SUBSTANCE SCREENING & CONDUCT AGREEMENT.pdf");
  const res = await fetch(mod.default);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const pdfDoc = await PDFDocument.load(bytes);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page1 = pdfDoc.getPage(0);
  // The source PDF's own underscore blank for the date (x=72.02 y=626.86
  // w=138.50) sits on its own orphaned row between "Employee Name:" and
  // "Company Name:" — now that the date itself is drawn next to the
  // "Date:" label instead (see fillSubstanceScreeningPdf below), this line
  // has nothing pointing to it and just reads as a stray blank. Whited out
  // here so it never renders, same technique as
  // employeeConfidentialityPdfFill.ts's BRANCH_PLACEHOLDER_COVER.
  page1.drawRectangle({ x: 70, y: 623, width: 150, height: 10, color: rgb(1, 1, 1) });
  page1.drawText("US IN HOME SERVICES", { x: 168, y: 617, size: 10, font: boldFont, color: rgb(0, 0, 0) });
  await addLogoHeader(pdfDoc);
  return pdfDoc.save();
}

export async function fillSubstanceScreeningPdf(
  data: SubstanceScreeningFormData,
  signatureBytes?: Uint8Array
): Promise<Uint8Array> {
  const blankBytes = await loadBlankSubstanceScreeningBytes();
  const pdfDoc = await PDFDocument.load(blankBytes);
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const draw = (page: ReturnType<typeof pdfDoc.getPage>, text: string, x: number, y: number, size = 10) => {
    if (!text) return;
    page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0.545) });
  };

  const page1 = pdfDoc.getPage(0);
  const dateText = fmtDate(data.dateSigned);
  draw(page1, data.employeeName, 168, 642);
  // The source PDF's own underscore blank for this date wraps down to the
  // line below "Employee Name:" (confirmed via pdf.js text-item
  // coordinates) — a real artifact of the original document, but it reads
  // as "wrong" to anyone looking at the filled form since the value ends
  // up nowhere near the "Date:" label. Drawn here instead, directly after
  // the label on the same row (x=389.35 + label width 28.85 ≈ 418, with
  // ~122pt of clearance to the right margin before the page edge).
  draw(page1, dateText, 422, 642, 9);

  const page2 = pdfDoc.getPage(1);
  draw(page2, dateText, 360, 491, 9);
  if (signatureBytes) {
    const png = await pdfDoc.embedPng(signatureBytes);
    const maxW = 210, maxH = 20;
    page2.drawImage(png, { x: 80, y: 490, width: maxW, height: maxH });
  }

  return pdfDoc.save();
}
