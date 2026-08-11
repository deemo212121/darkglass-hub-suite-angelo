/**
 * 4th Warning — Manager's Action Plan Form — shared HTML/CSS template,
 * mirroring warningFormTemplate.ts/promotionFormTemplate.ts's shape (used
 * by the generator, ReportHRDaily.tsx's Generate Manager's Action Plan
 * Form tab, and the signer pages, so they can never drift into rendering
 * visually different documents). Field layout matches src/assets/Manager's
 * Action Plan Form.pdf exactly, including its full letterhead (logo +
 * ribbon header, contact-info footer graphic) — the same three brand
 * images the Certificate of Employment template already uses (see
 * ReportHRDaily.tsx's coeStyles/buildCoeBodyMarkup).
 *
 * Unlike the Warning Form and Promotion Form (HR pre-fills every field,
 * recipients only sign), the 5 numbered plan sections and Manager Comments
 * are intentionally left BLANK when HR sends this — the assigned Manager
 * fills those in themselves on their sign page (see
 * SignActionPlanFormPage.tsx), then signs. Senior Manager and HR, further
 * down the signature chain, only review and countersign — they never edit
 * the content.
 *
 * Only 3 signature slots (Manager, Senior Manager, HR) — no Employee slot
 * (this document is directed at management, not the employee) and no
 * Executive slot (unlike the Promotion Form) — all three already valid
 * recipient_slot values as of migration 0050, so no new migration needed.
 */

export type ActionPlanSignatureSlot = "manager" | "senior_manager" | "hr_staff";

export interface ActionPlanFormData {
  /** The employee whose conduct this action plan addresses — kept for consistency with the other forms' shape; this form never writes back to the profile (document-only, no auto profile/warning-record update). */
  employeeId: string;
  employeeName: string;
  branch: string;
  position: string;
  date: string;
  /** Filled by the "manager" recipient on their sign page, not by HR at send time — see this file's header comment. */
  coachingPlan: string;
  monitoringPlan: string;
  additionalTraining: string;
  performanceExpectations: string;
  consequences: string;
  managerComments: string;
  recipientSlot: ActionPlanSignatureSlot;
  /** The CURRENT recipient's display name — pre-fills their "Name:" line before they've signed. Only actually read as a fallback, see resolvedSignerName below. */
  recipientName: string;
  /** One pre-fill name per slot, accumulated as a document is sent/reassigned across several signers over its lifetime — same rationale as WarningFormData.recipientNames. */
  recipientNames?: Partial<Record<ActionPlanSignatureSlot, string>>;
}

export interface ActionPlanSignatureEntry {
  name: string;
  url: string;
  signedAt: string;
}

export type ActionPlanFormSignatures = Partial<Record<ActionPlanSignatureSlot, ActionPlanSignatureEntry>>;

const escapeHtml = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const blank = (v: string) => (v && v.trim() ? escapeHtml(v) : "&nbsp;");

const fmtDate = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString();
};

export const actionPlanFormStyles = `
  .aplan-container * { margin: 0; padding: 0; box-sizing: border-box; }
  .aplan-container { width: 816px; min-height: 1056px; background: #fff; padding: 64px 72px; position: relative; font-family: Arial, Helvetica, sans-serif; color: #111827; font-size: 12.5px; line-height: 1.5; }
  .aplan-container .header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 10px; }
  .aplan-container .header img.logo { width: 90px; height: 90px; object-fit: contain; }
  .aplan-container .header img.ribbon { width: 220px; height: auto; }
  .aplan-container h1 { text-align: center; font-size: 17px; letter-spacing: 0.3px; margin: 4px 0 18px; }
  .aplan-container .toprow { display: flex; gap: 40px; border-bottom: 1px solid #9ca3af; padding: 6px 0; }
  .aplan-container .toprow > div { flex: 1; }
  .aplan-container .label { color: #374151; }
  .aplan-container .intro { margin: 14px 0 10px; }
  .aplan-container .plan-item { margin-bottom: 14px; }
  .aplan-container .plan-item-title { font-weight: 700; margin-bottom: 4px; }
  .aplan-container .plan-item-text { border-bottom: 1px solid #d1d5db; min-height: 30px; padding: 2px 2px 4px; white-space: pre-wrap; }
  .aplan-container .comments-title { font-weight: 700; margin: 16px 0 4px; }
  .aplan-container .comments-text { border-bottom: 1px solid #d1d5db; min-height: 46px; padding: 2px 2px 4px; white-space: pre-wrap; }
  .aplan-container .ack { margin: 18px 0 10px; font-style: italic; }
  .aplan-container .sign-row { display: flex; gap: 24px; align-items: flex-end; border-bottom: 1px solid #9ca3af; padding: 10px 2px; margin-top: 6px; }
  .aplan-container .sign-name { flex: 2; }
  .aplan-container .sign-sig { flex: 1; display: flex; align-items: flex-end; }
  .aplan-container .sign-date { flex: 1; }
  .aplan-container .sig-img { max-height: 36px; max-width: 140px; object-fit: contain; }
  .aplan-container .footer-wrap { margin-top: 40px; }
  .aplan-container .footer-graphic img { display: block; width: 100%; height: auto; }
`;

