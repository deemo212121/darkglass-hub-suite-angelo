/**
 * Fills the REAL "Employee Attendance & Visit Exception Report" PDF
 * (src/assets/Employee Attendance and Visit Exception Report.pdf) — like
 * damagePdfFill.ts, this PDF has NO AcroForm fields at all (confirmed by
 * direct inspection), just plain underscore-blank lines and "[ ]" checkbox
 * text. Every value is drawn directly onto the page at coordinates
 * extracted from the actual blank-line/label/checkbox text positions (via
 * pdf.js's text-position API).
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import type { VisitExceptionReportFormData } from "./visitExceptionReportFormTemplate";
import { addLogoHeader } from "./pdfLogoHeader";
import { sanitizeForFont } from "./pdfFillSanitize";

const fmtDate = (v: string) => {
  if (!v) return "";
  // A date-only string ("2026-09-17") parses as UTC midnight; reading
  // .getMonth()/.getDate() back out in the browser's local timezone
  // (anything behind UTC, i.e. all of the US) rolls it back a day —
  // "9/17" printing as "9/16". Parsing the y/m/d parts directly into a
  // local Date avoids that. A full timestamp has no such ambiguity and is
  // left to the normal parse.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const d = dateOnly ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])) : new Date(v);
  if (isNaN(d.getTime())) return v;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
};

/** Greedy word-wrap against the font's own measured width — the Detailed
 *  Reason block is the only multi-line free text on this document. */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Stamps the company logo into the header of every page — see pdfLogoHeader.ts. Applied here, not just in fillVisitExceptionReportPdf, so the interactive fill page (which renders these same blank bytes straight to canvas via pdf.js) shows it too. */
export async function loadBlankVisitExceptionReportBytes(): Promise<Uint8Array> {
  const mod = await import("@/assets/Employee Attendance and Visit Exception Report.pdf");
  const res = await fetch(mod.default);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const pdfDoc = await PDFDocument.load(bytes);
  await addLogoHeader(pdfDoc);
  return pdfDoc.save();
}

export async function fillVisitExceptionReportPdf(
  data: VisitExceptionReportFormData,
  employeeSigBytes?: Uint8Array,
  managerSigBytes?: Uint8Array
): Promise<Uint8Array> {
  const blankBytes = await loadBlankVisitExceptionReportBytes();
  const pdfDoc = await PDFDocument.load(blankBytes);
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page1 = pdfDoc.getPage(0);
  const draw1 = (text: string, x: number, y: number, size = 10) => {
    if (!text) return;
    page1.drawText(sanitizeForFont(text, font), { x, y, size, font, color: rgb(0, 0, 0.545) });
  };
  const checkbox1 = (x: number, y: number, on: boolean) => {
    if (!on) return;
    page1.drawText("X", { x: x + 2.2, y, size: 10, font, color: rgb(0, 0, 0.545) });
  };

  draw1(data.employeeName, 196.5, 624.2);
  draw1(data.employeeIdNumber, 430.5, 624.2);
  draw1(data.jobTitle, 196.5, 561.8);
  draw1(data.department, 430.5, 561.8);
  draw1(data.directManager, 196.5, 499.4);
  draw1(fmtDate(data.dateOfIncident), 428, 499.4, 9);

  checkbox1(79.5, 421.8, data.reasonMissedWorkday);
  checkbox1(313.5, 421.8, data.reasonLateEarly);
  checkbox1(79.5, 375.2, data.reasonMissedAppointment);
  checkbox1(313.5, 375.2, data.reasonOther);
  if (data.reasonOther) draw1(data.reasonOtherText, 313.5, 359.4, 8);

  // Detailed Reason — the only multi-line free-text block on this
  // document, wrapped to fit between its own label (y=264.8) and the
  // "Customer / Job Details" section header below it (y=185.8).
  const reasonLines = wrapText(data.detailedReason, font, 9, 452);
  let reasonY = 246;
  for (const line of reasonLines.slice(0, 5)) {
    draw1(line, 79.5, reasonY, 9);
    reasonY -= 12;
  }

  draw1(data.customerName, 195, 138.4, 9);
  draw1(data.scheduledTime, 187, 122.6, 9);
  draw1(data.actionTaken, 302, 99.3, 8);

  const page2 = pdfDoc.getPage(1);
  const draw2 = (text: string, x: number, y: number, size = 9) => {
    if (!text) return;
    page2.drawText(sanitizeForFont(text, font), { x, y, size, font, color: rgb(0, 0, 0.545) });
  };

  if (employeeSigBytes) {
    const png = await pdfDoc.embedPng(employeeSigBytes);
    page2.drawImage(png, { x: 200, y: 531, width: 150, height: 16 });
  }
  draw2(fmtDate(data.employeeDateSigned), 415, 535.5);

  const commentLines = wrapText(data.managerComments, font, 9, 440);
  let commentY = 452;
  for (const line of commentLines.slice(0, 3)) {
    draw2(line, 83.3, commentY);
    commentY -= 12;
  }

  if (managerSigBytes) {
    const png = await pdfDoc.embedPng(managerSigBytes);
    page2.drawImage(png, { x: 230, y: 412, width: 150, height: 16 });
  }
  draw2(fmtDate(data.managerDateSigned), 420, 416.6);

  return pdfDoc.save();
}
