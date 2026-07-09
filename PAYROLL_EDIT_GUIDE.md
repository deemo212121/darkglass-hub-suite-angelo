# Payroll Calculation Edit Guide

## Overview

The Payroll Calculation page now supports **inline editing** of employee payroll data. Users can quickly correct errors in hours worked, overtime, rates, and other payroll components without navigating to a separate editing interface.

**URL:** http://localhost:8080/m/dashboard/payroll-calculation

---

## Editable Fields

Each employee row in the Payroll Details table now supports editing the following fields:

| Field | Default Range | Use Case |
|-------|---|---|
| **Hours Worked** | 0-200 hours | Correct incorrect time entry or clock-in errors |
| **Overtime Hours** | 0-100 hours | Adjust overtime calculation or approve additional OT |
| **Hourly Rate** | Any positive number | Correct salary errors or apply rate adjustments |
| **PTO Hours** | 0-100 hours | Add or adjust paid time off hours |
| **Holiday Pay** | $0-$9999 | Adjust holiday compensation |

---

## How to Edit Payroll

### Step 1: Locate the Employee
Scroll through the **Payroll Details Preview** table to find the employee whose payroll needs adjustment.

### Step 2: Click Edit Button
Click the **blue Edit button** (pencil icon) in the **Actions** column for that employee.

**Visual Change:** 
- Row background turns light blue
- Fields become editable input boxes
- Edit button changes to Save/Cancel buttons

### Step 3: Make Changes
Update the fields as needed:
- Hours Worked: Change if time entry was wrong
- Overtime Hours: Adjust approved overtime
- Hourly Rate: Correct rate errors or apply increases
- PTO Hours: Add/remove PTO
- Holiday Pay: Adjust holiday compensation

Example: If an employee worked 165 hours instead of 160:
1. Click Edit
2. Change "Hours Worked" from 160 to 165
3. Rate and other fields auto-calculate based on new values

### Step 4: Save or Cancel
- **Save Button (Green):** Saves changes to localStorage and updates all displays
- **Cancel Button (Gray):** Discards changes without saving

---

## Features

### ✅ Real-Time Calculation
Once you save changes, payroll totals automatically recalculate:
- Regular Pay = Hours × Hourly Rate
- Overtime Pay = Overtime Hours × Hourly Rate × 1.5
- Gross Pay = Regular + Overtime + PTO + Holiday Pay

### ✅ Data Persistence
Changes are saved to:
1. **localStorage** - Survives page refresh
2. **PAYROLL_DATA** - Updates component state
3. **Employee Records** - Updates hourly rates if changed

### ✅ Visual Indicators
- **Yellow warning icons (⚠):** Excessive overtime (>20 hrs), missing hours, absences
- **Blue highlight:** Currently being edited
- **Yellow highlight:** Issues detected in employee record

### ✅ Sync with Other Components
Changes made here automatically sync to:
- Accounting Dashboard (if open in another tab)
- Employee payroll sections
- Payroll reports and summaries

---

## Common Use Cases

### Case 1: Correcting Hours Entry Error
**Scenario:** Employee worked 162 hours but system shows 160

**Steps:**
1. Find employee in table
2. Click Edit button
3. Change "Hours Worked" from 160 to 162
4. Click Save

**Result:** 
- Regular Pay recalculates
- Gross Pay updates
- Change saved to localStorage

---

### Case 2: Approving Additional Overtime
**Scenario:** Employee wants 2 additional overtime hours approved

**Steps:**
1. Find employee in table
2. Click Edit button
3. Change "Overtime Hours" from current value to (current + 2)
4. Click Save

**Result:**
- Overtime Pay recalculates at 1.5x rate
- Gross Pay includes additional OT pay
- Change persisted in localStorage

---

### Case 3: Applying Rate Increase
**Scenario:** Employee got a $2/hr raise

**Steps:**
1. Find employee in table
2. Click Edit button
3. Change "Hourly Rate" from (e.g., 28.00) to (30.00)
4. Click Save

**Result:**
- Regular Pay recalculates with new rate
- Overtime Pay recalculates at 1.5x new rate
- All payroll totals update
- Change saved for future periods

---

