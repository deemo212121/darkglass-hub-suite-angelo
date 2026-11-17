/**
 * Ready-made terms for Admin → Terms & Conditions → "Insert AHS standard terms".
 * Loaded into the DRAFT only — nothing is live until someone presses Publish,
 * and it can be edited first. HTML in the editor's own format (h2 / h3 / p / ul / strong).
 *
 * Left out on purpose — the System shows them itself:
 *   • "Effective Date" — the accept window shows "Version N · effective <publish date>".
 *   • "User Information (recorded by the System)" — the accept window shows the
 *     person's real name, email, ID, version and time, and saves them on accepting.
 *   • "Electronic Acceptance" — that's the "I have read, understood, and agree" checkbox.
 */

const ul = (items: string[]) => `<ul>${items.map((i) => `<li><p>${i}</p></li>`).join("")}</ul>`;
const p = (text: string) => `<p>${text}</p>`;
const h2 = (text: string) => `<h2>${text}</h2>`;
const h3 = (text: string) => `<h3>${text}</h3>`;

export const AHS_STANDARD_TERMS = {
  title: "Admin Hub Solutions Terms and Conditions",
  html: [
    p("<strong>TERMS AND CONDITIONS OF USE, CONFIDENTIALITY, DATA PROTECTION &amp; ELECTRONIC CONSENT</strong>"),
    p("<strong>Company:</strong> US In Home Services (\"the Company\")<br><strong>Platform:</strong> Admin Hub Solutions (\"the System\")"),

    h2("1. Acceptance of Terms and Conditions"),
    p("Admin Hub Solutions is a company-operated platform provided by US In Home Services for authorized employees, contractors, managers, administrators, and other approved users."),
    p("By creating an account, accessing, or using the System, you acknowledge that you have read, understood, and agreed to these Terms and Conditions."),
    p("<strong>Acceptance of these Terms and Conditions is mandatory before an account can be activated or access to the System can be granted.</strong>"),
    p("The Company reserves the right to modify these Terms and Conditions, restrict access, suspend accounts, or discontinue the System when necessary for legitimate business, operational, security, or legal purposes. Material changes to these Terms will be communicated to affected users and require renewed acceptance where appropriate."),

    h2("2. Authorized Users and Access Restrictions"),
    p("The System is intended exclusively for individuals authorized by the Company."),
    p("Users may only access information, documents, records, departments, and administrative functions necessary for their assigned responsibilities and authorized job duties."),
    p("<strong>Users are prohibited from:</strong>"),
    ul([
      "Accessing accounts belonging to another individual.",
      "Attempting to bypass permissions, security restrictions, or administrative controls.",
      "Accessing employee, customer, payroll, financial, or operational records without a legitimate business reason.",
      "Sharing account access with unauthorized individuals.",
      "Using the System for personal, commercial, or unauthorized purposes.",
    ]),
    p("The Company reserves the right to grant, modify, restrict, suspend, or revoke access at any time."),

    h2("3. Account Security and Individual Accountability"),
    p("Each user is responsible for maintaining the security of their assigned account and login credentials."),
    p("<strong>Users must:</strong>"),
    ul([
      "Keep passwords and login credentials confidential.",
      "Never share accounts or passwords with another individual.",
      "Use only their personally assigned account.",
      "Immediately report suspected unauthorized access, compromised credentials, or suspicious account activity.",
      "Log out when using shared or publicly accessible devices.",
    ]),
    p("All activity conducted through an individual account may be associated with that account holder."),
    p("The Company may use account activity, access history, timestamps, device information, and other available records when investigating security concerns, policy violations, unauthorized activity, or operational disputes."),
    p("<strong>Users must not assume that activity within the System is anonymous or untraceable.</strong>"),

    h2("4. Confidentiality and Protection of Company Information"),
    p("Admin Hub Solutions may contain confidential, proprietary, sensitive, and business-critical information."),
    p("This information may include, but is not limited to:"),
    ul([
      "Customer names, addresses, contact information, and service histories.",
      "Employee personnel records and employment information.",
      "Payroll information, compensation records, and financial information.",
      "Technician performance, productivity, and operational records.",
      "Internal company communications and management decisions.",
      "Warranty claims, insurance claims, invoices, and supporting documentation.",
      "Company procedures, business reports, and internal documentation.",
      "Vendor information, pricing, agreements, and business relationships.",
    ]),
    p("Users agree to access and use confidential information exclusively for legitimate Company business."),
    p("Users may not disclose, distribute, discuss, transmit, or provide confidential information to unauthorized individuals or third parties."),
    p("<strong>These confidentiality obligations continue after employment, contractual engagement, or access to Admin Hub Solutions has ended.</strong>"),

    h2("5. Data Handling, Copying, and Distribution Restrictions"),
    p("Users are prohibited from improperly extracting, copying, downloading, photographing, recording, printing, transferring, or distributing information contained within the System."),
    p("<strong>This includes:</strong>"),
    ul([
      "Taking screenshots of confidential records without authorization.",
      "Downloading employee or customer information for personal storage.",
      "Forwarding internal documents to personal email accounts.",
      "Transferring company records to unauthorized cloud storage or external platforms.",
      "Photographing or recording confidential information displayed on a device.",
      "Sharing internal documents, reports, or communications outside authorized Company channels.",
    ]),
    p("Any permitted copying, exporting, or transfer of information must be necessary for legitimate business purposes and authorized by the Company."),
    p("Users must take reasonable precautions to prevent unauthorized individuals from viewing information displayed on personal or company-issued devices."),

    h2("6. Acceptable Use and Prohibited Activities"),
    p("Users agree to use Admin Hub Solutions professionally and in accordance with Company policies."),
    p("<strong>The following activities are prohibited:</strong>"),
    ul([
      "Harassment, intimidation, threats, or inappropriate conduct through System communications.",
      "Falsifying, manipulating, or intentionally misrepresenting Company records.",
      "Attempting to access restricted administrative functions.",
      "Circumventing security measures or system permissions.",
      "Uploading malicious files, unauthorized software, or harmful content.",
      "Using Company information for personal gain or outside business activities.",
      "Interfering with the operation, security, or integrity of the System.",
    ]),
    p("The Company may investigate suspected violations and take appropriate action."),

    h2("7. Accuracy and Integrity of Records"),
    p("Users are responsible for ensuring that information submitted through Admin Hub Solutions is accurate, truthful, and complete."),
    p("This includes, but is not limited to:"),
    ul([
      "Timekeeping entries and attendance records.",
      "Payroll-related submissions and corrections.",
      "Service tickets and work completion records.",
      "Customer information and service documentation.",
      "Expenses, reimbursements, and financial submissions.",
      "Warranty claims, damage claims, and supporting documentation.",
      "Electronic forms, acknowledgments, and internal reports.",
    ]),
    p("<strong>Intentionally falsifying, manipulating, withholding, or misrepresenting information may result in disciplinary action, up to and including termination of employment or contractual engagement.</strong>"),

    h2("8. Electronic Signatures and Acknowledgments"),
    p("Electronic signatures, checkboxes, confirmations, and other electronic acknowledgments completed through Admin Hub Solutions may constitute legally recognized electronic signatures or records where applicable law permits."),
    p("By electronically signing or acknowledging a document, the User confirms that they have reviewed and accepted the applicable document or acknowledgment."),
    p("Users are responsible for reviewing documents before submitting or electronically signing them."),
    p("The Company may retain electronic signature records, acceptance timestamps, document versions, and associated account information for verification, recordkeeping, operational, and legal purposes."),

    h2("9. Electronic Forms, Amendments, and Authorization to Modify Records"),
    p("By accepting these Terms and Conditions, the User acknowledges and agrees that electronic forms, documents, acknowledgments, submissions, and records maintained within Admin Hub Solutions may require correction, updating, or amendment for legitimate business, administrative, operational, or legal purposes."),
    p("<strong>The User authorizes the Company to make reasonable administrative and clerical corrections to submitted records, including:</strong>"),
    ul([
      "Correcting typographical errors.",
      "Correcting formatting issues.",
      "Completing administrative fields using verified information.",
      "Correcting inaccurate or incomplete entries when supported by appropriate documentation.",
      "Updating records to reflect verified administrative or operational changes.",
    ]),
    p("Such corrections must not materially misrepresent the User's original statements, change the substance of an agreement, or alter the meaning of the User's original acknowledgment."),
    p("Any material amendment or substantive change to a previously signed document, including changes to compensation arrangements, contractual obligations, permissions, or consent provisions, must be disclosed to the affected User and receive their separate affirmative authorization where required."),
    p("The Company will maintain appropriate modification records, including the original document when available, the revised version, the date of modification, the individual responsible for the modification, and the reason for the change."),
    p("<strong>Nothing in this provision authorizes the Company or its representatives to falsify, fabricate, backdate, or misrepresent a User's signature, consent, or original acknowledgment.</strong>"),
    p("Where renewed authorization is required, the User may be asked to review and electronically sign or acknowledge the revised document through Admin Hub Solutions."),

    h2("10. System Monitoring, Activity Tracking, and Auditing"),
    p("The User acknowledges and agrees that Admin Hub Solutions may collect and retain certain technical, access, and activity information when the System is accessed or used."),
    h3("A. Login and Access Information"),
    p("The System may record:"),
    ul([
      "IP addresses.",
      "Approximate geographic location derived from IP addresses, such as city, region, and approximate map coordinates.",
      "Device type and identifying technical information.",
      "Browser type and related technical information.",
      "Login dates and timestamps.",
      "Recurring access records, including once-daily records when a user remains signed in.",
    ]),
    h3("B. System Activity"),
    p("The Company may record and review activity performed within Admin Hub Solutions, including:"),
    ul([
      "Forms submitted and electronically signed.",
      "Records created, edited, or modified.",
      "Tickets and operational updates.",
      "Administrative actions.",
      "Internal communications and messages.",
      "Access to records and available activity history.",
    ]),
    h3("C. GPS and Location Tracking"),
    p("GPS location tracking applies only to technicians who have separately signed the Company's Location Consent Agreement."),
    p("For those technicians, GPS collection is limited to periods when they are clocked in, subject to the separate agreement and applicable law."),
    p("<strong>Acceptance of these Terms and Conditions alone does not constitute GPS location consent.</strong>"),
    h3("D. Purpose of Monitoring"),
    p("The Company may use collected information for legitimate purposes, including:"),
    ul([
      "Account security and identity verification.",
      "Detecting unauthorized access and shared accounts.",
      "Payroll and timekeeping verification.",
      "Operational oversight and performance review.",
      "Investigating policy violations and disputes.",
      "Protecting Company property and confidential information.",
      "Meeting legal, regulatory, and recordkeeping obligations.",
    ]),
    p("Access to IP addresses and sign-in records will be restricted to authorized administrators and personnel with an appropriate business need."),
    p("Authorized Company representatives may review System records, including internal messages and activity history, when there is a legitimate business, security, investigative, or legal reason."),

    h2("11. Data Ownership, Storage, and Retention"),
    p("The User acknowledges that Admin Hub Solutions is a Company-operated business platform used to store, maintain, process, and organize Company information."),
    p("Business records, operational documentation, customer records, employee records, uploaded Company documents, internal communications, and other business information maintained within the System are Company records, subject to applicable law and individual privacy rights."),
    p("<strong>The Company may:</strong>"),
    ul([
      "Store information submitted through the System.",
      "Maintain records for operational and administrative purposes.",
      "Retain electronic signatures and document histories.",
      "Back up information for security and recovery purposes.",
      "Provide authorized personnel with access to records necessary for their responsibilities.",
      "Use authorized technology providers to host, maintain, secure, and support the System.",
    ]),
    p("Information will be retained according to applicable legal requirements, Company recordkeeping policies, legitimate business needs, and applicable privacy obligations."),
    p("The Company will implement reasonable administrative and technical safeguards designed to protect stored information against unauthorized access, disclosure, alteration, or destruction."),
    p("Users should understand that no electronic system can guarantee absolute protection against every security threat."),

    h2("12. Personal Devices and External Access"),
    p("Users accessing Admin Hub Solutions through personal computers, tablets, or mobile devices remain responsible for protecting Company information."),
    p("<strong>Users must:</strong>"),
    ul([
      "Secure their devices with appropriate passwords or authentication.",
      "Avoid leaving confidential records accessible to unauthorized individuals.",
      "Avoid storing Company information locally unless authorized.",
      "Avoid accessing confidential information over unsecured or public devices.",
      "Immediately report lost devices or suspected unauthorized access involving Company information.",
    ]),
    p("The Company may restrict access from devices or environments that present a security risk."),

    h2("13. Security Violations and Reporting Obligations"),
    p("<strong>Users must immediately notify the Company or designated administrator if they become aware of:</strong>"),
    ul([
      "Unauthorized access to an account.",
      "Lost or compromised login credentials.",
      "Accidental disclosure of confidential information.",
      "Unauthorized downloads or transfers.",
      "Suspicious account activity.",
      "Lost devices containing Company information.",
      "Potential security vulnerabilities or data breaches.",
    ]),
    p("Users must cooperate with reasonable Company investigations involving security incidents, data protection, or unauthorized System activity."),
    p("Failure to report known security incidents or intentional participation in unauthorized activities may result in disciplinary action."),

    h2("14. Termination of Access and Continuing Obligations"),
    p("Access to Admin Hub Solutions may be suspended or terminated when:"),
    ul([
      "Employment or contractual engagement ends.",
      "A User changes positions or no longer requires access.",
      "An account presents a security risk.",
      "A User violates these Terms and Conditions.",
      "The Company determines access is no longer necessary for business purposes.",
    ]),
    p("Upon termination of access, Users may not attempt to regain unauthorized access, retain confidential Company information, or use previously obtained information for unauthorized purposes."),
    p("<strong>All confidentiality, data protection, and non-disclosure obligations continue after access is terminated and after the User's employment or contractual relationship ends.</strong>"),

    h2("15. Violations and Disciplinary Action"),
    p("Violations of these Terms and Conditions may result in corrective or disciplinary action, depending on the nature and severity of the violation."),
    p("Possible consequences include:"),
    ul([
      "Written warnings.",
      "Mandatory retraining.",
      "Temporary suspension of System access.",
      "Permanent revocation of System access.",
      "Termination of employment or contractual engagement.",
      "Referral to appropriate legal authorities when warranted.",
    ]),
    p("The Company reserves the right to pursue available legal remedies in cases involving unauthorized disclosure, misuse of confidential information, data theft, fraud, or other unlawful conduct."),

    h2("16. Amendments to These Terms and Conditions"),
    p("The Company reserves the right to update or revise these Terms and Conditions as necessary to reflect changes in business operations, security requirements, technology, or applicable laws."),
    p("Users will be notified of material revisions when appropriate and may be required to review and electronically accept the revised Terms before continuing to use Admin Hub Solutions."),

    h2("17. Legal Provisions and Governing Law"),
    p("These Terms and Conditions will be interpreted in accordance with the applicable laws of the <strong>State of Tennessee</strong>, without regard to conflict-of-law principles, subject to applicable federal and state laws."),
    p("If any provision of these Terms and Conditions is determined to be invalid or unenforceable, the remaining provisions will remain effective to the extent permitted by law."),
    p("Nothing in these Terms and Conditions is intended to waive rights or protections that cannot legally be waived."),

    h2("User Acknowledgment and Electronic Consent"),
    p("By selecting the acceptance checkbox and submitting this agreement through Admin Hub Solutions, <strong>I acknowledge and confirm that:</strong>"),
    ul([
      "I have read and understood these Terms and Conditions.",
      "I understand that Admin Hub Solutions contains confidential Company, customer, employee, payroll, financial, and operational information.",
      "I agree to protect confidential information and use the System exclusively for authorized business purposes.",
      "I understand that my account activity, access history, and certain technical information may be monitored, recorded, and reviewed for legitimate Company purposes.",
      "I authorize the Company to retain and maintain information and records submitted through Admin Hub Solutions in accordance with these Terms and applicable privacy requirements.",
      "I acknowledge the Company's authority to make appropriate administrative and clerical corrections to submitted records, subject to the limitations described in Section 9.",
      "I understand that material changes to previously signed documents may require separate disclosure and authorization.",
      "I understand that my confidentiality and data protection obligations continue after my access to the System or employment with the Company ends.",
      "I understand that violations of these Terms and Conditions may result in disciplinary action, up to and including termination of employment or contractual engagement.",
    ]),
    p("<strong>By accepting below, I voluntarily acknowledge and agree to these Terms and Conditions as a condition of receiving access to Admin Hub Solutions.</strong>"),
  ].join(""),
};
