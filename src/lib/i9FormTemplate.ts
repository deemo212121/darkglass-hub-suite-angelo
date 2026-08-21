/**
 * Form I-9 (Employment Eligibility Verification) — shared data types only.
 *
 * Same architecture as w4FormTemplate.ts: no HTML/CSS redraw. The real PDF
 * (src/assets/i-9.pdf) is rendered directly via pdf.js in FillI9Page.tsx
 * with input overlays at the real field positions for Section 1, and
 * i9PdfFill.ts fills that same PDF's own AcroForm fields for the generated
 * document.
 *
 * I-9 is a genuine two-party form (unlike W-4/W-8BEN/W-9, which are signed
 * by one recipient only): Section 1 is completed and signed by the employee
 * via FillI9Page.tsx; Section 2 (document review + employer/AR signature)
 * is completed separately, afterward, by HR via ReportHRDaily.tsx's
 * "Complete Section 2" dialog — same two-step shape the codebase already
 * uses for the Warning Form/Promotion Form's sequential signers, just with
 * only two slots ("employee" then "hr_staff") instead of many. Section 2
 * is a plain form (not a pdf.js overlay) since it's HR filling in a
 * follow-up section on an already-submitted document — same precedent as
 * the W-4 "Fill Employer Info" dialog, extended with a signature canvas
 * since Section 2 legally requires the employer/AR's own signature.
 *
 * Both "Signature of Employee" and "Signature of Employer or AR" are real
 * AcroForm text fields on this PDF, but — same as every other form in this
 * app — the hand-drawn signature PNG is drawn directly onto the page at
 * that field's rectangle instead of typing a name into it, so the signing
 * UX stays consistent across every automated form.
 */

export type I9CitizenshipStatus = "citizen" | "noncitizen_national" | "lawful_permanent_resident" | "noncitizen_authorized" | "";

export interface I9FormData {
  /** The employee's actual profile id — not shown on the document itself, just carried alongside for lookups. */
  employeeId: string;
  employeeName: string;

  // ── Section 1 — Employee Information and Attestation ──
  firstName: string;
  middleInitial: string;
  lastName: string;
  otherLastNames: string;
  address: string;
  aptNumber: string;
  city: string;
  state: string;
  zip: string;
  dateOfBirth: string;
  ssn: string;
  email: string;
  phone: string;
  citizenshipStatus: I9CitizenshipStatus;
  /** Only relevant when citizenshipStatus is "lawful_permanent_resident". */
  lprANumber: string;
  /** Only relevant when citizenshipStatus is "noncitizen_authorized". */
  workAuthExpDate: string;
  uscisANumber: string;
  i94Number: string;
  foreignPassport: string;
  employeeDateSigned: string;
  /** Raw canvas PNG as a data: URL — kept alongside the durable Firebase Storage signature URL so HR's Section 2 regeneration can redraw it without a cross-origin fetch (same reason as w4FormTemplate.ts's signatureDataUrl). */
  employeeSignatureDataUrl: string;

  // ── Section 2 — Employer Review and Verification (blank at submission time, filled in later by HR) ──
  /** Which document set HR examined — determines whether the List A row(s) or the List B + List C row is filled in. */
  documentChoice: "listA" | "listBC" | "";
  listADocTitle1: string;
  listAIssuing1: string;
  listADocNumber1: string;
  listAExp1: string;
  listADocTitle2: string;
  listAIssuing2: string;
  listADocNumber2: string;
  listAExp2: string;
  listADocTitle3: string;
  listAIssuing3: string;
  listADocNumber3: string;
  listAExp3: string;
  listBDocTitle1: string;
  listBIssuing1: string;
  listBDocNumber1: string;
  listBExp1: string;
  listCDocTitle1: string;
  listCIssuing1: string;
  listCDocNumber1: string;
  listCExp1: string;
  additionalInfo: string;
  /** "Documents examined using an alternative procedure authorized by DHS" (remote document examination). */
  altProcedureCheckbox: boolean;
  firstDayEmployed: string;
  employerNameTitle: string;
  employerSignatureDataUrl: string;
  section2DateSigned: string;
  businessName: string;
  businessAddress: string;
}

export interface I9Signature {
  name: string;
  url: string;
  signedAt: string;
}
