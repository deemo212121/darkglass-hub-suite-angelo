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
 * checkbox on the source PDF at all). Since none of those checkboxes are
 * ever checked, the checklist (everything below "Branch:" on page 1) is
 * whited out, and with it gone page 2 has nothing left above the signature
 * block — rather than ship a form with a mostly-blank second page, the
 * "Employee Signature:"/"Date:"/"Employer:" block is redrawn into the
 * freed-up space on page 1 and page 2 is dropped, same treatment as
 * carIqAgreementPdfFill.ts.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PtoAckFormData } from "./ptoAckFormTemplate";
import { addLogoHeader } from "./pdfLogoHeader";

const fmtDate = (v: string) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm} / ${dd} / ${d.getFullYear()}`;
};

/** Where the redrawn signature/date/employer block sits on page 1 — exported so the fill pages' overlay rects can match exactly. */
export const PTO_ACK_SIGNATURE_DRAW = { x: 177, y: 245, maxW: 285, maxH: 20 } as const;
export const PTO_ACK_DATE_SIGNED_DRAW = { x: 102, y: 220 } as const;

/** Returns the source PDF's bytes with the unused branch checklist whited out (page 1, below "Branch:") and page 2 dropped entirely — with the checklist gone, page 2 held nothing but the signature/date/employer block, which is redrawn here into the freed-up space on page 1 instead. Applied here, not just in fillPtoAckPdf, so the interactive fill pages (which render these same blank bytes straight to canvas via pdf.js) show the same single-page layout. */
export async function loadBlankPtoAckBytes(): Promise<Uint8Array> {
  const mod = await import("@/assets/EMPLOYEE PAID TIME OFF.pdf");
  const res = await fetch(mod.default);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const pdfDoc = await PDFDocument.load(bytes);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page1 = pdfDoc.getPage(0);
  page1.drawRectangle({ x: 0, y: 0, width: 612, height: 280, color: rgb(1, 1, 1) });
  const drawStatic = (text: string, x: number, y: number) => page1.drawText(text, { x, y, size: 10, font: boldFont, color: rgb(0, 0, 0) });
  drawStatic("Employee Signature:", 72.024, 248);
  drawStatic("__________________________________________________", 177.19, 248);
  drawStatic("(Signature)", 478.73, 248);
  drawStatic("Date:", 72.024, 223);
  drawStatic("_____ / _____ / __________ (MM/DD/YYYY)", 101.57, 223);
  drawStatic("Employer:", 72.024, 198);
  drawStatic("US IN HOME SERVICES", 125.33, 198);
  pdfDoc.removePage(1);
  await addLogoHeader(pdfDoc);
  return pdfDoc.save();
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

  if (signatureBytes) {
    const png = await pdfDoc.embedPng(signatureBytes);
    const { x, y, maxW, maxH } = PTO_ACK_SIGNATURE_DRAW;
    const scale = Math.min(maxW / png.width, maxH / png.height, 1);
    page1.drawImage(png, { x, y, width: png.width * scale, height: png.height * scale });
  }
  draw1(fmtDate(data.dateSigned), PTO_ACK_DATE_SIGNED_DRAW.x, PTO_ACK_DATE_SIGNED_DRAW.y, 9);

  return pdfDoc.save();
}