/** A signed slot's captured name always wins (it's the real signer); otherwise falls back to that slot's own remembered pre-fill name, then (for documents saved before recipientNames existed) the legacy single current-recipient field. */
function resolvedSignerName(data: ActionPlanFormData, slot: ActionPlanSignatureSlot, signatures: ActionPlanFormSignatures): string {
  return signatures[slot]?.name || data.recipientNames?.[slot] || (data.recipientSlot === slot ? data.recipientName : "") || "";
}

function signRow(label: string, name: string, entry: ActionPlanSignatureEntry | undefined) {
  return `
    <div class="sign-row">
      <div class="sign-name">${escapeHtml(label)}: <strong>${blank(name)}</strong></div>
      <div class="sign-sig">Signature: ${entry ? `<img class="sig-img" src="${entry.url}" alt="Signature" />` : ""}</div>
      <div class="sign-date">Date: ${entry ? escapeHtml(fmtDate(entry.signedAt)) : ""}</div>
    </div>
  `;
}

function planItem(title: string, text: string) {
  return `
    <div class="plan-item">
      <div class="plan-item-title">${escapeHtml(title)}</div>
      <div class="plan-item-text">${blank(text)}</div>
    </div>
  `;
}

export function buildActionPlanFormBodyMarkup(
  data: ActionPlanFormData,
  logoDataUrl: string,
  ribbonDataUrl: string,
  footerDataUrl: string,
  signatures: ActionPlanFormSignatures
): string {
  return `
    <div class="aplan-container">
      <div class="header">
        ${logoDataUrl ? `<img class="logo" src="${logoDataUrl}" alt="US In Home Services" />` : ""}
        ${ribbonDataUrl ? `<img class="ribbon" src="${ribbonDataUrl}" alt="" />` : ""}
      </div>
      <h1>4TH WARNING &ndash; MANAGER ACTION PLAN</h1>

      <div class="toprow">
        <div><span class="label">Employee Name:</span> <strong>${blank(data.employeeName)}</strong></div>
        <div><span class="label">Branch:</span> <strong>${blank(data.branch)}</strong></div>
      </div>
      <div class="toprow">
        <div><span class="label">Position:</span> <strong>${blank(data.position)}</strong></div>
        <div><span class="label">Date:</span> <strong>${blank(fmtDate(data.date))}</strong></div>
      </div>

      <p class="intro">Please outline the specific actions you will take to address this employee's continued performance or conduct issues:</p>

      ${planItem("1. Coaching Plan:", data.coachingPlan)}
      ${planItem("2. Monitoring Plan:", data.monitoringPlan)}
      ${planItem("3. Additional Training or Support:", data.additionalTraining)}
      ${planItem("4. Performance Expectations and Timeline:", data.performanceExpectations)}
      ${planItem("5. Consequences if Improvement Is Not Achieved:", data.consequences)}

      <p class="comments-title">Manager Comments:</p>
      <div class="comments-text">${blank(data.managerComments)}</div>

      <p class="ack">I acknowledge responsibility for implementing the above action plan and monitoring the employee's progress.</p>

      ${signRow("Manager's Name", resolvedSignerName(data, "manager", signatures), signatures.manager)}
      ${signRow("Senior Manager's Name", resolvedSignerName(data, "senior_manager", signatures), signatures.senior_manager)}
      ${signRow("HR/Management's Name", resolvedSignerName(data, "hr_staff", signatures), signatures.hr_staff)}

      <div class="footer-wrap">
        <div class="footer-graphic">
          ${footerDataUrl ? `<img src="${footerDataUrl}" alt="" />` : ""}
        </div>
      </div>
    </div>
  `;
}
