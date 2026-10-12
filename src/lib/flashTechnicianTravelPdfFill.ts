/**
 * Fills the REAL Flash travel PDF for a document — two versions, picked by
 * form_data.templateVersion (see FLASH_TRAVEL_CURRENT_VERSION):
 *
 * Version 1 — "Flash Technician Travel & Out-of-State Policy"
 * (src/assets/Flash Technician Travel & Out-of-State Policy 1.pdf), every
 * document signed before 2026-10-12. Like mileageFuelPdfFill.ts, no AcroForm
 * fields, just static text with blank underscore lines; A4 (595.56 x
 * 842.04pt), not US Letter, with its own "US IN HOME SERVICES" letterhead on
 * page 1 — so it deliberately does NOT stamp addLogoHeader's logo image,
 * which would overlap that existing header text. Both signature lines live
 * together on the last page (index 2):
 *   "Employee Signature: ________ Date: ________"
 *   "Employer Representative Signature: ________ Date: ________"
 *
 * Version 2 — "Flash Tech Travel & Expense Policy Agreement"
 * (src/assets/Flash Tech Travel & Expense Policy Agreement.pdf), the
 * replacement. US Letter (612 x 792pt), 4 pages; the employee-only block is
 * on the last page (index 3): Employee Name (Printed), Employee ID, Employee
 * Signature, Date — there is no employer line, so a version 2 document is
 * complete as soon as the technician signs.
 *
 * Coordinates were measured directly off each source PDF's text items
 * (pdfjs-dist), the same approach the other *PdfFill.ts modules use.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { FlashTechnicianTravelFormData } from "./flashTechnicianTravelFormTemplate";
import { sanitizeForFont } from "./pdfFillSanitize";
import { addLogoHeader } from "./pdfLogoHeader";
import { FLASH_TRAVEL_CURRENT_VERSION } from "./signableDocumentRegistry";

export { FLASH_TRAVEL_CURRENT_VERSION };

/** Version 2's title — the label every new send and signature uses. */
export const FLASH_TRAVEL_TITLE = "Flash Tech Travel & Expense Policy Agreement";

export interface FlashTravelRect { x: number; y: number; w: number; h: number }

/** Page size and the signing page's field boxes (PDF units, origin bottom-left) for a document's version. */
export interface FlashTravelLayout {
  pageWidth: number;
  pageHeight: number;
  rects: { signature: FlashTravelRect; dateSigned: FlashTravelRect; name?: FlashTravelRect; employeeIdNumber?: FlashTravelRect };
}

export function flashTravelLayout(version: number | undefined): FlashTravelLayout {
  if ((version ?? 1) >= 2) {
    return {
      pageWidth: 612,
      pageHeight: 792,
      // Lines (underscore runs) at y 543.8 / 503.8 / 463.9 / 439.9, starting x 72
      // (Date's at x 105.4). Text sits just above its line; the signature starts
      // right of the "Employee Signature:" label (x 72–191) so the two can't meet.
      rects: {
        name: { x: 76, y: 546, w: 330, h: 14 },
        employeeIdNumber: { x: 76, y: 506, w: 330, h: 14 },
        signature: { x: 200, y: 466, w: 280, h: 32 },
        dateSigned: { x: 110, y: 442, w: 150, h: 14 },
      },
    };
  }
  return {
    pageWidth: 595.56,
    pageHeight: 842.04,
    rects: {
      signature: { x: 183, y: 716, w: 200, h: 26 },
      dateSigned: { x: 424, y: 716, w: 90, h: 14 },
    },
  };
}

/**
 * The blank PDF for a version. Defaults to version 1: the only callers that
 * don't know the document's version are the employer-signature screens,
 * which only ever handle version 1 (version 2 has no employer step).
 */
export async function loadBlankFlashTechnicianTravelBytes(version: number = 1): Promise<Uint8Array> {
  const mod = version >= 2
    ? await import("@/assets/Flash Tech Travel & Expense Policy Agreement.pdf")
    : await import("@/assets/Flash Technician Travel & Out-of-State Policy 1.pdf");
  const res = await fetch(mod.default);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const pdfDoc = await PDFDocument.load(bytes);
  // Version 2 has no letterhead — stamp the company logo on page 1 only
  // (its title starts at y=695.5, same clearance as the other forms using
  // addLogoHeader). Version 1 has its own "US IN HOME SERVICES" header.
  if (version >= 2) await addLogoHeader(pdfDoc, { firstPageOnly: true });
  return pdfDoc.save();
}

function fmtSignedDate(iso: string): string {
  if (!iso) return "";
  // A date-only string ("2026-09-17") parses as UTC midnight; formatting
  // it back out in the browser's local timezone (anything behind UTC,
  // i.e. all of the US) rolls it back a day — "9/17" printing as "9/16".
  // Parsing the y/m/d parts directly into a local Date avoids that. A
  // full timestamp has no such ambiguity and is left to the normal parse.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = dateOnly ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])) : new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US");
}

export async function fillFlashTechnicianTravelPdf(
  data: FlashTechnicianTravelFormData,
  employeeSigBytes?: Uint8Array,
  employerSigBytes?: Uint8Array
): Promise<Uint8Array> {
  const version = data.templateVersion ?? 1;
  const blankBytes = await loadBlankFlashTechnicianTravelBytes(version);
  const pdfDoc = await PDFDocument.load(blankBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const page = pdfDoc.getPage(pdfDoc.getPageCount() - 1);
  const drawText = (text: string, x: number, y: number) => {
    if (!text) return;
    page.drawText(sanitizeForFont(text, font), { x, y, size: 11, font, color: rgb(0, 0, 0.545) });
  };
  const drawSig = async (bytes: Uint8Array, x: number, y: number, maxW: number, maxH: number) => {
    const png = await pdfDoc.embedPng(bytes);
    const scale = Math.min(maxW / png.width, maxH / png.height, 1);
    page.drawImage(png, { x, y, width: png.width * scale, height: png.height * scale });
  };

  if (version >= 2) {
    const { rects } = flashTravelLayout(version);
    drawText(data.employeeName, rects.name!.x, rects.name!.y + 2);
    drawText(data.employeeIdNumber ?? "", rects.employeeIdNumber!.x, rects.employeeIdNumber!.y + 2);
    if (employeeSigBytes) await drawSig(employeeSigBytes, rects.signature.x, rects.signature.y, rects.signature.w, rects.signature.h);
    drawText(fmtSignedDate(data.employeeDateSigned), rects.dateSigned.x, rects.dateSigned.y + 2);
    return pdfDoc.save();
  }

  // Version 1. Employee's line has ~47pt of clear space above it before the
  // acknowledgment paragraph, so its signature can grow generously upward
  // from the baseline without touching anything. The Employer line right
  // underneath only has ~12.6pt of headroom up to Employee's own box
  // bottom (y 716) before the two would visually overlap — capped the
  // employer box's TOP edge there (699 + 17 = 716) and grew it DOWNWARD
  // instead (699 vs the old 705), into the blank margin below the
  // signature row and well above the footer line, so it's meaningfully
  // bigger (11pt tall -> 17pt, ~55%) without touching Employee's own
  // signature above it.
  if (employeeSigBytes) await drawSig(employeeSigBytes, 183, 716, 200, 26);
  drawText(fmtSignedDate(data.employeeDateSigned), 424, 717.3);

  if (employerSigBytes) await drawSig(employerSigBytes, 257, 699, 150, 17);
  drawText(fmtSignedDate(data.employerDateSigned), 425, 704.7);

  return pdfDoc.save();
}
