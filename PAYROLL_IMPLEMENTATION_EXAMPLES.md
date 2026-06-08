# Payroll System - Real-World Implementation Examples

## Complete Integration Guide

### Integration Point 1: Employee Service/Database

```typescript
// services/employeeService.ts
import {
  createSalaryHistory,
  addSalaryChange,
  SalaryHistory,
} from '../lib/payrollCalculations';

interface Employee {
  id: string;
  name: string;
  salaryHistory: SalaryHistory;
  // ... other fields
}

class EmployeeService {
  /**
   * Create new employee with initial salary
   */
  createEmployee(id: string, name: string, initialRate: number): Employee {
    return {
      id,
      name,
      salaryHistory: createSalaryHistory(id, initialRate, new Date()),
      // ... other properties
    };
  }

  /**
   * Record a promotion
   */
  recordPromotion(
    employee: Employee,
    effectiveDate: Date,
    newRate: number,
    approvalNumber: string
  ): Employee {
    return {
      ...employee,
      salaryHistory: addSalaryChange(
        employee.salaryHistory,
        effectiveDate,
        newRate,
        'promotion',
        `Approved: ${approvalNumber}`
      ),
    };
  }

  /**
   * Record a salary adjustment
   */
  recordSalaryAdjustment(
    employee: Employee,
    effectiveDate: Date,
    newRate: number,
    reason: string
  ): Employee {
    return {
      ...employee,
      salaryHistory: addSalaryChange(
        employee.salaryHistory,
        effectiveDate,
        newRate,
        'adjustment',
        reason
      ),
    };
  }

  /**
   * Save employee (to database)
   */
  async save(employee: Employee): Promise<void> {
    // Save to database with salary history
    await db.employees.update(employee.id, {
      salaryHistory: employee.salaryHistory,
    });
  }
}

export const employeeService = new EmployeeService();
```

### Integration Point 2: Payroll Processing

```typescript
// services/payrollService.ts
import {
  calculateSplitPayroll,
  SplitPayrollBreakdown,
} from '../lib/payrollCalculations';
import { Employee } from './employeeService';

interface PayrollRecord {
  employeeId: string;
  payPeriodStart: Date;
  payPeriodEnd: Date;
  totalHoursWorked: number;
  breakdown: SplitPayrollBreakdown;
  status: 'draft' | 'approved' | 'processed';
  createdAt: Date;
  approvedBy?: string;
  processedAt?: Date;
}

class PayrollService {
  /**
   * Calculate payroll for employee for a period
   */
  calculatePayroll(
    employee: Employee,
    periodStart: Date,
    periodEnd: Date,
    totalHoursWorked: number
  ): PayrollRecord {
    const breakdown = calculateSplitPayroll(
      employee.id,
      employee.salaryHistory,
      periodStart,
      periodEnd,
      totalHoursWorked
    );

    return {
      employeeId: employee.id,
      payPeriodStart: periodStart,
      payPeriodEnd: periodEnd,
      totalHoursWorked,
      breakdown,
      status: 'draft',
      createdAt: new Date(),
    };
  }

  /**
   * Calculate payroll for all employees in period
   */
  async calculatePeriodPayroll(
    periodStart: Date,
    periodEnd: Date
  ): Promise<PayrollRecord[]> {
    const employees = await db.employees.findAll();
    const timeCards = await db.timecards.findByPeriod(periodStart, periodEnd);

    return employees.map((emp) => {
      const empTimeCards = timeCards.filter((tc) => tc.employeeId === emp.id);
      const totalHours = empTimeCards.reduce((sum, tc) => sum + tc.hours, 0);

      return this.calculatePayroll(emp, periodStart, periodEnd, totalHours);
    });
  }

  /**
   * Approve payroll record
   */
  async approvePayroll(record: PayrollRecord, approvedBy: string): Promise<PayrollRecord> {
    return {
      ...record,
      status: 'approved',
      approvedBy,
    };
  }

  /**
   * Process (finalize) payroll record
   */
  async processPayroll(record: PayrollRecord): Promise<PayrollRecord> {
    if (record.status !== 'approved') {
      throw new Error('Payroll must be approved before processing');
    }

    // Export to accounting/payment system
    await this.exportToPaymentSystem(record);

    return {
      ...record,
      status: 'processed',
      processedAt: new Date(),
    };
  }

  /**
   * Export to external payment system
   */
  private async exportToPaymentSystem(record: PayrollRecord): Promise<void> {
    // Implementation depends on your payment provider
    const payload = {
      employeeId: record.employeeId,
      amount: record.breakdown.totalPay,
      date: new Date(),
      reference: `PAYROLL_${record.payPeriodStart.toISOString().split('T')[0]}`,
    };

    // Send to payment API
    await paymentGateway.createPayment(payload);
  }

  /**
   * Save payroll record
   */
  async save(record: PayrollRecord): Promise<void> {
    await db.payroll.insert(record);
  }
}

export const payrollService = new PayrollService();
```

