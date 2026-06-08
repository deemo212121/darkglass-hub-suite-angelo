# Enhanced Payroll Management Feature Documentation

## Overview

The Enhanced Payroll Management feature for the AccountingDashboard component provides comprehensive employee payroll tracking, management, and audit logging. The system supports both US and Philippines-based employees with multi-currency support and persistent data storage.

## Features

### 1. Employee Payroll Management

#### Employees Table
- **Display individual employee payroll details** with the following columns:
  - Employee Name
  - Department
  - Total Hours Worked
  - Hourly Rate
  - Total Wages (calculated: hours × rate)
  - Action Buttons (Edit, Generate Payroll, Delete)

#### Supported Operations
- View all employees organized by country (US/PH)
- Edit hours worked and hourly rates in real-time
- Generate individual payroll records
- Delete payroll records
- Switch between USD and PHP currency views

### 2. Payroll Generation

#### Bulk Generation
- **"Generate Payroll (All Employees)" button** at the top of the payroll tab
- Generates payroll for all active employees in a single action
- Automatically logs the action to audit trail
- Displays success notification with total payroll generated

#### Individual Generation
- **"Generate Payroll" button** for each employee in the employee table
- Generates payroll specifically for that employee
- Records individual payroll generation in audit log
- Shows individual payroll amount and details

### 3. Editable Fields

#### Real-time Editing
- **Hours Worked**: Edit total hours worked by employee
- **Hourly Rate**: Edit hourly compensation rate
- **Total Wages**: Automatically calculated from hours × rate
- **Inline Editing**: Click Edit button to enable inline edit mode
- **Save/Cancel**: Save changes or cancel without modifications

#### Edit Workflow
1. Click Edit button on employee row
2. Hours and Rate fields become editable
3. Total Wages updates in real-time as you type
4. Click Save to persist changes (logs to audit)
5. Click Cancel to discard changes

### 4. Data Persistence (localStorage)

#### Storage Structure
```javascript
// Stored under key: "payroll_employees"
[
  {
    id: "us-001",
    name: "James Mitchell",
    department: "Operations",
    country: "US",
    hoursWorked: 160,
    hourlyRate: 28.50,
    totalWages: 4560
  },
  // ... more employees
]

// Stored under key: "payroll_audit_logs"
[
  {
    id: "log-xxx-xxx",
    timestamp: "2026-06-15T10:30:00Z",
    action: "generate" | "edit" | "delete",
    employeeId: "us-001",
    employeeName: "James Mitchell",
    details: "Generated payroll: 160 hours @ $28.50/hr = $4560",
    userId: "admin-user",
    amount: 4560
  },
  // ... more logs
]
```

#### Initial Load
- Component loads employees from localStorage on mount
- If no stored data exists, initializes with 20 mock employees (8 US, 12 PH)
- Mock data is saved to localStorage for future sessions
- All subsequent changes persist automatically

### 5. Audit Logging

#### Audit Log Features
- **Comprehensive Tracking**: Every action (generate, edit, delete) is logged
- **Detailed Information**:
  - Action type (generate/edit/delete)
  - Employee name and ID
  - Detailed description of changes
  - Timestamp of action
  - User performing action
  - Amount affected

#### Viewing Audit Logs
- Click **"Audit Log (N)"** button to toggle audit log panel
- Shows most recent logs first
- Displays timestamp, action type, employee name
- Shows affected amount in green
- Colored indicators for action type

#### Sample Audit Events
```
GENERATE: James Mitchell
Generated payroll: 160 hours @ $28.50/hr = $4560
2026-06-15 10:30:25 - $4,560.00

EDIT: Sarah Johnson
Updated: Hours 160→165, Rate $22.00→$23.50
2026-06-15 09:15:42 - $3,877.50

DELETE: Michael Chen
Deleted payroll record: $5250
2026-06-15 08:45:10 - $5,250.00
```

### 6. Mock Employee Data

#### US Employees (8 total)
1. James Mitchell - Operations - $28.50/hr
2. Sarah Johnson - Customer Service - $22.00/hr
3. Michael Chen - Operations - $31.25/hr
4. Emily Rodriguez - Finance - $26.50/hr
5. David Thompson - Parts - $24.00/hr
6. Jennifer Lee - Customer Service - $21.00/hr
7. Robert Williams - Management - $35.00/hr
8. Amanda Davis - Operations - $27.50/hr

