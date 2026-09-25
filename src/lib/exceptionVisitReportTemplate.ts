/**
 * Employee Attendance & Visit Exception Report — shared HTML/CSS template,
 * mirroring promotionFormTemplate.ts's shape exactly (same reason: used by
 * both the submission flow and every later signer, so they can never drift
 * into rendering visually different documents). Field layout matches the
 * paper form the user provided verbatim.
 *
 * Three signature slots — employee, manager, hr_staff — all already allowed
 * by hr_signable_documents.recipient_slot's existing check constraint (see
 * migration 0050), so this document type needed zero schema change.
 */

export type ExceptionVisitSignatureSlot = "employee" | "manager" | "hr_staff";

export type ExceptionType = "missed_workday" | "late_early" | "missed_visit" | "other";

export const EXCEPTION_TYPE_LABELS: Record<ExceptionType, string> = {
  missed_workday: "Missed Workday / Absence",
  late_early: "Late Arrival / Early Departure",
  missed_visit: "Missed Customer Appointment / Home Visit",
  other: "Other Operational Exception",
};

export interface ExceptionVisitFormData {
  /** The employee's actual profile id — this form never writes back to the profile (document-only, no auto profile update), kept for consistency with every other signable form's shape. */
  employeeId: string;
  employeeName: string;
  /** Auto-fetched from profiles.technician_id when on file; typed in manually otherwise — see ExceptionVisitReportsTab's own submission form. */
  technicianId: string;
  jobTitle: string;
  department: string;
  directManagerName: string;
  dateOfIncident: string;
  exceptionType: ExceptionType;
  otherDescription: string;
  detailedReason: string;
  /** Filled in by the manager alongside their own signature. */
  managerComments: string;
  /** Filled in by HR alongside their own signature. */
  hrReceivedDate: string;
  hrReviewerName: string;
  hrActionStatus: "approved" | "additional_review_required" | "";
}

export interface ExceptionVisitSignatureEntry {
  name: string;
  url: string;
  signedAt: string;
}

export type ExceptionVisitSignatures = Partial<Record<ExceptionVisitSignatureSlot, ExceptionVisitSignatureEntry>>;

const escapeHtml = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const blank = (v: string) => (v && v.trim() ? escapeHtml(v) : "&nbsp;");

const checkbox = (checked: boolean) => (checked ? "☑" : "☐");

const fmtDate = (iso: string) => {
  if (!iso) return "";
  // A date-only string parses as UTC midnight; formatting it back out in a
  // US (UTC-behind) browser rolls it back a day. Parse the y/m/d parts
  // directly into a local Date instead — same fix applied across every form
  // template this session (see promotionFormTemplate.ts's own fmtDate).
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString();
  }
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString();
};

export const exceptionVisitReportStyles = `
  .evr-container * { margin: 0; padding: 0; box-sizing: border-box; }
  .evr-container { width: 816px; min-height: 1056px; background: #fff; padding: 72px; position: relative; font-family: Arial, Helvetica, sans-serif; color: #111827; font-size: 12.5px; line-height: 1.5; }
  .evr-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 4px; }
  .evr-header h1 { font-size: 16px; letter-spacing: 0.2px; }
  .evr-header img { width: 84px; height: 84px; object-fit: contain; }
  .evr-subtitle { font-size: 12px; font-weight: 700; letter-spacing: 0.2px; margin-bottom: 14px; }
  .evr-section { margin-top: 16px; border-top: 1px solid #9ca3af; padding-top: 10px; }
  .evr-section-title { font-weight: 700; font-size: 12.5px; margin-bottom: 6px; }
  .evr-field { padding: 3px 0; }
  .evr-label { color: #374151; }
  .evr-checks { display: flex; flex-direction: column; gap: 4px; padding: 4px 0; }
  .evr-other-row { padding-top: 2px; }
  .evr-reason { padding: 6px 0; white-space: pre-wrap; }
  .evr-ack { padding: 4px 0; font-style: italic; }
  .evr-sign-row { display: flex; gap: 24px; align-items: flex-end; border-bottom: 1px solid #9ca3af; padding: 10px 2px; margin-top: 6px; }
  .evr-sign-name { flex: 2; }
  .evr-sign-sig { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; overflow: hidden; }
  .evr-sign-date { flex: 1; }
  .evr-sig-img { max-height: 44px; max-width: 100%; object-fit: contain; object-position: left; }
  .evr-approver-block { margin-top: 14px; }
  .evr-approver-title { font-weight: 700; font-size: 12px; margin-bottom: 4px; }
`;

