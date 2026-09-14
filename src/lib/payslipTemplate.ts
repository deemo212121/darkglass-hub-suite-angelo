/**
 * Shared "PAYSLIP" HTML template — originally built inline in
 * EmployeeSelfServicePage.tsx (My Payroll tab's payslip viewer/download),
 * extracted here so AccountingDashboard.tsx's "Send Payslip" email renders
 * the exact same document (via pdfCapture.ts's captureHtmlToPdfBlob)
 * instead of a second, drifted copy of ~350 lines of markup/CSS. Both call
 * sites must go through renderPayslipBodyHtml/renderPayslipFullHtml —
 * never re-implement the markup locally, or the two will silently diverge
 * again (as they previously did).
 *
 * Split into body markup + styles (rather than one full HTML document)
 * because captureHtmlToPdfBlob takes them separately — it builds its own
 * isolated iframe document around them (see that file's header comment on
 * why: html2canvas can't parse this app's oklch() colors, so the capture
 * document must never inherit the host page's stylesheet).
 */

import { perCutoffSalary } from "./supabase/salary";
import type { TechActivityBreakdown } from "./supabase/techPayroll";

export interface PayslipDailyRow {
  date: string;
  clockIn: string;
  clockOut: string;
  mealStart: string;
  mealEnd: string;
  hours: number;
  rate: number;
  amount: number;
}

export interface EmployeePayslipData {
  name: string;
  department: string;
  period: string;
  generatedDate: string;
  dailyRows: PayslipDailyRow[];
  grossPay: number;
  netPay: number;
  email: string;
  hireDate: string;
  workingHoursLabel: string;
  breakLabel: string;
  hourlyRate: number;
  /** "fixed" means this payslip was a flat per-cutoff salary payout, not hours × hourlyRate — see migration 0119. */
  compensationType: "hourly" | "fixed";
  /** Only set when compensationType is "fixed". */
  annualSalary: number | null;
  /** Total duty days — days actually worked in this period. */
  counts: number;
  /** Total hours worked in this period. */
  totalHours: number;
  /** Average hours worked per duty day. */
  average: number;
  offDays: number;
  ptoUsed: number;
  sickLeave: number;
  /** offDays + ptoUsed only. */
  totalDays: number;
  /** Finance-entered bonus/add-on — see migration 0111. */
  extraPay: number;
  /** Finance-entered note for this specific payslip — see migration 0111. */
  notes: string;
  /**
   * True when a technician's Tech Activity Report breakdown is being
   * rendered as a second PDF page (see renderTechActivitySummaryPageHtml
   * and captureHtmlPagesToPdfBlob) — changes the daily table's footer label
   * from "Total" to "Hourly Pay Total" so it doesn't read as if the daily
   * rows alone summed to the full grossPay below (they don't; the
   * piece-rate/bonus difference is broken out on page 2).
   */
  hasTechActivityPage?: boolean;
  /** true when assigned_branch !== "Philippines". No longer drives a tax withholding line (removed) — kept for any future US/PH-specific formatting. */
  isUS: boolean;
}

/** Renders a raw "HH:MM" or "HH:MM:SS" capture time as "h:mm AM/PM" for the payslip. */
export function formatClockTime(t: string): string {
  if (!t) return "—";
  const [h, m, s = 0] = t.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return "—";
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")} ${period}`;
}

/** Calendar days within [start, end] whose day-of-week is one of the employee's scheduled off days — the payslip's "Off Days" count. */
export function offDaysInRange(offDays: number[], start: string, end: string): number {
  const offSet = new Set(offDays);
  let count = 0;
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    if (offSet.has(d.getDay())) count++;
  }
  return count;
}

/**
 * Calendar days of approved PTO (clipped to [start, end]) of a given leave
 * type, for one employee's own requests — splits the payslip's "PTO Leave
 * Used" (isSick=false) from "Sick Leave" (isSick=true). Distinct from
 * pto.ts's ptoDaysUsed/ptoRequestsInYear, which track the annual accrual
 * window and don't split sick leave out from the rest. Callers must
 * pre-filter `requests` down to the one employee — this sums whatever it's
 * given.
 */
