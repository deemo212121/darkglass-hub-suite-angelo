/**
 * Performance Bonus Policy & Acknowledgment Form — every technician signs it
 * (Staff Form Checklist, New Technician tier). Fills the REAL PDF HR
 * supplied (src/assets/Performance Bonus Policy & Acknowledgment Form.pdf —
 * US Letter, 2 pages, no AcroForm fields) the same way the Flash travel
 * agreement does, with the company logo stamped on page 1 only
 * (addLogoHeader — the title sits at y=695.5, same clearance as the other
 * forms that use it).
 *
 * Technician-only: the signature block on the last page (index 1) is
 *   Technician Name (Print): ____   (line x 196.8–411.9, y 276.2)
 *   Technician Signature: ____      (line x 180.3–419.3, y 251.2)
 *   Date: ____                      (line x 101.4–245.0, y 226.1)
 * measured off the source PDF's text items (pdfjs-dist). No employer line,
 * so the document is done once the technician signs.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { addLogoHeader } from "./pdfLogoHeader";
import { sanitizeForFont } from "./pdfFillSanitize";

export const PERFORMANCE_BONUS_POLICY_TITLE = "Performance Bonus Policy & Acknowledgment Form";

export interface PerformanceBonusPolicyFormData {
  employeeId: string;
  employeeName: string;
  employeeDateSigned: string;
  employeeSignatureDataUrl: string;
}

export interface PerformanceBonusRect { x: number; y: number; w: number; h: number }

/** Page size and the signing page's field boxes (PDF units, origin bottom-left). */
export const PERFORMANCE_BONUS_LAYOUT = {
  pageWidth: 612,
  pageHeight: 792,
  rects: {
    name: { x: 200, y: 278, w: 210, h: 14 },
    // Right of the "Technician Signature:" label (x 72–177.5); up to the name line above.
    signature: { x: 185, y: 252.5, w: 230, h: 22 },
    dateSigned: { x: 105, y: 228, w: 140, h: 14 },
  } satisfies Record<string, PerformanceBonusRect>,
};

/** The blank form with the company logo on page 1 — what the signing page shows. */
export async function loadBlankPerformanceBonusPolicyBytes(): Promise<Uint8Array> {
  const mod = await import("@/assets/Performance Bonus Policy & Acknowledgment Form.pdf");
  const res = await fetch(mod.default);
  const pdfDoc = await PDFDocument.load(new Uint8Array(await res.arrayBuffer()));
  await addLogoHeader(pdfDoc, { firstPageOnly: true });
  return pdfDoc.save();
}

function fmtSignedDate(iso: string): string {
  if (!iso) return "";
  // A date-only string parses as UTC midnight and would print a day early
  // in US time zones — build it from its y/m/d parts instead.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = dateOnly ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])) : new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US");
}

export async function fillPerformanceBonusPolicyPdf(data: PerformanceBonusPolicyFormData, employeeSigBytes?: Uint8Array): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(await loadBlankPerformanceBonusPolicyBytes());
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const page = pdfDoc.getPage(pdfDoc.getPageCount() - 1);
  const { rects } = PERFORMANCE_BONUS_LAYOUT;
  const drawText = (text: string, r: PerformanceBonusRect) => {
    if (text) page.drawText(sanitizeForFont(text, font), { x: r.x, y: r.y, size: 11, font, color: rgb(0, 0, 0.545) });
  };
  drawText(data.employeeName, rects.name);
  if (employeeSigBytes) {
    const png = await pdfDoc.embedPng(employeeSigBytes);
    const s = rects.signature;
    const scale = Math.min(s.w / png.width, s.h / png.height, 1);
    page.drawImage(png, { x: s.x, y: s.y, width: png.width * scale, height: png.height * scale });
  }
  drawText(fmtSignedDate(data.employeeDateSigned), rects.dateSigned);
  return pdfDoc.save();
}
