/**
 * Builds the "Master Independent Contractor Subcontractor Agreement
 * Addendum" PDF from scratch with pdf-lib — there is no source PDF asset
 * for this form (see contractorAddendumFormTemplate.ts). A tiny layout
 * engine flows CONTRACTOR_ADDENDUM_BLOCKS top-to-bottom across US-Letter
 * pages, breaking pages automatically, and records the on-page rectangle of
 * every fillable blank + signature line so the fill/sign pages can place
 * their input overlays without measuring anything.
 *
 * `buildContractorAddendumPdf` is the single source of truth: call it with
 * blank data for the interactive form, or with filled data + signature PNGs
 * for the final document — same layout either way (field values never
 * reflow text; they sit on fixed-length underscore runs).
 *
 * The company logo is stamped centred on every page by addLogoHeader, the
 * same helper the other overlay HR forms use.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { addLogoHeader } from "./pdfLogoHeader";
import {
  CONTRACTOR_ADDENDUM_BLOCKS,
  blankContractorAddendumData,
  type ContractorAddendumFormData,
} from "./contractorAddendumFormTemplate";
import type { SignatureSlot } from "@/lib/supabase/signableDocuments";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_L = 56;
const MARGIN_R = 56;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;
const TOP_Y = 700; // below the 60pt centred logo (it occupies y≈722–782)
const BOTTOM_Y = 58;

const TITLE_SIZE = 13;
const H2_SIZE = 11;
const BODY_SIZE = 10;
const BODY_LEAD = 13.5;
const BULLET_INDENT = 16;

const BLACK = rgb(0, 0, 0);
const GREY = rgb(0.28, 0.28, 0.28);
const NAVY = rgb(0, 0, 0.545);

const FIELD_W = { positionLevel: 250, baselinePayout: 120 } as const;
const SIG_W = 200;
const SIG_H = 22;
const DATE_W = 92;
const NAME_W = 240;

export interface Rect {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface ContractorAddendumLayout {
  pageCount: number;
  positionLevel: Rect;
  baselinePayout: Rect;
  signatures: Partial<Record<SignatureSlot, { sig: Rect; date: Rect; name: Rect }>>;
}

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    let cur = "";
    for (const word of paragraph.split(/\s+/)) {
      const trial = cur ? `${cur} ${word}` : word;
      if (cur && font.widthOfTextAtSize(trial, size) > maxW) {
        out.push(cur);
        cur = word;
      } else {
        cur = trial;
      }
    }
    out.push(cur);
  }
  return out;
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

function underscores(width: number, font: PDFFont, size: number): string {
  const one = font.widthOfTextAtSize("_", size) || 1;
  return "_".repeat(Math.max(1, Math.floor(width / one)));
}

export async function buildContractorAddendumPdf(
  data: ContractorAddendumFormData,
  sigBytesBySlot?: Partial<Record<SignatureSlot, Uint8Array>>,
): Promise<{ bytes: Uint8Array; layout: ContractorAddendumLayout }> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pages = [pdf.addPage([PAGE_W, PAGE_H])];
  let pi = 0;
  let y = TOP_Y;

  const newPage = () => {
    pages.push(pdf.addPage([PAGE_W, PAGE_H]));
    pi += 1;
    y = TOP_Y;
  };
  const ensure = (needed: number) => {
    if (y - needed < BOTTOM_Y) newPage();
  };
  const text = (s: string, x: number, f: PDFFont, size: number, color = BLACK) => {
    if (s) pages[pi].drawText(s, { x, y, size, font: f, color });
  };

  const layout: ContractorAddendumLayout = {
    pageCount: 1,
    positionLevel: { page: 0, x: 0, y: 0, w: 0, h: 0 },
    baselinePayout: { page: 0, x: 0, y: 0, w: 0, h: 0 },
    signatures: {},
  };

  const drawField = (name: "positionLevel" | "baselinePayout", before: string, after: string | undefined) => {
    ensure(BODY_LEAD * 1.6);
    text(before, MARGIN_L, bold, BODY_SIZE);
    const x0 = MARGIN_L + bold.widthOfTextAtSize(before, BODY_SIZE);
    const w = FIELD_W[name];
    text(underscores(w, font, BODY_SIZE), x0, font, BODY_SIZE, GREY);
    if (after) text(after, x0 + w + 4, bold, BODY_SIZE);
    const value = data[name];
    if (value) text(value, x0 + 3, font, BODY_SIZE, NAVY);
    layout[name] = { page: pi, x: x0, y: y - 2, w, h: 13 };
    y -= BODY_LEAD * 1.5;
  };

  const drawSign = async (slot: SignatureSlot, role: string) => {
    ensure(BODY_LEAD * 3.4 + 8);
    text(role, MARGIN_L, bold, BODY_SIZE);
    y -= BODY_LEAD + 3;

    const sigLabel = "Signature: ";
    text(sigLabel, MARGIN_L, font, BODY_SIZE);
    const sigX = MARGIN_L + font.widthOfTextAtSize(sigLabel, BODY_SIZE);
    text(underscores(SIG_W, font, BODY_SIZE), sigX, font, BODY_SIZE, GREY);

    const dateLabel = "Date: ";
    const dateLabelX = sigX + SIG_W + 18;
    text(dateLabel, dateLabelX, font, BODY_SIZE);
    const dateX = dateLabelX + font.widthOfTextAtSize(dateLabel, BODY_SIZE);
    text(underscores(DATE_W, font, BODY_SIZE), dateX, font, BODY_SIZE, GREY);

    const sigBytes = sigBytesBySlot?.[slot];
    if (sigBytes) {
      try {
        const png = await pdf.embedPng(sigBytes);
        const scale = Math.min(SIG_W / png.width, SIG_H / png.height, 1);
        pages[pi].drawImage(png, { x: sigX + 2, y: y - 1, width: png.width * scale, height: png.height * scale });
      } catch {
        /* ignore a bad signature image rather than losing the whole PDF */
      }
    }
    if (data.datesSigned[slot]) text(fmtDate(data.datesSigned[slot]), dateX + 2, font, BODY_SIZE, NAVY);

    const sigRect: Rect = { page: pi, x: sigX, y: y - 3, w: SIG_W, h: SIG_H };
    const dateRect: Rect = { page: pi, x: dateX, y: y - 3, w: DATE_W, h: 14 };
    y -= BODY_LEAD + 5;

    const nameLabel = "Name: ";
    text(nameLabel, MARGIN_L, font, BODY_SIZE);
    const nameX = MARGIN_L + font.widthOfTextAtSize(nameLabel, BODY_SIZE);
    text(underscores(NAME_W, font, BODY_SIZE), nameX, font, BODY_SIZE, GREY);
    if (data.signerNames[slot]) text(data.signerNames[slot] as string, nameX + 3, font, BODY_SIZE, NAVY);
    const nameRect: Rect = { page: pi, x: nameX, y: y - 3, w: NAME_W, h: 14 };

    layout.signatures[slot] = { sig: sigRect, date: dateRect, name: nameRect };
    y -= BODY_LEAD + 10;
  };

  for (const block of CONTRACTOR_ADDENDUM_BLOCKS) {
    switch (block.kind) {
      case "title": {
        ensure(BODY_LEAD * 3);
        for (const line of wrap(block.text, bold, TITLE_SIZE, CONTENT_W)) {
          text(line, MARGIN_L, bold, TITLE_SIZE);
          y -= TITLE_SIZE + 5;
        }
        y -= 4;
        break;
      }
      case "h2": {
        ensure(BODY_LEAD * 3.5);
        y -= 6;
        for (const line of wrap(block.text, bold, H2_SIZE, CONTENT_W)) {
          text(line, MARGIN_L, bold, H2_SIZE);
          y -= H2_SIZE + 3;
        }
        y -= 3;
        break;
      }
      case "p": {
        for (const line of wrap(block.text, font, BODY_SIZE, CONTENT_W)) {
          ensure(BODY_LEAD);
          text(line, MARGIN_L, font, BODY_SIZE);
          y -= BODY_LEAD;
        }
        y -= 3;
        break;
      }
      case "note": {
        for (const line of wrap(block.text, font, BODY_SIZE, CONTENT_W)) {
          ensure(BODY_LEAD);
          text(line, MARGIN_L, font, BODY_SIZE, GREY);
          y -= BODY_LEAD;
        }
        y -= 4;
        break;
      }
      case "bullet": {
        const lines = wrap(block.text, font, BODY_SIZE, CONTENT_W - BULLET_INDENT);
        ensure(BODY_LEAD);
        text("•", MARGIN_L + 3, font, BODY_SIZE);
        lines.forEach((line, idx) => {
          if (idx > 0) ensure(BODY_LEAD);
          text(line, MARGIN_L + BULLET_INDENT, font, BODY_SIZE);
          y -= BODY_LEAD;
        });
        y -= 3;
        break;
      }
      case "gap": {
        y -= block.pt;
        break;
      }
      case "field": {
        drawField(block.name, block.before, block.after);
        break;
      }
      case "signHeading": {
        ensure(BODY_LEAD * 4);
        y -= 8;
        for (const line of wrap(block.text, bold, H2_SIZE, CONTENT_W)) {
          text(line, MARGIN_L, bold, H2_SIZE);
          y -= H2_SIZE + 6;
        }
        break;
      }
      case "sign": {
        await drawSign(block.slot, block.role);
        break;
      }
    }
  }

  layout.pageCount = pages.length;
  await addLogoHeader(pdf);
  const bytes = await pdf.save();
  return { bytes, layout };
}

/** Blank interactive form — bytes for the pdf.js canvas render + the overlay layout. */
export async function loadBlankContractorAddendum(): Promise<{ bytes: Uint8Array; layout: ContractorAddendumLayout }> {
  return buildContractorAddendumPdf(blankContractorAddendumData());
}

/** Final/partial document with whatever field values + signatures are present. */
export async function fillContractorAddendumPdf(
  data: ContractorAddendumFormData,
  sigBytesBySlot?: Partial<Record<SignatureSlot, Uint8Array>>,
): Promise<Uint8Array> {
  return (await buildContractorAddendumPdf(data, sigBytesBySlot)).bytes;
}

export { PAGE_W as CONTRACTOR_ADDENDUM_PAGE_W, PAGE_H as CONTRACTOR_ADDENDUM_PAGE_H };
