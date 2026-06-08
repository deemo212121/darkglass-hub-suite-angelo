/**
 * User Data Synchronization System
 * 
 * This module creates and synchronizes user-specific data across all modules:
 * - Timecards
 * - Payroll
 * - Attendance
 * - Announcements
 * - Employee Self-Service data
 * 
 * Each of the 10 employees gets personalized data loaded when they log in
 */

import { DUMMY_EMPLOYEES, type DummyEmployee } from "./dummyData";
import { 
  loadAnnouncementStore, 
  saveAnnouncementStore, 
  ANNOUNCEMENT_THREAD_ID 
} from "./announcements";

// Map employee emails to their IDs
const EMAIL_TO_EMPLOYEE_ID: Record<string, string> = DUMMY_EMPLOYEES.reduce((acc, emp) => {
  acc[emp.email.toLowerCase()] = emp.id;
  return acc;
}, {} as Record<string, string>);

/**
 * Get employee ID from email
 */
export function getEmployeeIdFromEmail(email: string | null): string | null {
  if (!email) return null;
  return EMAIL_TO_EMPLOYEE_ID[email.toLowerCase()] || null;
}

/**
 * Get employee data from email
 */
export function getEmployeeFromEmail(email: string | null): DummyEmployee | null {
  if (!email) return null;
  const employeeId = getEmployeeIdFromEmail(email);
  if (!employeeId) return null;
  return DUMMY_EMPLOYEES.find(e => e.id === employeeId) || null;
}

/**
 * Generate timecard data for a specific employee
 */
function generateTimecardDataForEmployee(employee: DummyEmployee) {
  const timecards = [];
  const startDate = new Date('2026-06-01');
  const endDate = new Date('2026-06-26');
  
  // Generate timecards for all weekdays in June 2026
  const currentDate = new Date(startDate);
  let dayCount = 0;
  
  while (currentDate <= endDate && dayCount < 20) {
    const dayOfWeek = currentDate.getDay();
    
    // Skip weekends
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      const month = String(currentDate.getMonth() + 1).padStart(2, '0');
      const day = String(currentDate.getDate()).padStart(2, '0');
      const year = currentDate.getFullYear();
      
      // Vary check-in times slightly by employee role
      let checkIn = "08:00";
      let checkOut = "17:00";
      let mealStart = "12:00";
      let mealEnd = "13:00";
      
      if (employee.role === "Admin") {
        checkIn = "14:55";
        checkOut = dayCount % 3 === 0 ? "22:30" : "23:41";
        mealStart = dayCount % 3 === 0 ? "19:30" : "17:00";
        mealEnd = dayCount % 3 === 0 ? "20:00" : "17:30";
      } else if (employee.role === "Manager") {
        checkIn = "08:00";
        checkOut = dayCount % 4 === 0 ? "20:00" : "17:00";
        mealStart = "12:00";
        mealEnd = "13:00";
      } else if (employee.role === "Technician") {
        checkIn = employee.country === "US" ? "09:00" : "10:00";
        checkOut = dayCount % 5 === 0 ? "20:00" : "18:00";
        mealStart = employee.country === "US" ? "12:30" : "13:00";
        mealEnd = employee.country === "US" ? "13:30" : "14:00";
      } else if (employee.role === "CSR") {
        checkIn = "08:15";
        checkOut = dayCount % 5 === 0 ? "18:15" : "17:15";
      } else if (employee.role === "Finance" || employee.role === "Accounting") {
        checkIn = employee.country === "US" ? "07:00" : "06:00";
        checkOut = dayCount % 6 === 0 ? (employee.country === "US" ? "19:00" : "16:00") : (employee.country === "US" ? "16:30" : "15:00");
        mealStart = "10:00";
        mealEnd = "11:00";
      }
      
      // Calculate working hours (checkout - checkin - meal break)
      const [inH, inM] = checkIn.split(':').map(Number);
      const [outH, outM] = checkOut.split(':').map(Number);
      const [mealStartH, mealStartM] = mealStart.split(':').map(Number);
      const [mealEndH, mealEndM] = mealEnd.split(':').map(Number);
      
      const totalMinutes = (outH * 60 + outM) - (inH * 60 + inM);
      const mealMinutes = (mealEndH * 60 + mealEndM) - (mealStartH * 60 + mealStartM);
      const workingMinutes = totalMinutes - mealMinutes;
      const workingHours = Math.floor(workingMinutes / 60);
      const workingMins = workingMinutes % 60;
      
      timecards.push({
        date: `${month}/${day}/${year}`,
        checkIn,
        mealStart,
        mealEnd,
        checkOut,
        working: `${workingHours}:${String(workingMins).padStart(2, '0')}:00`,
        rate: employee.hourlyRate,
        status: 'approved',
        notes: '',
      });
      
      dayCount++;
    }
    
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  return timecards;
}

