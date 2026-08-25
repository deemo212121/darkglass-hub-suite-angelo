/**
 * Fills the REAL "Company Vehicle Use Agreement" PDF
 * (src/assets/COMPANY VEHICLE USE AGREEMENT.pdf) — like
 * carIqAgreementPdfFill.ts, this PDF has NO AcroForm fields at all
 * (confirmed by direct inspection), just plain static text (21 numbered
 * guidelines, labels, blank underscore lines, and 26 "[ ] BRANCH"
 * checkboxes spread across two pages). Every value is drawn directly onto
 * the page at coordinates precisely calibrated against the real blank
 * positions: pdf.js reports each text item's exact rendered width, and the
 * merged "First Name: ___ Last Name: ___" text run is split into its two
 * individual blank positions using the per-underscore glyph width measured
 * off Parts Responsibility's isolated underscore runs (~5.974pt/underscore
 * — this PDF is generated from the same template family), rather than
 * drawing the full name over the label itself.
 *
 * The selected branch is printed next to the "Branch:" label on page 2
 * rather than checking one of the source PDF's own 26 checkboxes — see
 * vehicleAgreementFormTemplate.ts's header comment for why (uniform
 * handling for every branch, including San Antonio, which has no matching
 * checkbox on the source PDF at all). Since none of those checkboxes are
 * ever checked, the checklist (everything below "Branch:" on page 2, plus
 * the top of what was page 3 above the signature line) is whited out — and
 * with it gone, page 3 has nothing left but the signature line and page 4
 * is completely blank on its own. Rather than ship a form with two
 * near/fully-blank trailing pages, "Employee Signature:" is redrawn into
 * the freed-up space on page 2 and pages 3–4 are dropped, same treatment
 * as carIqAgreementPdfFill.ts / ptoAckPdfFill.ts.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { VehicleAgreementFormData } from "./vehicleAgreementFormTemplate";
import { addLogoHeader } from "./pdfLogoHeader";
import { dateBlankPositions, fmtDateParts } from "./pdfDateBlankSplit";

/** x position of each of the three date blanks on the "Date:" line (page 2, y=193.03) — see pdfDateBlankSplit.ts; the label starts at x=101.57. */
const VEHICLE_AGREEMENT_DATE_X = dateBlankPositions(101.57);

/** Where the redrawn "Employee Signature:" label sits on page 2, and where the signature image gets drawn beside it — exported so the fill pages' overlay rect can match exactly. */
export const VEHICLE_AGREEMENT_SIGNATURE_LABEL_Y = 130;
export const VEHICLE_AGREEMENT_SIGNATURE_DRAW = { x: 180, y: 129, maxW: 300, maxH: 20 } as const;

/** Returns the source PDF's bytes with the unused branch checklist whited out (page 2, below "Branch:") and pages 3–4 dropped entirely — with the checklist gone, page 3 held nothing but the signature line (page 4 was already blank), which is redrawn here into the freed-up space on page 2 instead. Applied here, not just in fillVehicleAgreementPdf, so the interactive fill pages (which render these same blank bytes straight to canvas via pdf.js) show the same layout. */
export async function loadBlankVehicleAgreementBytes(): Promise<Uint8Array> {
  const mod = await import("@/assets/COMPANY VEHICLE USE AGREEMENT.pdf");
  const res = await fetch(mod.default);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const pdfDoc = await PDFDocument.load(bytes);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page2 = pdfDoc.getPage(1);
  page2.drawRectangle({ x: 0, y: 0, width: 612, height: 160, color: rgb(1, 1, 1) });
  page2.drawText("Employee Signature:", { x: 72.024, y: VEHICLE_AGREEMENT_SIGNATURE_LABEL_Y, size: 10, font: boldFont, color: rgb(0, 0, 0) });
  page2.drawText("__________________________________________________", { x: 177.19, y: VEHICLE_AGREEMENT_SIGNATURE_LABEL_Y, size: 10, font: boldFont, color: rgb(0, 0, 0) });
  pdfDoc.removePage(3);
  pdfDoc.removePage(2);
  await addLogoHeader(pdfDoc);
  return pdfDoc.save();
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
  draw(page2, data.firstName, 135.3, 218);
  draw(page2, data.lastName, 297.1, 218);
  const dateParts = fmtDateParts(data.dateSigned);
  draw(page2, dateParts.mm, VEHICLE_AGREEMENT_DATE_X.mm, 196, 9);
  draw(page2, dateParts.dd, VEHICLE_AGREEMENT_DATE_X.dd, 196, 9);
  draw(page2, dateParts.yyyy, VEHICLE_AGREEMENT_DATE_X.yyyy, 196, 9);
  draw(page2, data.branch, 116, 171);

  if (signatureBytes) {
    const png = await pdfDoc.embedPng(signatureBytes);
    const { x, y, maxW, maxH } = VEHICLE_AGREEMENT_SIGNATURE_DRAW;
    const scale = Math.min(maxW / png.width, maxH / png.height, 1);
    page2.drawImage(png, { x, y, width: png.width * scale, height: png.height * scale });
  }

  return pdfDoc.save();
}
