/**
 * Stamps the US In Home Services logo, centered, in the header of every
 * page of a PDFDocument — shared by the no-AcroForm-field HR forms
 * (Acknowledgment of Wage, Car IQ, Company Vehicle Use Agreement, Employee
 * Confidentiality, Meal & Rest Break, PTO & Sick Leave, Parts
 * Responsibility, Mileage & Fuel, Location Sharing Consent) so every page —
 * blank (interactive fill view) or filled (final generated PDF) — carries
 * the company mark. 60pt square, 10pt down from the top edge: every one of
 * these forms' pages has its topmost real content (the title, or a
 * continuation line) starting at the same y=695.5 (measured directly off
 * each source PDF's text items), which leaves ~17.5pt of clearance below
 * the logo (title cap-height reaches roughly to y=704.5) — enough to never
 * collide with existing text at this size. Pass { firstPageOnly: true } to
 * stamp just page 1 (Flash Tech agreement, Performance Bonus Policy).
 */
import type { PDFDocument } from "pdf-lib";

const LOGO_SIZE = 60;
const LOGO_MARGIN_TOP = 10;

let cachedLogoBytes: Uint8Array | null = null;
async function loadLogoBytes(): Promise<Uint8Array> {
  if (cachedLogoBytes) return cachedLogoBytes;
  const mod = await import("@/assets/us-in-home-services-logo.png");
  const res = await fetch(mod.default);
  cachedLogoBytes = new Uint8Array(await res.arrayBuffer());
  return cachedLogoBytes;
}

/**
 * The company logo as a faint watermark, centered on every page (e.g. the
 * Performance Bonus Policy). Drawn large and at low opacity so the text
 * stays fully readable; aspect ratio kept. Draw it BEFORE the page content
 * when you can (see performanceBonusPolicyPdfFill.ts) so it sits behind the
 * text, and on the BLANK form so the signing view and signed PDF both have it.
 */
const WATERMARK_WIDTH_RATIO = 0.6; // of the page width
const WATERMARK_OPACITY = 0.06;

export async function addLogoWatermark(pdfDoc: PDFDocument): Promise<void> {
  const bytes = await loadLogoBytes();
  const png = await pdfDoc.embedPng(bytes);
  for (const page of pdfDoc.getPages()) {
    const { width, height } = page.getSize();
    const w = width * WATERMARK_WIDTH_RATIO;
    const h = (png.height / png.width) * w;
    page.drawImage(png, { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h, opacity: WATERMARK_OPACITY });
  }
}

/**
 * Company letterhead on every page, the same look as the Certificate of
 * Employment: logo top-LEFT, red/blue ribbon top-RIGHT, contact footer
 * across the bottom. Takes the top ~84pt and bottom ~76pt of a US Letter
 * page — shrink the form's own content to fit between them first (see
 * performanceBonusPolicyPdfFill.ts's CONTENT_SCALE).
 */
const LETTERHEAD = {
  margin: 36,
  top: 12,
  logoSize: 64,
  ribbonHeight: 60,
  footerSideMargin: 24,
  footerBottom: 10,
};

let cachedRibbonBytes: Uint8Array | null = null;
let cachedFooterBytes: Uint8Array | null = null;
async function loadAssetBytes(load: () => Promise<{ default: string }>): Promise<Uint8Array> {
  const mod = await load();
  const res = await fetch(mod.default);
  return new Uint8Array(await res.arrayBuffer());
}

export async function addLetterhead(pdfDoc: PDFDocument): Promise<void> {
  cachedRibbonBytes ??= await loadAssetBytes(() => import("@/assets/us-in-home-services-ribbon.png"));
  cachedFooterBytes ??= await loadAssetBytes(() => import("@/assets/us-in-home-services-footer.png"));
  const [logo, ribbon, footer] = await Promise.all([
    pdfDoc.embedPng(await loadLogoBytes()),
    pdfDoc.embedPng(cachedRibbonBytes),
    pdfDoc.embedPng(cachedFooterBytes),
  ]);
  const L = LETTERHEAD;
  for (const page of pdfDoc.getPages()) {
    const { width, height } = page.getSize();
    // Logo — top left.
    page.drawImage(logo, { x: L.margin, y: height - L.top - L.logoSize, width: L.logoSize, height: L.logoSize });
    // Ribbon — top right, aspect ratio kept.
    const rw = (ribbon.width / ribbon.height) * L.ribbonHeight;
    page.drawImage(ribbon, { x: width - L.margin - rw, y: height - L.top - L.ribbonHeight - 2, width: rw, height: L.ribbonHeight });
    // Footer — across the bottom, aspect ratio kept.
    const fw = width - L.footerSideMargin * 2;
    const fh = (footer.height / footer.width) * fw;
    page.drawImage(footer, { x: L.footerSideMargin, y: L.footerBottom, width: fw, height: fh });
  }
}

export async function addLogoHeader(pdfDoc: PDFDocument, opts?: { firstPageOnly?: boolean }): Promise<void> {
  const bytes = await loadLogoBytes();
  const png = await pdfDoc.embedPng(bytes);
  const pages = pdfDoc.getPages();
  for (const page of opts?.firstPageOnly ? pages.slice(0, 1) : pages) {
    const { width, height } = page.getSize();
    page.drawImage(png, {
      x: (width - LOGO_SIZE) / 2,
      y: height - LOGO_MARGIN_TOP - LOGO_SIZE,
      width: LOGO_SIZE,
      height: LOGO_SIZE,
    });
  }
}