#### PH Employees (12 total)
1. Maria Santos - Operations - ₱375/hr
2. Juan Dela Cruz - Customer Service - ₱320/hr
3. Anna Reyes - Operations - ₱400/hr
4. Carlos Gutierrez - Finance - ₱450/hr
5. Rosa Morales - Parts - ₱350/hr
6. Miguel Fernandez - Customer Service - ₱310/hr
7. Lucia Gonzales - Management - ₱550/hr
8. Ricardo Flores - Operations - ₱380/hr
9. Carmen Ramirez - Finance - ₱420/hr
10. Diego Ruiz - Parts - ₱360/hr
11. Isabella Ortega - Customer Service - ₱330/hr
12. Fernando Lopez - Operations - ₱390/hr

### 7. Currency Management

#### Exchange Rate
- Base rate: 1 USD = ₱57 PHP
- Configurable in component
- Used for conversions in reports and summaries

#### Currency Display
- **USD View**: Shows prices in dollars ($)
- **PHP View**: Shows prices in pesos (₱)
- Toggle buttons for quick switching
- All employee records display in their native currency

#### Currency Conversion Info
- Displays current exchange rate
- Shows combined payroll calculations
- Conversion examples provided in information panel

### 8. Dashboard Summary Cards

#### US Payroll Card
- Total Payroll Cost (USD)
- Active US Employees
- Overtime Cost (estimated 8.4%)
- Average Cost per Employee

#### PH Payroll Card
- Total Payroll Cost (PHP)
- Active PH Employees
- Overtime Cost (estimated 8.4%)
- Average Cost per Employee (PHP)

### 9. Employee Self-Service Portal Integration

#### Data Sharing
- Payroll data is exported to localStorage with key `payroll_employees`
- Employee Self-Service Portal reads from the same localStorage
- Audit logs stored under `payroll_audit_logs`
- Real-time synchronization between systems

#### Access for Employees
```javascript
// Self-Service Portal can access:
const employeeData = JSON.parse(localStorage.getItem("payroll_employees"));
const auditLogs = JSON.parse(localStorage.getItem("payroll_audit_logs"));

// Filter to see own payroll records
const myPayroll = employeeData.filter(emp => emp.id === currentUserId);
const myAuditLogs = auditLogs.filter(log => log.employeeId === currentUserId);
```

## UI/UX Design

### Color Scheme
- **Primary Background**: `bg-slate-900/50` with `border-white/10`
- **Accent Colors**:
  - Green: Total wages, successful actions
  - Blue: Currency switches, edit actions
  - Orange: Overtime costs
  - Red: Delete/cancel actions
- **Text Colors**:
  - White: Primary labels
  - Slate-300/400: Secondary text
  - Color-coded by amount type

### Responsive Layout
- **Desktop**: Full table view with all columns
- **Tablet**: Horizontal scroll for large tables
- **Mobile**: Stacked card view (recommended separate mobile UI)

### Icons Used
- `Edit2`: Edit payroll records
- `Save`: Save changes
- `X`: Cancel editing
- `Trash2`: Delete records
- `DollarSign`: Generate payroll
- `LogOut`: View audit logs

## Component Integration

### AccountingDashboard Component
```typescript
// Located in: src/components/AccountingDashboard.tsx
// New state management:
const [employees, setEmployees] = useState<Employee[]>([]);
const [editingId, setEditingId] = useState<string | null>(null);
const [auditLogs, setAuditLogs] = useState<PayrollAuditLog[]>([]);
const [showAuditLog, setShowAuditLog] = useState(false);

// Key functions:
- generatePayrollAll(): Generate for all employees
- generatePayrollIndividual(employee): Generate for one employee
- startEdit(employee): Enter edit mode
- saveEdit(employee): Save edited values
- deletePayrollRecord(employee): Remove payroll record
- calculateTotalPayroll(): Sum all wages
- calculateTotalByCountry(country): Sum wages by location
```

### Payroll Utility Library
```typescript
// Located in: src/lib/payroll.ts
// Provides utility functions:
- loadEmployees(defaultEmployees)
- saveEmployees(employees)
- loadAuditLogs()
- saveAuditLogs(logs)
- createAuditLog(action, employeeId, employeeName, details, amount)
- calculateTotalPayroll(employees)
- calculatePayrollByCountry(employees, country)
- countEmployeesByCountry(employees, country)
- exportPayrollData(employees, auditLogs)
- generateCountryPayrollReport(employees, country)
```

