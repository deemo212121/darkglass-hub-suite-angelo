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
  flash_technician_travel: { label: "Flash Tech Travel & Expense Policy Agreement", internalPath: "/fill-flash-technician-travel", externalPath: "/fill-flash-technician-travel-external" },
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
  // Same reasoning as master_w2_agreement above — BM/SBS/Director recipients
  // are all existing AHS employees, not outside candidates.
  master_w2_executive_agreement: { label: "W-2 Executive Exempt Management Agreement", internalPath: "/fill-master-w2-executive-agreement", externalPath: "/fill-master-w2-executive-agreement" },
  // Sent to everyone (every checklist tier). Login-only like the Master
  // agreements — recipients are existing AHS staff.
  confidentiality_noncompete_agreement: { label: "Master Confidentiality & Non-Compete Agreement", internalPath: "/fill-confidentiality-noncompete-agreement", externalPath: "/fill-confidentiality-noncompete-agreement" },
  // Every technician (New Technician tier). Login-only — recipients are
  // existing AHS technicians, so no external/no-login variant.
  performance_bonus_policy: { label: "Performance Bonus Policy & Acknowledgment Form", internalPath: "/fill-performance-bonus-policy", externalPath: "/fill-performance-bonus-policy" },
  // Signer is always an AHS teammate (a manager/HR staffer countersigning a
  // company-generated certificate) — same "internal recipients only"
  // reasoning as master_w2_agreement above, no external/no-login variant.
  certificate_of_employment: { label: "Certificate of Employment", internalPath: "/sign-coe-form", externalPath: "/sign-coe-form" },
  // Standalone ID-document submissions, split out of Contractor Data
  // Sheet / Master W-2 Technician & Office Agreements (US) and the Master
  // PH Contractor Agreement (PH), which used to each embed their own ID
  // upload field — see ssnCardFormTemplate.ts/driversLicenseFormTemplate.ts/
  // validIdFormTemplate.ts's header comments.
  ssn_card_form: { label: "SSN Card", internalPath: "/fill-ssn-card", externalPath: "/fill-ssn-card-external" },
  drivers_license_form: { label: "Driver's License", internalPath: "/fill-drivers-license", externalPath: "/fill-drivers-license-external" },
  valid_id_form: { label: "Valid ID", internalPath: "/fill-valid-id", externalPath: "/fill-valid-id-external" },
  // Sent ad hoc from Employee Monitoring's Visit Exception Report tab, not
  // an onboarding checklist item — recipient is always an existing AHS
  // technician, no external/no-login variant needed.
  visit_exception_report: { label: "Employee Attendance & Visit Exception Report", internalPath: "/fill-visit-exception-report", externalPath: "/fill-visit-exception-report" },
  // Every signer (employee, senior, exec, HR) is an existing AHS teammate —
  // no external/no-login variant.
  compensation_update: { label: "Promotion Paper and Wage Increase", internalPath: "/sign-compensation-update", externalPath: "/sign-compensation-update" },
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
  "drivers_license_form",
  "employee_confidentiality",
  "contractor_data",
  "location_consent",
  "meal_rest_break",
  "mileage_fuel",
  "parts_responsibility",
  "pto_ack",
  "ssn_card_form",
  "substance_screening",
  "w4",
  "i9",
  "confidentiality_noncompete_agreement",
];

/**
 * The "New Automation Forms" per-tier form sets — each tier's own
 * consolidated list, same 4 tiers TechnicianFormChecklistPage.tsx's
 * CHECKLIST_TABS tracks (that file imports these directly rather than
 * redeclaring them, so the two can never drift). Also used by
 * ReportHRDaily.tsx's Hiring "Required Forms" dialog (STAFF_FORM_TIERS
 * below) to let HR quick-select a candidate's forms by role/tier instead of
 * checking each one by hand.
 */
export const NEW_TECHNICIAN_FORM_TYPES: SignableDocumentType[] = ["master_w2_agreement", "w4", "i9", "direct_deposit", "ssn_card_form", "drivers_license_form", "confidentiality_noncompete_agreement", "performance_bonus_policy", "flash_technician_travel"];
export const OFFICE_STAFF_US_FORM_TYPES: SignableDocumentType[] = ["master_w2_office_agreement", "w4", "i9", "direct_deposit", "ssn_card_form", "drivers_license_form", "confidentiality_noncompete_agreement"];
export const PH_STAFF_FORM_TYPES: SignableDocumentType[] = ["master_ph_contractor_agreement", "w8ben", "direct_deposit", "valid_id_form", "confidentiality_noncompete_agreement"];
export const BM_AND_UP_FORM_TYPES: SignableDocumentType[] = ["master_w2_executive_agreement", "direct_deposit", "confidentiality_noncompete_agreement"];

