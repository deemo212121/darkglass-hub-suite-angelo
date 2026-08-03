/**
 * Shared "PAYSLIP" HTML template — originally built inline in
 * EmployeeSelfServicePage.tsx (My Payroll tab's payslip viewer/download),
 * extracted here so AccountingDashboard.tsx's "Send Payslip" email can
 * render the exact same document to a real PDF (via pdfCapture.ts's
 * captureHtmlToPdfBlob) instead of duplicating ~300 lines of markup/CSS.
 *
 * Split into body markup + styles (rather than one full HTML document)
 * because captureHtmlToPdfBlob takes them separately — it builds its own
 * isolated iframe document around them (see that file's header comment on
 * why: html2canvas can't parse this app's oklch() colors, so the capture
 * document must never inherit the host page's stylesheet).
 */

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
`;

/** The <body> markup only — see this file's header comment for why it's split from PAYSLIP_STYLES. */
export function renderPayslipBodyHtml(employee: EmployeePayslipData): string {
  const currentDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const deductions = employee.grossPay - employee.netPay;

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
      </div>
      <div>
        <div class="info-section">
          <label>Payslip Date</label>
          <span>${employee.generatedDate || currentDate}</span>
        </div>
        <div class="info-section" style="margin-top: 15px;">
          <label>Period</label>
          <span>${employee.period}</span>
        </div>
      </div>
    </div>

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
            <td colspan="7">Total</td>
            <td class="amount">$${employee.grossPay.toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>

      <div class="summary-row gross" style="border: none; grid-template-columns: 2fr 1fr;">
        <div>Gross Pay</div>
        <div class="amount">$${employee.grossPay.toFixed(2)}</div>
      </div>

      ${deductions > 0 ? `
      <table class="table" style="margin-top: 15px;">
        <tbody>
          <tr>
            <td>Deductions</td>
            <td class="amount">-$${deductions.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
      ` : ''}

      <div class="summary-row total" style="border: none; grid-template-columns: 2fr 1fr;">
        <div>NET PAY</div>
        <div class="amount">$${employee.netPay.toFixed(2)}</div>
      </div>
    </div>

    <div class="footer">
      <p style="margin: 0; margin-bottom: 10px;">This is an electronically generated payslip. No signature is required.</p>
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
