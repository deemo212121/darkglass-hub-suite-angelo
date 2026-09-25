/**
 * Employee Attendance & Visit Exception Report — Ticket Dispute variant.
 * Same shape/sections as exceptionVisitReportTemplate.ts (which Time
 * Correction Request uses), with one addition the user's paper form calls
 * for on this variant only: a "Customer / Job Details (If applicable)"
 * block inside Section 3, since a ticket dispute is specifically about a
 * missed/failed on-site visit. Kept as its own file rather than bolting an
 * optional block onto the Time Correction template — the two documents are
 * genuinely different, and Time Correction should never render a blank
 * "Customer / Job Details" section it has no data for.
 */

export type TicketDisputeExceptionType = "missed_workday" | "late_early" | "missed_visit" | "other";

export const TICKET_DISPUTE_EXCEPTION_TYPE_LABELS: Record<TicketDisputeExceptionType, string> = {
  missed_workday: "Missed Workday / Absence",
  late_early: "Late Arrival / Early Departure",
  missed_visit: "Missed Customer Appointment / Home Visit",
  other: "Other Operational Exception",
};

export interface TicketDisputeReportFormData {
  employeeName: string;
  technicianId: string;
  jobTitle: string;
  department: string;
  directManagerName: string;
  dateOfIncident: string;
  exceptionType: TicketDisputeExceptionType;
  otherDescription: string;
  detailedReason: string;
  ticketNo: string;
  customerName: string;
  scheduledTime: string;
  actionTaken: string;
  managerComments: string;
  hrReceivedDate: string;
  hrReviewerName: string;
  hrActionStatus: "approved" | "additional_review_required" | "";
}

export interface TicketDisputeSignatureEntry {
  name: string;
  url: string;
  signedAt: string;
}

export type TicketDisputeSignatureSlot = "employee" | "manager" | "hr_staff";
export type TicketDisputeSignatures = Partial<Record<TicketDisputeSignatureSlot, TicketDisputeSignatureEntry>>;

const escapeHtml = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const blank = (v: string) => (v && v.trim() ? escapeHtml(v) : "&nbsp;");

const checkbox = (checked: boolean) => (checked ? "☑" : "☐");

const fmtDate = (iso: string) => {
  if (!iso) return "";
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString();
  }
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString();
};

export const ticketDisputeReportStyles = `
  .tdr-container * { margin: 0; padding: 0; box-sizing: border-box; }
  .tdr-container { width: 816px; min-height: 1056px; background: #fff; padding: 72px; position: relative; font-family: Arial, Helvetica, sans-serif; color: #111827; font-size: 12.5px; line-height: 1.5; }
  .tdr-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 4px; }
  .tdr-header h1 { font-size: 16px; letter-spacing: 0.2px; }
  .tdr-header img { width: 84px; height: 84px; object-fit: contain; }
  .tdr-subtitle { font-size: 12px; font-weight: 700; letter-spacing: 0.2px; margin-bottom: 14px; }
  .tdr-section { margin-top: 16px; border-top: 1px solid #9ca3af; padding-top: 10px; }
  .tdr-section-title { font-weight: 700; font-size: 12.5px; margin-bottom: 6px; }
  .tdr-field { padding: 3px 0; }
  .tdr-label { color: #374151; }
  .tdr-checks { display: flex; flex-direction: column; gap: 4px; padding: 4px 0; }
  .tdr-other-row { padding-top: 2px; }
  .tdr-reason { padding: 6px 0; white-space: pre-wrap; }
  .tdr-subblock { margin-top: 10px; }
  .tdr-subblock-title { font-weight: 700; font-size: 11.5px; margin-bottom: 4px; }
  .tdr-bullet { padding: 2px 0 2px 14px; }
  .tdr-ack { padding: 4px 0; font-style: italic; }
  .tdr-sign-row { display: flex; gap: 24px; align-items: flex-end; border-bottom: 1px solid #9ca3af; padding: 10px 2px; margin-top: 6px; }
  .tdr-sign-name { flex: 2; }
  .tdr-sign-sig { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; overflow: hidden; }
  .tdr-sign-date { flex: 1; }
  .tdr-sig-img { max-height: 44px; max-width: 100%; object-fit: contain; object-position: left; }
`;

function signRow(label: string, name: string, entry: TicketDisputeSignatureEntry | undefined) {
  return `
    <div class="tdr-sign-row">
      <div class="tdr-sign-name">${escapeHtml(label)}: <strong>${blank(name)}</strong></div>
      <div class="tdr-sign-sig">Signature: ${entry ? `<img class="tdr-sig-img" src="${entry.url}" alt="Signature" />` : ""}</div>
      <div class="tdr-sign-date">Date: ${entry ? escapeHtml(fmtDate(entry.signedAt)) : ""}</div>
    </div>
  `;
}

