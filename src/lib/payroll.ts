// Payroll Management Utilities
import type { Employee, PayrollAuditLog } from "@/components/AccountingDashboard";

const STORAGE_KEYS = {
  EMPLOYEES: "payroll_employees",
  AUDIT_LOGS: "payroll_audit_logs",
};

/**
 * Load employees from localStorage
 */
export function loadEmployees(defaultEmployees: Employee[]): Employee[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.EMPLOYEES);
    return stored ? JSON.parse(stored) : defaultEmployees;
  } catch (error) {
    console.error("Error loading employees from localStorage:", error);
    return defaultEmployees;
  }
}

/**
 * Save employees to localStorage
 */
export function saveEmployees(employees: Employee[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(employees));
  } catch (error) {
    console.error("Error saving employees to localStorage:", error);
  }
}

/**
 * Load audit logs from localStorage
 */
export function loadAuditLogs(): PayrollAuditLog[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.AUDIT_LOGS);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error("Error loading audit logs from localStorage:", error);
    return [];
  }
}

/**
 * Save audit logs to localStorage
 */
export function saveAuditLogs(logs: PayrollAuditLog[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.AUDIT_LOGS, JSON.stringify(logs));
  } catch (error) {
    console.error("Error saving audit logs to localStorage:", error);
  }
}

/**
 * Create a new audit log entry
 */
export function createAuditLog(
  action: "generate" | "edit" | "delete",
  employeeId: string,
  employeeName: string,
  details: string,
  amount?: number
): PayrollAuditLog {
  return {
    id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    action,
    employeeId,
    employeeName,
    details,
    userId: "admin-user", // In production, this would be the actual logged-in user
    amount,
  };
}

/**
 * Calculate total payroll for all employees
 */
export function calculateTotalPayroll(employees: Employee[]): number {
  return employees.reduce((sum, emp) => sum + emp.totalWages, 0);
}

/**
 * Calculate payroll by country
 */
export function calculatePayrollByCountry(
  employees: Employee[],
  country: "US" | "PH"
): number {
  return employees
    .filter(emp => emp.country === country)
    .reduce((sum, emp) => sum + emp.totalWages, 0);
}

/**
 * Count employees by country
 */
export function countEmployeesByCountry(
  employees: Employee[],
  country: "US" | "PH"
): number {
  return employees.filter(emp => emp.country === country).length;
}

/**
 * Export payroll data for Employee Self-Service Portal
 */
export function exportPayrollData(employees: Employee[], auditLogs: PayrollAuditLog[]): {
  employees: Employee[];
  auditLogs: PayrollAuditLog[];
  exportedAt: string;
} {
  return {
    employees,
    auditLogs,
    exportedAt: new Date().toISOString(),
  };
}

/**
 * Clear all payroll data from localStorage
 */
export function clearPayrollData(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.EMPLOYEES);
    localStorage.removeItem(STORAGE_KEYS.AUDIT_LOGS);
  } catch (error) {
    console.error("Error clearing payroll data:", error);
  }
}

/**
 * Generate payroll report for a specific country
 */
export function generateCountryPayrollReport(employees: Employee[], country: "US" | "PH") {
  const countryEmployees = employees.filter(emp => emp.country === country);
  const totalPayroll = countryEmployees.reduce((sum, emp) => sum + emp.totalWages, 0);
  const departmentBreakdown = countryEmployees.reduce(
    (acc, emp) => {
      acc[emp.department] = (acc[emp.department] || 0) + emp.totalWages;
      return acc;
    },
    {} as Record<string, number>
  );

  return {
    country,
    totalEmployees: countryEmployees.length,
    totalPayroll,
    departmentBreakdown,
    averagePerEmployee: totalPayroll / Math.max(countryEmployees.length, 1),
    generatedAt: new Date().toISOString(),
  };
}
