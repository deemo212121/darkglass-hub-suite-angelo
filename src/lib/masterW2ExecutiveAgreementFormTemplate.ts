/**
 * W-2 Executive Exempt Management Employment Agreement — the BM/SBS/
 * Director/Tech Assistant Director tier's own consolidated agreement,
 * replacing that tier's Contractor Addendum + Form W-9 (those were 1099
 * paperwork; this tier is W-2, so the "New Automation Forms" flow now sends
 * this instead — see BM_AND_UP_FORM_TYPES's own comment). Direct Deposit
 * Authorization stays separate, same as every other Master Agreement.
 *
 * Source is a "REVISED SEPTEMBER 2026 - DISCUSSION DRAFT FOR REVIEW" —
 * marked "FINAL STATE-SPECIFIC REVIEW RECOMMENDED BEFORE USE" on its last
 * page. Transcribed verbatim; not legal advice, and due for a real review
 * pass before this is relied on the way the other Master Agreements are.
 *
 * No pre-made source PDF (same as masterW2AgreementFormTemplate.ts) — built
 * as an HTML/CSS document captured to PDF via captureHtmlToPdfBlob. No ID
 * photo uploads (unlike the Technician/Office agreements) — this document
 * doesn't ask for one.
 *
 * Two-party: the employee fills in their info and signs
 * (FillMasterW2ExecutiveAgreementPage.tsx), then it comes back for a
 * Company-authorized-signature countersignature (ReportHRDaily.tsx's
 * "Add Employer Signature" dialog, or ManagerReviewPage.tsx if reassigned).
 */

export const MASTER_W2_EXECUTIVE_AGREEMENT_POSITIONS = ["Branch Manager", "Senior Branch Manager", "Director", "Other"] as const;

export interface MasterW2ExecutiveAgreementFormData {
  /** The employee's actual profile id — not shown on the document itself, just carried alongside for lookups. */
  employeeId: string;
  /** As typed — the source document has one "Employee legal name" line, not split first/middle/last like the other Master Agreements. */
  employeeName: string;
  /** One of MASTER_W2_EXECUTIVE_AGREEMENT_POSITIONS. */
  position: string;
  /** Only used/shown when position === "Other". */
  positionOther: string;
  effectiveDate: string;
  primaryWorkState: string;
  homeBranchRegion: string;
  reportsTo: string;
  /** Dollar amount only — pay frequency is fixed "Biweekly" per the source document. */
  guaranteedAnnualSalary: string;
  employeeDateSigned: string;
  employeeSignatureDataUrl: string;
  employerDateSigned: string;
  employerSignatureDataUrl: string;
  /** "Printed name / title" on the Company authorized signature line — typed by HR when countersigning. */
  employerPrintedNameTitle: string;
}

const escapeHtml = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const blank = (v: string) => (v && v.trim() ? escapeHtml(v) : "&nbsp;");

const fmtDate = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString();
};

export const masterW2ExecutiveAgreementStyles = `
  .mw2x-container * { margin: 0; padding: 0; box-sizing: border-box; }
  .mw2x-container { width: 816px; background: #fff; padding: 56px 64px; position: relative; font-family: Arial, Helvetica, sans-serif; color: #111827; font-size: 11px; line-height: 1.5; }
  .mw2x-eyebrow { text-align: center; font-size: 10px; color: #6b7280; }
  .mw2x-header { text-align: center; margin-bottom: 4px; }
  .mw2x-header h1 { font-size: 15px; letter-spacing: 0.2px; }
  .mw2x-header h2 { font-size: 13px; font-weight: 700; margin-top: 2px; }
  .mw2x-draft-banner { text-align: center; font-weight: 700; font-size: 10.5px; margin: 8px 0 10px; }
  .mw2x-p { margin: 6px 0; text-align: justify; }
  .mw2x-section-title { font-weight: 700; font-size: 12px; margin-top: 14px; margin-bottom: 4px; }
  .mw2x-subtitle { font-weight: 700; font-size: 11px; margin-top: 10px; margin-bottom: 2px; }
  .mw2x-bullet { padding: 2px 0 2px 14px; position: relative; text-align: justify; }
  .mw2x-bullet::before { content: "•"; position: absolute; left: 0; }
  .mw2x-bullet b { font-weight: 700; }
  .mw2x-table { width: 100%; border-collapse: collapse; margin: 8px 0; border: 1px solid #9ca3af; }
  .mw2x-table td { border: 1px solid #9ca3af; padding: 5px 8px; vertical-align: top; }
  .mw2x-table td.mw2x-table-label { font-weight: 700; width: 34%; background: #f3f4f6; }
  .mw2x-sign-row { display: flex; gap: 24px; align-items: flex-end; border-bottom: 1px solid #9ca3af; padding: 10px 2px; margin-top: 8px; }
  .mw2x-sign-name { flex: 2; }
  .mw2x-sign-sig { flex: 1; display: flex; align-items: flex-end; }
  .mw2x-sign-date { flex: 1; }
  .mw2x-sig-img { max-height: 34px; max-width: 130px; object-fit: contain; }
  .mw2x-page-footer { text-align: center; font-size: 9.5px; color: #6b7280; margin-top: 14px; }
`;

