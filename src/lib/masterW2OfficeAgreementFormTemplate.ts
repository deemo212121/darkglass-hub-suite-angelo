/**
 * Master W-2 Office & Logistics Comprehensive Policy, Conduct & Agreement —
 * the office-staff counterpart to masterW2AgreementFormTemplate.ts's
 * Technician version. Same two-party "employee fills + signs, then employer
 * countersigns" shape and the same HTML-captured-to-PDF technique (no
 * source PDF to overlay — see that file's header comment for why), but a
 * different document: office/logistics employees aren't on the road, so
 * there's no mileage/Car IQ/parts/location-tracking content here. Branch
 * Manager and up in this track are 1099-classified, so — same as the
 * Technician agreement — a driver's license photo and a Social Security
 * card photo are collected alongside the typed fields (see
 * technicianIdDocuments.ts). Deliberately no typed SSN field anywhere:
 * the photo is the only record of it.
 *
 * Two-party, same shape as the Technician agreement: the employee fills in
 * their info and signs (FillMasterW2OfficeAgreementPage.tsx), then it comes
 * back for an employer/HR representative countersignature
 * (ReportHRDaily.tsx's "Complete Employer Signature" dialog, or
 * ManagerReviewPage.tsx when reassigned to a non-HR manager).
 */

export { MASTER_W2_AGREEMENT_BRANCHES as MASTER_W2_OFFICE_AGREEMENT_BRANCHES } from "@/lib/masterW2AgreementFormTemplate";