/**
 * Generate attendance records for an employee
 */
function generateAttendanceDataForEmployee(employee: DummyEmployee) {
  const attendance = [];
  const startDate = new Date('2026-06-01');
  const endDate = new Date('2026-06-26');
  
  const currentDate = new Date(startDate);
  let dayCount = 0;
  
  while (currentDate <= endDate && dayCount < 20) {
    const dayOfWeek = currentDate.getDay();
    
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      const month = String(currentDate.getMonth() + 1).padStart(2, '0');
      const day = String(currentDate.getDate()).padStart(2, '0');
      const year = currentDate.getFullYear();
      
      // Most days are present, occasional absences based on employee data
      let status: 'present' | 'absent' | 'late' | 'pto' = 'present';
      
      if (employee.absenceHours > 0 && dayCount === 10) {
        status = 'absent';
      } else if (employee.ptoHours > 0 && (dayCount === 5 || dayCount === 15)) {
        status = 'pto';
      } else if (dayCount % 7 === 0) {
        status = 'late';
      }
      
      attendance.push({
        date: `${year}-${month}-${day}`,
        status,
        hoursWorked: status === 'absent' ? 0 : status === 'pto' ? 0 : 8,
        overtimeHours: status === 'present' && dayCount % 5 === 0 ? 2 : 0,
        notes: status === 'late' ? 'Arrived 15 minutes late' : '',
      });
      
      dayCount++;
    }
    
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  return attendance;
}

/**
 * Generate payslip data for an employee
 */
