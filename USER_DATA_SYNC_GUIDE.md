# User Data Synchronization System

## Overview

The User Data Synchronization System automatically creates and maintains personalized data for all 10 employee accounts across all modules in the Admin Hub Solutions platform. This allows comprehensive testing of data flow between modules.

## Features

✅ **Automatic Data Generation** - Personalized data for each employee on login
✅ **Cross-Module Sync** - Data consistency across Timecards, Payroll, Attendance, Payslips
✅ **Role-Based Access** - Each employee sees only their own data
✅ **Real-Time Updates** - Changes in one module reflect in others
✅ **Data Integrity Checks** - Verify data consistency across all modules

## Employee Accounts

### US Employees (5)

| Name | Email | Role | Department | Rate |
|------|-------|------|------------|------|
| John Richardson | john.richardson@ahsolutions.com | Admin | Management | $45.00/hr |
| Sarah Mitchell | sarah.mitchell@ahsolutions.com | Manager | Operations | $38.50/hr |
| Michael Chen | michael.chen@ahsolutions.com | Technician | Operations | $32.75/hr |
| Emily Watson | emily.watson@ahsolutions.com | Technician | Operations | $28.00/hr |
| David Rodriguez | david.rodriguez@ahsolutions.com | CSR | Customer Service | $22.50/hr |

### Philippines Employees (5)

| Name | Email | Role | Department | Rate |
|------|-------|------|------------|------|
| Maria Santos | maria.santos@ahsolutions.com.ph | Finance | Finance | ₱850/hr |
| Juan Dela Cruz | juan.delacruz@ahsolutions.com.ph | Technician | Operations | ₱650/hr |
| Anna Reyes | anna.reyes@ahsolutions.com.ph | Accounting | Finance | ₱550/hr |
| Carlos Gutierrez | carlos.gutierrez@ahsolutions.com.ph | CSR | Customer Service | ₱480/hr |
| Rosa Morales | rosa.morales@ahsolutions.com.ph | Operations | Operations | ₱620/hr |

## Login Credentials

All accounts use the same password: **(your standard test password)**

Simply use any of the emails above to log in.

## Data Generated Per User

### 1. **Timecards** (20 records)
- Complete timecard entries for June 2026 (weekdays only)
- Personalized check-in/out times based on role
- Meal break times
- Working hours calculations
- Stored in: `localStorage.timecards_{employeeId}`

### 2. **Attendance** (20 records)
- Daily attendance status (Present, Absent, Late, PTO)
- Hours worked per day
- Overtime hours
- Notes for late arrivals
- Stored in: `localStorage.attendance_{employeeId}`

### 3. **Payslips** (2 records)
- Two pay periods: June 1-15 and June 16-30
- Detailed breakdown:
  - Regular pay, overtime pay, PTO pay
  - Federal tax, social security, medicare
  - Gross pay and net pay
- Currency based on country (USD/PHP)
- Stored in: `localStorage.payslips_{employeeId}`

### 4. **User Profile**
- Personal information
- Role and department
- Hire date and status
- Avatar
- Stored in: `localStorage.user_profile_{employeeId}`

### 5. **Announcements**
- Shared announcement thread
- User-specific read status
- Payroll processing notifications
- Stored in: `localStorage.ahs:team-messenger:v1` (shared)
- Read status: `localStorage.announcement_read_{employeeId}` (per user)

## How It Works

### Automatic Initialization

```typescript
// On login or app start
initializeUserData(email);
```

This function:
1. Maps email to employee ID
2. Checks if data already exists for this employee
3. Generates missing data automatically
4. Stores everything in localStorage with employee-specific keys

### Data Access Functions

```typescript
// Get current user's timecards
const timecards = getUserTimecards(email);

// Get current user's attendance
const attendance = getUserAttendance(email);

// Get current user's payslips
const payslips = getUserPayslips(email);

// Get employee info from email
const employee = getEmployeeFromEmail(email);
```

### Data Integrity Verification

```typescript
const integrity = verifyDataIntegrity(email);
// Returns:
// {
//   timecards: boolean,
//   attendance: boolean,
//   payslips: boolean,
//   profile: boolean,
//   issues: string[]
// }
```

## Testing Data Flow Between Modules

### Scenario 1: Timecard → Payroll Flow

1. **Log in as**: john.richardson@ahsolutions.com
2. **Go to**: Timecard Module
3. **Verify**: 20 timecard entries for June 2026
4. **Navigate to**: Payroll Calculation Module
5. **Verify**: Hours from timecards appear in payroll table
6. **Check**: Gross pay matches timecard hours × rate

### Scenario 2: Payroll → Employee Self-Service

