/**
 * Non-Disclosure Agreement — shared HTML/CSS template. Same architecture as
 * warningFormTemplate.ts: rendered as native HTML (letterhead header +
 * legal-text sections), turned into a PDF via captureHtmlPagesToPdfBlob (see
 * pdfCapture.ts) — NOT a real scanned PDF with a canvas overlay, unlike
 * employeeConfidentialityFormTemplate.ts's document (a different,
 * Technician-tab-only agreement).
 *
 * Four real pages (the source document HR provided is a 4-page agreement,
 * not one page) — buildNdaFormPages() returns one HTML string per page, fed
 * to captureHtmlPagesToPdfBlob so each becomes its own PDF page instead of
 * one overlong page. Every page carries the company logo at the top.
 *
 * Single-party, same shape as Employee Confidentiality/Car IQ/Vehicle
 * Agreement: one recipient (the employee) fills in their own blank fields
 * (page 1 only — pages 2-4 are read/acknowledge) and signs once, at the end
 * of page 4's "IN WITNESS WHEREOF" execution block. That one captured
 * signature is stamped onto the "Employee Signature" line repeated at the
 * bottom of pages 1-3 too (a deliberate simplification — asking the
 * recipient to draw their signature four separate times added real friction
 * for no legal difference, since it's the same binding signature either
 * way). The Witness and Employer signature/printed-name/title rows on page
 * 4 are left blank in the generated PDF — this flow only ever collects the
 * employee's own signature, same as every other single-party document in
 * this app; a witness/employer countersignature would need its own
 * multi-party flow (see actionPlanFormTemplate.ts for that shape) if ever
 * needed.
 *
 * Used by both the sender side (ReportHRDaily.tsx's "Non-Disclosure
 * Agreement" tab, which previews all 4 pages blank before sending) and the
 * recipient's own SignNdaFormPage.tsx (a 4-step Back/Next/Submit wizard
 * that re-renders these exact pages with their filled fields + freshly-
 * drawn signature composited in) — so the two can never drift into
 * rendering visually different documents.
 */

export { CAR_IQ_BRANCHES as NDA_BRANCHES } from "./carIqAgreementFormTemplate";

export interface NdaFormData {
  /** The employee's actual profile id — not shown on the document itself, just carried alongside for lookups. */
  employeeId: string;
  employeeName: string;
  nationality: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  branch: string;
  dateSigned: string;
}

export interface NdaSignature {
  name: string;
  url: string;
  signedAt: string;
}

const escapeHtml = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const blank = (v: string) => (v && v.trim() ? escapeHtml(v) : "&nbsp;");

const fmtDate = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString();
};

