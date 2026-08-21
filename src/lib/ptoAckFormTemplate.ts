/**
 * Employee Paid Time Off (PTO) and Sick Leave Policy Acknowledgment —
 * shared data types only. Same architecture as
 * mealRestBreakFormTemplate.ts: the real PDF
 * (src/assets/EMPLOYEE PAID TIME OFF.pdf) has NO AcroForm fields at all
 * (confirmed by direct inspection), just plain static text with underscore
 * blanks and reference checkboxes — every value is drawn directly onto the
 * page via pdf-lib in ptoAckPdfFill.ts, there's nothing to name.
 *
 * Single-party, same shape as Vehicle Agreement/Car IQ/Confidentiality —
 * the employee fills in their name/branch and signs; no employer
 * co-signature step (the source PDF prints "Employer: US IN HOME SERVICES"
 * as static text, not a second signature line). No separate "I AGREE"
 * checkbox — signing itself is the agreement.
 *
 * Like Meal and Rest Break, the source PDF's own blank asks for
 * First/Middle/Last Name as three separate underscore-blanks, so those are
 * kept as three separate fields — employeeName is a derived/display
 * convenience recomputed from the three parts whenever the employee
 * submits.
 *
 * Branch is a dropdown for the same reason as every other automated form
 * here: the source PDF's own 26 "[ ] BRANCH, ST" checkboxes are missing
 * San Antonio, so the selected branch is printed directly next to the
 * "Branch: Please Select:" label instead of checking one of the source
 * boxes — works uniformly for every branch.
 */

export { CAR_IQ_BRANCHES as PTO_ACK_BRANCHES } from "./carIqAgreementFormTemplate";

export interface PtoAckFormData {
  /** The employee's actual profile id — not shown on the document itself, just carried alongside for lookups. */
  employeeId: string;
  /** Derived display name — [firstName, middleName, lastName].filter(Boolean).join(" "). Kept alongside the three real fields so the rest of the app (Sent History tables, Signed Employment Forms panel, etc.) can read a single field the same way every other form does. */
  employeeName: string;
  firstName: string;
  middleName: string;
  lastName: string;
  branch: string;
  dateSigned: string;
  /** Raw canvas PNG as a data: URL — see w4FormTemplate.ts's header comment for why this is stored alongside the durable Firebase Storage signature URL. */
  signatureDataUrl: string;
}

export interface PtoAckSignature {
  name: string;
  url: string;
  signedAt: string;
}