export function ptoDaysInRange(
  requests: { profileId: string; status: string; ptoType: string; startDate: string; endDate: string }[],
  start: string,
  end: string,
  isSick: boolean
): number {
  let days = 0;
  for (const r of requests) {
    if (r.status !== "approved") continue;
    if ((r.ptoType === "sick") !== isSick) continue;
    const overlapStart = r.startDate > start ? r.startDate : start;
    const overlapEnd = r.endDate < end ? r.endDate : end;
    if (overlapStart > overlapEnd) continue;
    const d1 = new Date(overlapStart + "T00:00:00");
    const d2 = new Date(overlapEnd + "T00:00:00");
    days += Math.round((d2.getTime() - d1.getTime()) / 86_400_000) + 1;
  }
  return days;
}

export const PAYSLIP_STYLES = `
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
  body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    background: white;
    padding: 10px;
  }
  .container {
    max-width: 900px;
    margin: 0 auto;
    background: white;
    border: 1px solid #e5e7eb;
    padding: 20px;
  }
  .header {
    display: flex;
    flex-direction: row;
    gap: 15px;
    align-items: center;
    justify-content: center;
    margin-bottom: 20px;
    padding: 15px;
    border-bottom: 2px solid #1e40af;
    background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%);
    border-radius: 8px;
    position: relative;
  }
  .header h1 {
    color: white;
    font-size: 28px;
    margin-bottom: 0;
    letter-spacing: 1px;
  }
  .payslip-info {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 15px;
    margin-bottom: 15px;
  }
  .info-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .info-section label {
    font-size: 11px;
    color: #6b7280;
    text-transform: uppercase;
    font-weight: 600;
  }
  .info-section span {
    font-size: 13px;
    color: #1f2937;
    font-weight: 500;
  }
  .employee-highlight {
    background: #eff6ff;
    border-left: 4px solid #1e40af;
    padding: 10px;
    border-radius: 4px;
  }
  .employee-highlight .info-section label {
    color: #1e40af;
    font-weight: 700;
  }
  .employee-highlight .info-section span {
    font-size: 16px;
    font-weight: 700;
    color: #1e40af;
  }
  .table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 20px;
  }
  .table th {
    background: #f3f4f6;
    color: #1f2937;
    padding: 8px;
    text-align: left;
    font-weight: 600;
    font-size: 12px;
    border: 1px solid #e5e7eb;
  }
  .table td {
    padding: 8px;
    border: 1px solid #e5e7eb;
    font-size: 12px;
    color: #374151;
  }
  .table tr:nth-child(even) {
    background: #fafafa;
  }
  .summary-section {
    margin-top: 15px;
    border-top: 2px solid #e5e7eb;
    padding-top: 10px;
  }
  .summary-row {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 10px;
    align-items: center;
    padding: 6px 0;
    border-bottom: 1px solid #e5e7eb;
  }
  .summary-row.gross {
    background: #f0f9ff;
    border: 1px solid #bfdbfe;
    border-radius: 4px;
    padding: 10px;
    margin: 8px 0;
    font-weight: 600;
    font-size: 14px;
    color: #1e40af;
  }
  .summary-row.total {
    background: #1e40af;
    color: white;
    border-radius: 4px;
    padding: 12px;
    margin: 8px 0;
    font-weight: 700;
    font-size: 16px;
  }
  .summary-row.total .amount {
    text-align: right;
    font-size: 18px;
  }
  .amount {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .footer {
    text-align: center;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid #e5e7eb;
    color: #6b7280;
    font-size: 11px;
  }
  @media print {
    body {
      background: white;
      padding: 0;
    }
    .container {
      border: none;
      padding: 20px;
    }
    .header {
      background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%) !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }
    table {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }
    .summary-row.gross {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }
    .summary-row.total {
      background: #1e40af !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }
  }
`;

