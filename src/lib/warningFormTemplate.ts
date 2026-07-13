/**
 * Employee Warning Form — shared HTML/CSS template.
 *
 * Used by both the generator (ReportHRDaily.tsx's Employee Warning Form
 * tab, which fills in everything except the signature lines) and the
 * signer page (SignDocumentPage.tsx, which re-renders this exact template
 * with the recipient's freshly-drawn signature composited in before
 * re-flattening to a PDF and sending it back to HR) — so the two can never
 * drift into rendering visually different documents.
 */

export type SignatureSlot = "employee" | "manager" | "senior_manager" | "hr_staff";

export interface WarningFormReasons {
  absence: boolean;
  tardiness: boolean;
  inappropriateBehavior: boolean;
  insubordination: boolean;
  policyViolation: boolean;
  equipmentDamage: boolean;
  other: boolean;
  otherText: string;
}

export interface WarningFormPreviousWarning {
  cause: string;
  date: string;
  issuedBy: string;
}

export interface WarningFormData {
  /** The employee's actual profile id — needed to log the warning against them at "Confirm Warning" time, not just display their name. */
  employeeId: string;
  employeeName: string;
  role: string;
  branch: string;
  warningDate: string;
  level: "1st" | "2nd" | "3rd" | "";
  reasons: WarningFormReasons;
  description: string;
  correctiveActions: string;
  /** Frozen at generation time — a warning added afterward shouldn't retroactively change a document already out for signature. */
  previousWarnings: WarningFormPreviousWarning[];
  recipientSlot: SignatureSlot;
  /** The recipient's display name, snapshotted at send time — pre-fills their "Name:" line before they've signed. */
  recipientName: string;
}

export interface SignatureEntry {
  name: string;
  url: string;
  signedAt: string;
}

export type WarningFormSignatures = Partial<Record<SignatureSlot, SignatureEntry>>;

const escapeHtml = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const blank = (v: string) => (v && v.trim() ? escapeHtml(v) : "&nbsp;");

const checkbox = (checked: boolean) => (checked ? "☑" : "☐");

const fmtDate = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString();
};

export const warningFormStyles = `
  .warn-container * { margin: 0; padding: 0; box-sizing: border-box; }
  .warn-container { width: 816px; min-height: 1056px; background: #fff; padding: 72px; position: relative; font-family: Arial, Helvetica, sans-serif; color: #111827; font-size: 12.5px; line-height: 1.5; }
  .warn-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 18px; }
  .warn-header h1 { font-size: 22px; letter-spacing: 0.3px; }
  .warn-header img { width: 84px; height: 84px; object-fit: contain; }
  .warn-toprow { display: flex; gap: 40px; border-bottom: 1px solid #9ca3af; padding: 6px 0; }
  .warn-toprow > div { flex: 1; }
  .warn-label { color: #374151; }
  .warn-columns { display: flex; gap: 20px; margin-top: 16px; }
  .warn-col-left, .warn-col-right { flex: 1; min-width: 0; }
  .warn-bar { background: #111827; color: #fff; font-weight: 700; padding: 6px 10px; font-size: 12px; letter-spacing: 0.3px; }
  .warn-checks { display: flex; gap: 14px; padding: 10px 2px; flex-wrap: wrap; }
  .warn-desc-label { padding: 8px 2px 4px; font-size: 11.5px; color: #374151; }
  .warn-freetext { border-bottom: 1px solid #d1d5db; min-height: 68px; padding: 2px 2px 4px; white-space: pre-wrap; }
  .warn-reason-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 10px; padding: 10px 2px; }
  .warn-other-row { padding: 0 2px 8px; }
  .warn-prev-label { font-weight: 700; padding: 10px 2px 6px; font-size: 11.5px; }
  .warn-prev-item { padding: 2px; }
  .warn-prev-meta { padding: 0 2px 8px; color: #4b5563; font-size: 11px; }
  .warn-notice { margin-top: 22px; font-style: italic; }
  .warn-sign-row { display: flex; gap: 24px; align-items: flex-end; border-bottom: 1px solid #9ca3af; padding: 10px 2px; margin-top: 6px; }
  .warn-sign-name { flex: 2; }
  .warn-sign-sig { flex: 1; display: flex; align-items: flex-end; }
  .warn-sign-date { flex: 1; }
  .warn-sig-img { max-height: 36px; max-width: 140px; object-fit: contain; }
`;

