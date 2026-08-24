/**
 * Fills the REAL "Car IQ Technician Agreement Form" PDF
 * (src/assets/Car IQ Technician Agreement Form.pdf) — like
 * wageAckPdfFill.ts, this PDF has NO AcroForm fields at all (confirmed by
 * direct inspection), just plain static text (labels, blank underscore
 * lines, and 26 "[ ] BRANCH" checkboxes spread across two pages). Every
 * value is drawn directly onto the page at coordinates precisely
 * calibrated against the real blank positions: pdf.js reports each text
 * item's exact rendered width, and the merged "First Name: ___ Last Name:
 * ___" text run is split into its two individual blank positions using
 * the per-underscore glyph width measured off Parts Responsibility's
 * isolated underscore runs (~5.974pt/underscore — this PDF is generated
 * from the same template family), rather than drawing the full name over
 * the label itself.
 *
 * The selected branch is printed next to the "Branch:" label at the top of
 * page 1 rather than checking one of the source PDF's own 26 checkboxes —
 * see carIqAgreementFormTemplate.ts's header comment for why (uniform
 * handling for every branch, including San Antonio, which has no matching
 * checkbox on the source PDF at all). Since none of those checkboxes are
 * ever checked, the "Please Select:" list is whited out entirely, and with
 * it gone page 2 has nothing left on it (it only ever held the rest of the
 * checklist plus the signature line) — rather than ship a form with a
 * mostly-blank second page, "Employee Signature:" is redrawn into the
 * freed-up space on page 1 (just below "Branch:") and page 2 is dropped.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { CarIqAgreementFormData } from "./carIqAgreementFormTemplate";
import { addLogoHeader } from "./pdfLogoHeader";
import { dateBlankPositions, fmtDateParts } from "./pdfDateBlankSplit";

/** x position of each of the three date blanks on the "Today's Date:" line (y=285.94) — see pdfDateBlankSplit.ts; the label starts at x=140.93. */
const CAR_IQ_DATE_X = dateBlankPositions(140.93);

/** Where the redrawn "Employee Signature:" label sits on page 1, and where the signature image gets drawn beside it — exported so the fill pages' overlay rect can match exactly. */
export const CAR_IQ_SIGNATURE_LABEL_Y = 225;
export const CAR_IQ_SIGNATURE_DRAW = { x: 180, y: 222, maxW: 280, maxH: 20 } as const;

/** Returns the source PDF's bytes with the unused "Please Select:" branch checklist whited out (coordinates measured directly off the source PDF's text items, well clear of the drawn fields on page 1, which are all above y=253) and page 2 dropped entirely — with the checklist gone, page 2 held nothing but the signature line, which is redrawn here into the freed-up space on page 1 instead. Applied here, not just in fillCarIqAgreementPdf, so the interactive fill pages (which render these same blank bytes straight to canvas via pdf.js) show the same single-page layout.
 *
 * The source PDF also has its own authoring artifact right after "I AGREE"
 * — instead of an actual checkbox glyph, the literal text "$\square$" is
 * baked into the page (confirmed by direct pdf.js text-item inspection: the
 * run "$\\square$" sits at x=113.81, y=360.84, size 12 — apparently a
 * LaTeX/math-editor checkbox symbol that got exported as its literal source
 * instead of rendering). Whited out and replaced with an actual empty
 * checkbox square at the same spot the fill pages' agreeCheckbox overlay
 * already targets ({ x: 112, y: 359, w: 12, h: 12 }), so the static PDF
 * looks right even before the interactive overlay/an "X" is drawn on it. */
export async function loadBlankCarIqAgreementBytes(): Promise<Uint8Array> {
  const mod = await import("@/assets/Car IQ Technician Agreement Form.pdf");
  const res = await fetch(mod.default);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const pdfDoc = await PDFDocument.load(bytes);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page1 = pdfDoc.getPage(0);
  page1.drawRectangle({ x: 0, y: 0, width: 612, height: 253, color: rgb(1, 1, 1) });
  page1.drawText("Employee Signature:", { x: 72.024, y: CAR_IQ_SIGNATURE_LABEL_Y, size: 12, font: boldFont, color: rgb(0, 0, 0) });
  page1.drawRectangle({ x: 108, y: 353, width: 220, height: 22, color: rgb(1, 1, 1) });
  page1.drawRectangle({ x: 112, y: 359, width: 12, height: 12, borderWidth: 1, borderColor: rgb(0, 0, 0) });
  pdfDoc.removePage(1);
  await addLogoHeader(pdfDoc);
  return pdfDoc.save();
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
  draw(page1, data.firstName, 135.5, 310.9);
  draw(page1, data.lastName, 321.3, 310.9);
  draw(page1, data.branch, 118, 264);
  const { mm, dd, yyyy } = fmtDateParts(data.dateSigned);
  draw(page1, mm, CAR_IQ_DATE_X.mm, 289, 9);
  draw(page1, dd, CAR_IQ_DATE_X.dd, 289, 9);
  draw(page1, yyyy, CAR_IQ_DATE_X.yyyy, 289, 9);
  if (data.agreed) draw(page1, "X", 115, 362, 10);

  if (signatureBytes) {
    const png = await pdfDoc.embedPng(signatureBytes);
    const { x, y, maxW, maxH } = CAR_IQ_SIGNATURE_DRAW;
    const scale = Math.min(maxW / png.width, maxH / png.height, 1);
    page1.drawImage(png, { x, y, width: png.width * scale, height: png.height * scale });
  }

  return pdfDoc.save();
}
