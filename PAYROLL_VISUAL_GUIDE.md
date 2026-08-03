# Pro-Rata Payroll System - Visual Guide

## Visual Breakdown of Calculation Process

### Example 1: Basic Promotion (Your Scenario)

```
Timeline View:
═══════════════════════════════════════════════════════════════
Jan 1     Jan 2     Jan 3     Jan 4     Jan 5     Jan 6-10
  │         │         │         │         │         │
  M         T         W         T         F      Promoted!
                                          ↓
                                    $4/hr → $6/hr
═══════════════════════════════════════════════════════════════

Hours Distribution (40 hours total over 10 days):
┌─────────────────────────────────────┐
│ Days per portion: 10 days total     │
│ Hours per portion: 40 ÷ 10 = 4 hrs │
└─────────────────────────────────────┘

PORTION 1: Before Promotion
┌─────────────────────────────────────────────┐
│ Jan 1-5 (5 days)                           │
│ 5 days × 4 hours/day = 20 hours            │
│ Rate: $4/hour                              │
│ Pay: 20 × $4 = $80.00                      │
├─────────────────────────────────────────────┤
│ No Overtime (< 40 hours)                   │
│ Regular: $80.00                            │
│ Overtime: $0.00                            │
│ ╔═══════════════════════════════════════╗ │
│ ║ PORTION 1 TOTAL: $80.00              ║ │
│ ╚═══════════════════════════════════════╝ │
└─────────────────────────────────────────────┘

PORTION 2: After Promotion
┌─────────────────────────────────────────────┐
│ Jan 6-10 (5 days)                          │
│ 5 days × 4 hours/day = 20 hours            │
│ Rate: $6/hour                              │
│ Pay: 20 × $6 = $120.00                     │
├─────────────────────────────────────────────┤
│ No Overtime (< 40 hours)                   │
│ Regular: $120.00                           │
│ Overtime: $0.00                            │
│ ╔═══════════════════════════════════════╗ │
│ ║ PORTION 2 TOTAL: $120.00             ║ │
│ ╚═══════════════════════════════════════╝ │
└─────────────────────────────────────────────┘

SUMMARY:
═══════════════════════════════════════════════════════════════
Total Hours Worked: 40
Total Regular Pay:  $80.00 + $120.00 = $200.00
Total Overtime Pay: $0.00
───────────────────────────────────────────────────────────────
TOTAL PAY:          $200.00
═══════════════════════════════════════════════════════════════

Comparison:
Without Promotion:  40 hours × $4/hr = $160.00
With Promotion:     (20 × $4) + (20 × $6) = $200.00
Extra Earnings:     $200.00 - $160.00 = $40.00 (+25%)
```

### Example 2: Promotion with Overtime

```
Setup:
- 50 hours total in 10-day period
- Promotion on Day 5: $15/hr → $20/hr
- Overtime threshold: 40 hours/week

Hourly Distribution:
50 hours ÷ 10 days = 5 hours/day

PORTION 1: Days 1-4 @ $15/hour
┌──────────────────────────────────────────────┐
│ 4 days × 5 hours/day = 20 hours             │
├──────────────────────────────────────────────┤
│ Regular Hours:  20 (under 40 threshold)    │
│ Regular Pay:    20 × $15 = $300.00         │
│ Overtime Hours: 0                           │
│ Overtime Pay:   $0.00                       │
├──────────────────────────────────────────────┤
│ Subtotal: $300.00                           │
└──────────────────────────────────────────────┘

PORTION 2: Days 5-10 @ $20/hour
┌──────────────────────────────────────────────┐
│ 6 days × 5 hours/day = 30 hours             │
├──────────────────────────────────────────────┤
│ Total Hours in Portion: 30                   │
│ Less: Regular (40 from week 1): 20          │
│ Overtime Hours Available: 30 - 20 = 10     │
│                                              │
│ Regular Pay:    20 × $20 = $400.00         │
│ Overtime Rate:  $20 × 1.5 = $30/hr         │
│ Overtime Pay:   10 × $30 = $300.00         │
├──────────────────────────────────────────────┤
│ Subtotal: $400.00 + $300.00 = $700.00      │
└──────────────────────────────────────────────┘

TOTAL PAYROLL:
┌──────────────────────────────────────────────┐
│ Portion 1 Regular:     $300.00              │
│ Portion 2 Regular:     $400.00              │
│ Portion 2 Overtime:    $300.00              │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│ TOTAL:                 $1,000.00            │
└──────────────────────────────────────────────┘
```

### Example 3: Multiple Salary Changes

