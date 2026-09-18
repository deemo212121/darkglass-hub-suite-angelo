/**
 * Certificate of Employment — shared HTML/CSS template. Used by both the
 * generator (ReportHRDaily.tsx's Generate COE tab, which fills in
 * everything except the "For Office Use Only" signature) and the signer
 * page (SignCoeFormPage.tsx, which re-renders this exact template with the
 * signer's freshly-drawn signature composited in before re-flattening to a
 * PDF and sending it back to whoever generated it) — so the two can never
 * drift into rendering visually different documents.
 */

export interface CoeFormData {
  honorific: string;
  employeeName: string;
  employeeStartDate: string; // "YYYY-MM-DD"
  jobTitle: string;
  reason: string;
  authorizedRep: string;
  authorizedRepEmail: string;
  authorizedRepPhone: string;
  officeUseName: string;
  officeUseTitle: string;
  officeUseNumber: string;
}

// Certificate of Employment's editable body — the prose paragraphs between
// the greeting and the signature block (see companySettings.ts's
// getCompanyCoeBodyTemplate/setCompanyCoeBodyTemplate, migration 0063).
// Placeholders are substituted in at generation time; this default matches
// the original hardcoded text exactly, so nothing changes until an Admin
// edits it. Paragraphs are separated by a blank line.
export const COE_BODY_PLACEHOLDERS = ["honorific", "employeeName", "startDate", "jobTitle", "reason", "he", "his"] as const;
// This is the free-flowing letter prose only — Admin-editable via "Edit
// Template" — everything here is plain text/placeholders, no HTML, so
// editing it never means touching markup. The "For Office Use Only" stamp
// that follows it on the actual certificate is NOT part of this template —
// it's a fixed-layout box built directly in buildCoeBodyMarkup from the
// Generate COE form's own office-use fields (Name/Title/Signature/Number),
// matching the reference certificate's 2-column layout exactly.
export const DEFAULT_COE_BODY_TEMPLATE = `This is to certify that {{employeeName}} has been employed with US IN HOME SERVICES since {{startDate}}.

{{honorific}} {{employeeName}} is currently employed as a {{jobTitle}}. Throughout {{his}} employment, {{he}} has demonstrated professionalism and has remained a valued employee in good standing with our organization.

This certification is issued upon {{his}} request for {{reason}}.

Should you require any additional information or verification regarding {{his}} employment, please do not hesitate to contact us.`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// A date-only ISO string passed as a single string is parsed as UTC
// midnight; formatting it back out in the browser's local timezone
// (anything behind UTC, i.e. all of the US) rolls it back a day, e.g.
// printing "since July 5, 2026" for an employee who actually started
// July 6. Parsing the y/m/d parts directly into a local Date avoids that.
function formatDateOnlyLong(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/** Substitutes {{placeholders}} into the (already-escaped) template text and wraps blank-line-separated paragraphs in <p> tags. */
export function renderCoeBodyHtml(template: string, values: Record<string, string>): string {
  const escaped = escapeHtml(template);
  const substituted = escaped.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
  return substituted
    .split(/\n\s*\n/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p>${para.replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
}

// CSS shared by the print-window document, the live in-app preview, and
// the sign page — rendered via dangerouslySetInnerHTML so every path stays
// pixel-identical.
export const coeStyles = `
  .coe-container * { margin: 0; padding: 0; box-sizing: border-box; }
  .coe-container { width: 816px; min-height: 1056px; background: white; padding: 56px 72px; position: relative; font-family: Arial, Helvetica, sans-serif; color: #1f2937; }
  .coe-container .header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 10px; }
  .coe-container .header img.logo { width: 115px; height: 115px; object-fit: contain; }
  .coe-container .header img.ribbon { width: 260px; height: auto; }
  .coe-container h1 { text-align: center; font-size: 20px; letter-spacing: 0.3px; margin-bottom: 16px; }
  .coe-container p { font-size: 13.5px; line-height: 1.3; margin-bottom: 14px; text-align: justify; }
  .coe-container .date-line { margin-bottom: 14px; }
  .coe-container .sign-block { margin-top: 4px; }
  .coe-container .sign-block p { text-align: left; margin-bottom: 2px; }
  .coe-container .sign-line { margin-bottom: 6px; font-weight: 600; }
  .coe-container .office-use { margin-top: 34px; }
  .coe-container .office-use-rule { border: none; border-top: 1.5px solid #9ca3af; margin: 0 0 14px; }
  .coe-container .office-use-rule.bottom { margin: 14px 0 0; }
  .coe-container .office-use p { font-size: 13.5px; line-height: 1.3; margin-bottom: 8px; text-align: left; }
  .coe-container .office-use-heading { font-weight: 700; margin-bottom: 10px; }
  .coe-container .office-use .row { display: flex; gap: 90px; align-items: flex-start; margin-bottom: 8px; }
  .coe-container .office-use .row p { margin-bottom: 8px; }
  .coe-container .office-use-col:last-child p { margin-bottom: 0; }
  .coe-container .office-use u { text-decoration: underline; font-style: italic; }
  .coe-container .footer-wrap { margin-top: 36px; }
  .coe-container .footer-graphic img { display: block; width: 100%; height: auto; }
`;

export interface CoeImages {
  logo: string;
  ribbon: string;
  footer: string;
}

export function buildCoeBodyMarkup(
  data: CoeFormData,
  bodyTemplate: string,
  images: CoeImages,
  officeUseSignatureDataUrl: string | null
): string {
  const blank = (v: string) => (v.trim() ? escapeHtml(v) : "&nbsp;");
  // "Ms."/"Mrs." both read as female for pronoun purposes; anything else
  // (including "Mr.") defaults to male since it's the only other option
  // in the Honorific dropdown.
  const isFemale = data.honorific === "Ms." || data.honorific === "Mrs.";
  const values = {
    honorific: blank(data.honorific),
    employeeName: blank(data.employeeName),
    startDate: blank(data.employeeStartDate ? formatDateOnlyLong(data.employeeStartDate) : ""),
    jobTitle: blank(data.jobTitle),
    reason: blank(data.reason),
    he: isFemale ? "she" : "he",
    his: isFemale ? "her" : "his",
  };
  return `
    <div class="coe-container">
      <div class="header">
        ${images.logo ? `<img class="logo" src="${images.logo}" alt="US In Home Services" />` : `<div style="font-weight:800;font-size:14px;color:#1e3a8a;max-width:120px;">US IN HOME SERVICES</div>`}
        ${images.ribbon ? `<img class="ribbon" src="${images.ribbon}" alt="" />` : ""}
      </div>

      <h1>CERTIFICATE OF EMPLOYMENT<br/>US IN HOME SERVICES</h1>

      <p class="date-line">Date: ${escapeHtml(new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }))}</p>

      <p>To Whom It May Concern,</p>

      ${renderCoeBodyHtml(bodyTemplate, values)}

      <div class="sign-block">
        <p>Sincerely,</p>
        <p class="sign-line">${blank(data.authorizedRep)}</p>
        <p>Authorized Representative</p>
        <p>US IN HOME SERVICES</p>
        <p>Email: ${blank(data.authorizedRepEmail)}</p>
        <p>Phone: ${blank(data.authorizedRepPhone)}</p>
      </div>

      <div class="office-use">
        <hr class="office-use-rule" />
        <p class="office-use-heading">For Office Use Only:</p>
        <div class="row">
          <div class="office-use-col">
            <p>Name: ${blank(data.officeUseName)}</p>
            <p>Title: ${blank(data.officeUseTitle)}</p>
          </div>
          <div class="office-use-col">
            <p>Signature:</p>
            ${officeUseSignatureDataUrl ? `<img src="${officeUseSignatureDataUrl}" alt="Signature" style="height:44px;display:block;" />` : `<p><u>&nbsp;</u></p>`}
          </div>
        </div>
        <p>Contact Number: ${blank(data.officeUseNumber)}</p>
        <hr class="office-use-rule bottom" />
      </div>

      <div class="footer-wrap">
        <div class="footer-graphic">
          ${images.footer ? `<img src="${images.footer}" alt="" />` : ""}
        </div>
      </div>
    </div>
  `;
}
