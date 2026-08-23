/**
 * Direct Deposit Authorization — shared data types + HTML/CSS document
 * template. Same architecture as contractorDataFormTemplate.ts: there's no
 * real source PDF to overlay-fill, so the final PDF is generated from a
 * hand-built HTML template captured via captureHtmlToPdfBlob (see
 * directDepositPdfFill... no — see FillDirectDepositPage.tsx, which calls
 * captureHtmlToPdfBlob directly, same as every other from-scratch template
 * in this app).
 *
 * Single-party, same shape as Car IQ/Contractor Data — one recipient fills
 * in everything and signs, no employer/HR co-signature step. No file
 * uploads here (unlike Contractor Data) — just contact/bank info plus a
 * signature. "Date:*" in the source content is the signing date shown
 * alongside the signature, not a separately-typed field — same convention
 * every other single-party form here uses (auto-filled with today's date
 * at signing time, not user-editable).
 */

export const DIRECT_DEPOSIT_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware",
  "District of Columbia", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
  "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
  "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon",
  "Pennsylvania", "Puerto Rico", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas",
  "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming",
] as const;

export const DIRECT_DEPOSIT_COUNTRIES = ["United States", "Philippines", "Other"] as const;
export const DIRECT_DEPOSIT_ACCOUNT_TYPES = ["Checking", "Savings"] as const;

export interface DirectDepositFormData {
  /** The employee's actual profile id — not shown on the document itself, just carried alongside for lookups. */
  employeeId: string;
  /** Derived display name — [firstName, middleName, lastName].filter(Boolean).join(" "). */
  employeeName: string;
  firstName: string;
  middleName: string;
  lastName: string;
  streetAddress: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  bankName: string;
  accountNumber: string;
  routingNumber: string;
  accountType: string;
  dateSigned: string;
  /** Raw canvas PNG as a data: URL — see w4FormTemplate.ts's header comment for why this is stored alongside the durable Firebase Storage signature URL. */
  signatureDataUrl: string;
}

export interface DirectDepositSignature {
  name: string;
  url: string;
  signedAt: string;
}

const escapeHtml = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const blank = (v: string) => (v && v.trim() ? escapeHtml(v) : "&nbsp;");

const fmtDate = (v: string) => {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString();
};

export const directDepositStyles = `
  .ddep-container * { margin: 0; padding: 0; box-sizing: border-box; }
  .ddep-container { width: 816px; min-height: 1056px; background: #fff; padding: 72px; position: relative; font-family: Arial, Helvetica, sans-serif; color: #111827; font-size: 12px; line-height: 1.5; }
  .ddep-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 18px; }
  .ddep-header h1 { font-size: 20px; letter-spacing: 0.3px; }
  .ddep-header img { width: 72px; height: 72px; object-fit: contain; }
  .ddep-section-title { background: #111827; color: #fff; font-weight: 700; padding: 6px 10px; font-size: 11.5px; letter-spacing: 0.3px; margin: 18px 0 10px; }
  .ddep-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; }
  .ddep-row { border-bottom: 1px solid #d1d5db; padding: 5px 2px; }
  .ddep-label { color: #374151; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.2px; display: block; }
  .ddep-value { font-weight: 700; }
  .ddep-notice { margin-top: 22px; }
  .ddep-sign-row { display: flex; gap: 24px; align-items: flex-end; border-bottom: 1px solid #9ca3af; padding: 10px 2px; margin-top: 20px; }
  .ddep-sign-name { flex: 2; }
  .ddep-sign-sig { flex: 1; display: flex; align-items: flex-end; }
  .ddep-sign-date { flex: 1; }
  .ddep-sig-img { max-height: 36px; max-width: 140px; object-fit: contain; }
`;

function field(label: string, value: string) {
  return `<div class="ddep-row"><span class="ddep-label">${escapeHtml(label)}</span><span class="ddep-value">${blank(value)}</span></div>`;
}

export function buildDirectDepositBodyMarkup(data: DirectDepositFormData, logoDataUrl: string, signature: DirectDepositSignature | undefined): string {
  return `
    <div class="ddep-container">
      <div class="ddep-header">
        <h1>DIRECT DEPOSIT AUTHORIZATION</h1>
        ${logoDataUrl ? `<img src="${logoDataUrl}" alt="US In Home Services" />` : ""}
      </div>

      <div class="ddep-section-title">NAME</div>
      <div class="ddep-grid">
        ${field("First Name", data.firstName)}
        ${field("Middle Name", data.middleName)}
        ${field("Last Name", data.lastName)}
      </div>

      <div class="ddep-section-title">ADDRESS</div>
      <div class="ddep-grid">
        ${field("Street Address", data.streetAddress)}
        ${field("City", data.city)}
        ${field("State", data.state)}
        ${field("Zip Code", data.zipCode)}
        ${field("Country", data.country)}
      </div>

      <div class="ddep-section-title">BANK ACCOUNT</div>
      <div class="ddep-grid">
        ${field("Name of Bank", data.bankName)}
        ${field("Account #", data.accountNumber)}
        ${field("9-Digit Routing #", data.routingNumber)}
        ${field("Type of Account", data.accountType)}
      </div>

      <p class="ddep-notice">US In Home Services is hereby authorized to directly deposit my pay to the account listed above. This authorization will remain in effect until I modify or cancel it in writing.</p>

      <div class="ddep-sign-row">
        <div class="ddep-sign-name">Contractor's Signature: <strong>${blank(data.employeeName)}</strong></div>
        <div class="ddep-sign-sig">${signature ? `<img class="ddep-sig-img" src="${signature.url}" alt="Signature" />` : ""}</div>
        <div class="ddep-sign-date">Date: ${signature ? escapeHtml(fmtDate(signature.signedAt)) : ""}</div>
      </div>
    </div>
  `;
}
