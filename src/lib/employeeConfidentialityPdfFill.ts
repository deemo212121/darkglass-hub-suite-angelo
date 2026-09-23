/**
 * Fills the REAL "Employee Confidentiality and Non-Disclosure Agreement"
 * PDF (src/assets/EMPLOYEE CONFIDENTIALITY AND NON (1).pdf) — like
 * vehicleAgreementPdfFill.ts / carIqAgreementPdfFill.ts, this PDF has NO
 * AcroForm fields at all (confirmed by direct inspection), just plain
 * static text (the agreement body, labels, and blank underscore lines).
 * Every value is drawn directly onto the page at coordinates extracted
 * from the actual label positions (via pdf.js's text-position API).
 *
 * The selected branch is printed next to the "Branch:" label on page 1
 * rather than relying on the source PDF's own parenthetical branch list —
 * see employeeConfidentialityFormTemplate.ts's header comment for why
 * (uniform handling for every branch, including San Antonio, which is
 * missing from that list entirely).
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { EmployeeConfidentialityFormData } from "./employeeConfidentialityFormTemplate";
import { sanitizeForFont } from "./pdfFillSanitize";
import { addLogoHeader } from "./pdfLogoHeader";

// The "Branch:" line ends with a bracketed placeholder — "[Please Select
// Branch from the list provided below]" — printed as literal static text
// right after the label, not a blank. Drawing the selected branch directly
// there would print on top of that placeholder text, so it's covered with
// a white rectangle first (leaving the "Branch:" label itself untouched).
// Coordinates re-measured against the real PDF text runs (pdf.js
// getTextContent(), calibrated with @napi-rs/canvas's Calibri metrics) —
// same measurement used to fix the live-fill overlay's coordinates in
// FillEmployeeConfidentialityPage.tsx/ExternalFillEmployeeConfidentialityPage.tsx;
// this file draws the final submitted PDF via a separate code path that
// still had the old, eyeballed numbers. Padded generously so the cover
// fully hides the bracketed text regardless of small font-metric error.
// pdf-lib's drawRectangle() takes `width`/`height`, not `w`/`h` — using the
// wrong keys here silently falls back to pdf-lib's own defaults (150x100)
// instead of this box's real size, painting a WAY oversized white rectangle
// that blanks out Full Name/Address/City/State/Zip above it too. This was
// the actual cause of the submitted PDF looking corrupted, not a
// coordinate or font issue.
const BRANCH_PLACEHOLDER_COVER = { x: 180, y: 448, width: 256, height: 24 };

const fmtDate = (v: string) => {
  if (!v) return "";
  // A date-only string ("2026-09-17") parses as UTC midnight; reading
  // .getMonth()/.getDate() back out in the browser's local timezone
  // (anything behind UTC, i.e. all of the US) rolls it back a day —
  // "9/17" printing as "9/16". Parsing the y/m/d parts directly into a
  // local Date avoids that. A full timestamp has no such ambiguity and is
  // left to the normal parse.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const d = dateOnly ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])) : new Date(v);
  if (isNaN(d.getTime())) return v;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
};

/** Stamps the company logo into the header of every page — see pdfLogoHeader.ts. Applied here, not just in fillEmployeeConfidentialityPdf, so the interactive fill page (which renders these same blank bytes straight to canvas via pdf.js) shows it too. */
export async function loadBlankEmployeeConfidentialityBytes(): Promise<Uint8Array> {
  const mod = await import("@/assets/EMPLOYEE CONFIDENTIALITY AND NON (1).pdf");
  const res = await fetch(mod.default);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const pdfDoc = await PDFDocument.load(bytes);
  await addLogoHeader(pdfDoc);
  return pdfDoc.save();
}

export async function fillEmployeeConfidentialityPdf(
  data: EmployeeConfidentialityFormData,
  signatureBytes?: Uint8Array
): Promise<Uint8Array> {
  const blankBytes = await loadBlankEmployeeConfidentialityBytes();
  const pdfDoc = await PDFDocument.load(blankBytes);
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const draw = (page: ReturnType<typeof pdfDoc.getPage>, text: string, x: number, y: number, size = 10) => {
    if (!text) return;
    page.drawText(sanitizeForFont(text, font), { x, y, size, font, color: rgb(0, 0, 0.545) });
  };

  const page1 = pdfDoc.getPage(0);
  const dateText = fmtDate(data.dateSigned);
  draw(page1, dateText, 327, 646, 9);
  draw(page1, data.employeeName, 200, 529);
  draw(page1, data.address, 190, 504);
  draw(page1, data.city, 170, 479, 9);
  draw(page1, data.state, 293, 479, 9);
  draw(page1, data.zip, 370, 479, 9);
  if (data.branch) {
    page1.drawRectangle({ ...BRANCH_PLACEHOLDER_COVER, color: rgb(1, 1, 1) });
    draw(page1, data.branch, 185, 454);
  }

  const page2 = pdfDoc.getPage(1);
  draw(page2, dateText, 105, 305, 9);
  if (signatureBytes) {
    const png = await pdfDoc.embedPng(signatureBytes);
    const maxW = 270, maxH = 20;
    page2.drawImage(png, { x: 180, y: 323, width: maxW, height: maxH });
  }

  return pdfDoc.save();
}