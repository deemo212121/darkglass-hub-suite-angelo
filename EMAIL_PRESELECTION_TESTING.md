# Email Preselection Testing Guide

## Overview

All 10 employee email addresses are now preloaded in the login form dropdown for easy testing. This guide shows how to verify that email preselection is working correctly and that user-specific data loads for each account.

## Login Email Preselection

### What's Available

The login form now shows **19 preselected email options** organized in three groups:

#### Group 1: Admin/Standard Accounts (9)
- admin@ahsolutions.com
- manager@ahsolutions.com
- tech@ahsolutions.com
- viewer@ahsolutions.com
- superadmin@ahsolutions.com
- finance@ahsolutions.com
- csr@ahsolutions.com
- hr@ahsolutions.com
- parts@ahsolutions.com

#### Group 2: US Employees (5)
- john.richardson@ahsolutions.com (Admin, Management, $45/hr)
- sarah.mitchell@ahsolutions.com (Manager, Operations, $38.50/hr)
- michael.chen@ahsolutions.com (Technician, Operations, $32.75/hr)
- emily.watson@ahsolutions.com (Technician, Operations, $28/hr)
- david.rodriguez@ahsolutions.com (CSR, Customer Service, $22.50/hr)

#### Group 3: Philippines Employees (5)
- maria.santos@ahsolutions.com.ph (Finance, Finance, ₱850/hr)
- juan.delacruz@ahsolutions.com.ph (Technician, Operations, ₱650/hr)
- anna.reyes@ahsolutions.com.ph (Accounting, Finance, ₱550/hr)
- carlos.gutierrez@ahsolutions.com.ph (CSR, Customer Service, ₱480/hr)
- rosa.morales@ahsolutions.com.ph (Operations, Operations, ₱620/hr)

## Test Email Preselection

### Test 1: Verify Dropdown Shows All Emails

**Steps:**
1. Open the application
2. Click "Login" button (or go to /landing)
3. Click on the Email dropdown
4. **Verify**: See all 19 emails organized in 3 groups
5. **Verify**: Emails are sorted alphabetically within groups
6. **Verify**: Group headers are clearly visible (Admin Accounts, US Employees, Philippines Employees)

**Expected Result:**
- ✅ All 19 emails visible
- ✅ Grouped by account type
- ✅ Easy to locate any email

### Test 2: Test Default Preselection

**Steps:**
1. Open login page
2. **Verify**: First email is preselected (admin@ahsolutions.com)
3. Close and reopen login modal
4. **Verify**: Previously selected email is still shown (if Remember me was checked)

**Expected Result:**
- ✅ Email field not empty on page load
- ✅ "Remember me" saves selection to localStorage

### Test 3: Verify "Remember Me" Works

**Steps:**
1. Login form is open
2. Select: maria.santos@ahsolutions.com.ph
3. Check: "Remember me" checkbox
4. Log out (once logged in)
5. Click Login again
6. **Verify**: maria.santos@ahsolutions.com.ph is still selected

**Expected Result:**
- ✅ Email saved to `localStorage.ahs:lastEmail`
- ✅ Email restored on next login form open

### Test 4: Quick Employee Switching

**Steps:**
1. Log in as: john.richardson@ahsolutions.com
2. Browse the application for 30 seconds
3. Log out
4. Log in as: sarah.mitchell@ahsolutions.com
5. **Verify**: Different employee data loads immediately
6. Navigate to different modules
7. **Verify**: All data is for Sarah, not John

**Expected Result:**
- ✅ Each employee sees only their own data
- ✅ Email dropdown makes switching fast
- ✅ No data confusion between accounts

## Test Data Loading Per Email

### Test 5: Verify User Data Preloads

**Steps:**
1. Select any employee email (e.g., michael.chen@ahsolutions.com)
2. Open browser console
3. Login
4. **Verify**: Console shows initialization logs:
   ```
   🔄 Initializing data for Michael Chen (michael.chen@ahsolutions.com)
   ✅ Generated 20 timecard records
   ✅ Generated 20 attendance records
   ✅ Generated 2 payslip records
   ✅ Data initialization complete for Michael Chen
   ```
5. Check browser DevTools → Application → localStorage
6. **Verify**: Keys like `timecards_emp-us-003`, `attendance_emp-us-003`, etc. exist

**Expected Result:**
- ✅ Console shows initialization for correct employee
- ✅ localStorage has employee-specific keys
- ✅ Data generates automatically on first login

### Test 6: Verify Email-Specific Data

**Scenario A: US Employee (Sarah Mitchell)**
```
Email: sarah.mitchell@ahsolutions.com
Login → Go to Timecards Module
Expected: 20 timecard records
Expected Hourly Rate: $38.50
Expected Department: Operations
Expected Hours per day: 8-11 hours (mix of regular and OT)
```

**Scenario B: PH Employee (Maria Santos)**
```
Email: maria.santos@ahsolutions.com.ph
Login → Go to Timecards Module
Expected: 20 timecard records
Expected Hourly Rate: ₱850
Expected Department: Finance
Expected Currency: PHP in payslips
```

**Scenario C: Different Role (John Richardson)**
```
Email: john.richardson@ahsolutions.com
Login → Go to Timecards Module
Expected: 20 timecard records
Expected Check-in times: 14:55 (evening shift)
Expected Meal times: 17:00-17:30 (different from others)
```

