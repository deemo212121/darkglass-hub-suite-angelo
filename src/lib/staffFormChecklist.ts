/**
 * Staff Form Checklist's tabs and its "is this person done?" rules, shared
 * by the page itself (TechnicianFormChecklistPage) and Home's attention
 * strip, which tells HR / Admin / Super Admin when someone has finished
 * every form (getStaffWhoFinishedAllForms below).
 */
import { brandOf, type FormBrand } from "@/lib/formBrand";
import type { ProfileRow } from "@/lib/supabase/users";
import { getCompanyUsers } from "@/lib/supabase/users";
import { isEligibleForTechnicianFormChecklist, isBmAndUpRole } from "@/lib/roleLabels";
import { getSignableDocumentsByTypes, type SignableDocument, type SignableDocumentType } from "@/lib/supabase/signableDocuments";
import {
  SIGNABLE_DOCUMENT_REGISTRY,
  TECHNICIAN_FORM_TYPES,
  NEW_TECHNICIAN_FORM_TYPES,
  OFFICE_STAFF_US_FORM_TYPES,
  PH_STAFF_FORM_TYPES,
  MEXICO_STAFF_FORM_TYPES,
  BM_AND_UP_FORM_TYPES,
  getDocumentReviewStatus,
  isTechnicianExemptFromForm,
  pickAuthoritativeDocument,
  isNewAutomationDoc,
  SHARED_OLD_NEW_AUTOMATION_TYPES,
} from "@/lib/signableDocumentRegistry";
import { getTechnicianFormExemptions } from "@/lib/supabase/technicianFormExemptions";
import { LOCATIONS_DATA } from "@/lib/zipCoverage";
import { contractorAgreementCountryOf, CONTRACTOR_AGREEMENT_SHORT_TITLE, type ContractorAgreementCountry } from "@/lib/masterPhContractorAgreementFormTemplate";

// Same derivation ReportHRDaily.tsx's onboarding/attendance splits use for
// "PH" vs "US" — there's no real country column, just branch membership in
// the Philippines subset of LOCATIONS_DATA.
export const PH_BRANCH_NAMES = new Set(LOCATIONS_DATA.filter((l) => l.isPhilippines).map((l) => l.location));
export const isPhBranch = (u: ProfileRow) => PH_BRANCH_NAMES.has(u.assigned_branch || "");
// Mexico Staff — the same idea: anyone assigned to the Mexico branch.
export const MX_BRANCH_NAMES = new Set(LOCATIONS_DATA.filter((l) => l.isMexico).map((l) => l.location));
export const isMxBranch = (u: ProfileRow) => MX_BRANCH_NAMES.has(u.assigned_branch || "");

export type ChecklistTabKey = "technician" | "newTechnician" | "officeStaffUs" | "officeStaffUsAhs" | "phStaff" | "ahsPhStaff" | "mexicoStaff" | "bmAndUp";

/**
 * The AHS Forms PH forms that come in two versions — the original US In Home
 * Services one and the Admin Hub Solutions one (HR Paperworks → AHS Forms PH;
 * see lib/formBrand.ts). That tab sends these in their AHS version (its
 * `ahsFormTypes`); Office Staff (US) AHS has its own list.
 */
export const BRANDED_FORM_TYPES = new Set<SignableDocumentType>(["master_ph_contractor_agreement", "confidentiality_noncompete_agreement", "direct_deposit", "valid_id_form"]);
/**
 * The ones that must be signed in the tab's own version to count — the
 * agreements naming the employer (Master PH Contractor Agreement, Master
 * Confidentiality, Master W-2 Office & Logistics). Everything else carries
 * over: either version of Direct Deposit / Valid ID counts on both PH Staff
 * and AHS Forms PH (like W-8BEN), and Office Staff (US) AHS shares every
 * other Office Staff (US) form.
 */
