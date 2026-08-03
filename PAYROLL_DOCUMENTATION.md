# Pro-Rata Payroll Calculation System

## Overview

A comprehensive system for calculating employee payroll when salary changes occur mid-period. The system handles complex scenarios including:

- Mid-period promotions, demotions, and salary adjustments
- Multiple salary changes within a single pay period
- Overtime calculations for split periods
- Accurate pro-rata distribution of hours

## Architecture

### Core Components

#### 1. **Data Structures**

```typescript
interface SalaryEntry {
  id: string;
  effectiveDate: Date;
  hourlyRate: number;
  reason: 'promotion' | 'demotion' | 'adjustment' | 'initial';
  notes?: string;
}

interface SalaryHistory {
  employeeId: string;
  salaryEntries: SalaryEntry[];
}

interface PayrollPeriodPortion {
  periodName: string;
  startDate: Date;
  endDate: Date;
  hoursWorked: number;
  hourlyRate: number;
  regularPay: number;
  overtimePay?: number;
  totalPay: number;
}

interface SplitPayrollBreakdown {
  employeeId: string;
  payPeriodStart: Date;
  payPeriodEnd: Date;
  totalHoursWorked: number;
  portions: PayrollPeriodPortion[];
  totalRegularPay: number;
  totalOvertimePay: number;
  totalPay: number;
  salaryChangeOccurred: boolean;
}
```

#### 2. **Core Functions**

**createSalaryHistory(employeeId, initialRate, effectiveDate)**
- Creates a new salary history for an employee
- Sets up the initial salary entry
- Returns a SalaryHistory object

**addSalaryChange(history, effectiveDate, hourlyRate, reason, notes)**
- Adds a new salary change to history
- Maintains chronological order
- Returns updated SalaryHistory

**getEffectiveRate(salaryHistory, date)**
- Returns the effective hourly rate on a specific date
- Looks up the most recent entry before/on that date
- Throws error if no rate found for date

**findSalaryChangesInPeriod(salaryHistory, periodStart, periodEnd)**
- Identifies all salary changes within a pay period
- Returns array of SalaryEntry objects
- Excludes changes outside period boundaries

**calculateSplitPayroll(...)**
- Main calculation function
- Splits period at salary change points
- Distributes hours proportionally
- Calculates pay for each portion
- Combines for total payroll

### Calculation Logic

#### Step 1: Identify Salary Changes
When calculating payroll for a period, the system identifies all salary changes that occur during that period.

```
Pay Period: Jan 1 - Jan 10
Salary Change: Jan 6 (from $4 to $6)
Result: 2 portions needed
```

#### Step 2: Determine Duration of Each Portion
Calculate the number of days in each portion of the period.

```
Portion 1: Jan 1 - Jan 5 (5 days)
Portion 2: Jan 6 - Jan 10 (5 days)
Total: 10 days
```

#### Step 3: Distribute Hours Proportionally
Allocate total hours worked across portions based on day distribution.

```
Total hours: 40
Days per portion: 5/10 = 50%
Hours per portion: 40 * 0.5 = 20 hours
```

#### Step 4: Calculate Pay for Each Portion
Apply the applicable rate and handle overtime separately.

```
Portion 1: 20 hours × $4 = $80
Portion 2: 20 hours × $6 = $120
```

#### Step 5: Combine Results
Sum all portions for total payroll.

```
Total: $80 + $120 = $200
```

## Example Scenarios

### Scenario 1: Basic Promotion (Example 1)

**Setup:**
- Employee: EMP001
- Initial Rate: $4/hour
- Promotion: Effective Jan 6 → $6/hour
- Pay Period: Jan 1-10 (10 days)
- Total Hours: 40 hours

**Calculation:**

| Portion | Period | Hours | Rate | Pay |
|---------|--------|-------|------|-----|
| Before  | Jan 1-5 | 20 | $4 | $80 |
| After   | Jan 6-10 | 20 | $6 | $120 |
| **TOTAL** | | **40** | | **$200** |

**Math:**
- Portion 1: 5 days × (40 hours / 10 days) × $4/hour = 20 × $4 = $80
- Portion 2: 5 days × (40 hours / 10 days) × $6/hour = 20 × $6 = $120
- Total: $80 + $120 = $200

### Scenario 2: Promotion with Overtime

**Setup:**
- Employee: EMP002
- Initial Rate: $15/hour
- Promotion: Effective Jan 5 → $20/hour
- Pay Period: Jan 1-10 (10 days)
- Total Hours: 50 hours

**Calculation:**

| Portion | Period | Hours | Reg Pay | OT Hours | OT Rate | OT Pay | Total |
|---------|--------|-------|---------|----------|---------|--------|-------|
| Before  | Jan 1-4 | 20 | $300 | 0 | - | $0 | $300 |
| After   | Jan 5-10 | 30 | $600 | 10 | $30 | $300 | $900 |
| **TOTAL** | | **50** | **$900** | **10** | **$30** | **$300** | **$1200** |

**Math:**
- Portion 1: 20 hours (all regular at $15) = $300, no overtime
- Portion 2: 30 hours = 30×$20 = $600 regular, then 10 hours OT at $20×1.5 = $300
- Total: $300 + $900 = $1200

### Scenario 3: Multiple Salary Changes

**Setup:**
- Three different rates within single period
- Day 1-3: $12/hour
- Day 4-7: $14/hour
- Day 8-10: $16/hour
- Total Hours: 40

**Calculation:**