export interface MasterW2OfficeAgreementFormData {
  /** The employee's actual profile id — not shown on the document itself, just carried alongside for lookups. */
  employeeId: string;
  /** Derived display name — [firstName, middleName, lastName].filter(Boolean).join(" "). */
  employeeName: string;
  firstName: string;
  middleName: string;
  lastName: string;
  branch: string;
  effectiveDate: string;
  addressStreet: string;
  addressCity: string;
  addressState: string;
  addressZip: string;
  phone: string;
  email: string;
  /** Storage paths in the private "technician-id-documents" bucket — see technicianIdDocuments.ts. Not URLs (the bucket is private); resolve with getTechnicianIdDocumentUrl when displaying. */
  licensePhotoPath: string;
  ssnCardPhotoPath: string;
  employeeDateSigned: string;
  employeeSignatureDataUrl: string;
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

export const masterW2OfficeAgreementStyles = `
  .mw2o-container * { margin: 0; padding: 0; box-sizing: border-box; }
  .mw2o-container { width: 816px; background: #fff; padding: 56px 64px; position: relative; font-family: Arial, Helvetica, sans-serif; color: #111827; font-size: 11.5px; line-height: 1.5; }
  .mw2o-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 6px; }
  .mw2o-header h1 { font-size: 16px; letter-spacing: 0.2px; }
  .mw2o-header h2 { font-size: 13px; font-weight: 700; margin-top: 4px; }
  .mw2o-header img { width: 64px; height: 64px; object-fit: contain; }
  .mw2o-toprow { display: flex; gap: 30px; border-bottom: 1px solid #9ca3af; padding: 5px 0; margin-top: 10px; }
  .mw2o-toprow > div { flex: 1; }
  .mw2o-label { color: #374151; }
  .mw2o-section-title { font-weight: 700; font-size: 12px; margin-top: 16px; margin-bottom: 4px; }
  .mw2o-bullet { padding: 2px 0 2px 14px; position: relative; }
  .mw2o-bullet::before { content: "•"; position: absolute; left: 0; }
  .mw2o-bullet b { font-weight: 700; }
  .mw2o-sign-row { display: flex; gap: 24px; align-items: flex-end; border-bottom: 1px solid #9ca3af; padding: 10px 2px; margin-top: 8px; }
  .mw2o-sign-name { flex: 2; }
  .mw2o-sign-sig { flex: 1; display: flex; align-items: flex-end; }
  .mw2o-sign-date { flex: 1; }
  .mw2o-sig-img { max-height: 34px; max-width: 130px; object-fit: contain; }
`;

function signRow(label: string, name: string, dateSigned: string, sigDataUrl: string) {
  return `
    <div class="mw2o-sign-row">
      <div class="mw2o-sign-name">${escapeHtml(label)}: <strong>${blank(name)}</strong></div>
      <div class="mw2o-sign-sig">Signature: ${sigDataUrl ? `<img class="mw2o-sig-img" src="${sigDataUrl}" alt="Signature" />` : ""}</div>
      <div class="mw2o-sign-date">Date: ${dateSigned ? escapeHtml(fmtDate(dateSigned)) : ""}</div>
    </div>
  `;
}

export function buildMasterW2OfficeAgreementBodyMarkup(data: MasterW2OfficeAgreementFormData, logoDataUrl: string): string {
  return `
    <div class="mw2o-container">
      <div class="mw2o-header">
        <div>
          <h1>US IN HOME SERVICES</h1>
          <h2>MASTER W-2 OFFICE &amp; LOGISTICS COMPREHENSIVE POLICY, CONDUCT &amp; AGREEMENT</h2>
        </div>
        ${logoDataUrl ? `<img src="${logoDataUrl}" alt="US In Home Services" />` : ""}
      </div>

      <div class="mw2o-section-title">1. Employee &amp; Branch Information</div>
      <div class="mw2o-toprow">
        <div><span class="mw2o-label">Full Legal Name:</span> <strong>${blank(data.employeeName)}</strong></div>
        <div><span class="mw2o-label">Branch / Office Location:</span> <strong>${blank(data.branch)}</strong></div>
        <div><span class="mw2o-label">Effective Date:</span> <strong>${blank(fmtDate(data.effectiveDate))}</strong></div>
      </div>
      <div class="mw2o-toprow">
        <div style="flex:2"><span class="mw2o-label">Home Address:</span> <strong>${blank(data.addressStreet)}, ${blank(data.addressCity)}, ${blank(data.addressState)} ${blank(data.addressZip)}</strong></div>
      </div>
      <div class="mw2o-toprow">
        <div><span class="mw2o-label">Phone Number:</span> <strong>${blank(data.phone)}</strong></div>
        <div><span class="mw2o-label">Email Address:</span> <strong>${blank(data.email)}</strong></div>
      </div>

      <div class="mw2o-section-title">Section 1. Wage, Compensation Structure &amp; Overtime Policy</div>
      <div class="mw2o-bullet"><b>Compensation Framework:</b> As a W-2 office and logistics employee, your compensation consists of an established hourly pay rate (or salary), subject to strict adherence to company operational standards and standard operating procedures (SOPs).</div>
      <div class="mw2o-bullet"><b>Minimum Wage Compliance:</b> You will be paid at least the applicable federal and state minimum wage for every hour worked.</div>
      <div class="mw2o-bullet"><b>Mandatory Timekeeping:</b> You are strictly required to accurately record all working hours — including clocking in, clocking out, and recording designated break times — using the Company's official timekeeping system. Working "off-the-clock" or failing to record time accurately violates company policy and may lead to immediate disciplinary action.</div>
      <div class="mw2o-bullet"><b>Overtime Authorization:</b> As a non-exempt employee, any hours worked in excess of forty (40) hours in a single workweek will be paid at one-and-one-half (1.5) times your regular rate of pay pursuant to the Fair Labor Standards Act (FLSA). You must obtain prior written or electronic authorization from your supervisor before working any overtime. Unapproved overtime is a policy violation subject to discipline.</div>

      <div class="mw2o-section-title">Section 2. Multi-State Compliance &amp; Governing Law</div>
      <div class="mw2o-bullet"><b>Multi-State Operations:</b> The Company operates across multiple states. Employees acknowledge that while corporate policies and governance are established under the laws of the State of Tennessee, local employment standards mandated by the specific state in which you physically perform your office duties will be respected regarding statutory minimums.</div>
      <div class="mw2o-bullet"><b>Governing Jurisdiction:</b> This Agreement shall be governed by, construed, and enforced in accordance with the laws of the State of Tennessee, without regard to conflict of law principles.</div>

      <div class="mw2o-section-title">Section 3. Company Equipment, Software &amp; Data Security</div>
      <div class="mw2o-bullet"><b>Exclusive Business Use:</b> Company-provided computers, software platforms, communication channels, inventory tracking tools, and office hardware are strictly for official business operations.</div>
      <div class="mw2o-bullet"><b>Data Privacy &amp; Prohibition of Misuse:</b> Employees have no expectation of privacy in company-owned systems. Unauthorized downloading, personal use, data extraction, or disclosure of proprietary company information, customer lists, and logistics data is strictly prohibited and constitutes grounds for immediate termination and legal action.</div>

      <div class="mw2o-section-title">Section 4. Workplace Conduct, Substance Screening &amp; Zero Tolerance</div>
      <div class="mw2o-bullet"><b>Substance-Free Workplace:</b> Employees agree to remain completely free from the influence of illegal drugs, unauthorized controlled substances, alcohol, or impairing medications while on duty, on Company premises, or operating company systems.</div>
      <div class="mw2o-bullet"><b>Testing &amp; Screening:</b> The Company reserves the right to require random, reasonable-suspicion, or post-incident drug and alcohol testing at any time during active employment, subject to applicable state and federal laws.</div>
      <div class="mw2o-bullet"><b>Disciplinary Action:</b> Refusal to submit to testing, tampering with a specimen, or a confirmed positive result constitutes immediate grounds for termination of employment.</div>

      <div class="mw2o-section-title">Section 5. Property Damage, Negligence &amp; Financial Restitution</div>
      <div class="mw2o-bullet"><b>Asset Accountability:</b> Employees are responsible for safeguarding company property, office equipment, and inventory records under their control.</div>
      <div class="mw2o-bullet"><b>Restitution for Gross Negligence:</b> If an employee causes damage, loss, or destruction to Company property, logistics assets, or client data due to willful misconduct, gross negligence, or policy violations, the employee agrees to take financial responsibility for repair or replacement costs. To the extent permitted by applicable state and federal labor laws, the Company may deduct restitution amounts from final pay or regular earnings.</div>

      <div class="mw2o-section-title">Section 6. Confidentiality and Non-Disclosure (NDA)</div>
      <div class="mw2o-bullet"><b>Proprietary Protection:</b> You agree to maintain strict confidentiality regarding all non-public operational methods, pricing structures, vendor data, customer databases, and software workflows.</div>
      <div class="mw2o-bullet"><b>Duration:</b> Confidentiality obligations remain in full force during your employment and for a period of two (2) years following the termination of employment for any reason.</div>

      <div class="mw2o-section-title">Section 7. At-Will Employment &amp; Voluntary Election</div>
      <div class="mw2o-bullet"><b>At-Will Status:</b> Employment with US In Home Services is strictly "at-will," meaning either you or the Company may terminate the employment relationship at any time, with or without cause, and with or without notice.</div>
      <div class="mw2o-bullet"><b>Voluntary Election:</b> The Employee expressly acknowledges and confirms that their W-2 employment status under this Agreement was voluntarily chosen and that any tools, equipment, or software provided are standard business conveniences that do not alter at-will status or operational control.</div>

      <div class="mw2o-section-title" style="margin-top:20px;">Employee Acknowledgment &amp; Signature</div>
      <p style="font-style:italic;">By signing below, I certify that I have read, understood, and voluntarily agree to all the terms, policies, and conditions outlined in this Master W-2 Office &amp; Logistics Comprehensive Policy, Conduct &amp; Agreement.</p>

      ${signRow("Employee Signature", data.employeeName, data.employeeDateSigned, data.employeeSignatureDataUrl)}
      ${signRow("Employer Representative Signature", "", data.employerDateSigned, data.employerSignatureDataUrl)}
    </div>
  `;
}
