/**
 * Valid ID (Philippines) — a standalone identification-document submission
 * for PH staff, split out of the Master PH Contractor Agreement (which
 * used to embed a single "license, passport, or government-issued ID"
 * upload). PH contractors have neither a US driver's license nor a US
 * SSN, so this accepts whichever government-issued photo ID they have —
 * same idea as technicianIdDocuments.ts's "government_id" kind, just its
 * own dedicated form now rather than a field buried in the bigger
 * contractor agreement. Same shape as ssnCardFormTemplate.ts otherwise —
 * single-party, employee fills in the ID type/number, uploads a photo,
 * and signs.
 */

export const VALID_ID_TYPES = ["Passport", "Driver's License", "Other Government ID"] as const;

export interface ValidIdFormData {
  employeeId: string;
  employeeName: string;
  idType: string;
  idNumber: string;
  /** Front (and, if provided, back) of the ID — uploaded via uploadSignableDocumentAttachment. */
  idPhotoUrls: string[];
  dateSigned: string;
  signatureDataUrl: string;
}

export interface ValidIdSignature {
  name: string;
  url: string;
  signedAt: string;
}

const escapeHtml = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const blank = (v: string) => (v && v.trim() ? escapeHtml(v) : "&nbsp;");

const fmtDate = (v: string) => {
  if (!v) return "";
  // A date-only string ("2026-09-17") parses as UTC midnight; formatting
  // it back out in the browser's local timezone (anything behind UTC,
  // i.e. all of the US) rolls it back a day — "9/17" printing as "9/16".
  // Parsing the y/m/d parts directly into a local Date avoids that. A
  // full timestamp has no such ambiguity and is left to the normal parse.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString();
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString();
};

export const validIdFormStyles = `
  .validid-container * { margin: 0; padding: 0; box-sizing: border-box; }
  .validid-container { width: 816px; min-height: 1056px; background: #fff; padding: 72px; position: relative; font-family: Arial, Helvetica, sans-serif; color: #111827; font-size: 12px; line-height: 1.5; }
  .validid-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 18px; }
  .validid-header h1 { font-size: 20px; letter-spacing: 0.3px; }
  .validid-header img { width: 72px; height: 72px; object-fit: contain; }
  .validid-section-title { background: #111827; color: #fff; font-weight: 700; padding: 6px 10px; font-size: 11.5px; letter-spacing: 0.3px; margin: 18px 0 10px; }
  .validid-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; }
  .validid-row { border-bottom: 1px solid #d1d5db; padding: 5px 2px; }
  .validid-label { color: #374151; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.2px; display: block; }
  .validid-value { font-weight: 700; }
  .validid-photos { display: flex; gap: 10px; margin-top: 6px; flex-wrap: wrap; }
  .validid-photos img { width: 320px; height: 202px; object-fit: cover; border: 1px solid #d1d5db; border-radius: 4px; }
  .validid-cert { margin-top: 20px; font-style: italic; }
  .validid-sig-line { border-bottom: 1px solid #9ca3af; min-height: 44px; padding: 4px 2px; display: flex; align-items: flex-end; margin-top: 16px; }
  .validid-sign-row { display: flex; justify-content: space-between; gap: 16px; padding: 6px 2px 0; }
  .validid-sig-img { max-height: 36px; max-width: 220px; object-fit: contain; }
`;

export function buildValidIdFormBodyMarkup(data: ValidIdFormData, logoDataUrl: string, signature: ValidIdSignature | undefined): string {
  return `
    <div class="validid-container">
      <div class="validid-header">
        <h1>VALID ID SUBMISSION</h1>
        ${logoDataUrl ? `<img src="${logoDataUrl}" alt="US In Home Services" />` : ""}
      </div>

      <div class="validid-section-title">EMPLOYEE INFORMATION</div>
      <div class="validid-row"><span class="validid-label">Employee Name</span><span class="validid-value">${blank(data.employeeName)}</span></div>
      <div class="validid-grid">
        <div class="validid-row"><span class="validid-label">ID Type</span><span class="validid-value">${blank(data.idType)}</span></div>
        <div class="validid-row"><span class="validid-label">ID Number</span><span class="validid-value">${blank(data.idNumber)}</span></div>
      </div>

      <div class="validid-section-title">ID PHOTO</div>
      <div class="validid-row">
        <div class="validid-photos">${data.idPhotoUrls.map((u) => `<img src="${u}" alt="" />`).join("")}</div>
      </div>

      <p class="validid-cert">By signing below, I certify that the ID information and photo provided above are true, accurate, and belong to me.</p>

      <div class="validid-sig-line">${signature ? `<img class="validid-sig-img" src="${signature.url}" alt="Signature" />` : ""}</div>
      <div class="validid-sign-row">
        <div>${signature ? `Signature: <strong>${blank(data.employeeName)}</strong>` : "Signature:"}</div>
        <div>${signature ? `Date: ${escapeHtml(fmtDate(signature.signedAt))}` : ""}</div>
      </div>
    </div>
  `;
}
