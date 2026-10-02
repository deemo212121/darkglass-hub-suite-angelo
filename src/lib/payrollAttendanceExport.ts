import type { Worksheet } from "exceljs";
import type { SupabaseEmployee } from "@/components/AccountingDashboard";
import { getAttendanceForRange, computeScheduledDutyHours, computeMealTimeCredit, startOfWeekSunday, splitRegularOvertimeWeekly, hoursDiff, type AttendanceRow } from "./supabase/timecards";
import { getSalaryHistory, rateEffectiveOn } from "./supabase/salary";
import { getTicketAttendanceForTechnician } from "./supabase/technicianWhereabouts";
import { getCompanyPtoRequests, isPaidPtoType, HR_STATUS_TO_PTO_TYPE, type PtoType } from "./supabase/pto";
import { getAttendanceNotes } from "./supabase/attendanceNotes";
import { getCompanyHolidaysInRange } from "./supabase/companyHolidays";
import { getPendingCorrectionsInRange } from "./supabase/timecardCorrections";
import { isMealAlwaysPaidRole, usesFlatWeeklyOvertimeThreshold } from "./roleLabels";
import { payGraceMinutesFor } from "./attendanceGrace";
import { normalizeStateName, highestRateAmong, STATE_MIN_WAGE_2026 } from "./stateMinWage";

export const attendanceExportHeaders = ["Date", "States Worked", "Check In", "Check Out", "Regular Hr", "Meal Time", "Over Time", "Total Hours", "Rate", "State Floor Min", "State OT Floor Min"];

export function attendanceExportRows(
  attendance: AttendanceRow[],
  hours: Map<string, { regular: number; overtime: number }>,
  pay: Map<string, { companyRate: number; effectiveRate: number }>,
  states: Map<string, { states: string[] }>,
  otMultiplier: number,
  employeeName: string,
): (string | number)[][] {
  const totals = Array<number>(7).fill(0);
  const rows = attendance.map((row) => {
    const folded = hours.get(row.date) ?? { regular: 0, overtime: 0 };
    const rates = pay.get(row.date);
    const meal = row.mealStart && row.mealEnd ? Math.max(0, hoursDiff(row.mealStart, row.mealEnd)) : 0;
    const total = folded.regular + folded.overtime;
    const values = [Math.min(row.hoursWorked, folded.regular), meal, folded.overtime, total,
      total * (rates?.companyRate ?? 0), folded.regular * (rates?.effectiveRate ?? 0),
      folded.overtime * (rates?.effectiveRate ?? 0) * otMultiplier];
    values.forEach((value, index) => { totals[index] += value; });
    const worked = states.get(row.date)?.states ?? [];
    const [year, month, day] = row.date.split("-");
    return [`${month}/${day}/${year}`, worked.length ? worked.join(" / ") : row.state ?? "",
      row.clockIn ?? "", row.clockOut ?? "", ...values];
  });
  return [...rows, [], ["Total", "", "", "", ...totals], ["Name", employeeName]];
}

