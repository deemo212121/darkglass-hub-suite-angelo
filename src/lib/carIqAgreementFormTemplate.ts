/**
 * Car IQ Technician Agreement Form — shared data types only. Same
 * architecture as wageAckFormTemplate.ts: the real PDF
 * (src/assets/Car IQ Technician Agreement Form.pdf) has NO AcroForm fields
 * at all (confirmed by direct inspection) — every value is drawn directly
 * onto the page via pdf-lib in carIqAgreementPdfFill.ts, there's nothing to
 * name.
 *
 * Single-party, same shape as W-4R — one recipient fills in and signs,
 * no employer/HR co-signature step.
 *
 * Branch is a dropdown here rather than the source PDF's own 26 individual
 * "[ ] BRANCH" checkboxes (spread across two pages) — cleaner to fill, and
 * lets the list include a branch (San Antonio) that isn't one of the
 * source PDF's checkbox options at all. The selected branch is printed
 * directly next to the "Branch:" label instead of checking one of the
 * source boxes, so this works uniformly for every branch including ones
 * with no matching checkbox.
 */

export const CAR_IQ_BRANCHES = [
  "Asheville", "Atlanta", "Birmingham", "Cape Girardeau", "Chattanooga", "Columbus", "Destin", "Huntsville",
  "Jackson MS", "Jackson TN", "Jacksonville", "Jonesboro", "Knoxville", "Little Rock", "Memphis", "Mobile",
  "Montgomery", "Nashville", "New Orleans", "Norfolk", "Raleigh", "Richmond", "San Antonio", "St. Louis",
  "Savannah", "Tallahassee", "Wilmington",
] as const;

export interface CarIqAgreementFormData {
  /** The employee's actual profile id — not shown on the document itself, just carried alongside for lookups. */
  employeeId: string;
  employeeName: string;
  branch: string;
  /** "I AGREE" checkbox — required, this is the whole point of the document. */
  agreed: boolean;
  dateSigned: string;
  /** Raw canvas PNG as a data: URL — see w4FormTemplate.ts's header comment for why this is stored alongside the durable Firebase Storage signature URL. */
  signatureDataUrl: string;
}

export interface CarIqAgreementSignature {
  name: string;
  url: string;
  signedAt: string;
}
