/**
 * Company Vehicle Use Agreement — shared data types only. Same
 * architecture as carIqAgreementFormTemplate.ts: the real PDF
 * (src/assets/COMPANY VEHICLE USE AGREEMENT.pdf) has NO AcroForm fields at
 * all (confirmed by direct inspection) — every value is drawn directly
 * onto the page via pdf-lib in vehicleAgreementPdfFill.ts, there's nothing
 * to name.
 *
 * Single-party, same shape as W-4R/Car IQ — one recipient fills in and
 * signs, no employer/HR co-signature step. Unlike Car IQ, there's no
 * separate "I AGREE" checkbox on this document — signing itself is the
 * agreement (the 21 numbered guidelines are just read-only reference text
 * above the signature block).
 *
 * Branch is a dropdown for the same reason as Car IQ's: this source PDF's
 * own 26 "[ ] BRANCH" checkboxes are missing San Antonio too, so the
 * selected branch is printed directly next to the "Branch:" label instead
 * of checking one of the source boxes — works uniformly for every branch.
 *
 * The source PDF's own blank asks for First/Last Name as two separate
 * underscore-blanks (no middle name field on this one), so those are kept
 * as two separate fields — employeeName is a derived/display convenience
 * recomputed from the two parts whenever the employee submits, same
 * convention Meal and Rest Break/PTO Acknowledgment use.
 */

export { CAR_IQ_BRANCHES as VEHICLE_AGREEMENT_BRANCHES } from "./carIqAgreementFormTemplate";

export interface VehicleAgreementFormData {
  /** The employee's actual profile id — not shown on the document itself, just carried alongside for lookups. */
  employeeId: string;
  /** Derived display name — [firstName, lastName].filter(Boolean).join(" "). */
  employeeName: string;
  firstName: string;
  lastName: string;
  branch: string;
  dateSigned: string;
  /** Raw canvas PNG as a data: URL — see w4FormTemplate.ts's header comment for why this is stored alongside the durable Firebase Storage signature URL. */
  signatureDataUrl: string;
}

export interface VehicleAgreementSignature {
  name: string;
  url: string;
  signedAt: string;
}
