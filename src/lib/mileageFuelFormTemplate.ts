/**
 * Personal Vehicle Mileage and Fuel Policy Agreement — shared data types
 * only. Same architecture as partsResponsibilityFormTemplate.ts: the real
 * PDF (src/assets/PERSONAL VEHICLE MILEAGE AND FUEL POLICY AGREEMENT.pdf)
 * has NO AcroForm fields at all (confirmed by direct inspection), just
 * plain static text with underscore blanks — every value is drawn
 * directly onto the page via pdf-lib in mileageFuelPdfFill.ts, there's
 * nothing to name.
 *
 * Genuine two-party flow, same shape as Acknowledgment of Wage/Parts
 * Responsibility: the employee fills their name/branch and signs first
 * (FillMileageFuelPage.tsx, page 1 only); the "Employer Representative"
 * signature is added afterward, separately, by HR inside
 * ReportHRDaily.tsx's "Complete Employer Signature" dialog — a plain
 * signature pad, since the source document asks for nothing else from the
 * employer side. The employer's signature/date line lives on its own
 * second page, same split as Parts Responsibility (unlike Meal and Rest
 * Break, where both signature lines shared one page).
 *
 * Like Meal and Rest Break/PTO Acknowledgment/Parts Responsibility, the
 * source PDF's own blank asks for First/Middle/Last Name as three
 * separate underscore-blanks, so those are kept as three separate fields
 * — employeeName is a derived/display convenience recomputed from the
 * three parts whenever the employee submits.
 *
 * Branch is a dropdown for the same reason as every other automated form
 * here — the source PDF just prints a bare underscore blank next to
 * "Branch:" with no reference list at all, so the dropdown is the only UI
 * for it, same treatment Parts Responsibility's Branch line gets.
 */

export { CAR_IQ_BRANCHES as MILEAGE_FUEL_BRANCHES } from "./carIqAgreementFormTemplate";

export interface MileageFuelFormData {
  /** The employee's actual profile id — not shown on the document itself, just carried alongside for lookups. */
  employeeId: string;
  /** Derived display name — [firstName, middleName, lastName].filter(Boolean).join(" "). */
  employeeName: string;
  firstName: string;
  middleName: string;
  lastName: string;
  branch: string;
  employeeDateSigned: string;
  /** Raw canvas PNG as a data: URL — see w4FormTemplate.ts's header comment for why this is stored alongside the durable Firebase Storage signature URL. */
  employeeSignatureDataUrl: string;
  /** Blank until HR completes the "Complete Employer Signature" step. */
  employerDateSigned: string;
  employerSignatureDataUrl: string;
}

export interface MileageFuelSignature {
  name: string;
  url: string;
  signedAt: string;
}
