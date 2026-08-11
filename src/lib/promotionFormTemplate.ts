/**
 * Employee Promotion / Role Change Approval Form — shared HTML/CSS
 * template, mirroring warningFormTemplate.ts's shape exactly (same reason:
 * used by both the generator, ReportHRDaily.tsx's Generate Employee
 * Promotion / Role Change tab, and the signer pages, SignPromotionFormPage.tsx
 * and ExternalSignPromotionFormPage.tsx, so the three can never drift into
 * rendering visually different documents). Field layout matches
 * src/assets/Employee Promotion or Role Change.pdf exactly.
 *
 * One more signature slot than the Warning Form (5, not 4) — Employee,
 * Direct Manager, Senior Manager, HR, and Executive — see migration 0166
 * for the matching hr_signable_documents.recipient_slot widening.
 */

export type PromotionSignatureSlot = "employee" | "manager" | "senior_manager" | "hr_staff" | "executive";

export interface PromotionRoleChangeType {
  promotion: boolean;
  positionTitleChange: boolean;
  departmentTransfer: boolean;
  technicianTierRaise: boolean;
  other: boolean;
  otherText: string;
}

export interface PromotionPerformanceSummary {
  meetsExpectations: boolean;
  exceedsExpectations: boolean;
  leadershipDemonstrated: boolean;
  trainingCompleted: boolean;
  other: boolean;
  otherText: string;
}

export interface PromotionFormData {
  /** The employee's actual profile id — kept for consistency with the Warning Form's shape; this form never writes back to the profile (document-only, no auto profile update). */
  employeeId: string;
  employeeName: string;
  currentPosition: string;
  department: string;
  dateOfHire: string;
  roleChangeType: PromotionRoleChangeType;
  newPositionTitle: string;
  newDepartment: string;
  effectiveDate: string;
  performance: PromotionPerformanceSummary;
  recipientSlot: PromotionSignatureSlot;
  /** The CURRENT recipient's display name — pre-fills their "Name:" line before they've signed. Only actually read as a fallback, see resolvedSignerName below. */
  recipientName: string;
  /** One pre-fill name per slot, accumulated as a document is sent/reassigned across several signers over its lifetime — same rationale as WarningFormData.recipientNames. */
  recipientNames?: Partial<Record<PromotionSignatureSlot, string>>;
}

export interface PromotionSignatureEntry {
  name: string;
  url: string;
  signedAt: string;
}

export type PromotionFormSignatures = Partial<Record<PromotionSignatureSlot, PromotionSignatureEntry>>;

const escapeHtml = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const blank = (v: string) => (v && v.trim() ? escapeHtml(v) : "&nbsp;");

const checkbox = (checked: boolean) => (checked ? "☑" : "☐");

const fmtDate = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString();
};

export const promotionFormStyles = `
  .promo-container * { margin: 0; padding: 0; box-sizing: border-box; }
  .promo-container { width: 816px; min-height: 1056px; background: #fff; padding: 72px; position: relative; font-family: Arial, Helvetica, sans-serif; color: #111827; font-size: 12.5px; line-height: 1.5; }
  .promo-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 4px; }
  .promo-header h1 { font-size: 16px; letter-spacing: 0.2px; }
  .promo-header img { width: 84px; height: 84px; object-fit: contain; }
  .promo-subtitle { font-size: 12px; font-weight: 700; letter-spacing: 0.2px; margin-bottom: 14px; }
  .promo-section { margin-top: 16px; border-top: 1px solid #9ca3af; padding-top: 10px; }
  .promo-section-title { font-weight: 700; font-size: 12.5px; margin-bottom: 6px; }
  .promo-field { padding: 3px 0; }
  .promo-label { color: #374151; }
  .promo-checks { display: flex; flex-direction: column; gap: 4px; padding: 4px 0; }
  .promo-other-row { padding-top: 2px; }
  .promo-sign-row { display: flex; gap: 24px; align-items: flex-end; border-bottom: 1px solid #9ca3af; padding: 10px 2px; margin-top: 6px; }
  .promo-sign-name { flex: 2; }
  .promo-sign-sig { flex: 1; display: flex; align-items: flex-end; }
  .promo-sign-date { flex: 1; }
  .promo-sig-img { max-height: 36px; max-width: 140px; object-fit: contain; }
  .promo-approver-block { margin-top: 14px; }
  .promo-approver-title { font-weight: 700; font-size: 12px; margin-bottom: 4px; }
`;

/** A signed slot's captured name always wins (it's the real signer); otherwise falls back to that slot's own remembered pre-fill name, then (for documents saved before recipientNames existed) the legacy single current-recipient field. */
function resolvedSignerName(data: PromotionFormData, slot: PromotionSignatureSlot, signatures: PromotionFormSignatures): string {
  return signatures[slot]?.name || data.recipientNames?.[slot] || (data.recipientSlot === slot ? data.recipientName : "") || "";
}

