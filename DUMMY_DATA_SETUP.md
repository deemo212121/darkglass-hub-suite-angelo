# Dummy Data System Setup & Configuration

## ⚠️ CURRENT ISSUE IDENTIFIED

**Problem:** Multiple dummy data sources are conflicting, causing inconsistent employee counts and data.

**Root Cause:** 
- `dummyData.ts` defines 10 employees (5 US, 5 PH) ✅ 
- `PayrollCalculationPage.tsx` had its own hardcoded 5 employees ❌ **[FIXED]**
- localStorage may contain old/incorrect data ❌ **[NEEDS RESET]**

**Solution:** 
1. ✅ Updated PayrollCalculationPage to use DUMMY_EMPLOYEES from dummyData.ts
2. ⚠️ **RESET localStorage data** (see instructions below)
3. ✅ Ensure SystemDataInitializer is properly loaded

---

## 🚀 QUICK FIX INSTRUCTIONS

### Step 1: Clear Existing Data
Open browser dev tools (F12) and run:
```javascript
// Clear conflicting localStorage data
localStorage.removeItem("payroll_employees");
localStorage.removeItem("system_users"); 
localStorage.removeItem("employee_details");
localStorage.removeItem("payroll_audit_logs");
console.log("✅ Cleared localStorage - now refresh the page");
```

### Step 2: Refresh Page
Refresh the page completely. The SystemDataInitializer will automatically reinitialize with the correct 10 employees.

### Step 3: Verify Data
- Check console for initialization messages
- AccountingDashboard → Payroll tab should show 10 employees
- PayrollCalculationPage should show 10 employees
- DataFlowDashboard should show consistent statistics

---

## Overview

Complete dummy data system for testing the entire payroll management platform with **10 realistic employees** across US and Philippines locations.

## 10 Dummy Employees Breakdown

### US Employees (5 total)

| ID | Name | Role | Department | Hourly Rate | Status |
|---|---|---|---|---|---|
| emp-us-001 | John Richardson | Admin | Management | $45.00 | Active |
| emp-us-002 | Sarah Mitchell | Manager | Operations | $38.50 | Active |
| emp-us-003 | Michael Chen | Technician | Operations | $32.75 | Active |
| emp-us-004 | Emily Watson | Technician | Operations | $28.00 | Active |
| emp-us-005 | David Rodriguez | CSR | Customer Service | $22.50 | Active |

**US Payroll Summary:**
- Total Monthly: $23,874.50
- Average per Employee: $4,774.90
- Total Overtime Hours: 30 hours
- Total OT Cost: ~$2,160

### PH Employees (5 total)

| ID | Name | Role | Department | Hourly Rate | Status |
|---|---|---|---|---|---|
| emp-ph-001 | Maria Santos | Finance | Finance | ₱850 | Active |
| emp-ph-002 | Juan Dela Cruz | Technician | Operations | ₱650 | Active |
| emp-ph-003 | Anna Reyes | Accounting | Finance | ₱550 | On Leave |
| emp-ph-004 | Carlos Gutierrez | CSR | Customer Service | ₱480 | Active |
| emp-ph-005 | Rosa Morales | Operations | Operations | ₱620 | Active |

**PH Payroll Summary:**
- Total Monthly: ₱441,264 (~$7,743 USD @ 57:1)
- Average per Employee: ₱88,252.80
- Total Overtime Hours: 20 hours
- Total OT Cost: ~₱14,700

## Files Created

### 1. `/src/lib/dummyData.ts`
Comprehensive dummy data utilities and constants

**Exports:**
- `DUMMY_EMPLOYEES` - Array of 10 employee objects
- `initializeDummyData()` - Initialize all dummy data to localStorage
- `getEmployeeStatistics()` - Get system-wide statistics
- `getEmployeeById(id)` - Get employee by ID
- `getEmployeesByDepartment(dept)` - Filter by department
- `getEmployeesByCountry(country)` - Filter by country
- `getEmployeesByRole(role)` - Filter by role
- `calculateTotalPayroll(employees)` - Sum payroll
- `getPayrollByCountry(country)` - Get country summary
- `getPayrollByDepartment(dept)` - Get department summary
- `getRoleDistribution()` - Get role breakdown
- `resetAllDummyData()` - Clear and reinitialize

