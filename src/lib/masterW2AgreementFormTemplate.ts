/**
 * Master W-2 Technician Comprehensive Policy, Consent & Agreement — a
 * single consolidated form covering the same ground as 11 separate
 * Technician Forms (Acknowledgment of Wage, Meal & Rest Break, Location
 * Sharing Consent, Mileage & Fuel Policy, Car IQ Technician Agreement,
 * Company Vehicle Use Agreement, Flash Technician Travel, Damage Agreement,
 * Parts Responsibility, PTO & Sick Leave Policy, Employee Confidentiality,
 * Substance Screening) in one document with one signature instead of
 * eleven. Direct Deposit Authorization and Employee Data stay separate —
 * neither is covered by this document's sections.
 *
 * No pre-made source PDF (same as warningFormTemplate.ts / contractorData
 * FormTemplate.ts) — built as an HTML/CSS document captured to PDF via
 * captureHtmlToPdfBlob, not a pdf-lib overlay on a scanned file.
 *
 * Two-party, same shape as Acknowledgment of Wage: the employee fills in
 * their info and signs (FillMasterW2AgreementPage.tsx), then it comes back
 * for an employer/HR representative countersignature
 * (ReportHRDaily.tsx's "Complete Employer Signature" dialog, or
 * ManagerReviewPage.tsx when reassigned to a non-HR manager).
 *
 * Two photo uploads (driver's license, Social Security card) are collected
 * alongside the typed fields — see technicianIdDocuments.ts. Deliberately
 * no typed SSN field anywhere: the photo is the only record of it, so
 * there's never a plaintext SSN sitting in a database column. The photos
 * are stored as their own private-bucket paths (formData.licensePhotoPath /
 * ssnCardPhotoPath) and are NOT drawn onto the generated PDF — they're
 * reviewable separately via getTechnicianIdDocumentUrl, same as a
 * candidate's CV isn't baked into anything either.
 */

export const MASTER_W2_AGREEMENT_BRANCHES = [
  "Asheville", "Atlanta", "Birmingham", "Cape Girardeau", "Chattanooga", "Columbus", "Destin", "Huntsville",
  "Jackson MS", "Jackson TN", "Jacksonville", "Jonesboro", "Knoxville", "Little Rock", "Memphis", "Mobile",
  "Montgomery", "Nashville", "New Orleans", "Norfolk", "Raleigh", "Richmond", "San Antonio", "St. Louis",
  "Savannah", "Tallahassee", "Wilmington",
] as const;

