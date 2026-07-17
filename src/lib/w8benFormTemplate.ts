/**
 * Form W-8BEN — shared data types only.
 *
 * There is no HTML/CSS template here anymore — every rendering of this
 * document (HR's preview, the recipient's fill page, the final downloaded
 * record) uses the REAL official PDF (src/assets/w8ben-blank.pdf) directly:
 * FillW8benPage.tsx renders its actual page to a canvas via pdf.js and
 * overlays real inputs at the field's own coordinates, and w8benPdfFill.ts
 * fills the PDF's own AcroForm fields for the generated document. Nothing
 * is redrawn, so there's no template markup to keep in sync here.
 *
 * Part II (Claim of Tax Treaty Benefits) is a normal fillable section like
 * the rest of the form — the recipient fills it in themselves if it
 * applies to them; it's never auto-filled with any company-standard claim.
 */

export interface W8benAddress {
  street: string;
  /** Combined "City or town, state or province. Include postal code where appropriate." — matches the real form's single line for this. */
  cityStateZip: string;
  country: string;
}

export interface W8benFormData {
  /** The employee's actual profile id — not shown on the document itself, just carried alongside for lookups. */
  employeeId: string;
  employeeName: string;
  countryOfCitizenship: string;
  permanentAddress: W8benAddress;
  /** Left entirely blank if the same as the permanent address. */
  mailingAddress: W8benAddress;
  usTin: string;
  ftin: string;
  ftinNotRequired: boolean;
  referenceNumbers: string;
  dateOfBirth: string;
  /** Part II, line 9 — optional; only relevant if claiming tax treaty benefits. */
  treatyResidentCountry: string;
  /** Part II, line 10. */
  treatyArticleParagraph: string;
  treatyRate: string;
  treatyIncomeType: string;
  treatyAdditionalConditions: string;
  certifiedTrue: boolean;
  dateSigned: string;
}

export interface W8benSignature {
  name: string;
  url: string;
  signedAt: string;
}
