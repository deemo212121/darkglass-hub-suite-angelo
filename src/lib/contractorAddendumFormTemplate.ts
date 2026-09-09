/**
 * Master Independent Contractor Subcontractor Agreement Addendum — data
 * types + the full document body.
 *
 * Unlike every other PDF-overlay HR form, this one has NO pre-made source
 * PDF in src/assets: contractorAddendumPdf.ts builds the whole multi-page
 * document from CONTRACTOR_ADDENDUM_BLOCKS below with pdf-lib. So the
 * "blanks" are underscore runs it draws itself — plain, no yellow highlight
 * (the source Word doc highlighted the Position Level / Baseline Payout
 * blanks; the generated PDF must not) — and every overlay coordinate is one
 * this app controls rather than measures off a scanned file.
 *
 * Five-party signing chain (recipient signs first, then HR routes it on in
 * order — see reassignSignableDocument / the "Send to next signer" action):
 *   employee       → Subcontractor / Contractor  (also fills the 3 fields)
 *   hr_staff       → Company HR Representative
 *   manager        → Managerial Witness 1 — Technical COO
 *   senior_manager → Managerial Witness 2 — Technical Director
 *   executive      → Managerial Witness 3 — CEO
 */
import type { SignatureSlot } from "@/lib/supabase/signableDocuments";

export const CONTRACTOR_ADDENDUM_SLOT_ORDER: SignatureSlot[] = [
  "employee",
  "hr_staff",
  "manager",
  "senior_manager",
  "executive",
];

/** Party name printed above each signature line, and used in the routing UI. */
export const CONTRACTOR_ADDENDUM_SLOT_LABEL: Record<SignatureSlot, string> = {
  employee: "Subcontractor / Contractor",
  hr_staff: "Company HR Representative",
  manager: "Managerial Witness 1 — Technical COO",
  senior_manager: "Managerial Witness 2 — Technical Director",
  executive: "Managerial Witness 3 — CEO",
};

/**
 * The three managerial-witness seats are fixed people — their printed names
 * are pre-filled on every new addendum so the witness only has to sign.
 * (Editable on the sign page in case a seat changes hands.)
 */
export const CONTRACTOR_ADDENDUM_DEFAULT_SIGNER_NAMES: Partial<Record<SignatureSlot, string>> = {
  manager: "Yujung Chris Yong",
  senior_manager: "Daven Hodge",
  executive: "Justin Lee",
};

function normalizeRoleTokens(role: string | null | undefined, extraRoles?: string[] | null): string[] {
  return [role, ...(extraRoles ?? [])]
    .map((r) => (r ?? "").toUpperCase().replace(/[\s_-]/g, ""));
}

/** ADMIN / SUPERADMIN (company) / SUPERSUPERADMIN (platform) — may open, fill, and sign any part of an addendum regardless of who it's currently routed to. */
export function canManageContractorAddendum(role: string | null | undefined, extraRoles?: string[] | null): boolean {
  return normalizeRoleTokens(role, extraRoles).some((r) => r === "ADMIN" || r === "SUPERADMIN" || r === "SUPERSUPERADMIN");
}

/** Who may sign a given slot from the internal sign page: the assigned recipient always; managers/admins for any slot; anyone carrying an HR (or "HR Manager") role for the Company HR Representative slot. */
export function canSignContractorAddendumSlot(slot: SignatureSlot, role: string | null | undefined, extraRoles?: string[] | null): boolean {
  if (canManageContractorAddendum(role, extraRoles)) return true;
  if (slot === "hr_staff") {
    return normalizeRoleTokens(role, extraRoles).some((r) => r === "HR" || r === "HRMANAGER");
  }
  return false;
}

