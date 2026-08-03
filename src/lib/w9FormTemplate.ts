/**
 * Form W-9 (Request for Taxpayer Identification Number and Certification)
 * — shared data types only. Same architecture as w4FormTemplate.ts: no
 * HTML/CSS redraw. The real PDF (src/assets/w9-blank.pdf) is rendered
 * directly via pdf.js in FillW9Page.tsx with input overlays at the real
 * field positions, and w9PdfFill.ts fills that same PDF's own AcroForm
 * fields for the generated document.
 *
 * Only page 1 (the actual submittable form) has fillable fields — pages
 * 2-6 are the IRS's own instructions, shown read-only for reference.
 *
 * "Requester's name and address (optional)" is fillable like everything
 * else — the person filling this out can note who requested it.
 *
 * There is no AcroForm field for Part II's "Signature of U.S. person" /
 * "Date" line — same situation as the W-4's Step 5, drawn directly onto
 * the page at coordinates derived from the actual caption text position.
 * Like the W-4, the signature is stored as signatureDataUrl (a data: URL)
 * alongside the durable Firebase Storage URL, so it can be redrawn later
 * without a cross-origin fetch.
 */

export type W9TaxClassification = "individual" | "c_corp" | "s_corp" | "partnership" | "trust_estate" | "llc" | "other" | "";

export interface W9FormData {
  /** The person's actual profile id — not shown on the document itself, just carried alongside for lookups. */
  employeeId: string;
  /** Line 1 — name of entity/individual. */
  name: string;
  /** Line 2 — business name/disregarded entity name, if different. */
  businessName: string;
  /** Line 3a. */
  taxClassification: W9TaxClassification;
  /** Only relevant when taxClassification === "llc" — single letter C/S/P. */
  llcTaxClassificationCode: string;
  /** Only relevant when taxClassification === "other". */
  otherClassificationText: string;
  /** Line 3b — foreign partners/owners/beneficiaries checkbox. */
  foreignPartnersCheckbox: boolean;
  /** Line 4. */
  exemptPayeeCode: string;
  fatcaExemptionCode: string;
  /** Line 5. */
  address: string;
  /** Line 6. */
  cityStateZip: string;
  /** Line 7 — optional. */
  accountNumbers: string;
  /** "Requester's name and address (optional)" box. */
  requesterNameAddress: string;
  /** Part I — SSN, split across the form's 3 boxed groups (3-2-4 digits). */
  ssnPart1: string;
  ssnPart2: string;
  ssnPart3: string;
  /** Part I — EIN, split across the form's 2 boxed groups (2-7 digits). */
  einPart1: string;
  einPart2: string;
  /** Part II — Certification. */
  dateSigned: string;
  /** Raw canvas PNG as a data: URL — see header comment for why this is stored alongside the durable Firebase Storage signature URL. */
  signatureDataUrl: string;
}

export interface W9Signature {
  name: string;
  url: string;
  signedAt: string;
}
