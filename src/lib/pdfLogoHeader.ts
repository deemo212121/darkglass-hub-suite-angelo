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
 * collide with existing text at this size.
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

export async function addLogoHeader(pdfDoc: PDFDocument): Promise<void> {
  const bytes = await loadLogoBytes();
  const png = await pdfDoc.embedPng(bytes);
  for (const page of pdfDoc.getPages()) {
    const { width, height } = page.getSize();
    page.drawImage(png, {
      x: (width - LOGO_SIZE) / 2,
      y: height - LOGO_MARGIN_TOP - LOGO_SIZE,
      width: LOGO_SIZE,
      height: LOGO_SIZE,
    });
  }
}