export type StaffFormTier = "newTechnician" | "officeStaffUs" | "phStaff" | "bmAndUp";

/** Label + form set per tier, in the same order/wording as
 * TechnicianFormChecklistPage.tsx's own tab labels — kept here so any other
 * UI (e.g. ReportHRDaily.tsx's Hiring forms dialog) can offer the identical
 * role/tier picker without redefining the tiers itself. */
export const STAFF_FORM_TIERS: { key: StaffFormTier; label: string; formTypes: SignableDocumentType[] }[] = [
  { key: "newTechnician", label: "New Technician", formTypes: NEW_TECHNICIAN_FORM_TYPES },
  { key: "officeStaffUs", label: "Office Staff (US)", formTypes: OFFICE_STAFF_US_FORM_TYPES },
  { key: "phStaff", label: "PH Staff", formTypes: PH_STAFF_FORM_TYPES },
  { key: "bmAndUp", label: "BM, SBS, Tech Director, Tech Assistant Director", formTypes: BM_AND_UP_FORM_TYPES },
];

/**
 * Every document type a Hiring candidate could ever have — every type
 * EXCEPT the ones that only apply after someone is already an employee
 * (a warning, a promotion, an action plan, a termination). Derived from
 * SIGNABLE_DOCUMENT_REGISTRY (so a newly added document type is included
 * by default, not silently missed) rather than retyping the ~26-item list
 * by hand. Used by ReportHRDaily.tsx's Hiring tab to load only the
 * document types it can actually show instead of every signable document
 * company-wide (see getAllSignableDocuments) — that call alone used to
 * pull every warning/promotion/action-plan/termination form for every
 * employee's entire tenure, none of which Hiring ever renders.
 */
const EMPLOYEE_ONLY_DOCUMENT_TYPES = new Set<SignableDocumentType>(["warning_form", "promotion_form", "action_plan_form", "termination_form", "compensation_update"]);
export const HIRING_CANDIDATE_DOCUMENT_TYPES: SignableDocumentType[] = (
  Object.keys(SIGNABLE_DOCUMENT_REGISTRY) as SignableDocumentType[]
).filter((t) => !EMPLOYEE_ONLY_DOCUMENT_TYPES.has(t));

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
  "master_w2_executive_agreement",
  "visit_exception_report",
  // Like the other Master Agreements: done once the employer countersigns.
  "confidentiality_noncompete_agreement",
]);

/**
 * Master Confidentiality agreement wording now in use (see
 * confidentialityNonCompeteAgreementFormTemplate.ts, which re-exports this
 * as CNC_CURRENT_TEMPLATE_VERSION). Kept here, dependency-free, because the
 * checklist status below needs it too.
 */
export const CONFIDENTIALITY_AGREEMENT_CURRENT_VERSION = 3;

/**
 * Master W-2 Office & Logistics agreement wording now in use: version 2
 * (2026-10-26) names Admin Hub Solutions (heading, at-will clause, logo)
 * instead of US In Home Services. Same for the Master Confidentiality
 * agreement's version 3. Copies signed in the older wording stay valid —
 * see MIN_VALID_TEMPLATE_VERSION.
 */
export const MASTER_W2_OFFICE_AGREEMENT_CURRENT_VERSION = 2;

/**
 * Master Philippines Independent Contractor Comprehensive Agreement wording
 * now in use: version 2 (2026-10-26) names Admin Hub Solutions (heading,
 * Section 1, logo) instead of US In Home Services; title and content are
 * unchanged. Copies signed in version 1 stay valid — see
 * MIN_VALID_TEMPLATE_VERSION.
 */
export const MASTER_PH_CONTRACTOR_AGREEMENT_CURRENT_VERSION = 2;

/**
 * Flash travel form in use (see flashTechnicianTravelPdfFill.ts): version 2
 * (2026-10-12) is the "Flash Tech Travel & Expense Policy Agreement", which
 * replaced the "Flash Technician Travel & Out-of-State Policy" (version 1).
 */
export const FLASH_TRAVEL_CURRENT_VERSION = 2;

