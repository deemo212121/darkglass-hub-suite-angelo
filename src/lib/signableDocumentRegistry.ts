/**
 * Central metadata for every SignableDocumentType — one place mapping a
 * document type to its human label and its dedicated sign/fill route
 * (internal, logged-in vs external, no-login). Used by the "Signed
 * Employment Forms" combine-into-one-link action (ReportHRDaily.tsx) and
 * by the bundle wizard (SignBundlePage/ExternalSignBundlePage) so both
 * stay in sync with the per-type routes without duplicating this list.
 */
import type { SignableDocumentStatus, SignableDocumentType } from "@/lib/supabase/signableDocuments";

export interface SignableDocumentRegistryEntry {
  label: string;
  /** Route prefix for the logged-in flow, e.g. "/fill-w4" (+ "/$docId"). */
  internalPath: string;
  /** Route prefix for the no-login flow, e.g. "/fill-w4-external" (+ "/$docId"). */
  externalPath: string;
}

export const SIGNABLE_DOCUMENT_REGISTRY: Record<SignableDocumentType, SignableDocumentRegistryEntry> = {
  warning_form: { label: "Employee Warning Form", internalPath: "/sign-document", externalPath: "/sign-external" },
  promotion_form: { label: "Promotion / Role Change Form", internalPath: "/sign-promotion-form", externalPath: "/sign-promotion-external" },
  action_plan_form: { label: "Manager's Action Plan Form", internalPath: "/sign-action-plan-form", externalPath: "/sign-action-plan-external" },
  termination_form: { label: "Notice of Termination", internalPath: "/sign-termination-form", externalPath: "/sign-termination-external" },
  w8ben: { label: "Form W-8BEN", internalPath: "/fill-w8ben", externalPath: "/fill-w8ben-external" },
  w4: { label: "Form W-4", internalPath: "/fill-w4", externalPath: "/fill-w4-external" },
  w9: { label: "Form W-9", internalPath: "/fill-w9", externalPath: "/fill-w9-external" },
  w4r: { label: "Form W-4R", internalPath: "/fill-w4r", externalPath: "/fill-w4r-external" },
  i9: { label: "Form I-9", internalPath: "/fill-i9", externalPath: "/fill-i9-external" },
  wage_ack: { label: "Acknowledgment of Wage", internalPath: "/fill-wage-ack", externalPath: "/fill-wage-ack-external" },
  car_iq_agreement: { label: "Car IQ Technician Agreement", internalPath: "/fill-car-iq-agreement", externalPath: "/fill-car-iq-agreement-external" },
  vehicle_agreement: { label: "Company Vehicle Use Agreement", internalPath: "/fill-vehicle-agreement", externalPath: "/fill-vehicle-agreement-external" },
  employee_confidentiality: { label: "Employee Confidentiality Agreement", internalPath: "/fill-employee-confidentiality", externalPath: "/fill-employee-confidentiality-external" },
  meal_rest_break: { label: "Meal & Rest Break Acknowledgment", internalPath: "/fill-meal-rest-break", externalPath: "/fill-meal-rest-break-external" },
  pto_ack: { label: "PTO & Sick Leave Policy Acknowledgment", internalPath: "/fill-pto-ack", externalPath: "/fill-pto-ack-external" },
  parts_responsibility: { label: "Parts Responsibility & Floor Protection Acknowledgment", internalPath: "/fill-parts-responsibility", externalPath: "/fill-parts-responsibility-external" },
  mileage_fuel: { label: "Mileage & Fuel Policy Agreement", internalPath: "/fill-mileage-fuel", externalPath: "/fill-mileage-fuel-external" },
  location_consent: { label: "Location Sharing Consent Agreement", internalPath: "/fill-location-consent", externalPath: "/fill-location-consent-external" },
  damage: { label: "Damage Agreement", internalPath: "/fill-damage", externalPath: "/fill-damage-external" },
  contractor_data: { label: "Employee Data", internalPath: "/fill-contractor-data", externalPath: "/fill-contractor-data-external" },
  contractor_data_us: { label: "Contractor Data (US)", internalPath: "/fill-contractor-data-us", externalPath: "/fill-contractor-data-us-external" },
  direct_deposit: { label: "Direct Deposit Authorization", internalPath: "/fill-direct-deposit", externalPath: "/fill-direct-deposit-external" },
  substance_screening: { label: "Substance Screening & Conduct Agreement", internalPath: "/fill-substance-screening", externalPath: "/fill-substance-screening-external" },
  flash_technician_travel: { label: "Flash Technician Travel & Out-of-State Policy", internalPath: "/fill-flash-technician-travel", externalPath: "/fill-flash-technician-travel-external" },
  nda_form: { label: "Non-Disclosure Agreement", internalPath: "/sign-nda-form", externalPath: "/sign-nda-external" },
  vehicle_use_agreement: { label: "Vehicle Use Agreement", internalPath: "/fill-vehicle-use-agreement", externalPath: "/fill-vehicle-use-agreement-external" },
  contractor_addendum: { label: "Master Independent Contractor Subcontractor Agreement Addendum", internalPath: "/fill-contractor-addendum", externalPath: "/fill-contractor-addendum-external" },
  // No external (no-login) variant yet — every recipient of this one is an
  // existing AHS technician, not an outside candidate, so externalPath just
  // points at the same internal, login-gated route rather than a route that
  // doesn't exist.
  master_w2_agreement: { label: "Master W-2 Technician Agreement", internalPath: "/fill-master-w2-agreement", externalPath: "/fill-master-w2-agreement" },
  // Same reasoning as master_w2_agreement above — office recipients are all
  // existing AHS employees, not outside candidates.
  master_w2_office_agreement: { label: "Master W-2 Office Agreement", internalPath: "/fill-master-w2-office-agreement", externalPath: "/fill-master-w2-office-agreement" },
  // Same reasoning as master_w2_agreement above — PH recipients are all
  // existing AHS contractors, not outside candidates.
  master_ph_contractor_agreement: { label: "Master PH Contractor Agreement", internalPath: "/fill-master-ph-contractor-agreement", externalPath: "/fill-master-ph-contractor-agreement" },
};