export interface MasterW2AgreementFormData {
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

export const masterW2AgreementStyles = `
  .mw2-container * { margin: 0; padding: 0; box-sizing: border-box; }
  .mw2-container { width: 816px; background: #fff; padding: 56px 64px; position: relative; font-family: Arial, Helvetica, sans-serif; color: #111827; font-size: 11.5px; line-height: 1.5; }
  .mw2-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 6px; }
  .mw2-header h1 { font-size: 16px; letter-spacing: 0.2px; }
  .mw2-header h2 { font-size: 13px; font-weight: 700; margin-top: 4px; }
  .mw2-header img { width: 64px; height: 64px; object-fit: contain; }
  .mw2-toprow { display: flex; gap: 30px; border-bottom: 1px solid #9ca3af; padding: 5px 0; margin-top: 10px; }
  .mw2-toprow > div { flex: 1; }
  .mw2-label { color: #374151; }
  .mw2-section-title { font-weight: 700; font-size: 12px; margin-top: 16px; margin-bottom: 4px; }
  .mw2-bullet { padding: 2px 0 2px 14px; position: relative; }
  .mw2-bullet::before { content: "•"; position: absolute; left: 0; }
  .mw2-bullet b { font-weight: 700; }
  .mw2-sign-row { display: flex; gap: 24px; align-items: flex-end; border-bottom: 1px solid #9ca3af; padding: 10px 2px; margin-top: 8px; }
  .mw2-sign-name { flex: 2; }
  .mw2-sign-sig { flex: 1; display: flex; align-items: flex-end; }
  .mw2-sign-date { flex: 1; }
  .mw2-sig-img { max-height: 34px; max-width: 130px; object-fit: contain; }
`;

function signRow(label: string, name: string, dateSigned: string, sigDataUrl: string) {
  return `
    <div class="mw2-sign-row">
      <div class="mw2-sign-name">${escapeHtml(label)}: <strong>${blank(name)}</strong></div>
      <div class="mw2-sign-sig">Signature: ${sigDataUrl ? `<img class="mw2-sig-img" src="${sigDataUrl}" alt="Signature" />` : ""}</div>
      <div class="mw2-sign-date">Date: ${dateSigned ? escapeHtml(fmtDate(dateSigned)) : ""}</div>
    </div>
  `;
}

export function buildMasterW2AgreementBodyMarkup(data: MasterW2AgreementFormData, logoDataUrl: string): string {
  return `
    <div class="mw2-container">
      <div class="mw2-header">
        <div>
          <h1>US IN HOME SERVICES</h1>
          <h2>MASTER W-2 TECHNICIAN COMPREHENSIVE POLICY, CONSENT &amp; AGREEMENT</h2>
        </div>
        ${logoDataUrl ? `<img src="${logoDataUrl}" alt="US In Home Services" />` : ""}
      </div>

      <div class="mw2-section-title">1. Employee &amp; Branch Information</div>
      <div class="mw2-toprow">
        <div><span class="mw2-label">Full Legal Name:</span> <strong>${blank(data.employeeName)}</strong></div>
        <div><span class="mw2-label">Branch Location:</span> <strong>${blank(data.branch)}</strong></div>
        <div><span class="mw2-label">Effective Date:</span> <strong>${blank(fmtDate(data.effectiveDate))}</strong></div>
      </div>
      <div class="mw2-toprow">
        <div style="flex:2"><span class="mw2-label">Home Address:</span> <strong>${blank(data.addressStreet)}, ${blank(data.addressCity)}, ${blank(data.addressState)} ${blank(data.addressZip)}</strong></div>
      </div>
      <div class="mw2-toprow">
        <div><span class="mw2-label">Phone Number:</span> <strong>${blank(data.phone)}</strong></div>
        <div><span class="mw2-label">Email Address:</span> <strong>${blank(data.email)}</strong></div>
      </div>

      <div class="mw2-section-title">Section 1. Wage, Compensation Structure &amp; Overtime Policy</div>
      <div class="mw2-bullet"><b>Compensation Framework:</b> As a W-2 employee, your compensation consists of a base hourly pay rate plus performance-based commissions, subject to strict adherence to company standards and standard operating procedures (SOPs).</div>
      <div class="mw2-bullet"><b>Minimum Wage &amp; Make-Up Pay:</b> You will be paid at least the applicable federal and state minimum wage for every hour worked. If your total earnings (base hourly pay plus commissions) do not equal at least the applicable minimum wage rate for all hours worked in a given workweek, the Company will provide a minimum match pay adjustment to satisfy statutory requirements.</div>
      <div class="mw2-bullet"><b>Timekeeping Obligations:</b> You are strictly required to accurately record all hours worked — including clocking in, clocking out, and recording designated break times — using the Company's official timekeeping system. Working "off-the-clock" or failing to record time accurately violates company policy and may lead to disciplinary action.</div>
      <div class="mw2-bullet"><b>Overtime Policy:</b> As a non-exempt employee, any hours worked in excess of forty (40) hours in a single workweek will be paid at one-and-one-half (1.5) times your regular rate of pay pursuant to the Fair Labor Standards Act (FLSA). You must obtain prior supervisor authorization before working any overtime.</div>
      <div class="mw2-bullet"><b>Commission Adjustments:</b> Commissions are contingent upon compliance with company policies and quality standards, and may be adjusted or forfeited if jobs are incomplete or policies are violated. The Company reserves the right to modify commission rates with prior notice.</div>

      <div class="mw2-section-title">Section 2. Mandatory Rest and Meal Break Policy</div>
      <div class="mw2-bullet"><b>Automatic Break Allocation:</b> Any field employee who works six (6) hours or more in a single workday will automatically have a 30-minute break time factored into their daily schedule and time tracking.</div>
      <div class="mw2-bullet"><b>Compliance:</b> Taking mandatory breaks is required by company policy and applicable labor guidelines; you agree to take your scheduled breaks as instructed.</div>

      <div class="mw2-section-title">Section 3. Mobile App Location-Sharing Consent</div>
      <div class="mw2-bullet"><b>Mandatory App Usage:</b> You are required to install and keep the official AHS App active on your company-approved mobile device while performing job duties.</div>
      <div class="mw2-bullet"><b>Real-Time GPS Tracking:</b> You consent to the Company tracking, monitoring, and recording your real-time geographic location through the AHS App strictly during active working hours (from clock-in/shift start to clock-out/shift end) for dispatching, routing, timekeeping accuracy, productivity verification, and field safety.</div>
      <div class="mw2-bullet"><b>Off-Hours Privacy &amp; Restrictions:</b> The Company will not track your location outside of active working hours. Tampering with, disabling, uninstalling, or bypassing the location-sharing feature while on duty violates company policy and may result in disciplinary action up to termination.</div>

      <div class="mw2-section-title">Section 4. Personal Vehicle Mileage and Fuel Policy</div>
      <div class="mw2-bullet"><b>Route Calculation &amp; Rates:</b> Mileage is calculated from the office (or starting stop) to customer locations, concluding at your home, using standard Google Maps routing. Personal fuel: $0.40/mile. Company-provided Car IQ: $0.20/mile.</div>
      <div class="mw2-bullet"><b>Long-Distance Daily Mileage Bonuses:</b> Over 200 miles = $30 bonus; over 300 miles = $60 bonus; over 400 miles = $80 bonus.</div>
      <div class="mw2-bullet"><b>Reporting:</b> You are responsible for submitting accurate daily mileage records and route logs for payroll processing.</div>

      <div class="mw2-section-title">Section 5. Car IQ Fuel Management Guidelines</div>
      <div class="mw2-bullet"><b>Usage Restrictions:</b> Car IQ may only be used on days you are actively running tickets. Charges are strictly restricted to the vehicle registered under your name in the system.</div>
      <div class="mw2-bullet"><b>Business Travel Approval:</b> For business travel, you must secure prior approval from HR and your Senior Branch Manager before travel begins.</div>
      <div class="mw2-bullet"><b>Violations:</b> Improper usage results in pay deductions equal to the improper dollar amount, removal from Car IQ, tier demotion, or employment termination.</div>

      <div class="mw2-section-title">Section 6. Company Vehicle Use &amp; Out-of-State Flash Travel Policy</div>
      <div class="mw2-bullet"><b>Licensing &amp; General Operation:</b> Employees operating a company-owned vehicle must maintain a valid driver's license, obey all traffic regulations, ensure all occupants wear seatbelts, and report any traffic citations or accidents within 12 hours.</div>
      <div class="mw2-bullet"><b>Flash Technician Travel &amp; Dispatch:</b> Out-of-state deployments must be officially approved and scheduled via the company dispatch system (EarlyRepair) in advance, using designated company vehicles equipped with Car IQ.</div>
      <div class="mw2-bullet"><b>Family / Companion Restrictions on Travel:</b> Flash out-of-state trips are strictly business deployments; non-employees are strictly prohibited from riding in company service vehicles.</div>

      <div class="mw2-section-title">Section 7. Parts Responsibility, Tool Damage &amp; Property Damage Deductions</div>
      <div class="mw2-bullet"><b>Parts Accountability:</b> You are fully responsible for all parts assigned or checked out. Lost or misplaced parts due to negligence may result in replacement cost recovery through administrative payroll adjustments, to the extent permitted by law.</div>
      <div class="mw2-bullet"><b>Floor Protection Protocol:</b> Technicians are strictly required to use protective floor mats when moving or servicing appliances, and must upload a clear photo proof for every ticket.</div>
      <div class="mw2-bullet"><b>Damage Penalties &amp; Commission Deductions:</b> If property damage, part loss, or tool damage occurs due to negligence or safety violations, you may be held financially responsible for up to 50% of total damage/replacement costs (not to exceed $1,000 per incident for property damage), deductible from earned commissions and/or spread across multiple pay periods.</div>

      <div class="mw2-section-title">Section 8. Paid Time Off (PTO) and Sick Leave Policy</div>
      <div class="mw2-bullet"><b>Paid Time Off (PTO):</b> Paid vacation is provided at 5 days per year after completing 1 year of continuous employment, scaling incrementally (1 Year: 5 days; 2 Years: 6 days; 3 Years: 7 days).</div>
      <div class="mw2-bullet"><b>Sick Leave:</b> Sick days are provided at 5 days per year after 3 months of continuous employment, requiring a doctor's note or valid excuse for coverage.</div>

      <div class="mw2-section-title">Section 9. Confidentiality and Non-Disclosure</div>
      <div class="mw2-bullet"><b>Confidential Information:</b> You agree to maintain strict confidentiality regarding customer data, service records, technical processes, pricing, and proprietary tools.</div>
      <div class="mw2-bullet"><b>Duration:</b> Confidentiality obligations remain in effect during employment and for two (2) years following the termination of employment.</div>

      <div class="mw2-section-title">Section 10. At-Will Employment &amp; Governing Law</div>
      <div class="mw2-bullet"><b>At-Will Status:</b> Employment with US In Home Services is "at-will," meaning either you or the Company may terminate the relationship at any time, with or without cause or notice.</div>
      <div class="mw2-bullet"><b>Governing Law:</b> This Agreement is governed by the laws of the State of Tennessee.</div>

      <div class="mw2-section-title">Section 11. Substance Screening &amp; Workplace Conduct Agreement</div>
      <div class="mw2-bullet"><b>Mandatory Drug &amp; Alcohol Testing:</b> You agree to submit to and successfully pass pre-employment substance screenings administered via PlusOne Solutions (or a designated third-party testing provider) prior to commencing duty assignments. The Company also reserves the right to require random, reasonable-suspicion, or post-incident testing during active employment, subject to applicable laws.</div>
      <div class="mw2-bullet"><b>Disciplinary Consequences:</b> Refusal to submit to testing, tampering with a specimen, unexcused failure to appear, or a confirmed positive result constitutes a direct violation of Company policy and grounds for immediate disciplinary action up to and including termination.</div>
      <div class="mw2-bullet"><b>Workplace Conduct:</b> You agree to remain completely free from the influence of illegal drugs, unauthorized controlled substances, alcohol, or impairing medications while on duty, on Company premises, or operating vehicles and equipment.</div>
      <div class="mw2-bullet"><b>Property Damage &amp; Restitution:</b> If you cause damage, loss, or destruction to property due to willful misconduct, gross negligence, or substance-induced impairment, you agree to take financial responsibility for repair or replacement costs, deductible from final or regular pay where permitted by state labor laws.</div>

      <div class="mw2-section-title">Section 12. Tier-Based Commission Structure &amp; Advancement Guidelines</div>
      <div class="mw2-bullet">Your commission compensation per completed service ticket is structured based on your assigned technical tier level (Tier 1, Tier 2, or Tier 3), each with its own minor/major/high-end ticket rates. You are guaranteed at least the applicable federal and state minimum wage for all hours worked; commissions are strictly contingent on adherence to Company SOPs, quality standards, safety protocols, and proper documentation.</div>

      <div class="mw2-section-title">Section 13. Voluntary Election and Mutual Agreement</div>
      <div class="mw2-bullet">You expressly acknowledge that your W-2 employment status and structure under this Agreement were not forced, mandated, or requested by the Company, but were instead actively requested, elected, and voluntarily chosen by you for your own professional and employment advantages. Any complimentary support, equipment access, uniforms, or software systems provided are business tools and do not alter these employment terms.</div>

      <div class="mw2-section-title">Section 14. Phone Usage Reimbursement</div>
      <div class="mw2-bullet">To support business communication and required company mobile applications on personal devices, the Company provides a monthly phone usage reimbursement stipend of $30.00, processed through the regular payroll system subject to proper attendance and operational reporting.</div>

      <div class="mw2-section-title" style="margin-top:20px;">Employee Acknowledgment &amp; Signature</div>
      <p style="font-style:italic;">By signing below, I certify that I have read, understood, and voluntarily agree to all the terms, policies, and conditions outlined in this Master W-2 Technician Comprehensive Policy &amp; Agreement.</p>

      ${signRow("Employee Signature", data.employeeName, data.employeeDateSigned, data.employeeSignatureDataUrl)}
      ${signRow("Employer Representative Signature", "", data.employerDateSigned, data.employerSignatureDataUrl)}
    </div>
  `;
}