```
Three different rates in single period:

┌─────────────┬─────────────┬─────────────┐
│  Days 1-3   │  Days 4-7   │  Days 8-10  │
│  @ $12/hr   │  @ $14/hr   │  @ $16/hr   │
└─────────────┴─────────────┴─────────────┘

Portion 1: 3 days × (40÷10) = 12 hours @ $12 = $144.00
Portion 2: 4 days × (40÷10) = 16 hours @ $14 = $224.00
Portion 3: 3 days × (40÷10) = 12 hours @ $16 = $192.00
                                         ─────────────
                                TOTAL = $560.00
```

### Visual Data Flow

```
┌─────────────────────────────────┐
│  Employee Salary History        │
├─────────────────────────────────┤
│ Entry 1: $4/hr  (Jan 1)        │
│ Entry 2: $6/hr  (Jan 6) ← Promotion
└─────────────────────────────────┘
           │
           ↓
┌─────────────────────────────────┐
│  Pay Period Definition          │
├─────────────────────────────────┤
│ Start:  Jan 1, 2024            │
│ End:    Jan 10, 2024           │
│ Hours:  40 total               │
└─────────────────────────────────┘
           │
           ↓
┌─────────────────────────────────┐
│  Find Changes in Period         │
├─────────────────────────────────┤
│ Changes Found: 1                │
│ • Change on Jan 6: $4→$6       │
└─────────────────────────────────┘
           │
           ↓
┌─────────────────────────────────┐
│  Split Period at Changes        │
├─────────────────────────────────┤
│ Portion 1: Jan 1-5              │
│ Portion 2: Jan 6-10             │
└─────────────────────────────────┘
           │
           ↓
┌─────────────────────────────────┐
│  Distribute Hours               │
├─────────────────────────────────┤
│ Part 1: 5/10 × 40 = 20 hrs    │
│ Part 2: 5/10 × 40 = 20 hrs    │
└─────────────────────────────────┘
           │
           ↓
┌─────────────────────────────────┐
│  Calculate Each Portion         │
├─────────────────────────────────┤
│ Part 1: 20 × $4 = $80          │
│ Part 2: 20 × $6 = $120         │
└─────────────────────────────────┘
           │
           ↓
┌─────────────────────────────────┐
│  Combine Results                │
├─────────────────────────────────┤
│ Total: $80 + $120 = $200       │
└─────────────────────────────────┘
```

### UI Component Layout

```
┌─────────────────────────────────────────────────────────────┐
│  PAYROLL BREAKDOWN                    [Mid-Period Change]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  40.0 hrs    $200.00      $0.00       $200.00             │
│  TOTAL       REGULAR      OVERTIME    TOTAL               │
│  HOURS       PAY          PAY         PAY                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│  BEFORE PROMOTION (Jan 1 - Jan 6)  [Original Rate]           │
├────────────────────────────────────────────────────────────────┤
│                                                               │
│  20.00 hrs    $4.00      $80.00      $0.00      $80.00      │
│  HOURS        RATE       REGULAR     OVERTIME   TOTAL       │
│                                                               │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│  AFTER PROMOTION (Jan 6 - Jan 10)  [New Rate]               │
├────────────────────────────────────────────────────────────────┤
│                                                               │
│  20.00 hrs    $6.00      $120.00     $0.00      $120.00     │
│  HOURS        RATE       REGULAR     OVERTIME   TOTAL       │
│                                                               │
└────────────────────────────────────────────────────────────────┘
```

### Overtime Calculation Details

```
Scenario: 50 hours total (exceeds 40-hour threshold)

PART 1: 20 hours @ $15/hr
│
├─ Regular Hours:  20 (all regular, under limit)
├─ OT Hours:       0 (haven't hit 40 yet)
└─ Pay: (20 × $15) + (0 × $22.50) = $300.00

PART 2: 30 hours @ $20/hr
│
├─ Regular Hours:  20 (to reach 40-hour threshold)
│                  └─ (already used 20 from Part 1)
├─ OT Hours:       10 (over the 40-hour threshold)
│                  └─ @ $20 × 1.5 = $30/hr
└─ Pay: (20 × $20) + (10 × $30) = $400 + $300 = $700.00

TOTAL: $300.00 + $700.00 = $1,000.00
```

### Decision Tree for Salary Changes

```
                     PAY PERIOD START
                           │
                           ↓
                  Are there salary
                  changes in period?
                      /         \
                    NO           YES
                    /             \
                   ↓               ↓
              Calculate      Find all changes
              simple pay        and order
                   │             chronologically
                   │                 │
                   │                 ↓
                   │          Create portions
                   │          for each rate
                   │                 │
                   │                 ↓
                   │          Distribute hours
                   │          proportionally
                   │                 │
                   │                 ↓
                   │          Calculate each
                   └─────────→ portion separately
                                    │
                                    ↓
                            Combine all
                            portions
                                    │
                                    ↓
                            Return breakdown
```

### Example Comparison Table