function signRow(label: string, name: string, entry: SignatureEntry | undefined) {
  return `
    <div class="warn-sign-row">
      <div class="warn-sign-name">${escapeHtml(label)}: <strong>${blank(name)}</strong></div>
      <div class="warn-sign-sig">Signature: ${entry ? `<img class="warn-sig-img" src="${entry.url}" alt="Signature" />` : ""}</div>
      <div class="warn-sign-date">Date: ${entry ? escapeHtml(fmtDate(entry.signedAt)) : ""}</div>
    </div>
  `;
}

export function buildWarningFormBodyMarkup(data: WarningFormData, logoDataUrl: string, signatures: WarningFormSignatures): string {
  const r = data.reasons;
  const prev = [0, 1, 2].map((i) => data.previousWarnings[i]);

  return `
    <div class="warn-container">
      <div class="warn-header">
        <h1>EMPLOYEE WARNING FORM</h1>
        ${logoDataUrl ? `<img src="${logoDataUrl}" alt="US In Home Services" />` : ""}
      </div>
      <div class="warn-toprow">
        <div><span class="warn-label">Employee Name:</span> <strong>${blank(data.employeeName)}</strong></div>
        <div><span class="warn-label">Branch Location:</span> <strong>${blank(data.branch)}</strong></div>
      </div>
      <div class="warn-toprow">
        <div><span class="warn-label">Role:</span> <strong>${blank(data.role)}</strong></div>
        <div><span class="warn-label">Warning Date:</span> <strong>${blank(fmtDate(data.warningDate))}</strong></div>
      </div>

      <div class="warn-columns">
        <div class="warn-col-left">
          <div class="warn-bar">TYPE OF WARNING</div>
          <div class="warn-checks">
            <span>${checkbox(data.level === "1st")} 1st Warning</span>
            <span>${checkbox(data.level === "2nd")} 2nd Warning</span>
            <span>${checkbox(data.level === "3rd")} 3rd Warning</span>
          </div>
          <p class="warn-desc-label">Provide a detailed description of the specific actions or behaviors that led to this warning:</p>
          <div class="warn-freetext">${blank(data.description)}</div>

          <p class="warn-desc-label">The employee must implement the following corrective actions immediately:</p>
          <div class="warn-freetext">${blank(data.correctiveActions)}</div>
        </div>
        <div class="warn-col-right">
          <div class="warn-bar">REASON(S) FOR WARNING</div>
          <div class="warn-reason-grid">
            <span>${checkbox(r.absence)} Absence</span><span>${checkbox(r.tardiness)} Tardiness</span>
            <span>${checkbox(r.inappropriateBehavior)} Inappropriate Behavior</span><span>${checkbox(r.insubordination)} Insubordination</span>
            <span>${checkbox(r.policyViolation)} Policy Violation</span><span>${checkbox(r.equipmentDamage)} Equipment Damage</span>
          </div>
          <div class="warn-other-row">${checkbox(r.other)} Other: <span>${escapeHtml(r.otherText)}</span></div>

          <p class="warn-prev-label">PREVIOUS WARNING(S) ISSUED (If any)</p>
          ${prev
            .map(
              (w, i) => `
            <p class="warn-prev-item">${i + 1}. ${w ? escapeHtml(w.cause) : "&nbsp;"}</p>
            <p class="warn-prev-meta">Date: ${w ? escapeHtml(fmtDate(w.date)) : ""}&nbsp;&nbsp;&nbsp;Issued By: ${w ? escapeHtml(w.issuedBy) : ""}</p>
          `
            )
            .join("")}
        </div>
      </div>

      <p class="warn-notice">Please be advised that failure to demonstrate immediate and sustained improvement may result in further disciplinary action.</p>

      ${signRow("Employee Name", data.employeeName, signatures.employee)}
      ${signRow("Manager Name", data.recipientSlot === "manager" ? data.recipientName : "", signatures.manager)}
      ${signRow("Senior Manager Name", data.recipientSlot === "senior_manager" ? data.recipientName : "", signatures.senior_manager)}
      ${signRow("HR Staff Name", data.recipientSlot === "hr_staff" ? data.recipientName : "", signatures.hr_staff)}
    </div>
  `;
}
