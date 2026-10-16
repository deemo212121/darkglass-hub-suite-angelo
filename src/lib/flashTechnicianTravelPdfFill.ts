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
 * on the last page (index 3): Employee Name (Printed), Employee Signature,
 * Date — there is no employer line, so a version 2 document is complete as
 * soon as the technician signs. The source PDF also prints an "Employee ID"
 * line, which HR doesn't want: loadBlankFlashTechnicianTravelBytes blanks it
 * and moves the Signature/Date rows up into its place.
 *
 * Coordinates were measured directly off each source PDF's text items
 * (pdfjs-dist), the same approach the other *PdfFill.ts modules use.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { FlashTechnicianTravelFormData } from "./flashTechnicianTravelFormTemplate";
import { sanitizeForFont } from "./pdfFillSanitize";
import { buildLetterheadPdf, placeOnLetterhead } from "./pdfLogoHeader";
import { FLASH_TRAVEL_CURRENT_VERSION } from "./signableDocumentRegistry";

export { FLASH_TRAVEL_CURRENT_VERSION };

/** Version 2's title — the label every new send and signature uses. */
export const FLASH_TRAVEL_TITLE = "Flash Tech Travel & Expense Policy Agreement";

/**
 * The version 2 wording the blank form renders today (2 = the Oct 13 2026
 * "Ineligible Purchases and Reimbursement Limitations" rewrite — see
 * V2_INELIGIBLE). Saved on each signature as form_data.wordingRevision; bump
 * it whenever the v2 text changes, so Regenerate PDF won't re-word older
 * signed agreements.
 */
export const FLASH_V2_WORDING_REVISION = 2;

/** Whether a signed agreement can be re-rendered without changing the text its signer saw. */
export function canRegenerateFlashTravelPdf(data: Pick<FlashTechnicianTravelFormData, "templateVersion" | "wordingRevision">): boolean {
  return (data.templateVersion ?? 1) < 2 || (data.wordingRevision ?? 1) === FLASH_V2_WORDING_REVISION;
}

export interface FlashTravelRect { x: number; y: number; w: number; h: number }

/** Page size and the signing page's field boxes (PDF units, origin bottom-left) for a document's version. */
export interface FlashTravelLayout {
  pageWidth: number;
  pageHeight: number;
  rects: { signature: FlashTravelRect; dateSigned: FlashTravelRect; name?: FlashTravelRect };
}

/** Version 2's Employee ID row: label baseline 519.8 to its line at 503.8 — the next row starts 40pt lower. */
const V2_ID_ROW_HEIGHT = 40;
/** Version 2's Signature + Date rows as printed in the source PDF (label top ~489 down to the Date line ~437.5). */
const V2_SIG_DATE_BOX = { left: 60, bottom: 432, right: 552, top: 494 };