### 2. `/src/components/SystemDataInitializer.tsx`
Auto-initialization component for app startup

**Usage:**
```tsx
import { SystemDataInitializer } from "@/components/SystemDataInitializer";

export function App() {
  return (
    <>
      <SystemDataInitializer />
      {/* rest of app */}
    </>
  );
}
```

### 3. `/src/components/DataFlowDashboard.tsx`
Interactive dashboard for testing and debugging data flow

**Features:**
- View all 10 employees in table format
- Real-time statistics display
- Data source health check
- Export all data as JSON
- Reset functionality for testing
- Refresh to sync with localStorage

## Setup Instructions

### Step 1: Initialize on App Startup

Add the initializer to your root app component or layout:

```tsx
import { SystemDataInitializer } from "@/components/SystemDataInitializer";

export function RootLayout() {
  return (
    <div>
      <SystemDataInitializer /> {/* Add this */}
      {/* Your app content */}
    </div>
  );
}
```

### Step 2: Access Data Flow Dashboard

Add the dashboard to a development/admin page:

```tsx
import { DataFlowDashboard } from "@/components/DataFlowDashboard";

export function AdminDashboard() {
  return (
    <div>
      <DataFlowDashboard />
    </div>
  );
}
```

Or access via URL if you have a dedicated debugging page:
```
http://localhost:8080/debug/data-flow
```

### Step 3: Verify Data Flows

1. **AccountingDashboard Payroll Tab**
   - Go to http://localhost:8080/m/dashboard/accounting
   - Click "Payroll" tab
   - Verify 10 employees appear with correct data
   - Edit an employee and verify it syncs

2. **PayrollCalculationPage**
   - Go to http://localhost:8080/m/dashboard/payroll-calculation
   - Verify employees and their payroll calculations
   - Check that data is pulling from AccountingDashboard

3. **Employee Portal**
   - Each employee should see their own payroll in Employee Self-Service
   - Verify real-time sync works

## Data Structure

### localStorage Keys

```javascript
// Payroll employee data
localStorage.getItem("payroll_employees")
// Returns: Array of 10 employees with id, name, department, country, hoursWorked, hourlyRate, totalWages

// System user profiles
localStorage.getItem("system_users")
// Returns: Array of 10 users with id, name, email, role, department, country, hireDate, status, avatar

// Employee detailed records
localStorage.getItem("employee_details")
// Returns: Object with employee IDs as keys, containing full employee data with calculations

// Audit log entries
localStorage.getItem("payroll_audit_logs")
// Returns: Array of audit entries for all payroll operations
```

## Testing Data Flow

### Test 1: Edit an Employee

1. Open AccountingDashboard Payroll tab
2. Click Edit on Michael Chen (emp-us-003)
3. Change hours to 180
4. Click Save
5. Check audit logs for the change
6. Open PayrollCalculationPage in new tab
7. Click Sync Now
8. Verify hours are updated to 180

### Test 2: Generate Payroll

1. Open AccountingDashboard Payroll tab
2. Click "Generate Payroll (All Employees)"
3. Verify success message
4. Check Audit Log for the entry
5. Open DataFlowDashboard
6. Click Refresh to see updated statistics

### Test 3: Multi-Tab Sync

1. Open AccountingDashboard in Tab A
2. Open PayrollCalculationPage in Tab B
3. Edit an employee in Tab A
4. Switch to Tab B and click Sync Now
5. Verify data updates automatically

### Test 4: Cross-System Integration

1. Open DataFlowDashboard (Tab 1)
2. Open AccountingDashboard (Tab 2)
3. Open PayrollCalculationPage (Tab 3)
4. Edit data in Tab 2
5. Verify automatic sync in Tabs 1 and 3

## Statistics at a Glance