export function uniqueAttendanceSheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[\\/*?:\[\]\x00-\x1f]/g, " ").replace(/^'+|'+$/g, "").trim() || "Employee";
  let candidate = base.slice(0, 31).replace(/'+$/g, "");
  let index = 2;
  while (used.has(candidate.toLowerCase()) || candidate.toLowerCase() === "history") {
    const suffix = ` (${index++})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/** Formulas reference each sheet's editable rate table and exact slash-separated state names. */
export function addAttendanceStateFormulas(
  sheet: Worksheet,
  attendance: AttendanceRow[],
  pay: Map<string, { companyRate: number; effectiveRate: number }>,
  isPh: boolean,
) {
  sheet.getCell("M1").value = "Company Hourly Rate";
  sheet.getCell("N1").value = "Applied Hourly Rate";
  sheet.getCell("O1").value = "State";
  sheet.getCell("P1").value = "State Rate / Hour";
  sheet.getCell("Q1").value = "Rate Notes";
  sheet.getCell("S1").value = "OT Multiplier";
  sheet.getCell("S2").value = isPh ? 1 : 1.5;
  sheet.getCell("S4").value = "Edit States Worked using full names separated by / (e.g. Louisiana / Mississippi).";
  sheet.getCell("S5").value = "Edit state rates in column P. Changes apply to this employee's sheet only.";
  sheet.getCell("S6").value = "Highest listed state rate or company rate applies. Blank/unlisted states use company rate.";
  sheet.getCell("S7").value = "Blank state rates need a local rate entered; until then the company rate is used.";
  sheet.getCell("S8").value = isPh ? "PH payroll uses the company rate and straight-time overtime." : "State rates copied from the app's configured reference table.";
  sheet.getCell("S9").value = "Workbook edits do not update saved payroll data. Fixed-salary days have no hourly pay.";
  for (const [index, state] of STATE_MIN_WAGE_2026.entries()) {
    const row = index + 2;
    sheet.getCell(`O${row}`).value = state.state;
    sheet.getCell(`P${row}`).value = state.rate;
    sheet.getCell(`Q${row}`).value = state.rate == null ? "Enter applicable local rate" : "";
    sheet.getCell(`P${row}`).numFmt = '"$"0.00';
    sheet.getCell(`P${row}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
    sheet.getCell(`P${row}`).dataValidation = { type: "decimal", operator: "greaterThanOrEqual", formulae: [0], allowBlank: true, showErrorMessage: true, error: "Enter a non-negative hourly rate." };
  }
  for (const [index, day] of attendance.entries()) {
    const row = index + 2;
    const companyRate = pay.get(day.date)?.companyRate ?? 0;
    const worked = String(sheet.getCell(`B${row}`).value ?? "").split("/").map(s => s.trim().toLowerCase());
    const floor = Math.max(0, ...STATE_MIN_WAGE_2026.filter(s => worked.includes(s.state.toLowerCase())).map(s => s.rate ?? 0));
    const applied = companyRate > 0 ? (isPh ? companyRate : Math.max(companyRate, floor)) : 0;
    // Individual IF terms avoid dynamic-array functions and support older Excel versions.
    const lookups = STATE_MIN_WAGE_2026.map((_, i) => `IF(ISNUMBER(SEARCH("/"&SUBSTITUTE($O$${i + 2}," ","")&"/","/"&SUBSTITUTE(B${row}," ","")&"/")),N($P$${i + 2}),0)`);
    sheet.getCell(`M${row}`).value = companyRate;
    sheet.getCell(`N${row}`).value = { formula: isPh ? `M${row}` : `IF(M${row}<=0,0,MAX(M${row},${lookups.join(",")}))`, result: applied };
    const total = Number(sheet.getCell(`H${row}`).value ?? 0);
    const overtime = Number(sheet.getCell(`G${row}`).value ?? 0);
    sheet.getCell(`I${row}`).value = { formula: `H${row}*M${row}`, result: total * companyRate };
    // H - G includes any paid meal credit already included in regular pay.
    sheet.getCell(`J${row}`).value = { formula: `(H${row}-G${row})*N${row}`, result: (total - overtime) * applied };
    sheet.getCell(`K${row}`).value = { formula: `G${row}*N${row}*$S$2`, result: overtime * applied * (isPh ? 1 : 1.5) };
    sheet.getCell(`B${row}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
  }
  const totalRow = attendance.length + 3;
  for (const column of ["E", "F", "G", "H", "I", "J", "K"]) {
    let result = 0;
    for (let row = 2; row <= attendance.length + 1; row++) {
      const cell = sheet.getCell(`${column}${row}`);
      result += typeof cell.value === "number" ? cell.value : Number(cell.result ?? 0);
    }
    sheet.getCell(`${column}${totalRow}`).value = { formula: attendance.length ? `SUM(${column}2:${column}${attendance.length + 1})` : "0", result };
  }
  for (const column of ["M", "N", "O", "P", "Q", "S"]) {
    sheet.getColumn(column).width = column === "Q" ? 30 : 24;
    sheet.getCell(`${column}1`).font = { bold: true };
  }
  sheet.getColumn("M").numFmt = '"$"0.00';
  sheet.getColumn("N").numFmt = '"$"0.00';
}
/** Blank, expandable workbook-only adjustments; never prefill or save payroll values. */
export function addAttendanceAdjustmentTemplates(sheet: Worksheet, attendanceCount: number) {
  const titleRow = attendanceCount + 6;
  const headerRow = titleRow + 3;
  const templates = [
    { label: "Includable", first: 1, last: 3, color: "FFFCE4D6", prefix: "Includable" },
    { label: "Reimbursements", first: 5, last: 7, color: "FFE4DFEC", prefix: "Reimbursements" },
  ];
  for (const template of templates) {
    const name = `${template.prefix}_${sheet.id}`;
    sheet.mergeCells(titleRow, template.first, titleRow, template.last);
    const title = sheet.getCell(titleRow, template.first);
    title.value = template.label;
    title.font = { bold: true, color: { argb: "FF222222" } };
    title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: template.color } };
    sheet.getCell(titleRow + 1, template.first).value = "Total (Rate × Quantity)";
    const total = sheet.getCell(titleRow + 1, template.last);
    total.value = { formula: `SUMPRODUCT(${name}[Rate],${name}[Quantity])`, result: 0 };
    total.numFmt = '"$"#,##0.00;[Red]-"$"#,##0.00';
    total.font = { bold: true };
    sheet.addTable({
      name,
      ref: sheet.getCell(headerRow, template.first).address,
      headerRow: true,
      totalsRow: false,
      style: { theme: "TableStyleLight1", showRowStripes: false },
      columns: [{ name: "Type", filterButton: false }, { name: "Rate", filterButton: false }, { name: "Quantity", filterButton: false }],
      rows: Array.from({ length: 6 }, () => [null, null, null]),
    });
    for (let row = headerRow; row <= headerRow + 6; row++) {
      for (let column = template.first; column <= template.last; column++) {
        const cell = sheet.getCell(row, column);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: template.color } };
        cell.font = { color: { argb: "FF222222" }, bold: row === headerRow };
        cell.border = { bottom: { style: "thin", color: { argb: "FFD0D0D0" } } };
        cell.numFmt = row === headerRow || column === template.first ? "@" : column === template.first + 1 ? '"$"#,##0.00;[Red]-"$"#,##0.00' : "0.###";
      }
    }
  }
  sheet.mergeCells(titleRow, 9, titleRow + 4, 11);
  const instructions = sheet.getCell(titleRow, 9);
  instructions.value = "Blank templates: enter the type, rate and quantity (use 1 for a flat amount). To add rows, press Tab in the last table cell or use Insert > Table Rows. Totals expand with each table. Workbook entries only; attendance totals and saved payroll are unchanged.";
  instructions.alignment = { wrapText: true, vertical: "top" };
}
/** Transparent period-based calculation, using the same weighted-rate cascade as the app. */
export function addAttendancePayBreakdown(sheet: Worksheet, attendanceCount: number, isPh: boolean) {
  const end = attendanceCount + 1;
  const total = attendanceCount + 3;
  const amount = (address: string) => {
    const cell = sheet.getCell(address);
    return typeof cell.value === "number" ? cell.value : Number(cell.result ?? 0);
  };
  const sum = (column: string) => attendanceCount ? `SUM(${column}2:${column}${end})` : "0";
  const companyRegularFormula = attendanceCount ? `SUMPRODUCT(H2:H${end}-G2:G${end},M2:M${end})` : "0";
  let companyRegular = 0;
  for (let row = 2; row <= end; row++) companyRegular += (amount(`H${row}`) - amount(`G${row}`)) * amount(`M${row}`);
  const hours = amount(`H${total}`), otHours = amount(`G${total}`);
  const straight = amount(`I${total}`), stateRegular = amount(`J${total}`);
  const premiumFactor = isPh ? 0 : 0.5;
  const weighted = hours > 0 ? straight / hours : 0;
  const premium = otHours * weighted * premiumFactor;
  const minMatch = isPh ? 0 : Math.max(0, stateRegular - companyRegular);
  const afterRate = hours > 0 ? (straight + minMatch) / hours : 0;
  const requiredPremium = otHours * afterRate * premiumFactor;
  const otMatch = Math.max(0, requiredPremium - premium);
  const inputs = [
    ["Pay mode", "State"],
    ["Holiday premium ($)", 0],
    ["Other additions ($)", 0],
    ["Deductions ($)", 0],
    ["OT premium factor", premiumFactor],
  ] as const;
  // Keep the calculation beside the adjustment templates, below their instructions.
  const titleRow = attendanceCount + 12;
  const inputTitleRow = titleRow + 19;
  const relocate = (text: string) => text
    .replace(/AL(\d+)/g, (_, row) => `M${titleRow + Number(row) - 1}`)
    .replace(/\$?AP\$?(\d+)/g, (_, row) => `$M$${inputTitleRow + Number(row) - 1}`);
  sheet.mergeCells(titleRow, 9, titleRow, 13);
  const title = sheet.getCell(titleRow, 9);
  title.value = "15-Step Payroll Calculation";
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  title.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 14 };
  title.alignment = { horizontal: "center" };
  sheet.getRow(titleRow).height = 24;
  sheet.mergeCells(titleRow + 1, 9, titleRow + 1, 10);
  sheet.mergeCells(titleRow + 1, 11, titleRow + 1, 12);
  for (const [column, label] of [[9, "Step / Calculation"], [11, "Equation"], [13, "Result"]] as const) {
    const cell = sheet.getCell(titleRow + 1, column);
    cell.value = label;
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDEBF7" } };
  }
  sheet.mergeCells(inputTitleRow, 9, inputTitleRow, 13);
  sheet.getCell(inputTitleRow, 9).value = "Calculation inputs";
  sheet.getCell(inputTitleRow, 9).font = { bold: true };
  for (const [index, [label, value]] of inputs.entries()) {
    const row = inputTitleRow + index + 1;
    sheet.mergeCells(row, 9, row, 12);
    sheet.getCell(row, 9).value = label;
    const cell = sheet.getCell(row, 13);
    cell.value = value;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
    if (index >= 1 && index <= 3) cell.numFmt = '"$"#,##0.00';
  }
  sheet.getCell(inputTitleRow + 1, 13).dataValidation = { type: "list", allowBlank: false, formulae: ['"Company,State"'] };
  sheet.mergeCells(inputTitleRow + 7, 9, inputTitleRow + 10, 13);
  const explanation = sheet.getCell(inputTitleRow + 7, 9);
  explanation.value = "Period-based weighted rate, matching the app's current calculation. Includable and reimbursement tables feed this breakdown automatically. Other additions can include a separately calculated salary/trainee guarantee or override; these are not fetched here. Holiday premium and deductions start at zero. Step explanations appear below each equation. This template does not update saved payroll.";
  explanation.alignment = { wrapText: true, vertical: "top" };
  const steps: [string, string, string, number, string][] = [
    ["Total Includable", "Sum of includable Rate × Quantity", `SUMPRODUCT(Includable_${sheet.id}[Rate],Includable_${sheet.id}[Quantity])`, 0, "Includes negative entries, such as Redo, exactly once."],
    ["Base Straight Wages", "Sum of daily Total Hours × Company Hourly Rate", sum("I"), straight, "Includes all paid hours, including overtime at straight time; preserves daily rate changes."],
    ["Corrected Straight-Time Pay", "Step 1 + Step 2", "AL3+AL4", straight, "Straight-time wages plus includable compensation; reimbursements excluded."],
    ["Period Weighted Regular Rate", "Step 3 ÷ Total Hours", `IFERROR(AL5/H${total},0)`, weighted, "Period calculation used by the app; not a per-workweek allocation."],
    ["Corrected OT Premium", "OT Hours × Step 4 × OT Premium Factor", `G${total}*AL6*$AP$6`, premium, "Only the extra premium; the straight-time portion of OT is already in Step 2."],
    ["Holiday Premium", "Holiday premium input", "$AP$3", 0, "Enter any applicable holiday premium in AP3; default zero."],
    ["Wages Before State Match", "Step 3 + Step 5 + Step 6", "AL5+AL7+AL8", straight + premium, "Includable pay is already included; do not add it again."],
    ["State Regular-Pay Match", "MAX(State regular floor − Company regular pay, 0)", isPh ? "0" : `MAX(0,${sum("J")}-${companyRegularFormula})`, minMatch, "Regular hours only, including paid meal credit. Recalculates from States Worked and state rates."],
    ["Regular Rate After Match", "(Step 3 + Step 8) ÷ Total Hours", `IFERROR((AL5+AL10)/H${total},0)`, afterRate, "Includes the regular-pay shortfall before recalculating overtime."],
    ["Required OT Premium After Match", "OT Hours × Step 9 × OT Premium Factor", `G${total}*AL11*$AP$6`, requiredPremium, "Recomputed premium after the state regular-pay match."],
    ["Additional OT Match", "MAX(Step 10 − Step 5, 0)", "MAX(AL12-AL7,0)", otMatch, "Only incremental overtime; avoids counting the original premium twice."],
    ["Applied Total State Match", "State mode: Step 8 + Step 11; Company mode: 0", 'IF($AP$2="State",AL10+AL13,0)', minMatch + otMatch, "Choose Company or State in AP2. State adjustments are separate from reimbursements."],
    ["Earned Before Match / Deductions", "Step 7 + Reimbursements + Other Additions", `AL9+SUMPRODUCT(Reimbursements_${sheet.id}[Rate],Reimbursements_${sheet.id}[Quantity])+$AP$4`, straight + premium, "Reimbursements are added after the weighted-rate and OT calculation."],
    ["Total Deductions", "Deductions input", "$AP$5", 0, "Enter deductions as a positive amount in AP5. Do not repeat negative includable entries here."],
    ["FINAL PAY DUE", "Step 13 − Step 14 + Step 12", "AL15-AL16+AL14", straight + premium + minMatch + otMatch, "Formula result for this worksheet's inputs; displayed to cents without rounding intermediate steps."],
  ];
  steps.forEach(([name, equation, formula, result, notes], index) => {
    const row = titleRow + index + 2;
    sheet.mergeCells(row, 9, row, 10);
    sheet.mergeCells(row, 11, row, 12);
    sheet.getCell(row, 9).value = `${index + 1}. ${name}`;
    // Keep explanations in cells: ExcelJS writes legacy comment drawings after tableParts, which Excel rejects.
    sheet.getCell(row, 11).value = `${equation}\n${relocate(notes)}`;
    sheet.getCell(row, 13).value = { formula: relocate(formula), result };
    sheet.getCell(row, 13).numFmt = [3, 8].includes(index) ? '"$"0.0000' : '"$"#,##0.00;[Red]-"$"#,##0.00';
    sheet.getRow(row).height = 100;
    for (const column of [9, 11, 13]) {
      const cell = sheet.getCell(row, column);
      cell.alignment = { wrapText: true, vertical: "middle" };
      cell.border = { bottom: { style: "thin", color: { argb: "FFD0D0D0" } } };
      if (index === 14) {
        cell.font = { bold: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2F0D9" } };
      }
    }
  });
}
/** Presentation only: preserve all cell addresses used by the payroll formulas. */
export function styleAttendanceWorkbook(sheet: Worksheet, employeeName: string, attendance: AttendanceRow[]) {
  const navy = "FF17324D", teal = "FF087E8B", ink = "FF243746", border = "FFDCE4EC";
  const fill = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });
  sheet.properties.tabColor = { argb: teal };
  sheet.views = [{ state: "frozen", ySplit: 1, xSplit: 2, showGridLines: false, zoomScale: 85 }];
  sheet.eachRow(row => row.eachCell(cell => {
    cell.font = { name: "Calibri", size: 11, color: { argb: ink }, ...cell.font };
  }));
  for (let col = 1; col <= 17; col++) {
    if (col === 12) continue;
    const cell = sheet.getCell(1, col);
    cell.fill = fill(navy);
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  }
  sheet.getRow(1).height = 36;
  const money = '"$"#,##0.00;[Red]("$"#,##0.00);"$"0.00';
  for (let row = 2; row <= attendance.length + 1; row++) {
    sheet.getRow(row).height = 25;
    for (let col = 1; col <= 14; col++) {
      if (col === 12) continue;
      const cell = sheet.getCell(row, col);
      cell.fill = fill(col === 2 ? "FFFFF2CC" : row % 2 ? "FFF1F5F9" : "FFFFFFFF");
      cell.border = { bottom: { style: "hair", color: { argb: border } } };
      cell.alignment = { vertical: "middle", horizontal: col >= 5 ? "right" : "left", wrapText: col === 2 };
      if (col >= 9) cell.numFmt = money;
      if (col === 2 && String(cell.value ?? "").length > 26) sheet.getRow(row).height = 36;
    }
  }
  const totalRow = attendance.length + 3;
  sheet.getRow(totalRow).height = 32;
  for (let col = 1; col <= 11; col++) {
    const cell = sheet.getCell(totalRow, col);
    cell.fill = fill(navy);
    cell.font = { name: "Calibri", size: 12, bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle", horizontal: col >= 5 ? "right" : "left" };
    cell.border = { top: { style: "medium", color: { argb: teal } } };
    if (col >= 9) cell.numFmt = money;
  }
  sheet.getCell(totalRow, 1).value = "PERIOD TOTAL";
  sheet.mergeCells(totalRow + 1, 2, totalRow + 1, 6);
  sheet.getCell(totalRow + 1, 1).value = "EMPLOYEE";
  sheet.getCell(totalRow + 1, 2).value = employeeName;
  sheet.getRow(totalRow + 1).height = 26;
  for (const col of [1, 2]) {
    sheet.getCell(totalRow + 1, col).font = { name: "Calibri", size: 11, bold: true, color: { argb: navy } };
    sheet.getCell(totalRow + 1, col).alignment = { vertical: "middle" };
  }
  for (const [first, last, color] of [[1, 3, "FFFCE4D6"], [5, 7, "FFE4DFEC"]] as const) {
    const titleRow = attendance.length + 6;
    sheet.getRow(titleRow).height = 28;
    sheet.getRow(titleRow + 1).height = 27;
    for (let col = first; col <= last; col++) {
      const cell = sheet.getCell(titleRow + 1, col);
      cell.fill = fill(color);
      cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: ink } };
      cell.border = { bottom: { style: "medium", color: { argb: border } } };
      cell.alignment = { vertical: "middle", wrapText: true };
    }
    sheet.getRow(titleRow + 1).height = 34;
    sheet.getCell(titleRow + 1, last).numFmt = money;
    sheet.getRow(titleRow + 3).height = 28;
    for (let row = titleRow + 4; row <= titleRow + 9; row++) sheet.getRow(row).height = Math.max(sheet.getRow(row).height ?? 0, 26);
  }
  const calcTitle = attendance.length + 12;
  for (let step = 0; step < 15; step++) {
    const row = calcTitle + step + 2;
    for (const col of [9, 11, 13]) {
      const cell = sheet.getCell(row, col);
      cell.fill = fill(step === 14 ? teal : step % 2 ? "FFF1F5F9" : "FFFFFFFF");
      cell.font = { name: "Calibri", size: col === 11 ? 10 : 11, bold: col === 13 || step === 14, color: { argb: step === 14 ? "FFFFFFFF" : ink } };
    }
    if (step === 14) sheet.getCell(row, 13).font = { name: "Calibri", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  }
  // A report identity panel sits beside the reference rates without shifting formulas.
  sheet.mergeCells("S12:W13");
  sheet.getCell("S12").value = "PAYROLL • ATTENDANCE REPORT";
  sheet.getCell("S12").fill = fill(navy);
  sheet.getCell("S12").font = { name: "Calibri", size: 18, bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getCell("S12").alignment = { vertical: "middle", wrapText: true };
  sheet.mergeCells("S14:W15");
  sheet.getCell("S14").value = employeeName;
  sheet.getCell("S14").font = { name: "Calibri", size: 16, bold: true, color: { argb: navy } };
  sheet.getCell("S14").alignment = { vertical: "middle", wrapText: true };
  const period = attendance.length ? `${attendance[0].date} to ${attendance[attendance.length - 1].date}` : "No attendance rows";
  sheet.mergeCells("S16:W16");
  sheet.getCell("S16").value = `PERIOD  ${period}`;
  sheet.mergeCells("S18:W20");
  sheet.getCell("S18").value = "Yellow: editable state/rate inputs\nPeach: includable pay  •  Purple: reimbursements\nTeal: calculated final pay";
  sheet.getCell("S18").alignment = { wrapText: true, vertical: "middle" };
  sheet.getCell("S18").fill = fill("FFE8F4F5");
  const footerRow = Math.max(attendance.length + 44, 52);
  sheet.mergeCells(footerRow, 1, footerRow, 13);
  const footer = sheet.getCell(footerRow, 1);
  footer.value = "CONFIDENTIAL • Payroll worksheet | Editable workbook copy • Changes do not update saved payroll";
  footer.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF64748B" } };
  footer.border = { top: { style: "thin", color: { argb: border } } };
  footer.alignment = { vertical: "middle", wrapText: true };
  sheet.getRow(footerRow).height = 28;
  // 8 = A3 in Excel's paper-size codes; exceljs's PaperSize enum just doesn't list it.
  sheet.pageSetup = { paperSize: 8 as unknown as NonNullable<Worksheet["pageSetup"]["paperSize"]>, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printArea: `A1:Q${footerRow}`, printTitlesRow: "1:1", margins: { left: 0.25, right: 0.25, top: 0.55, bottom: 0.5, header: 0.2, footer: 0.2 } };
  const safeName = employeeName.replace(/&/g, "&&");
  sheet.headerFooter.oddHeader = `&L&BPayroll Attendance&B&C${safeName}&R${period}`;
  sheet.headerFooter.oddFooter = "&LConfidential • Payroll worksheet&C&A&RPage &P of &N";
}
export function populateAttendanceSheet(
  sheet: Worksheet, employeeName: string,
  attendance: Parameters<typeof attendanceExportRows>[0],
  hours: Parameters<typeof attendanceExportRows>[1],
  pay: Parameters<typeof attendanceExportRows>[2],
  states: Parameters<typeof attendanceExportRows>[3],
  isPh: boolean,
) {
      sheet.addRow(attendanceExportHeaders);
      sheet.addRows(attendanceExportRows(attendance, hours, pay, states, isPh ? 1 : 1.5, employeeName));
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: attendance.length + 1, column: 11 } };
      sheet.columns.forEach((column, index) => { column.width = index === 1 ? 28 : 19; if (index >= 4) column.numFmt = index < 8 ? "0.000" : '"$"#,##0.00'; });
      sheet.getRow(1).font = { bold: true };
      sheet.getRow(attendance.length + 3).font = { bold: true };
      addAttendanceStateFormulas(sheet, attendance, pay, isPh);
      addAttendanceAdjustmentTemplates(sheet, attendance.length);
      addAttendancePayBreakdown(sheet, attendance.length, isPh);
      styleAttendanceWorkbook(sheet, employeeName, attendance);
}