/** Document types whose wording has been replaced, and the version now in use. A missing form_data.templateVersion means 1. */
const CURRENT_TEMPLATE_VERSION: Partial<Record<SignableDocumentType, number>> = {
  confidentiality_noncompete_agreement: CONFIDENTIALITY_AGREEMENT_CURRENT_VERSION,
  flash_technician_travel: FLASH_TRAVEL_CURRENT_VERSION,
  master_w2_office_agreement: MASTER_W2_OFFICE_AGREEMENT_CURRENT_VERSION,
  master_ph_contractor_agreement: MASTER_PH_CONTRACTOR_AGREEMENT_CURRENT_VERSION,
};

/**
 * The oldest wording a signed copy still counts in, when that's older than
 * the current one — a wording change that doesn't need everyone to re-sign
 * (the 2026-10-26 switch to Admin Hub Solutions branding). Types not listed
 * need the current version.
 */
const MIN_VALID_TEMPLATE_VERSION: Partial<Record<SignableDocumentType, number>> = {
  confidentiality_noncompete_agreement: 2,
  master_w2_office_agreement: 1,
  master_ph_contractor_agreement: 1,
};

/** The wording version a NEW document of this type is sent in, or undefined for a type that has only ever had one. */
export function currentTemplateVersion(type: SignableDocumentType): number | undefined {
  return CURRENT_TEMPLATE_VERSION[type];
}

/**
 * Signed, but in an older wording than the one in use — a Master
 * Confidentiality agreement signed before version 2 (the "…Non-Compete…"
 * text, including the paper copies), or the old Flash Technician Travel &
 * Out-of-State Policy. Still on file, but the person needs to sign the new
 * version, so the checklist shows "Needs new version" and lets HR send it.
 */
export function isOutdatedDocument(doc: { documentType?: string; status: SignableDocumentStatus; formData?: Record<string, any> } | undefined): boolean {
  const type = doc?.documentType as SignableDocumentType | undefined;
  const needed = type ? MIN_VALID_TEMPLATE_VERSION[type] ?? CURRENT_TEMPLATE_VERSION[type] : undefined;
  return (
    !!doc &&
    needed != null &&
    (doc.status === "signed" || doc.status === "confirmed") &&
    !((Number(doc.formData?.templateVersion) || 1) >= needed)
  );
}

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
export type DocumentReviewStatus = "not_sent" | "awaiting_employee" | "awaiting_hr" | "done" | "outdated";

export function getDocumentReviewStatus(
  type: SignableDocumentType,
  doc: { documentType?: string; status: SignableDocumentStatus; recipientSlot?: string; formData?: Record<string, any> } | undefined
): DocumentReviewStatus {
  if (!doc || doc.status === "cancelled") return "not_sent";
  // "outdated" = signed in an old wording; the new version hasn't been sent yet (see isOutdatedDocument).
  if (isOutdatedDocument({ documentType: type, status: doc.status, formData: doc.formData })) return "outdated";
  if (doc.status === "confirmed") return "done";
  if (doc.status === "signed") {
    return DOCUMENT_TYPES_REQUIRING_EMPLOYER_SIGNATURE.has(type) ? "awaiting_hr" : "done";
  }
  // pending_signature usually means nobody's signed yet, but
  // reopenEmployerSignature/reassignSignableDocument (signableDocuments.ts)
  // also park an ALREADY employee-signed document back here — with
  // recipientSlot moved to "hr_staff" — while it's reopened for a redo of
  // just the employer signature. Same shape ReportHRDaily.tsx's own
  // isAwaitingEmployerStep already checks for. Without this, a reopened
  // document (employee's signature intact and untouched) wrongly showed
  // "Awaiting employee signature" + a "Remind" button here instead of
  // "Awaiting HR review".
  if (doc.recipientSlot === "hr_staff") return "awaiting_hr";
  return "awaiting_employee"; // pending_signature, recipientSlot "employee"
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
export function pickAuthoritativeDocument<T extends { status: SignableDocumentStatus; createdAt: string; documentType?: string; formData?: Record<string, any> }>(
  docs: T[]
): T | undefined {
  if (docs.length === 0) return undefined;
  // An agreement signed in an old wording ranks just above cancelled, so the
  // new version — even one still waiting for a signature — is what counts.
  const rank = (d: T) => (isOutdatedDocument(d) ? 0.5 : STATUS_RANK[d.status]);
  return docs.reduce((best, d) => {
    const rankDiff = rank(d) - rank(best);
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
