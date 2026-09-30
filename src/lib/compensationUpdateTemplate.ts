/**
 * Promotion Paper and Wage Increase letter — shared HTML/CSS template used by
 * the HR generator (CompensationUpdateTab.tsx) and the signer page
 * (SignCompensationUpdatePage.tsx), so both render the identical document.
 *
 * Signed in a fixed order — Senior → Executive → HR → Employee — and handed from
 * one signer to the next automatically (see compensationUpdateBridge.ts);
 * The employee signs last, which finalizes it. Same pattern as promotionFormTemplate.ts
 * otherwise: the whole PDF is re-rendered on every signature with every
 * signature collected so far.
 */

export type CompensationSignatureSlot = "employee" | "senior_manager" | "executive" | "hr_staff";

/** Signing order — the document moves to the next slot the moment the current one signs. */
export const COMPENSATION_SIGNING_ORDER: CompensationSignatureSlot[] = ["senior_manager", "executive", "hr_staff", "employee"];

export const COMPENSATION_SLOT_LABEL: Record<CompensationSignatureSlot, string> = {
  employee: "Employee",
  senior_manager: "Senior",
  executive: "Executive",
  hr_staff: "HR",
};

export interface CompensationSigner {
  id: string;
  name: string;
}

export interface CompensationUpdateFormData {
  /** The recipient employee's profile id. */
  employeeId: string;
  employeeName: string;
  newPosition: string;
  startingSalary: string;
  /** Date the change takes effect (the next payroll). */
  effectiveDate: string;
  salaryIncrease: string;
  /** Who signs each slot, chosen by HR at send time. */
  signers: Record<CompensationSignatureSlot, CompensationSigner>;
  /** Current recipient — kept in sync by reassignSignableDocument / the bridge. */
  recipientSlot: CompensationSignatureSlot;
  recipientName: string;
  recipientNames?: Partial<Record<CompensationSignatureSlot, string>>;
}

export interface CompensationSignatureEntry {
  name: string;
  url: string;
  signedAt: string;
}

export type CompensationSignatures = Partial<Record<CompensationSignatureSlot, CompensationSignatureEntry>>;

const escapeHtml = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const blank = (v: string) => (v && v.trim() ? escapeHtml(v) : "&nbsp;");

const fmtDate = (iso: string) => {
  if (!iso) return "";
  // Date-only strings parse as UTC midnight; read the parts directly so a
  // US timezone doesn't roll the date back a day.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString();
  }
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString();
};

export const compensationUpdateStyles = `
  .comp-container * { margin: 0; padding: 0; box-sizing: border-box; }
  .comp-container { width: 816px; min-height: 1056px; background: #fff; padding: 72px; position: relative; font-family: Arial, Helvetica, sans-serif; color: #111827; font-size: 13px; line-height: 1.6; }
  .comp-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 4px; }
  .comp-header h1 { font-size: 16px; letter-spacing: 0.2px; }
  .comp-header img { width: 84px; height: 84px; object-fit: contain; }
  .comp-subtitle { font-size: 12px; font-weight: 700; letter-spacing: 0.2px; margin-bottom: 22px; }
  .comp-p { margin-bottom: 14px; }
  .comp-details { margin: 6px 0 18px; padding: 12px 16px; border: 1px solid #d1d5db; border-radius: 4px; }
  .comp-field { padding: 3px 0; }
  .comp-label { color: #374151; display: inline-block; min-width: 170px; }
  .comp-sign-title { margin-top: 26px; font-weight: 700; font-size: 12.5px; border-top: 1px solid #9ca3af; padding-top: 10px; }
  .comp-sign-row { display: flex; gap: 24px; align-items: flex-end; border-bottom: 1px solid #9ca3af; padding: 10px 2px; margin-top: 6px; }
  .comp-sign-role { width: 70px; font-weight: 700; }
  .comp-sign-name { flex: 2; }
  .comp-sign-sig { flex: 1.4; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; overflow: hidden; }
  .comp-sign-date { flex: 1; }
  .comp-sig-img { max-height: 44px; max-width: 100%; object-fit: contain; object-position: left; }
`;

