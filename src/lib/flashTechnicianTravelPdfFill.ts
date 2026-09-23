/**
 * Fills the REAL "Flash Technician Travel & Out-of-State Policy" PDF
 * (src/assets/Flash Technician Travel & Out-of-State Policy 1.pdf) — like
 * mileageFuelPdfFill.ts, this PDF has no AcroForm fields, just static text
 * with blank underscore lines. Unlike most of this app's other HR PDFs,
 * this one is A4-sized (595.56 x 842.04pt), not US Letter, and already
 * carries its own "US IN HOME SERVICES" letterhead on page 1 — so unlike
 * those other forms this one deliberately does NOT stamp addLogoHeader's
 * logo image, which would overlap that existing header text.
 *
 * Both signature lines live together on the last page (index 2):
 *   "Employee Signature: ________ Date: ________"
 *   "Employer Representative Signature: ________ Date: ________"
 * Coordinates below were measured directly off the source PDF's text
 * items (pdfjs-dist) combined with pdf-lib's own Helvetica width metrics
 * to locate exactly where each underscore run starts/ends, the same
 * approach the other *PdfFill.ts modules use.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { FlashTechnicianTravelFormData } from "./flashTechnicianTravelFormTemplate";
import { sanitizeForFont } from "./pdfFillSanitize";

export async function loadBlankFlashTechnicianTravelBytes(): Promise<Uint8Array> {
  const mod = await import("@/assets/Flash Technician Travel & Out-of-State Policy 1.pdf");
  const res = await fetch(mod.default);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const pdfDoc = await PDFDocument.load(bytes);
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
  const blankBytes = await loadBlankFlashTechnicianTravelBytes();
  const pdfDoc = await PDFDocument.load(blankBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const page = pdfDoc.getPage(2);
  const drawDate = (text: string, x: number, y: number) => {
    if (!text) return;
    page.drawText(sanitizeForFont(text, font), { x, y, size: 11, font, color: rgb(0, 0, 0.545) });
  };
  const drawSig = async (bytes: Uint8Array, x: number, y: number, maxW: number, maxH: number) => {
    const png = await pdfDoc.embedPng(bytes);
    const scale = Math.min(maxW / png.width, maxH / png.height, 1);
    page.drawImage(png, { x, y, width: png.width * scale, height: png.height * scale });
  };

  // Employee's line has ~47pt of clear space above it before the
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
  drawDate(fmtSignedDate(data.employeeDateSigned), 424, 717.3);

  if (employerSigBytes) await drawSig(employerSigBytes, 257, 699, 150, 17);
  drawDate(fmtSignedDate(data.employerDateSigned), 425, 704.7);

  return pdfDoc.save();
}