/** First/last split for page 4's "Printed Name" row — the employee only ever types one Full Name field (page 1); the last word is treated as the last name and everything before it (first + any middle names) as the first name. */
export function splitEmployeeName(fullName: string): { first: string; last: string } {
  const trimmed = fullName.trim();
  if (!trimmed) return { first: "", last: "" };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

export const ndaFormStyles = `
  .nda-container * { margin: 0; padding: 0; box-sizing: border-box; }
  .nda-container { width: 816px; min-height: 1056px; background: #fff; padding: 56px 72px; position: relative; font-family: Arial, Helvetica, sans-serif; color: #111827; font-size: 12.5px; line-height: 1.6; }
  .nda-header { display: flex; flex-direction: column; align-items: center; gap: 8px; margin-bottom: 24px; text-align: center; }
  .nda-header img { width: 108px; height: 108px; object-fit: contain; }
  .nda-header h1 { font-size: 19px; font-weight: 700; letter-spacing: 0.2px; margin-top: 4px; }
  .nda-header .nda-subtitle { font-size: 11.5px; font-weight: 700; color: #111827; }
  .nda-intro { margin-bottom: 18px; }
  .nda-section-title { font-weight: 700; font-size: 13px; margin: 16px 0 8px; }
  .nda-party-block { margin-bottom: 10px; }
  .nda-party-label { font-weight: 700; }
  .nda-field-row { display: flex; gap: 20px; padding: 4px 0; border-bottom: 1px solid #e5e7eb; }
  .nda-field-row > div { flex: 1; }
  .nda-field-label { color: #374151; }
  .nda-bullet-list { margin: 6px 0 6px 18px; }
  .nda-bullet-list li { margin-bottom: 2px; }
  .nda-sign-row { display: flex; gap: 24px; align-items: center; border-bottom: 1px solid #9ca3af; padding: 14px 2px 10px; margin-top: 22px; }
  .nda-sign-sig { flex: 2; display: flex; align-items: center; gap: 6px; }
  .nda-sign-date { flex: 1; display: flex; align-items: center; gap: 6px; }
  .nda-sig-img { max-height: 54px; max-width: 190px; object-fit: contain; }
  .nda-witness-block { margin-top: 20px; }
  .nda-witness-title { font-weight: 700; font-size: 12.5px; margin-bottom: 6px; }
`;

export const EMPLOYER_NAME = "US In Home Services";
export const EMPLOYER_ADDRESS = "3663 Cherry Rd. #101, Memphis, TN 38117, USA";

/** withTitle is only true on page 1 — pages 2-4 just repeat the logo, matching the reference document (no title/subtitle on later pages). */
function header(logoDataUrl: string, withTitle: boolean): string {
  return `
    <div class="nda-header">
      ${logoDataUrl ? `<img src="${logoDataUrl}" alt="US In Home Services" />` : ""}
      ${withTitle ? `<h1>Non-Disclosure Agreement</h1><p class="nda-subtitle">Please make sure to fill out the form correctly. Thank you!</p>` : ""}
    </div>
  `;
}

function employeeSignRow(data: NdaFormData, signature: NdaSignature | undefined): string {
  return `
    <div class="nda-sign-row">
      <div class="nda-sign-sig">Contractor Signature: ${signature ? `<img class="nda-sig-img" src="${signature.url}" alt="Signature" />` : ""}</div>
      <div class="nda-sign-date">Date: ${blank(fmtDate(data.dateSigned))}</div>
    </div>
  `;
}

export function buildNdaPage1Markup(data: NdaFormData, logoDataUrl: string, signature: NdaSignature | undefined): string {
  return `
    <div class="nda-container">
      ${header(logoDataUrl, true)}
      <p class="nda-intro">This agreement is made and entered into as of <strong>${blank(fmtDate(data.dateSigned))}</strong>, by and between:</p>

      <div class="nda-section-title">1. Parties</div>
      <div class="nda-party-block">
        <p class="nda-party-label">Employer:</p>
        <p>Company Name: ${escapeHtml(EMPLOYER_NAME)}</p>
        <p>Address: ${escapeHtml(EMPLOYER_ADDRESS)}</p>
      </div>
      <div class="nda-party-block">
        <p class="nda-party-label">Contractor:</p>
        <div class="nda-field-row">
          <div><span class="nda-field-label">Full Name:</span> <strong>${blank(data.employeeName)}</strong></div>
          <div><span class="nda-field-label">Nationality:</span> <strong>${blank(data.nationality)}</strong></div>
        </div>
        <div class="nda-field-row">
          <div><span class="nda-field-label">Street Address:</span> <strong>${blank(data.address)}</strong></div>
        </div>
        <div class="nda-field-row">
          <div><span class="nda-field-label">City:</span> <strong>${blank(data.city)}</strong></div>
          <div><span class="nda-field-label">State:</span> <strong>${blank(data.state)}</strong></div>
          <div><span class="nda-field-label">Zip:</span> <strong>${blank(data.zip)}</strong></div>
        </div>
        <div class="nda-field-row">
          <div><span class="nda-field-label">Branch (leave blank if PH):</span> <strong>${blank(data.branch)}</strong></div>
        </div>
      </div>

      <div class="nda-section-title">2. Purpose</div>
      <p>The employer may disclose certain confidential or proprietary information to the contractor during their employment as an appliance technician. The contractor agrees to keep this information secret and use it only for their job responsibilities.</p>

      <div class="nda-section-title">3. Definition of Confidential Information</div>
      <p>Includes but is not limited to:</p>
      <ul class="nda-bullet-list">
        <li>Customer data, service records</li>
        <li>Technical processes, manuals, and methods</li>
        <li>Business strategies and pricing</li>
        <li>Tools, equipment specifications, and repair techniques</li>
        <li>Any non-public information shared orally, in writing, or electronically</li>
      </ul>

      ${employeeSignRow(data, signature)}
    </div>
  `;
}

export function buildNdaPage2Markup(data: NdaFormData, logoDataUrl: string, signature: NdaSignature | undefined): string {
  return `
    <div class="nda-container">
      ${header(logoDataUrl, false)}

      <div class="nda-section-title">4. Contractor Obligations</div>
      <p>The Contractor agrees to:</p>
      <ul class="nda-bullet-list">
        <li>Not share Confidential Information with anyone outside the company</li>
        <li>Use it only as required for their job</li>
        <li>Protect it with the same care they use for their own confidential data</li>
        <li>Notify the employer immediately if any data is leaked, stolen, or misused</li>
      </ul>

      <div class="nda-section-title">5. Duration</div>
      <p>The confidentiality obligation begins on the effective date and lasts for two (2) years after employment ends.</p>

      <div class="nda-section-title">6. Exceptions</div>
      <p>This Agreement does not cover:</p>
      <ul class="nda-bullet-list">
        <li>Information already known before employment (without breach)</li>
        <li>Information publicly available without contractor's fault</li>
        <li>Data lawfully obtained from another source</li>
        <li>Info approved for release by the employer in writing</li>
      </ul>

      <div class="nda-section-title">7. Legal Requirements</div>
      <p>If required by law or a government order to disclose information, the contractor must inform the employer immediately.</p>

      ${employeeSignRow(data, signature)}
    </div>
  `;
}

export function buildNdaPage3Markup(data: NdaFormData, logoDataUrl: string, signature: NdaSignature | undefined): string {
  return `
    <div class="nda-container">
      ${header(logoDataUrl, false)}

      <div class="nda-section-title">8. Return of Information</div>
      <p>Upon termination of employment, the contractor must return or destroy all physical and digital confidential materials.</p>

      <div class="nda-section-title">9. No Rights Transferred</div>
      <p>This agreement gives the contractor no ownership or license to use the employer's intellectual property beyond job duties.</p>

      <div class="nda-section-title">10. International Compliance</div>
      <p>The contractor agrees to follow applicable laws of both the Philippines and the United States regarding confidential information and employment obligations.</p>

      <div class="nda-section-title">11. Injunctive Relief</div>
      <p>The employer may seek a court order (injunction) to prevent further harm if the contractor breaches confidentiality.</p>

      <div class="nda-section-title">12. Governing Law</div>
      <p>This agreement shall be governed by the laws of the State of Tennessee, USA. The parties agree to resolve disputes in a Tennessee court, but the agreement is enforceable internationally.</p>

      ${employeeSignRow(data, signature)}
    </div>
  `;
}

export function buildNdaPage4Markup(data: NdaFormData, logoDataUrl: string, signature: NdaSignature | undefined): string {
  const { first, last } = splitEmployeeName(data.employeeName);
  return `
    <div class="nda-container">
      ${header(logoDataUrl, false)}

      <div class="nda-section-title">13. Monetary Compensation for Breach</div>
      <p>If the contractor breaches this agreement, they agree to pay monetary compensation for all losses, damages, legal fees, and associated costs incurred by the employer as a result.</p>

      <div class="nda-section-title">14. Entire Agreement</div>
      <p>This NDA represents the full understanding. Changes must be in writing and signed by both parties.</p>

      <p style="margin-top: 16px;">IN WITNESS WHEREOF, both parties have signed this agreement on the dates below.</p>

      <div class="nda-witness-block">
        <p class="nda-witness-title">Contractor:</p>
        <div class="nda-field-row">
          <div>Signature: ${signature ? `<img class="nda-sig-img" src="${signature.url}" alt="Signature" />` : ""}</div>
        </div>
        <div class="nda-field-row">
          <div><span class="nda-field-label">Printed Name — First:</span> <strong>${blank(first)}</strong></div>
          <div><span class="nda-field-label">Last:</span> <strong>${blank(last)}</strong></div>
        </div>
        <div class="nda-field-row">
          <div><span class="nda-field-label">Date:</span> <strong>${blank(fmtDate(data.dateSigned))}</strong></div>
        </div>
      </div>

      <div class="nda-witness-block">
        <p class="nda-witness-title">Witness:</p>
        <div class="nda-field-row"><div>Signature: &nbsp;</div></div>
        <div class="nda-field-row">
          <div><span class="nda-field-label">Printed Name:</span> &nbsp;</div>
          <div><span class="nda-field-label">Title:</span> &nbsp;</div>
        </div>
      </div>

      <div class="nda-witness-block">
        <p class="nda-witness-title">Employer:</p>
        <div class="nda-field-row"><div>Signature: &nbsp;</div></div>
        <div class="nda-field-row">
          <div><span class="nda-field-label">Printed Name:</span> &nbsp;</div>
          <div><span class="nda-field-label">Title:</span> &nbsp;</div>
        </div>
        <div class="nda-field-row">
          <div><span class="nda-field-label">Company:</span> ${escapeHtml(EMPLOYER_NAME)}</div>
          <div><span class="nda-field-label">Date:</span> &nbsp;</div>
        </div>
      </div>
    </div>
  `;
}

/** All 4 pages, in order — the array captureHtmlPagesToPdfBlob (pdfCapture.ts) turns into the real multi-page PDF, and what the fill wizard's preview steps through. */
export function buildNdaFormPages(data: NdaFormData, logoDataUrl: string, signature: NdaSignature | undefined): string[] {
  return [
    buildNdaPage1Markup(data, logoDataUrl, signature),
    buildNdaPage2Markup(data, logoDataUrl, signature),
    buildNdaPage3Markup(data, logoDataUrl, signature),
    buildNdaPage4Markup(data, logoDataUrl, signature),
  ];
}