export const VERSION_REQUIRED_FORM_TYPES = new Set<SignableDocumentType>(["master_ph_contractor_agreement", "confidentiality_noncompete_agreement", "master_w2_office_agreement"]);
/** What Office Staff (US) AHS sends in the Admin Hub Solutions version — only the two agreements; its other forms (Direct Deposit included) go out as usual. */
export const AHS_OFFICE_STAFF_US_FORM_TYPES = new Set<SignableDocumentType>(["master_w2_office_agreement", "confidentiality_noncompete_agreement"]);
/**
 * The AHS Forms PH checklist — the same forms as HR Paperworks' AHS Forms PH
 * group. The Anti-Cloning Agreement is Admin Hub Solutions-only (no US In
 * Home Services version), so it isn't in BRANDED_FORM_TYPES.
 */
export const AHS_PH_STAFF_FORM_TYPES: SignableDocumentType[] = ["master_ph_contractor_agreement", "confidentiality_noncompete_agreement", "w8ben", "direct_deposit", "valid_id_form", "ph_anti_cloning_agreement"];

export interface ChecklistTabConfig {
  key: ChecklistTabKey;
  label: string;
  formTypes: SignableDocumentType[];
  isEligible: (u: ProfileRow) => boolean;
  /** Plural noun used in "N technicians" / "No office staff found." messaging. */
  noun: string;
  /**
   * Which formSource bucket this tab's SHARED_OLD_NEW_AUTOMATION_TYPES
   * (w4/i9/direct_deposit/w8ben) should count — "old" for the original
   * Technician tab (only pre-New-Automation-Forms submissions), "new" for
   * every other tab (only submissions sent through their own "New
   * Automation Forms" flow). A form type NOT in SHARED_OLD_NEW_AUTOMATION_TYPES
   * (the Master Agreements, Contractor Addendum, W-9) ignores this — there's
   * no old/new split for those yet, so every submission counts regardless.
   */
  formSourceBucket: "old" | "new";
  /** Which version of the VERSION_REQUIRED_FORM_TYPES this tab counts; unset = any. */
  brand?: FormBrand;
  /** The forms this tab sends in their Admin Hub Solutions version (brand "ahs" tabs). */
  ahsFormTypes?: ReadonlySet<SignableDocumentType>;
  /** Which country version of the contractor agreement this tab counts and sends — Mexico Staff "mx"; unset = the Philippines one. */
  country?: ContractorAgreementCountry;
}

/** Whether a copy counts on this tab: the agreements naming the employer in the tab's brand, the contractor agreement in its country. */
export function countsOnTab(d: Pick<SignableDocument, "documentType" | "formData">, config: ChecklistTabConfig): boolean {
  if (config.brand && VERSION_REQUIRED_FORM_TYPES.has(d.documentType) && brandOf(d.formData) !== config.brand) return false;
  if (d.documentType === "master_ph_contractor_agreement" && contractorAgreementCountryOf(d.formData) !== (config.country ?? "ph")) return false;
  return true;
}
/** The form's name on this tab — the contractor agreement is the Master Mexico Contractor Agreement on Mexico Staff. */
export function formLabelOnTab(type: SignableDocumentType, config: ChecklistTabConfig): string {
  if (type === "master_ph_contractor_agreement") return CONTRACTOR_AGREEMENT_SHORT_TITLE[config.country ?? "ph"];
  return SIGNABLE_DOCUMENT_REGISTRY[type]?.label ?? type;
}

/**
 * Identity photos collected alongside a Master Agreement's own typed
 * fields (technicianIdDocuments.ts — private-bucket paths on the
 * document's formData, never a plaintext SSN column). Not part of the
 * signed PDF itself, so they need their own "view" links here rather than
 * riding along with the doc's pdfUrl-driven one above.
 */