export interface ContractorAddendumFormData {
  /** The Contractor's profile id when sent to an AHS teammate; "" for an external recipient. Not printed. */
  employeeId: string;
  /** Fillable field at the top of page 1. */
  positionLevel: string;
  /** Fillable field at the top of page 1 — dollars per calendar month, digits only. */
  baselinePayout: string;
  /** Printed name on each signature block, keyed by slot (the Contractor's is entered on the fill page; the rest default to each signer's display name). */
  signerNames: Partial<Record<SignatureSlot, string>>;
  /** ISO timestamp each slot signed at. */
  datesSigned: Partial<Record<SignatureSlot, string>>;
  /** Raw canvas PNG data: URLs per slot — kept alongside the durable Firebase Storage signature URLs (see w4FormTemplate.ts for the rationale). */
  signatureDataUrls: Partial<Record<SignatureSlot, string>>;
}

export function blankContractorAddendumData(): ContractorAddendumFormData {
  return {
    employeeId: "",
    positionLevel: "",
    baselinePayout: "",
    signerNames: {},
    datesSigned: {},
    signatureDataUrls: {},
  };
}

/** Which slots still need a signature, in routing order (excludes ones already in `signatures`). */
export function remainingContractorAddendumSlots(signed: Partial<Record<SignatureSlot, unknown>>): SignatureSlot[] {
  return CONTRACTOR_ADDENDUM_SLOT_ORDER.filter((s) => !signed[s]);
}

// ── Document body ────────────────────────────────────────────────────────
// Transcribed verbatim from the client's Word document. The layout engine
// in contractorAddendumPdf.ts renders these top to bottom, breaking pages
// automatically; `field` blocks record an overlay rectangle for the fill
// page, `sign` blocks record the signature/date/name rectangles per slot.

export type AddendumBlock =
  | { kind: "title"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "p"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "note"; text: string }
  | { kind: "gap"; pt: number }
  | { kind: "field"; name: "positionLevel" | "baselinePayout"; before: string; after?: string }
  | { kind: "signHeading"; text: string }
  | { kind: "sign"; slot: SignatureSlot; role: string };