export function flashTravelLayout(version: number | undefined): FlashTravelLayout {
  if ((version ?? 1) >= 2) {
    return {
      pageWidth: 612,
      pageHeight: 792,
      // Lines (underscore runs) at y 543.8 / 503.9 / 479.9 once the Employee
      // ID row is gone, starting x 72 (Date's at x 105.4). Text sits just above
      // its line; the signature starts right of the "Employee Signature:"
      // label (x 72–191) so the two can't meet.
      // Measured on the (edited) source page, moved down with page 4's content
      // (V2_KEEP_TOGETHER.shift), then onto the letterhead with the rest.
      rects: {
        name: placeOnLetterhead({ x: 76, y: 546 - V2_KEEP_TOGETHER.shift, w: 330, h: 14 }),
        signature: placeOnLetterhead({ x: 200, y: 466 + V2_ID_ROW_HEIGHT - V2_KEEP_TOGETHER.shift, w: 280, h: 32 }),
        dateSigned: placeOnLetterhead({ x: 110, y: 442 + V2_ID_ROW_HEIGHT - V2_KEEP_TOGETHER.shift, w: 150, h: 14 }),
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
/**
 * Version 2, page 2: HR's rewrite of the meal-reimbursement exclusions. The
 * source PDF's "Strict Alcohol Prohibition" bullet and "Non-Reimbursable
 * Items" section (baselines 527.7 down to 240.1; "4. ACCOMMODATIONS &
 * COMMUTING RULES" follows at 216.1) are whited out and this text is set in
 * their place, in the page's own style: bullet + bold heading at x 90/108,
 * 12pt body indented under the heading at x 108, 16pt lines, 8pt between paragraphs.
 */
const V2_INELIGIBLE = {
  pageIndex: 1,
  heading: "Ineligible Purchases and Reimbursement Limitations",
  paragraphs: [
    "Meal reimbursements are strictly limited to ordinary food and non-alcoholic beverages consumed by the technician. US In Home Services will not reimburse any expenses related to the purchase of alcoholic beverages (including beer, wine, liquor, etc.), tobacco, e-cigarettes, vaping products, nicotine items, controlled substances, cannabis, marijuana, THC/CBD products, illegal or recreational drugs (regardless of legal status in the destination state), over-the-counter (OTC) medications, or any other personal-use medications or prohibited substances.",
    "All such purchases must be paid for personally by the employee and may not be included in meal expense claims or submitted for reimbursement.",
    "If any non-reimbursable items appear on an itemized receipt submitted for reimbursement, the entire meal reimbursement claim for that receipt will be denied. No portion of the meal expense associated with that receipt will be eligible for reimbursement, regardless of whether the remaining items are otherwise eligible under this agreement.",
  ],
  // Area covered: from just above the old bullet's cap height down to just under its last line.
  cover: { left: 70, bottom: 234, right: 560, top: 542 },
  headingY: 527.7,
  // Indented under the bold heading, like the page's other bullets' wrapped text.
  bodyX: 108,
  bodyRight: 540,
  /** The lowest a body baseline may sit (the old section's last line) — keeps clear of section 4. */
  minBaseline: 240,
};

async function replaceV2IneligibleSection(pdfDoc: PDFDocument): Promise<void> {
  const S = V2_INELIGIBLE;
  const page = pdfDoc.getPage(S.pageIndex);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const wrap = (text: string, size: number) => {
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (regular.widthOfTextAtSize(next, size) > S.bodyRight - S.bodyX && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };
  // 12pt like the rest of the page; 11pt only if 12pt wouldn't fit above section 4.
  const layoutFor = (size: number, lead: number) => {
    const paras = S.paragraphs.map((p) => wrap(p, size));
    let y = S.headingY - 24;
    const placed: { text: string; y: number }[] = [];
    paras.forEach((lines, i) => {
      if (i > 0) y -= 8;
      for (const l of lines) {
        placed.push({ text: l, y });
        y -= lead;
      }
    });
    return { placed, lowest: placed[placed.length - 1]?.y ?? S.headingY, size };
  };
  let layout = layoutFor(12, 16);
  if (layout.lowest < S.minBaseline) layout = layoutFor(11, 14.6);

  const c = S.cover;
  page.drawRectangle({ x: c.left, y: c.bottom, width: c.right - c.left, height: c.top - c.bottom, color: rgb(1, 1, 1) });
  // Bullet as a filled dot, the size of the page's own "•" bullets (a Helvetica "•" prints much smaller).
  page.drawCircle({ x: 93.2, y: S.headingY + 3.6, size: 2.3, color: rgb(0, 0, 0) });
  page.drawText(S.heading, { x: 108, y: S.headingY, size: 12, font: bold, color: rgb(0, 0, 0) });
  for (const { text, y } of layout.placed) page.drawText(text, { x: S.bodyX, y, size: layout.size, font: regular, color: rgb(0, 0, 0) });
}

/**
 * Version 2: the "Financial Recovery & Legal Remedies" bullet starts at the
 * bottom of page 3 (4 lines, baselines 136.1 → 88.1) and runs onto page 4 —
 * split across the letterhead footer/header it read badly. Its page-3 lines
 * are moved to the top of page 4 (first baseline 695.6, where page 4's text
 * starts) and everything on page 4 moves down 4 lines (64pt) to make room,
 * so the whole bullet sits together.
 */
const V2_KEEP_TOGETHER = {
  fromPage: 2,
  toPage: 3,
  // The bullet's lines on page 3: cap height above the first baseline to descenders below the last.
  box: { left: 60, bottom: 82, right: 552, top: 150 },
  firstBaseline: 136.1,
  destFirstBaseline: 695.6,
  shift: 64,
};

/**
 * Takes the already-edited form's bytes and returns new bytes. Works on a
 * freshly loaded document: drawing more on a page pdf-lib has already saved
 * (page 4, edited for the Employee ID row) is silently dropped.
 */
async function keepV2FinancialRecoveryTogether(editedBytes: Uint8Array): Promise<Uint8Array> {
  const K = V2_KEEP_TOGETHER;
  const pdfDoc = await PDFDocument.load(editedBytes);
  const snapshot = await PDFDocument.load(editedBytes);
  const chunk = await pdfDoc.embedPage(snapshot.getPage(K.fromPage), K.box);
  const lastPage = await pdfDoc.embedPage(snapshot.getPage(K.toPage));
  const from = pdfDoc.getPage(K.fromPage);
  const to = pdfDoc.getPage(K.toPage);
  const white = rgb(1, 1, 1);
  from.drawRectangle({ x: K.box.left, y: K.box.bottom, width: K.box.right - K.box.left, height: K.box.top - K.box.bottom, color: white });
  const { width, height } = to.getSize();
  to.drawRectangle({ x: 0, y: 0, width, height, color: white });
  to.drawPage(lastPage, { x: 0, y: -K.shift });
  to.drawPage(chunk, { x: K.box.left, y: K.box.bottom + (K.destFirstBaseline - K.firstBaseline) });
  return pdfDoc.save();
}

export async function loadBlankFlashTechnicianTravelBytes(version: number = 1): Promise<Uint8Array> {
  const mod = version >= 2
    ? await import("@/assets/Flash Tech Travel & Expense Policy Agreement.pdf")
    : await import("@/assets/Flash Technician Travel & Out-of-State Policy 1.pdf");
  const res = await fetch(mod.default);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const pdfDoc = await PDFDocument.load(bytes);
  if (version >= 2) {
    // Drop the Employee ID row: white out it and the Signature/Date rows
    // below, then redraw those two rows (copied straight off an untouched
    // copy of the page, so the fonts match exactly) one row higher.
    const source = await PDFDocument.load(bytes);
    const sigDateRows = await pdfDoc.embedPage(source.getPage(source.getPageCount() - 1), V2_SIG_DATE_BOX);
    const page = pdfDoc.getPage(pdfDoc.getPageCount() - 1);
    const b = V2_SIG_DATE_BOX;
    page.drawRectangle({ x: b.left, y: b.bottom, width: b.right - b.left, height: b.top - b.bottom + V2_ID_ROW_HEIGHT, color: rgb(1, 1, 1) });
    page.drawPage(sigDateRows, { x: b.left, y: b.bottom + V2_ID_ROW_HEIGHT });
    // Page 2: HR's rewritten "Ineligible Purchases and Reimbursement Limitations".
    await replaceV2IneligibleSection(pdfDoc);
    // Pages 3–4: keep "Financial Recovery & Legal Remedies" in one piece on page 4.
    const kept = await keepV2FinancialRecoveryTogether(await pdfDoc.save());
    // Then the whole edited form onto the company letterhead (logo top-left,
    // ribbon top-right, footer, faint watermark) at 92%. Version 1 has its
    // own "US IN HOME SERVICES" header and is left as it is.
    const onLetterhead = await buildLetterheadPdf(kept);
    return onLetterhead.save();
  }
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
