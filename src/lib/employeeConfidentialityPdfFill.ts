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

const fmtDate = (v: string) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
};

export async function loadBlankEmployeeConfidentialityBytes(): Promise<Uint8Array> {
  const mod = await import("@/assets/EMPLOYEE CONFIDENTIALITY AND NON (1).pdf");
  const res = await fetch(mod.default);
  return new Uint8Array(await res.arrayBuffer());
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
    page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0.545) });
  };

  const page1 = pdfDoc.getPage(0);
  const dateText = fmtDate(data.dateSigned);
  draw(page1, dateText, 330, 649, 9);
  draw(page1, data.employeeName, 218, 532);
  draw(page1, data.address, 204, 507);
  draw(page1, data.city, 178, 482, 9);
  draw(page1, data.state, 316, 482, 9);
  draw(page1, data.zip, 406, 482, 9);
  draw(page1, data.branch, 196, 457);

  const page2 = pdfDoc.getPage(1);
  draw(page2, dateText, 105, 305, 9);
  if (signatureBytes) {
    const png = await pdfDoc.embedPng(signatureBytes);
    const maxW = 270, maxH = 20;
    const scale = Math.min(maxW / png.width, maxH / png.height, 1);
    page2.drawImage(png, { x: 180, y: 323, width: png.width * scale, height: png.height * scale });
  }

  return pdfDoc.save();
}
