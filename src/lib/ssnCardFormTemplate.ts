/**
 * SSN Card — a standalone identification-document submission, split out of
 * Contractor Data Sheet / Master W-2 Technician & Office Agreements (which
 * used to each embed their own SSN card upload). Same from-scratch-HTML-
 * template shape as contractorDataFormTemplate.ts (no source PDF to
 * overlay), single-party — the employee fills in their SSN + uploads the
 * card and signs, no employer/HR co-signature step.
 */

export interface SsnCardFormData {
  employeeId: string;
  employeeName: string;
  ssn: string;
  /** Front (and, if provided, back) of the SSN card — uploaded via uploadSignableDocumentAttachment, same as Contractor Data Sheet's ssnCardUrls. */
  cardPhotoUrls: string[];
  dateSigned: string;
  signatureDataUrl: string;
}

export interface SsnCardSignature {
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

export const ssnCardFormStyles = `
  .ssncard-container * { margin: 0; padding: 0; box-sizing: border-box; }
  .ssncard-container { width: 816px; min-height: 1056px; background: #fff; padding: 72px; position: relative; font-family: Arial, Helvetica, sans-serif; color: #111827; font-size: 12px; line-height: 1.5; }
  .ssncard-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 18px; }
  .ssncard-header h1 { font-size: 20px; letter-spacing: 0.3px; }
  .ssncard-header img { width: 72px; height: 72px; object-fit: contain; }
  .ssncard-section-title { background: #111827; color: #fff; font-weight: 700; padding: 6px 10px; font-size: 11.5px; letter-spacing: 0.3px; margin: 18px 0 10px; }
  .ssncard-row { border-bottom: 1px solid #d1d5db; padding: 5px 2px; }
  .ssncard-label { color: #374151; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.2px; display: block; }
  .ssncard-value { font-weight: 700; }
  .ssncard-photos { display: flex; gap: 10px; margin-top: 6px; flex-wrap: wrap; }
  .ssncard-photos img { width: 320px; height: 202px; object-fit: cover; border: 1px solid #d1d5db; border-radius: 4px; }
  .ssncard-cert { margin-top: 20px; font-style: italic; }
  .ssncard-sig-line { border-bottom: 1px solid #9ca3af; min-height: 44px; padding: 4px 2px; display: flex; align-items: flex-end; margin-top: 16px; }
  .ssncard-sign-row { display: flex; justify-content: space-between; gap: 16px; padding: 6px 2px 0; }
  .ssncard-sig-img { max-height: 36px; max-width: 220px; object-fit: contain; }
`;

export function buildSsnCardFormBodyMarkup(data: SsnCardFormData, logoDataUrl: string, signature: SsnCardSignature | undefined): string {
  return `
    <div class="ssncard-container">
      <div class="ssncard-header">
        <h1>SOCIAL SECURITY CARD SUBMISSION</h1>
        ${logoDataUrl ? `<img src="${logoDataUrl}" alt="US In Home Services" />` : ""}
      </div>

      <div class="ssncard-section-title">EMPLOYEE INFORMATION</div>
      <div class="ssncard-row"><span class="ssncard-label">Employee Name</span><span class="ssncard-value">${blank(data.employeeName)}</span></div>
      <div class="ssncard-row"><span class="ssncard-label">Social Security Number</span><span class="ssncard-value">${blank(data.ssn)}</span></div>

      <div class="ssncard-section-title">SOCIAL SECURITY CARD PHOTO</div>
      <div class="ssncard-row">
        <div class="ssncard-photos">${data.cardPhotoUrls.map((u) => `<img src="${u}" alt="" />`).join("")}</div>
      </div>

      <p class="ssncard-cert">By signing below, I certify that the Social Security Number and card photo provided above are true, accurate, and belong to me.</p>

      <div class="ssncard-sig-line">${signature ? `<img class="ssncard-sig-img" src="${signature.url}" alt="Signature" />` : ""}</div>
      <div class="ssncard-sign-row">
        <div>${signature ? `Signature: <strong>${blank(data.employeeName)}</strong>` : "Signature:"}</div>
        <div>${signature ? `Date: ${escapeHtml(fmtDate(signature.signedAt))}` : ""}</div>
      </div>
    </div>
  `;
}
