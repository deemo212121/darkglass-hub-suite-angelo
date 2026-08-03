/**
 * Data Flow Dashboard Component
 * Displays all dummy data and allows testing the entire payroll system
 * Useful for debugging and verifying data flows between components
 */

import { useEffect, useState } from "react";
import { RefreshCw, Download, Trash2, Eye, EyeOff } from "lucide-react";
import {
  getEmployeeStatistics,
  getPayrollByCountry,
  getPayrollByDepartment,
  getRoleDistribution,
  resetAllDummyData,
  DUMMY_EMPLOYEES,
} from "@/lib/dummyData";

interface DataFlowView {
  employees: boolean;
  users: boolean;
  details: boolean;
  auditLogs: boolean;
}

export function DataFlowDashboard() {
  const [stats, setStats] = useState<any>(null);
  const [showData, setShowData] = useState<DataFlowView>({
    employees: false,
    users: false,
    details: false,
    auditLogs: false,
  });
  const [refreshCount, setRefreshCount] = useState(0);

  const loadStats = () => {
    setStats(getEmployeeStatistics());
    setRefreshCount(prev => prev + 1);
  };

  useEffect(() => {
    loadStats();
  }, []);

  const getDataSize = (key: string): string => {
    const data = localStorage.getItem(key);
    if (!data) return "0 B";
    const bytes = new Blob([data]).size;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const exportAllData = () => {
    const allData = {
      employees: JSON.parse(localStorage.getItem("payroll_employees") || "[]"),
      users: JSON.parse(localStorage.getItem("system_users") || "[]"),
      details: JSON.parse(localStorage.getItem("employee_details") || "{}"),
      auditLogs: JSON.parse(localStorage.getItem("payroll_audit_logs") || "[]"),
      exportedAt: new Date().toISOString(),
    };

    const dataStr = JSON.stringify(allData, null, 2);
    const dataBlob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `payroll-system-data-${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (!stats) {
    return (
      <div className="p-6 text-center text-slate-400">
        <p>Loading system statistics...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 bg-slate-900/30 rounded-lg border border-white/10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full bg-green-400" />
          System Data Flow Dashboard
        </h2>
        <div className="flex gap-2">
          <button
            onClick={loadStats}
            className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-semibold transition flex items-center gap-1"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh ({refreshCount})
          </button>
          <button
            onClick={exportAllData}
            className="px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-semibold transition flex items-center gap-1"
          >
            <Download className="h-4 w-4" />
            Export
          </button>
          <button
            onClick={() => {
              if (confirm("This will clear all dummy data. Continue?")) {
                resetAllDummyData();
                loadStats();
              }
            }}
            className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-semibold transition flex items-center gap-1"
          >
            <Trash2 className="h-4 w-4" />
            Reset
          </button>
        </div>
      </div>

      {/* Statistics Grid */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <div className="bg-slate-800/50 rounded-lg p-3 border border-white/10">
          <p className="text-xs text-slate-400 mb-1">Total Employees</p>
          <p className="text-2xl font-bold text-blue-300">{stats.totalEmployees}</p>
          <p className="text-xs text-slate-500 mt-1">US: {stats.usEmployees} | PH: {stats.phEmployees}</p>
        </div>

        <div className="bg-slate-800/50 rounded-lg p-3 border border-white/10">
          <p className="text-xs text-slate-400 mb-1">Total Payroll</p>
          <p className="text-2xl font-bold text-green-300">
            ${(stats.usPayroll + stats.phPayroll / 57).toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </p>
          <p className="text-xs text-slate-500 mt-1">US + PH Combined</p>
        </div>

        <div className="bg-slate-800/50 rounded-lg p-3 border border-white/10">
          <p className="text-xs text-slate-400 mb-1">Total Overtime</p>
          <p className="text-2xl font-bold text-yellow-300">{stats.totalOvertimeHours}</p>
          <p className="text-xs text-slate-500 mt-1">hours</p>
        </div>

        <div className="bg-slate-800/50 rounded-lg p-3 border border-white/10">
          <p className="text-xs text-slate-400 mb-1">Active Employees</p>
          <p className="text-2xl font-bold text-emerald-300">{stats.activeEmployees}</p>
          <p className="text-xs text-slate-500 mt-1">On Leave: {stats.onLeave}</p>
        </div>
      </div>

      {/* Data Sources */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {[
          { key: "payroll_employees", label: "Payroll Employees", color: "blue" },
          { key: "system_users", label: "System Users", color: "purple" },
          { key: "employee_details", label: "Employee Details", color: "green" },
          { key: "payroll_audit_logs", label: "Audit Logs", color: "orange" },
        ].map(({ key, label, color }) => {
          const exists = !!localStorage.getItem(key);
          const size = getDataSize(key);
          const colorClass = {
            blue: "text-blue-400",
            purple: "text-purple-400",
            green: "text-green-400",
            orange: "text-orange-400",
          }[color];

          return (
            <div
              key={key}
              className="bg-slate-800/50 rounded-lg p-3 border border-white/10 cursor-pointer hover:border-white/20 transition"
              onClick={() => setShowData(prev => ({ ...prev, [key as keyof DataFlowView]: !prev[key as keyof DataFlowView] }))}
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-slate-300">{label}</p>
                <button className="text-slate-400 hover:text-white transition">
                  {showData[key as keyof DataFlowView] ? (
                    <EyeOff className="h-3 w-3" />
                  ) : (
                    <Eye className="h-3 w-3" />
                  )}
                </button>
              </div>
              <p className={`text-sm font-bold ${colorClass}`}>{exists ? "✅ Active" : "❌ Empty"}</p>
              <p className="text-xs text-slate-500 mt-1">{size}</p>
            </div>
          );
        })}
      </div>

      {/* Payroll Breakdowns */}
      <div className="grid gap-3 md:grid-cols-2">
        {/* US Payroll */}
        <div className="bg-slate-800/50 rounded-lg p-4 border border-white/10">
          <h3 className="text-sm font-bold text-white mb-3 text-blue-300">US Payroll</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">Total Cost</span>
              <span className="font-semibold text-green-300">${stats.usPayroll.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Employees</span>
              <span className="font-semibold text-blue-300">{stats.usEmployees}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Avg per Employee</span>
              <span className="font-semibold text-purple-300">
                ${stats.usAverageWage.toLocaleString("en-US", { maximumFractionDigits: 0 })}
              </span>
            </div>
          </div>
        </div>

        {/* PH Payroll */}
        <div className="bg-slate-800/50 rounded-lg p-4 border border-white/10">
          <h3 className="text-sm font-bold text-white mb-3 text-amber-300">PH Payroll</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">Total Cost</span>
              <span className="font-semibold text-green-300">₱{stats.phPayroll.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Employees</span>
              <span className="font-semibold text-blue-300">{stats.phEmployees}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Avg per Employee</span>
              <span className="font-semibold text-purple-300">
                ₱{stats.phAverageWage.toLocaleString("en-US", { maximumFractionDigits: 0 })}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Employee List */}
      <div className="bg-slate-800/50 rounded-lg p-4 border border-white/10">
        <h3 className="text-sm font-bold text-white mb-3">All 10 Dummy Employees</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[1000px]">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left py-2 px-2 text-slate-400 font-semibold">ID</th>
                <th className="text-left py-2 px-2 text-slate-400 font-semibold">Name</th>
                <th className="text-left py-2 px-2 text-slate-400 font-semibold">Role</th>
                <th className="text-left py-2 px-2 text-slate-400 font-semibold">Department</th>
                <th className="text-left py-2 px-2 text-slate-400 font-semibold">Country</th>
                <th className="text-center py-2 px-2 text-slate-400 font-semibold">Hours</th>
                <th className="text-center py-2 px-2 text-slate-400 font-semibold">OT</th>
                <th className="text-right py-2 px-2 text-slate-400 font-semibold">Rate</th>
                <th className="text-right py-2 px-2 text-slate-400 font-semibold">Total Wage</th>
                <th className="text-left py-2 px-2 text-slate-400 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {DUMMY_EMPLOYEES.map(emp => (
                <tr key={emp.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="py-2 px-2 font-mono text-slate-300">{emp.id.split("-").pop()}</td>
                  <td className="py-2 px-2 text-slate-300">{emp.name}</td>
                  <td className="py-2 px-2 text-blue-300 font-semibold">{emp.role}</td>
                  <td className="py-2 px-2 text-slate-300">{emp.department}</td>
                  <td className="py-2 px-2">
                    <span className={emp.country === "US" ? "text-green-300" : "text-amber-300"}>
                      {emp.country}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-center text-slate-300">{emp.hoursWorked}</td>
                  <td className="py-2 px-2 text-center text-yellow-300">{emp.overtimeHours}</td>
                  <td className="py-2 px-2 text-right text-slate-300">
                    {emp.country === "US" ? "$" : "₱"}
                    {emp.hourlyRate}
                  </td>
                  <td className="py-2 px-2 text-right font-semibold text-green-300">
                    {emp.country === "US" ? "$" : "₱"}
                    {emp.totalWages.toLocaleString()}
                  </td>
                  <td className="py-2 px-2">
                    <span
                      className={
                        emp.status === "Active"
                          ? "text-green-300"
                          : emp.status === "On Leave"
                            ? "text-yellow-300"
                            : "text-red-300"
                      }
                    >
                      {emp.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Instructions */}
      <div className="bg-blue-900/30 border border-blue-500/30 rounded-lg p-4">
        <h3 className="text-sm font-bold text-blue-300 mb-2">How to Use This Dashboard</h3>
        <ul className="text-xs text-blue-100 space-y-1">
          <li>✓ Click "Refresh" to reload statistics from localStorage</li>
          <li>✓ Click on data source cards to toggle data preview</li>
          <li>✓ Use "Export" to download all system data as JSON</li>
          <li>✓ Use "Reset" to clear and reinitialize all dummy data</li>
          <li>✓ Navigate to Accounting Dashboard Payroll tab to see live data</li>
          <li>✓ Navigate to Payroll Calculation page to see payroll calculations</li>
          <li>✓ Changes in one page automatically sync to other pages</li>
        </ul>
      </div>
    </div>
  );
}

export default DataFlowDashboard;
