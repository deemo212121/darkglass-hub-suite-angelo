/**
 * Form W-4 (Employee's Withholding Certificate) — shared data types only.
 *
 * Same architecture as w8benFormTemplate.ts: no HTML/CSS redraw. The real
 * PDF (src/assets/w4-blank.pdf) is rendered directly via pdf.js in
 * FillW4Page.tsx with input overlays at the real field positions, and
 * w4PdfFill.ts fills that same PDF's own AcroForm fields for the generated
 * document.
 *
 * The recipient sees and can fill in three pages: page 1 (the actual
 * submittable Employee's Withholding Certificate), page 3 (Multiple Jobs
 * Worksheet — supports Step 2(b)), and page 4 (Deductions Worksheet —
 * supports Step 4(b)), since both worksheets have real fillable fields.
 * Page 2 (general instructions) and page 5 (Privacy Act notice) have no
 * fields and are shown read-only for reference.
 *
 * The "Employers Only" box (employer name/address, first date of
 * employment, EIN) is blank at submission time — it's HR/payroll's own
 * section, completed afterward via ReportHRDaily.tsx's "Fill Employer Info"
 * dialog. That dialog doesn't patch the already-generated PDF (which would
 * mean fetching it back from Firebase Storage — a cross-origin read that
 * needs CORS configured on the bucket); instead it re-runs fillW4Pdf from
 * scratch against the ALREADY-STORED formData (a plain same-origin Supabase
 * read, not Firebase Storage) plus the newly-typed employer fields,
 * regenerating the entire PDF fresh from the local blank template. The
 * employee's signature is preserved the same way: signatureDataUrl below
 * stores the raw canvas PNG as a data: URL (small, same-origin-safe,
 * re-fetchable with a plain `fetch()` with no CORS involved at all) rather
 * than only the durable Firebase Storage URL, so it can be redrawn onto the
 * regenerated PDF without any cross-origin fetch either.
 */

export type W4FilingStatus = "single_or_mfs" | "married_filing_jointly" | "head_of_household" | "";

export interface W4FormData {
  /** The employee's actual profile id — not shown on the document itself, just carried alongside for lookups. */
  employeeId: string;
  firstNameMiddleInitial: string;
  lastName: string;
  ssn: string;
  address: string;
  cityStateZip: string;
  filingStatus: W4FilingStatus;
  /** Step 2(c) — "if there are only two jobs total, you may check this box instead of using the worksheet." */
  multipleJobsCheckbox: boolean;
  /** Step 3 — dollar amounts the employee themselves computes (qualifying children x $2,000, other dependents x $500, and the total). */
  step3ChildrenAmount: string;
  step3OtherDependentsAmount: string;
  step3TotalAmount: string;
  /** Step 4 — optional. */
  step4aOtherIncome: string;
  step4bDeductions: string;
  step4cExtraWithholding: string;
  /** "Exempt from Withholding" — separate from Steps 1-5, just above Step 5's signature line. */
  exemptCheckbox: boolean;
  dateSigned: string;
  /** Raw canvas PNG as a data: URL — see header comment for why this is stored alongside the durable Firebase Storage signature URL. */
  signatureDataUrl: string;

  // "Employers Only" box — blank at submission time, filled in later by HR.
  employerNameAndAddress: string;
  employerFirstDateOfEmployment: string;
  employerEin: string;

  // Page 3 — Multiple Jobs Worksheet (only relevant if using this instead of Step 2(c)'s checkbox).
  mjwLine1: string;
  mjwLine2a: string;
  mjwLine2b: string;
  mjwLine2c: string;
  mjwLine3: string;
  mjwLine4: string;

  // Page 4 — Deductions Worksheet (only relevant if claiming itemized deductions in Step 4(b)).
  dwLine1a: string;
  dwLine1b: string;
  dwLine1c: string;
  dwLine2: string;
  dwLine3a: string;
  dwLine3b: string;
  dwLine4: string;
  dwLine5: string;
  dwLine6a: string;
  dwLine6b: string;
  dwLine6c: string;
  dwLine6d: string;
  dwLine6e: string;
  dwLine7: string;
  dwLine8a: string;
  dwLine8b: string;
  dwLine9: string;
  dwLine10: string;
  dwLine11: string;
  dwLine12: string;
  dwLine13: string;
  dwLine14: string;
  dwLine15: string;
}

export interface W4Signature {
  name: string;
  url: string;
  signedAt: string;
}