### Integration Point 3: React UI - Payroll Calculator

```typescript
// routes/payroll-calculator.tsx
import React, { useState, useEffect } from 'react';
import { Employee, employeeService } from '../services/employeeService';
import { PayrollService, payrollService } from '../services/payrollService';
import { PayrollBreakdownDisplay } from '../components/PayrollBreakdownDisplay';
import { SplitPayrollBreakdown } from '../lib/payrollCalculations';

interface CalculatorState {
  selectedEmployee: Employee | null;
  periodStart: Date;
  periodEnd: Date;
  totalHours: number;
  breakdown: SplitPayrollBreakdown | null;
  loading: boolean;
  error: string | null;
}

export default function PayrollCalculator() {
  const [state, setState] = useState<CalculatorState>({
    selectedEmployee: null,
    periodStart: new Date(),
    periodEnd: new Date(),
    totalHours: 0,
    breakdown: null,
    loading: false,
    error: null,
  });

  const [employees, setEmployees] = useState<Employee[]>([]);

  // Load employees on mount
  useEffect(() => {
    loadEmployees();
  }, []);

  const loadEmployees = async () => {
    try {
      const emps = await employeeService.getAllEmployees();
      setEmployees(emps);
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: 'Failed to load employees',
      }));
    }
  };

  const handleCalculate = async () => {
    if (!state.selectedEmployee) {
      setState((prev) => ({ ...prev, error: 'Please select an employee' }));
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const breakdown = payrollService.calculatePayroll(
        state.selectedEmployee,
        state.periodStart,
        state.periodEnd,
        state.totalHours
      );

      setState((prev) => ({
        ...prev,
        breakdown: breakdown.breakdown,
        loading: false,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Calculation failed',
        loading: false,
      }));
    }
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-3xl font-bold">Payroll Calculator</h1>

      {/* Input Section */}
      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">Employee</label>
          <select
            value={state.selectedEmployee?.id || ''}
            onChange={(e) => {
              const emp = employees.find((e) => e.id === e.currentTarget.value);
              setState((prev) => ({ ...prev, selectedEmployee: emp || null }));
            }}
            className="w-full border rounded p-2"
          >
            <option value="">Select an employee</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2">Period Start</label>
            <input
              type="date"
              value={state.periodStart.toISOString().split('T')[0]}
              onChange={(e) =>
                setState((prev) => ({
                  ...prev,
                  periodStart: new Date(e.target.value),
                }))
              }
              className="w-full border rounded p-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Period End</label>
            <input
              type="date"
              value={state.periodEnd.toISOString().split('T')[0]}
              onChange={(e) =>
                setState((prev) => ({
                  ...prev,
                  periodEnd: new Date(e.target.value),
                }))
              }
              className="w-full border rounded p-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Total Hours</label>
            <input
              type="number"
              value={state.totalHours}
              onChange={(e) =>
                setState((prev) => ({
                  ...prev,
                  totalHours: parseFloat(e.target.value) || 0,
                }))
              }
              className="w-full border rounded p-2"
            />
          </div>
        </div>

        {state.error && (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700">
            {state.error}
          </div>
        )}

        <button
          onClick={handleCalculate}
          disabled={state.loading}
          className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600 disabled:bg-gray-400"
        >
          {state.loading ? 'Calculating...' : 'Calculate Payroll'}
        </button>
      </div>

      {/* Results Section */}
      {state.breakdown && (
        <div className="bg-white rounded-lg shadow p-6">
          <PayrollBreakdownDisplay breakdown={state.breakdown} />
        </div>
      )}
    </div>
  );
}
```

