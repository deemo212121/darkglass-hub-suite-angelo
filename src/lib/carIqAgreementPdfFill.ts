/**
 * Fills the REAL "Car IQ Technician Agreement Form" PDF
 * (src/assets/Car IQ Technician Agreement Form.pdf) — like
 * wageAckPdfFill.ts, this PDF has NO AcroForm fields at all (confirmed by
 * direct inspection), just plain static text (labels, blank underscore
 * lines, and 26 "[ ] BRANCH" checkboxes spread across two pages). Every
 * value is drawn directly onto the page at coordinates extracted from the
 * actual label positions (via pdf.js's text-position API).
 *
 * The selected branch is printed next to the "Branch:" label at the top of
 * page 1 rather than checking one of the source PDF's own 26 checkboxes —
 * see carIqAgreementFormTemplate.ts's header comment for why (uniform
 * handling for every branch, including San Antonio, which has no matching
 * checkbox on the source PDF at all).
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { CarIqAgreementFormData } from "./carIqAgreementFormTemplate";

const fmtDate = (v: string) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
};

export async function loadBlankCarIqAgreementBytes(): Promise<Uint8Array> {
  const mod = await import("@/assets/Car IQ Technician Agreement Form.pdf");
  const res = await fetch(mod.default);
  return new Uint8Array(await res.arrayBuffer());
}

export async function fillCarIqAgreementPdf(data: CarIqAgreementFormData, signatureBytes?: Uint8Array): Promise<Uint8Array> {
  const blankBytes = await loadBlankCarIqAgreementBytes();
  const pdfDoc = await PDFDocument.load(blankBytes);
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const draw = (page: ReturnType<typeof pdfDoc.getPage>, text: string, x: number, y: number, size = 10) => {
    if (!text) return;
    page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0.545) });
  };

  const page1 = pdfDoc.getPage(0);
  draw(page1, data.employeeName, 76, 314);
  draw(page1, data.branch, 118, 264);
  draw(page1, fmtDate(data.dateSigned), 145, 289, 9);
  if (data.agreed) draw(page1, "X", 115, 362, 10);

  const page2 = pdfDoc.getPage(1);
  if (signatureBytes) {
    const png = await pdfDoc.embedPng(signatureBytes);
    const maxW = 280, maxH = 20;
    const scale = Math.min(maxW / png.width, maxH / png.height, 1);
    page2.drawImage(png, { x: 180, y: 193, width: png.width * scale, height: png.height * scale });
  }

  return pdfDoc.save();
}
