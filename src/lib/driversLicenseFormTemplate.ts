/**
 * Driver's License — a standalone identification-document submission,
 * split out of Contractor Data Sheet / Master W-2 Technician & Office
 * Agreements (which used to each embed their own license upload). Same
 * shape as ssnCardFormTemplate.ts — single-party, employee fills in their
 * license number/state, uploads front & back, and signs.
 */

export const DRIVERS_LICENSE_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware",
  "District of Columbia", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
  "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
  "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon",
  "Pennsylvania", "Puerto Rico", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas",
  "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming",
] as const;

export interface DriversLicenseFormData {
  employeeId: string;
  employeeName: string;
  licenseNumber: string;
  licenseState: string;
  /** Front and back of the license — uploaded via uploadSignableDocumentAttachment, same as Contractor Data Sheet's driversLicenseUrls. */
  licensePhotoUrls: string[];
  dateSigned: string;
  signatureDataUrl: string;
}

export interface DriversLicenseSignature {
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

export const driversLicenseFormStyles = `
  .dlicense-container * { margin: 0; padding: 0; box-sizing: border-box; }
  .dlicense-container { width: 816px; min-height: 1056px; background: #fff; padding: 72px; position: relative; font-family: Arial, Helvetica, sans-serif; color: #111827; font-size: 12px; line-height: 1.5; }
  .dlicense-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 18px; }
  .dlicense-header h1 { font-size: 20px; letter-spacing: 0.3px; }
  .dlicense-header img { width: 72px; height: 72px; object-fit: contain; }
  .dlicense-section-title { background: #111827; color: #fff; font-weight: 700; padding: 6px 10px; font-size: 11.5px; letter-spacing: 0.3px; margin: 18px 0 10px; }
  .dlicense-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; }
  .dlicense-row { border-bottom: 1px solid #d1d5db; padding: 5px 2px; }
  .dlicense-label { color: #374151; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.2px; display: block; }
  .dlicense-value { font-weight: 700; }
  .dlicense-photos { display: flex; gap: 10px; margin-top: 6px; flex-wrap: wrap; }
  .dlicense-photos img { width: 200px; height: 126px; object-fit: cover; border: 1px solid #d1d5db; border-radius: 4px; }
  .dlicense-cert { margin-top: 20px; font-style: italic; }
  .dlicense-sig-line { border-bottom: 1px solid #9ca3af; min-height: 44px; padding: 4px 2px; display: flex; align-items: flex-end; margin-top: 16px; }
  .dlicense-sign-row { display: flex; justify-content: space-between; gap: 16px; padding: 6px 2px 0; }
  .dlicense-sig-img { max-height: 36px; max-width: 220px; object-fit: contain; }
`;

export function buildDriversLicenseFormBodyMarkup(data: DriversLicenseFormData, logoDataUrl: string, signature: DriversLicenseSignature | undefined): string {
  return `
    <div class="dlicense-container">
      <div class="dlicense-header">
        <h1>DRIVER'S LICENSE SUBMISSION</h1>
        ${logoDataUrl ? `<img src="${logoDataUrl}" alt="US In Home Services" />` : ""}
      </div>

      <div class="dlicense-section-title">EMPLOYEE INFORMATION</div>
      <div class="dlicense-row"><span class="dlicense-label">Employee Name</span><span class="dlicense-value">${blank(data.employeeName)}</span></div>
      <div class="dlicense-grid">
        <div class="dlicense-row"><span class="dlicense-label">Driver's License Number</span><span class="dlicense-value">${blank(data.licenseNumber)}</span></div>
        <div class="dlicense-row"><span class="dlicense-label">State Issued</span><span class="dlicense-value">${blank(data.licenseState)}</span></div>
      </div>

      <div class="dlicense-section-title">DRIVER'S LICENSE PHOTO (FRONT / BACK)</div>
      <div class="dlicense-row">
        <div class="dlicense-photos">${data.licensePhotoUrls.map((u) => `<img src="${u}" alt="" />`).join("")}</div>
      </div>

      <p class="dlicense-cert">By signing below, I certify that the driver's license information and photo provided above are true, accurate, and belong to me.</p>

      <div class="dlicense-sig-line">${signature ? `<img class="dlicense-sig-img" src="${signature.url}" alt="Signature" />` : ""}</div>
      <div class="dlicense-sign-row">
        <div>${signature ? `Signature: <strong>${blank(data.employeeName)}</strong>` : "Signature:"}</div>
        <div>${signature ? `Date: ${escapeHtml(fmtDate(signature.signedAt))}` : ""}</div>
      </div>
    </div>
  `;
}