export function signableDocumentLabel(type: SignableDocumentType): string {
  return SIGNABLE_DOCUMENT_REGISTRY[type]?.label ?? type;
}

/**
 * Same set of forms as ReportHRDaily.tsx's automatedFormsTechnicianTabs,
 * minus contractorDataUs/vehicleUseAgreement (those moved to the BM/SBS/
 * Tech Director tier, not rank-and-file technicians). Shared between
 * TechnicianFormChecklistPage.tsx (HR's live status view) and
 * technicianFormStatus.ts (a frozen technician's own "what do I still need
 * to sign" popup) so the two lists can never drift apart.
 */
export const TECHNICIAN_FORM_TYPES: SignableDocumentType[] = [
  "wage_ack",
  "car_iq_agreement",
  "vehicle_agreement",
  "damage",
  "direct_deposit",
  "employee_confidentiality",
  "contractor_data",
  "flash_technician_travel",
  "location_consent",
  "meal_rest_break",
  "mileage_fuel",
  "parts_responsibility",
  "pto_ack",
  "substance_screening",
  "w4",
  "i9",
];

/**
 * Of TECHNICIAN_FORM_TYPES, the subset that needs an HR/employer
 * countersignature AFTER the employee signs (ReportHRDaily.tsx's various
 * "*EmployerDialog"/"*ManagerDialog" review flows, each ending in a
 * confirmSignableDocument call) before the form is actually done — matches
 * every confirmSignableDocument call site keyed to a TECHNICIAN_FORM_TYPES
 * type in ReportHRDaily.tsx. For these, status "signed" only means the
 * EMPLOYEE'S half is done; "confirmed" is what actually finishes it. Every
 * other technician form type only ever needs the employee's own signature,
 * so "signed" already means done for those.
 *
 * i9 belongs here (Section 2, completed by HR, calls confirmSignableDocument
 * — see i9Section2Dialog in ReportHRDaily.tsx). w4 also belongs here: HR's
 * "Fill Employer Info" step (handleSaveW4EmployerInfo) now calls
 * confirmSignableDocument too, same as i9 Section 2 — a signed-but-not-yet-
 * employer-completed W-4 used to read as fully "done" on the Technician
 * Form Checklist the moment the employee signed, even though the W-4 Sent
 * History table itself still showed it as "Submitted" (not "Completed")
 * until HR filled in the employer fields — the checklist and the type's own
 * Sent History table must agree on what "done" means.
 */
