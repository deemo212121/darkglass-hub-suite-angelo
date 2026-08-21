/**
 * Fills the REAL "Employee Paid Time Off (PTO) and Sick Leave Policy"
 * acknowledgment PDF (src/assets/EMPLOYEE PAID TIME OFF.pdf) — like
 * mealRestBreakPdfFill.ts, this PDF has NO AcroForm fields at all
 * (confirmed by direct inspection), just plain static text (policy body,
 * labels, blank underscore lines, and 26 "[ ] BRANCH, ST" reference
 * checkboxes spread across two pages). Every value is drawn directly onto
 * the page at coordinates extracted from the actual label positions (via
 * pdf.js's text-position API).
 *
 * The selected branch is printed next to the "Branch: Please Select:"
 * label on page 1 rather than checking one of the source PDF's own 26
 * checkboxes — see ptoAckFormTemplate.ts's header comment for why (uniform
 * handling for every branch, including San Antonio, which has no matching
 * checkbox on the source PDF at all).
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PtoAckFormData } from "./ptoAckFormTemplate";

const fmtDate = (v: string) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm} / ${dd} / ${d.getFullYear()}`;
};

export async function loadBlankPtoAckBytes(): Promise<Uint8Array> {
  const mod = await import("@/assets/EMPLOYEE PAID TIME OFF.pdf");
  const res = await fetch(mod.default);
  return new Uint8Array(await res.arrayBuffer());
}

export async function fillPtoAckPdf(data: PtoAckFormData, signatureBytes?: Uint8Array): Promise<Uint8Array> {
  const blankBytes = await loadBlankPtoAckBytes();
  const pdfDoc = await PDFDocument.load(blankBytes);
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page1 = pdfDoc.getPage(0);
  const draw1 = (text: string, x: number, y: number, size = 10) => {
    if (!text) return;
    page1.drawText(text, { x, y, size, font, color: rgb(0, 0, 0.545) });
  };
  draw1(data.firstName, 221, 328);
  draw1(data.middleName, 393, 328);
  draw1(data.lastName, 103, 311);
  draw1(data.branch, 193, 286);

  const page2 = pdfDoc.getPage(1);
  const draw2 = (text: string, x: number, y: number, size = 10) => {
    if (!text) return;
    page2.drawText(text, { x, y, size, font, color: rgb(0, 0, 0.545) });
  };
  if (signatureBytes) {
    const png = await pdfDoc.embedPng(signatureBytes);
    const maxW = 285, maxH = 20;
    const scale = Math.min(maxW / png.width, maxH / png.height, 1);
    page2.drawImage(png, { x: 177, y: 246, width: png.width * scale, height: png.height * scale });
  }
  draw2(fmtDate(data.dateSigned), 102, 221, 9);

  return pdfDoc.save();
}
