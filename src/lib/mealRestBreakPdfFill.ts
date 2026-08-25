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
import { addLogoHeader } from "./pdfLogoHeader";
import { dateBlankPositions, fmtDateParts } from "./pdfDateBlankSplit";

/** x position of each of the three date blanks on the two "Date:" lines (employee y=242.95, employer y=193.03) — see pdfDateBlankSplit.ts; both labels start at x=101.57. */
const MEAL_REST_BREAK_DATE_X = dateBlankPositions(101.57);

/** Stamps the company logo into the header of every page — see pdfLogoHeader.ts. Applied here, not just in fillMealRestBreakPdf, so the interactive fill page (which renders these same blank bytes straight to canvas via pdf.js) shows it too. */
export async function loadBlankMealRestBreakBytes(): Promise<Uint8Array> {
  const mod = await import("@/assets/EMPLOYEE MEAL AND REST BREAK POLICY ACKNOWLEDGMENT.pdf");
  const res = await fetch(mod.default);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const pdfDoc = await PDFDocument.load(bytes);
  await addLogoHeader(pdfDoc);
  return pdfDoc.save();
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
    page.drawImage(png, { x: 177, y: 267, width: maxW, height: maxH });
  }
  const employeeDateParts = fmtDateParts(data.employeeDateSigned);
  draw(employeeDateParts.mm, MEAL_REST_BREAK_DATE_X.mm, 246, 9);
  draw(employeeDateParts.dd, MEAL_REST_BREAK_DATE_X.dd, 246, 9);
  draw(employeeDateParts.yyyy, MEAL_REST_BREAK_DATE_X.yyyy, 246, 9);

  if (employerSigBytes) {
    const png = await pdfDoc.embedPng(employerSigBytes);
    const maxW = 195, maxH = 20;
    page.drawImage(png, { x: 253, y: 217, width: maxW, height: maxH });
  }
  const employerDateParts = fmtDateParts(data.employerDateSigned);
  draw(employerDateParts.mm, MEAL_REST_BREAK_DATE_X.mm, 196, 9);
  draw(employerDateParts.dd, MEAL_REST_BREAK_DATE_X.dd, 196, 9);
  draw(employerDateParts.yyyy, MEAL_REST_BREAK_DATE_X.yyyy, 196, 9);

  return pdfDoc.save();
}