### Test 7: Data Isolation Between Users

**Steps:**
1. **Open Tab 1**: Log in as john.richardson@ahsolutions.com
2. **Open Tab 2**: Log in as maria.santos@ahsolutions.com.ph (different browser tab)
3. **Tab 1**: Go to Timecards
4. **Verify**: Shows John's timecards with $45/hr rate
5. **Tab 2**: Go to Timecards
6. **Verify**: Shows Maria's timecards with ₱850/hr rate
7. **Tab 1**: Refresh page
8. **Verify**: Still shows John's data (no bleed-through)

**Expected Result:**
- ✅ No data mixing between tabs
- ✅ Each user sees only their own records
- ✅ Data persists correctly per user

## Test Cross-Module Data Flow

### Test 8: Timecard → Payroll Flow

**Steps:**
1. Log in as: emily.watson@ahsolutions.com
2. Go to: Timecards Module
3. **Verify**: 20 timecard records for Emily
4. Note down: Total hours worked
5. Go to: Payroll Calculation Module
6. **Verify**: Hours match timecard records
7. **Verify**: Rate matches Emily's hourly rate ($28/hr)
8. **Verify**: Gross pay calculation is correct

**Expected Result:**
- ✅ Payroll hours match timecard hours
- ✅ Rate matches employee's hourly rate
- ✅ Calculations are accurate

### Test 9: Payroll → Announcements

**Steps:**
1. Log in as: admin@ahsolutions.com (or any admin role)
2. Go to: Payroll Calculation
3. Select period: June 1-15, 2026
4. Click: "Process Payroll"
5. **Verify**: Success message shows announcements sent
6. Log out
7. Log in as: david.rodriguez@ahsolutions.com
8. **Verify**: Announcement banner appears at top
9. Click: "View announcements"
10. **Verify**: See payslip notification with portal link

**Expected Result:**
- ✅ Each employee receives personal announcement
- ✅ Announcement includes their payslip link
- ✅ Link points to Employee Self-Service Portal

### Test 10: Employee Self-Service Portal

**Steps:**
1. Log in as: rosa.morales@ahsolutions.com.ph
2. Navigate to: Employee Self-Service Portal
3. **Verify**: Shows Rosa's profile data
4. Go to: Payslips section
5. **Verify**: Shows 2 payslips (June 1-15, June 16-30)
6. **Verify**: Payslip data matches:
   - Hourly rate: ₱620
   - Hours: ~160 per period
   - Currency: PHP
7. Click on a payslip
8. **Verify**: Detailed breakdown shows correct calculations

**Expected Result:**
- ✅ Employee sees only their own payslips
- ✅ All data is accurate and complete
- ✅ Different employees see different data

## Troubleshooting

### Issue: Email dropdown is empty

**Solution:**
1. Clear browser cache and localStorage
2. Refresh page
3. If still empty, check browser console for errors
4. Verify `DEFAULT_LOGIN_EMAILS` is in landing.tsx

### Issue: Email doesn't preselect

**Solution:**
1. Check if "Remember me" is checked
2. Open DevTools → Application → localStorage
3. Look for key: `ahs:lastEmail`
4. If missing, manually check it next time
5. Verify no errors in console

### Issue: Data doesn't load after login

**Solution:**
1. Open browser console
2. Log in with an employee email
3. Check for initialization messages
4. If no messages, go to: DevTools → Application → localStorage
5. Manually run: `initializeUserData('email@example.com')`
6. Refresh page

### Issue: Wrong data showing for employee

**Solution:**
1. Verify logged-in email in header/profile
2. Check localStorage keys match employee ID
3. Clear all user data: Run `clearAllUserData()` in console
4. Log out and log back in to regenerate

## Quick Reference: How to Test Email Preselection

| Test | Email | Expected | How to Verify |
|------|-------|----------|---------------|
| Admin | admin@ahsolutions.com | Shows in dropdown | Click dropdown, see listed |
| US Employee | john.richardson@ahsolutions.com | Shows in dropdown, preloads data | Select, login, check console |
| PH Employee | maria.santos@ahsolutions.com.ph | Shows in dropdown, USD rates | Select, check payslips |
| Remember Me | Any email | Saved to localStorage | Check "Remember me", logout, reopen |
| Data Isolation | Two different tabs | Different data per tab | Open side-by-side tabs |
| Cross-Module | Email selection | Data flows correctly | Timecard → Payroll → Payslip |

## Automated Testing Checklist

- [ ] All 19 emails appear in dropdown
- [ ] Emails are grouped correctly (Admin/US/PH)
- [ ] First email is preselected on page load
- [ ] "Remember me" saves email to localStorage
- [ ] Switching between employees works smoothly
- [ ] Each employee's data loads automatically
- [ ] Data doesn't mix between users
- [ ] Payroll calculations match timecard hours
- [ ] Announcements work after payroll processing
- [ ] Employee Self-Service shows correct data
- [ ] All 10 employees can be tested independently

---

**Testing Date**: June 2026
**Total Emails to Test**: 19 (9 admin + 10 employees)
**Total Test Cases**: 10 scenarios
**Expected Pass Rate**: 100%