1. **Log in as admin** (any admin account)
2. **Go to**: Payroll Calculation
3. **Select period**: June 1-15
4. **Click**: "Process Payroll"
5. **Verify**: Announcement created for all employees
6. **Log out and log in as**: sarah.mitchell@ahsolutions.com
7. **Check**: Announcement banner appears
8. **Click**: "View announcements"
9. **Verify**: Payslip link is present
10. **Navigate to**: Employee Self-Service Portal
11. **Verify**: Payslip data matches processed payroll

### Scenario 3: Attendance → Payroll

1. **Log in as**: michael.chen@ahsolutions.com
2. **Go to**: Attendance Module
3. **Verify**: 20 attendance records
4. **Count**: Present days vs. PTO days
5. **Navigate to**: Employee Self-Service → Payslips
6. **Verify**: PTO hours in payslip match attendance records

### Scenario 4: Multi-User Testing

1. **Open multiple browser tabs/windows**
2. **Log in as different employees in each**
3. **Verify**: Each user sees only their own data
4. **Process payroll** in one tab
5. **Refresh** other tabs
6. **Verify**: Each employee receives their own announcement

## Data Sync Dashboard

Access the Data Sync Dashboard component to:
- View current employee information
- Check data integrity across modules
- See record counts for each data type
- Refresh or clear all user data
- View testing instructions

Usage:
```tsx
import { DataSyncDashboard } from "@/components/DataSyncDashboard";

<DataSyncDashboard />
```

## Utility Functions

### Clear All User Data
```typescript
import { clearAllUserData } from "@/lib/userDataSync";

clearAllUserData();
// Clears data for all 10 employees
// Useful for resetting test environment
```

### Re-initialize User Data
```typescript
import { initializeUserData } from "@/lib/userDataSync";

initializeUserData("sarah.mitchell@ahsolutions.com");
// Regenerates data if missing
```

## Data Structure

### Timecard Record
```typescript
{
  date: "06/15/2026",
  checkIn: "08:00",
  mealStart: "12:00",
  mealEnd: "13:00",
  checkOut: "17:00",
  working: "8:00:00",
  rate: 38.50,
  status: "approved",
  notes: ""
}
```

### Attendance Record
```typescript
{
  date: "2026-06-15",
  status: "present" | "absent" | "late" | "pto",
  hoursWorked: 8,
  overtimeHours: 0,
  notes: ""
}
```

### Payslip Record
```typescript
{
  employeeId: "emp-us-002",
  employeeName: "Sarah Mitchell",
  periodStart: "2026-06-01",
  periodEnd: "2026-06-15",
  hoursWorked: 160,
  hourlyRate: 38.50,
  regularPay: 6160.00,
  overtimePay: 462.00,
  ptoPay: 0,
  grossPay: 6622.00,
  federalTax: 1456.84,
  socialSecurity: 410.56,
  medicare: 96.02,
  totalDeductions: 1963.42,
  netPay: 4658.58,
  currency: "USD",
  status: "processed"
}
```

## Troubleshooting

### Issue: No data appears for logged-in user
**Solution**: 
1. Open browser console
2. Run: `initializeUserData("user@email.com")`
3. Refresh page

### Issue: Data seems incorrect or outdated
**Solution**:
1. Use Data Sync Dashboard
2. Click "Refresh" button
3. Or manually clear: `clearAllUserData()` then re-login

### Issue: User can see other users' data
**Solution**:
- Check localStorage keys - they should be employee-specific
- Verify authentication system is working correctly
- Ensure modules are using `getUserTimecards(email)` not raw localStorage access

### Issue: Announcements not appearing
**Solution**:
1. Verify payroll was processed
2. Check: `localStorage.getItem('ahs:team-messenger:v1')`
3. Look for messages with sender "Payroll System"

## Best Practices

1. **Always use the provided helper functions** instead of direct localStorage access
2. **Test with multiple accounts** to verify data isolation
3. **Clear data between major testing sessions** to ensure clean state
4. **Verify data integrity** after making changes to data generation logic
5. **Check console logs** - data initialization logs helpful messages

## Future Enhancements

- [ ] Add more historical payroll periods
- [ ] Include leave request data
- [ ] Add performance review data
- [ ] Include benefits enrollment data
- [ ] Add expense reports
- [ ] Include training/certification records

## Support

For issues or questions about the User Data Sync System, check:
1. Browser console for initialization messages
2. Data Sync Dashboard for integrity status
3. This guide for testing procedures

---

**Last Updated**: June 2026
**System Version**: 3.0
**Dummy Employees**: 10 (5 US, 5 PH)
