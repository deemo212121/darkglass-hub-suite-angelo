/**
 * Contractor Data — shared data types + HTML/CSS document template. Unlike
 * every other automated form built this session, there's no real source
 * PDF to overlay-fill: this is a from-scratch intake form (contact/address/
 * identity info + two ID-photo uploads), so the final PDF is generated the
 * same way the Warning Form/Promotion Form/Action Plan Form/Termination
 * Notice are — a hand-built HTML template captured to PDF via
 * captureHtmlToPdfBlob (see pdfCapture.ts), not pdf-lib drawing onto a
 * blank asset. See contractorDataPdfFill.ts for the actual capture step.
 *
 * Single-party, same shape as Car IQ/Parts Responsibility: one recipient
 * fills in everything and signs — no employer/HR co-signature step. The
 * closing certification ("I certify the information above is true and
 * accurate") + signature line was added on top of the field list actually
 * requested, since every other document in this family finalizes with a
 * real signature and hr_signable_documents.signDocument requires one — the
 * fields above it are exactly what was asked for, verbatim.
 *
 * The two ID-photo fields (Social Security Card, Driver's License — each
 * "front and back", so effectively 2 files per field) are this app's first
 * use of file uploads inside the signable-documents family. Storage/upload
 * plumbing lives in firebase/storage.ts's uploadSignableDocumentAttachment
 * (logged-in path) and signableDocumentsBridge.ts's generic `attachment_*`
 * FormData handling (external no-login path) — both new, see those files'
 * comments.
 *
 * Emergency Contacts is a fixed array of 3 (ContractorDataEmergencyContact)
 * — only #1 is required, #2/#3 are entirely optional, matching the source
 * content's own "(Optional)" labeling.
 */

export const CONTRACTOR_DATA_BRANCHES = [
  "Asheville", "Atlanta", "Birmingham", "Cape Girardeau", "Chattanooga", "Columbus", "Destin", "Huntsville",
  "Jackson MS", "Jackson TN", "Jacksonville", "Jonesboro", "Knoxville", "Little Rock", "Memphis", "Mobile",
  "Montgomery", "Nashville", "New Orleans", "Norfolk", "Raleigh", "Richmond", "San Antonio", "St. Louis",
  "Savannah", "Tallahassee", "Wilmington",
] as const;

export const CONTRACTOR_DATA_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware",
  "District of Columbia", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
  "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
  "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon",
  "Pennsylvania", "Puerto Rico", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas",
  "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming",
] as const;

export const CONTRACTOR_DATA_COUNTRIES = ["United States", "Philippines", "Other"] as const;
export const CONTRACTOR_DATA_MARITAL_STATUSES = ["Single", "Married", "Divorced", "Widowed", "Separated"] as const;

/** Only contact #1 is required — #2 and #3 are entirely optional, matching the source content's own "(Optional)" labeling. */
export interface ContractorDataEmergencyContact {
  firstName: string;
  middleName: string;
  lastName: string;
  relationship: string;
  contactNumber: string;
  secondaryContactNumber: string;
}

export const BLANK_EMERGENCY_CONTACT: ContractorDataEmergencyContact = {
  firstName: "",
  middleName: "",
  lastName: "",
  relationship: "",
  contactNumber: "",
  secondaryContactNumber: "",
};

export interface ContractorDataFormData {
  /** The employee's actual profile id — not shown on the document itself, just carried alongside for lookups. */
  employeeId: string;
  /** Derived display name — [firstName, middleName, lastName].filter(Boolean).join(" "). */
  employeeName: string;
  firstName: string;
  middleName: string;
  lastName: string;
  branch: string;
  streetAddress: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  phoneNumber: string;
  otherPhoneNumber: string;
  startDate: string;
  /** YYYY-MM-DD — built in the fill UI from three separate Month/Day/Year dropdowns (not a native date picker), matching the source content's own field breakdown. */
  birthDate: string;
  ssn: string;
  /** Firebase Storage URLs — front + back as separate uploads under the same logical field, see this file's header comment. */
  ssnCardUrls: string[];
  driversLicenseNumber: string;
  driversLicenseState: string;
  driversLicenseUrls: string[];
  email: string;
  maritalStatus: string;
  spouseName: string;
  spouseEmployer: string;
  livedInNewYork: "" | "Yes" | "No";
  /** Always exactly 3 entries (#1 required, #2/#3 optional) — see ContractorDataEmergencyContact's header comment. */
  emergencyContacts: ContractorDataEmergencyContact[];
  dateSigned: string;
  /** Raw canvas PNG as a data: URL — see w4FormTemplate.ts's header comment for why this is stored alongside the durable Firebase Storage signature URL. */
  signatureDataUrl: string;
}