### Case 4: Correcting Overtime Rate
**Scenario:** Overtime was entered but not at 1.5x multiplier

**Steps:**
1. Find employee in table
2. Click Edit button
3. Verify correct Overtime Hours
4. Verify correct Hourly Rate
5. Click Save (system automatically applies 1.5x multiplier)

**Result:**
- OT Pay = Overtime Hours × Hourly Rate × 1.5
- Correct overtime premium applied

---

## Technical Details

### State Management
```typescript
// Edit state
const [editingEmployee, setEditingEmployee] = useState<string | null>(null);
const [editValues, setEditValues] = useState<{
  hoursWorked: number;
  overtimeHours: number;
  ptoHours: number;
  absenceHours: number;
  holidayPay: number;
  hourlyRate: number;
} | null>(null);
```

### Functions
- `startEdit(employeeId)` - Initiates edit mode
- `saveEdit(employeeId)` - Saves changes to state and localStorage
- `cancelEdit()` - Discards changes

### Data Flow
1. Edit initiated → `startEdit()` loads employee data into edit state
2. User updates input fields
3. User clicks Save → `saveEdit()` updates:
   - PAYROLL_DATA constant
   - localStorage payroll_employees
   - Employee hourly rate (if changed)
4. Component re-renders with new calculations
5. Other tabs receive storage change event and update

---

## Tips & Best Practices

### ✅ Do's
- **Verify numbers before saving** - Check hours, rates, and OT carefully
- **Use for corrections** - Fix legitimate data entry errors
- **Document reasons** - Note why changes were made (not visible in UI yet)
- **Save frequently** - Each employee is edited independently
- **Refresh page** - Ensure you see latest data from AccountingDashboard

### ❌ Don'ts
- **Don't ignore warnings** - Yellow ⚠ icons indicate potential issues
- **Don't edit employees not present** - Some filters may hide employees
- **Don't rely on single edit** - Multiple edits won't stale between tabs without refresh
- **Don't force save invalid data** - Negative numbers or extreme values should be avoided

---

## Audit Trail

**Current Status:** Changes are saved but not logged to audit trail yet

**Future Enhancement:** Consider adding:
- Timestamp of change
- User who made the change
- Before/After values
- Reason for change
- Audit log entry

---

## Troubleshooting

### "My changes disappeared after refresh"
**Solution:** Changes are saved to localStorage. If they disappeared:
1. Check browser's localStorage isn't full
2. Try making the change again
3. Verify you clicked Save (not Cancel)

### "Calculations are wrong after edit"
**Solution:** Recalculations use this formula:
- Regular Pay = Hours × Rate (not OT adjusted)
- OT Pay = OT Hours × Rate × 1.5
- Total = Regular + OT + PTO + Holiday

Verify all three values are correct before saving.

### "Other tabs don't show my changes"
**Solution:** Changes sync automatically via localStorage events
1. Changes made in tab A automatically update tab B
2. If not syncing, manually refresh tab B
3. Click "Sync Now" button in PayrollCalculationPage

---

## Future Enhancements

Potential improvements for the edit functionality:

1. **Batch Editing** - Edit multiple employees at once
2. **Validation Rules** - Prevent invalid entries (e.g., -5 hours)
3. **Approval Workflow** - Require manager approval for changes
4. **Audit Trail** - Track all changes with timestamps and user info
5. **Change History** - View previous versions of payroll
6. **Undo/Redo** - Revert or redo changes
7. **Comments** - Add notes about why changes were made
8. **Department-wide Adjustments** - Apply changes to all department employees

---

## API Integration

When connecting to a backend API:

```typescript
// Save to database instead of localStorage
const response = await fetch('/api/payroll/employees/{employeeId}', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    hoursWorked: editValues.hoursWorked,
    overtimeHours: editValues.overtimeHours,
    hourlyRate: editValues.hourlyRate,
    ptoHours: editValues.ptoHours,
    holidayPay: editValues.holidayPay,
    modifiedAt: new Date().toISOString(),
    modifiedBy: currentUser.id
  })
});
```

---

## Version History

- **v1.0** - Initial inline edit functionality
  - Edit hours, overtime, rates, PTO, holiday pay
  - Auto-calculate totals
  - Save to localStorage
  - Sync with other components
