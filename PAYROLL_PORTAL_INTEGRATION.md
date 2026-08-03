# Payroll Integration with Employee Self-Service Portal

## Overview

The Enhanced Payroll Management system automatically synchronizes payroll data with the Employee Self-Service Portal through localStorage. This allows employees to view their personal payroll records in real-time without requiring separate data entry.

## Data Flow

```
AccountingDashboard (Payroll Management)
           ↓
      localStorage
           ↓
Employee Self-Service Portal (Payroll View)
```

### Storage Keys

```javascript
// Primary payroll data
localStorage.getItem("payroll_employees")
// Returns: Array<Employee>

// Audit trail
localStorage.getItem("payroll_audit_logs")
// Returns: Array<PayrollAuditLog>

// Optional: Portal-specific cache
localStorage.getItem("employee_payroll_cache_[employeeId]")
// Returns: Cached employee payroll
```

## Implementation Guide

### Step 1: Display Employee's Payroll in Portal

```typescript
// In Employee Self-Service Portal component
import { useEffect, useState } from 'react';

interface Employee {
  id: string;
  name: string;
  department: string;
  country: "US" | "PH";
  hoursWorked: number;
  hourlyRate: number;
  totalWages: number;
}

export function EmployeePayrollSection({ employeeId }: { employeeId: string }) {
  const [payrollData, setPayrollData] = useState<Employee | null>(null);
  const [payrollHistory, setPayrollHistory] = useState<Employee[]>([]);

  useEffect(() => {
    // Load payroll data from shared localStorage
    const allEmployees = JSON.parse(
      localStorage.getItem("payroll_employees") || "[]"
    );
    
    // Find current employee's data
    const currentPayroll = allEmployees.find((emp: Employee) => emp.id === employeeId);
    
    if (currentPayroll) {
      setPayrollData(currentPayroll);
      setPayrollHistory([currentPayroll]); // In real app, fetch historical data
    }
  }, [employeeId]);

  if (!payrollData) {
    return <div className="text-slate-400">No payroll data available</div>;
  }

  return (
    <div className="space-y-4">
      <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
        <h3 className="text-sm font-bold text-white mb-4">Current Payroll</h3>
        
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs text-slate-400 mb-1">Hours Worked</p>
            <p className="text-2xl font-bold text-blue-300">{payrollData.hoursWorked}</p>
          </div>
          
          <div>
            <p className="text-xs text-slate-400 mb-1">Hourly Rate</p>
            <p className="text-2xl font-bold text-green-300">
              {payrollData.country === "US" ? "$" : "₱"}
              {payrollData.hourlyRate.toFixed(2)}
            </p>
          </div>
          
          <div className="md:col-span-2">
            <p className="text-xs text-slate-400 mb-1">Total Wages</p>
            <p className="text-3xl font-bold text-white">
              {payrollData.country === "US" ? "$" : "₱"}
              {payrollData.totalWages.toLocaleString("en-US", { maximumFractionDigits: 2 })}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
```

### Step 2: Show Payroll History

```typescript
export function EmployeePayrollHistory({ employeeId }: { employeeId: string }) {
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    // Load audit logs for this employee
    const auditLogs = JSON.parse(
      localStorage.getItem("payroll_audit_logs") || "[]"
    );
    
    const employeeActions = auditLogs
      .filter((log: any) => log.employeeId === employeeId)
      .sort((a: any, b: any) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    
    setHistory(employeeActions);
  }, [employeeId]);

  return (
    <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
      <h3 className="text-sm font-bold text-white mb-4">Payroll History</h3>
      
      {history.length === 0 ? (
        <p className="text-slate-400 text-sm">No payroll history available</p>
      ) : (
        <div className="space-y-2">
          {history.map((log) => (
            <div key={log.id} className="bg-slate-800/50 rounded p-3 border border-white/5">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs font-semibold text-white uppercase">
                    {log.action}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">{log.details}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500">
                    {new Date(log.timestamp).toLocaleDateString()}
                  </p>
                  {log.amount && (
                    <p className="text-xs text-green-300 font-semibold">
                      {log.employeeId.startsWith("us-") ? "$" : "₱"}
                      {log.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Step 3: Add to Employee Dashboard

```typescript
// In existing Employee Self-Service Portal component

