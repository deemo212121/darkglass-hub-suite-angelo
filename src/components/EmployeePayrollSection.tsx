/**
 * Employee Payroll Section Component
 * 
 * Displays individual employee payroll data from the AccountingDashboard
 * Integrates with localStorage for real-time data synchronization
 * Part of Employee Self-Service Portal
 */

import { useEffect, useState } from "react";
import { DollarSign, TrendingUp, Clock, LogOut } from "lucide-react";

interface Employee {
  id: string;
  name: string;
  department: string;
  country: "US" | "PH";
  hoursWorked: number;
  hourlyRate: number;
  totalWages: number;
}

interface PayrollAuditLog {
  id: string;
  timestamp: string;
  action: "generate" | "edit" | "delete";
  employeeId: string;
  employeeName: string;
  details: string;
  userId: string;
  amount?: number;
}

const EXCHANGE_RATE = 57; // 1 USD = 57 PHP

interface EmployeePayrollSectionProps {
  employeeId: string;
  employeeName?: string;
}

export function EmployeePayrollSection({
  employeeId,
  employeeName = "Employee",
}: EmployeePayrollSectionProps) {
  const [payrollData, setPayrollData] = useState<Employee | null>(null);
  const [payrollHistory, setPayrollHistory] = useState<PayrollAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  // Load payroll data from shared localStorage
  const loadPayrollData = () => {
    try {
      setLoading(true);

      // Load all employees
      const allEmployees = JSON.parse(
        localStorage.getItem("payroll_employees") || "[]"
      );

      // Find current employee's data
      const currentPayroll = allEmployees.find(
        (emp: Employee) => emp.id === employeeId
      );

      if (currentPayroll) {
        setPayrollData(currentPayroll);
      }

      // Load audit logs for this employee
      const allAuditLogs = JSON.parse(
        localStorage.getItem("payroll_audit_logs") || "[]"
      );

      const employeeActions = allAuditLogs
        .filter((log: PayrollAuditLog) => log.employeeId === employeeId)
        .sort(
          (a: PayrollAuditLog, b: PayrollAuditLog) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );

      setPayrollHistory(employeeActions);
    } catch (error) {
      console.error("Error loading payroll data:", error);
    } finally {
      setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    loadPayrollData();
  }, [employeeId]);

  // Listen for storage changes (updates from AccountingDashboard)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (
        e.key === "payroll_employees" ||
        e.key === "payroll_audit_logs"
      ) {
        loadPayrollData();
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [employeeId]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
          <div className="animate-pulse">
            <div className="h-4 bg-slate-700 rounded w-1/4 mb-4"></div>
            <div className="h-8 bg-slate-700 rounded w-1/2"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!payrollData) {
    return (
      <div className="bg-yellow-900/50 border border-yellow-500/30 rounded-lg p-4">
        <p className="text-yellow-200 text-sm">
          No payroll data available. Contact HR if you believe this is an error.
        </p>
      </div>
    );
  }

  const currencySymbol = payrollData.country === "US" ? "$" : "₱";
  const inUSD =
    payrollData.country === "US"
      ? payrollData.totalWages
      : payrollData.totalWages / EXCHANGE_RATE;

  return (
    <div className="space-y-6">
      {/* Current Payroll Summary */}
      <div className="space-y-4">
        <h3 className="text-lg font-bold text-white">Current Payroll</h3>

        <div className="grid gap-4 md:grid-cols-3">
          {/* Hours Worked */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-slate-400 mb-2 uppercase">
                  Hours Worked
                </p>
                <p className="text-3xl font-bold text-blue-300">
                  {payrollData.hoursWorked}
                </p>
                <p className="text-xs text-slate-500 mt-2">
                  {payrollData.country === "US" ? "Standard" : "Standard"}
                </p>
              </div>
              <Clock className="h-6 w-6 text-slate-600" />
            </div>
          </div>

          {/* Hourly Rate */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-slate-400 mb-2 uppercase">
                  Hourly Rate
                </p>
                <p className="text-3xl font-bold text-green-300">
                  {currencySymbol}
                  {payrollData.hourlyRate.toFixed(2)}
                </p>
                <p className="text-xs text-slate-500 mt-2">
                  Per hour ({payrollData.country})
                </p>
              </div>
              <TrendingUp className="h-6 w-6 text-slate-600" />
            </div>
          </div>

          {/* Total Wages */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-slate-400 mb-2 uppercase">
                  Total Wages
                </p>
                <p className="text-3xl font-bold text-green-300">
                  {currencySymbol}
                  {payrollData.totalWages.toLocaleString("en-US", {
                    maximumFractionDigits: 2,
                  })}
                </p>
                <p className="text-xs text-slate-500 mt-2">
                  ~${inUSD.toLocaleString("en-US", { maximumFractionDigits: 0 })} USD
                </p>
              </div>
              <DollarSign className="h-6 w-6 text-slate-600" />
            </div>
          </div>
        </div>

        {/* Additional Details */}
        <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
          <h4 className="text-sm font-bold text-white mb-4">Details</h4>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-xs text-slate-400 mb-1">Department</p>
              <p className="text-sm font-semibold text-white">
                {payrollData.department}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-1">Country</p>
              <p className="text-sm font-semibold text-white">
                {payrollData.country === "US" ? "United States" : "Philippines"}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-1">
                Gross Pay (Period)
              </p>
              <p className="text-sm font-bold text-green-300">
                {currencySymbol}
                {payrollData.totalWages.toLocaleString("en-US", {
                  maximumFractionDigits: 2,
                })}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-1">Calculation</p>
              <p className="text-sm text-slate-300">
                {payrollData.hoursWorked} hours × {currencySymbol}
                {payrollData.hourlyRate.toFixed(2)}/hr
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Payroll History */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">Payroll History</h3>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="px-3 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-white rounded transition flex items-center gap-1"
          >
            <LogOut className="h-3 w-3" />
            {showHistory ? "Hide" : "Show"} ({payrollHistory.length})
          </button>
        </div>

        {showHistory && (
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4 max-h-96 overflow-y-auto">
            {payrollHistory.length === 0 ? (
              <p className="text-slate-400 text-sm">No payroll history available</p>
            ) : (
              <div className="space-y-3">
                {payrollHistory.map((log) => (
                  <div
                    key={log.id}
                    className="bg-slate-800/50 rounded p-3 border border-white/5 hover:border-white/10 transition"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="text-xs font-bold text-white uppercase tracking-wider">
                          {log.action}
                        </p>
                        <p className="text-xs text-slate-400 mt-1">
                          {log.details}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-slate-500">
                          {new Date(log.timestamp).toLocaleDateString("en-US", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </p>
                        <p className="text-xs text-slate-500">
                          {new Date(log.timestamp).toLocaleTimeString("en-US", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </div>
                    {log.amount && (
                      <div className="pt-2 border-t border-white/5">
                        <p className="text-xs text-green-300 font-semibold">
                          Amount: {currencySymbol}
                          {log.amount.toLocaleString("en-US", {
                            maximumFractionDigits: 2,
                          })}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Information Box */}
      <div className="bg-blue-900/30 border border-blue-500/30 rounded-lg p-4">
        <p className="text-xs text-blue-200">
          <strong>Note:</strong> This payroll information is automatically
          synchronized from the Accounting Dashboard. If you notice any
          discrepancies, please contact the HR/Payroll department immediately.
        </p>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => {
            // Generate simple CSV
            const csv = `Employee Payroll Record\n\nName,${payrollData.name}\nDepartment,${payrollData.department}\nCountry,${payrollData.country}\nHours,${payrollData.hoursWorked}\nRate,${currencySymbol}${payrollData.hourlyRate}\nTotal,${currencySymbol}${payrollData.totalWages}\nGenerated,${new Date().toISOString()}`;
            const blob = new Blob([csv], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `payroll-${employeeId}-${new Date().toISOString().split("T")[0]}.csv`;
            link.click();
            URL.revokeObjectURL(url);
          }}
          className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-semibold transition text-sm"
        >
          Download as CSV
        </button>
        <button
          onClick={() => {
            // Print payroll
            window.print();
          }}
          className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded font-semibold transition text-sm"
        >
          Print
        </button>
      </div>
    </div>
  );
}

export default EmployeePayrollSection;
