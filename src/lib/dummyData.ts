/**
 * Comprehensive Dummy Data for Testing Complete Payroll System
 * 10 users with different roles, departments, salary levels, and complete payroll information
 */

export interface DummyEmployee {
  id: string;
  name: string;
  email: string;
  role: "Admin" | "Manager" | "Technician" | "CSR" | "Finance" | "Accounting" | "Operations";
  department: string;
  country: "US" | "PH";
  hireDate: string;
  hoursWorked: number;
  overtimeHours: number;
  ptoHours: number;
  absenceHours: number;
  holidayPay: number;
  hourlyRate: number;
  totalWages: number;
  status: "Active" | "Inactive" | "On Leave";
}

export const DUMMY_EMPLOYEES: DummyEmployee[] = [
  // US Employees - Mixed Roles and Salary Levels
  {
    id: "emp-us-001",
    name: "John Richardson",
    email: "john.richardson@ahsolutions.com",
    role: "Admin",
    department: "Management",
    country: "US",
    hireDate: "2023-01-15",
    hoursWorked: 160,
    overtimeHours: 5,
    ptoHours: 0,
    absenceHours: 0,
    holidayPay: 200,
    hourlyRate: 45.00, // Senior Admin
    totalWages: 7425,
    status: "Active",
  },
  {
    id: "emp-us-002",
    name: "Sarah Mitchell",
    email: "sarah.mitchell@ahsolutions.com",
    role: "Manager",
    department: "Operations",
    country: "US",
    hireDate: "2022-06-20",
    hoursWorked: 165,
    overtimeHours: 8,
    ptoHours: 0,
    absenceHours: 0,
    holidayPay: 200,
    hourlyRate: 38.50, // Operations Manager
    totalWages: 7160,
    status: "Active",
  },
  {
    id: "emp-us-003",
    name: "Michael Chen",
    email: "michael.chen@ahsolutions.com",
    role: "Technician",
    department: "Operations",
    country: "US",
    hireDate: "2021-11-03",
    hoursWorked: 170,
    overtimeHours: 12,
    ptoHours: 0,
    absenceHours: 0,
    holidayPay: 200,
    hourlyRate: 32.75, // Senior Technician
    totalWages: 6858.50,
    status: "Active",
  },
  {
    id: "emp-us-004",
    name: "Emily Watson",
    email: "emily.watson@ahsolutions.com",
    role: "Technician",
    department: "Operations",
    country: "US",
    hireDate: "2024-02-10",
    hoursWorked: 155,
    overtimeHours: 3,
    ptoHours: 8,
    absenceHours: 0,
    holidayPay: 0,
    hourlyRate: 28.00, // Junior Technician
    totalWages: 5156,
    status: "Active",
  },
  {
    id: "emp-us-005",
    name: "David Rodriguez",
    email: "david.rodriguez@ahsolutions.com",
    role: "CSR",
    department: "Customer Service",
    country: "US",
    hireDate: "2023-08-15",
    hoursWorked: 160,
    overtimeHours: 2,
    ptoHours: 0,
    absenceHours: 4,
    holidayPay: 100,
    hourlyRate: 22.50, // Customer Service Representative
    totalWages: 3695,
    status: "Active",
  },

  // PH Employees - Mixed Roles and Salary Levels
  {
    id: "emp-ph-001",
    name: "Maria Santos",
    email: "maria.santos@ahsolutions.com.ph",
    role: "Finance",
    department: "Finance",
    country: "PH",
    hireDate: "2022-03-10",
    hoursWorked: 160,
    overtimeHours: 4,
    ptoHours: 0,
    absenceHours: 0,
    holidayPay: 2000,
    hourlyRate: 850, // Senior Finance Officer
    totalWages: 139400,
    status: "Active",
  },
  {
    id: "emp-ph-002",
    name: "Juan Dela Cruz",
    email: "juan.delacruz@ahsolutions.com.ph",
    role: "Technician",
    department: "Operations",
    country: "PH",
    hireDate: "2023-05-20",
    hoursWorked: 168,
    overtimeHours: 6,
    ptoHours: 0,
    absenceHours: 0,
    holidayPay: 2000,
    hourlyRate: 650, // Technician
    totalWages: 115320,
    status: "Active",
  },
  {
    id: "emp-ph-003",
    name: "Anna Reyes",
    email: "anna.reyes@ahsolutions.com.ph",
    role: "Accounting",
    department: "Finance",
    country: "PH",
    hireDate: "2024-01-08",
    hoursWorked: 160,
    overtimeHours: 0,
    ptoHours: 16,
    absenceHours: 0,
    holidayPay: 1000,
    hourlyRate: 550, // Accounting Specialist
    totalWages: 81800,
    status: "On Leave",
  },
  {
    id: "emp-ph-004",
    name: "Carlos Gutierrez",
    email: "carlos.gutierrez@ahsolutions.com.ph",
    role: "CSR",
    department: "Customer Service",
    country: "PH",
    hireDate: "2023-11-12",
    hoursWorked: 158,
    overtimeHours: 2,
    ptoHours: 8,
    absenceHours: 2,
    holidayPay: 1000,
    hourlyRate: 480, // Customer Service Representative
    totalWages: 79384,
    status: "Active",
  },
  {
    id: "emp-ph-005",
    name: "Rosa Morales",
    email: "rosa.morales@ahsolutions.com.ph",
    role: "Operations",
    department: "Operations",
    country: "PH",
    hireDate: "2022-09-05",
    hoursWorked: 162,
    overtimeHours: 8,
    ptoHours: 0,
    absenceHours: 0,
    holidayPay: 2000,
    hourlyRate: 620, // Operations Coordinator
    totalWages: 106360,
    status: "Active",
  },
];

