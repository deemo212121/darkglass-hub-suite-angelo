/**
 * Comprehensive Examples and Test Cases for Pro-rata Payroll Calculations
 */

import {
  createSalaryHistory,
  addSalaryChange,
  calculateSplitPayroll,
  SalaryHistory,
  SplitPayrollBreakdown,
} from './payrollCalculations';

/**
 * EXAMPLE 1: Basic Promotion Mid-Period
 * Employee: Works 5 days at $4/hr, then promoted to $6/hr for remaining days
 * Pay Period: 10-day period (2-week sprint)
 * Total Hours: 40 hours
 */
export function exampleBasicPromotion(): SplitPayrollBreakdown {
  // Create initial salary history at $4/hr starting Jan 1
  const salaryHistory = createSalaryHistory(
    'EMP001',
    4,
    new Date('2024-01-01')
  );

  // Add promotion to $6/hr effective Jan 6 (6th day of period)
  const withPromotion = addSalaryChange(
    salaryHistory,
    new Date('2024-01-06'),
    6,
    'promotion',
    'Promoted to Senior Developer'
  );

  // Calculate payroll for Jan 1-10 (10-day pay period)
  const breakdown = calculateSplitPayroll(
    'EMP001',
    withPromotion,
    new Date('2024-01-01'),
    new Date('2024-01-10'),
    40 // Total 40 hours worked
  );

  return breakdown;
}

/**
 * EXAMPLE 2: Promotion with Overtime
 * Employee: 50 hours worked in pay period, promoted mid-way
 * This demonstrates how overtime is calculated per portion
 */
export function examplePromotionWithOvertime(): SplitPayrollBreakdown {
  const salaryHistory = createSalaryHistory('EMP002', 15, new Date('2024-01-01'));

  const withPromotion = addSalaryChange(
    salaryHistory,
    new Date('2024-01-05'),
    20,
    'promotion',
    'Promoted to Team Lead'
  );

  // 50 hours in pay period, promotion on day 5
  // Days 1-4: 20 hours at $15/hr (no OT for this portion)
  // Days 5-10: 30 hours at $20/hr (10 hours OT at $30/hr)
  const breakdown = calculateSplitPayroll(
    'EMP002',
    withPromotion,
    new Date('2024-01-01'),
    new Date('2024-01-10'),
    50
  );

  return breakdown;
}

/**
 * EXAMPLE 3: Multiple Salary Changes
 * Employee: Three different rates within single pay period
 */
export function exampleMultipleSalaryChanges(): SplitPayrollBreakdown {
  let salaryHistory = createSalaryHistory('EMP003', 12, new Date('2024-01-01'));

  salaryHistory = addSalaryChange(
    salaryHistory,
    new Date('2024-01-04'),
    14,
    'promotion',
    'Mid-year raise'
  );

  salaryHistory = addSalaryChange(
    salaryHistory,
    new Date('2024-01-08'),
    16,
    'promotion',
    'Performance bonus'
  );

  // 40 hours total: Jan 1-3 at $12, Jan 4-7 at $14, Jan 8-10 at $16
  const breakdown = calculateSplitPayroll(
    'EMP003',
    salaryHistory,
    new Date('2024-01-01'),
    new Date('2024-01-10'),
    40
  );

  return breakdown;
}

/**
 * EXAMPLE 4: Demotion
 * Employee: Works at higher rate, then demoted to lower rate
 */
export function exampleDemotion(): SplitPayrollBreakdown {
  const salaryHistory = createSalaryHistory('EMP004', 25, new Date('2024-01-01'));

  const withDemotion = addSalaryChange(
    salaryHistory,
    new Date('2024-01-06'),
    18,
    'demotion',
    'Performance concerns'
  );

  const breakdown = calculateSplitPayroll(
    'EMP004',
    withDemotion,
    new Date('2024-01-01'),
    new Date('2024-01-10'),
    45 // 45 hours, days 1-5 have potential overtime
  );

  return breakdown;
}

/**
 * EXAMPLE 5: Weekly Payroll with Mid-Week Change
 * More realistic: 2-week pay period with daily tracking
 */
export function exampleWeeklyPayrollChange(): SplitPayrollBreakdown {
  const salaryHistory = createSalaryHistory('EMP005', 18.5, new Date('2024-01-08'));

  // Change happens Wednesday of second week
  const withChange = addSalaryChange(
    salaryHistory,
    new Date('2024-01-17'),
    22,
    'promotion',
    'Promoted to Supervisor'
  );

  // 2-week period: Jan 8-21
  // Week 1: Mon-Fri 40 hours at $18.50
  // Week 2: Mon-Tue 16 hours at $18.50, Wed-Fri 24 hours at $22
  const breakdown = calculateSplitPayroll(
    'EMP005',
    withChange,
    new Date('2024-01-08'),
    new Date('2024-01-21'),
    80 // Standard 2-week payroll (40 hrs/week)
  );

  return breakdown;
}

/**
 * EXAMPLE 6: Salary Adjustment (not tied to promotion/demotion)
 * General adjustment/COLA/merit increase
 */
export function exampleSalaryAdjustment(): SplitPayrollBreakdown {
  const salaryHistory = createSalaryHistory('EMP006', 19.75, new Date('2024-01-01'));

  const withAdjustment = addSalaryChange(
    salaryHistory,
    new Date('2024-01-15'),
    20.50,
    'adjustment',
    'COLA adjustment'
  );

  const breakdown = calculateSplitPayroll(
    'EMP006',
    withAdjustment,
    new Date('2024-01-01'),
    new Date('2024-01-31'),
    160 // Full month: 40 hrs/week × 4 weeks
  );

  return breakdown;
}