export async function downloadIndividualAttendanceWorkbook(
  employeeName: string,
  attendance: Parameters<typeof attendanceExportRows>[0],
  hours: Parameters<typeof attendanceExportRows>[1],
  pay: Parameters<typeof attendanceExportRows>[2],
  states: Parameters<typeof attendanceExportRows>[3],
  isPh: boolean, start: string, end: string,
) {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.calcProperties.fullCalcOnLoad = true;
  const sheet = workbook.addWorksheet(uniqueAttendanceSheetName(employeeName, new Set()));
  populateAttendanceSheet(sheet, employeeName, attendance, hours, pay, states, isPh);
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `attendance_${employeeName.replace(/[^a-z0-9_-]+/gi, "_")}_${start}_to_${end}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const previousDate = (date: string) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
};

export async function downloadPayrollAttendanceWorkbook(
  employees: SupabaseEmployee[], start: string, end: string, team: string,
  onProgress: (done: number, total: number) => void,
) {
  if (!employees.length || !start || !end || start > end) throw new Error("Select employees and a valid period to export.");
  const people = [...new Map(employees.map((employee) => [employee.id, employee])).values()];
  const seedStart = startOfWeekSunday(start);
  const [ExcelJS, requests, notes, holidays, corrections] = await Promise.all([
    import("exceljs"), getCompanyPtoRequests(), getAttendanceNotes(seedStart, end),
    getCompanyHolidaysInRange(start, end), getPendingCorrectionsInRange(start, end),
  ]);
  const workbook = new ExcelJS.Workbook();
  workbook.calcProperties.fullCalcOnLoad = true;
  const used = new Set<string>();
  let done = 0;
  // Process sequentially to bound database traffic and keep worksheet order stable.
  for (const employee of people) {
    try {
      const paidLeaveDates = new Map<string, PtoType>();
      const unpaidLeaveDates = new Map<string, PtoType>();
      for (const note of notes) {
        if (note.profileId !== employee.id) continue;
        const type = HR_STATUS_TO_PTO_TYPE[note.hrNote];
        if (type) (isPaidPtoType(type) ? paidLeaveDates : unpaidLeaveDates).set(note.noteDate, type);
      }
      for (const paid of [true, false]) {
        for (const request of requests) {
          if (request.profileId !== employee.id || request.status !== "approved" || isPaidPtoType(request.ptoType) !== paid) continue;
          const first = request.startDate > seedStart ? request.startDate : seedStart;
          const last = request.endDate < end ? request.endDate : end;
          for (const date = new Date(`${first}T12:00:00Z`); date <= new Date(`${last}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 1)) {
            if (employee.offDays?.includes(date.getUTCDay())) continue;
            const key = date.toISOString().slice(0, 10);
            (paid ? paidLeaveDates : unpaidLeaveDates).set(key, request.ptoType);
            if (!paid) paidLeaveDates.delete(key);
          }
        }
      }
      const schedule = { requiredCheckIn: employee.requiredCheckIn, requiredCheckOut: employee.requiredCheckOut,
        workingHours: employee.workingHours, mealMinutes: employee.mealMinutes, daysOff: employee.offDays,
        graceMinutes: payGraceMinutesFor(employee.country), paidLeaveDates, unpaidLeaveDates };
      const [attendance, seed, history, tickets] = await Promise.all([
        getAttendanceForRange(employee.id, start, end, { ...schedule, holidayDates: holidays.map(h => h.date),
          pendingCorrectionDates: corrections.filter(c => c.profileId === employee.id).map(c => c.workDate) }),
        seedStart < start ? getAttendanceForRange(employee.id, seedStart, previousDate(start), schedule) : Promise.resolve([]),
        getSalaryHistory(employee.id), getTicketAttendanceForTechnician(employee.full_name, start, end),
      ]);
      const states = new Map<string, { states: string[] }>();
      for (const ticket of tickets) {
        if (!ticket.arrivedAt) continue;
        const state = normalizeStateName(ticket.state);
        if (!state) continue;
        const entry = states.get(ticket.scheduleDate) ?? { states: [] };
        if (!entry.states.includes(state)) entry.states.push(state);
        states.set(ticket.scheduleDate, entry);
      }
      const isPh = employee.country === "PH";
      const paidMeal = !isPh && isMealAlwaysPaidRole(employee.role, employee.extraRoles);
      const flat = usesFlatWeeklyOvertimeThreshold(employee.role, employee.extraRoles);
      const rawHours = (row: AttendanceRow) => row.hoursWorked + ((row.status === "paid-leave" || row.status === "day-off" || row.status === "holiday" || !row.hoursWorked) ? 0 : Math.max(0, computeMealTimeCredit({ checkIn: row.clockIn, checkOut: row.clockOut, mealStart: row.mealStart, mealEnd: row.mealEnd }, paidMeal)));
      const duty = flat ? 40 : computeScheduledDutyHours(employee.requiredCheckIn || "", employee.requiredCheckOut || "", employee.workingHours, employee.mealMinutes, employee.offDays, start, end);
      const hours = duty > 0
        ? splitRegularOvertimeWeekly([...seed, ...attendance].filter(r => r.status !== "paid-leave").map(r => ({ date: r.date, rawHours: rawHours(r) })), { ...schedule, offDays: employee.offDays }, 8, flat ? 40 : undefined)
        : new Map(attendance.filter(r => r.status !== "paid-leave").map(r => [r.date, { regular: Math.min(rawHours(r), 8), overtime: Math.max(0, rawHours(r) - 8) }]));
      const pay = new Map<string, { companyRate: number; effectiveRate: number }>();
      for (const row of attendance) {
        if (row.status === "paid-leave" && row.hoursWorked) hours.set(row.date, { regular: row.hoursWorked, overtime: 0 });
        const companyRate = rateEffectiveOn(history, row.date);
        const state = row.state || highestRateAmong(states.get(row.date)?.states ?? []);
        const floor = STATE_MIN_WAGE_2026.find(s => s.state === state)?.rate ?? 0;
        pay.set(row.date, { companyRate, effectiveRate: companyRate > 0 ? Math.max(companyRate, floor) : 0 });
      }
      const sheet = workbook.addWorksheet(uniqueAttendanceSheetName(employee.full_name, used));
      populateAttendanceSheet(sheet, employee.full_name, attendance, hours, pay, states, isPh);
      onProgress(++done, people.length);
    } catch (error) {
      throw new Error(`Could not export ${employee.full_name}: ${error instanceof Error ? error.message : "Unable to load attendance"}. No partial workbook was downloaded.`);
    }
  }
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `attendance_${team}_${start}_to_${end}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
