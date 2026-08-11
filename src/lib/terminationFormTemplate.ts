/**
 * Notice of Termination — shared HTML/CSS template, mirroring
 * warningFormTemplate.ts's shape (HR fills every field, the 4 recipients
 * only sign to acknowledge receipt — no recipient-editable content, unlike
 * actionPlanFormTemplate.ts). Field layout matches src/assets/Termination
 * Notice Form.pdf exactly, including its full letterhead (logo + ribbon
 * header, contact-info footer graphic — same three brand images the
 * Certificate of Employment / Manager's Action Plan Form templates use).
 *
 * Same 4 signature slots as the Warning Form (Employee, Manager, Senior
 * Manager, HR Staff) — all already valid recipient_slot values as of
 * migration 0050, so no new migration needed.
 *
 * Document-only (per design) — confirming a signed termination notice does
 * NOT write back to the employee's profile (Status/Termination Date stay
 * whatever HR separately sets in Master List).
 */

export type TerminationSignatureSlot = "employee" | "manager" | "senior_manager" | "hr_staff";

export interface TerminationFormData {
  /** The employee being terminated — kept for consistency with the other forms' shape; this form never writes back to the profile. */
  employeeId: string;
  employeeName: string;
  effectiveDate: string;
  reason: string;
  recipientSlot: TerminationSignatureSlot;
  /** The CURRENT recipient's display name — pre-fills their "Name:" line before they've signed. Only actually read as a fallback, see resolvedSignerName below. */
  recipientName: string;
  /** One pre-fill name per slot, accumulated as a document is sent/reassigned across several signers over its lifetime — same rationale as WarningFormData.recipientNames. */
  recipientNames?: Partial<Record<TerminationSignatureSlot, string>>;
}

export interface TerminationSignatureEntry {
  name: string;
  url: string;
  signedAt: string;
}

export type TerminationFormSignatures = Partial<Record<TerminationSignatureSlot, TerminationSignatureEntry>>;

const escapeHtml = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const blank = (v: string) => (v && v.trim() ? escapeHtml(v) : "&nbsp;");

const fmtDate = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString();
};

export const terminationFormStyles = `
  .term-container * { margin: 0; padding: 0; box-sizing: border-box; }
  .term-container { width: 816px; min-height: 1056px; background: #fff; padding: 64px 72px; position: relative; font-family: Arial, Helvetica, sans-serif; color: #111827; font-size: 12.5px; line-height: 1.6; }
  .term-container .header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 10px; }
  .term-container .header img.logo { width: 90px; height: 90px; object-fit: contain; }
  .term-container .header img.ribbon { width: 220px; height: auto; }
  .term-container h1 { text-align: center; font-size: 17px; letter-spacing: 0.3px; margin: 4px 0 20px; }
  .term-container p { margin-bottom: 14px; text-align: justify; }
  .term-container .reason-title { font-weight: 700; margin-bottom: 4px; }
  .term-container .reason-text { border-bottom: 1px solid #d1d5db; min-height: 40px; padding: 2px 2px 4px; white-space: pre-wrap; margin-bottom: 18px; }
  .term-container .ack { margin: 18px 0 10px; }
  .term-container .sign-row { display: flex; gap: 24px; align-items: flex-end; border-bottom: 1px solid #9ca3af; padding: 10px 2px; margin-top: 6px; }
  .term-container .sign-name { flex: 2; }
  .term-container .sign-sig { flex: 1; display: flex; align-items: flex-end; }
  .term-container .sign-date { flex: 1; }
  .term-container .sig-img { max-height: 36px; max-width: 140px; object-fit: contain; }
  .term-container .footer-wrap { margin-top: 40px; }
  .term-container .footer-graphic img { display: block; width: 100%; height: auto; }
`;

/** A signed slot's captured name always wins (it's the real signer); otherwise falls back to that slot's own remembered pre-fill name, then (for documents saved before recipientNames existed) the legacy single current-recipient field. */
function resolvedSignerName(data: TerminationFormData, slot: TerminationSignatureSlot, signatures: TerminationFormSignatures): string {
  return signatures[slot]?.name || data.recipientNames?.[slot] || (data.recipientSlot === slot ? data.recipientName : "") || "";
}

function signRow(label: string, name: string, entry: TerminationSignatureEntry | undefined) {
  return `
    <div class="sign-row">
      <div class="sign-name">${escapeHtml(label)}: <strong>${blank(name)}</strong></div>
      <div class="sign-sig">Signature: ${entry ? `<img class="sig-img" src="${entry.url}" alt="Signature" />` : ""}</div>
      <div class="sign-date">Date: ${entry ? escapeHtml(fmtDate(entry.signedAt)) : ""}</div>
    </div>
  `;
}

export function buildTerminationFormBodyMarkup(
  data: TerminationFormData,
  logoDataUrl: string,
  ribbonDataUrl: string,
  footerDataUrl: string,
  signatures: TerminationFormSignatures
): string {
  return `
    <div class="term-container">
      <div class="header">
        ${logoDataUrl ? `<img class="logo" src="${logoDataUrl}" alt="US In Home Services" />` : ""}
        ${ribbonDataUrl ? `<img class="ribbon" src="${ribbonDataUrl}" alt="" />` : ""}
      </div>
      <h1>Notice of Termination</h1>

      <p>Dear ${blank(data.employeeName)},</p>

      <p>This letter serves as formal notice of the termination of your employment with US Appliance Repair DBA US in Home Services, effective ${blank(fmtDate(data.effectiveDate))}.</p>

      <p class="reason-title">Reason for Termination:</p>
      <div class="reason-text">${blank(data.reason)}</div>

      <p>This decision has been made after careful consideration. Despite any prior discussions or opportunities for improvement where applicable, we have determined that it is in the best interest of both parties to conclude your employment.</p>

      <p>You will receive your final paycheck, including any outstanding compensation and accrued benefits, in accordance with company policy and applicable laws. Please ensure that all company property in your possession is returned on or before your final day of employment.</p>

      <p>We appreciate your contributions during your time with US Appliance Repair DBA US in Home Services and wish you the best in your future endeavors.</p>

      <p>Sincerely,</p>

      <p class="ack">Please sign below to acknowledge receipt of this notice.</p>

      ${signRow("Employee Signature", resolvedSignerName(data, "employee", signatures), signatures.employee)}
      ${signRow("Manager Signature", resolvedSignerName(data, "manager", signatures), signatures.manager)}
      ${signRow("Senior Manager Signature", resolvedSignerName(data, "senior_manager", signatures), signatures.senior_manager)}
      ${signRow("HR Staff Signature", resolvedSignerName(data, "hr_staff", signatures), signatures.hr_staff)}

      <div class="footer-wrap">
        <div class="footer-graphic">
          ${footerDataUrl ? `<img src="${footerDataUrl}" alt="" />` : ""}
        </div>
      </div>
    </div>
  `;
}
