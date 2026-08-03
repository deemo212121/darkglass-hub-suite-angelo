/**
 * System Data Initializer Component
 * Automatically initializes dummy data on app startup
 * Can be placed in root layout or app shell
 */

import { useEffect } from "react";
import { initializeDummyData, getEmployeeStatistics } from "@/lib/dummyData";

export function SystemDataInitializer() {
  useEffect(() => {
    // Initialize dummy data on component mount
    initializeDummyData();
    
    // Log statistics for debugging
    const stats = getEmployeeStatistics();
    console.log("📊 System Statistics:", {
      ...stats,
      description: "10 dummy employees distributed across US and Philippines with complete payroll data",
    });

    // Log available data sources
    console.log("📦 Available Data Sources:", {
      payrollEmployees: localStorage.getItem("payroll_employees") ? "✅ Loaded" : "❌ Not found",
      systemUsers: localStorage.getItem("system_users") ? "✅ Loaded" : "❌ Not found",
      employeeDetails: localStorage.getItem("employee_details") ? "✅ Loaded" : "❌ Not found",
      auditLogs: localStorage.getItem("payroll_audit_logs") ? "✅ Loaded" : "❌ Not found",
    });
  }, []);

  return null; // This component doesn't render anything
}

export default SystemDataInitializer;
