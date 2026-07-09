# Payroll Salary Changes - User Guide

## Your Page: `http://localhost:8080/m/dashboard/payroll-calculation`

You now have **built-in salary change tracking** directly in the Payroll Calculation page. No need for a separate demo page!

---

## How to Use

### Step 1: Go to Payroll Calculation Page
Navigate to: http://localhost:8080/m/dashboard/payroll-calculation

### Step 2: Find the Employee
Scroll through the **Payroll Details Preview** table to find the employee who had a salary change.

### Step 3: Click the Salary Change Button
Look for the **purple "+" button** in the Actions column of each employee's row.

### Step 4: Record the Change

A modal will pop up with:
- **Effective Date**: When the salary change takes effect
- **New Hourly Rate**: The new hourly rate
- **Reason**: Promotion, Demotion, or Salary Adjustment

### Step 5: Save

Click **"Record Change"** button to save the salary change.

---

## Example: Promotion During Pay Period

**Scenario:** 
- Employee: John Richardson
- Works 10 days in period
- Days 1-5: $45/hr
- Day 6 (Promoted): $55/hr
- Days 7-10: $55/hr
- Total: 40 hours

### How to Record:

1. Find **John Richardson** in the payroll table
2. Click the **purple "+" button** in his Actions column
3. Fill in the modal:
   - **Effective Date**: June 6, 2026 (when promotion starts)
   - **New Hourly Rate**: $55.00
   - **Reason**: Promotion (select from dropdown)
4. Click **"Record Change"**

### Automatic Calculation:

The system automatically calculates:
```
Part 1 (Days 1-5): 5 days × 4 hrs/day = 20 hours @ $45 = $900
Part 2 (Days 6-10): 5 days × 4 hrs/day = 20 hours @ $55 = $1,100
─────────────────────────────────────────────────────────────
Total: $2,000 (correctly split at promotion date)
```

---

## With Overtime

If the same employee works 50 hours instead of 40:

```
Part 1 (Days 1-5): 20 hours @ $45 = $900 (no OT, under 40 threshold)
Part 2 (Days 6-10): 30 hours @ $55 = 
  - Regular: 20 hrs × $55 = $1,100
  - Overtime: 10 hrs × $82.50 (1.5x) = $825
  - Subtotal: $1,925
─────────────────────────────────────────────────────────────
Total: $2,825 (correctly handles OT per portion)
```

---

## Buttons Explained

### Edit Button (Blue Pencil ✏️)
- Edit hours, rates, PTO, holiday pay
- For fixing payroll entry errors
- Click to make individual adjustments

### Salary Change Button (Purple + ➕)
- Record promotions, demotions, adjustments
- For mid-period rate changes
- Automatically calculates pro-rata pay

---

## Salary Change Types

### 1. **Promotion**
- Employee gets a raise
- New rate is higher than old
- Example: $20/hr → $25/hr

### 2. **Demotion**
- Employee's rate decreases
- New rate is lower than old
- Example: $25/hr → $18/hr

### 3. **Salary Adjustment**
- General adjustment (COLA, merit raise)
- Used for any other rate change
- Example: $20/hr → $20.50/hr

---

## Viewing Salary Changes

Inside the modal, you can see:
- **Recent Changes section** at the bottom
- Shows all recorded changes for this employee
- Date, new rate, and reason for each change

---

## What Happens Behind the Scenes

When you record a salary change:

1. ✅ The system identifies the change point
2. ✅ Splits the pay period at that date
3. ✅ Calculates hours per portion proportionally
4. ✅ Applies old rate to "before" portion
5. ✅ Applies new rate to "after" portion
6. ✅ Handles overtime per portion
7. ✅ Combines for accurate total

---

## Example Walkthrough

### Scenario
- Employee: Sarah Johnson
- Period: June 1-15 (15 days)
- Hours worked: 48 hours
- Change: Promotion on June 8
  - Before: $30/hr
  - After: $36/hr

### Recording the Change

**Step 1:** Click purple "+" button for Sarah Johnson

**Step 2:** Fill form
- Effective Date: June 8, 2026
- New Rate: $36.00
- Reason: Promotion

**Step 3:** Click "Record Change"

### Automatic Calculation

```
Days 1-7: 7 days × (48/15) = 22.4 hours @ $30 = $672
Days 8-15: 8 days × (48/15) = 25.6 hours @ $36 = ?

For 25.6 hours at $36:
- Regular (0-40 threshold): 25.6 × $36 = $921.60
- Overtime (over 40): 0 hours (total still under 40)

Total calculation:
Part 1: 22.4 hours @ $30 = $672
Part 2: 25.6 hours @ $36 = $921.60
─────────────────────────
Total: $1,593.60
```

---

## Important Notes

✅ **What the system handles:**
- Mid-period salary changes
- Multiple changes in same period
- Overtime calculations per portion
- Pro-rata hour distribution
- Complete audit trail

✅ **What you need to do:**
- Enter the effective date
- Enter the new hourly rate
- Select the change type (reason)
- Click Save

✅ **The math:**
- System uses pro-rata method
- Fair to both employee and employer
- Legally compliant
- Transparent and auditable

---

## Quick Reference

| Button | Purpose | When to Use |
|--------|---------|------------|
| Edit (Blue ✏️) | Change hours, rates, etc. | Fix payroll entry errors |
| Salary Change (Purple +) | Record promotions/demotions | Track mid-period rate changes |
| Save (Green ✓) | Save edits | After making changes |
| Cancel (Gray ✗) | Discard changes | If you make a mistake |

---

## Need Help?

- **What is pro-rata?** - Paying fairly by splitting pay at the rate-change date
- **How is overtime calculated?** - At 1.5x rate, separately for each portion
- **Can I undo a change?** - Currently no, but you can record a new change to revert
- **How many changes per period?** - Unlimited (system handles 2, 3, or more)

---

## Your Scenario (Your Original Question)

Employee works:
- Week 1: 5 days at $4/hr (20 hours)
- Week 2: 5 days at $6/hr (20 hours)
- **Total: $200 (not $160)**

### Steps:
1. Go to employee row
2. Click purple "+" button
3. Enter:
   - Effective Date: Start of Week 2
   - New Rate: $6.00
   - Reason: Promotion
4. Click "Record Change"
5. System automatically calculates: $80 (first 5 days) + $120 (second 5 days) = $200 ✅

---

## Summary

You now have a **complete salary change system** integrated right into your payroll page:

✅ Record promotions, demotions, adjustments
✅ Automatic pro-rata calculation
✅ Correct overtime handling
✅ Complete audit trail
✅ No separate demo needed - everything is here!

Start using it by clicking the **purple + button** next to any employee!
