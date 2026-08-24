/**
 * Substance Screening & Conduct Agreement — shared data types only. Same
 * architecture as employeeConfidentialityFormTemplate.ts /
 * carIqAgreementFormTemplate.ts: the real PDF
 * (src/assets/SUBSTANCE SCREENING & CONDUCT AGREEMENT.pdf) has NO AcroForm
 * fields at all (confirmed by direct inspection) — every value is drawn
 * directly onto the page via pdf-lib in substanceScreeningPdfFill.ts,
 * there's nothing to name.
 *
 * Single-party, same shape as Car IQ/Vehicle Agreement/Employee
 * Confidentiality — one recipient fills in and signs, no employer/HR
 * co-signature step. The source PDF's own "Company Representative
 * Signature" line is left blank on the generated PDF (filled by hand
 * later, outside this app) — no separate "I AGREE" checkbox, signing
 * itself is the agreement.
 *
 * No branch field — unlike most of the other technician forms, this PDF
 * never references a branch anywhere.
 */

export interface SubstanceScreeningFormData {
  /** The employee's actual profile id — not shown on the document itself, just carried alongside for lookups. */
  employeeId: string;
  employeeName: string;
  dateSigned: string;
  /** Raw canvas PNG as a data: URL — see w4FormTemplate.ts's header comment for why this is stored alongside the durable Firebase Storage signature URL. */
  signatureDataUrl: string;
}
