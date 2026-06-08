/**
 * Reset Dummy Data Script
 * Run this to clear localStorage and reinitialize with proper dummy data
 */

// Clear existing data
localStorage.removeItem("payroll_employees");
localStorage.removeItem("system_users");
localStorage.removeItem("employee_details");
localStorage.removeItem("payroll_audit_logs");

console.log("✅ Cleared all existing localStorage data");
console.log("🔄 Please refresh the page to reinitialize with proper dummy data from DUMMY_EMPLOYEES");

// The SystemDataInitializer will automatically reinitialize the data when the page loads