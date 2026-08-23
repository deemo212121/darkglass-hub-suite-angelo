/**
 * Parts Responsibility and Technician Floor Protection Acknowledgment Form
 * — shared data types only. Same architecture as
 * mealRestBreakFormTemplate.ts: the real PDF
 * (src/assets/Parts Responsibility and Technician Floor Protection Acknowledgment Form.pdf)
 * has NO AcroForm fields at all (confirmed by direct inspection), just
 * plain static text with underscore blanks — every value is drawn
 * directly onto the page via pdf-lib in
 * partsResponsibilityPdfFill.ts, there's nothing to name.
 *
 * Genuine two-party flow, same shape as Acknowledgment of Wage/Meal and
 * Rest Break: the technician fills their name/branch and signs first
 * (FillPartsResponsibilityPage.tsx); the "Manager/Supervisor" signature is
 * added afterward, separately, by HR inside ReportHRDaily.tsx's "Complete
 * Manager Signature" dialog — a plain signature pad, since the source
 * document asks for nothing else from the manager side. Both signature
 * lines live on the single second page.
 *
 * Like Meal and Rest Break/PTO Acknowledgment, the source PDF's own blank
 * asks for First/Middle/Last Name as three separate underscore-blanks, so
 * those are kept as three separate fields — employeeName is a
 * derived/display convenience recomputed from the three parts whenever the
 * technician submits. The source PDF's "Technician's Printed Name:" blank
 * is filled with that same derived name rather than asking the technician
 * to retype it.
 *
 * Branch is a dropdown for the same reason as every other automated form
 * here — unlike Vehicle Agreement/Car IQ/Confidentiality/PTO, this source
 * PDF doesn't even print its own reference checkbox list, just a bare
 * "Please Select: (Branches)" prompt, so the dropdown is the only UI for
 * it.
 */

export { CAR_IQ_BRANCHES as PARTS_RESPONSIBILITY_BRANCHES } from "./carIqAgreementFormTemplate";

export interface PartsResponsibilityFormData {
  /** The technician's actual profile id — not shown on the document itself, just carried alongside for lookups. */
  employeeId: string;
  /** Derived display name — [firstName, middleName, lastName].filter(Boolean).join(" "). Also drawn onto the "Technician's Printed Name:" blank so the technician never has to retype it. */
  employeeName: string;
  firstName: string;
  middleName: string;
  lastName: string;
  branch: string;
  technicianDateSigned: string;
  /** Raw canvas PNG as a data: URL — see w4FormTemplate.ts's header comment for why this is stored alongside the durable Firebase Storage signature URL. */
  technicianSignatureDataUrl: string;
  /** Blank until HR/the manager completes the "Complete Manager Signature" step. */
  managerDateSigned: string;
  managerSignatureDataUrl: string;
}

export interface PartsResponsibilitySignature {
  name: string;
  url: string;
  signedAt: string;
}