## Usage Guide

### For Payroll Managers

#### Viewing Payroll
1. Navigate to Accounting Dashboard
2. Click "Payroll" tab
3. Select currency (USD or PHP)
4. View all employees and their payroll details

#### Editing Employee Payroll
1. Find employee in the table
2. Click Edit button (pencil icon)
3. Update hours or hourly rate
4. Click Save button
5. Changes logged to audit trail

#### Generating Payroll
**For All Employees:**
1. Click "Generate Payroll (All Employees)" button
2. Confirmation notification appears
3. Action logged with total amount

**For Individual Employee:**
1. Find employee in table
2. Click Generate Payroll button (dollar icon)
3. Confirmation notification appears
4. Individual payroll logged

#### Viewing Audit History
1. Click "Audit Log (N)" button
2. Scroll through recent actions
3. See who did what, when, and the impact
4. Click again to hide audit log

### For Employees (Self-Service Portal)

#### Viewing Your Payroll
1. Log into Employee Self-Service Portal
2. Navigate to "My Payroll" section
3. View your payroll records (filtered by ID)
4. See your wage history

#### Requesting Changes
1. If hours or rates need correction:
   - Contact HR/Payroll team
   - Provide documentation
   - Changes will be made and logged

## Technical Details

### State Management
- Uses React hooks (useState, useEffect)
- localStorage for persistence
- Real-time calculations on edit

### Data Validation
- Hours and rates are numeric
- Calculations use proper decimal handling
- Currency formatting based on locale

### Error Handling
- Try-catch blocks for localStorage operations
- Graceful fallback to mock data if storage fails
- Confirmation dialogs for destructive actions

### Performance Considerations
- Efficient filtering by country
- Calculated fields only update on change
- Audit logs paginated/scrollable for large datasets
- localStorage is checked on component mount

## Extensibility

### Adding New Employees
```typescript
const newEmployee: Employee = {
  id: "unique-id",
  name: "New Employee Name",
  department: "Department",
  country: "US", // or "PH"
  hoursWorked: 160,
  hourlyRate: 25.00,
  totalWages: 4000,
};

const updated = [...employees, newEmployee];
saveEmployees(updated);
```

### Custom Calculations
```typescript
// Calculate overtime (hours over 160)
const overtimeHours = Math.max(0, employee.hoursWorked - 160);
const overtimePay = overtimeHours * (employee.hourlyRate * 1.5);

// Calculate department totals
const deptTotal = employees
  .filter(emp => emp.department === "Operations")
  .reduce((sum, emp) => sum + emp.totalWages, 0);
```

### Integration with External Systems
```typescript
// Export to API
const exportData = exportPayrollData(employees, auditLogs);
await fetch('/api/payroll/export', {
  method: 'POST',
  body: JSON.stringify(exportData)
});

// Import from API
const response = await fetch('/api/payroll/employees');
const importedEmployees = await response.json();
setEmployees(importedEmployees);
```

## Troubleshooting

### Data Not Persisting
- Check browser localStorage is enabled
- Check localStorage quota not exceeded
- Clear localStorage and reload
- Check browser console for errors

### Calculations Incorrect
- Verify numeric values in input fields
- Check for decimal place handling
- Reload page to reset state
- Check browser console for calculation errors

### Audit Logs Not Showing
- Click "Audit Log" button to toggle visibility
- Logs may be empty if no actions performed
- Check localStorage for `payroll_audit_logs` key
- Reload page to refresh logs

### Currency Display Issues
- Ensure proper locale setting
- Check EXCHANGE_RATE constant value
- Verify currency symbol shows correctly
- Clear browser cache if display incorrect

## Future Enhancements

### Planned Features
- [ ] Monthly/quarterly payroll reports
- [ ] Tax calculation integration
- [ ] Direct deposit setup
- [ ] Payroll approval workflow
- [ ] Employee payroll slips PDF generation
- [ ] Bulk employee import
- [ ] Integration with HR systems
- [ ] Role-based access control
- [ ] Payroll scheduling
- [ ] Deduction management

### Suggested Improvements
- Mobile-friendly payroll interface
- Advanced filtering and search
- Payroll forecasting
- Integration with accounting software
- Multi-currency ledger tracking
- Automated payroll processing
- Email notifications for payroll events

## Support & Maintenance

For issues or questions:
1. Check this documentation
2. Review audit logs for error details
3. Check browser console for technical errors
4. Contact development team with screenshots
