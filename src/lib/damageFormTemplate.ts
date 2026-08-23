/**
 * Damage, Part Loss, and Tool Penalty Commission Deduction Agreement —
 * shared data types only. Same architecture as locationConsentFormTemplate.ts
 * (identical layout, same template family — DAMAGE.pdf's Employee
 * Name/Position/Title/Effective Date block and Employee/Employer
 * Representative signature block sit at the exact same x offsets as
 * Location Consent, just shifted down slightly on page 2 since this
 * document's body text is a couple lines longer): the real PDF
 * (src/assets/DAMAGE.pdf) has NO AcroForm fields at all (confirmed by
 * direct inspection), just plain static text with underscore blanks —
 * every value is drawn directly onto the page via pdf-lib in
 * damagePdfFill.ts, there's nothing to name.
 *
 * Genuine two-party flow, same shape as Location Consent: the employee
 * fills their name/position/effective date and signs first
 * (FillDamagePage.tsx, page 1 fields + page 2 signature); the "Employer
 * Representative" signature is added afterward, separately, by HR inside
 * ReportHRDaily.tsx's "Complete Employer Signature" dialog — a plain
 * signature pad, since the source document asks for nothing else from the
 * employer side.
 */

export interface DamageFormData {
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

export interface DamageSignature {
  name: string;
  url: string;
  signedAt: string;
}
