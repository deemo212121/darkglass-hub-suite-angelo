/**
 * Substance Screening & Conduct Agreement — shared data types only. Same
 * architecture as employeeConfidentialityFormTemplate.ts /
 * carIqAgreementFormTemplate.ts: the real PDF
 * (src/assets/SUBSTANCE SCREENING & CONDUCT AGREEMENT.pdf) has NO AcroForm
 * fields at all (confirmed by direct inspection) — every value is drawn
 * directly onto the page via pdf-lib in substanceScreeningPdfFill.ts,
 * there's nothing to name.
 *
 * Genuine two-party flow, same shape as Location Sharing Consent: the
 * employee fills in and signs first (FillSubstanceScreeningPage.tsx), and
 * the source PDF's own "Company Representative Signature" line — no
 * separate "I AGREE" checkbox, signing itself is the agreement — is added
 * afterward, separately, by HR inside ReportHRDaily.tsx's "Complete
 * Employer Signature" dialog, a plain signature pad since the source
 * document asks for nothing else from the employer side.
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
  /** Blank until HR completes the "Complete Employer Signature" step. */
  employerDateSigned: string;
  employerSignatureDataUrl: string;
}