function generatePayslipDataForEmployee(employee: DummyEmployee, periodStart: string, periodEnd: string) {
  const regularPay = employee.hoursWorked * employee.hourlyRate;
  const overtimePay = employee.overtimeHours * employee.hourlyRate * 1.5;
  const ptoPay = employee.ptoHours * employee.hourlyRate;
  const grossPay = regularPay + overtimePay + ptoPay + employee.holidayPay;
  
  // Calculate deductions (simplified)
  const taxRate = employee.country === "US" ? 0.22 : 0.15; // US: 22%, PH: 15%
  const socialSecurityRate = employee.country === "US" ? 0.062 : 0.045; // US: 6.2%, PH: 4.5%
  const medicareRate = employee.country === "US" ? 0.0145 : 0.0125; // US: 1.45%, PH: 1.25%
  
  const federalTax = grossPay * taxRate;
  const socialSecurity = grossPay * socialSecurityRate;
  const medicare = grossPay * medicareRate;
  const totalDeductions = federalTax + socialSecurity + medicare;
  const netPay = grossPay - totalDeductions;
  
  return {
    employeeId: employee.id,
    employeeName: employee.name,
    employeeEmail: employee.email,
    department: employee.department,
    periodStart,
    periodEnd,
    payDate: new Date(new Date(periodEnd).getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 3 days after period end
    
    // Earnings
    hoursWorked: employee.hoursWorked,
    hourlyRate: employee.hourlyRate,
    regularPay,
    overtimeHours: employee.overtimeHours,
    overtimePay,
    ptoHours: employee.ptoHours,
    ptoPay,
    holidayPay: employee.holidayPay,
    grossPay,
    
    // Deductions
    federalTax,
    socialSecurity,
    medicare,
    totalDeductions,
    
    // Net Pay
    netPay,
    
    // Currency
    currency: employee.country === "US" ? "USD" : "PHP",
    
    // Status
    status: 'processed',
    processedAt: new Date().toISOString(),
  };
}

/**
 * Initialize all data for a specific user when they log in
 */
export function initializeUserData(email: string | null) {
  if (!email || typeof window === "undefined") return;
  
  const employee = getEmployeeFromEmail(email);
  if (!employee) {
    console.warn(`No employee found for email: ${email}`);
    return;
  }
  
  console.log(`🔄 Initializing data for ${employee.name} (${employee.email})`);
  
  // 1. Store employee profile
  const userProfileKey = `user_profile_${employee.id}`;
  if (!localStorage.getItem(userProfileKey)) {
    localStorage.setItem(userProfileKey, JSON.stringify({
      id: employee.id,
      name: employee.name,
      email: employee.email,
      role: employee.role,
      department: employee.department,
      country: employee.country,
      hireDate: employee.hireDate,
      hourlyRate: employee.hourlyRate,
      status: employee.status,
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(employee.name)}&background=random`,
    }));
  }
  
  // 2. Generate and store timecard data
  const timecardKey = `timecards_${employee.id}`;
  if (!localStorage.getItem(timecardKey)) {
    const timecards = generateTimecardDataForEmployee(employee);
    localStorage.setItem(timecardKey, JSON.stringify(timecards));
    console.log(`  ✅ Generated ${timecards.length} timecard records`);
  }
  
  // 3. Generate and store attendance data
  const attendanceKey = `attendance_${employee.id}`;
  if (!localStorage.getItem(attendanceKey)) {
    const attendance = generateAttendanceDataForEmployee(employee);
    localStorage.setItem(attendanceKey, JSON.stringify(attendance));
    console.log(`  ✅ Generated ${attendance.length} attendance records`);
  }
  
  // 4. Generate and store payslip data for current period
  const payslipKey = `payslips_${employee.id}`;
  const existingPayslips = localStorage.getItem(payslipKey);
  if (!existingPayslips) {
    const payslips = [
      generatePayslipDataForEmployee(employee, '2026-06-01', '2026-06-15'),
      generatePayslipDataForEmployee(employee, '2026-06-16', '2026-06-30'),
    ];
    localStorage.setItem(payslipKey, JSON.stringify(payslips));
    console.log(`  ✅ Generated ${payslips.length} payslip records`);
  }
  
  // 5. Initialize user-specific announcements (keep shared but mark read status)
  const readStateKey = `announcement_read_${employee.id}`;
  if (!localStorage.getItem(readStateKey)) {
    localStorage.setItem(readStateKey, JSON.stringify([]));
  }
  
  console.log(`✅ Data initialization complete for ${employee.name}`);
}

/**
 * Get timecard data for logged-in user
 */
export function getUserTimecards(email: string | null) {
  const employee = getEmployeeFromEmail(email);
  if (!employee) return [];
  
  const timecardKey = `timecards_${employee.id}`;
  const stored = localStorage.getItem(timecardKey);
  if (!stored) {
    const timecards = generateTimecardDataForEmployee(employee);
    localStorage.setItem(timecardKey, JSON.stringify(timecards));
    return timecards;
  }
  
  return JSON.parse(stored);
}

/**
 * Get attendance data for logged-in user
 */
export function getUserAttendance(email: string | null) {
  const employee = getEmployeeFromEmail(email);
  if (!employee) return [];
  
  const attendanceKey = `attendance_${employee.id}`;
  const stored = localStorage.getItem(attendanceKey);
  if (!stored) {
    const attendance = generateAttendanceDataForEmployee(employee);
    localStorage.setItem(attendanceKey, JSON.stringify(attendance));
    return attendance;
  }
  
  return JSON.parse(stored);
}

/**
 * Get payslip data for logged-in user
 */
export function getUserPayslips(email: string | null) {
  const employee = getEmployeeFromEmail(email);
  if (!employee) return [];
  
  const payslipKey = `payslips_${employee.id}`;
  const stored = localStorage.getItem(payslipKey);
  if (!stored) {
    const payslips = [
      generatePayslipDataForEmployee(employee, '2026-06-01', '2026-06-15'),
      generatePayslipDataForEmployee(employee, '2026-06-16', '2026-06-30'),
    ];
    localStorage.setItem(payslipKey, JSON.stringify(payslips));
    return payslips;
  }
  
  return JSON.parse(stored);
}

/**
 * Clear all user data (for testing/reset)
 */
export function clearAllUserData() {
  if (typeof window === "undefined") return;
  
  DUMMY_EMPLOYEES.forEach(employee => {
    localStorage.removeItem(`user_profile_${employee.id}`);
    localStorage.removeItem(`timecards_${employee.id}`);
    localStorage.removeItem(`attendance_${employee.id}`);
    localStorage.removeItem(`payslips_${employee.id}`);
    localStorage.removeItem(`announcement_read_${employee.id}`);
  });
  
  console.log("✅ All user data cleared");
}

/**
 * Verify data integrity across modules
 */
export function verifyDataIntegrity(email: string | null): {
  timecards: boolean;
  attendance: boolean;
  payslips: boolean;
  profile: boolean;
  issues: string[];
} {
  const employee = getEmployeeFromEmail(email);
  if (!employee) {
    return {
      timecards: false,
      attendance: false,
      payslips: false,
      profile: false,
      issues: ['Employee not found'],
    };
  }
  
  const issues: string[] = [];
  const hasTimecards = !!localStorage.getItem(`timecards_${employee.id}`);
  const hasAttendance = !!localStorage.getItem(`attendance_${employee.id}`);
  const hasPayslips = !!localStorage.getItem(`payslips_${employee.id}`);
  const hasProfile = !!localStorage.getItem(`user_profile_${employee.id}`);
  
  if (!hasTimecards) issues.push('Missing timecard data');
  if (!hasAttendance) issues.push('Missing attendance data');
  if (!hasPayslips) issues.push('Missing payslip data');
  if (!hasProfile) issues.push('Missing profile data');
  
  return {
    timecards: hasTimecards,
    attendance: hasAttendance,
    payslips: hasPayslips,
    profile: hasProfile,
    issues,
  };
}