function signRow(label: string, name: string, entry: PromotionSignatureEntry | undefined) {
  return `
    <div class="promo-sign-row">
      <div class="promo-sign-name">${escapeHtml(label)}: <strong>${blank(name)}</strong></div>
      <div class="promo-sign-sig">Signature: ${entry ? `<img class="promo-sig-img" src="${entry.url}" alt="Signature" />` : ""}</div>
      <div class="promo-sign-date">Date: ${entry ? escapeHtml(fmtDate(entry.signedAt)) : ""}</div>
    </div>
  `;
}

export function buildPromotionFormBodyMarkup(data: PromotionFormData, logoDataUrl: string, signatures: PromotionFormSignatures): string {
  const rc = data.roleChangeType;
  const p = data.performance;

  return `
    <div class="promo-container">
      <div class="promo-header">
        <h1>US IN HOME SERVICES</h1>
        ${logoDataUrl ? `<img src="${logoDataUrl}" alt="US In Home Services" />` : ""}
      </div>
      <div class="promo-subtitle">EMPLOYEE PROMOTION / ROLE CHANGE APPROVAL FORM</div>

      <div class="promo-section">
        <div class="promo-section-title">1. Employee Information</div>
        <div class="promo-field"><span class="promo-label">Employee Name:</span> <strong>${blank(data.employeeName)}</strong></div>
        <div class="promo-field"><span class="promo-label">Current Position:</span> <strong>${blank(data.currentPosition)}</strong></div>
        <div class="promo-field"><span class="promo-label">Department/Branch:</span> <strong>${blank(data.department)}</strong></div>
        <div class="promo-field"><span class="promo-label">Date of Hire:</span> <strong>${blank(fmtDate(data.dateOfHire))}</strong></div>
      </div>

      <div class="promo-section">
        <div class="promo-section-title">2. Role Change Details</div>
        <div class="promo-checks">
          <span>${checkbox(rc.promotion)} Promotion</span>
          <span>${checkbox(rc.positionTitleChange)} Position Title Change</span>
          <span>${checkbox(rc.departmentTransfer)} Department Transfer</span>
          <span>${checkbox(rc.technicianTierRaise)} Technician Tier Raise</span>
          <span class="promo-other-row">${checkbox(rc.other)} Other: ${escapeHtml(rc.otherText)}</span>
        </div>
        <div class="promo-field"><span class="promo-label">New Position Title:</span> <strong>${blank(data.newPositionTitle)}</strong></div>
        <div class="promo-field"><span class="promo-label">New Department/Branch:</span> <strong>${blank(data.newDepartment)}</strong></div>
        <div class="promo-field"><span class="promo-label">Effective Date:</span> <strong>${blank(fmtDate(data.effectiveDate))}</strong></div>
      </div>

      <div class="promo-section">
        <div class="promo-section-title">3. Performance &amp; Qualification Summary (For Direct Manager)</div>
        <div class="promo-checks">
          <span>${checkbox(p.meetsExpectations)} Meets performance expectations</span>
          <span>${checkbox(p.exceedsExpectations)} Exceeds performance expectations</span>
          <span>${checkbox(p.leadershipDemonstrated)} Leadership capability demonstrated</span>
          <span>${checkbox(p.trainingCompleted)} Required training completed</span>
          <span class="promo-other-row">${checkbox(p.other)} Other justification: ${escapeHtml(p.otherText)}</span>
        </div>
      </div>

      <div class="promo-section">
        <div class="promo-section-title">4. Responsibilities Acknowledgment</div>
        <div class="promo-field">I acknowledge that I understand the responsibilities and expectations of my new role and agree to fulfill them to the best of my ability.</div>
        ${signRow("Employee Signature", data.employeeName, signatures.employee)}
      </div>

      <div class="promo-section">
        <div class="promo-section-title">5. Approval Signatures</div>
        <div class="promo-approver-block">
          <div class="promo-approver-title">Direct Manager</div>
          ${signRow("Name", resolvedSignerName(data, "manager", signatures), signatures.manager)}
        </div>
        <div class="promo-approver-block">
          <div class="promo-approver-title">Senior Manager</div>
          ${signRow("Name", resolvedSignerName(data, "senior_manager", signatures), signatures.senior_manager)}
        </div>
        <div class="promo-approver-block">
          <div class="promo-approver-title">HR</div>
          ${signRow("Name", resolvedSignerName(data, "hr_staff", signatures), signatures.hr_staff)}
        </div>
        <div class="promo-approver-block">
          <div class="promo-approver-title">Executive</div>
          ${signRow("Name", resolvedSignerName(data, "executive", signatures), signatures.executive)}
        </div>
      </div>
    </div>
  `;
}