export const DOCUMENT_TYPES_REQUIRING_EMPLOYER_SIGNATURE = new Set<SignableDocumentType>([
  "wage_ack",
  "damage",
  "flash_technician_travel",
  "location_consent",
  "meal_rest_break",
  "mileage_fuel",
  "parts_responsibility",
  "substance_screening",
  "i9",
  "w4",
  "master_w2_agreement",
  "master_w2_office_agreement",
  "master_ph_contractor_agreement",
]);

/**
 * Form W-4/I-9/Direct Deposit Authorization/W-8BEN each have exactly one
 * underlying document type and Sent History list, reused by BOTH the
 * legacy "Automated Forms" group's own tab and the "New Automation Forms"
 * group's tabs (New Technician/New Office/PH Staff) — rather than
 * duplicating four already-working send/sign flows per group. Without a
 * way to tell them apart, every send showed up in every group's Sent
 * History table AND every checklist tab that tracks that type, which reads
 * as "old forms leaking into new" (and vice versa) — the two are supposed
 * to stay separate. `formSource` is stamped into formData at send time (see
 * ReportHRDaily.tsx's handleSendW4/handleSendI9/handleSendDirectDeposit/
 * handleSendW8ben, keyed off which tab the send happened from) and survives
 * every later formData rewrite, since every fill page seeds its form state
 * from the existing formData and spreads that whole state back out on
 * submit (untyped extra keys ride along even though the page's own
 * FormData type doesn't declare them) — see e.g. FillI9Page.tsx's
 * `setForm((prev) => ({ ...prev, ...existing }))` / `finalData = { ...form, ... }`.
 */
export function isNewAutomationDoc(doc: { formData: Record<string, any> }): boolean {
  return doc.formData?.formSource === "new_automation";
}

/**
 * The subset of SignableDocumentType that TechnicianFormChecklistPage.tsx
 * bucket-filters by formSource before counting a document as "this
 * person's" for a given tab — every OTHER type (including w4/i9/
 * direct_deposit — see below) counts ANY matching document regardless of
 * which flow sent it.
 *
 * w4/i9/direct_deposit are deliberately NOT in this set even though
 * ReportHRDaily.tsx's own Sent History tables (visibleW4Forms/visibleI9Forms/
 * visibleDirectDepositForms) DO still separate them there — the user's
 * explicit call: these 3 are the exact same form regardless of which column
 * sent it (no content difference like the Master Agreements have), so
 * someone who already has a real W-4/I-9/Direct Deposit on file from the
 * OLD flow has genuinely satisfied the requirement and shouldn't show
 * "Not sent" on the New Technician/Office Staff (US)/PH Staff/BM+
 * checklist tabs just because it came from the old flow. The checklist
 * answers "does this person have this on file"; the Sent History tables
 * answer "what did THIS column send" — different questions, deliberately
 * different answers here.
 *
 * w8ben/w9/contractor_addendum stay bucket-filtered (new-only) — the user
 * scoped the "count old too" request to just w4/i9/direct_deposit. w9 and
 * contractor_addendum joined bucket-filtering once they each got their own
 * real "new" tab (newContractorAddendum/newW9) — before that, the BM/SBS/
 * Tech Director/Tech Assistant Director column's Contractor Addendum/W-9
 * rows reused the OLD group's shared tab/list outright with no way to tell
 * a genuinely new submission from a years-old one, which is exactly what
 * made a BM+ checklist row show "Awaiting employee signature" off a
 * pre-New-Automation-Forms submission that had nothing to do with it.
 */
export const SHARED_OLD_NEW_AUTOMATION_TYPES = new Set<SignableDocumentType>(["w8ben", "w9", "contractor_addendum"]);

/**
 * Where a signable document currently stands, from the "is this actually
 * finished" point of view — collapses the raw SignableDocumentStatus plus
 * "does this type even need an employer countersign" into one of four
 * buckets. Shared by TechnicianFormChecklistPage.tsx (HR's live status
 * view) and technicianFormStatus.ts (a frozen technician's own "what do I
 * still need to do" popup) so both agree on what counts as done.
 */
export type DocumentReviewStatus = "not_sent" | "awaiting_employee" | "awaiting_hr" | "done";

