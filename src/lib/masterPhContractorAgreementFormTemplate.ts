/**
 * Master Philippines Independent Contractor Comprehensive Agreement — the
 * PH-staff counterpart to masterW2AgreementFormTemplate.ts / masterW2Office
 * AgreementFormTemplate.ts. Different relationship entirely: PH staff are
 * engaged as independent contractors (not W-2 employees), so this document
 * covers the business-to-business/tax-independence framing, confidentiality,
 * the PH-specific leave policy (PTO gated to US Staff/PH Managers only,
 * unpaid sick days, half-day approval), and governing law/e-signature terms
 * — no wage/overtime, no equipment/data-security, no substance-screening
 * sections (those are W-2 employment concepts that don't apply here).
 *
 * Same HTML-captured-to-PDF technique (no source PDF to overlay) and the
 * same two-party "contractor fills + signs, then employer countersigns"
 * shape as the other two Master agreements. PH contractors have neither a
 * US driver's license nor a US SSN, so instead of the Technician/Office
 * agreements' two-photo license+SSN-card capture, this collects a single
 * "license or passport / government-issued ID" photo — whichever the
 * contractor actually has (see technicianIdDocuments.ts's "government_id"
 * kind).
 */

export interface MasterPhContractorAgreementFormData {
  /** The contractor's actual profile id — not shown on the document itself, just carried alongside for lookups. */
  employeeId: string;
  /** Derived display name — [firstName, middleName, lastName].filter(Boolean).join(" "). */
  employeeName: string;
  firstName: string;
  middleName: string;
  lastName: string;
  /** "Philippines" | "USA" | "Other" — paired with nationalityOther when "Other". */
  nationality: string;
  nationalityOther: string;
  addressStreet: string;
  addressCity: string;
  addressState: string;
  addressZip: string;
  addressCountry: string;
  phone: string;
  otherPhone: string;
  email: string;
  dateOfBirth: string;
  startDate: string;
  /** "Single" | "Married" | "Divorced" */
  maritalStatus: string;
  spouseName: string;
  spouseEmployer: string;
  /** Storage path in the private "technician-id-documents" bucket — see technicianIdDocuments.ts. Not a URL (the bucket is private); resolve with getTechnicianIdDocumentUrl when displaying. */
  governmentIdPhotoPath: string;
  contractorDateSigned: string;
  contractorSignatureDataUrl: string;
  employerDateSigned: string;
  employerSignatureDataUrl: string;
}

const escapeHtml = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const blank = (v: string) => (v && v.trim() ? escapeHtml(v) : "&nbsp;");

const fmtDate = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString();
};

const checkbox = (checked: boolean) => (checked ? "☑" : "☐");

export const masterPhContractorAgreementStyles = `
  .mphc-container * { margin: 0; padding: 0; box-sizing: border-box; }
  .mphc-container { width: 816px; background: #fff; padding: 56px 64px; position: relative; font-family: Arial, Helvetica, sans-serif; color: #111827; font-size: 11.5px; line-height: 1.5; }
  .mphc-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 6px; }
  .mphc-header h1 { font-size: 16px; letter-spacing: 0.2px; }
  .mphc-header h2 { font-size: 13px; font-weight: 700; margin-top: 4px; }
  .mphc-header img { width: 64px; height: 64px; object-fit: contain; }
  .mphc-toprow { display: flex; gap: 30px; border-bottom: 1px solid #9ca3af; padding: 5px 0; margin-top: 10px; }
  .mphc-toprow > div { flex: 1; }
  .mphc-label { color: #374151; }
  .mphc-section-title { font-weight: 700; font-size: 12px; margin-top: 16px; margin-bottom: 4px; }
  .mphc-bullet { padding: 2px 0 2px 14px; position: relative; }
  .mphc-bullet::before { content: "•"; position: absolute; left: 0; }
  .mphc-bullet b { font-weight: 700; }
  .mphc-sub { padding: 2px 0 2px 30px; position: relative; }
  .mphc-sub::before { content: "◦"; position: absolute; left: 16px; }
  .mphc-sign-row { display: flex; gap: 24px; align-items: flex-end; border-bottom: 1px solid #9ca3af; padding: 10px 2px; margin-top: 8px; }
  .mphc-sign-name { flex: 2; }
  .mphc-sign-sig { flex: 1; display: flex; align-items: flex-end; }
  .mphc-sign-date { flex: 1; }
  .mphc-sig-img { max-height: 34px; max-width: 130px; object-fit: contain; }
`;

function signRow(label: string, name: string, dateSigned: string, sigDataUrl: string) {
  return `
    <div class="mphc-sign-row">
      <div class="mphc-sign-name">${escapeHtml(label)}: <strong>${blank(name)}</strong></div>
      <div class="mphc-sign-sig">Signature: ${sigDataUrl ? `<img class="mphc-sig-img" src="${sigDataUrl}" alt="Signature" />` : ""}</div>
      <div class="mphc-sign-date">Date: ${dateSigned ? escapeHtml(fmtDate(dateSigned)) : ""}</div>
    </div>
  `;
}

