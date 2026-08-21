/**
 * Fills the REAL "Company Vehicle Use Agreement" PDF
 * (src/assets/COMPANY VEHICLE USE AGREEMENT.pdf) — like
 * carIqAgreementPdfFill.ts, this PDF has NO AcroForm fields at all
 * (confirmed by direct inspection), just plain static text (21 numbered
 * guidelines, labels, blank underscore lines, and 26 "[ ] BRANCH"
 * checkboxes spread across two pages). Every value is drawn directly onto
 * the page at coordinates extracted from the actual label positions (via
 * pdf.js's text-position API).
 *
 * The selected branch is printed next to the "Branch:" label on page 2
 * rather than checking one of the source PDF's own 26 checkboxes — see
 * vehicleAgreementFormTemplate.ts's header comment for why (uniform
 * handling for every branch, including San Antonio, which has no matching
 * checkbox on the source PDF at all).
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { VehicleAgreementFormData } from "./vehicleAgreementFormTemplate";

const fmtDate = (v: string) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
};

export async function loadBlankVehicleAgreementBytes(): Promise<Uint8Array> {
  const mod = await import("@/assets/COMPANY VEHICLE USE AGREEMENT.pdf");
  const res = await fetch(mod.default);
  return new Uint8Array(await res.arrayBuffer());
}

export async function fillVehicleAgreementPdf(data: VehicleAgreementFormData, signatureBytes?: Uint8Array): Promise<Uint8Array> {
  const blankBytes = await loadBlankVehicleAgreementBytes();
  const pdfDoc = await PDFDocument.load(blankBytes);
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const draw = (page: ReturnType<typeof pdfDoc.getPage>, text: string, x: number, y: number, size = 10) => {
    if (!text) return;
    page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0.545) });
  };

  const page2 = pdfDoc.getPage(1);
  draw(page2, data.employeeName, 76, 221);
  draw(page2, fmtDate(data.dateSigned), 105, 196, 9);
  draw(page2, data.branch, 116, 171);

  const page3 = pdfDoc.getPage(2);
  if (signatureBytes) {
    const png = await pdfDoc.embedPng(signatureBytes);
    const maxW = 300, maxH = 20;
    const scale = Math.min(maxW / png.width, maxH / png.height, 1);
    page3.drawImage(png, { x: 180, y: 95, width: png.width * scale, height: png.height * scale });
  }

  return pdfDoc.save();
}