/**
 * Helper function to sync dummy data to localStorage
 * Call this on app initialization to populate the system
 */
export function initializeDummyData() {
  const existingEmployees = localStorage.getItem("payroll_employees");
  
  // Only initialize if no data exists
  if (!existingEmployees) {
    const employees = DUMMY_EMPLOYEES.map(emp => ({
      id: emp.id,
      name: emp.name,
      department: emp.department,
      country: emp.country,
      hoursWorked: emp.hoursWorked,
      hourlyRate: emp.hourlyRate,
      totalWages: emp.totalWages,
    }));
    
    localStorage.setItem("payroll_employees", JSON.stringify(employees));
    console.log("✅ Dummy payroll data initialized in localStorage");
  }

  // Initialize user profiles in localStorage
  const existingUsers = localStorage.getItem("system_users");
  if (!existingUsers) {
    const users = DUMMY_EMPLOYEES.map(emp => ({
      id: emp.id,
      name: emp.name,
      email: emp.email,
      role: emp.role,
      department: emp.department,
      country: emp.country,
      hireDate: emp.hireDate,
      status: emp.status,
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(emp.name)}&background=random`,
    }));
    
    localStorage.setItem("system_users", JSON.stringify(users));
    console.log("✅ Dummy user profiles initialized in localStorage");
  }

  // Initialize employee details
  const existingEmployeeDetails = localStorage.getItem("employee_details");
  if (!existingEmployeeDetails) {
    const details = DUMMY_EMPLOYEES.reduce((acc, emp) => {
      acc[emp.id] = {
        ...emp,
        overtimeCost: emp.overtimeHours * emp.hourlyRate * 1.5,
        regularPay: emp.hoursWorked * emp.hourlyRate,
        ptoPay: emp.ptoHours * emp.hourlyRate,
        grossPay: emp.totalWages,
        deductions: emp.totalWages * 0.15, // Assume 15% deductions for taxes
        netPay: emp.totalWages * 0.85,
      };
      return acc;
    }, {} as Record<string, any>);
    
    localStorage.setItem("employee_details", JSON.stringify(details));
    console.log("✅ Dummy employee details initialized in localStorage");
  }

  // Initialize audit logs
  const existingAuditLogs = localStorage.getItem("payroll_audit_logs");
  if (!existingAuditLogs) {
    const auditLogs = DUMMY_EMPLOYEES.flatMap((emp, index) => [
      {
        id: `log-${emp.id}-001`,
        timestamp: new Date(Date.now() - (DUMMY_EMPLOYEES.length - index) * 3600000).toISOString(),
        action: "generate",
        employeeId: emp.id,
        employeeName: emp.name,
        details: `Generated payroll: ${emp.hoursWorked} hours @ ${emp.country === "US" ? "$" : "₱"}${emp.hourlyRate}/hr = ${emp.country === "US" ? "$" : "₱"}${emp.totalWages}`,
        userId: "admin-user",
        amount: emp.totalWages,
      },
    ]);
    
    localStorage.setItem("payroll_audit_logs", JSON.stringify(auditLogs));
    console.log("✅ Dummy audit logs initialized in localStorage");
  }
}

/**
 * Get employee summary statistics
 */
export function getEmployeeStatistics() {
  const usEmployees = DUMMY_EMPLOYEES.filter(e => e.country === "US");
  const phEmployees = DUMMY_EMPLOYEES.filter(e => e.country === "PH");

  const usTotal = usEmployees.reduce((sum, e) => sum + e.totalWages, 0);
  const phTotal = phEmployees.reduce((sum, e) => sum + e.totalWages, 0);

  return {
    totalEmployees: DUMMY_EMPLOYEES.length,
    usEmployees: usEmployees.length,
    phEmployees: phEmployees.length,
    usPayroll: usTotal,
    phPayroll: phTotal,
    usAverageWage: usTotal / usEmployees.length,
    phAverageWage: phTotal / phEmployees.length,
    totalOvertimeHours: DUMMY_EMPLOYEES.reduce((sum, e) => sum + e.overtimeHours, 0),
    totalPTOHours: DUMMY_EMPLOYEES.reduce((sum, e) => sum + e.ptoHours, 0),
    activeEmployees: DUMMY_EMPLOYEES.filter(e => e.status === "Active").length,
    onLeave: DUMMY_EMPLOYEES.filter(e => e.status === "On Leave").length,
  };
}

/**
 * Get employee by ID
 */
export function getEmployeeById(id: string): DummyEmployee | undefined {
  return DUMMY_EMPLOYEES.find(e => e.id === id);
}

/**
 * Get employees by department
 */
export function getEmployeesByDepartment(department: string): DummyEmployee[] {
  return DUMMY_EMPLOYEES.filter(e => e.department === department);
}

/**
 * Get employees by country
 */
export function getEmployeesByCountry(country: "US" | "PH"): DummyEmployee[] {
  return DUMMY_EMPLOYEES.filter(e => e.country === country);
}

/**
 * Get employees by role
 */
export function getEmployeesByRole(role: string): DummyEmployee[] {
  return DUMMY_EMPLOYEES.filter(e => e.role === role);
}

/**
 * Calculate total payroll for filtered employees
 */
export function calculateTotalPayroll(employees: DummyEmployee[]): number {
  return employees.reduce((sum, e) => sum + e.totalWages, 0);
}

/**
 * Get payroll summary by country
 */
export function getPayrollByCountry(country: "US" | "PH") {
  const employees = getEmployeesByCountry(country);
  const total = calculateTotalPayroll(employees);
  const avgWage = total / employees.length;
  const overtime = employees.reduce((sum, e) => sum + (e.overtimeHours * e.hourlyRate * 1.5), 0);
  
  return {
    country,
    employeeCount: employees.length,
    totalPayroll: total,
    averageWage: avgWage,
    overtimeCost: overtime,
    employees,
  };
}

/**
 * Get payroll summary by department
 */
export function getPayrollByDepartment(department: string) {
  const employees = getEmployeesByDepartment(department);
  const total = calculateTotalPayroll(employees);
  
  return {
    department,
    employeeCount: employees.length,
    totalPayroll: total,
    averageWage: total / employees.length,
    employees,
  };
}

/**
 * Get role distribution
 */
export function getRoleDistribution() {
  const roles = [...new Set(DUMMY_EMPLOYEES.map(e => e.role))];
  return roles.map(role => ({
    role,
    count: DUMMY_EMPLOYEES.filter(e => e.role === role).length,
    employees: getEmployeesByRole(role),
  }));
}

/**
 * Reset all dummy data (for testing/development)
 */
export function resetAllDummyData() {
  localStorage.removeItem("payroll_employees");
  localStorage.removeItem("system_users");
  localStorage.removeItem("employee_details");
  localStorage.removeItem("payroll_audit_logs");
  console.log("✅ All dummy data cleared from localStorage");
  initializeDummyData();
}
