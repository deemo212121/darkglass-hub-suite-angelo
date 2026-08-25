/**
 * Fills the REAL "Parts Responsibility and Technician Floor Protection
 * Acknowledgment Form" PDF
 * (src/assets/Parts Responsibility and Technician Floor Protection Acknowledgment Form.pdf)
 * — like mealRestBreakPdfFill.ts, this PDF has NO AcroForm fields at all
 * (confirmed by direct inspection), just plain static text (policy body,
 * labels, and blank underscore lines). Every value is drawn directly onto
 * the page at coordinates precisely calibrated against the real blank
 * positions: pdf.js reports each text item's exact rendered width, and the
 * per-underscore glyph width was measured directly off several isolated
 * underscore-only runs elsewhere on this same PDF (~5.974pt/underscore,
 * consistent across all three measured runs) — that measured width is
 * then used to split the two merged "First Name: ___ Middle Name: ___
 * Last" / "Name: ___" text runs into their three individual blank
 * positions precisely, rather than a rough per-character estimate.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PartsResponsibilityFormData } from "./partsResponsibilityFormTemplate";
import { addLogoHeader } from "./pdfLogoHeader";
import { dateBlankPositions, fmtDateParts } from "./pdfDateBlankSplit";

/** x position of each of the three date blanks on page 2's two "Date:" lines (technician y=653.62, manager y=519.79) — see pdfDateBlankSplit.ts; both labels start at x=101.54. */
const PARTS_RESP_DATE_X = dateBlankPositions(101.54);

/** Stamps the company logo into the header of every page — see pdfLogoHeader.ts. Applied here, not just in fillPartsResponsibilityPdf, so the interactive fill page (which renders these same blank bytes straight to canvas via pdf.js) shows it too. */
export async function loadBlankPartsResponsibilityBytes(): Promise<Uint8Array> {
  const mod = await import("@/assets/Parts Responsibility and Technician Floor Protection Acknowledgment Form.pdf");
  const res = await fetch(mod.default);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const pdfDoc = await PDFDocument.load(bytes);
  await addLogoHeader(pdfDoc);
  return pdfDoc.save();
}

export async function fillPartsResponsibilityPdf(
  data: PartsResponsibilityFormData,
  technicianSigBytes?: Uint8Array,
  managerSigBytes?: Uint8Array
): Promise<Uint8Array> {
  const blankBytes = await loadBlankPartsResponsibilityBytes();
  const pdfDoc = await PDFDocument.load(blankBytes);
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page1 = pdfDoc.getPage(0);
  const draw1 = (text: string, x: number, y: number, size = 10) => {
    if (!text) return;
    page1.drawText(text, { x, y, size, font, color: rgb(0, 0, 0.545) });
  };
  draw1(data.firstName, 223, 645.6);
  draw1(data.middleName, 396, 645.6);
  draw1(data.lastName, 110, 628.7);
  draw1(data.branch, 237, 603.7);

  const page2 = pdfDoc.getPage(1);
  const draw2 = (text: string, x: number, y: number, size = 10) => {
    if (!text) return;
    page2.drawText(text, { x, y, size, font, color: rgb(0, 0, 0.545) });
  };
  const technicianDateParts = fmtDateParts(data.technicianDateSigned);
  draw2(technicianDateParts.mm, PARTS_RESP_DATE_X.mm, 653.6, 9);
  draw2(technicianDateParts.dd, PARTS_RESP_DATE_X.dd, 653.6, 9);
  draw2(technicianDateParts.yyyy, PARTS_RESP_DATE_X.yyyy, 653.6, 9);
  draw2(data.employeeName, 212, 628.7);

  if (technicianSigBytes) {
    const png = await pdfDoc.embedPng(technicianSigBytes);
    const maxW = 280, maxH = 20;
    const scale = Math.min(maxW / png.width, maxH / png.height, 1);
    page2.drawImage(png, { x: 191, y: 603.7, width: png.width * scale, height: png.height * scale });
  }

  if (managerSigBytes) {
    const png = await pdfDoc.embedPng(managerSigBytes);
    const maxW = 260, maxH = 20;
    const scale = Math.min(maxW / png.width, maxH / png.height, 1);
    page2.drawImage(png, { x: 234, y: 561.7, width: png.width * scale, height: png.height * scale });
  }
  const managerDateParts = fmtDateParts(data.managerDateSigned);
  draw2(managerDateParts.mm, PARTS_RESP_DATE_X.mm, 519.8, 9);
  draw2(managerDateParts.dd, PARTS_RESP_DATE_X.dd, 519.8, 9);
  draw2(managerDateParts.yyyy, PARTS_RESP_DATE_X.yyyy, 519.8, 9);

  return pdfDoc.save();
}