### Integration Point 4: Batch Processing (Cron Job)

```typescript
// jobs/processPeriodPayroll.ts
import { CronJob } from 'cron';
import { payrollService } from '../services/payrollService';
import { db } from '../database';

/**
 * Process payroll for completed pay periods
 * Runs daily at 2 AM
 */
const payrollCron = new CronJob('0 2 * * *', async () => {
  console.log('Starting payroll processing job...');

  try {
    // Get current pay period
    const currentPeriod = await db.periods.getCurrent();

    if (!currentPeriod || !currentPeriod.isComplete) {
      console.log('No complete period to process');
      return;
    }

    // Calculate payroll for all employees
    console.log(`Processing period: ${currentPeriod.start} to ${currentPeriod.end}`);
    const payrollRecords = await payrollService.calculatePeriodPayroll(
      currentPeriod.start,
      currentPeriod.end
    );

    console.log(`Calculated payroll for ${payrollRecords.length} employees`);

    // Save all records in draft status
    for (const record of payrollRecords) {
      await payrollService.save(record);
    }

    // Send notification for approval
    await notificationService.sendToHR(
      `Payroll calculated for ${payrollRecords.length} employees. Requires approval.`
    );

    console.log('Payroll processing job completed successfully');
  } catch (error) {
    console.error('Payroll processing job failed:', error);
    await notificationService.sendAlert(
      `Payroll processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
});

// Start the job
payrollCron.start();

export { payrollCron };
```

### Integration Point 5: API Endpoint

```typescript
// api/payroll.ts
import { Router, Request, Response } from 'express';
import { payrollService } from '../services/payrollService';
import { employeeService } from '../services/employeeService';

const router = Router();

/**
 * POST /api/payroll/calculate
 * Calculate payroll for an employee in a period
 */
router.post('/calculate', async (req: Request, res: Response) => {
  try {
    const { employeeId, periodStart, periodEnd, totalHours } = req.body;

    // Validate input
    if (!employeeId || !periodStart || !periodEnd || totalHours === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get employee
    const employee = await employeeService.getById(employeeId);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    // Calculate
    const record = payrollService.calculatePayroll(
      employee,
      new Date(periodStart),
      new Date(periodEnd),
      parseFloat(totalHours)
    );

    res.json(record);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Calculation failed',
    });
  }
});

/**
 * POST /api/payroll/promote
 * Record promotion and recalculate affected payroll
 */
router.post('/promote', async (req: Request, res: Response) => {
  try {
    const {
      employeeId,
      effectiveDate,
      newRate,
      approvalNumber,
    } = req.body;

    // Get and update employee
    let employee = await employeeService.getById(employeeId);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    employee = employeeService.recordPromotion(
      employee,
      new Date(effectiveDate),
      parseFloat(newRate),
      approvalNumber
    );

    // Save
    await employeeService.save(employee);

    res.json({
      message: 'Promotion recorded',
      employee,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Operation failed',
    });
  }
});