function signRow(slot: CompensationSignatureSlot, data: CompensationUpdateFormData, signatures: CompensationSignatures) {
  const entry = signatures[slot];
  const name = entry?.name || data.signers?.[slot]?.name || data.recipientNames?.[slot] || "";
  return `
    <div class="comp-sign-row">
      <div class="comp-sign-role">${COMPENSATION_SLOT_LABEL[slot]}</div>
      <div class="comp-sign-name">Name: <strong>${blank(name)}</strong></div>
      <div class="comp-sign-sig">Signature: ${entry ? `<img class="comp-sig-img" src="${entry.url}" alt="Signature" />` : ""}</div>
      <div class="comp-sign-date">Date: ${entry ? escapeHtml(fmtDate(entry.signedAt)) : ""}</div>
    </div>
  `;
}

export function buildCompensationUpdateBodyMarkup(data: CompensationUpdateFormData, logoDataUrl: string, signatures: CompensationSignatures): string {
  return `
    <div class="comp-container">
      <div class="comp-header">
        <h1>US IN HOME SERVICES</h1>
        ${logoDataUrl ? `<img src="${logoDataUrl}" alt="US In Home Services" />` : ""}
      </div>
      <div class="comp-subtitle">PROMOTION PAPER AND WAGE INCREASE</div>

      <p class="comp-p">Congratulations on your new positions! The company is very happy for your success and looks forward to working with you in your new roles. We appreciate your hard work and dedication, and we are excited to see your continued growth with the company.</p>

      <p class="comp-p">Please see your updated positions and compensation below:</p>

      <div class="comp-details">
        <div class="comp-field"><span class="comp-label">Name:</span> <strong>${blank(data.employeeName)}</strong></div>
        <div class="comp-field"><span class="comp-label">New position:</span> <strong>${blank(data.newPosition)}</strong></div>
        <div class="comp-field"><span class="comp-label">Starting Salary:</span> <strong>${blank(data.startingSalary)}</strong></div>
        <div class="comp-field"><span class="comp-label">Effective next payroll:</span> <strong>${blank(fmtDate(data.effectiveDate))}</strong></div>
        <div class="comp-field"><span class="comp-label">Salary Increase:</span> <strong>${blank(data.salaryIncrease)}</strong></div>
      </div>

      <p class="comp-p"><strong>Benefits:</strong> Your benefits will remain the same, including 5 days of PTO, effective from your start date in your new position.</p>

      <p class="comp-p">These changes will be reflected in the next payroll. If you have any questions or need further clarification, please don't hesitate to reach out to me.</p>

      <p class="comp-p">Congratulations once again, and best wishes in your new roles!</p>

      <div class="comp-sign-title">Signatures</div>
      ${COMPENSATION_SIGNING_ORDER.map((slot) => signRow(slot, data, signatures)).join("")}
    </div>
  `;
}

/** DM sent to whoever signs next — a congratulations for the employee (last), a plain request for everyone else. */
export function compensationSignRequestMessage(nextSlot: CompensationSignatureSlot, employeeName: string, link: string): string {
  if (nextSlot === "employee") {
    return `🎉 Congratulations on your new position, ${employeeName}! Your Promotion Paper and Wage Increase is ready for your signature. Review and sign here: ${link}`;
  }
  return `🎉 Promotion Paper and Wage Increase for ${employeeName} needs your signature (${COMPENSATION_SLOT_LABEL[nextSlot]}). Review and sign here: ${link}`;
}

/** The slot after `current` in signing order, or null when `current` is the last (Employee). */
export function nextCompensationSlot(current: CompensationSignatureSlot): CompensationSignatureSlot | null {
  const i = COMPENSATION_SIGNING_ORDER.indexOf(current);
  return i >= 0 && i < COMPENSATION_SIGNING_ORDER.length - 1 ? COMPENSATION_SIGNING_ORDER[i + 1] : null;
}