| Portion | Period | Hours | Rate | Pay |
|---------|--------|-------|------|-----|
| First   | Day 1-3 | 12 | $12 | $144 |
| Second  | Day 4-7 | 16 | $14 | $224 |
| Third   | Day 8-10 | 12 | $16 | $192 |
| **TOTAL** | | **40** | | **$560** |

## Implementation Files

### 1. **src/lib/payrollCalculations.ts**
Core calculation engine with all business logic and types.

**Key Exports:**
- `createSalaryHistory()` - Initialize employee salary history
- `addSalaryChange()` - Record salary changes
- `calculateSplitPayroll()` - Main calculation function
- `getEffectiveRate()` - Look up rates for specific dates
- `findSalaryChangesInPeriod()` - Identify changes in period
- `calculateRegularPay()` - Regular pay (no overtime)
- `calculateOvertimePay()` - Overtime pay (1.5x multiplier)

### 2. **src/components/PayrollBreakdownDisplay.tsx**
React UI component for displaying calculations.

**Features:**
- Summary card with totals
- Period-by-period breakdown
- Calculation details
- Currency formatting
- Date formatting
- Color-coded badges

### 3. **src/lib/payrollExamples.ts**
Seven comprehensive examples demonstrating various scenarios.

**Examples:**
1. Basic Promotion
2. Promotion with Overtime
3. Multiple Salary Changes
4. Demotion
5. Weekly Payroll Change
6. Salary Adjustment
7. High Earner Overtime

### 4. **src/routes/payroll-demo.tsx**
Interactive demo page with all examples and documentation.

**Features:**
- Example selector
- Live calculations
- Detailed breakdown view
- Implementation guide
- Code examples

### 5. **src/lib/payrollCalculations.test.ts**
Comprehensive unit tests for all functions.

**Test Coverage:**
- History creation and management
- Effective rate calculation
- Period splitting logic
- Regular and overtime pay
- Integration tests
- Manual test runner

## Usage Guide

### Basic Usage

```typescript
import {
  createSalaryHistory,
  addSalaryChange,
  calculateSplitPayroll,
} from './lib/payrollCalculations';

// 1. Create salary history for employee
const history = createSalaryHistory('EMP001', 4, new Date('2024-01-01'));

// 2. Add salary changes as they occur
const withPromotion = addSalaryChange(
  history,
  new Date('2024-01-06'),
  6,
  'promotion',
  'Promoted to Senior Developer'
);

// 3. Calculate payroll for the period
const breakdown = calculateSplitPayroll(
  'EMP001',
  withPromotion,
  new Date('2024-01-01'),
  new Date('2024-01-10'),
  40 // Total hours worked
);

// 4. Access results
console.log(breakdown.totalPay); // $200
console.log(breakdown.portions); // Array of portions with details
```

### With React Component

```typescript
import { PayrollBreakdownDisplay } from './components/PayrollBreakdownDisplay';

function MyPayrollPage() {
  const breakdown = calculateSplitPayroll(...);

  return (
    <PayrollBreakdownDisplay breakdown={breakdown} />
  );
}
```

### Running Examples

```typescript
import { runAllExamples, formatBreakdownForDisplay } from './lib/payrollExamples';

// Display all examples in console
runAllExamples();

// Or individual example
const breakdown = exampleBasicPromotion();
console.log(formatBreakdownForDisplay(breakdown));
```

## Constants

```typescript
const OVERTIME_THRESHOLD = 40; // Hours per week
const OVERTIME_MULTIPLIER = 1.5; // 1.5x pay for overtime
```

These can be adjusted for different jurisdictions or company policies.

## Edge Cases Handled

1. **No Salary Changes**: Simple payroll calculation without splitting
2. **Same-Day Change**: Handled with day count calculations
3. **Multiple Changes**: Correctly splits into multiple portions
4. **Overtime Across Portions**: Each portion's overtime calculated independently
5. **Demotion**: Works identically to promotion, just lower rate
6. **Adjustment Only**: No promotion/demotion reason
7. **Decimal Hours**: Accurate to 2 decimal places

## Testing

Run unit tests:

```bash
npm test -- payrollCalculations.test.ts
```

Or use manual test runner:

```typescript
import { runTests } from './lib/payrollCalculations.test';
runTests();
```

## Demo Page

Access interactive demo at `/payroll-demo` route.

Features:
- 7 different examples
- Live calculation updates
- Detailed breakdown view
- Documentation
- Code examples

## Compliance Notes

This system is designed to:
- ✓ Handle US federal overtime (40 hour threshold)
- ✓ Support any hourly rate
- ✓ Track reason for change (compliance documentation)
- ✓ Maintain complete history for audit trails
- ✓ Calculate pro-rata correctly for mid-period changes

**Note**: Always verify compliance with local employment laws, which may vary by jurisdiction. This system calculates based on US federal standards and can be customized for other regions.

## Performance Characteristics

- **Time Complexity**: O(n) where n = number of salary changes
- **Space Complexity**: O(n) for storing history entries
- **Typical Use**: Sub-millisecond calculations
- **Large Scale**: Handles thousands of employees efficiently

## Future Enhancements

Potential additions:
- Biweekly and monthly pay period support
- Tax calculations and withholding
- Bonus calculations
- Commission handling
- PTO accrual
- Integration with payroll software APIs
- PDF report generation
- Audit trail logging
- Multi-currency support

## Support & Questions

For questions or issues:
1. Check the examples in `payrollExamples.ts`
2. Review unit tests in `payrollCalculations.test.ts`
3. Visit the interactive demo at `/payroll-demo`
4. Review this documentation

## License

[Your License Here]