/** The <body> markup only — see this file's header comment for why it's split from PAYSLIP_STYLES. */
export function renderPayslipBodyHtml(employee: EmployeePayslipData): string {
  const currentDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const grandTotal = employee.grossPay + employee.extraPay;

  return `
  <div class="container">
    <div class="header">
      <div style="text-align: center; width: 100%;">
        <h1>PAYSLIP</h1>
      </div>
    </div>

    <div class="payslip-info">
      <div class="employee-highlight">
        <div class="info-section">
          <label>Employee Name</label>
          <span>${employee.name}</span>
        </div>
        <div class="info-section" style="margin-top: 15px;">
          <label>Department</label>
          <span>${employee.department || "—"}</span>
        </div>
        <div class="info-section" style="margin-top: 15px;">
          <label>Email</label>
          <span>${employee.email}</span>
        </div>
      </div>
      <div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
          <div class="info-section">
            <label>Payslip Date</label>
            <span>${employee.generatedDate || currentDate}</span>
          </div>
          <div class="info-section">
            <label>Start Date</label>
            <span>${employee.hireDate}</span>
          </div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 15px;">
          <div class="info-section">
            <label>Period</label>
            <span>${employee.period}</span>
          </div>
          <div class="info-section">
            <label>Working Hours</label>
            <span>${employee.workingHoursLabel}</span>
          </div>
        </div>
        <div class="info-section" style="margin-top: 15px;">
          <label>Break Time</label>
          <span>${employee.breakLabel}</span>
        </div>
      </div>
    </div>

    <table class="table" style="margin-bottom: 20px;">
      <thead>
        <tr>
          <th style="text-align: right;">Rate</th>
          <th style="text-align: right;">Counts (Duty Days)</th>
          <th style="text-align: right;">Hours</th>
          <th style="text-align: right;">Average</th>
          <th style="text-align: right;">Off Days</th>
          <th style="text-align: right;">PTO Leave Used</th>
          <th style="text-align: right;">Sick Leave</th>
          <th style="text-align: right;">Total Days</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="amount">${employee.compensationType === "fixed" && employee.annualSalary ? `$${employee.annualSalary.toLocaleString()}/yr ($${perCutoffSalary(employee.annualSalary).toFixed(2)}/cutoff)` : `$${employee.hourlyRate.toFixed(2)}`}</td>
          <td class="amount">${employee.counts}</td>
          <td class="amount">${employee.totalHours.toFixed(2)}</td>
          <td class="amount">${employee.average.toFixed(2)}</td>
          <td class="amount">${employee.offDays}</td>
          <td class="amount">${employee.ptoUsed}</td>
          <td class="amount">${employee.sickLeave}</td>
          <td class="amount">${employee.totalDays}</td>
        </tr>
      </tbody>
    </table>

    <div class="summary-section">
      <table class="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Time In</th>
            <th>Meal In</th>
            <th>Meal Out</th>
            <th>Time Out</th>
            <th style="text-align: right;">Working Hours</th>
            <th style="text-align: right;">Rate</th>
            <th style="text-align: right;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${employee.dailyRows.length > 0 ? employee.dailyRows.map((r) => `
          <tr>
            <td>${r.date}</td>
            <td>${formatClockTime(r.clockIn)}</td>
            <td>${formatClockTime(r.mealStart)}</td>
            <td>${formatClockTime(r.mealEnd)}</td>
            <td>${formatClockTime(r.clockOut)}</td>
            <td class="amount">${r.hours.toFixed(2)}</td>
            <td class="amount">$${r.rate.toFixed(2)}</td>
            <td class="amount">$${r.amount.toFixed(2)}</td>
          </tr>
          `).join('') : `
          <tr>
            <td colspan="8" style="text-align: center; color: #9ca3af;">No daily attendance recorded for this period.</td>
          </tr>
          `}
        </tbody>
        <tfoot>
          <tr style="font-weight: 700; background: #f3f4f6;">
            <td colspan="7">${employee.hasTechActivityPage ? "Hourly Pay Total" : "Total"}</td>
            <td class="amount">$${(employee.hasTechActivityPage ? employee.dailyRows.reduce((s, r) => s + r.amount, 0) : employee.grossPay).toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>

      ${employee.hasTechActivityPage ? `
      <div style="margin: 8px 0; padding: 8px 10px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 4px; font-size: 12px; color: #92400e;">
        This page covers hourly time tracking only. See the Tech Activity Report on the next page for the full pay breakdown and grand total.
      </div>
      ` : `
      <div class="summary-row gross" style="border: none; grid-template-columns: 2fr 1fr;">
        <div>Total</div>
        <div class="amount">$${employee.grossPay.toFixed(2)}</div>
      </div>

      <div class="summary-row" style="border: none; grid-template-columns: 2fr 1fr;">
        <div>Extra</div>
        <div class="amount">$${employee.extraPay.toFixed(2)}</div>
      </div>

      <div class="summary-row total" style="border: none; grid-template-columns: 2fr 1fr;">
        <div>GRAND TOTAL</div>
        <div class="amount">$${grandTotal.toFixed(2)}</div>
      </div>
      `}
    </div>

    ${employee.notes ? `
    <div style="margin-top: 15px; padding: 10px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 4px;">
      <div style="font-size: 11px; font-weight: 700; color: #92400e; text-transform: uppercase; margin-bottom: 4px;">Notes</div>
      <div style="font-size: 12px; color: #78350f; white-space: pre-wrap;">${employee.notes}</div>
    </div>
    ` : ''}

    <div class="footer">
      <p style="margin: 0; margin-bottom: 10px;">This is an electronically generated payslip. No signature is required.</p>
      <p style="margin: 0;">© ${new Date().getFullYear()} Admin Hub Solutions. All rights reserved.</p>
    </div>
  </div>
  `;
}