export function getDocumentReviewStatus(
  type: SignableDocumentType,
  doc: { status: SignableDocumentStatus } | undefined
): DocumentReviewStatus {
  if (!doc || doc.status === "cancelled") return "not_sent";
  if (doc.status === "confirmed") return "done";
  if (doc.status === "signed") {
    return DOCUMENT_TYPES_REQUIRING_EMPLOYER_SIGNATURE.has(type) ? "awaiting_hr" : "done";
  }
  return "awaiting_employee"; // pending_signature
}

const STATUS_RANK: Record<SignableDocumentStatus, number> = {
  confirmed: 3,
  signed: 2,
  pending_signature: 1,
  cancelled: 0,
};

/**
 * When the same (recipient, documentType) has more than one
 * hr_signable_documents row — a resend, a duplicate, an accidental
 * re-send-and-re-sign — this picks the one that should represent their
 * CURRENT status. Deliberately NOT "whichever was created most recently":
 * confirmed_at/signed_at (something a caller may draw a "as of" date from
 * separately) reflect real completion, and a later duplicate that's only
 * sitting at pending_signature must never make an earlier, genuinely
 * signed/confirmed row invisible — that's exactly the bug this fixes (a
 * technician who'd already completed a form showing "Not sent" again the
 * moment a second copy got sent). Best status wins outright; only when two
 * rows tie on status does the newer one win, purely for determinism.
 */
export function pickAuthoritativeDocument<T extends { status: SignableDocumentStatus; createdAt: string }>(
  docs: T[]
): T | undefined {
  if (docs.length === 0) return undefined;
  return docs.reduce((best, d) => {
    const rankDiff = STATUS_RANK[d.status] - STATUS_RANK[best.status];
    if (rankDiff > 0) return d;
    if (rankDiff < 0) return best;
    return d.createdAt > best.createdAt ? d : best;
  });
}

/**
 * Of TECHNICIAN_FORM_TYPES, the subset that only applies to SOME
 * technicians (Flash Technician Travel & Out-of-State Policy — only
 * out-of-state-travel techs need it) — these default to "N/A" instead of
 * "needed", the opposite of every other technician form. See
 * isTechnicianExemptFromForm/exemptionRowValueForToggle below for how that
 * inversion is layered on top of the SAME technician_form_exemptions table
 * used for ordinary opt-out N/A marks, without needing a second table.
 */
export const DEFAULT_EXEMPT_DOCUMENT_TYPES = new Set<SignableDocumentType>(["flash_technician_travel"]);

/**
 * Whether a technician should currently show as "N/A" for this document
 * type. For an ordinary type (not in DEFAULT_EXEMPT_DOCUMENT_TYPES), that's
 * just "does an exemption-table row exist" (opt-out semantics: needed by
 * default, a row means explicitly marked N/A).
 *
 * For a DEFAULT_EXEMPT_DOCUMENT_TYPES type, it's inverted (opt-in
 * semantics: N/A by default) — exempt UNLESS a document already exists for
 * them (HR sending one at all is proof it's applicable) OR HR explicitly
 * overrode the default via the same N/A checkbox, which for these types
 * means "this technician DOES need it" rather than "doesn't" — see
 * exemptionRowValueForToggle, which is what makes that checkbox write the
 * inverted value to storage.
 */
export function isTechnicianExemptFromForm(type: SignableDocumentType, hasDoc: boolean, hasExemptionRow: boolean): boolean {
  if (DEFAULT_EXEMPT_DOCUMENT_TYPES.has(type)) {
    return !hasDoc && !hasExemptionRow;
  }
  return hasExemptionRow;
}

/**
 * What boolean to pass to setTechnicianFormExemption when the "N/A"
 * checkbox is toggled to `checked` for this type — inverted for
 * DEFAULT_EXEMPT_DOCUMENT_TYPES, where checking the (already-defaulted-on)
 * box means "revert to the default N/A" (no row) and unchecking it means
 * "mark as an exception that DOES need this form" (create a row). See
 * isTechnicianExemptFromForm's doc comment for the full picture.
 */
export function exemptionRowValueForToggle(type: SignableDocumentType, checked: boolean): boolean {
  return DEFAULT_EXEMPT_DOCUMENT_TYPES.has(type) ? !checked : checked;
}