export interface ContractorDataSignature {
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

export const contractorDataStyles = `
  .cdata-container * { margin: 0; padding: 0; box-sizing: border-box; }
  .cdata-container { width: 816px; min-height: 1056px; background: #fff; padding: 72px; position: relative; font-family: Arial, Helvetica, sans-serif; color: #111827; font-size: 12px; line-height: 1.5; }
  .cdata-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 18px; }
  .cdata-header h1 { font-size: 20px; letter-spacing: 0.3px; }
  .cdata-header img { width: 72px; height: 72px; object-fit: contain; }
  .cdata-section-title { background: #111827; color: #fff; font-weight: 700; padding: 6px 10px; font-size: 11.5px; letter-spacing: 0.3px; margin: 18px 0 10px; }
  .cdata-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; }
  .cdata-grid.full { grid-template-columns: 1fr; }
  .cdata-row { border-bottom: 1px solid #d1d5db; padding: 5px 2px; }
  .cdata-label { color: #374151; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.2px; display: block; }
  .cdata-value { font-weight: 700; }
  .cdata-photos { display: flex; gap: 10px; margin-top: 6px; flex-wrap: wrap; }
  .cdata-photos img { width: 140px; height: 88px; object-fit: cover; border: 1px solid #d1d5db; border-radius: 4px; }
  .cdata-contact-label { font-weight: 700; font-size: 11px; margin: 12px 0 4px; }
  .cdata-cert { margin-top: 20px; font-style: italic; }
  .cdata-sign-row { display: flex; gap: 24px; align-items: flex-end; border-bottom: 1px solid #9ca3af; padding: 10px 2px; margin-top: 10px; }
  .cdata-sign-name { flex: 2; }
  .cdata-sign-sig { flex: 1; display: flex; align-items: flex-end; }
  .cdata-sign-date { flex: 1; }
  .cdata-sig-img { max-height: 36px; max-width: 140px; object-fit: contain; }
`;

function field(label: string, value: string) {
  return `<div class="cdata-row"><span class="cdata-label">${escapeHtml(label)}</span><span class="cdata-value">${blank(value)}</span></div>`;
}

export function buildContractorDataBodyMarkup(data: ContractorDataFormData, logoDataUrl: string, signature: ContractorDataSignature | undefined): string {
  const photoImgs = (urls: string[]) => urls.map((u) => `<img src="${u}" alt="" />`).join("");

  return `
    <div class="cdata-container">
      <div class="cdata-header">
        <h1>EMPLOYEE DATA</h1>
        ${logoDataUrl ? `<img src="${logoDataUrl}" alt="US In Home Services" />` : ""}
      </div>

      <div class="cdata-section-title">PERSONAL INFORMATION</div>
      <div class="cdata-grid">
        ${field("First Name", data.firstName)}
        ${field("Middle Name", data.middleName)}
        ${field("Last Name", data.lastName)}
        ${field("Branch", data.branch)}
        ${field("Birth Date", fmtDate(data.birthDate))}
        ${field("Start Date", fmtDate(data.startDate))}
        ${field("Email Address", data.email)}
        ${field("Phone Number", data.phoneNumber)}
        ${field("Other Telephone", data.otherPhoneNumber)}
      </div>

      <div class="cdata-section-title">CURRENT ADDRESS</div>
      <div class="cdata-grid">
        ${field("Street Address", data.streetAddress)}
        ${field("City", data.city)}
        ${field("State", data.state)}
        ${field("Zip Code", data.zipCode)}
        ${field("Country", data.country)}
      </div>

      <div class="cdata-section-title">IDENTIFICATION</div>
      <div class="cdata-grid">
        ${field("Social Security Number", data.ssn)}
        ${field("Driver's License Number", data.driversLicenseNumber)}
        ${field("State Issued", data.driversLicenseState)}
      </div>
      <div class="cdata-grid full">
        <div class="cdata-row">
          <span class="cdata-label">Social Security Card (Front / Back)</span>
          <div class="cdata-photos">${photoImgs(data.ssnCardUrls)}</div>
        </div>
        <div class="cdata-row">
          <span class="cdata-label">Driver's License (Front / Back)</span>
          <div class="cdata-photos">${photoImgs(data.driversLicenseUrls)}</div>
        </div>
      </div>

      <div class="cdata-section-title">MARITAL STATUS & RESIDENCY</div>
      <div class="cdata-grid">
        ${field("Marital Status", data.maritalStatus)}
        ${field("Spouse's Name", data.spouseName)}
        ${field("Spouse's Employer", data.spouseEmployer)}
        ${field("Lived in New York in the last 7 years?", data.livedInNewYork)}
      </div>

      <div class="cdata-section-title">EMERGENCY CONTACTS</div>
      ${data.emergencyContacts
        .map(
          (c, i) => `
        <p class="cdata-contact-label">${i + 1}. Full Name${i === 0 ? "" : " (Optional)"}</p>
        <div class="cdata-grid">
          ${field("First Name", c.firstName)}
          ${field("Middle Name", c.middleName)}
          ${field("Last Name", c.lastName)}
          ${field("Relationship", c.relationship)}
          ${field("Contact #", c.contactNumber)}
          ${field("Secondary Contact #", c.secondaryContactNumber)}
        </div>
      `
        )
        .join("")}

      <p class="cdata-cert">By signing below, I certify that the information provided above is true, accurate, and complete to the best of my knowledge.</p>

      <div class="cdata-sign-row">
        <div class="cdata-sign-name">Signature: <strong>${blank(data.employeeName)}</strong></div>
        <div class="cdata-sign-sig">${signature ? `<img class="cdata-sig-img" src="${signature.url}" alt="Signature" />` : ""}</div>
        <div class="cdata-sign-date">Date: ${signature ? escapeHtml(fmtDate(signature.signedAt)) : ""}</div>
      </div>
    </div>
  `;
}