import { EmployeePayrollSection } from "./EmployeePayrollSection";
import { EmployeePayrollHistory } from "./EmployeePayrollHistory";

export function EmployeeDashboard({ employeeId }: { employeeId: string }) {
  return (
    <div className="space-y-6">
      {/* Existing dashboard content */}
      
      {/* New Payroll Section */}
      <section>
        <h2 className="text-xl font-bold text-white mb-4">My Payroll</h2>
        <EmployeePayrollSection employeeId={employeeId} />
        <EmployeePayrollHistory employeeId={employeeId} />
      </section>
    </div>
  );
}
```

## Sync Strategy

### Real-Time Sync (Recommended)

```typescript
// Use event listener for cross-tab/cross-window changes
useEffect(() => {
  const handleStorageChange = (e: StorageEvent) => {
    if (e.key === "payroll_employees" || e.key === "payroll_audit_logs") {
      // Reload payroll data when changed in another tab
      loadPayrollData();
    }
  };

  window.addEventListener("storage", handleStorageChange);
  return () => window.removeEventListener("storage", handleStorageChange);
}, []);
```

### Polling Sync (Alternative)

```typescript
// Poll for updates every 30 seconds
useEffect(() => {
  const interval = setInterval(() => {
    loadPayrollData();
  }, 30000);

  return () => clearInterval(interval);
}, []);
```

### Manual Sync

```typescript
// Add refresh button
<button
  onClick={() => loadPayrollData()}
  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
>
  Refresh Payroll Data
</button>
```

## Security Considerations

### Access Control

```typescript
// Only allow employees to view their own data
export function EmployeePayrollGuard({ 
  employeeId, 
  currentUserId 
}: { 
  employeeId: string;
  currentUserId: string;
}) {
  if (employeeId !== currentUserId) {
    return <div className="text-red-400">Unauthorized access</div>;
  }

  return <EmployeePayrollSection employeeId={employeeId} />;
}
```

### Data Privacy

```typescript
// Never expose sensitive data in localStorage
const SENSITIVE_FIELDS = ["ssn", "bankAccount", "taxId"];