/**
 * SSN Card / Driver's License / Valid ID (their own standalone forms now —
 * see ssnCardFormTemplate.ts/driversLicenseFormTemplate.ts/
 * validIdFormTemplate.ts) can also be satisfied by an ID photo already on
 * file from the OLD Master Agreement that used to collect it inline
 * (technicianIdDocuments.ts's private-bucket paths). Someone who already
 * uploaded their license/SSN card/government ID through the old flow
 * shouldn't have to redo it just because the field moved to its own form —
 * this used to render as a separate "ID"/"License"/"SSN Card" sub-row
 * nested under the Master Agreement row; now it's folded straight into
 * whichever standalone row it satisfies instead (see findLegacyIdSource
 * below), so there's exactly one row per requirement, not two.
 */
export const LEGACY_ID_SOURCES: Partial<Record<SignableDocumentType, { fromType: SignableDocumentType; field: string }[]>> = {
  ssn_card_form: [
    { fromType: "master_w2_agreement", field: "ssnCardPhotoPath" },
    { fromType: "master_w2_office_agreement", field: "ssnCardPhotoPath" },
  ],
  drivers_license_form: [
    { fromType: "master_w2_agreement", field: "licensePhotoPath" },
    { fromType: "master_w2_office_agreement", field: "licensePhotoPath" },
  ],
  valid_id_form: [{ fromType: "master_ph_contractor_agreement", field: "governmentIdPhotoPath" }],
};

/** The legacy Master Agreement doc + field satisfying `type`, if any — null when `type` has no legacy source or none of them have the photo on file. */
export function findLegacyIdSource(
  type: SignableDocumentType,
  docMap: Map<SignableDocumentType, SignableDocument | undefined>
): { doc: SignableDocument; field: string } | null {
  for (const src of LEGACY_ID_SOURCES[type] ?? []) {
    const doc = docMap.get(src.fromType);
    if (doc?.formData?.[src.field]) return { doc, field: src.field };
  }
  return null;
}

export const CHECKLIST_TABS: ChecklistTabConfig[] = [
  {
    key: "technician",
    label: "Technician",
    formTypes: TECHNICIAN_FORM_TYPES,
    isEligible: (u) => isEligibleForTechnicianFormChecklist(u.role, u.extra_roles),
    noun: "technicians",
    formSourceBucket: "old",
  },
  {
    key: "newTechnician",
    label: "New Technician",
    formTypes: NEW_TECHNICIAN_FORM_TYPES,
    isEligible: (u) => isEligibleForTechnicianFormChecklist(u.role, u.extra_roles),
    noun: "technicians",
    formSourceBucket: "new",
  },
  {
    key: "officeStaffUs",
    label: "Office Staff (US)",
    formTypes: OFFICE_STAFF_US_FORM_TYPES,
    isEligible: (u) => !isPhBranch(u) && !isMxBranch(u) && !isBmAndUpRole(u.role) && !isEligibleForTechnicianFormChecklist(u.role, u.extra_roles),
    noun: "office staff",
    formSourceBucket: "new",
    // The US In Home Services agreements — AHS copies count on Office Staff (US) AHS instead.
    brand: "usihs",
  },
  {
    // Same people and forms as Office Staff (US); the Master W-2 Office &
    // Logistics and Master Confidentiality agreements are their Admin Hub
    // Solutions versions here, everything else carries over.
    key: "officeStaffUsAhs",
    label: "Office Staff (US) AHS",
    formTypes: OFFICE_STAFF_US_FORM_TYPES,
    isEligible: (u) => !isPhBranch(u) && !isMxBranch(u) && !isBmAndUpRole(u.role) && !isEligibleForTechnicianFormChecklist(u.role, u.extra_roles),
    noun: "office staff",
    formSourceBucket: "new",
    brand: "ahs",
    ahsFormTypes: AHS_OFFICE_STAFF_US_FORM_TYPES,
  },
  {
    key: "phStaff",
    label: "PH Staff",
    formTypes: PH_STAFF_FORM_TYPES,
    isEligible: (u) => isPhBranch(u),
    noun: "PH staff",
    formSourceBucket: "new",
    // The US In Home Services set — AHS copies count on the AHS Forms PH tab instead.
    brand: "usihs",
  },
  {
    key: "ahsPhStaff",
    label: "AHS Forms PH",
    formTypes: AHS_PH_STAFF_FORM_TYPES,
    isEligible: (u) => isPhBranch(u),
    noun: "PH staff",
    formSourceBucket: "new",
    brand: "ahs",
    ahsFormTypes: BRANDED_FORM_TYPES,
  },
  {
    // Like PH Staff, with the Mexico version of the contractor agreement.
    key: "mexicoStaff",
    label: "Mexico Staff",
    formTypes: MEXICO_STAFF_FORM_TYPES,
    isEligible: (u) => isMxBranch(u),
    noun: "Mexico staff",
    formSourceBucket: "new",
    brand: "usihs",
    country: "mx",
  },
  {
    key: "bmAndUp",
    label: "BM, SBS, Tech Director, Tech Assistant Director",
    formTypes: BM_AND_UP_FORM_TYPES,
    isEligible: (u) => isBmAndUpRole(u.role),
    noun: "management staff",
    formSourceBucket: "new",
  },
];