function signRow(label: string, name: string, dateSigned: string, sigDataUrl: string) {
  return `
    <div class="mw2x-sign-row">
      <div class="mw2x-sign-name">${escapeHtml(label)}: <strong>${blank(name)}</strong></div>
      <div class="mw2x-sign-sig">Signature: ${sigDataUrl ? `<img class="mw2x-sig-img" src="${sigDataUrl}" alt="Signature" />` : ""}</div>
      <div class="mw2x-sign-date">Date: ${dateSigned ? escapeHtml(fmtDate(dateSigned)) : ""}</div>
    </div>
  `;
}

export function buildMasterW2ExecutiveAgreementBodyMarkup(data: MasterW2ExecutiveAgreementFormData, logoDataUrl: string): string {
  const positionDisplay = data.position === "Other" ? data.positionOther : data.position;
  return `
    <div class="mw2x-container">
      <p class="mw2x-eyebrow">US In Home Services | W-2 Executive Exempt Management Employment Agreement | Revised Review Draft</p>
      <div class="mw2x-header">
        ${logoDataUrl ? `<img src="${logoDataUrl}" alt="US In Home Services" style="width:56px;height:56px;object-fit:contain;" />` : ""}
        <h1>US IN HOME SERVICES</h1>
        <h2>W-2 Executive Exempt Management Employment Agreement</h2>
      </div>
      <p class="mw2x-draft-banner">REVISED SEPTEMBER 2026 — DISCUSSION DRAFT FOR REVIEW</p>

      <p class="mw2x-p"><b>Purpose and classification.</b> This Agreement documents W-2 employment in a management position the Company intends to classify as exempt from federal and applicable state overtime requirements. The exemption applies only while the Employee's actual compensation and actual primary duties satisfy all applicable requirements. A title, salary, signature, high compensation, temporary technical work, or the parties' preference does not by itself create an exemption.</p>
      <p class="mw2x-p"><b>Administration.</b> This Agreement is for management positions whose actual primary duty is management. It is not the regular agreement for a Field Technician whose primary duty is performing service tickets or repairs. The Company may use a separate internal classification checklist, audit, or legal review to confirm exempt status; such internal records are not part of this Employee Agreement.</p>
      <p class="mw2x-p"><b>Mandatory law controls.</b> Nothing in this Agreement is intended to waive a right that cannot lawfully be waived. Mandatory federal, state, and local law controls over any inconsistent term.</p>

      <div class="mw2x-section-title">1. Parties, Position, and Effective Date</div>
      <p class="mw2x-p">This Agreement is between US Appliance, Inc., doing business as US In Home Services (Company), and the employee identified below (Employee). On and after the Effective Date, the Employee will be treated as a W-2 employee, subject to lawful payroll withholding and employment reporting.</p>

      <table class="mw2x-table">
        <tr><td class="mw2x-table-label">Employee legal name</td><td><strong>${blank(data.employeeName)}</strong></td></tr>
        <tr><td class="mw2x-table-label">Position</td><td><strong>${blank(positionDisplay)}</strong></td></tr>
        <tr><td class="mw2x-table-label">Effective date</td><td><strong>${blank(fmtDate(data.effectiveDate))}</strong></td></tr>
        <tr><td class="mw2x-table-label">Primary work state/locality</td><td><strong>${blank(data.primaryWorkState)}</strong></td></tr>
        <tr><td class="mw2x-table-label">Home branch/region</td><td><strong>${blank(data.homeBranchRegion)}</strong></td></tr>
        <tr><td class="mw2x-table-label">Reports to</td><td><strong>${blank(data.reportsTo)}</strong></td></tr>
        <tr><td class="mw2x-table-label">Guaranteed annual salary / pay frequency</td><td><strong>${data.guaranteedAnnualSalary ? `$${escapeHtml(data.guaranteedAnnualSalary)}` : "&nbsp;"}</strong> / Biweekly</td></tr>
      </table>

      <p class="mw2x-p"><b>Prospective conversion; no admission.</b> This Agreement governs employment on and after the Effective Date. It is not an admission that any prior classification, payment practice, or agreement violated law, and it does not by itself release or settle any claim concerning an earlier period. Any settlement or release concerning an earlier period must be handled separately in a legally compliant writing.</p>

      <div class="mw2x-section-title">2. At-Will Employment</div>
      <p class="mw2x-p">Employment is at will to the fullest extent permitted by applicable law. Either the Employee or the Company may end the employment relationship at any time, with or without advance notice and with or without cause, subject to applicable law. Only a written agreement signed by an authorized owner and expressly changing at-will status may alter this provision.</p>
      <p class="mw2x-p">Company policies, performance plans, discipline steps, schedules, assignments, and statements about anticipated duration of employment do not create a guaranteed term of employment. At-will status does not authorize a termination for a reason prohibited by law.</p>

      <div class="mw2x-section-title">3. Executive Exempt Classification Conditions</div>
      <p class="mw2x-p">The Company intends to use the executive exemption only while the actual job satisfies every applicable requirement. The core federal requirements are:</p>
      <div class="mw2x-bullet"><b>Salary level and salary basis.</b> The Employee must receive at least the applicable minimum salary on a salary basis, subject only to deductions permitted by law.</div>
      <div class="mw2x-bullet"><b>Primary duty.</b> The Employee's principal and most important duty must be management of the Company or a customarily recognized department, branch, region, or subdivision.</div>
      <div class="mw2x-bullet"><b>Supervision.</b> The Employee must customarily and regularly direct the work of at least two full-time employees or the equivalent.</div>
      <div class="mw2x-bullet"><b>Personnel authority.</b> The Employee must have actual authority to hire or fire, or the Employee's recommendations regarding hiring, firing, promotion, advancement, discipline, demotion, or another change of status must receive particular weight.</div>
      <p class="mw2x-p"><b>Actual duties control.</b> The Company may review the Employee's actual duties, reporting relationships, authority, work location, salary, and amount and purpose of field work at any time. The Employee must accurately perform and document the management responsibilities assigned to the position and promptly report a material change that could affect classification.</p>

      <div class="mw2x-section-title">4. Role-Specific Management Duties</div>
      <p class="mw2x-p">The Employee is not required to perform every listed task every day. The actual role, taken as a whole, must retain management as its primary and most important duty.</p>
      <div class="mw2x-subtitle">Branch Manager</div>
      <p class="mw2x-p">Manages a permanent branch or recognized operating unit; directs employees; allocates work; sets operating priorities; monitors attendance, productivity, quality, customer outcomes, documentation, safety, parts and property controls; trains and evaluates employees; resolves or escalates operational and technical issues; addresses deficient performance; and makes personnel recommendations that receive particular weight.</p>
      <div class="mw2x-subtitle">Senior Branch Manager</div>
      <p class="mw2x-p">Manages two or more branches or a recognized multi-branch region; directs Branch Managers and/or other qualifying employees; evaluates branch operations; assigns staffing and stabilization resources; coaches and evaluates managers and staff; addresses compliance deficiencies and escalations; and makes significant personnel recommendations that receive particular weight.</p>
      <div class="mw2x-subtitle">Director</div>
      <p class="mw2x-p">Oversees assigned branches, technical operations, and significant administrative or compliance functions; sets operating priorities; directs managers and other personnel; evaluates branch, service, technical, customer, LTP, and documentation outcomes; directs corrective action; allocates people and resources; coordinates branch stabilization; and advises ownership on significant operational and personnel decisions.</p>
      <p class="mw2x-p">Ownership may retain final decision authority. A manager's personnel recommendations may still be management functions when they are part of the job, are made with sufficient frequency, concern employees the manager directs, and are genuinely considered.</p>

      <div class="mw2x-section-title">5. Management Authority and Accountability</div>
      <p class="mw2x-p">Within authority delegated by the Company, the Employee will plan and direct work; assign or reassign employees; set priorities; monitor attendance, productivity, quality, documentation, safety, customer outcomes, parts and property controls; coach and train; investigate operational failures; resolve or escalate serious matters; and recommend personnel action. The Employee will exercise independent judgment within Company policies, customer commitments, manufacturer requirements, and applicable law.</p>
      <p class="mw2x-p">The Employee must provide candid, timely, and accurate management recommendations and must not create artificial reporting relationships, records, or duties to support an exempt classification. The Company retains ultimate corporate and legal authority and may accept, modify, or reject recommendations.</p>

      <div class="mw2x-section-title">6. Schedule, Attendance, Availability, Travel, and Time Records</div>
      <p class="mw2x-p">The position is full time and requires reliable attendance, availability, responsiveness, and business travel consistent with Company needs. Travel, including temporary assignments to another branch or state, is an expected part of the position. The Company may establish schedules, meetings, coverage requirements, deadlines, response expectations, attendance rules, and approval procedures and may discipline failure to meet them, subject to applicable law.</p>
      <p class="mw2x-p">The Company may require an exempt Employee to record days worked, leave, travel, work locations, schedules, assignments, or hours for operational, benefits, safety, client, leave, or classification-review purposes. Such tracking does not by itself convert the position to hourly or nonexempt status.</p>
      <p class="mw2x-p">If the Company prospectively reclassifies the Employee as nonexempt, the Employee must follow the Company's written timekeeping instructions, accurately record all compensable work and travel time, and perform no off-the-clock work. The Company will pay recorded compensable time, including overtime when required by law.</p>

      <div class="mw2x-section-title">7. Guaranteed Salary, Payroll, and Taxes</div>
      <p class="mw2x-p">The Company will pay the Employee the predetermined guaranteed salary stated in Section 1 through regular payroll, less lawful tax withholding and other deductions permitted by law. The salary must meet or exceed the applicable federal, state, and local salary threshold for the exemption.</p>
      <p class="mw2x-p">The Company's regular payroll is biweekly. Each pay period contains two consecutive seven-day workweeks, Sunday through Saturday. The salary is compensation for the Employee's overall management responsibilities and is not earned by the hour, ticket, day, or shift.</p>
      <p class="mw2x-p">Except for a deduction specifically permitted by applicable law, the Employee receives the full salary for any workweek in which the Employee performs any work. No salary is required for a full workweek in which the Employee performs no work, unless Company policy or applicable law requires payment. Lawful full-day or other permitted deductions are addressed in Section 10.</p>
      <p class="mw2x-p">Guaranteed salary is not a recoverable draw, advance, debt, or negative balance. Incentive compensation, if offered, is additional compensation and does not reduce the guaranteed salary owed for a workweek.</p>

      <div class="mw2x-section-title">8. Performance Incentives and Qualified Completed Tickets</div>
      <p class="mw2x-p">The Company may offer additional incentive compensation for Qualified Completed Tickets, Flash Assignments, LTP stabilization, management performance, or other stated results. The Company is not required to offer an incentive unless it has communicated an applicable incentive opportunity in writing, which may be through an agreement, compensation schedule, policy, offer notice, payroll notice, or other Company-issued written communication.</p>
      <p class="mw2x-p"><b>Qualified Completed Ticket.</b> A Qualified Completed Ticket is an authorized service ticket assigned or approved for the Employee on which the required work was actually performed and the ticket is fully and accurately completed in the Company's approved system. Required completion includes, as applicable, accurate status entries, diagnosis and repair information, customer acknowledgments, required codes, model and serial information, parts records, photographs, notes, complete invoice information, required timestamps, and any other documentation required by Company, customer, manufacturer, warranty administrator, or program rules.</p>
      <p class="mw2x-p"><b>Recall / redo / return work.</b> A recall, redo, return visit, or multi-visit ticket qualifies for incentive treatment only under the Company's then-current written compensation rule for that ticket type. The Company may deny duplicate credit for the same underlying service event and may require completion of corrective work before the ticket qualifies, provided the Company does not retroactively withhold compensation that has already become earned and payable under applicable law.</p>
      <p class="mw2x-p">A canceled, duplicate, no-service, customer-unavailable, unperformed, fraudulent, materially incomplete, unauthorized, or unsubmitted ticket is not a Qualified Completed Ticket. The Company may review documentation and require reasonable corrections before the applicable earning event.</p>
      <p class="mw2x-p"><b>No guaranteed ticket volume.</b> The Company does not promise any minimum number, value, geographic concentration, or frequency of service tickets, Flash Assignments, LTP opportunities, or other incentive opportunities. This does not reduce guaranteed salary or compensation that has already become earned and payable.</p>
      <p class="mw2x-p">The Company may prospectively revise or discontinue an incentive opportunity by written notice to the extent permitted by law. No incentive term will be used to create a negative salary balance or to recoup guaranteed salary from a later pay period.</p>

      <div class="mw2x-section-title">9. Temporary Out-of-Branch Stabilization / Flash Assignments</div>
      <p class="mw2x-p">The Company may temporarily assign the Employee to another branch, market, territory, or state for days or weeks and may make successive assignments as business needs require. A Flash Assignment is an assignment description, not a separate job title.</p>
      <p class="mw2x-p">For an exempt manager, the purpose of a Flash Assignment may include personnel management, operational evaluation, technical leadership, training, escalation resolution, compliance correction, workflow improvement, backlog reduction, and measurable performance improvement. The Employee may perform hands-on field tickets during an assignment when doing so supports stabilization, training, diagnostic review, backlog reduction, or technical leadership.</p>
      <p class="mw2x-p">Repeated or extended Flash Assignments are permitted so long as the Employee's actual primary duty remains management and all exemption requirements continue to be satisfied. If ordinary field production becomes the Employee's primary duty or another exemption element is no longer met, the Company may change duties or prospectively reclassify the Employee as nonexempt before continuing the work.</p>
      <p class="mw2x-p">Regular W-2 nonexempt Field Technicians may also be assigned to Flash Assignments under a separate nonexempt Flash Assignment acknowledgment or Company policy. Their assignment does not make them exempt. They must accurately record all compensable time and travel time and will be paid minimum wage, overtime, travel time, and reimbursable expenses as required by the laws applicable where they work.</p>

      <div class="mw2x-section-title">10. Leave, Paid Time Off, and Salary Deductions</div>
      <p class="mw2x-p">The Employee must follow Company leave, attendance, notice, and approval procedures, except where applicable law requires otherwise. Available PTO may be charged in accordance with Company policy and applicable law.</p>
      <p class="mw2x-p">Salary deductions will be made only when permitted by applicable federal, state, and local law. Examples that may be permitted include: one or more full days of absence for personal reasons; qualifying full-day sickness or disability absences under a bona fide leave or salary-replacement plan; qualifying unpaid FMLA or other legally permitted leave; qualifying full-day disciplinary suspensions for serious workplace conduct violations; penalties for major safety-rule violations; the initial or final week of employment; and a full workweek in which no work is performed.</p>
      <p class="mw2x-p">A partial-day absence generally will not reduce the exempt Employee's cash salary unless a specific law permits it, although the Company may charge an available PTO bank in partial-day increments when lawful. The Company will not reduce salary because work is unavailable, ticket volume falls, a branch closes, or the Company sends the Employee home while the Employee is ready, willing, and able to work.</p>
      <p class="mw2x-p">Payroll or Human Resources must approve an exempt-salary deduction before it is processed. If the Employee believes an improper salary deduction occurred, the Employee should promptly report it to Payroll or Human Resources. The Company will investigate and reimburse an improper deduction when required by law.</p>

      <div class="mw2x-section-title">11. Travel, Lodging, Expenses, Vehicles, and Car IQ</div>
      <p class="mw2x-p">Authorized business travel will be handled under Company policy and applicable law. The Company may book and pay lodging directly. Company-paid lodging and reimbursed business expenses are not part of the guaranteed salary.</p>
      <p class="mw2x-p">The Employee must use Company-paid lodging, rental vehicles, Company vehicles, fuel accounts, Car IQ, credit cards, and travel reservations only for authorized business purposes and must exercise reasonable care. The Employee is responsible for promptly reporting loss, damage, misuse, unauthorized charges, accidents, or other material incidents and for preserving receipts, photographs, and records.</p>
      <p class="mw2x-p">Hotel or vehicle damage, unauthorized charges, intentional misuse, fraud, theft, or other loss may result in removal of access, discipline up to termination, an insurance claim, civil recovery, restitution, or other lawful remedy. The Company will not make an automatic payroll deduction or withhold protected wages unless the deduction is specifically lawful and all required authorization, notice, minimum-wage, and timing rules are satisfied.</p>
      <p class="mw2x-p">Car IQ and fuel accounts may be used only for approved business purposes, approved dates, and the vehicle registered or authorized by the Company. Unauthorized use, falsification, personal use without approval, or use designed to evade Company controls may result in immediate account suspension, discipline up to termination, and any civil, insurance, criminal-referral, or other legal remedy available to the Company.</p>
      <p class="mw2x-p">The Employee must maintain any required driver's license and legally required insurance, follow traffic and hands-free laws, and immediately report an accident, suspension, restriction, or other matter materially affecting safe or lawful driving.</p>

      <div class="mw2x-section-title">12. Performance Documentation and Compliance</div>
      <p class="mw2x-p">The Employee will maintain accurate, timely, and complete records required for branch operations, payroll and leave administration, customer service, manufacturer or warranty obligations, ticket completion, LTP measurement, parts custody, expenses, safety, training, personnel decisions, and regulatory compliance. Records must be truthful and maintained in approved Company systems.</p>
      <p class="mw2x-p">The Employee must not alter, backdate, fabricate, conceal, delete in violation of a preservation requirement, or direct another person to falsify a business, payroll, customer, warranty, safety, personnel, or performance record.</p>

      <div class="mw2x-section-title">13. Safety, Fitness for Duty, and Impairment</div>
      <p class="mw2x-p">The Employee must perform work safely and comply with applicable law, Company safety rules, manufacturer requirements, customer-site rules, vehicle requirements, and instructions designed to prevent injury or property damage. Required protective equipment, floor protection, photographs, and other safety documentation must be used and enforced.</p>
      <p class="mw2x-p">The Employee must not report to work, drive, operate equipment, enter a customer location, handle appliances, supervise safety-sensitive work, or remain on duty while impaired by alcohol, illegal drugs, misused medication, cannabis where impairment affects safe performance, or any other substance or condition that makes performance unsafe.</p>
      <p class="mw2x-p">Subject to written Company policy and applicable law, the Company may require testing, evaluation, removal from safety-sensitive duty, documentation, or other fitness-for-duty measures. Refusal or violation may result in discipline up to termination.</p>

      <div class="mw2x-section-title">14. Company Property, Parts, Accounts, Loss, and Damage</div>
      <p class="mw2x-p">The Employee is responsible for safeguarding and properly using Company and customer property, including parts, tools, appliances, vehicles, devices, fuel cards, Car IQ or similar accounts, Company credit cards, documents, badges, credentials, keys, logins, access tokens, software, and data. The Employee must follow inventory, chain-of-custody, purchasing, fuel, security, and return procedures.</p>
      <p class="mw2x-p">The Employee must promptly report an accident, customer claim, missing or unreturned part, inventory discrepancy, equipment loss, unauthorized transaction, fuel-account concern, theft, misuse, or property damage; preserve relevant evidence; cooperate truthfully with Company, insurer, customer, manufacturer, warranty administrator, or lawful investigation; and must not admit Company liability, promise payment, or settle a claim without authority.</p>
      <p class="mw2x-p"><b>Discipline and financial recovery are separate.</b> The Company may discipline up to and including termination for negligence, gross negligence, willful misconduct, dishonesty, theft, fraud, falsification, unauthorized use, failure to follow required safeguards, or other policy violations.</p>
      <p class="mw2x-p">To the fullest extent permitted by applicable law, the Company reserves the right to pursue lawful recovery for proven loss caused by fraud, theft, intentional misconduct, unauthorized use, or other conduct for which the Employee may legally be held responsible. Available remedies may include insurance recovery, return of property, restitution, civil action, referral to law enforcement, or another lawful remedy. Nothing in this Agreement creates an automatic payroll deduction, automatic debt, or blanket employee indemnity where the law does not permit one.</p>

      <div class="mw2x-section-title">15. Confidentiality, Credentials, Manufacturer Information, and Data Security</div>
      <p class="mw2x-p">Confidential Information means nonpublic information concerning the Company or any customer, manufacturer, warranty administrator, vendor, employee, contractor, or business partner, including business systems, operating rules, pricing, rates, financial information, payroll information, customer and employee data, dispatch and ticket data, performance and LTP metrics, vendor and manufacturer contracts, technical support procedures, service methods, training materials, manufacturer portals, service manuals, diagnostic and troubleshooting methods, repair data, parts information, credentials, logins, access tokens, software configurations, forecasts, expansion plans, strategies, and other nonpublic business information.</p>
      <p class="mw2x-p">The Employee may access, use, copy, or disclose Confidential Information only as necessary for authorized Company work and only to persons authorized to receive it. The Employee must not share manufacturer or partner logins, training, procedures, manuals, service data, credentials, pricing, contracts, customer information, internal systems, or Company materials with competitors, unauthorized technicians, former employees, social media, public forums, personal email or storage, unapproved artificial-intelligence services, or any other unauthorized external source.</p>
      <p class="mw2x-p">The Employee must use reasonable security safeguards, follow Company cybersecurity and credential rules, and immediately report suspected loss, compromise, unauthorized access, phishing, credential sharing, or data exposure. On request or separation, the Employee must return Company property and delete unauthorized copies, subject to lawful preservation duties.</p>
      <p class="mw2x-p">These confidentiality duties continue for five (5) years after employment ends, and continue indefinitely for trade secrets, passwords, credentials, access tokens, and information protected for a longer period by law or contract. This section does not prohibit lawful reporting to government agencies, communications with an attorney, filing or participating in a legal claim, protected concerted activity, or other disclosures protected by law.</p>

      <div class="mw2x-section-title">16. Conflicts, Outside Activities, and Duty of Loyalty</div>
      <p class="mw2x-p">During employment, the Employee will act in the Company's legitimate interests, avoid undisclosed conflicts, not divert Company business or misuse Company opportunities, and not perform outside work that materially interferes with assigned duties, schedules, safety, confidentiality, or legal obligations. The Employee must disclose an actual or reasonably apparent conflict and follow a lawful Company resolution.</p>
      <p class="mw2x-p">This Agreement does not create a post-employment noncompetition covenant. Confidentiality, property-return, intellectual-property, and other lawful post-employment obligations remain enforceable according to their terms.</p>

      <div class="mw2x-section-title">17. Work Product, Systems, Monitoring, and Authority</div>
      <p class="mw2x-p">To the extent permitted by law, work product created within the scope of employment or using Company resources is owned by the Company as work made for hire and is assigned to the Company if not automatically owned.</p>
      <p class="mw2x-p">Company systems, accounts, devices, networks, and business communications may be accessed, preserved, monitored, or reviewed under disclosed Company policy and applicable law. The Employee has no authority to bind the Company, sign a contract, waive a Company right, make a public statement for the Company, promise employment, settle a claim, or incur an unapproved obligation unless expressly authorized.</p>

      <div class="mw2x-section-title">18. Equal Employment, Accommodation, Protected Leave, and Retaliation</div>
      <p class="mw2x-p">The Company will administer this Agreement consistent with applicable anti-discrimination, accommodation, protected-leave, wage, safety, workers' compensation, whistleblower, and anti-retaliation laws. Management employees must promptly escalate protected complaints or requests to Human Resources or an authorized owner and must not retaliate or obstruct a lawful investigation.</p>

      <div class="mw2x-section-title">19. Classification Review and Reclassification</div>
      <p class="mw2x-p">Human Resources or an authorized owner may review the actual position whenever salary, work location, direct reports, personnel authority, or primary duties materially change, and periodically as the Company considers appropriate. Substantial or sustained ticket work, repeated Flash Assignments, loss of direct reports, or material changes in authority are reasons for review.</p>
      <p class="mw2x-p">If the facts or law do not support the executive exemption, the Company may change duties, compensation, reporting responsibility, or prospectively reclassify the Employee as nonexempt. Upon nonexempt reclassification, the Company will provide the applicable pay method and timekeeping rules and will pay minimum wage and overtime as required by law.</p>

      <div class="mw2x-section-title">20. Governing Law and Multi-State Compliance</div>
      <p class="mw2x-p">The Employee may work in more than one state or locality. Mandatory federal law and the mandatory law of each jurisdiction where work is performed will apply when required. A temporary assignment may trigger wage, overtime, travel-time, expense-reimbursement, leave, pay-notice, privacy, safety, final-pay, meal/rest, or other requirements in the destination jurisdiction.</p>
      <p class="mw2x-p">The Company may require the Employee to report work locations and may issue a state or local notice, policy, or addendum when needed. If a jurisdiction imposes a more protective mandatory requirement, that requirement controls to the extent applicable.</p>

      <div class="mw2x-section-title">21. General Terms</div>
      <p class="mw2x-p"><b>Policies.</b> The Employee must comply with lawful Company policies as amended from time to time. Policies do not create a guaranteed term of employment.</p>
      <p class="mw2x-p"><b>Entire agreement.</b> This Agreement is the entire agreement concerning the Employee's W-2 management employment, exempt salary structure, and Flash Assignment framework on and after the Effective Date, except for separate benefit plans, compensation notices, incentive schedules, policies, and other documents governing their respective subjects.</p>
      <p class="mw2x-p"><b>Amendment and waiver.</b> A change to guaranteed salary, at-will status, or a substantive term of this Agreement must be in a writing authorized by the Company, except that the Company may make prospective policy, assignment, and incentive changes as permitted by law. Failure to enforce a term on one occasion is not a continuing waiver.</p>
      <p class="mw2x-p"><b>Severability.</b> If any provision is held unlawful, invalid, or unenforceable, it will be narrowed or severed only to the minimum extent necessary, and the remaining provisions will continue in effect to the fullest extent permitted by law.</p>
      <p class="mw2x-p"><b>Electronic signatures and counterparts.</b> This Agreement may be signed electronically and in counterparts, each of which will be treated as an original.</p>

      <div class="mw2x-section-title">22. Operational Direction, Correction, and Escalation</div>
      <p class="mw2x-p">The Company may direct schedules, assignments, staffing, customer commitments, safety requirements, documentation, service standards, manufacturer requirements, quality controls, and other lawful operating standards. Exempt status does not give the Employee absolute autonomy from Company direction.</p>
      <p class="mw2x-p">If an instruction appears unlawful, unsafe, outside delegated authority, or likely to create material customer, personnel, wage, safety, fraud, or compliance exposure, the Employee must promptly escalate the concern to Human Resources, an authorized owner, or the designated reporting contact and preserve relevant information. Emergency action may be taken first when reasonably necessary to prevent imminent harm.</p>

      <div class="mw2x-section-title">23. Insurance, Workers' Compensation, and Claims Cooperation</div>
      <p class="mw2x-p">The Company will maintain workers' compensation coverage or a lawful alternative, unemployment coverage, and other insurance required by applicable law or Company contracts. Coverage and claims decisions are governed by applicable law and controlling policy documents.</p>
      <p class="mw2x-p">The Employee must promptly report work-related injury, vehicle incidents, customer claims, property damage, and circumstances reasonably likely to produce a claim; obtain emergency assistance when appropriate; preserve records and photographs; and cooperate truthfully with lawful investigations, insurers, administrators, customers, manufacturers, warranty administrators, and government agencies.</p>
      <p class="mw2x-p">The Employee must not waive a claim, admit liability on behalf of the Company, or agree to a settlement without authority. The existence of insurance does not prevent the Company from pursuing any lawful remedy for fraud, theft, intentional misconduct, unauthorized use, or other legally recoverable loss.</p>

      <div class="mw2x-section-title">24. W-2 Status and Classification Acknowledgment</div>
      <p class="mw2x-p">On and after the Effective Date, the Employee performs services as a W-2 employee and not as an independent contractor or separate business under this Agreement. The Company may control lawful results, standards, schedules, assignments, methods, policies, and the manner of employment consistent with the position.</p>
      <p class="mw2x-p">Employee status and overtime exemption are legal classifications determined by actual facts and governing law. The Employee's request, consent, tax preference, signature, prior acceptance of Form 1099 payments, or preference for another arrangement does not create an exemption or waive wages or overtime required by law.</p>
      <p class="mw2x-p">This Agreement is prospective. It does not admit a violation in an earlier period and does not itself release or settle any earlier claim or obligation.</p>

      <div class="mw2x-section-title" style="margin-top:20px;">Agreement Signatures</div>
      <p class="mw2x-p">By signing, the parties acknowledge the W-2 employment relationship, the Company's intended executive-exempt classification while the legal requirements are met, the guaranteed salary structure, the Employee's management responsibilities, and the Company's right to direct, review, discipline, and protect its operations and property as stated in this Agreement.</p>

      ${signRow("Employee Signature", data.employeeName, data.employeeDateSigned, data.employeeSignatureDataUrl)}
      ${signRow("Company Authorized Signature", data.employerPrintedNameTitle, data.employerDateSigned, data.employerSignatureDataUrl)}

      <p class="mw2x-page-footer">DISCUSSION DRAFT — FINAL STATE-SPECIFIC REVIEW RECOMMENDED BEFORE USE</p>
    </div>
  `;
}