export function sanitizeEmployeeData(employee: Employee) {
  const sanitized = { ...employee };
  SENSITIVE_FIELDS.forEach(field => delete sanitized[field as any]);
  return sanitized;
}
```

## Caching Strategy

### Local Cache for Performance

```typescript
interface CacheEntry {
  data: Employee;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

export function getCachedPayroll(employeeId: string, ttl: number = 300000) {
  const cached = localStorage.getItem(`payroll_cache_${employeeId}`);
  
  if (!cached) return null;
  
  const entry: CacheEntry = JSON.parse(cached);
  const age = Date.now() - entry.timestamp;
  
  if (age > entry.ttl) {
    localStorage.removeItem(`payroll_cache_${employeeId}`);
    return null;
  }
  
  return entry.data;
}

export function cachePayroll(employee: Employee, ttl: number = 300000) {
  const entry: CacheEntry = {
    data: employee,
    timestamp: Date.now(),
    ttl,
  };
  
  localStorage.setItem(
    `payroll_cache_${employee.id}`,
    JSON.stringify(entry)
  );
}
```

## Data Validation

### Validate Before Display

```typescript
export function isValidPayrollData(data: any): data is Employee {
  return (
    typeof data.id === "string" &&
    typeof data.name === "string" &&
    typeof data.hoursWorked === "number" &&
    typeof data.hourlyRate === "number" &&
    typeof data.totalWages === "number" &&
    ["US", "PH"].includes(data.country)
  );
}

// Usage
const allEmployees = JSON.parse(localStorage.getItem("payroll_employees") || "[]");
const validEmployees = allEmployees.filter(isValidPayrollData);
```

## Notification Integration

### Notify Employees of Changes

```typescript
// Add to payroll management when generating payroll
export function notifyEmployeeOfPayroll(employee: Employee) {
  const notification = {
    type: "payroll_generated",
    message: `Your payroll has been processed: ${employee.totalWages}`,
    timestamp: new Date().toISOString(),
    employeeId: employee.id,
  };
  
  // Store notification
  const notifications = JSON.parse(
    localStorage.getItem("employee_notifications") || "[]"
  );
  notifications.push(notification);
  localStorage.setItem("employee_notifications", JSON.stringify(notifications));
  
  // Could also send email/push notification
  // await sendEmailNotification(employee.email, notification);
}
```

## Troubleshooting Integration

### Common Issues and Solutions

#### Data Not Showing in Portal
```typescript
// Verify data exists
const employees = JSON.parse(localStorage.getItem("payroll_employees") || "[]");
console.log("Stored employees:", employees);

// Check employee ID matches
console.log("Looking for:", employeeId);
console.log("Available IDs:", employees.map((e: any) => e.id));
```

#### Stale Data in Portal
```typescript
// Force refresh
localStorage.removeItem("payroll_cache_" + employeeId);
window.location.reload();

// Or programmatically
loadPayrollData(); // Call refresh function
```

#### Sync Issues Between Tabs
```typescript
// Enable cross-tab sync
window.addEventListener("storage", (e) => {
  if (e.key === "payroll_employees") {
    console.log("Payroll updated in another tab, reloading...");
    location.reload();
  }
});
```

## Testing

### Unit Tests

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("Payroll Portal Integration", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("should load employee payroll from localStorage", () => {
    const mockEmployee = {
      id: "us-001",
      name: "Test User",
      department: "Operations",
      country: "US" as const,
      hoursWorked: 160,
      hourlyRate: 25,
      totalWages: 4000,
    };

    localStorage.setItem("payroll_employees", JSON.stringify([mockEmployee]));

    const stored = JSON.parse(localStorage.getItem("payroll_employees") || "[]");
    expect(stored[0]).toEqual(mockEmployee);
  });

  it("should filter employee-specific data", () => {
    const employees = [
      { id: "us-001", name: "Employee 1" },
      { id: "us-002", name: "Employee 2" },
    ];

    localStorage.setItem("payroll_employees", JSON.stringify(employees));
    const all = JSON.parse(localStorage.getItem("payroll_employees") || "[]");
    const filtered = all.filter((e: any) => e.id === "us-001");

    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe("Employee 1");
  });
});
```

### Integration Tests

```typescript
// Test end-to-end flow
describe("Payroll Portal E2E", () => {
  it("should update portal when accounting dashboard changes payroll", async () => {
    // 1. Simulate payroll change in AccountingDashboard
    const updatedEmployee = { id: "us-001", totalWages: 5000 };
    localStorage.setItem("payroll_employees", JSON.stringify([updatedEmployee]));

    // 2. Verify Portal sees the change
    const portalData = JSON.parse(localStorage.getItem("payroll_employees") || "[]");
    expect(portalData[0].totalWages).toBe(5000);
  });
});
```

## Performance Optimization

### Lazy Load Payroll Data

```typescript
const payrollData = useMemo(() => {
  return JSON.parse(localStorage.getItem("payroll_employees") || "[]")
    .find((emp: Employee) => emp.id === employeeId);
}, [employeeId]);
```

### Debounce Sync Events

```typescript
import { debounce } from "lodash"; // or implement your own

const debouncedSync = debounce(() => {
  loadPayrollData();
}, 500);

useEffect(() => {
  const handleStorageChange = () => debouncedSync();
  window.addEventListener("storage", handleStorageChange);
  return () => window.removeEventListener("storage", handleStorageChange);
}, []);
```

## Migration Guide

### From Existing Portal Setup

If you have an existing Employee Self-Service Portal:

1. **Backup Current Data**
   ```bash
   # Export current payroll data
   const backup = localStorage.getItem("current_payroll_data");
   console.save("payroll_backup.json", backup);
   ```

2. **Update Data Keys**
   ```typescript
   // Migrate from old key to new key
   const oldData = localStorage.getItem("employee_payroll");
   if (oldData) {
     localStorage.setItem("payroll_employees", oldData);
     localStorage.removeItem("employee_payroll");
   }
   ```

3. **Update Component Imports**
   ```typescript
   // Change from
   import { getPayroll } from "./legacy/payroll";
   
   // To
   import { EmployeePayrollSection } from "@/components/EmployeePayrollSection";
   ```

4. **Test Thoroughly**
   - Verify all employees can see their data
   - Check historical data loads correctly
   - Confirm sync works across tabs

## Support & Maintenance

For questions or issues with the integration:
- Review this documentation
- Check browser console for errors
- Verify localStorage keys are correct
- Ensure component paths are updated
