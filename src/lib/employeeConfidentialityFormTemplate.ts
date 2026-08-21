/**
 * Employee Confidentiality and Non-Disclosure Agreement — shared data types
 * only. Same architecture as vehicleAgreementFormTemplate.ts /
 * carIqAgreementFormTemplate.ts: the real PDF
 * (src/assets/EMPLOYEE CONFIDENTIALITY AND NON (1).pdf) has NO AcroForm
 * fields at all (confirmed by direct inspection) — every value is drawn
 * directly onto the page via pdf-lib in
 * employeeConfidentialityPdfFill.ts, there's nothing to name.
 *
 * Single-party, same shape as W-4R/Car IQ/Vehicle Agreement — one recipient
 * fills in and signs, no employer/HR co-signature step. No separate "I
 * AGREE" checkbox — signing itself is the agreement, same as Vehicle
 * Agreement.
 *
 * Branch is a dropdown for the same reason as Car IQ's / Vehicle
 * Agreement's: this source PDF's own parenthetical branch reference list is
 * missing San Antonio too, so the selected branch is printed directly next
 * to the "Branch:" label instead of relying on the source PDF's own list —
 * works uniformly for every branch.
 */

export { CAR_IQ_BRANCHES as EMPLOYEE_CONFIDENTIALITY_BRANCHES } from "./carIqAgreementFormTemplate";

export interface EmployeeConfidentialityFormData {
  /** The employee's actual profile id — not shown on the document itself, just carried alongside for lookups. */
  employeeId: string;
  employeeName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  branch: string;
  dateSigned: string;
  /** Raw canvas PNG as a data: URL — see w4FormTemplate.ts's header comment for why this is stored alongside the durable Firebase Storage signature URL. */
  signatureDataUrl: string;
}

export interface EmployeeConfidentialitySignature {
  name: string;
  url: string;
  signedAt: string;
}
