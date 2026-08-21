/**
 * Employee Meal and Rest Break Policy Acknowledgment — shared data types
 * only. Same architecture as wageAckFormTemplate.ts: the real PDF
 * (src/assets/EMPLOYEE MEAL AND REST BREAK POLICY ACKNOWLEDGMENT.pdf) has
 * NO AcroForm fields at all (confirmed by direct inspection), just plain
 * static text with underscore blanks — every value is drawn directly onto
 * the page via pdf-lib in mealRestBreakPdfFill.ts, there's nothing to name.
 *
 * Genuine two-party flow, same shape as Acknowledgment of Wage: the
 * employee fills their name/branch and signs first
 * (FillMealRestBreakPage.tsx); the "Employer Representative" signature is
 * added afterward, separately, by HR inside ReportHRDaily.tsx's "Complete
 * Employer Signature" dialog — a plain signature pad, since the source
 * document asks for nothing else from the employer side. Unlike Wage Ack,
 * this whole document (both signature lines included) fits on a single
 * page.
 *
 * The source PDF's own blank asks for First/Middle/Last Name as three
 * separate underscore-blanks (not one combined "Full Name" line like Wage
 * Ack/Car IQ/Vehicle Agreement/Confidentiality), so those are kept as
 * three separate fields here — employeeName is a derived/display
 * convenience (same convention W-4/W-4R already use via
 * firstNameMiddleInitial + lastName), recomputed from the three parts
 * whenever the employee submits.
 *
 * Branch is a dropdown for the same reason as Car IQ's/Vehicle
 * Agreement's/Confidentiality's: a fixed, known set of branches, so a
 * free-text blank would just invite typos — the selected branch is printed
 * directly next to the "Branch:" label.
 */

export { CAR_IQ_BRANCHES as MEAL_REST_BREAK_BRANCHES } from "./carIqAgreementFormTemplate";

export interface MealRestBreakFormData {
  /** The employee's actual profile id — not shown on the document itself, just carried alongside for lookups. */
  employeeId: string;
  /** Derived display name — [firstName, middleName, lastName].filter(Boolean).join(" "). Kept alongside the three real fields so the rest of the app (Sent History tables, Signed Employment Forms panel, etc.) can read a single field the same way every other form does. */
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

export interface MealRestBreakSignature {
  name: string;
  url: string;
  signedAt: string;
}
