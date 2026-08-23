/**
 * Fills the REAL "Employee Mobile App Location Sharing Consent Agreement"
 * PDF (src/assets/EMPLOYEE MOBILE APP LOCATION SHARING CONSENT
 * AGREEMENT.pdf) — like wageAckPdfFill.ts, this PDF has NO AcroForm fields
 * at all (confirmed by direct inspection), just plain underscore-blank
 * lines drawn as static text. Every value is drawn directly onto the page
 * at coordinates extracted from the actual blank-line/label text positions
 * (via pdf.js's text-position API).
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { LocationConsentFormData } from "./locationConsentFormTemplate";
import { addLogoHeader } from "./pdfLogoHeader";

const fmtDate = (v: string) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
};

/** Stamps the company logo into the header of every page — see pdfLogoHeader.ts. Applied here, not just in fillLocationConsentPdf, so the interactive fill page (which renders these same blank bytes straight to canvas via pdf.js) shows it too. */
export async function loadBlankLocationConsentBytes(): Promise<Uint8Array> {
  const mod = await import("@/assets/EMPLOYEE MOBILE APP LOCATION SHARING CONSENT AGREEMENT.pdf");
  const res = await fetch(mod.default);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const pdfDoc = await PDFDocument.load(bytes);
  await addLogoHeader(pdfDoc);
  return pdfDoc.save();
}

export async function fillLocationConsentPdf(
  data: LocationConsentFormData,
  employeeSigBytes?: Uint8Array,
  employerSigBytes?: Uint8Array
): Promise<Uint8Array> {
  const blankBytes = await loadBlankLocationConsentBytes();
  const pdfDoc = await PDFDocument.load(blankBytes);
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page1 = pdfDoc.getPage(0);
  const draw1 = (text: string, x: number, y: number, size = 10) => {
    if (!text) return;
    page1.drawText(text, { x, y, size, font, color: rgb(0, 0, 0.545) });
  };
  draw1(data.employeeName, 162.4, 670.5);
  draw1(data.positionTitle, 153.8, 645.5);
  draw1(fmtDate(data.effectiveDate), 149.4, 620.6);

  const page2 = pdfDoc.getPage(1);
  const draw2 = (text: string, x: number, y: number, size = 10) => {
    if (!text) return;
    page2.drawText(text, { x, y, size, font, color: rgb(0, 0, 0.545) });
  };
  if (employeeSigBytes) {
    const png = await pdfDoc.embedPng(employeeSigBytes);
    const maxW = 195, maxH = 20;
    const scale = Math.min(maxW / png.width, maxH / png.height, 1);
    page2.drawImage(png, { x: 180, y: 698, width: png.width * scale, height: png.height * scale });
  }
  draw2(fmtDate(data.employeeDateSigned), 415.5, 698.5, 9);

  if (employerSigBytes) {
    const png = await pdfDoc.embedPng(employerSigBytes);
    const maxW = 125, maxH = 20;
    const scale = Math.min(maxW / png.width, maxH / png.height, 1);
    page2.drawImage(png, { x: 256, y: 673, width: png.width * scale, height: png.height * scale });
  }
  draw2(fmtDate(data.employerDateSigned), 419.8, 673.5, 9);

  return pdfDoc.save();
}
