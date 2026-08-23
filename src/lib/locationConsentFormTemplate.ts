/**
 * Employee Mobile App Location Sharing Consent Agreement — shared data
 * types only. Same architecture as wageAckFormTemplate.ts: the real PDF
 * (src/assets/EMPLOYEE MOBILE APP LOCATION SHARING CONSENT AGREEMENT.pdf)
 * has NO AcroForm fields at all (confirmed by direct inspection), just
 * plain static text with underscore blanks — every value is drawn
 * directly onto the page via pdf-lib in locationConsentPdfFill.ts,
 * there's nothing to name.
 *
 * Genuine two-party flow, same shape as Acknowledgment of Wage: the
 * employee fills their name/position/effective date and signs first
 * (FillLocationConsentPage.tsx, page 1 fields + page 2 signature); the
 * "Employer Representative" signature is added afterward, separately, by
 * HR inside ReportHRDaily.tsx's "Complete Employer Signature" dialog — a
 * plain signature pad, since the source document asks for nothing else
 * from the employer side.
 *
 * Unlike every other automated form in this app, this document's Employee
 * Name is a single blank (not split First/Middle/Last), and there's no
 * Branch field at all — it also uniquely asks for a "Position / Title"
 * blank, which no other form here has.
 */

export interface LocationConsentFormData {
  /** The employee's actual profile id — not shown on the document itself, just carried alongside for lookups. */
  employeeId: string;
  employeeName: string;
  positionTitle: string;
  effectiveDate: string;
  employeeDateSigned: string;
  /** Raw canvas PNG as a data: URL — see w4FormTemplate.ts's header comment for why this is stored alongside the durable Firebase Storage signature URL. */
  employeeSignatureDataUrl: string;
  /** Blank until HR completes the "Complete Employer Signature" step. */
  employerDateSigned: string;
  employerSignatureDataUrl: string;
}

export interface LocationConsentSignature {
  name: string;
  url: string;
  signedAt: string;
}
