/**
 * Fills the REAL "Employee Meal and Rest Break Policy Acknowledgment" PDF
 * (src/assets/EMPLOYEE MEAL AND REST BREAK POLICY ACKNOWLEDGMENT.pdf) —
 * like wageAckPdfFill.ts, this PDF has NO AcroForm fields at all (confirmed
 * by direct inspection), just plain static text (policy body, labels, and
 * blank underscore lines). Every value is drawn directly onto the page at
 * coordinates extracted from the actual label positions (via pdf.js's
 * text-position API). Single page — both the employee and employer
 * signature lines live on the same page here, unlike Wage Ack's two pages.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { MealRestBreakFormData } from "./mealRestBreakFormTemplate";

const fmtDate = (v: string) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm} / ${dd} / ${d.getFullYear()}`;
};

export async function loadBlankMealRestBreakBytes(): Promise<Uint8Array> {
  const mod = await import("@/assets/EMPLOYEE MEAL AND REST BREAK POLICY ACKNOWLEDGMENT.pdf");
  const res = await fetch(mod.default);
  return new Uint8Array(await res.arrayBuffer());
}

export async function fillMealRestBreakPdf(
  data: MealRestBreakFormData,
  employeeSigBytes?: Uint8Array,
  employerSigBytes?: Uint8Array
): Promise<Uint8Array> {
  const blankBytes = await loadBlankMealRestBreakBytes();
  const pdfDoc = await PDFDocument.load(blankBytes);
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const draw = (text: string, x: number, y: number, size = 10) => {
    if (!text) return;
    page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0.545) });
  };

  const page = pdfDoc.getPage(0);
  draw(data.firstName, 221, 671);
  draw(data.middleName, 393, 671);
  draw(data.lastName, 103, 653);
  draw(data.branch, 116, 632);

  if (employeeSigBytes) {
    const png = await pdfDoc.embedPng(employeeSigBytes);
    const maxW = 255, maxH = 20;
    const scale = Math.min(maxW / png.width, maxH / png.height, 1);
    page.drawImage(png, { x: 177, y: 267, width: png.width * scale, height: png.height * scale });
  }
  draw(fmtDate(data.employeeDateSigned), 102, 246, 9);

  if (employerSigBytes) {
    const png = await pdfDoc.embedPng(employerSigBytes);
    const maxW = 195, maxH = 20;
    const scale = Math.min(maxW / png.width, maxH / png.height, 1);
    page.drawImage(png, { x: 253, y: 217, width: png.width * scale, height: png.height * scale });
  }
  draw(fmtDate(data.employerDateSigned), 102, 196, 9);

  return pdfDoc.save();
}