/**
 * EXAMPLE 7: High Earner with Significant Overtime Impact
 * Demonstrates how overtime multiplier compounds with salary changes
 */
export function exampleHighEarnerOvertime(): SplitPayrollBreakdown {
  const salaryHistory = createSalaryHistory('EMP007', 50, new Date('2024-01-01'));

  const withRaise = addSalaryChange(
    salaryHistory,
    new Date('2024-01-05'),
    65,
    'promotion',
    'Executive promotion'
  );

  // 60 hours total: Days 1-4 (5 days of 10 hrs) at $50, then Days 5-10 (40 hrs) at $65
  // This creates significant overtime pay difference between portions
  const breakdown = calculateSplitPayroll(
    'EMP007',
    withRaise,
    new Date('2024-01-01'),
    new Date('2024-01-10'),
    60
  );

  return breakdown;
}

/**
 * Format breakdown for display/logging
 */
export function formatBreakdownForDisplay(breakdown: SplitPayrollBreakdown): string {
  const lines: string[] = [];

  lines.push('='.repeat(60));
  lines.push('PAYROLL CALCULATION BREAKDOWN');
  lines.push('='.repeat(60));
  lines.push(
    `Employee ID: ${breakdown.employeeId}`
  );
  lines.push(
    `Pay Period: ${breakdown.payPeriodStart.toDateString()} to ${breakdown.payPeriodEnd.toDateString()}`
  );
  lines.push(
    `Salary Change: ${breakdown.salaryChangeOccurred ? 'YES' : 'NO'}`
  );
  lines.push('-'.repeat(60));

  lines.push('');
  lines.push('PERIOD BREAKDOWN:');
  lines.push('');

  breakdown.portions.forEach((portion, idx) => {
    lines.push(`Part ${idx + 1}: ${portion.periodName}`);
    lines.push(`  Date Range: ${portion.startDate.toDateString()} - ${portion.endDate.toDateString()}`);
    lines.push(`  Hours Worked: ${portion.hoursWorked.toFixed(2)}`);
    lines.push(`  Hourly Rate: $${portion.hourlyRate.toFixed(2)}`);
    lines.push(`  Regular Pay: $${portion.regularPay.toFixed(2)}`);
    if (portion.overtimePay && portion.overtimePay > 0) {
      const overtimeHours = portion.hoursWorked - 40;
      const overtimeRate = portion.hourlyRate * 1.5;
      lines.push(`  Overtime Hours: ${overtimeHours.toFixed(2)} @ ${overtimeRate.toFixed(2)}/hr`);
      lines.push(`  Overtime Pay: $${portion.overtimePay.toFixed(2)}`);
    }
    lines.push(`  Total: $${portion.totalPay.toFixed(2)}`);
    lines.push('');
  });

  lines.push('-'.repeat(60));
  lines.push('SUMMARY:');
  lines.push(`  Total Hours: ${breakdown.totalHoursWorked.toFixed(2)}`);
  lines.push(`  Total Regular Pay: $${breakdown.totalRegularPay.toFixed(2)}`);
  lines.push(
    `  Total Overtime Pay: $${breakdown.totalOvertimePay.toFixed(2)}`
  );
  lines.push(`  TOTAL PAY: $${breakdown.totalPay.toFixed(2)}`);
  lines.push('='.repeat(60));

  return lines.join('\n');
}

/**
 * Run all examples and display results
 */
export function runAllExamples(): void {
  const examples = [
    { name: 'Example 1: Basic Promotion', fn: exampleBasicPromotion },
    { name: 'Example 2: Promotion with Overtime', fn: examplePromotionWithOvertime },
    { name: 'Example 3: Multiple Salary Changes', fn: exampleMultipleSalaryChanges },
    { name: 'Example 4: Demotion', fn: exampleDemotion },
    { name: 'Example 5: Weekly Payroll Change', fn: exampleWeeklyPayrollChange },
    { name: 'Example 6: Salary Adjustment', fn: exampleSalaryAdjustment },
    { name: 'Example 7: High Earner Overtime', fn: exampleHighEarnerOvertime },
  ];

  examples.forEach(({ name, fn }) => {
    console.log('\n');
    console.log(name);
    const breakdown = fn();
    console.log(formatBreakdownForDisplay(breakdown));
  });
}

/**
 * Detailed breakdown of Example 1 for documentation
 */
export function example1DetailedExplanation(): string {
  const breakdown = exampleBasicPromotion();

  return `
EXAMPLE 1: BASIC PROMOTION MID-PERIOD
=====================================

Scenario:
- Employee works a 10-day pay period
- First 5 days: $4/hour
- Last 5 days: $6/hour (after promotion)
- Total hours: 40 hours

Calculation:
- Pay period: Jan 1 - Jan 10, 2024
- Days before promotion: 5 days (Jan 1-5)
- Days after promotion: 5 days (Jan 6-10)
- Total work days: 10 days
- Hours per day: 40 hours / 10 days = 4 hours/day

Part 1 (Before Promotion):
  - Hours: 5 days × 4 hours/day = 20 hours
  - Rate: $4/hour
  - Pay: 20 × $4 = $80.00
  - (No overtime in this portion)

Part 2 (After Promotion):
  - Hours: 5 days × 4 hours/day = 20 hours
  - Rate: $6/hour
  - Pay: 20 × $6 = $120.00
  - (No overtime in this portion)

TOTAL PAYROLL:
  - Part 1: $80.00
  - Part 2: $120.00
  - GRAND TOTAL: $200.00

If there had been NO promotion (stayed at $4/hr):
  - 40 hours × $4 = $160.00
  - Employee receives additional $40.00 due to promotion

Actual Results:
${formatBreakdownForDisplay(breakdown)}
  `;
}