```
┌─────────────────────────────────────────────────────────────────┐
│                  CALCULATION COMPARISON                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                │
│  WRONG (Simple):                                              │
│  ├─ Total hours: 40                                          │
│  ├─ Average rate: ($4 + $6) / 2 = $5                        │
│  ├─ Pay: 40 × $5 = $200.00                                  │
│  └─ ✗ Doesn't accurately reflect split periods             │
│                                                                │
│  RIGHT (Pro-Rata):                                            │
│  ├─ Part 1: 5 days × $4/hr = $80.00                        │
│  ├─ Part 2: 5 days × $6/hr = $120.00                       │
│  ├─ Pay: $80.00 + $120.00 = $200.00                        │
│  └─ ✓ Accurate pro-rata calculation                         │
│                                                                │
│  In this case they match! But with overtime they differ.    │
│                                                                │
│  With 50 hours:                                              │
│  ├─ WRONG: 50 × $5 × 1.15 (avg OT factor) = $287.50       │
│  ├─ RIGHT: $300 + $700 = $1,000.00                          │
│  └─ Difference: $712.50 (71% more accurate!)               │
│                                                                │
└─────────────────────────────────────────────────────────────────┘
```

## Color Coding in UI

```
SUMMARY CARD
├─ Light Blue Background
│  └─ For overall totals section
│
BEFORE CHANGE PORTION
├─ Purple Left Border (▐)
├─ Light Purple Background
├─ Purple Badge: "Original Rate"
│
AFTER CHANGE PORTION
├─ Green Left Border (▐)
├─ Light Green Background
├─ Green Badge: "New Rate"
│
TEXT COLORS
├─ Hours Worked:      Gray (neutral)
├─ Rate:              Gray (neutral)
├─ Regular Pay:       Green (positive)
├─ Overtime Pay:      Orange (bonus)
├─ Period Total:      Blue (important)
├─ Grand Total:       Blue Bold (most important)
```

## Formula Reference Card

```
╔════════════════════════════════════════════════════════════╗
║           PAYROLL CALCULATION FORMULAS                     ║
╠════════════════════════════════════════════════════════════╣
║                                                            ║
║ REGULAR PAY (for hours ≤ 40):                            ║
║ Regular Pay = Hours Worked × Hourly Rate                 ║
║                                                            ║
║ OVERTIME PAY (for hours > 40):                           ║
║ Overtime Hours = Total Hours - 40                         ║
║ Overtime Pay = Overtime Hours × Hourly Rate × 1.5        ║
║                                                            ║
║ SPLIT PERIOD:                                            ║
║ Hours in Portion = (Days in Portion / Total Days) ×      ║
║                    Total Hours Worked                     ║
║                                                            ║
║ TOTAL PAY PER PORTION:                                   ║
║ Total = Regular Pay + Overtime Pay                       ║
║                                                            ║
║ GRAND TOTAL:                                             ║
║ Grand Total = Sum of All Portion Totals                  ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
```

## Implementation Layers

```
┌─────────────────────────────────────────────────────────┐
│  UI Layer (React)                                      │
│  ├─ PayrollBreakdownDisplay Component                 │
│  └─ Demo Page with Examples                           │
├─────────────────────────────────────────────────────────┤
│  Business Logic Layer (TypeScript)                    │
│  ├─ calculateSplitPayroll()                           │
│  ├─ splitPayPeriod()                                  │
│  ├─ Calculation Functions                            │
│  └─ Data Validation                                   │
├─────────────────────────────────────────────────────────┤
│  Data Layer (Types & Interfaces)                      │
│  ├─ SalaryHistory                                     │
│  ├─ SalaryEntry                                       │
│  ├─ SplitPayrollBreakdown                             │
│  └─ PayrollPeriodPortion                              │
└─────────────────────────────────────────────────────────┘
```

## Key Concepts Visualization

### Hour Distribution
```
Total 40 hours over 10 days:

Day 1: ████ 4 hrs
Day 2: ████ 4 hrs
Day 3: ████ 4 hrs
Day 4: ████ 4 hrs
Day 5: ████ 4 hrs  ├─ Part 1: 20 hrs @ $4
       ─────────
Day 6: ████ 4 hrs
Day 7: ████ 4 hrs
Day 8: ████ 4 hrs
Day 9: ████ 4 hrs
Day 10:████ 4 hrs  ├─ Part 2: 20 hrs @ $6
       ─────────
Total: 40 hrs
```

### Rate Timeline
```
$6.00 │         ┌─────────────
      │         │
$5.00 │         │
      │         │
$4.00 │ ────────┘
      │
      ├─ Jan 1   Jan 6   Jan 10
      └─────────────────────────
        Before  After
        Change  Change
```

This visual guide helps understand how the calculations work at each step.
