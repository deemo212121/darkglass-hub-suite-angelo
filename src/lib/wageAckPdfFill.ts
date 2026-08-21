/**
 * Fills the REAL "Acknowledgment of Wage & Compensation Structure" PDF
 * (src/assets/Acknowledgment of Wage.pdf) — unlike every other automated
 * form in this app, this PDF has NO AcroForm fields at all (confirmed by
 * direct inspection), just plain underscore-blank lines drawn as static
 * text. Every value is instead drawn directly onto the page at coordinates
 * extracted from the actual blank-line/label text positions (via pdf.js's
 * text-position API) — the same technique already used for the
 * signature/date rows on W-4/W-8BEN/W-9/W-4R, just applied to the whole
 * document here since none of it has real fields.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { WageAckFormData } from "./wageAckFormTemplate";

const fmtDate = (v: string) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}-${d.getFullYear()}`;
};

export async function loadBlankWageAckBytes(): Promise<Uint8Array> {
  const mod = await import("@/assets/Acknowledgment of Wage.pdf");
  const res = await fetch(mod.default);
  return new Uint8Array(await res.arrayBuffer());
}

export async function fillWageAckPdf(data: WageAckFormData, employeeSigBytes?: Uint8Array, employerSigBytes?: Uint8Array): Promise<Uint8Array> {
  const blankBytes = await loadBlankWageAckBytes();
  const pdfDoc = await PDFDocument.load(blankBytes);
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const draw = (page: ReturnType<typeof pdfDoc.getPage>, text: string, x: number, y: number, size = 10) => {
    if (!text) return;
    page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0.545) });
  };

  const page1 = pdfDoc.getPage(0);
  draw(page1, data.employeeName, 164, 674);
  draw(page1, fmtDate(data.effectiveDate), 76, 656);

  const page2 = pdfDoc.getPage(1);
  if (employeeSigBytes) {
    const png = await pdfDoc.embedPng(employeeSigBytes);
    const maxW = 195, maxH = 13;
    const scale = Math.min(maxW / png.width, maxH / png.height, 1);
    page2.drawImage(png, { x: 180, y: 513, width: png.width * scale, height: png.height * scale });
  }
  draw(page2, fmtDate(data.employeeDateSigned), 415, 514, 9);

  if (employerSigBytes) {
    const png = await pdfDoc.embedPng(employerSigBytes);
    const maxW = 125, maxH = 13;
    const scale = Math.min(maxW / png.width, maxH / png.height, 1);
    page2.drawImage(png, { x: 258, y: 488, width: png.width * scale, height: png.height * scale });
  }
  draw(page2, fmtDate(data.employerDateSigned), 422, 489, 9);

  return pdfDoc.save();
}
