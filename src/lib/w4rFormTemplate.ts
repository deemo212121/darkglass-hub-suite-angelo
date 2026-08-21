/**
 * Form W-4R (Withholding Certificate for Nonperiodic Payments and Eligible
 * Rollover Distributions) — shared data types only. Same architecture as
 * w4FormTemplate.ts/w9FormTemplate.ts: no HTML/CSS redraw. The real PDF
 * (src/assets/fw4r.pdf) is rendered directly via pdf.js in
 * FillW4RPage.tsx with input overlays at the real field positions, and
 * w4rPdfFill.ts fills that same PDF's own AcroForm fields for the
 * generated document.
 *
 * Single recipient, single page of real fields (page 1) — same simple
 * shape as W-4/W-8BEN/W-9, not a two-party flow like I-9. Pages 2-3 are the
 * IRS's own General Instructions / Marginal Rate Tables / Privacy Act
 * notice, shown read-only for reference.
 *
 * There is no AcroForm field for the "Sign Here" row's "Your signature" /
 * "Date" line — same situation as every other IRS form in this app — drawn
 * directly onto the page at coordinates derived from the actual caption
 * text position (extracted via pdf.js's text-position API). The signature
 * is stored as signatureDataUrl (a data: URL) alongside the durable
 * Firebase Storage URL, so it can be redrawn later without a cross-origin
 * fetch (same reason as w4FormTemplate.ts's header comment).
 */

export interface W4RFormData {
  /** The person's actual profile id — not shown on the document itself, just carried alongside for lookups. */
  employeeId: string;
  firstNameMiddleInitial: string;
  lastName: string;
  ssn: string;
  address: string;
  cityStateZip: string;
  /** Line 2 — whole number 0-100, blank means the default withholding rate applies (10% nonperiodic / 20% eligible rollover). */
  withholdingRatePercent: string;
  dateSigned: string;
  /** Raw canvas PNG as a data: URL — see header comment for why this is stored alongside the durable Firebase Storage signature URL. */
  signatureDataUrl: string;
}

export interface W4RSignature {
  name: string;
  url: string;
  signedAt: string;
}
