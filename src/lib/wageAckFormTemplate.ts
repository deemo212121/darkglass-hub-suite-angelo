/**
 * Acknowledgment of Wage & Compensation Structure — shared data types only.
 * Same architecture as w4rFormTemplate.ts: no HTML/CSS redraw. The real PDF
 * (src/assets/Acknowledgment of Wage.pdf) is rendered directly via pdf.js
 * in FillWageAckPage.tsx with input overlays at the real field positions,
 * and wageAckPdfFill.ts draws the collected values onto that same PDF.
 *
 * Unlike every other automated form in this app, this PDF has ZERO
 * AcroForm fields at all (confirmed by direct inspection) — it's a plain
 * static two-page document with underscore blanks drawn as literal text.
 * Every value here (name, date, both signatures) is drawn directly onto
 * the page via pdf-lib's page.drawText/drawImage, not set into a named
 * field — there's nothing to name.
 *
 * Genuine two-party flow, same shape as I-9 (see i9FormTemplate.ts's header
 * comment): the employee fills their name/effective date and signs first
 * (FillWageAckPage.tsx); the "Employer/Representative" signature is added
 * afterward, separately, by HR inside ReportHRDaily.tsx's "Complete
 * Employer Signature" dialog — a plain signature pad, since the source
 * document asks for nothing else from the employer side (no printed name/
 * title field like I-9's Section 2 has).
 */

export interface WageAckFormData {
  /** The employee's actual profile id — not shown on the document itself, just carried alongside for lookups. */
  employeeId: string;
  employeeName: string;
  effectiveDate: string;
  employeeDateSigned: string;
  /** Raw canvas PNG as a data: URL — see w4FormTemplate.ts's header comment for why this is stored alongside the durable Firebase Storage signature URL. */
  employeeSignatureDataUrl: string;
  /** Blank until HR completes the "Complete Employer Signature" step. */
  employerDateSigned: string;
  employerSignatureDataUrl: string;
}

export interface WageAckSignature {
  name: string;
  url: string;
  signedAt: string;
}