/**
 * A technician's Tech Activity Report as its own PDF page — the same
 * Payment Item / Value / Pay Rate / Payment breakdown Finance sees on the
 * modal before hitting Send, rendered read-only for the emailed payslip.
 * Pass this as the second entry to captureHtmlPagesToPdfBlob (see
 * AccountingDashboard.tsx's buildPayslipPdfBase64) — page 1 stays the
 * ordinary payslipTemplate body, this becomes a real second PDF page rather
 * than a same-page section, since a piece-rate breakdown can run long
 * enough (every repair category, every custom line) to not fit under an
 * already-full attendance table.
 */
export function renderTechActivitySummaryPageHtml(
  employeeName: string,
  period: string,
  branch: string,
  breakdown: TechActivityBreakdown,
  isUS: boolean,
  extraPay: number
): string {
  const grandTotal = breakdown.totalPayment + extraPay;
  return `
  <div class="container">
    <div class="header">
      <div style="text-align: center; width: 100%;">
        <h1>TECH ACTIVITY REPORT</h1>
      </div>
    </div>
    <div class="payslip-info" style="margin-bottom: 10px;">
      <div class="info-section">
        <label>Employee Name</label>
        <span>${employeeName}</span>
      </div>
      <div class="info-section">
        <label>Period</label>
        <span>${period}${branch ? ` · ${branch}` : ""}</span>
      </div>
    </div>
    <table class="table">
      <thead>
        <tr>
          <th>Payment Item</th>
          <th style="text-align: right;">Value</th>
          <th style="text-align: right;">Pay Rate</th>
          <th style="text-align: right;">Payment</th>
        </tr>
      </thead>
      <tbody>
        ${breakdown.lineItems.map((item) => `
        <tr>
          <td>${item.label}</td>
          <td class="amount">${item.value}</td>
          <td class="amount">${item.rate == null ? "—" : `$${item.rate.toFixed(2)}`}</td>
          <td class="amount">${item.paymentDisplay ?? `$${item.payment.toFixed(2)}`}</td>
        </tr>
        `).join('')}
      </tbody>
      <tfoot>
        <tr style="font-weight: 700; background: #f3f4f6;">
          <td colspan="3">Total Payment</td>
          <td class="amount">$${breakdown.totalPayment.toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>

    <div class="summary-section" style="margin-top: 0;">
      <div class="summary-row" style="border: none; grid-template-columns: 2fr 1fr;">
        <div>Extra</div>
        <div class="amount">$${extraPay.toFixed(2)}</div>
      </div>

      <div class="summary-row total" style="border: none; grid-template-columns: 2fr 1fr;">
        <div>GRAND TOTAL</div>
        <div class="amount">$${grandTotal.toFixed(2)}</div>
      </div>
    </div>

    <div class="footer">
      <p style="margin: 0;">© ${new Date().getFullYear()} Admin Hub Solutions. All rights reserved.</p>
    </div>
  </div>
  `;
}

/** Full standalone HTML document (body + styles combined) — for the in-app iframe viewer and the "download as .html" button, which both need one complete document rather than the split form captureHtmlToPdfBlob wants. */
export function renderPayslipFullHtml(employee: EmployeePayslipData): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payslip - ${employee.name}</title>
  <style>${PAYSLIP_STYLES}</style>
</head>
<body>
${renderPayslipBodyHtml(employee)}
</body>
</html>
  `;
}