export function isComplete(doc: SignableDocument | undefined, type: SignableDocumentType): boolean {
  return getDocumentReviewStatus(type, doc) === "done";
}

/**
 * A tab's documents, one per "personId|documentType" — the row that reached
 * the best status (pickAuthoritativeDocument), counting only copies this tab
 * accepts. "person" is formData.employeeId, not recipientId: recipientId
 * moves to the HR staffer who countersigns, so a finished two-party form
 * would otherwise drop off the person's row.
 */
export function latestDocsForTab(docs: SignableDocument[], config: ChecklistTabConfig): Map<string, SignableDocument> {
  const byKey = new Map<string, SignableDocument[]>();
  for (const d of docs) {
    const personId = (d.formData as Record<string, any> | undefined)?.employeeId || d.recipientId;
    if (!personId) continue;
    // W-4 / I-9 / Direct Deposit / W-8BEN only count from this tab's own old/new flow.
    if (SHARED_OLD_NEW_AUTOMATION_TYPES.has(d.documentType) && isNewAutomationDoc(d) !== (config.formSourceBucket === "new")) continue;
    // The Master PH Contractor Agreement counts on its own version's tab only (Direct Deposit / Valid ID carry over) — and its own country's.
    if (!countsOnTab(d, config)) continue;
    const key = `${personId}|${d.documentType}`;
    const arr = byKey.get(key);
    if (arr) arr.push(d);
    else byKey.set(key, [d]);
  }
  const latest = new Map<string, SignableDocument>();
  for (const [key, group] of byKey) {
    const best = pickAuthoritativeDocument(group);
    if (best) latest.set(key, best);
  }
  return latest;
}

/** One person's progress on a tab: their form per type, the ones marked Not Applicable, how many are done, and when the last of those was finished. */
export function tabProgress(
  profileId: string,
  config: ChecklistTabConfig,
  latest: Map<string, SignableDocument>,
  exemptions: Set<string>
): { docs: Map<SignableDocumentType, SignableDocument | undefined>; exempt: Set<SignableDocumentType>; doneCount: number; applicableTotal: number; lastDoneAt: string | null } {
  // Two passes: findLegacyIdSource needs every type in docs first.
  const docs = new Map<SignableDocumentType, SignableDocument | undefined>();
  for (const type of config.formTypes) docs.set(type, latest.get(`${profileId}|${type}`));
  const exempt = new Set<SignableDocumentType>();
  let doneCount = 0;
  let lastDoneAt: string | null = null;
  const stamp = (d: SignableDocument) => d.confirmedAt || d.signedAt || d.createdAt;
  for (const type of config.formTypes) {
    const doc = docs.get(type);
    if (isTechnicianExemptFromForm(type, !!doc, exemptions.has(`${profileId}|${type}`))) {
      exempt.add(type);
      continue;
    }
    const legacy = isComplete(doc, type) ? null : findLegacyIdSource(type, docs);
    if (isComplete(doc, type) || legacy) {
      doneCount++;
      const at = stamp(legacy ? legacy.doc : doc!);
      if (at && (!lastDoneAt || at > lastDoneAt)) lastDoneAt = at;
    }
  }
  return { docs, exempt, doneCount, applicableTotal: config.formTypes.length - exempt.size, lastDoneAt };
}