/**
 * Manager/SBM row prints whoever actually signed (signatures.manager?.name)
 * rather than the employee's resolved manager on file — see
 * exceptionVisitReportTemplate.ts's identical fix for why (a senior manager
 * can stand in when the direct manager isn't available).
 */
export function buildTicketDisputeReportBodyMarkup(
  data: TicketDisputeReportFormData,
  logoDataUrl: string,
  signatures: TicketDisputeSignatures
): string {
  return `
    <div class="tdr-container">
      <div class="tdr-header">
        <h1>US IN HOME SERVICES</h1>
        ${logoDataUrl ? `<img src="${logoDataUrl}" alt="US In Home Services" />` : ""}
      </div>
      <div class="tdr-subtitle">EMPLOYEE ATTENDANCE &amp; VISIT EXCEPTION REPORT</div>

      <div class="tdr-section">
        <div class="tdr-section-title">1. Employee Information</div>
        <div class="tdr-field"><span class="tdr-label">Employee Name:</span> <strong>${blank(data.employeeName)}</strong></div>
        <div class="tdr-field"><span class="tdr-label">Employee ID:</span> <strong>${blank(data.technicianId)}</strong></div>
        <div class="tdr-field"><span class="tdr-label">Job Title / Role:</span> <strong>${blank(data.jobTitle)}</strong></div>
        <div class="tdr-field"><span class="tdr-label">Department / Branch:</span> <strong>${blank(data.department)}</strong></div>
        <div class="tdr-field"><span class="tdr-label">Direct Manager / SBM:</span> <strong>${blank(data.directManagerName)}</strong></div>
        <div class="tdr-field"><span class="tdr-label">Date of Incident:</span> <strong>${blank(fmtDate(data.dateOfIncident))}</strong></div>
      </div>

      <div class="tdr-section">
        <div class="tdr-section-title">2. Exception Type</div>
        <div class="tdr-checks">
          <span>${checkbox(data.exceptionType === "missed_workday")} Missed Workday / Absence</span>
          <span>${checkbox(data.exceptionType === "late_early")} Late Arrival / Early Departure</span>
          <span>${checkbox(data.exceptionType === "missed_visit")} Missed Customer Appointment / Home Visit</span>
          <span class="tdr-other-row">${checkbox(data.exceptionType === "other")} Other Operational Exception: ${escapeHtml(data.otherDescription)}</span>
        </div>
      </div>

      <div class="tdr-section">
        <div class="tdr-section-title">3. Reason for Exception &amp; Details</div>
        <div class="tdr-field tdr-reason">${blank(data.detailedReason)}</div>
        <div class="tdr-subblock">
          <div class="tdr-subblock-title">Customer / Job Details (If applicable):</div>
          <div class="tdr-bullet">• Ticket #: ${blank(data.ticketNo)}</div>
          <div class="tdr-bullet">• Customer Name: ${blank(data.customerName)}</div>
          <div class="tdr-bullet">• Scheduled Time: ${blank(data.scheduledTime)}</div>
          <div class="tdr-bullet">• Action Taken / Rescheduled Status: ${blank(data.actionTaken)}</div>
        </div>
      </div>

      <div class="tdr-section">
        <div class="tdr-section-title">4. Acknowledgment &amp; Sign-Off</div>
        <div class="tdr-ack">Employee Acknowledgment: I confirm that the information provided above is accurate and truthful.</div>
        ${signRow("Employee Signature", data.employeeName, signatures.employee)}
      </div>

      <div class="tdr-section">
        <div class="tdr-ack">Manager / SBM Review &amp; Approval: I have reviewed and verified the reason for this exception.</div>
        <div class="tdr-field"><span class="tdr-label">Manager Comments:</span> ${blank(data.managerComments)}</div>
        ${signRow("Manager / SBM Signature", signatures.manager?.name || data.directManagerName, signatures.manager)}
      </div>

      <div class="tdr-section">
        <div class="tdr-section-title">5. HR Department Use Only</div>
        <div class="tdr-field"><span class="tdr-label">Received Date:</span> <strong>${blank(fmtDate(data.hrReceivedDate))}</strong></div>
        <div class="tdr-field"><span class="tdr-label">HR Reviewer:</span> <strong>${blank(data.hrReviewerName)}</strong></div>
        <div class="tdr-checks">
          <span>${checkbox(data.hrActionStatus === "approved")} Approved</span>
          <span>${checkbox(data.hrActionStatus === "additional_review_required")} Additional Review Required</span>
        </div>
        ${signRow("HR Signature", data.hrReviewerName, signatures.hr_staff)}
      </div>
    </div>
  `;
}