function signRow(label: string, name: string, entry: ExceptionVisitSignatureEntry | undefined) {
  return `
    <div class="evr-sign-row">
      <div class="evr-sign-name">${escapeHtml(label)}: <strong>${blank(name)}</strong></div>
      <div class="evr-sign-sig">Signature: ${entry ? `<img class="evr-sig-img" src="${entry.url}" alt="Signature" />` : ""}</div>
      <div class="evr-sign-date">Date: ${entry ? escapeHtml(fmtDate(entry.signedAt)) : ""}</div>
    </div>
  `;
}

/**
 * The Manager/SBM row's printed name uses signatures.manager?.name (whoever
 * ACTUALLY signed) rather than data.directManagerName (the employee's
 * resolved manager, captured at submission) — the hierarchy fallback in
 * canReviewCorrectionStage lets the direct manager's own manager sign
 * instead when the direct manager isn't available, and the printed name
 * must match the signature image, not the person who was merely on file.
 * Falls back to directManagerName only while nobody's signed yet, so the
 * line isn't blank before that happens.
 */
export function buildExceptionVisitReportBodyMarkup(
  data: ExceptionVisitFormData,
  logoDataUrl: string,
  signatures: ExceptionVisitSignatures
): string {
  return `
    <div class="evr-container">
      <div class="evr-header">
        <h1>US IN HOME SERVICES</h1>
        ${logoDataUrl ? `<img src="${logoDataUrl}" alt="US In Home Services" />` : ""}
      </div>
      <div class="evr-subtitle">EMPLOYEE ATTENDANCE &amp; VISIT EXCEPTION REPORT</div>

      <div class="evr-section">
        <div class="evr-section-title">1. Employee Information</div>
        <div class="evr-field"><span class="evr-label">Employee Name:</span> <strong>${blank(data.employeeName)}</strong></div>
        <div class="evr-field"><span class="evr-label">Employee ID:</span> <strong>${blank(data.technicianId)}</strong></div>
        <div class="evr-field"><span class="evr-label">Job Title / Role:</span> <strong>${blank(data.jobTitle)}</strong></div>
        <div class="evr-field"><span class="evr-label">Department / Branch:</span> <strong>${blank(data.department)}</strong></div>
        <div class="evr-field"><span class="evr-label">Direct Manager / SBM:</span> <strong>${blank(data.directManagerName)}</strong></div>
        <div class="evr-field"><span class="evr-label">Date of Incident:</span> <strong>${blank(fmtDate(data.dateOfIncident))}</strong></div>
      </div>

      <div class="evr-section">
        <div class="evr-section-title">2. Exception Type</div>
        <div class="evr-checks">
          <span>${checkbox(data.exceptionType === "missed_workday")} Missed Workday / Absence</span>
          <span>${checkbox(data.exceptionType === "late_early")} Late Arrival / Early Departure</span>
          <span>${checkbox(data.exceptionType === "missed_visit")} Missed Customer Appointment / Home Visit</span>
          <span class="evr-other-row">${checkbox(data.exceptionType === "other")} Other Operational Exception: ${escapeHtml(data.otherDescription)}</span>
        </div>
      </div>

      <div class="evr-section">
        <div class="evr-section-title">3. Reason for Exception &amp; Details</div>
        <div class="evr-field evr-reason">${blank(data.detailedReason)}</div>
      </div>

      <div class="evr-section">
        <div class="evr-section-title">4. Employee Acknowledgment &amp; Sign-Off</div>
        <div class="evr-ack">I confirm that the information provided above is accurate and truthful.</div>
        ${signRow("Employee Signature", data.employeeName, signatures.employee)}
      </div>

      <div class="evr-section">
        <div class="evr-section-title">5. Manager / SBM Review &amp; Approval</div>
        <div class="evr-ack">I have reviewed and verified the reason for this exception.</div>
        <div class="evr-field"><span class="evr-label">Manager Comments:</span> ${blank(data.managerComments)}</div>
        ${signRow("Manager / SBM Signature", signatures.manager?.name || data.directManagerName, signatures.manager)}
      </div>

      <div class="evr-section">
        <div class="evr-section-title">6. HR Department Use Only</div>
        <div class="evr-field"><span class="evr-label">Received Date:</span> <strong>${blank(fmtDate(data.hrReceivedDate))}</strong></div>
        <div class="evr-field"><span class="evr-label">HR Reviewer:</span> <strong>${blank(data.hrReviewerName)}</strong></div>
        <div class="evr-checks">
          <span>${checkbox(data.hrActionStatus === "approved")} Approved</span>
          <span>${checkbox(data.hrActionStatus === "additional_review_required")} Additional Review Required</span>
        </div>
        ${signRow("HR Signature", data.hrReviewerName, signatures.hr_staff)}
      </div>
    </div>
  `;
}