export interface FinishedAllForms {
  profileId: string;
  name: string;
  /** When their last form was finished. */
  finishedAt: string;
}

const FINISHED_CACHE_MS = 5 * 60_000;
let finishedCache: { at: number; data: FinishedAllForms[] } | null = null;

/**
 * Active people who have every form done on a checklist tab they belong to
 * (any one of them — e.g. PH Staff or AHS Forms PH). The old "Technician"
 * tab is left out; it's hidden on the page by default. Cached 5 minutes.
 */
export async function getStaffWhoFinishedAllForms(): Promise<FinishedAllForms[]> {
  if (finishedCache && Date.now() - finishedCache.at < FINISHED_CACHE_MS) return finishedCache.data;
  const tabs = CHECKLIST_TABS.filter((t) => t.key !== "technician");
  const types = Array.from(new Set(tabs.flatMap((t) => t.formTypes)));
  const [users, docs, exemptions] = await Promise.all([getCompanyUsers() as Promise<ProfileRow[]>, getSignableDocumentsByTypes(types), getTechnicianFormExemptions(types)]);
  const latestByTab = new Map(tabs.map((t) => [t.key, latestDocsForTab(docs, t)]));
  const out: FinishedAllForms[] = [];
  for (const u of users) {
    if (!u.is_active) continue;
    let finishedAt: string | null = null;
    for (const t of tabs) {
      if (!t.isEligible(u)) continue;
      const p = tabProgress(u.id, t, latestByTab.get(t.key)!, exemptions);
      if (p.applicableTotal > 0 && p.doneCount === p.applicableTotal && p.lastDoneAt && (!finishedAt || p.lastDoneAt < finishedAt)) finishedAt = p.lastDoneAt;
    }
    if (finishedAt) out.push({ profileId: u.id, name: u.display_name || u.username || u.email || "Unnamed", finishedAt });
  }
  finishedCache = { at: Date.now(), data: out };
  return out;
}

// Home's "finished all forms" card counts people who finished since this
// viewer last opened Staff Form Checklist — kept per person in this browser.
// Never opened it: the last 7 days.
const SEEN_KEY = (uid: string) => `ahs.staffFormChecklist.seenAt.${uid}`;
// Local dev only: a switch on the checklist page that makes Home's card show
// everyone who ever finished, to preview it. Ignored in a deployed build.
const PREVIEW_KEY = "ahs.staffFormChecklist.previewAll";
export function staffFormNoticePreviewOn(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return localStorage.getItem(PREVIEW_KEY) === "1";
  } catch {
    return false;
  }
}
export function setStaffFormNoticePreview(on: boolean): void {
  try {
    if (on) localStorage.setItem(PREVIEW_KEY, "1");
    else localStorage.removeItem(PREVIEW_KEY);
  } catch {
    // storage blocked — preview stays off
  }
}
export function staffFormChecklistSeenAt(uid: string): string {
  if (staffFormNoticePreviewOn()) return "1970-01-01T00:00:00.000Z";
  try {
    const v = localStorage.getItem(SEEN_KEY(uid));
    if (v) return v;
  } catch {
    // storage blocked — fall through
  }
  return new Date(Date.now() - 7 * 86_400_000).toISOString();
}
export function markStaffFormChecklistSeen(uid: string): void {
  try {
    localStorage.setItem(SEEN_KEY(uid), new Date().toISOString());
  } catch {
    // storage blocked — the card just stays until it ages out
  }
}