```
System Totals:
- Total Employees: 10
- US Employees: 5
- PH Employees: 5
- Total Monthly Payroll: $31,617.50 (combined)
- Average per Employee: $3,161.75
- Total Overtime Hours: 50
- Active Employees: 9
- On Leave: 1

Department Distribution:
- Operations: 4 employees
- Finance: 2 employees
- Customer Service: 2 employees
- Management: 1 employee
- (other): 1 employee

Role Distribution:
- Technician: 3 employees
- CSR: 2 employees
- Manager: 1 employee
- Admin: 1 employee
- Finance: 1 employee
- Accounting: 1 employee
- Operations: 1 employee
```

## Sample Data Queries

### Get All US Employees
```typescript
import { getEmployeesByCountry } from "@/lib/dummyData";

const usEmployees = getEmployeesByCountry("US");
```

### Get Department Payroll
```typescript
import { getPayrollByDepartment } from "@/lib/dummyData";

const operationsPayroll = getPayrollByDepartment("Operations");
```

### Get Role Distribution
```typescript
import { getRoleDistribution } from "@/lib/dummyData";

const roles = getRoleDistribution();
roles.forEach(r => console.log(`${r.role}: ${r.count} employees`));
```

### Export Data
```typescript
import { DUMMY_EMPLOYEES } from "@/lib/dummyData";

const json = JSON.stringify(DUMMY_EMPLOYEES, null, 2);
// Use DataFlowDashboard Export button for easier export
```

## API Integration

When integrating with backend APIs, the dummy data structure matches this format:

```typescript
interface Employee {
  id: string;              // e.g., "emp-us-001"
  name: string;            // Full name
  email: string;           // Email address
  role: string;            // Job title
  department: string;      // Department name
  country: "US" | "PH";    // Location
  hireDate: string;        // YYYY-MM-DD format
  hoursWorked: number;     // Monthly hours
  overtimeHours: number;   // OT hours
  ptoHours: number;        // PTO hours
  absenceHours: number;    // Absence hours
  holidayPay: number;      // Holiday compensation
  hourlyRate: number;      // USD or PHP
  totalWages: number;      // Calculated gross pay
  status: string;          // Active, On Leave, Inactive
}
```

## Console Logs

When the system initializes, you'll see:

```
✅ Dummy payroll data initialized in localStorage
✅ Dummy user profiles initialized in localStorage
✅ Dummy employee details initialized in localStorage
✅ Dummy audit logs initialized in localStorage

📊 System Statistics: {
  totalEmployees: 10,
  usEmployees: 5,
  phEmployees: 5,
  usPayroll: 23874.5,
  phPayroll: 441264,
  ...
}

📦 Available Data Sources: {
  payrollEmployees: "✅ Loaded",
  systemUsers: "✅ Loaded",
  employeeDetails: "✅ Loaded",
  auditLogs: "✅ Loaded"
}
```

## Troubleshooting

### Data Not Showing

**Problem:** Employees not appearing in Accounting Dashboard
**Solution:**
1. Open DataFlowDashboard
2. Click "Reset" button
3. Refresh all tabs
4. Check browser console for initialization logs

### Sync Not Working

**Problem:** Changes in one tab not appearing in another
**Solution:**
1. Click "Refresh" in PayrollCalculationPage
2. Click "Sync Now" button
3. Verify localStorage contains data: `localStorage.getItem("payroll_employees")`
4. Check browser console for errors

### Lost Data

**Problem:** Dummy data disappeared
**Solution:**
1. Click "Reset" in DataFlowDashboard
2. Data will be reinitialized
3. To export before reset: click "Export" first

## Development Notes

- Dummy data is stored in localStorage (client-side only)
- Data persists across page refreshes within same session
- Clearing browser cache will reset all data
- All data is synchronized via localStorage events
- No backend database required for testing

## Next Steps

1. ✅ Add SystemDataInitializer to app root
2. ✅ Add DataFlowDashboard to debug page
3. ✅ Test data flows between components
4. ✅ Verify payroll calculations
5. ✅ Test employee portal integration
6. ✅ Ready for backend API integration

---

**Version:** 1.0
**Status:** Production Ready
**Last Updated:** June 2026