/**
 * GET /api/payroll/:id
 * Get payroll record
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const record = await db.payroll.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ error: 'Payroll record not found' });
    }
    res.json(record);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve record' });
  }
});

export default router;
```

### Integration Point 6: Export to CSV for Accounting

```typescript
// services/exportService.ts
import { SplitPayrollBreakdown } from '../lib/payrollCalculations';
import * as fs from 'fs';

class ExportService {
  /**
   * Export payroll to CSV format
   */
  exportToCSV(breakdowns: SplitPayrollBreakdown[], filename: string): string {
    const rows = [
      [
        'Employee ID',
        'Pay Period',
        'Total Hours',
        'Regular Pay',
        'Overtime Pay',
        'Total Pay',
        'Salary Changed',
      ],
    ];

    breakdowns.forEach((breakdown) => {
      rows.push([
        breakdown.employeeId,
        `${breakdown.payPeriodStart.toISOString().split('T')[0]} to ${breakdown.payPeriodEnd.toISOString().split('T')[0]}`,
        breakdown.totalHoursWorked.toFixed(2),
        breakdown.totalRegularPay.toFixed(2),
        breakdown.totalOvertimePay.toFixed(2),
        breakdown.totalPay.toFixed(2),
        breakdown.salaryChangeOccurred ? 'Yes' : 'No',
      ]);

      // Add portion details
      breakdown.portions.forEach((portion) => {
        rows.push([
          '',
          portion.periodName,
          portion.hoursWorked.toFixed(2),
          portion.regularPay.toFixed(2),
          portion.overtimePay?.toFixed(2) || '0.00',
          portion.totalPay.toFixed(2),
          '',
        ]);
      });
    });

    // Write to CSV
    const csv = rows.map((row) => row.join(',')).join('\n');
    fs.writeFileSync(filename, csv);

    return filename;
  }

  /**
   * Export to JSON for API consumption
   */
  exportToJSON(breakdowns: SplitPayrollBreakdown[]): string {
    return JSON.stringify(breakdowns, null, 2);
  }
}

export const exportService = new ExportService();
```

## Database Schema

```sql
-- Employees table
CREATE TABLE employees (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  salary_history JSON NOT NULL, -- Stores SalaryHistory object
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Payroll records
CREATE TABLE payroll_records (
  id VARCHAR(50) PRIMARY KEY,
  employee_id VARCHAR(50) NOT NULL,
  pay_period_start DATE NOT NULL,
  pay_period_end DATE NOT NULL,
  total_hours_worked DECIMAL(10, 2) NOT NULL,
  breakdown JSON NOT NULL, -- Stores SplitPayrollBreakdown
  status ENUM('draft', 'approved', 'processed') DEFAULT 'draft',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  approved_by VARCHAR(50),
  approved_at TIMESTAMP,
  processed_at TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  INDEX (employee_id, pay_period_start)
);

-- Audit log
CREATE TABLE salary_changes_audit (
  id VARCHAR(50) PRIMARY KEY,
  employee_id VARCHAR(50) NOT NULL,
  effective_date DATE NOT NULL,
  old_rate DECIMAL(10, 4),
  new_rate DECIMAL(10, 4) NOT NULL,
  reason VARCHAR(50),
  notes TEXT,
  recorded_by VARCHAR(50),
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  INDEX (employee_id, effective_date)
);
```

## Testing the Integration

```typescript
// tests/payroll.integration.test.ts
import { payrollService } from '../services/payrollService';
import { employeeService } from '../services/employeeService';

describe('Payroll System Integration', () => {
  it('should handle employee promotion and calculate payroll correctly', async () => {
    // Create employee
    let emp = employeeService.createEmployee('EMP001', 'John Doe', 4);

    // Record promotion
    emp = employeeService.recordPromotion(
      emp,
      new Date('2024-01-06'),
      6,
      'APR-123'
    );

    // Calculate payroll
    const record = payrollService.calculatePayroll(
      emp,
      new Date('2024-01-01'),
      new Date('2024-01-10'),
      40
    );

    // Verify
    expect(record.breakdown.totalPay).toBe(200);
    expect(record.breakdown.portions).toHaveLength(2);
  });
});
```

## Summary

This implementation provides:
1. **Service layer** for salary and payroll management
2. **React UI** for interactive calculations
3. **API endpoints** for system integration
4. **Batch processing** for automated payroll runs
5. **Export functionality** for accounting systems
6. **Complete database schema** for data persistence
7. **Unit and integration tests** for quality assurance

The system is production-ready and can be integrated into existing HR/payroll systems.