export const CONTRACTOR_ADDENDUM_BLOCKS: AddendumBlock[] = [
  { kind: "title", text: "MASTER INDEPENDENT CONTRACTOR SUBCONTRACTOR AGREEMENT ADDENDUM" },
  { kind: "gap", pt: 6 },
  { kind: "field", name: "positionLevel", before: "Position Level: " },
  { kind: "note", text: "[Branch Manager / Senior Branch Manager (SBM) / Technical Assistant Director / Technical Director]" },
  { kind: "field", name: "baselinePayout", before: "Guaranteed Minimum Baseline Payout: $", after: "  per calendar month" },
  { kind: "p", text: "Company Name: US In Home Services (US Appliance, Inc.)" },
  { kind: "gap", pt: 4 },

  { kind: "h2", text: "SECTION 1. Independent Contractor Baseline Payout & Risk Mitigation Structure" },
  { kind: "p", text: "The parties explicitly acknowledge and agree that the Subcontractor/Contractor operates strictly as an independent business entity (1099) and not as an employee. The minimum monthly baseline compensation of $[Amount] represents a performance-linked commercial floor and minimum baseline payout for regional operational output. This baseline does not constitute a traditional wage or salary basis, but rather functions as a contractual performance guarantee for achieving designated business metrics and branch service standards." },

  { kind: "h2", text: "SECTION 2. Absolute Operational Autonomy and Professional Discretion" },
  { kind: "p", text: "The Contractor retains absolute, unencumbered independence, professional discretion, and final decision-making authority over the operational methods, timing, routing, and execution of branch services. The Company shall not exercise micro-management, direct supervision over daily schedules, or behavioral control. The Contractor's primary duties encompass:" },
  { kind: "bullet", text: "Enterprise & Branch Operations Management: Directing regional workflows, site scheduling, and resource allocation independently." },
  { kind: "bullet", text: "Personnel & Compliance Oversight: Managing local field staff, enforcing safety standards, and executing compliance obligations to protect corporate assets without corporate interference." },

  { kind: "h2", text: "SECTION 3. Real-Time Operational Correction & Contractor Protection Protocol" },
  { kind: "p", text: "To preserve the Contractor's independent status and protect them from operational liabilities arising from urgent corporate directives, the Company maintains a mandatory Real-Time Compliance Correction Protocol. If the Company issues an urgent operational order, instruction, or scheduling directive during real-time business execution that inadvertently encroaches upon the Contractor's independent judgment, creates legal exposure, or conflicts with independent contractor guidelines, the Company is structurally obligated to issue an immediate formal correction, countermand, or adjustment. This ensures the Contractor's legal standing, professional autonomy, and operational integrity are instantly safeguarded and fully corrected in real time." },

  { kind: "h2", text: "SECTION 4. Scope of Work & Independent Execution" },
  { kind: "p", text: "The Subcontractor agrees to perform all work assigned by US In Home Services in a professional, safe, timely, and workmanlike manner and in accordance with all applicable laws, regulations, manufacturer requirements, warranty company requirements, and project specifications." },
  { kind: "bullet", text: "The Subcontractor determines the manner and means by which services are performed, subject to performance standards and customer requirements." },
  { kind: "bullet", text: "Nothing in this Agreement shall be construed as guaranteeing any minimum amount of work (other than the baseline payout specified herein), compensation, or continued engagement." },

  { kind: "h2", text: "SECTION 5. Parts Responsibility & Inventory Accountability" },
  { kind: "p", text: "The Subcontractor is fully responsible for all parts assigned for service calls." },
  { kind: "bullet", text: "If any part is lost, misplaced, or not returned as required, the cost of the part will be deducted from compensation." },
  { kind: "bullet", text: "Parts must be handled with care, properly tracked, and returned when necessary. Repeated loss of parts may result in further administrative actions or contract termination." },

  { kind: "h2", text: "SECTION 6. Floor Protection & Operational Property Safety" },
  { kind: "bullet", text: "Subcontractors/Technicians are required to use floor protection mats when moving any appliance." },
  { kind: "bullet", text: "A clear photo showing proper floor mat usage is required for all service tickets." },
  { kind: "bullet", text: "If floor damage occurs and required photos are not provided showing use of protective floor mats, the Subcontractor may be held responsible for the cost of damages (up to 50% of the total cost of damages, not to exceed $1,000)." },

  { kind: "h2", text: "SECTION 7. Communication Safety, Software, and Mobile Device Usage" },
  { kind: "bullet", text: "Subcontractors utilizing mobile devices, software applications, or navigation tools must strictly adhere to hands-free protocols while driving. Manual operation of handheld phones while driving is strictly prohibited." },
  { kind: "bullet", text: "Access to company software, digital tools, and communication channels is provided to facilitate independent business operations and does not constitute an employment relationship or behavioral control." },

  { kind: "h2", text: "SECTION 8. Car IQ Usage Guidelines & Fuel Management" },
  { kind: "bullet", text: "Car IQ Usage Restrictions: Car IQ can only be used on days where the contractor is actively running tickets. DO NOT use Car IQ the night before tickets are run, or the morning after tickets were run." },
  { kind: "bullet", text: "Vehicle Restriction: Car IQ funds can only be charged to the registered vehicle under the contractor's name in the system." },
  { kind: "bullet", text: "Business Travel Authorization: If travelling for business purposes (travelling to a training facility, flash tech travel, etc.), the contractor must secure prior approval for usage from HR AND the Senior Branch Manager BEFORE travel begins." },
  { kind: "bullet", text: "Violations: Failure to follow these guidelines will result in pay deductions equal to the dollar amount of improper usage, removal from the Car IQ system, tier demotion, or contract termination." },

  { kind: "h2", text: "SECTION 9. Responsibility for Property Damage & Indemnification" },
  { kind: "bullet", text: "The Subcontractor shall be solely responsible for any property damage, personal injury, or other loss caused by the Subcontractor, its employees, agents, representatives, or anyone acting on its behalf." },
  { kind: "bullet", text: "If the Company compensates a customer for damages caused by the Subcontractor, the Subcontractor agrees to fully reimburse the Company for all amounts paid, investigative costs, and legal fees." },
  { kind: "bullet", text: "To the fullest extent permitted by law, the Company may offset, withhold, or deduct such amounts from commissions, payments, or compensation. If damages exceed amounts owed, the remaining balance is due within thirty (30) days of written notice." },
  { kind: "bullet", text: "The Subcontractor shall indemnify, defend, and hold harmless US In Home Services and its affiliates from all claims arising out of the Subcontractor's acts, omissions, or negligence." },

  { kind: "h2", text: "SECTION 10. Insurance & Risk Allocation" },
  { kind: "bullet", text: "The Company maintains liability insurance as required by its contractual obligations with third-party partners. The Company does not require Subcontractors to maintain general liability insurance as a condition of performing services." },
  { kind: "bullet", text: "The absence of this requirement does not relieve the Subcontractor of liability for damages caused by their operations." },

  { kind: "h2", text: "SECTION 11. Payment, Deductions, and Adjustments" },
  { kind: "bullet", text: "Compensation shall be paid based on established rates, schedules, and terms." },
  { kind: "bullet", text: "Payment may be withheld, delayed, offset, or adjusted for incomplete work, defective execution, or outstanding debts (including property damage and lost parts)." },
  { kind: "bullet", text: "All business operational expenses, including vehicle mileage reimbursements, equipment purchases, and direct operational outlays, shall be accounted for strictly as commercial invoice adjustments and business-to-business expense transfers, completely segregated from commission calculations and the base compensation floor." },

  { kind: "h2", text: "SECTION 12. Termination & Survival of Obligations" },
  { kind: "bullet", text: "Either party may terminate this Agreement at any time, with or without cause, upon written notice." },
  { kind: "bullet", text: "Upon termination, the Subcontractor shall immediately cease representation as affiliated with the Company and return all property, materials, and equipment." },
  { kind: "bullet", text: "Obligations relating to property damage, indemnification, reimbursement, payment offsets, and outstanding debts survive termination." },

  { kind: "h2", text: "SECTION 13. Voluntary Election and Mutual Agreement" },
  { kind: "bullet", text: "The Subcontractor expressly acknowledges and confirms that the 1099 independent contractor status and structure under this Agreement were not forced, mandated, or requested by the Company, but were instead actively requested, elected, and voluntarily chosen by the Subcontractor for their own business and tax advantages." },
  { kind: "bullet", text: "The Company has repeatedly offered W-2 employment options, all of which were declined in favor of this independent contractor arrangement." },
  { kind: "bullet", text: "Any complimentary support, company insurance access, uniforms, or software systems provided are requested business tools to facilitate independent operations and do not constitute control or an employment relationship." },

  { kind: "h2", text: "SECTION 14. Governing Law & Electronic Signatures" },
  { kind: "bullet", text: "This Agreement is governed by the laws of the State of Tennessee." },
  { kind: "bullet", text: "Electronic signatures, digital acknowledgments, and online form submissions (such as Jotform verifications) carry the exact same legal force and effect as original handwritten signatures under the E-SIGN Act." },

  { kind: "gap", pt: 6 },
  { kind: "signHeading", text: "SIGNATURES & ACKNOWLEDGMENT" },
  { kind: "sign", slot: "hr_staff", role: "Company HR Representative" },
  { kind: "sign", slot: "employee", role: "Subcontractor / Contractor" },
  { kind: "note", text: "Managerial Witnesses (Verifying Voluntariness & Independent Status):" },
  { kind: "sign", slot: "manager", role: "Witness 1 Signature (Technical COO)" },
  { kind: "sign", slot: "senior_manager", role: "Witness 2 Signature (Technical Director)" },
  { kind: "sign", slot: "executive", role: "Witness 3 Signature (CEO)" },
];
