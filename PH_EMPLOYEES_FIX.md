# PH Employees Display Fix

## Problem
The "PH Employees Payroll Details" section showed **0 employees** even though PH employee data was properly initialized in localStorage.

## Root Cause
A type mismatch bug in the AccountingDashboard component:

```typescript
// WRONG - This comparison always failed
employees.filter(emp => emp.country === selectedCurrency)

// Why it failed:
// - emp.country = "US" or "PH" (string literal)
// - selectedCurrency = "USD" or "PHP" (state value)
// - "PH" !== "PHP" and "US" !== "USD"
```

## Solution
Fixed the comparison to map currency codes to country codes:

```typescript
// CORRECT - Now maps USD↔US and PHP↔PH
employees.filter(emp => emp.country === (selectedCurrency === "USD" ? "US" : "PH"))
```

## Changes Made

### 1. AccountingDashboard.tsx
**Line 575** - Fixed employee count display
```diff
- {employees.filter(emp => emp.country === selectedCurrency).length} employees
+ {employees.filter(emp => emp.country === (selectedCurrency === "USD" ? "US" : "PH")).length} employees
```

**Line 591** - Fixed employee table filtering
```diff
- .filter(emp => emp.country === selectedCurrency)
+ .filter(emp => emp.country === (selectedCurrency === "USD" ? "US" : "PH"))
```

**Line 1** - Added import for initializeDummyData (for future use)
```diff
- import { DUMMY_EMPLOYEES } from "@/lib/dummyData";
+ import { DUMMY_EMPLOYEES, initializeDummyData } from "@/lib/dummyData";
```

**Removed unused code** - Deleted MOCK_EMPLOYEES constant (lines 68-92)
- This constant was never used and was cluttering the code
- AccountingDashboard now uses only DUMMY_EMPLOYEES from dummyData.ts

## Result
✅ **PH Employees now display correctly!**

When you click the "PHP" button in Accounting Dashboard → Payroll tab:
- Employee count shows the correct number of PH employees (5 from DUMMY_EMPLOYEES)
- PH employees table displays all employees from Philippines
- All payroll data (hours, rates, wages) display correctly with ₱ currency

## Testing
1. Go to http://localhost:8080/m/dashboard/accounting-dashboard
2. Click "Payroll" tab
3. Click "PHP" button
4. Verify PH employees appear in the table
5. Check that the employee count matches the table rows
6. Verify wages display with ₱ currency symbol

## Data Structure
The system now uses unified dummy data:

**US Employees (5):**
- John Richardson, Sarah Mitchell, Michael Chen, Emily Watson, David Rodriguez

**PH Employees (5):**
- Maria Santos, Juan Dela Cruz, Anna Reyes, Carlos Gutierrez, Rosa Morales

Total: 10 employees consistently across all components