export function buildMasterPhContractorAgreementBodyMarkup(data: MasterPhContractorAgreementFormData, logoDataUrl: string): string {
  return `
    <div class="mphc-container">
      <div class="mphc-header">
        <div>
          <h1>US IN HOME SERVICES</h1>
          <h2>MASTER PHILIPPINES INDEPENDENT CONTRACTOR COMPREHENSIVE AGREEMENT</h2>
        </div>
        ${logoDataUrl ? `<img src="${logoDataUrl}" alt="US In Home Services" />` : ""}
      </div>

      <div class="mphc-section-title">1. Contractor &amp; Personal Information</div>
      <div class="mphc-toprow">
        <div><span class="mphc-label">Full Legal Name:</span> <strong>${blank(data.employeeName)}</strong></div>
        <div><span class="mphc-label">Nationality:</span> <strong>${checkbox(data.nationality === "Philippines")} Philippines &nbsp; ${checkbox(data.nationality === "USA")} USA &nbsp; ${checkbox(data.nationality === "Other")} Other: ${blank(data.nationalityOther)}</strong></div>
      </div>
      <div class="mphc-toprow">
        <div style="flex:2"><span class="mphc-label">Current Address:</span> <strong>${blank(data.addressStreet)}, ${blank(data.addressCity)}, ${blank(data.addressState)} ${blank(data.addressZip)}, ${blank(data.addressCountry)}</strong></div>
      </div>
      <div class="mphc-toprow">
        <div><span class="mphc-label">Phone Number:</span> <strong>${blank(data.phone)}</strong></div>
        <div><span class="mphc-label">Other Telephone:</span> <strong>${blank(data.otherPhone)}</strong></div>
        <div><span class="mphc-label">Email Address:</span> <strong>${blank(data.email)}</strong></div>
      </div>
      <div class="mphc-toprow">
        <div><span class="mphc-label">Date of Birth:</span> <strong>${blank(fmtDate(data.dateOfBirth))}</strong></div>
        <div><span class="mphc-label">Start Date:</span> <strong>${blank(fmtDate(data.startDate))}</strong></div>
      </div>
      <div class="mphc-toprow">
        <div><span class="mphc-label">Marital Status:</span> <strong>${checkbox(data.maritalStatus === "Single")} Single &nbsp; ${checkbox(data.maritalStatus === "Married")} Married &nbsp; ${checkbox(data.maritalStatus === "Divorced")} Divorced</strong></div>
      </div>
      <div class="mphc-toprow">
        <div><span class="mphc-label">Spouse's Name:</span> <strong>${blank(data.spouseName)}</strong></div>
        <div><span class="mphc-label">Spouse's Employer:</span> <strong>${blank(data.spouseEmployer)}</strong></div>
      </div>

      <div class="mphc-section-title">Section 1. Independent Contractor Relationship</div>
      <div class="mphc-bullet"><b>Business-to-Business Status:</b> You are engaged and contracted strictly as an independent contractor providing remote back-office, administrative, or technical support services to US In Home Services, and not as a regular employee under local Philippine labor codes or U.S. employment laws.</div>
      <div class="mphc-bullet"><b>Tax &amp; Statutory Independence:</b> As an independent contractor, you are solely responsible for all personal income taxes, local filings, and national contributions (such as SSS, PhilHealth, and Pag-IBIG). No local statutory benefits or U.S. employee withholdings are deducted by the Company.</div>

      <div class="mphc-section-title">Section 2. Confidentiality &amp; Non-Disclosure (NDA)</div>
      <div class="mphc-bullet"><b>Confidential Information:</b> You acknowledge that the Company may disclose certain confidential or proprietary information during your engagement. Confidential Information includes, but is not limited to:</div>
      <div class="mphc-sub">Customer data and service records</div>
      <div class="mphc-sub">Technical processes, manuals, and methods</div>
      <div class="mphc-sub">Business strategies, operational methods, and pricing</div>
      <div class="mphc-sub">Tools, equipment specifications, and repair techniques</div>
      <div class="mphc-sub">Any non-public information shared orally, in writing, or electronically</div>
      <div class="mphc-bullet"><b>Strict Obligation:</b> You agree to keep all Confidential Information strictly secret and use it solely for the performance of your designated job responsibilities.</div>

      <div class="mphc-section-title">Section 3. Off Days &amp; Leave Policy (PH Staff)</div>
      <div class="mphc-bullet"><b>Paid Time Off (PTO):</b> Paid Time Off is available for designated US Staff and PH Managers only, granted upon the completion of one (1) year of continuous service and resetting annually (1 Year: 5 days; 2 Years: 6 days; 3 Years: 7 days). Unused PTO does not carry over. Newly hired non-manager PH employees are not eligible for PTO.</div>
      <div class="mphc-bullet"><b>Unpaid Sick Days:</b> Eligible employees may take up to 5 unpaid sick days per year starting three (3) months after their hire date, which require a doctor's note for validation.</div>
      <div class="mphc-bullet"><b>Half-Day Schedules:</b> Manager approval is required for all half-day work schedules or early departures due to personal or health reasons, and only the remaining unworked hours are treated as unpaid.</div>

      <div class="mphc-section-title">Section 4. Governing Law &amp; Electronic Execution</div>
      <div class="mphc-bullet"><b>Governing Law:</b> This Agreement and the business relationship shall be governed by and construed in accordance with the laws of the State of Tennessee, USA, without prejudice to international service agreements.</div>
      <div class="mphc-bullet"><b>Electronic Signatures:</b> Electronic signatures, digital form submissions, and online verifications carry the exact same legal force and effect as original handwritten signatures.</div>

      <div class="mphc-section-title" style="margin-top:20px;">Contractor Acknowledgment &amp; Signature</div>
      <p style="font-style:italic;">By signing below, I certify that I have read, understood, and voluntarily agree to all the terms, policies, and conditions outlined in this Master Philippines Independent Contractor Comprehensive Agreement (including Personal Data, Confidentiality, and Leave Policies).</p>

      ${signRow("Contractor Signature", data.employeeName, data.contractorDateSigned, data.contractorSignatureDataUrl)}
      ${signRow("Employer Representative Signature", "", data.employerDateSigned, data.employerSignatureDataUrl)}
    </div>
  `;
}
