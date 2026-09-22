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
 * Direct Manager, Senior Manager, HR, and Executive — see migration 0165
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

/**
 * The CEO's personal congratulations DM, sent automatically to the
 * promoted employee the moment the "executive" slot — the last signer in
 * the Employee Promotion / Role Change Form chain (employee, manager,
 * senior_manager, hr_staff, executive) — signs. See
 * SignPromotionFormPage.tsx's handleConfirmSign. Fixed company template
 * (Justin, CEO) with just the employee's name and new title substituted —
 * not personalized per whichever executive account actually signs, since
 * that's what was asked for verbatim.
 */
export function buildPromotionCongratsMessage(employeeName: string, newPositionTitle: string): string {
  return `🎉 **Huge congratulations on your promotion, ${employeeName}!**

Hi ${employeeName},

I wanted to take a moment to personally congratulate you on your promotion to ${newPositionTitle}.

Seeing your hard work, dedication, and the impact you've made here has been incredible. This promotion is a well-deserved recognition of your commitment and the value you bring to Us In Home Services.

Thank you for everything you do and for continuously stepping up. I'm excited to see you grow further and achieve even greater things in this new role.

Congratulations once again!

Best regards,
Justin
CEO, Us In Home Services`;
}

const escapeHtml = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const blank = (v: string) => (v && v.trim() ? escapeHtml(v) : "&nbsp;");

const checkbox = (checked: boolean) => (checked ? "☑" : "☐");

const fmtDate = (iso: string) => {
  if (!iso) return "";
  // A date-only string ("2026-09-17", e.g. Effective Date/Date of Hire)
  // parses as UTC midnight; formatting it back out in the browser's local
  // timezone (anything behind UTC, i.e. all of the US) rolls it back a
  // day — "9/17" printing as "9/16". Parsing the y/m/d parts directly into
  // a local Date avoids that. A full timestamp (e.g. a signature's
  // signedAt) has no such ambiguity and is left to the normal Date parse.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString();
  }
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
  .promo-sign-sig { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; overflow: hidden; }
  .promo-sign-date { flex: 1; }
  .promo-sig-img { max-height: 44px; max-width: 100%; object-fit: contain; object-position: left; }
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
