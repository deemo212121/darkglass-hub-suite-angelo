# Pro-Rata Payroll Calculator - Quick Reference

## One-Minute Overview

The pro-rata payroll system automatically calculates correct pay when an employee's salary changes during a pay period.

**The Problem:**
- Employee works 5 days at $4/hour, then promoted to $6/hour for remaining 5 days
- Simple calculation: 40 hours × something? → Wrong!
- Need to split and calculate each portion separately

**The Solution:**
- Split period at change point
- Calculate each portion with its rate
- Add them together
- Result: Accurate pro-rata pay

## Quick Examples

### Example 1: Basic Promotion
```
Monday-Friday: $4/hr (20 hours)
Saturday-Sunday + Monday-Wednesday: $6/hr (20 hours)
Total: (20 × $4) + (20 × $6) = $80 + $120 = $200
```

### Example 2: With Overtime
```
Days 1-4: 20 hours @ $15 = $300 (no OT)
Days 5-10: 30 hours @ $20 = $600 regular + $300 OT (10hrs × $30) = $900
Total: $300 + $900 = $1,200
```

## Code Snippets

### Setup
```typescript
// Import
import {
  createSalaryHistory,
  addSalaryChange,
  calculateSplitPayroll,
} from './lib/payrollCalculations';

// Create history
const history = createSalaryHistory('EMP001', 4.00, new Date('2024-01-01'));
```

### Add Changes
```typescript
// Promotion
const withPromo = addSalaryChange(
  history,
  new Date('2024-01-06'),
  6.00,
  'promotion',
  'Senior Developer'
);

// Demotion
const withDemotion = addSalaryChange(
  history,
  new Date('2024-01-06'),
  3.50,
  'demotion'
);

// Adjustment
const withAdjustment = addSalaryChange(
  history,
  new Date('2024-01-06'),
  4.25,
  'adjustment',
  'COLA raise'
);
```

### Calculate
```typescript
const breakdown = calculateSplitPayroll(
  'EMP001',        // Employee ID
  withPromo,       // Salary history
  new Date('2024-01-01'),  // Period start
  new Date('2024-01-10'),  // Period end
  40               // Total hours worked
);

console.log(breakdown.totalPay);  // Total payroll
console.log(breakdown.portions);  // Breakdown by portion
```

### Display
```typescript
import { PayrollBreakdownDisplay } from './components/PayrollBreakdownDisplay';

<PayrollBreakdownDisplay breakdown={breakdown} />
```

## Key Functions

| Function | Purpose | Returns |
|----------|---------|---------|
| `createSalaryHistory()` | Initialize employee | SalaryHistory |
| `addSalaryChange()` | Record rate change | SalaryHistory |
| `calculateSplitPayroll()` | Calculate payroll | SplitPayrollBreakdown |
| `getEffectiveRate()` | Get rate for date | number |
| `findSalaryChangesInPeriod()` | List changes in period | SalaryEntry[] |
| `calculateRegularPay()` | Regular pay only | number |
| `calculateOvertimePay()` | Overtime pay (1.5x) | number |

## Result Structure

```typescript
{
  employeeId: string;
  payPeriodStart: Date;
  payPeriodEnd: Date;
  totalHoursWorked: number;
  portions: [
    {
      periodName: string;
      startDate: Date;
      endDate: Date;
      hoursWorked: number;
      hourlyRate: number;
      regularPay: number;
      overtimePay: number;
      totalPay: number;
    }
  ];
  totalRegularPay: number;
  totalOvertimePay: number;
  totalPay: number;
  salaryChangeOccurred: boolean;
}
```

## Common Scenarios

### New Hire Starting Mid-Pay-Period
```typescript
const initial = createSalaryHistory('EMP_NEW', 15, new Date('2024-01-15'));
const breakdown = calculateSplitPayroll(
  'EMP_NEW',
  initial,
  new Date('2024-01-15'),  // Start mid-period
  new Date('2024-01-31'),
  32  // Partial hours worked
);
```

### Multiple Rate Changes
```typescript
let history = createSalaryHistory('EMP002', 12, new Date('2024-01-01'));
history = addSalaryChange(history, new Date('2024-01-05'), 14, 'promotion');
history = addSalaryChange(history, new Date('2024-01-15'), 16, 'promotion');
// Both changes included in calculation automatically
```

### Long Pay Period (2+ weeks)
```typescript
const breakdown = calculateSplitPayroll(
  'EMP001',
  history,
  new Date('2024-01-01'),
  new Date('2024-01-31'),  // Full month
  160  // 4 weeks × 40 hours
);
```

## Formulas

### Regular Pay (No OT)
```
regularPay = min(hoursWorked, 40) × hourlyRate
```

### Overtime Pay (Hours > 40)
```
overtimePay = max(0, hoursWorked - 40) × hourlyRate × 1.5
```

### Split Period Distribution
```
hoursInPortion = (daysInPortion / totalDays) × totalHoursWorked
```

### Total Pay
```
totalPay = regularPay + overtimePay
```

## Files

| File | Purpose |
|------|---------|
| `src/lib/payrollCalculations.ts` | Core logic |
| `src/components/PayrollBreakdownDisplay.tsx` | React display |
| `src/lib/payrollExamples.ts` | 7 examples |
| `src/routes/payroll-demo.tsx` | Interactive demo |
| `src/lib/payrollCalculations.test.ts` | Unit tests |

## Testing

```typescript
import { runTests } from './lib/payrollCalculations.test';
runTests();
```

## Demo

Visit: `/payroll-demo` route for interactive demonstration

## Pro Tips

✓ **Tip 1**: Use descriptive notes in salary changes for audit trail
```typescript
addSalaryChange(history, date, rate, 'promotion', 'Promoted to Manager - Approval #123')
```

✓ **Tip 2**: Round calculations to 2 decimals (system does this automatically)

✓ **Tip 3**: Store salary history with employee record for future calculations

✓ **Tip 4**: Use the demo page to verify calculations before deploying

✓ **Tip 5**: Each portion's overtime calculated independently (see Example 2)

## FAQ

**Q: What if salary changes on same day as period start/end?**
A: Handled correctly - day count algorithms account for boundary dates

**Q: How are hours distributed across portions?**
A: Proportionally by number of days - (days in portion / total days) × total hours

**Q: Does it handle fractional hours?**
A: Yes, accurate to 2 decimal places

**Q: What about different overtime rules?**
A: Modify `OVERTIME_THRESHOLD` and `OVERTIME_MULTIPLIER` constants

**Q: Can it handle monthly pay periods?**
A: Yes, just pass the appropriate dates and total hours

**Q: Is it precise for large numbers?**
A: All calculations use JavaScript number type with 2 decimal rounding

## Constants to Customize

```typescript
// For different overtime rules
const OVERTIME_THRESHOLD = 40;  // Change for different weekly threshold
const OVERTIME_MULTIPLIER = 1.5; // Change for different OT rate (e.g., 2.0)
```

## Error Handling

```typescript
// This throws - no rate found for date
getEffectiveRate(history, dateBeforeFirstEntry);

// Solution: Always ensure first entry is before query date
const history = createSalaryHistory('EMP', 15, new Date('2024-01-01'));
// Now safe to query dates >= 2024-01-01
```

## Next Steps

1. **Understand**: Review the examples in `payrollExamples.ts`
2. **Implement**: Copy code snippets into your application
3. **Test**: Run the demo at `/payroll-demo`
4. **Verify**: Check unit tests in `payrollCalculations.test.ts`
5. **Deploy**: Use in production payroll system

## Support

See full documentation in `PAYROLL_DOCUMENTATION.md`
