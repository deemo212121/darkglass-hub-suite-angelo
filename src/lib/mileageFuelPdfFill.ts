/**
 * Fills the REAL "Personal Vehicle Mileage and Fuel Policy Agreement" PDF
 * (src/assets/PERSONAL VEHICLE MILEAGE AND FUEL POLICY AGREEMENT.pdf) —
 * like partsResponsibilityPdfFill.ts, this PDF has NO AcroForm fields at
 * all (confirmed by direct inspection), just plain static text (policy
 * body, labels, and blank underscore lines). Every value is drawn
 * directly onto the page at coordinates precisely calibrated against the
 * real blank positions: pdf.js reports each text item's exact rendered
 * width, and the merged "First Name: ___ Middle Name: ___ Last" / "Name:
 * ___" text run is split into its three individual blank positions using
 * the same per-underscore glyph width measured off Parts Responsibility's
 * isolated underscore runs (~5.974pt/underscore — this PDF is generated
 * from the same template, confirmed by its near-identical measured total
 * widths), rather than a rough per-character estimate.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { MileageFuelFormData } from "./mileageFuelFormTemplate";
import { addLogoHeader } from "./pdfLogoHeader";
import { dateBlankPositions, fmtDateParts } from "./pdfDateBlankSplit";

/** x position of each of the three date blanks on the two "Date:" lines (employee page1 y=93.17, employer page2 y=670.54) — see pdfDateBlankSplit.ts; both labels start at x=101.57. */
const MILEAGE_FUEL_DATE_X = dateBlankPositions(101.57);

/** Stamps the company logo into the header of every page — see pdfLogoHeader.ts. Applied here, not just in fillMileageFuelPdf, so the interactive fill page (which renders these same blank bytes straight to canvas via pdf.js) shows it too. */
export async function loadBlankMileageFuelBytes(): Promise<Uint8Array> {
  const mod = await import("@/assets/PERSONAL VEHICLE MILEAGE AND FUEL POLICY AGREEMENT.pdf");
  const res = await fetch(mod.default);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const pdfDoc = await PDFDocument.load(bytes);
  await addLogoHeader(pdfDoc);
  return pdfDoc.save();
}

export async function fillMileageFuelPdf(
  data: MileageFuelFormData,
  employeeSigBytes?: Uint8Array,
  employerSigBytes?: Uint8Array
): Promise<Uint8Array> {
  const blankBytes = await loadBlankMileageFuelBytes();
  const pdfDoc = await PDFDocument.load(blankBytes);
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page1 = pdfDoc.getPage(0);
  const draw1 = (text: string, x: number, y: number, size = 10) => {
    if (!text) return;
    page1.drawText(text, { x, y, size, font, color: rgb(0, 0, 0.545) });
  };
  draw1(data.firstName, 223, 670.5);
  draw1(data.middleName, 396, 670.5);
  draw1(data.lastName, 110, 653.5);
  draw1(data.branch, 116, 628.5);

  if (employeeSigBytes) {
    const png = await pdfDoc.embedPng(employeeSigBytes);
    const maxW = 280, maxH = 20;
    page1.drawImage(png, { x: 180, y: 118.1, width: maxW, height: maxH });
  }
  const employeeDateParts = fmtDateParts(data.employeeDateSigned);
  draw1(employeeDateParts.mm, MILEAGE_FUEL_DATE_X.mm, 93.2, 9);
  draw1(employeeDateParts.dd, MILEAGE_FUEL_DATE_X.dd, 93.2, 9);
  draw1(employeeDateParts.yyyy, MILEAGE_FUEL_DATE_X.yyyy, 93.2, 9);

  const page2 = pdfDoc.getPage(1);
  const draw2 = (text: string, x: number, y: number, size = 10) => {
    if (!text) return;
    page2.drawText(text, { x, y, size, font, color: rgb(0, 0, 0.545) });
  };
  if (employerSigBytes) {
    const png = await pdfDoc.embedPng(employerSigBytes);
    const maxW = 215, maxH = 20;
    page2.drawImage(png, { x: 256, y: 695.5, width: maxW, height: maxH });
  }
  const employerDateParts = fmtDateParts(data.employerDateSigned);
  draw2(employerDateParts.mm, MILEAGE_FUEL_DATE_X.mm, 670.5, 9);
  draw2(employerDateParts.dd, MILEAGE_FUEL_DATE_X.dd, 670.5, 9);
  draw2(employerDateParts.yyyy, MILEAGE_FUEL_DATE_X.yyyy, 670.5, 9);

  return pdfDoc.save();
}
