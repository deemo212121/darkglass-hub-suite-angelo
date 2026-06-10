import { ChevronLeft, TrendingUp, AlertCircle, Download, CheckCircle2, AlertTriangle, X, Activity, BarChart3, LineChart as LineChartIcon, RefreshCw, Edit2, Save, Plus, Calendar, Bell } from "lucide-react";
import { useState, useMemo, useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { DUMMY_EMPLOYEES } from "@/lib/dummyData";
import { 
  createSalaryHistory, 
  addSalaryChange, 
  calculateSplitPayroll,
  SalaryHistory
} from "@/lib/payrollCalculations";
import {
  loadAnnouncementStore,
  saveAnnouncementStore,
  ANNOUNCEMENT_THREAD_ID,
} from "@/lib/announcements";

interface PayrollEmployee {
  id: string;
  name: string;
  department: string;
  country: "US" | "PH";
  hoursWorked: number;
  hourlyRate: number;
  totalWages: number;
}



interface Employee {
  id: string;
  name: string;
  department: string;
  hourlyRate: number; // Current rate
  salaryHistory: SalaryHistory; // Single SalaryHistory object
  currency: "USD" | "PHP";
}

interface PayrollData {
  employeeId: string;
  hoursWorked: number;
  overtimeHours: number;
  ptoHours: number;
  absenceHours: number;
  holidayPay: number;
}

interface PayrollCalculation {
  employeeId: string;
  employeeName: string;
  department: string;
  hoursWorked: number;
  overtimeHours: number;
  ptoHours: number;
  absenceHours: number;
  regularPay: number;
  overtimePay: number;
  ptoPay: number;
  holidayPay: number;
  grossPay: number;
  currency: "USD" | "PHP";
}

// Convert DUMMY_EMPLOYEES to Employee format for this component
const EMPLOYEES: Employee[] = DUMMY_EMPLOYEES.map(emp => ({
  id: emp.id,
  name: emp.name,
  department: emp.department,
  hourlyRate: emp.hourlyRate,
  currency: emp.country === "US" ? "USD" : "PHP",
  salaryHistory: {
    employeeId: emp.id,
    salaryEntries: [
      {
        id: `salary_initial_${emp.id}`,
        effectiveDate: new Date(emp.hireDate),
        hourlyRate: emp.hourlyRate * 0.9, // 10% less as starting salary
        reason: "initial" as const
      },
      {
        id: `salary_current_${emp.id}`,
        effectiveDate: new Date("2026-06-01"),
        hourlyRate: emp.hourlyRate,
        reason: "adjustment" as const
      }
    ]
  }
}));

// Generate PAYROLL_DATA based on DUMMY_EMPLOYEES
const PAYROLL_DATA: Record<string, PayrollData> = DUMMY_EMPLOYEES.reduce((acc, emp) => {
  acc[emp.id] = {
    employeeId: emp.id,
    hoursWorked: emp.hoursWorked,
    overtimeHours: emp.overtimeHours,
    ptoHours: emp.ptoHours,
    absenceHours: emp.absenceHours,
    holidayPay: emp.holidayPay
  };
  return acc;
}, {} as Record<string, PayrollData>);

const OT_MULTIPLIER = 1.5; // Overtime at 1.5x

export function PayrollCalculationPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef; }) {
  const [selectedDepartment, setSelectedDepartment] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(true);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [processedEmployees, setProcessedEmployees] = useState<string[]>([]);
  const [showSalaryHistory, setShowSalaryHistory] = useState<string | null>(null);
  const [payrollEmployees, setPayrollEmployees] = useState<PayrollEmployee[]>([]);
  const [editingEmployee, setEditingEmployee] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{
    hoursWorked: number;
    overtimeHours: number;
    ptoHours: number;
    absenceHours: number;
    holidayPay: number;
    hourlyRate: number;
  } | null>(null);
  
  // Salary change tracking
  const [salaryHistories, setSalaryHistories] = useState<Map<string, SalaryHistory>>(new Map());
  const [showSalaryChangeModal, setShowSalaryChangeModal] = useState<string | null>(null);
  const [salaryChangeForm, setSalaryChangeForm] = useState({
    effectiveDate: new Date().toISOString().split('T')[0],
    newRate: 0,
    reason: 'promotion'
  });
  const [dataSource, setDataSource] = useState<"accounting" | "local">("accounting");
  const [showTimecardModal, setShowTimecardModal] = useState<string | null>(null);
  const [timecardEdits, setTimecardEdits] = useState<{ [key: string]: any[] }>({});
  const [timecardNotes, setTimecardNotes] = useState<{ [key: string]: string }>({});
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [departmentFilter, setDepartmentFilter] = useState<string | null>(null);
  const [payrollStartDate, setPayrollStartDate] = useState<string>("2026-06-01");
  const [payrollEndDate, setPayrollEndDate] = useState<string>("2026-06-15");
  const downloadHandlerRef = useRef<() => void>(() => {});

  // Load payroll data from AccountingDashboard or use local data
  useEffect(() => {
    try {
      const storedEmployees = localStorage.getItem("payroll_employees");
      if (storedEmployees) {
        const employees = JSON.parse(storedEmployees);
        setPayrollEmployees(employees);
        setDataSource("accounting");
      } else {
        // Fallback to local employees if no shared data
        const localEmployees = EMPLOYEES.map(e => ({
          id: e.id,
          name: e.name,
          department: e.department,
          country: e.currency as "US" | "PH",
          hoursWorked: PAYROLL_DATA[e.id]?.hoursWorked || 160,
          hourlyRate: e.hourlyRate,
          totalWages: (PAYROLL_DATA[e.id]?.hoursWorked || 160) * e.hourlyRate,
        }));
        setPayrollEmployees(localEmployees);
        setDataSource("local");
      }
    } catch (error) {
      console.error("Error loading payroll employees:", error);
      setDataSource("local");
    }
  }, []);

  // Listen for updates from AccountingDashboard
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "payroll_employees") {
        try {
          const updated = JSON.parse(e.newValue || "[]");
          setPayrollEmployees(updated);
          setDataSource("accounting");
        } catch (error) {
          console.error("Error updating payroll employees:", error);
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  // Load saved notes when timecard modal opens
  useEffect(() => {
    if (showTimecardModal) {
      try {
        const savedNotes = localStorage.getItem("timecard_notes");
        if (savedNotes) {
          const notesMap = JSON.parse(savedNotes);
          if (notesMap[showTimecardModal] !== undefined) {
            setTimecardNotes(prev => ({ ...prev, [showTimecardModal]: notesMap[showTimecardModal] }));
          }
        }
        
        // Also load saved timecard edits if they exist
        const savedEdits = localStorage.getItem("timecard_edits");
        if (savedEdits) {
          const editsMap = JSON.parse(savedEdits);
          if (editsMap[showTimecardModal]) {
            setTimecardEdits(prev => ({ ...prev, [showTimecardModal]: editsMap[showTimecardModal] }));
          }
        }
      } catch (error) {
        console.error("Error loading saved notes:", error);
      }
    }
  }, [showTimecardModal]);

  const departments = [...new Set(EMPLOYEES.map(e => e.department))];

  // Helper function to calculate pro-rata pay when salary changes mid-period
  const calculateProRataPay = (employeeId: string, hoursWorked: number, periodStart: string, periodEnd: string) => {
    const employee = EMPLOYEES.find(e => e.id === employeeId);
    if (!employee) return 0;

    const salaryEntries = employee.salaryHistory.salaryEntries;

    // If no salary changes in this period, use current rate
    const changesInPeriod = salaryEntries.filter(
      h => h.effectiveDate >= new Date(periodStart) && h.effectiveDate <= new Date(periodEnd)
    );

    if (changesInPeriod.length === 0) {
      // No changes in period - use the rate that was active at period start
      const activeRate = salaryEntries
        .filter(h => h.effectiveDate <= new Date(periodStart))
        .sort((a, b) => b.effectiveDate.getTime() - a.effectiveDate.getTime())[0];
      return hoursWorked * (activeRate?.hourlyRate || employee.hourlyRate);
    }

    // Has changes - calculate pro-rata
    const sortedEntries = [...salaryEntries].sort(
      (a, b) => a.effectiveDate.getTime() - b.effectiveDate.getTime()
    );

    let totalPay = 0;
    let currentDate = new Date(periodStart);
    const endDate = new Date(periodEnd);

    for (let i = 0; i < sortedEntries.length; i++) {
      const changeDate = sortedEntries[i].effectiveDate;
      if (changeDate > endDate) break;

      const nextChangeDate = i + 1 < sortedEntries.length 
        ? sortedEntries[i + 1].effectiveDate
        : endDate;

      const rateStart = new Date(Math.max(currentDate.getTime(), changeDate.getTime()));
      const rateEnd = new Date(Math.min(endDate.getTime(), nextChangeDate.getTime()));

      const daysInRange = (rateEnd.getTime() - rateStart.getTime()) / (1000 * 60 * 60 * 24);
      const hoursInRange = (daysInRange / 7) * hoursWorked; // Pro-rata based on days

      totalPay += hoursInRange * sortedEntries[i].hourlyRate;
    }

    return totalPay;
  };

  // Helper function to check if an employee has salary changes in the current period
  const hasSalaryChange = (employeeId: string) => {
    const employee = EMPLOYEES.find(e => e.id === employeeId);
    if (!employee || !employee.salaryHistory) return false;

    // Check if any salary entry falls within the payroll period
    return employee.salaryHistory.salaryEntries.some(
      h => h.effectiveDate >= new Date(payrollStartDate) && h.effectiveDate <= new Date(payrollEndDate) && h.reason !== "initial"
    );
  };

  // Calculate gross pay, overtime pay, etc.
  const calculatePayrollForPeriod = (
    hoursWorked: number,
    overtimeHours: number,
    ptoHours: number,
    hourlyRate: number,
    startDate: string,
    endDate: string
  ) => {
    // Calculate prorated hours for the selected period
    // Full month is typically 160 hours for US employees (20 working days × 8 hours)
    // or 176 hours (22 working days × 8 hours)
    const fullMonthHours = 160;
    
    // Parse dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    const daysInPeriod = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    
    // Estimate working days (assuming 5 work days per week, excluding weekends)
    const totalWeekDays = daysInPeriod - Math.floor(daysInPeriod / 7) * 2; // Subtract weekends
    const hoursPerDay = 8;
    const estimatedHours = totalWeekDays * hoursPerDay;
    
    // Pro-rata calculation
    const proRataFactor = estimatedHours / fullMonthHours;
    const prorataHours = Math.ceil(hoursWorked * proRataFactor);
    const prorataOT = Math.ceil(overtimeHours * proRataFactor);
    const prorataOTO = Math.ceil(ptoHours * proRataFactor);

    const regularPay = prorataHours * hourlyRate;
    const overtimePay = prorataOT * hourlyRate * OT_MULTIPLIER;
    const ptoPay = prorataOTO * hourlyRate;
    const grossPay = regularPay + overtimePay + ptoPay;

    return {
      hoursWorked: prorataHours,
      overtimeHours: prorataOT,
      ptoHours: prorataOTO,
      regularPay: Math.round(regularPay * 100) / 100,
      overtimePay: Math.round(overtimePay * 100) / 100,
      ptoPay: Math.round(ptoPay * 100) / 100,
      grossPay: Math.round(grossPay * 100) / 100,
    };
  };

  const payrollCalculations = useMemo<PayrollCalculation[]>(() => {
    // Merge AccountingDashboard data with local EMPLOYEES data
    const employeeMap = new Map(EMPLOYEES.map(e => [e.id, e]));
    
    // Use payrollEmployees if available, otherwise fall back to EMPLOYEES
    const dataSource = payrollEmployees.length > 0 ? payrollEmployees : EMPLOYEES.map(e => ({
      id: e.id,
      name: e.name,
      department: e.department,
      country: e.currency as "US" | "PH",
      hoursWorked: PAYROLL_DATA[e.id]?.hoursWorked || 160,
      hourlyRate: e.hourlyRate,
      totalWages: 0,
    }));

    return dataSource.map((emp: any) => {
      const localEmployee = employeeMap.get(emp.id);
      const data = PAYROLL_DATA[emp.id];
      if (!data && !payrollEmployees.length) return null;

      // Use from AccountingDashboard if available
      const hoursWorked = emp.hoursWorked || data?.hoursWorked || 160;
      const hourlyRate = emp.hourlyRate || localEmployee?.hourlyRate || 0;
      
      // Calculate based on AccountingDashboard data if available
      const overtimeHours = data?.overtimeHours || 0;
      const ptoHours = data?.ptoHours || 0;
      const absenceHours = data?.absenceHours || 0;

      // Calculate payroll for selected period
      const payrollData = calculatePayrollForPeriod(
        hoursWorked,
        overtimeHours,
        ptoHours,
        hourlyRate,
        payrollStartDate,
        payrollEndDate
      );

      return {
        employeeId: emp.id,
        employeeName: emp.name,
        department: emp.department,
        hoursWorked: payrollData.hoursWorked,
        overtimeHours: payrollData.overtimeHours,
        ptoHours: payrollData.ptoHours,
        absenceHours,
        regularPay: payrollData.regularPay,
        overtimePay: payrollData.overtimePay,
        ptoPay: payrollData.ptoPay,
        grossPay: payrollData.grossPay,
        currency: emp.country || localEmployee?.currency || "USD",
      };
    }).filter(Boolean) as PayrollCalculation[];
  }, [payrollEmployees, payrollStartDate, payrollEndDate]);

  const filteredPayroll = useMemo(() => {
    return payrollCalculations.filter(p => {
      // Filter by department
      if (departmentFilter && p.department !== departmentFilter) {
        return false;
      }
      
      // Filter by search query (employee name)
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        return p.employeeName.toLowerCase().includes(query);
      }
      
      return true;
    });
  }, [payrollCalculations, departmentFilter, searchQuery]);

  const totalGrossPay = useMemo(() => {
    return Math.round(filteredPayroll.reduce((sum, p) => sum + p.grossPay, 0) * 100) / 100;
  }, [filteredPayroll]);

  // Validation helpers - MEMOIZED to prevent infinite render loops
  const issues = useMemo(() => {
    const issues = [];
    const employeesWithAbsences = filteredPayroll.filter(p => p.absenceHours > 0);
    const employeesWithoutHours = filteredPayroll.filter(p => p.hoursWorked === 0);
    const employeesOvertime = filteredPayroll.filter(p => p.overtimeHours > 20);

    if (employeesWithAbsences.length > 0) {
      issues.push({
        type: "warning",
        message: `${employeesWithAbsences.length} employee(s) have absence hours recorded`,
        severity: "medium",
      });
    }
    if (employeesWithoutHours.length > 0) {
      issues.push({
        type: "error",
        message: `${employeesWithoutHours.length} employee(s) have no hours recorded`,
        severity: "high",
      });
    }
    if (employeesOvertime.length > 0) {
      issues.push({
        type: "warning",
        message: `${employeesOvertime.length} employee(s) have excessive overtime (>20 hours)`,
        severity: "medium",
      });
    }
    return issues;
  }, [filteredPayroll]);

  const hasErrors = issues.some(i => i.severity === "high");

  const handleProcessPayroll = () => {
    setProcessedEmployees(filteredPayroll.map(p => p.employeeId));
    
    // Create announcements for each employee
    const store = loadAnnouncementStore();
    const announcementThread = store[ANNOUNCEMENT_THREAD_ID] || [];
    
    filteredPayroll.forEach((payroll) => {
      const employee = DUMMY_EMPLOYEES.find(e => e.id === payroll.employeeId);
      if (employee) {
        // Check if an announcement for this employee and payroll period already exists
        const existingAnnouncement = announcementThread.find(
          (msg: any) =>
            msg.id.includes(`payroll-processed-${payroll.employeeId}`) &&
            msg.body.includes(`${payrollStartDate} to ${payrollEndDate}`)
        );
        
        // Only add if it doesn't already exist
        if (!existingAnnouncement) {
          const payslipLink = `http://localhost:8080/m/dashboard/employee-self-service`;
          const message = {
            id: `payroll-processed-${payroll.employeeId}-${payrollStartDate}-${payrollEndDate}`,
            sender: "Payroll System",
            body: `Your payslip for the period ${payrollStartDate} to ${payrollEndDate} is now ready! You can view your payslip on the Employee Self-Service Portal: ${payslipLink}`,
            createdAt: new Date().toISOString(),
            kind: "other" as const,
          };
          announcementThread.push(message);
        }
      }
    });
    
    store[ANNOUNCEMENT_THREAD_ID] = announcementThread;
    saveAnnouncementStore(store);
    
    setShowConfirmDialog(false);
    setTimeout(() => {
      setProcessedEmployees([]);
    }, 3000);
  };

  // Update download handler in ref whenever dependencies change
  useEffect(() => {
    downloadHandlerRef.current = () => {
      const today = new Date().toISOString().split("T")[0];
      let csvContent = "Payroll Report\n";
      csvContent += `Date: ${today}\n\n`;
      csvContent += "Employee,Department,Hours Worked,Overtime Hours,Regular Pay,Overtime Pay,PTO Pay,Holiday Pay,Gross Pay\n";

      filteredPayroll.forEach(p => {
        csvContent += `"${p.employeeName}","${p.department}",${p.hoursWorked},${p.overtimeHours},$${p.regularPay.toFixed(2)},$${p.overtimePay.toFixed(2)},$${p.ptoPay.toFixed(2)},$${p.holidayPay.toFixed(2)},$${p.grossPay.toFixed(2)}\n`;
      });

      csvContent += `\nTotal Gross Pay,$${totalGrossPay.toFixed(2)}\n`;
      csvContent += `Average Per Employee,$${(totalGrossPay / filteredPayroll.length).toFixed(2)}\n`;

      const element = document.createElement("a");
      element.setAttribute("href", "data:text/csv;charset=utf-8," + encodeURIComponent(csvContent));
      element.setAttribute("download", `payroll-report-${today}.csv`);
      element.style.display = "none";
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
    };
  }, [filteredPayroll, totalGrossPay]);

  // Salary change handlers
  const initializeSalaryHistory = (employeeId: string, hourlyRate: number) => {
    if (!salaryHistories.has(employeeId)) {
      const history = createSalaryHistory(employeeId, hourlyRate, new Date('2026-06-01'));
      setSalaryHistories(prev => new Map(prev).set(employeeId, history));
    }
  };

  const handleRecordSalaryChange = (employeeId: string) => {
    let history = salaryHistories.get(employeeId);
    if (!history) {
      const employee = EMPLOYEES.find(e => e.id === employeeId);
      history = createSalaryHistory(employeeId, employee?.hourlyRate || 0, new Date('2026-06-01'));
    }

    const updatedHistory = addSalaryChange(
      history,
      new Date(salaryChangeForm.effectiveDate),
      salaryChangeForm.newRate,
      salaryChangeForm.reason as 'promotion' | 'demotion' | 'adjustment',
      `${salaryChangeForm.reason} recorded on ${new Date().toLocaleDateString()}`
    );

    setSalaryHistories(prev => new Map(prev).set(employeeId, updatedHistory));
    setShowSalaryChangeModal(null);
    setSalaryChangeForm({
      effectiveDate: new Date().toISOString().split('T')[0],
      newRate: 0,
      reason: 'promotion'
    });
  };

  const getSalaryChanges = (employeeId: string) => {
    const history = salaryHistories.get(employeeId);
    if (!history) return [];
    return history.salaryEntries.filter(e => e.reason !== 'initial');
  };

  const saveEdit = (employeeId: string) => {
    if (!editValues) return;

    // Update PAYROLL_DATA
    PAYROLL_DATA[employeeId] = {
      employeeId,
      hoursWorked: editValues.hoursWorked,
      overtimeHours: editValues.overtimeHours,
      ptoHours: editValues.ptoHours,
      absenceHours: editValues.absenceHours,
      holidayPay: editValues.holidayPay,
    };

    // Update employee hourly rate if changed
    const employee = EMPLOYEES.find(e => e.id === employeeId);
    if (employee && editValues.hourlyRate !== employee.hourlyRate) {
      employee.hourlyRate = editValues.hourlyRate;
    }

    // Update localStorage
    const storedEmployees = localStorage.getItem("payroll_employees");
    if (storedEmployees) {
      const employees = JSON.parse(storedEmployees);
      const updatedEmployees = employees.map((emp: PayrollEmployee) => {
        if (emp.id === employeeId) {
          return {
            ...emp,
            hoursWorked: editValues.hoursWorked,
            hourlyRate: editValues.hourlyRate,
            totalWages: (editValues.hoursWorked * editValues.hourlyRate) + (editValues.overtimeHours * editValues.hourlyRate * OT_MULTIPLIER),
          };
        }
        return emp;
      });
      localStorage.setItem("payroll_employees", JSON.stringify(updatedEmployees));
    }

    setEditingEmployee(null);
    setEditValues(null);
  };

  const cancelEdit = () => {
    setEditingEmployee(null);
    setEditValues(null);
  };

  const startEdit = (employeeId: string) => {
    const payroll = payrollCalculations.find(p => p.employeeId === employeeId);
    if (payroll) {
      setEditingEmployee(employeeId);
      setEditValues({
        hoursWorked: payroll.hoursWorked,
        overtimeHours: payroll.overtimeHours,
        ptoHours: payroll.ptoHours,
        absenceHours: payroll.absenceHours,
        holidayPay: payroll.holidayPay,
        hourlyRate: payroll.regularPay / payroll.hoursWorked || 0,
      });
    }
  };

  // Get timecard data for an employee
  const getTimecardData = (employeeId: string) => {
    // Map employee IDs to timecard data keys
    const employeeTimecardMap: { [key: string]: string } = {
      "emp-us-001": "001",
      "emp-us-002": "002",
      "emp-us-003": "003",
      "emp-us-004": "004",
      "emp-us-005": "005",
      "emp-ph-001": "006",
      "emp-ph-002": "007",
      "emp-ph-003": "008",
      "emp-ph-004": "009",
      "emp-ph-005": "010",
    };

    // Try to find the employee in the DUMMY_EMPLOYEES to get the correct ID mapping
    const employee = DUMMY_EMPLOYEES.find(e => e.id === employeeId);
    if (!employee) {
      console.warn(`Employee ${employeeId} not found in DUMMY_EMPLOYEES`);
      return [];
    }

    const mappedId = employeeTimecardMap[employeeId] || employeeId;
    
    // Helper function to check if a date string is within the payroll period
    const isDateInPeriod = (dateStr: string): boolean => {
      const [month, day, year] = dateStr.split('/').map(Number);
      const recordDate = new Date(year, month - 1, day);
      const startDate = new Date(payrollStartDate);
      const endDate = new Date(payrollEndDate);
      return recordDate >= startDate && recordDate <= endDate;
    };

    // Mock timecard data - in production this would come from a timesheet system
    const timecardDatabase: { [key: string]: any[] } = {
      "001": [ // John Richardson - Management
        { date: "06/01/2026", checkIn: "14:56", mealStart: "17:00", mealEnd: "17:30", checkOut: "23:43", working: "8:47:00", rate: 45 },
        { date: "06/02/2026", checkIn: "14:55", mealStart: "17:00", mealEnd: "17:30", checkOut: "23:41", working: "8:46:00", rate: 45 },
        { date: "06/03/2026", checkIn: "14:55", mealStart: "17:00", mealEnd: "17:30", checkOut: "23:41", working: "8:46:00", rate: 45 },
        { date: "06/04/2026", checkIn: "14:55", mealStart: "17:00", mealEnd: "17:30", checkOut: "23:40", working: "8:45:00", rate: 45 },
        { date: "06/05/2026", checkIn: "14:55", mealStart: "17:00", mealEnd: "17:30", checkOut: "23:44", working: "8:49:00", rate: 45 },
        { date: "06/08/2026", checkIn: "14:55", mealStart: "17:00", mealEnd: "17:30", checkOut: "23:41", working: "8:46:00", rate: 45 },
        { date: "06/09/2026", checkIn: "14:55", mealStart: "17:00", mealEnd: "17:30", checkOut: "23:45", working: "8:50:00", rate: 45 },
        { date: "06/10/2026", checkIn: "14:55", mealStart: "20:31", mealEnd: "21:02", checkOut: "22:42", working: "7:15:38", rate: 45 },
        { date: "06/11/2026", checkIn: "14:55", mealStart: "19:30", mealEnd: "20:00", checkOut: "22:37", working: "7:12:06", rate: 45 },
        { date: "06/12/2026", checkIn: "14:55", mealStart: "19:30", mealEnd: "20:00", checkOut: "22:30", working: "7:05:30", rate: 45 },
        { date: "06/15/2026", checkIn: "14:56", mealStart: "17:00", mealEnd: "17:30", checkOut: "23:43", working: "8:47:00", rate: 45 },
        { date: "06/16/2026", checkIn: "14:55", mealStart: "17:00", mealEnd: "17:30", checkOut: "23:41", working: "8:46:00", rate: 45 },
        { date: "06/17/2026", checkIn: "14:55", mealStart: "17:00", mealEnd: "17:30", checkOut: "23:41", working: "8:46:00", rate: 45 },
        { date: "06/18/2026", checkIn: "14:55", mealStart: "17:00", mealEnd: "17:30", checkOut: "23:40", working: "8:45:00", rate: 45 },
        { date: "06/19/2026", checkIn: "14:55", mealStart: "17:00", mealEnd: "17:30", checkOut: "23:44", working: "8:49:00", rate: 45 },
        { date: "06/22/2026", checkIn: "14:55", mealStart: "17:00", mealEnd: "17:30", checkOut: "23:41", working: "8:46:00", rate: 45 },
        { date: "06/23/2026", checkIn: "14:55", mealStart: "17:00", mealEnd: "17:30", checkOut: "23:45", working: "8:50:00", rate: 45 },
        { date: "06/24/2026", checkIn: "14:55", mealStart: "20:31", mealEnd: "21:02", checkOut: "22:42", working: "7:15:38", rate: 45 },
        { date: "06/25/2026", checkIn: "14:55", mealStart: "19:30", mealEnd: "20:00", checkOut: "22:37", working: "7:12:06", rate: 45 },
        { date: "06/26/2026", checkIn: "14:55", mealStart: "19:30", mealEnd: "20:00", checkOut: "22:30", working: "7:05:30", rate: 45 },
      ],
      "002": [ // Sarah Mitchell - Operations
        { date: "06/01/2026", checkIn: "08:00", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:00", working: "8:00:00", rate: 38.50 },
        { date: "06/02/2026", checkIn: "08:00", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:00", working: "8:00:00", rate: 38.50 },
        { date: "06/03/2026", checkIn: "08:00", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:00", working: "8:00:00", rate: 38.50 },
        { date: "06/04/2026", checkIn: "08:00", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:00", working: "8:00:00", rate: 38.50 },
        { date: "06/05/2026", checkIn: "08:00", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:00", working: "8:00:00", rate: 38.50 },
        { date: "06/08/2026", checkIn: "08:00", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:00", working: "8:00:00", rate: 38.50 },
        { date: "06/09/2026", checkIn: "08:00", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:00", working: "8:00:00", rate: 38.50 },
        { date: "06/10/2026", checkIn: "08:00", mealStart: "12:00", mealEnd: "13:00", checkOut: "20:00", working: "11:00:00", rate: 38.50 },
        { date: "06/11/2026", checkIn: "08:00", mealStart: "12:00", mealEnd: "13:00", checkOut: "18:30", working: "9:30:00", rate: 38.50 },
        { date: "06/12/2026", checkIn: "08:00", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:00", working: "8:00:00", rate: 38.50 },
        { date: "06/15/2026", checkIn: "08:00", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:00", working: "8:00:00", rate: 38.50 },
        { date: "06/16/2026", checkIn: "08:00", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:00", working: "8:00:00", rate: 38.50 },
        { date: "06/17/2026", checkIn: "08:00", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:00", working: "8:00:00", rate: 38.50 },
        { date: "06/18/2026", checkIn: "08:00", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:00", working: "8:00:00", rate: 38.50 },
        { date: "06/19/2026", checkIn: "08:00", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:00", working: "8:00:00", rate: 38.50 },
        { date: "06/22/2026", checkIn: "08:00", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:00", working: "8:00:00", rate: 38.50 },
        { date: "06/23/2026", checkIn: "08:00", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:00", working: "8:00:00", rate: 38.50 },
        { date: "06/24/2026", checkIn: "08:00", mealStart: "12:00", mealEnd: "13:00", checkOut: "20:00", working: "11:00:00", rate: 38.50 },
        { date: "06/25/2026", checkIn: "08:00", mealStart: "12:00", mealEnd: "13:00", checkOut: "18:30", working: "9:30:00", rate: 38.50 },
        { date: "06/26/2026", checkIn: "08:00", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:00", working: "8:00:00", rate: 38.50 },
      ],
      "003": [ // Michael Chen - Operations
        { date: "06/01/2026", checkIn: "09:00", mealStart: "12:30", mealEnd: "13:30", checkOut: "18:00", working: "8:00:00", rate: 32.75 },
        { date: "06/02/2026", checkIn: "09:00", mealStart: "12:30", mealEnd: "13:30", checkOut: "18:00", working: "8:00:00", rate: 32.75 },
        { date: "06/03/2026", checkIn: "09:00", mealStart: "12:30", mealEnd: "13:30", checkOut: "18:00", working: "8:00:00", rate: 32.75 },
        { date: "06/04/2026", checkIn: "09:00", mealStart: "12:30", mealEnd: "13:30", checkOut: "18:00", working: "8:00:00", rate: 32.75 },
        { date: "06/05/2026", checkIn: "09:00", mealStart: "12:30", mealEnd: "13:30", checkOut: "19:00", working: "9:00:00", rate: 32.75 },
        { date: "06/08/2026", checkIn: "09:00", mealStart: "12:30", mealEnd: "13:30", checkOut: "18:00", working: "8:00:00", rate: 32.75 },
        { date: "06/09/2026", checkIn: "09:00", mealStart: "12:30", mealEnd: "13:30", checkOut: "18:00", working: "8:00:00", rate: 32.75 },
        { date: "06/10/2026", checkIn: "09:00", mealStart: "12:30", mealEnd: "13:30", checkOut: "20:30", working: "11:00:00", rate: 32.75 },
        { date: "06/11/2026", checkIn: "09:00", mealStart: "12:30", mealEnd: "13:30", checkOut: "18:00", working: "8:00:00", rate: 32.75 },
        { date: "06/12/2026", checkIn: "09:00", mealStart: "12:30", mealEnd: "13:30", checkOut: "18:00", working: "8:00:00", rate: 32.75 },
        { date: "06/15/2026", checkIn: "09:00", mealStart: "12:30", mealEnd: "13:30", checkOut: "18:00", working: "8:00:00", rate: 32.75 },
        { date: "06/16/2026", checkIn: "09:00", mealStart: "12:30", mealEnd: "13:30", checkOut: "18:00", working: "8:00:00", rate: 32.75 },
        { date: "06/17/2026", checkIn: "09:00", mealStart: "12:30", mealEnd: "13:30", checkOut: "18:00", working: "8:00:00", rate: 32.75 },
        { date: "06/18/2026", checkIn: "09:00", mealStart: "12:30", mealEnd: "13:30", checkOut: "18:00", working: "8:00:00", rate: 32.75 },
        { date: "06/19/2026", checkIn: "09:00", mealStart: "12:30", mealEnd: "13:30", checkOut: "19:00", working: "9:00:00", rate: 32.75 },
        { date: "06/22/2026", checkIn: "09:00", mealStart: "12:30", mealEnd: "13:30", checkOut: "18:00", working: "8:00:00", rate: 32.75 },
        { date: "06/23/2026", checkIn: "09:00", mealStart: "12:30", mealEnd: "13:30", checkOut: "18:00", working: "8:00:00", rate: 32.75 },
        { date: "06/24/2026", checkIn: "09:00", mealStart: "12:30", mealEnd: "13:30", checkOut: "20:30", working: "11:00:00", rate: 32.75 },
        { date: "06/25/2026", checkIn: "09:00", mealStart: "12:30", mealEnd: "13:30", checkOut: "18:00", working: "8:00:00", rate: 32.75 },
        { date: "06/26/2026", checkIn: "09:00", mealStart: "12:30", mealEnd: "13:30", checkOut: "18:00", working: "8:00:00", rate: 32.75 },
      ],
      "004": [ // Emily Watson - Operations
        { date: "06/01/2026", checkIn: "07:00", mealStart: "11:00", mealEnd: "12:00", checkOut: "16:30", working: "8:30:00", rate: 28 },
        { date: "06/02/2026", checkIn: "07:00", mealStart: "11:00", mealEnd: "12:00", checkOut: "16:30", working: "8:30:00", rate: 28 },
        { date: "06/03/2026", checkIn: "07:00", mealStart: "11:00", mealEnd: "12:00", checkOut: "16:30", working: "8:30:00", rate: 28 },
        { date: "06/04/2026", checkIn: "07:00", mealStart: "11:00", mealEnd: "12:00", checkOut: "16:30", working: "8:30:00", rate: 28 },
        { date: "06/05/2026", checkIn: "07:00", mealStart: "11:00", mealEnd: "12:00", checkOut: "19:00", working: "11:00:00", rate: 28 },
        { date: "06/08/2026", checkIn: "07:00", mealStart: "11:00", mealEnd: "12:00", checkOut: "16:30", working: "8:30:00", rate: 28 },
        { date: "06/09/2026", checkIn: "07:00", mealStart: "11:00", mealEnd: "12:00", checkOut: "16:30", working: "8:30:00", rate: 28 },
        { date: "06/10/2026", checkIn: "07:00", mealStart: "11:00", mealEnd: "12:00", checkOut: "18:00", working: "10:00:00", rate: 28 },
        { date: "06/11/2026", checkIn: "07:00", mealStart: "11:00", mealEnd: "12:00", checkOut: "16:30", working: "8:30:00", rate: 28 },
        { date: "06/12/2026", checkIn: "07:00", mealStart: "11:00", mealEnd: "12:00", checkOut: "16:30", working: "8:30:00", rate: 28 },
        { date: "06/15/2026", checkIn: "07:00", mealStart: "11:00", mealEnd: "12:00", checkOut: "16:30", working: "8:30:00", rate: 28 },
        { date: "06/16/2026", checkIn: "07:00", mealStart: "11:00", mealEnd: "12:00", checkOut: "16:30", working: "8:30:00", rate: 28 },
        { date: "06/17/2026", checkIn: "07:00", mealStart: "11:00", mealEnd: "12:00", checkOut: "16:30", working: "8:30:00", rate: 28 },
        { date: "06/18/2026", checkIn: "07:00", mealStart: "11:00", mealEnd: "12:00", checkOut: "16:30", working: "8:30:00", rate: 28 },
        { date: "06/19/2026", checkIn: "07:00", mealStart: "11:00", mealEnd: "12:00", checkOut: "19:00", working: "11:00:00", rate: 28 },
        { date: "06/22/2026", checkIn: "07:00", mealStart: "11:00", mealEnd: "12:00", checkOut: "16:30", working: "8:30:00", rate: 28 },
        { date: "06/23/2026", checkIn: "07:00", mealStart: "11:00", mealEnd: "12:00", checkOut: "16:30", working: "8:30:00", rate: 28 },
        { date: "06/24/2026", checkIn: "07:00", mealStart: "11:00", mealEnd: "12:00", checkOut: "18:00", working: "10:00:00", rate: 28 },
        { date: "06/25/2026", checkIn: "07:00", mealStart: "11:00", mealEnd: "12:00", checkOut: "16:30", working: "8:30:00", rate: 28 },
        { date: "06/26/2026", checkIn: "07:00", mealStart: "11:00", mealEnd: "12:00", checkOut: "16:30", working: "8:30:00", rate: 28 },
      ],
      "005": [ // David Rodriguez - Customer Service
        { date: "06/01/2026", checkIn: "08:30", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:30", working: "8:00:00", rate: 22.50 },
        { date: "06/02/2026", checkIn: "08:30", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:30", working: "8:00:00", rate: 22.50 },
        { date: "06/03/2026", checkIn: "08:30", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:30", working: "8:00:00", rate: 22.50 },
        { date: "06/04/2026", checkIn: "08:30", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:30", working: "8:00:00", rate: 22.50 },
        { date: "06/05/2026", checkIn: "08:30", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:30", working: "8:00:00", rate: 22.50 },
        { date: "06/08/2026", checkIn: "08:30", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:30", working: "8:00:00", rate: 22.50 },
        { date: "06/09/2026", checkIn: "08:30", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:30", working: "8:00:00", rate: 22.50 },
        { date: "06/10/2026", checkIn: "08:30", mealStart: "12:00", mealEnd: "13:00", checkOut: "18:30", working: "9:00:00", rate: 22.50 },
        { date: "06/11/2026", checkIn: "08:30", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:30", working: "8:00:00", rate: 22.50 },
        { date: "06/12/2026", checkIn: "08:30", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:30", working: "8:00:00", rate: 22.50 },
        { date: "06/15/2026", checkIn: "08:30", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:30", working: "8:00:00", rate: 22.50 },
        { date: "06/16/2026", checkIn: "08:30", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:30", working: "8:00:00", rate: 22.50 },
        { date: "06/17/2026", checkIn: "08:30", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:30", working: "8:00:00", rate: 22.50 },
        { date: "06/18/2026", checkIn: "08:30", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:30", working: "8:00:00", rate: 22.50 },
        { date: "06/19/2026", checkIn: "08:30", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:30", working: "8:00:00", rate: 22.50 },
        { date: "06/22/2026", checkIn: "08:30", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:30", working: "8:00:00", rate: 22.50 },
        { date: "06/23/2026", checkIn: "08:30", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:30", working: "8:00:00", rate: 22.50 },
        { date: "06/24/2026", checkIn: "08:30", mealStart: "12:00", mealEnd: "13:00", checkOut: "18:30", working: "9:00:00", rate: 22.50 },
        { date: "06/25/2026", checkIn: "08:30", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:30", working: "8:00:00", rate: 22.50 },
        { date: "06/26/2026", checkIn: "08:30", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:30", working: "8:00:00", rate: 22.50 },
      ],
      "006": [ // Maria Santos - Finance
        { date: "06/01/2026", checkIn: "06:00", mealStart: "10:00", mealEnd: "11:00", checkOut: "15:00", working: "8:00:00", rate: 850 },
        { date: "06/02/2026", checkIn: "06:00", mealStart: "10:00", mealEnd: "11:00", checkOut: "15:00", working: "8:00:00", rate: 850 },
        { date: "06/03/2026", checkIn: "06:00", mealStart: "10:00", mealEnd: "11:00", checkOut: "15:00", working: "8:00:00", rate: 850 },
        { date: "06/04/2026", checkIn: "06:00", mealStart: "10:00", mealEnd: "11:00", checkOut: "15:00", working: "8:00:00", rate: 850 },
        { date: "06/05/2026", checkIn: "06:00", mealStart: "10:00", mealEnd: "11:00", checkOut: "15:00", working: "8:00:00", rate: 850 },
        { date: "06/08/2026", checkIn: "06:00", mealStart: "10:00", mealEnd: "11:00", checkOut: "15:00", working: "8:00:00", rate: 850 },
        { date: "06/09/2026", checkIn: "06:00", mealStart: "10:00", mealEnd: "11:00", checkOut: "15:00", working: "8:00:00", rate: 850 },
        { date: "06/10/2026", checkIn: "06:00", mealStart: "10:00", mealEnd: "11:00", checkOut: "16:00", working: "9:00:00", rate: 850 },
        { date: "06/11/2026", checkIn: "06:00", mealStart: "10:00", mealEnd: "11:00", checkOut: "15:00", working: "8:00:00", rate: 850 },
        { date: "06/12/2026", checkIn: "06:00", mealStart: "10:00", mealEnd: "11:00", checkOut: "15:00", working: "8:00:00", rate: 850 },
        { date: "06/15/2026", checkIn: "06:00", mealStart: "10:00", mealEnd: "11:00", checkOut: "15:00", working: "8:00:00", rate: 850 },
        { date: "06/16/2026", checkIn: "06:00", mealStart: "10:00", mealEnd: "11:00", checkOut: "15:00", working: "8:00:00", rate: 850 },
        { date: "06/17/2026", checkIn: "06:00", mealStart: "10:00", mealEnd: "11:00", checkOut: "15:00", working: "8:00:00", rate: 850 },
        { date: "06/18/2026", checkIn: "06:00", mealStart: "10:00", mealEnd: "11:00", checkOut: "15:00", working: "8:00:00", rate: 850 },
        { date: "06/19/2026", checkIn: "06:00", mealStart: "10:00", mealEnd: "11:00", checkOut: "15:00", working: "8:00:00", rate: 850 },
        { date: "06/22/2026", checkIn: "06:00", mealStart: "10:00", mealEnd: "11:00", checkOut: "15:00", working: "8:00:00", rate: 850 },
        { date: "06/23/2026", checkIn: "06:00", mealStart: "10:00", mealEnd: "11:00", checkOut: "15:00", working: "8:00:00", rate: 850 },
        { date: "06/24/2026", checkIn: "06:00", mealStart: "10:00", mealEnd: "11:00", checkOut: "16:00", working: "9:00:00", rate: 850 },
        { date: "06/25/2026", checkIn: "06:00", mealStart: "10:00", mealEnd: "11:00", checkOut: "15:00", working: "8:00:00", rate: 850 },
        { date: "06/26/2026", checkIn: "06:00", mealStart: "10:00", mealEnd: "11:00", checkOut: "15:00", working: "8:00:00", rate: 850 },
      ],
      "007": [ // Juan Dela Cruz - Operations
        { date: "06/01/2026", checkIn: "10:00", mealStart: "13:00", mealEnd: "14:00", checkOut: "19:00", working: "8:00:00", rate: 650 },
        { date: "06/02/2026", checkIn: "10:00", mealStart: "13:00", mealEnd: "14:00", checkOut: "19:00", working: "8:00:00", rate: 650 },
        { date: "06/03/2026", checkIn: "10:00", mealStart: "13:00", mealEnd: "14:00", checkOut: "19:00", working: "8:00:00", rate: 650 },
        { date: "06/04/2026", checkIn: "10:00", mealStart: "13:00", mealEnd: "14:00", checkOut: "19:00", working: "8:00:00", rate: 650 },
        { date: "06/05/2026", checkIn: "10:00", mealStart: "13:00", mealEnd: "14:00", checkOut: "19:00", working: "8:00:00", rate: 650 },
        { date: "06/08/2026", checkIn: "10:00", mealStart: "13:00", mealEnd: "14:00", checkOut: "19:00", working: "8:00:00", rate: 650 },
        { date: "06/09/2026", checkIn: "10:00", mealStart: "13:00", mealEnd: "14:00", checkOut: "19:00", working: "8:00:00", rate: 650 },
        { date: "06/10/2026", checkIn: "10:00", mealStart: "13:00", mealEnd: "14:00", checkOut: "20:00", working: "9:00:00", rate: 650 },
        { date: "06/11/2026", checkIn: "10:00", mealStart: "13:00", mealEnd: "14:00", checkOut: "19:00", working: "8:00:00", rate: 650 },
        { date: "06/12/2026", checkIn: "10:00", mealStart: "13:00", mealEnd: "14:00", checkOut: "19:00", working: "8:00:00", rate: 650 },
        { date: "06/15/2026", checkIn: "10:00", mealStart: "13:00", mealEnd: "14:00", checkOut: "19:00", working: "8:00:00", rate: 650 },
        { date: "06/16/2026", checkIn: "10:00", mealStart: "13:00", mealEnd: "14:00", checkOut: "19:00", working: "8:00:00", rate: 650 },
        { date: "06/17/2026", checkIn: "10:00", mealStart: "13:00", mealEnd: "14:00", checkOut: "19:00", working: "8:00:00", rate: 650 },
        { date: "06/18/2026", checkIn: "10:00", mealStart: "13:00", mealEnd: "14:00", checkOut: "19:00", working: "8:00:00", rate: 650 },
        { date: "06/19/2026", checkIn: "10:00", mealStart: "13:00", mealEnd: "14:00", checkOut: "19:00", working: "8:00:00", rate: 650 },
        { date: "06/22/2026", checkIn: "10:00", mealStart: "13:00", mealEnd: "14:00", checkOut: "19:00", working: "8:00:00", rate: 650 },
        { date: "06/23/2026", checkIn: "10:00", mealStart: "13:00", mealEnd: "14:00", checkOut: "19:00", working: "8:00:00", rate: 650 },
        { date: "06/24/2026", checkIn: "10:00", mealStart: "13:00", mealEnd: "14:00", checkOut: "20:00", working: "9:00:00", rate: 650 },
        { date: "06/25/2026", checkIn: "10:00", mealStart: "13:00", mealEnd: "14:00", checkOut: "19:00", working: "8:00:00", rate: 650 },
        { date: "06/26/2026", checkIn: "10:00", mealStart: "13:00", mealEnd: "14:00", checkOut: "19:00", working: "8:00:00", rate: 650 },
      ],
      "008": [ // Anna Reyes - Finance
        { date: "06/01/2026", checkIn: "07:30", mealStart: "11:30", mealEnd: "12:30", checkOut: "16:30", working: "8:00:00", rate: 550 },
        { date: "06/02/2026", checkIn: "07:30", mealStart: "11:30", mealEnd: "12:30", checkOut: "16:30", working: "8:00:00", rate: 550 },
        { date: "06/03/2026", checkIn: "07:30", mealStart: "11:30", mealEnd: "12:30", checkOut: "16:30", working: "8:00:00", rate: 550 },
        { date: "06/04/2026", checkIn: "07:30", mealStart: "11:30", mealEnd: "12:30", checkOut: "16:30", working: "8:00:00", rate: 550 },
        { date: "06/05/2026", checkIn: "07:30", mealStart: "11:30", mealEnd: "12:30", checkOut: "20:30", working: "12:00:00", rate: 550 },
        { date: "06/08/2026", checkIn: "07:30", mealStart: "11:30", mealEnd: "12:30", checkOut: "16:30", working: "8:00:00", rate: 550 },
        { date: "06/09/2026", checkIn: "07:30", mealStart: "11:30", mealEnd: "12:30", checkOut: "16:30", working: "8:00:00", rate: 550 },
        { date: "06/10/2026", checkIn: "07:30", mealStart: "11:30", mealEnd: "12:30", checkOut: "17:30", working: "9:00:00", rate: 550 },
        { date: "06/11/2026", checkIn: "07:30", mealStart: "11:30", mealEnd: "12:30", checkOut: "16:30", working: "8:00:00", rate: 550 },
        { date: "06/12/2026", checkIn: "07:30", mealStart: "11:30", mealEnd: "12:30", checkOut: "16:30", working: "8:00:00", rate: 550 },
        { date: "06/15/2026", checkIn: "07:30", mealStart: "11:30", mealEnd: "12:30", checkOut: "16:30", working: "8:00:00", rate: 550 },
        { date: "06/16/2026", checkIn: "07:30", mealStart: "11:30", mealEnd: "12:30", checkOut: "16:30", working: "8:00:00", rate: 550 },
        { date: "06/17/2026", checkIn: "07:30", mealStart: "11:30", mealEnd: "12:30", checkOut: "16:30", working: "8:00:00", rate: 550 },
        { date: "06/18/2026", checkIn: "07:30", mealStart: "11:30", mealEnd: "12:30", checkOut: "16:30", working: "8:00:00", rate: 550 },
        { date: "06/19/2026", checkIn: "07:30", mealStart: "11:30", mealEnd: "12:30", checkOut: "20:30", working: "12:00:00", rate: 550 },
        { date: "06/22/2026", checkIn: "07:30", mealStart: "11:30", mealEnd: "12:30", checkOut: "16:30", working: "8:00:00", rate: 550 },
        { date: "06/23/2026", checkIn: "07:30", mealStart: "11:30", mealEnd: "12:30", checkOut: "16:30", working: "8:00:00", rate: 550 },
        { date: "06/24/2026", checkIn: "07:30", mealStart: "11:30", mealEnd: "12:30", checkOut: "17:30", working: "9:00:00", rate: 550 },
        { date: "06/25/2026", checkIn: "07:30", mealStart: "11:30", mealEnd: "12:30", checkOut: "16:30", working: "8:00:00", rate: 550 },
        { date: "06/26/2026", checkIn: "07:30", mealStart: "11:30", mealEnd: "12:30", checkOut: "16:30", working: "8:00:00", rate: 550 },
      ],
      "009": [ // Carlos Gutierrez - Customer Service
        { date: "06/01/2026", checkIn: "08:15", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:15", working: "8:00:00", rate: 480 },
        { date: "06/02/2026", checkIn: "08:15", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:15", working: "8:00:00", rate: 480 },
        { date: "06/03/2026", checkIn: "08:15", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:15", working: "8:00:00", rate: 480 },
        { date: "06/04/2026", checkIn: "08:15", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:15", working: "8:00:00", rate: 480 },
        { date: "06/05/2026", checkIn: "08:15", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:15", working: "8:00:00", rate: 480 },
        { date: "06/08/2026", checkIn: "08:15", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:15", working: "8:00:00", rate: 480 },
        { date: "06/09/2026", checkIn: "08:15", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:15", working: "8:00:00", rate: 480 },
        { date: "06/10/2026", checkIn: "08:15", mealStart: "12:00", mealEnd: "13:00", checkOut: "18:15", working: "9:00:00", rate: 480 },
        { date: "06/11/2026", checkIn: "08:15", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:15", working: "8:00:00", rate: 480 },
        { date: "06/12/2026", checkIn: "08:15", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:15", working: "8:00:00", rate: 480 },
        { date: "06/15/2026", checkIn: "08:15", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:15", working: "8:00:00", rate: 480 },
        { date: "06/16/2026", checkIn: "08:15", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:15", working: "8:00:00", rate: 480 },
        { date: "06/17/2026", checkIn: "08:15", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:15", working: "8:00:00", rate: 480 },
        { date: "06/18/2026", checkIn: "08:15", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:15", working: "8:00:00", rate: 480 },
        { date: "06/19/2026", checkIn: "08:15", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:15", working: "8:00:00", rate: 480 },
        { date: "06/22/2026", checkIn: "08:15", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:15", working: "8:00:00", rate: 480 },
        { date: "06/23/2026", checkIn: "08:15", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:15", working: "8:00:00", rate: 480 },
        { date: "06/24/2026", checkIn: "08:15", mealStart: "12:00", mealEnd: "13:00", checkOut: "18:15", working: "9:00:00", rate: 480 },
        { date: "06/25/2026", checkIn: "08:15", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:15", working: "8:00:00", rate: 480 },
        { date: "06/26/2026", checkIn: "08:15", mealStart: "12:00", mealEnd: "13:00", checkOut: "17:15", working: "8:00:00", rate: 480 },
      ],
      "010": [ // Rosa Morales - Operations
        { date: "06/01/2026", checkIn: "06:30", mealStart: "10:30", mealEnd: "11:30", checkOut: "15:30", working: "8:00:00", rate: 620 },
        { date: "06/02/2026", checkIn: "06:30", mealStart: "10:30", mealEnd: "11:30", checkOut: "15:30", working: "8:00:00", rate: 620 },
        { date: "06/03/2026", checkIn: "06:30", mealStart: "10:30", mealEnd: "11:30", checkOut: "15:30", working: "8:00:00", rate: 620 },
        { date: "06/04/2026", checkIn: "06:30", mealStart: "10:30", mealEnd: "11:30", checkOut: "15:30", working: "8:00:00", rate: 620 },
        { date: "06/05/2026", checkIn: "06:30", mealStart: "10:30", mealEnd: "11:30", checkOut: "15:30", working: "8:00:00", rate: 620 },
        { date: "06/08/2026", checkIn: "06:30", mealStart: "10:30", mealEnd: "11:30", checkOut: "15:30", working: "8:00:00", rate: 620 },
        { date: "06/09/2026", checkIn: "06:30", mealStart: "10:30", mealEnd: "11:30", checkOut: "15:30", working: "8:00:00", rate: 620 },
        { date: "06/10/2026", checkIn: "06:30", mealStart: "10:30", mealEnd: "11:30", checkOut: "16:30", working: "9:00:00", rate: 620 },
        { date: "06/11/2026", checkIn: "06:30", mealStart: "10:30", mealEnd: "11:30", checkOut: "15:30", working: "8:00:00", rate: 620 },
        { date: "06/12/2026", checkIn: "06:30", mealStart: "10:30", mealEnd: "11:30", checkOut: "15:30", working: "8:00:00", rate: 620 },
        { date: "06/15/2026", checkIn: "06:30", mealStart: "10:30", mealEnd: "11:30", checkOut: "15:30", working: "8:00:00", rate: 620 },
        { date: "06/16/2026", checkIn: "06:30", mealStart: "10:30", mealEnd: "11:30", checkOut: "15:30", working: "8:00:00", rate: 620 },
        { date: "06/17/2026", checkIn: "06:30", mealStart: "10:30", mealEnd: "11:30", checkOut: "15:30", working: "8:00:00", rate: 620 },
        { date: "06/18/2026", checkIn: "06:30", mealStart: "10:30", mealEnd: "11:30", checkOut: "15:30", working: "8:00:00", rate: 620 },
        { date: "06/19/2026", checkIn: "06:30", mealStart: "10:30", mealEnd: "11:30", checkOut: "15:30", working: "8:00:00", rate: 620 },
        { date: "06/22/2026", checkIn: "06:30", mealStart: "10:30", mealEnd: "11:30", checkOut: "15:30", working: "8:00:00", rate: 620 },
        { date: "06/23/2026", checkIn: "06:30", mealStart: "10:30", mealEnd: "11:30", checkOut: "15:30", working: "8:00:00", rate: 620 },
        { date: "06/24/2026", checkIn: "06:30", mealStart: "10:30", mealEnd: "11:30", checkOut: "16:30", working: "9:00:00", rate: 620 },
        { date: "06/25/2026", checkIn: "06:30", mealStart: "10:30", mealEnd: "11:30", checkOut: "15:30", working: "8:00:00", rate: 620 },
        { date: "06/26/2026", checkIn: "06:30", mealStart: "10:30", mealEnd: "11:30", checkOut: "15:30", working: "8:00:00", rate: 620 },
      ],
    };

    // Return edited data if available, but filter by payroll period
    if (timecardEdits[employeeId]) {
      return timecardEdits[employeeId].filter((record: any) => isDateInPeriod(record.date));
    }
    
    // Return database data if available, but filter by payroll period
    const databaseData = timecardDatabase[mappedId];
    if (databaseData && databaseData.length > 0) {
      return databaseData.filter((record: any) => isDateInPeriod(record.date));
    }
    
    // Generate synthetic timecard data for the selected payroll period
    // This ensures timecard details always display hours instead of $0.00
    const payrollData = PAYROLL_DATA[employeeId];
    if (!payrollData) {
      return [];
    }
    
    // Calculate pro-rated hours for the selected period
    const fullMonthHours = 160;
    const start = new Date(payrollStartDate);
    const end = new Date(payrollEndDate);
    const daysInPeriod = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    
    // Estimate working days (assuming 5 work days per week, excluding weekends)
    const totalWeekDays = daysInPeriod - Math.floor(daysInPeriod / 7) * 2; // Subtract weekends
    const hoursPerDay = 8;
    const estimatedHours = totalWeekDays * hoursPerDay;
    
    // Pro-rata calculation
    const proRataFactor = estimatedHours / fullMonthHours;
    const prorataHours = Math.ceil(payrollData.hoursWorked * proRataFactor);
    const workDaysNeeded = Math.ceil(prorataHours / hoursPerDay);
    const syntheticTimecards = [];
    
    // Parse payroll period dates
    const startDate = new Date(payrollStartDate);
    const endDate = new Date(payrollEndDate);
    
    // Collect all weekdays within the payroll period
    const possibleWorkDays: Date[] = [];
    const currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
      const dayOfWeek = currentDate.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Skip Sunday (0) and Saturday (6)
        possibleWorkDays.push(new Date(currentDate));
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    // Generate timecards for the required number of work days within the period
    const rate = employee?.hourlyRate || 20;
    for (let i = 0; i < Math.min(workDaysNeeded, possibleWorkDays.length); i++) {
      const day = possibleWorkDays[i];
      const month = String(day.getMonth() + 1).padStart(2, '0');
      const dateDay = String(day.getDate()).padStart(2, '0');
      const year = day.getFullYear();
      
      syntheticTimecards.push({
        date: `${month}/${dateDay}/${year}`,
        checkIn: "08:00",
        mealStart: "12:00",
        mealEnd: "13:00",
        checkOut: "17:00",
        working: `${hoursPerDay}:00:00`,
        rate: rate
      });
    }
    
    return syntheticTimecards;
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-6">
            <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
              <ChevronLeft className="h-4 w-4" /> {mod.label}
            </Link>
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary" />
              {sub.title}
            </h1>
            <p className="text-sm text-muted-foreground">{sub.description}</p>
          </div>
        </div>

        <div className="space-y-6">
          {/* Data Source & Sync Indicator */}
          <div className="flex items-center justify-between gap-4 p-3 rounded-lg border border-blue-500/30 bg-blue-900/20">
            <div className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-blue-400" />
              <span className="text-sm text-slate-300">
                Data Source: <span className="font-semibold text-blue-300">
                  {dataSource === "accounting" ? "Accounting Dashboard (Real-time Sync)" : "Local Demo Data"}
                </span>
              </span>
            </div>
            <button
              onClick={() => {
                const storedEmployees = localStorage.getItem("payroll_employees");
                if (storedEmployees) {
                  setPayrollEmployees(JSON.parse(storedEmployees));
                  setDataSource("accounting");
                }
              }}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold transition flex items-center gap-1"
            >
              <RefreshCw className="h-3 w-3" />
              Sync Now
            </button>
          </div>
          {/* KPI Cards - Improved Hierarchy */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {/* Employees Ready */}
            <div className="bg-gradient-to-br from-green-500/10 to-green-600/5 border border-green-500/30 rounded-lg p-5 hover:border-green-500/50 transition">
              <div className="flex items-start justify-between mb-3">
                <CheckCircle2 className="h-5 w-5 text-green-400" />
                <span className="text-xs font-semibold text-green-400 bg-green-500/20 px-2 py-0.5 rounded">READY</span>
              </div>
              <p className="text-3xl font-bold text-white mb-1">{filteredPayroll.length}</p>
              <p className="text-xs text-slate-400 uppercase font-medium tracking-wide">Employees</p>
            </div>

            {/* Total Gross Pay */}
            <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/30 rounded-lg p-5 hover:border-emerald-500/50 transition">
              <div className="flex items-start justify-between mb-3">
                <TrendingUp className="h-5 w-5 text-emerald-400" />
                <span className="text-xs font-semibold text-emerald-400 bg-emerald-500/20 px-2 py-0.5 rounded">TOTAL</span>
              </div>
              <p className="text-3xl font-bold text-white mb-1">${(totalGrossPay / 1000).toFixed(1)}K</p>
              <p className="text-xs text-slate-400 uppercase font-medium tracking-wide">Gross Pay</p>
            </div>

            {/* Total Hours */}
            <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-500/30 rounded-lg p-5 hover:border-blue-500/50 transition">
              <div className="flex items-start justify-between mb-3">
                <Activity className="h-5 w-5 text-blue-400" />
                <span className="text-xs font-semibold text-blue-400 bg-blue-500/20 px-2 py-0.5 rounded">REGULAR</span>
              </div>
              <p className="text-3xl font-bold text-white mb-1">{filteredPayroll.reduce((sum, p) => sum + p.hoursWorked, 0).toFixed(0)}</p>
              <p className="text-xs text-slate-400 uppercase font-medium tracking-wide">Hours Worked</p>
            </div>

            {/* Overtime Hours */}
            <div className={`bg-gradient-to-br ${issues.filter(i => i.severity === "high").length > 0 ? 'from-red-500/10 to-red-600/5 border-red-500/30' : 'from-yellow-500/10 to-yellow-600/5 border-yellow-500/30'} border rounded-lg p-5 hover:border-opacity-70 transition`}>
              <div className="flex items-start justify-between mb-3">
                {issues.filter(i => i.severity === "high").length > 0 ? (
                  <AlertTriangle className="h-5 w-5 text-red-400" />
                ) : (
                  <Activity className="h-5 w-5 text-yellow-400" />
                )}
                <span className={`text-xs font-semibold ${issues.filter(i => i.severity === "high").length > 0 ? 'text-red-400 bg-red-500/20' : 'text-yellow-400 bg-yellow-500/20'} px-2 py-0.5 rounded`}>
                  {issues.filter(i => i.severity === "high").length > 0 ? 'ISSUES' : 'OVERTIME'}
                </span>
              </div>
              <p className={`text-3xl font-bold mb-1 ${issues.filter(i => i.severity === "high").length > 0 ? 'text-red-400' : 'text-white'}`}>
                {issues.filter(i => i.severity === "high").length > 0 
                  ? issues.filter(i => i.severity === "high").length 
                  : filteredPayroll.reduce((sum, p) => sum + p.overtimeHours, 0).toFixed(0)}
              </p>
              <p className="text-xs text-slate-400 uppercase font-medium tracking-wide">
                {issues.filter(i => i.severity === "high").length > 0 ? 'Errors Found' : 'OT Hours'}
              </p>
            </div>
          </div>

          {/* Payroll Period Selector */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 mb-6">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Calendar className="h-5 w-5 text-purple-400" />
              Payroll Period (Semi-Monthly)
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-slate-300">Cutoff Start Date</label>
                <input
                  type="date"
                  value={payrollStartDate}
                  onChange={(e) => setPayrollStartDate(e.target.value)}
                  className="px-4 py-2 bg-slate-700 border border-white/20 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500"
                />
                <p className="text-xs text-slate-400">First half of the month cutoff</p>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-slate-300">Cutoff End Date</label>
                <input
                  type="date"
                  value={payrollEndDate}
                  onChange={(e) => setPayrollEndDate(e.target.value)}
                  className="px-4 py-2 bg-slate-700 border border-white/20 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500"
                />
                <p className="text-xs text-slate-400">Second half of the month cutoff</p>
              </div>
            </div>
            <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4 mt-4">
              <p className="text-sm text-purple-300">
                <span className="font-semibold">Payroll Period:</span> {payrollStartDate} to {payrollEndDate}
              </p>
              <p className="text-xs text-purple-200 mt-2">
                💡 All payroll calculations, hours, and payments on this page are based on this period. Changes will reflect immediately across all tabs.
              </p>
            </div>
          </div>

          {/* MODULE 2: Payroll Error Detection */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              Payroll Error Detection
            </h2>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 mb-4">
              <div className={`border rounded p-3 ${issues.some(i => i.message.includes("no hours")) ? "bg-red-500/10 border-red-500/30" : "bg-slate-800/50 border-white/10"}`}>
                <p className="text-xs text-slate-400 font-semibold mb-1">Missing Clock-In</p>
                <p className={issues.some(i => i.message.includes("no hours")) ? "text-red-300" : "text-slate-300"}>{filteredPayroll.filter(p => p.hoursWorked === 0).length} employee(s)</p>
              </div>
              <div className={`border rounded p-3 ${issues.some(i => i.message.includes("excessive")) ? "bg-red-500/10 border-red-500/30" : "bg-slate-800/50 border-white/10"}`}>
                <p className="text-xs text-slate-400 font-semibold mb-1">Excessive Overtime</p>
                <p className={issues.some(i => i.message.includes("excessive")) ? "text-red-300" : "text-slate-300"}>{filteredPayroll.filter(p => p.overtimeHours > 20).length} employee(s)</p>
              </div>
              <div className={`border rounded p-3 ${issues.some(i => i.message.includes("absence")) ? "bg-yellow-500/10 border-yellow-500/30" : "bg-slate-800/50 border-white/10"}`}>
                <p className="text-xs text-slate-400 font-semibold mb-1">Absence Hours</p>
                <p className={issues.some(i => i.message.includes("absence")) ? "text-yellow-300" : "text-slate-300"}>{filteredPayroll.filter(p => p.absenceHours > 0).length} employee(s)</p>
              </div>
              <div className="bg-slate-800/50 border border-white/10 rounded p-3">
                <p className="text-xs text-slate-400 font-semibold mb-1">Missing Clock-Out</p>
                <p className="text-slate-300">0 employee(s)</p>
              </div>
              <div className="bg-slate-800/50 border border-white/10 rounded p-3">
                <p className="text-xs text-slate-400 font-semibold mb-1">Negative Hours</p>
                <p className="text-slate-300">0 employee(s)</p>
              </div>
              <div className="bg-slate-800/50 border border-white/10 rounded p-3">
                <p className="text-xs text-slate-400 font-semibold mb-1">Duplicate Records</p>
                <p className="text-slate-300">0 found</p>
              </div>
            </div>

            {/* Error Details */}
            {issues.length > 0 && (
              <div className={`border rounded-lg p-4 ${hasErrors ? "bg-red-500/10 border-red-500/40" : "bg-yellow-500/10 border-yellow-500/40"}`}>
                <h3 className={`text-sm font-bold mb-2 ${hasErrors ? "text-red-300" : "text-yellow-300"}`}>
                  {hasErrors ? "Critical Issues Found" : "Warnings"}
                </h3>
                <ul className="space-y-1">
                  {issues.map((issue, idx) => (
                    <li key={idx} className={`text-xs ${hasErrors ? "text-red-200" : "text-yellow-200"}`}>
                      • {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Salary Changes Quick Access Button */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white">Salary Changes Detected</h3>
              <p className="text-xs text-slate-400 mt-1">
                {filteredPayroll.filter(p => hasSalaryChange(p.employeeId)).length} employee(s) have salary changes in this period
              </p>
            </div>
            <button
              onClick={() => setShowSalaryHistory("list")}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-semibold text-sm"
            >
              <TrendingUp className="h-4 w-4" />
              View Details
            </button>
          </div>
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
            <h3 className="text-sm font-bold text-white mb-3">Filter by Department</h3>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedDepartment(null)}
                className={`px-3 py-1.5 rounded text-xs font-semibold transition ${
                  selectedDepartment === null
                    ? "bg-blue-600 text-white"
                    : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                }`}
              >
                All Departments
              </button>
              {departments.map(dept => (
                <button
                  key={dept}
                  onClick={() => setSelectedDepartment(dept)}
                  className={`px-3 py-1.5 rounded text-xs font-semibold transition ${
                    selectedDepartment === dept
                      ? "bg-blue-600 text-white"
                      : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  }`}
                >
                  {dept}
                </button>
              ))}
            </div>
          </div>

          {/* Payroll Summary */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <h3 className="text-sm font-bold text-white">Payroll Summary</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowConfirmDialog(true)}
                  disabled={hasErrors || processedEmployees.length > 0}
                  className={`flex items-center gap-2 px-4 py-2 rounded text-xs font-semibold transition ${
                    hasErrors || processedEmployees.length > 0
                      ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                      : "bg-green-600 hover:bg-green-700 text-white"
                  }`}
                >
                  <CheckCircle2 className="h-3 w-3" />
                  Process Payroll
                </button>
                <button
                  onClick={() => downloadHandlerRef.current()}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold transition"
                >
                  <Download className="h-3 w-3" />
                  Download
                </button>
              </div>
            </div>

            {processedEmployees.length > 0 && (
              <div className="bg-green-500/10 border border-green-500/40 rounded-lg p-4 mb-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0">
                    <CheckCircle2 className="h-5 w-5 text-green-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-green-300">✓ Payroll processed successfully!</p>
                    <p className="text-xs text-green-200 mt-1">{processedEmployees.length} employee(s) processed with a total gross pay of ${totalGrossPay.toFixed(2)}</p>
                    <p className="text-xs text-green-200 mt-2 flex items-center gap-1">
                      <Bell className="h-3 w-3" />
                      Announcements sent to all employees with payslip links
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-3 mb-4">
              <div className="bg-blue-500/10 border border-blue-500/30 rounded p-3">
                <p className="text-xs text-blue-300 mb-1">Total Employees</p>
                <p className="text-lg font-bold text-blue-300">{filteredPayroll.length}</p>
              </div>
              <div className="bg-green-500/10 border border-green-500/30 rounded p-3">
                <p className="text-xs text-green-300 mb-1">Total Gross Pay</p>
                <p className="text-lg font-bold text-green-300">${totalGrossPay.toFixed(2)}</p>
              </div>
              <div className="bg-purple-500/10 border border-purple-500/30 rounded p-3">
                <p className="text-xs text-purple-300 mb-1">Average Per Employee</p>
                <p className="text-lg font-bold text-purple-300">${(totalGrossPay / filteredPayroll.length).toFixed(2)}</p>
              </div>
            </div>
          </div>

          {/* Payroll Summary Banner - Redesigned */}
          <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border border-white/10 rounded-lg p-6 shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Activity className="h-5 w-5 text-emerald-400" />
                Payroll Summary
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={() => downloadHandlerRef.current()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-semibold text-sm flex items-center gap-2 shadow-lg"
                >
                  <Download className="h-4 w-4" />
                  Export CSV
                </button>
                <button
                  disabled={hasErrors}
                  onClick={() => setShowConfirmDialog(true)}
                  className={`px-4 py-2 rounded-lg transition font-semibold text-sm flex items-center gap-2 shadow-lg ${
                    hasErrors
                      ? "bg-slate-700 text-slate-500 cursor-not-allowed"
                      : "bg-green-600 hover:bg-green-700 text-white"
                  }`}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Process Payroll
                </button>
              </div>
            </div>
            
            <div className="grid gap-4 md:grid-cols-3">
              {/* Regular Hours & Pay */}
              <div className="bg-slate-800/50 border border-blue-500/20 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="h-4 w-4 text-blue-400" />
                  <p className="text-xs text-slate-400 font-semibold uppercase">Regular Time</p>
                </div>
                <div className="flex items-baseline justify-between">
                  <p className="text-2xl font-bold text-white">{filteredPayroll.reduce((sum, p) => sum + p.hoursWorked, 0).toFixed(0)}</p>
                  <p className="text-xs text-slate-400">hours</p>
                </div>
                <p className="text-sm text-blue-300 mt-2">${filteredPayroll.reduce((sum, p) => sum + p.regularPay, 0).toFixed(2)}</p>
              </div>

              {/* Overtime Hours & Pay */}
              <div className="bg-slate-800/50 border border-yellow-500/20 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="h-4 w-4 text-yellow-400" />
                  <p className="text-xs text-slate-400 font-semibold uppercase">Overtime</p>
                </div>
                <div className="flex items-baseline justify-between">
                  <p className="text-2xl font-bold text-white">{filteredPayroll.reduce((sum, p) => sum + p.overtimeHours, 0).toFixed(0)}</p>
                  <p className="text-xs text-slate-400">hours</p>
                </div>
                <p className="text-sm text-yellow-300 mt-2">${filteredPayroll.reduce((sum, p) => sum + p.overtimePay, 0).toFixed(2)}</p>
              </div>

              {/* Total Gross Pay */}
              <div className="bg-gradient-to-br from-emerald-600/20 to-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <p className="text-xs text-slate-400 font-semibold uppercase">Gross Pay</p>
                </div>
                <div className="flex items-baseline justify-between">
                  <p className="text-3xl font-bold text-emerald-300">${totalGrossPay.toFixed(2)}</p>
                </div>
                <p className="text-xs text-slate-400 mt-2">Avg: ${(totalGrossPay / filteredPayroll.length).toFixed(2)} per employee</p>
              </div>
            </div>
          </div>

          {/* Analytics Section - Streamlined */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-purple-400" />
                Analytics Overview
              </h2>
              <button className="text-xs text-slate-400 hover:text-white px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded transition">
                View Full Report
              </button>
            </div>
            
            <div className="grid md:grid-cols-2 gap-6">
              {/* Payroll Trends */}
              <div>
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <LineChartIcon className="h-4 w-4 text-green-400" />
                  Payroll Trends (Last 6 Periods)
                </h3>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={[
                    { period: "W1", grossPay: 5200 },
                    { period: "W2", grossPay: 5450 },
                    { period: "W3", grossPay: 5100 },
                    { period: "W4", grossPay: 5800 },
                    { period: "W5", grossPay: 5600 },
                    { period: "W6", grossPay: totalGrossPay },
                  ]}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="period" stroke="#94a3b8" fontSize={12} />
                    <YAxis stroke="#94a3b8" fontSize={12} />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: "#1e293b", 
                        border: "1px solid #334155",
                        borderRadius: "8px",
                        fontSize: "12px"
                      }} 
                    />
                    <Line type="monotone" dataKey="grossPay" stroke="#10b981" name="Gross Pay" strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Overtime Distribution */}
              <div>
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-yellow-400" />
                  Top 5 - Overtime Hours
                </h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={filteredPayroll
                    .sort((a, b) => b.overtimeHours - a.overtimeHours)
                    .slice(0, 5)
                    .map(p => ({
                      name: p.employeeName.split(' ')[0], // First name only
                      hours: p.hoursWorked,
                      overtime: p.overtimeHours
                    }))
                  }>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
                    <YAxis stroke="#94a3b8" fontSize={12} />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: "#1e293b", 
                        border: "1px solid #334155",
                        borderRadius: "8px",
                        fontSize: "12px"
                      }} 
                    />
                    <Bar dataKey="hours" fill="#3b82f6" name="Regular" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="overtime" fill="#fbbf24" name="Overtime" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Payroll Details Table - Redesigned for Efficiency */}
          {showTable && (
            <div className="bg-slate-900/50 border border-white/10 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between p-4 bg-slate-800/50 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-bold text-white">Employee Payroll</h3>
                  <span className="text-xs px-2 py-1 bg-blue-500/20 text-blue-300 rounded font-semibold">
                    {filteredPayroll.length} {filteredPayroll.length === 1 ? 'employee' : 'employees'}
                  </span>
                </div>
                <button
                  onClick={() => setShowTable(!showTable)}
                  className="text-xs text-slate-400 hover:text-white transition px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded"
                >
                  {showTable ? "Hide Table" : "Show Table"}
                </button>
              </div>

              {/* Search and Filter Controls - Streamlined */}
              <div className="p-4 bg-slate-800/30 border-b border-white/5">
                <div className="flex flex-col md:flex-row gap-3">
                  {/* Search Bar */}
                  <div className="relative flex-1">
                    <input
                      type="text"
                      placeholder="Search by employee name..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-700 border border-white/20 rounded-lg text-white placeholder-slate-400 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition"
                    />
                    <svg className="absolute left-3 top-3 h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery("")}
                        className="absolute right-3 top-3 text-slate-400 hover:text-white"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {/* Department Filter */}
                  <div className="md:w-64">
                    <select
                      value={departmentFilter || ""}
                      onChange={(e) => setDepartmentFilter(e.target.value || null)}
                      className="w-full px-4 py-2.5 bg-slate-700 border border-white/20 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition appearance-none cursor-pointer"
                    >
                      <option value="">All Departments</option>
                      {Array.from(new Set(payrollCalculations.map(p => p.department))).sort().map(dept => (
                        <option key={dept} value={dept}>{dept}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Table with Compact Design */}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-800/70 sticky top-0">
                    <tr className="border-b border-white/10">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">Employee</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">Department</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-300 uppercase tracking-wider">Hours</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-300 uppercase tracking-wider">OT</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-300 uppercase tracking-wider">Gross Pay</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300 uppercase tracking-wider">Status</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-slate-300 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {filteredPayroll.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                          <div className="flex flex-col items-center gap-2">
                            <AlertCircle className="h-8 w-8 text-slate-500" />
                            <p>No employees found matching your filters</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredPayroll
                        .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
                        .map(payroll => {
                          const hasIssue = payroll.absenceHours > 0 || payroll.hoursWorked === 0 || payroll.overtimeHours > 20;
                          let statusText = "Normal";
                          let statusColor = "text-green-400 bg-green-500/10 border-green-500/30";
                          
                          if (payroll.hoursWorked === 0) {
                            statusText = "No Hours";
                            statusColor = "text-red-400 bg-red-500/10 border-red-500/30";
                          } else if (payroll.overtimeHours > 20) {
                            statusText = "High OT";
                            statusColor = "text-yellow-400 bg-yellow-500/10 border-yellow-500/30";
                          } else if (payroll.ptoHours > 0) {
                            statusText = `PTO: ${payroll.ptoHours}h`;
                            statusColor = "text-blue-400 bg-blue-500/10 border-blue-500/30";
                          }
                          
                          return (
                            <tr 
                              key={payroll.employeeId} 
                              className={`transition hover:bg-white/5 ${hasIssue ? "bg-yellow-500/5" : ""}`}
                            >
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <div className="h-8 w-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-white">
                                    {payroll.employeeName.split(' ').map(n => n[0]).join('').substring(0, 2)}
                                  </div>
                                  <span className="text-sm font-medium text-white">{payroll.employeeName}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <span className="text-sm text-slate-300">{payroll.department}</span>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <span className="text-sm font-semibold text-blue-300">{payroll.hoursWorked}h</span>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <span className={`text-sm font-semibold ${payroll.overtimeHours > 20 ? 'text-yellow-300' : payroll.overtimeHours > 0 ? 'text-slate-300' : 'text-slate-500'}`}>
                                  {payroll.overtimeHours}h
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <span className="text-sm font-bold text-emerald-300">${payroll.grossPay.toFixed(2)}</span>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-semibold border ${statusColor}`}>
                                  {statusText}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-center gap-2">
                                  <button
                                    onClick={() => setShowTimecardModal(payroll.employeeId)}
                                    className="p-1.5 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 rounded transition"
                                    title="View timecard"
                                  >
                                    <Activity className="h-4 w-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Table Footer with Summary */}
              <div className="p-4 bg-slate-800/50 border-t border-white/10">
                <div className="flex flex-col md:flex-row items-center justify-between gap-3">
                  <p className="text-xs text-slate-400">
                    Showing <span className="font-semibold text-white">{filteredPayroll.length}</span> of{' '}
                    <span className="font-semibold text-white">{payrollCalculations.length}</span> employees
                  </p>
                  <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">Total Hours:</span>
                      <span className="font-semibold text-blue-300">{filteredPayroll.reduce((sum, p) => sum + p.hoursWorked + p.overtimeHours, 0).toFixed(0)}</span>
                    </div>
                    <div className="h-4 w-px bg-white/10" />
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">Total Pay:</span>
                      <span className="font-semibold text-emerald-300">${totalGrossPay.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Salary Changes List Modal */}
      {showSalaryHistory === "list" && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-3xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold text-white">Salary Changes & History</h2>
                <p className="text-sm text-slate-400 mt-1">
                  {filteredPayroll.filter(p => hasSalaryChange(p.employeeId)).length} employee(s) with changes in this period
                </p>
              </div>
              <button 
                onClick={() => setShowSalaryHistory(null)}
                className="text-slate-400 hover:text-white transition p-1"
              >
                ✕
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2 mb-6">
              {filteredPayroll.map(payroll => {
                const employee = EMPLOYEES.find(e => e.id === payroll.employeeId);
                const hasChange = hasSalaryChange(payroll.employeeId);
                const latestChange = employee?.salaryHistory.salaryEntries[employee.salaryHistory.salaryEntries.length - 1];
                
                return (
                  <div 
                    key={payroll.employeeId}
                    className={`border rounded-lg p-4 cursor-pointer transition ${
                      hasChange 
                        ? "bg-blue-500/10 border-blue-500/40 hover:bg-blue-500/15" 
                        : "bg-slate-800/50 border-white/10 hover:bg-slate-700/50"
                    }`}
                    onClick={() => setShowSalaryHistory(payroll.employeeId)}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="text-sm font-semibold text-white">{payroll.employeeName}</p>
                        <p className="text-xs text-slate-400">{payroll.department}</p>
                      </div>
                      {hasChange && (
                        <span className="inline-block px-2 py-1 bg-blue-600 text-blue-100 text-xs font-semibold rounded">
                          Changed
                        </span>
                      )}
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-slate-300">
                        <span className="text-slate-400">Current Rate:</span> <span className="text-green-300 font-semibold">${payroll.regularPay / payroll.hoursWorked}</span>/hr
                      </p>
                      {latestChange && (
                        <p className="text-xs text-slate-300">
                          <span className="text-slate-400">Effective:</span> <span className="text-yellow-300">{latestChange.effectiveDate.toLocaleDateString()}</span>
                        </p>
                      )}
                      {hasChange && (
                        <p className="text-xs text-blue-300 mt-2">
                          📊 Pro-rata calculation applied
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="bg-blue-500/10 border border-blue-500/40 rounded-lg p-4 mb-4">
              <h3 className="text-sm font-bold text-blue-300 mb-2">💡 Pro-rata Calculation</h3>
              <p className="text-xs text-blue-200">
                When an employee has a salary change during the payroll period, their pay is split proportionally:
              </p>
              <ul className="text-xs text-blue-200 mt-2 space-y-1">
                <li>• Days before change @ old rate</li>
                <li>• Days after change @ new rate</li>
                <li>• Total = (hours before × old rate) + (hours after × new rate)</li>
              </ul>
              <p className="text-xs text-blue-300 mt-3">
                💡 Click any card above to see detailed salary history
              </p>
            </div>

            <button
              onClick={() => setShowSalaryHistory(null)}
              className="w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition font-semibold text-sm"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Individual Employee Salary History Modal */}
      {showSalaryHistory && showSalaryHistory !== "list" && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-md w-full mx-4 max-h-[80vh] overflow-y-auto">
            {EMPLOYEES.find(e => e.id === showSalaryHistory) && (
              <>
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <h2 className="text-2xl font-bold text-white">Salary History</h2>
                    <p className="text-sm text-slate-400 mt-1">
                      {filteredPayroll.find(p => p.employeeId === showSalaryHistory)?.employeeName}
                    </p>
                  </div>
                  <button 
                    onClick={() => setShowSalaryHistory(null)}
                    className="text-slate-400 hover:text-white transition p-1"
                  >
                    ✕
                  </button>
                </div>

                <div className="space-y-3 mb-6">
                  {EMPLOYEES.find(e => e.id === showSalaryHistory)?.salaryHistory.salaryEntries.map((entry, idx) => (
                    <div key={idx} className="bg-slate-800/50 border border-white/10 rounded-lg p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-white">
                            ${entry.hourlyRate}/hr
                          </p>
                          <p className="text-xs text-slate-400 mt-1">
                            Effective: <span className="text-slate-300">{entry.effectiveDate.toLocaleDateString()}</span>
                          </p>
                          <p className="text-xs text-slate-400 mt-1">
                            Reason: <span className="text-blue-300">{entry.reason}</span>
                          </p>
                        </div>
                        {idx === EMPLOYEES.find(e => e.id === showSalaryHistory)?.salaryHistory.salaryEntries.length! - 1 && (
                          <span className="inline-block px-2 py-1 bg-green-600 text-green-100 text-xs font-semibold rounded whitespace-nowrap ml-2">
                            Current
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Pro-rata Calculation Info */}
                {hasSalaryChange(showSalaryHistory) && (
                  <div className="bg-blue-500/10 border border-blue-500/40 rounded-lg p-4 mb-4">
                    <h3 className="text-sm font-bold text-blue-300 mb-2">Pro-rata Applied</h3>
                    <p className="text-xs text-blue-200">
                      This employee had a salary change during the payroll period (Jun 1-15, 2026).
                    </p>
                    <ul className="text-xs text-blue-200 mt-2 space-y-1">
                      <li>• Split at change date</li>
                      <li>• Each period @ respective rate</li>
                      <li>• Fair & accurate total</li>
                    </ul>
                  </div>
                )}

                <button
                  onClick={() => setShowSalaryHistory("list")}
                  className="w-full px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg transition font-semibold text-sm mb-2"
                >
                  ← Back to List
                </button>
                <button
                  onClick={() => setShowSalaryHistory(null)}
                  className="w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition font-semibold text-sm"
                >
                  Close
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {showConfirmDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-start gap-3 mb-4">
              <AlertCircle className="h-6 w-6 text-blue-400 flex-shrink-0 mt-0.5" />
              <div>
                <h2 className="text-lg font-bold text-white">Process Payroll?</h2>
                <p className="text-sm text-slate-300 mt-1">
                  You are about to process payroll for <strong>{filteredPayroll.length} employee(s)</strong> with a total gross pay of <strong>${totalGrossPay.toFixed(2)}</strong>.
                </p>
              </div>
            </div>

            <div className="bg-slate-800/50 rounded-lg p-3 mb-4 text-xs text-slate-300 space-y-1 max-h-40 overflow-y-auto">
              <p className="font-semibold text-white mb-2">Summary:</p>
              {filteredPayroll.slice(0, 5).map(p => (
                <div key={p.employeeId} className="flex justify-between">
                  <span>{p.employeeName}</span>
                  <span className="text-green-300">${p.grossPay.toFixed(2)}</span>
                </div>
              ))}
              {filteredPayroll.length > 5 && (
                <p className="text-slate-400 mt-2">+ {filteredPayroll.length - 5} more employee(s)</p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmDialog(false)}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm font-semibold transition"
              >
                Cancel
              </button>
              <button
                onClick={handleProcessPayroll}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-semibold transition flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="h-4 w-4" />
                Confirm Process
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Timecard Modal */}
      {showTimecardModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-5xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold text-white">Timecard Details</h2>
                <p className="text-sm text-slate-400 mt-1">
                  {EMPLOYEES.find(e => e.id === showTimecardModal)?.name} - {filteredPayroll.find(p => p.employeeId === showTimecardModal)?.department}
                </p>
              </div>
              <button 
                onClick={() => setShowTimecardModal(null)}
                className="text-slate-400 hover:text-white transition p-1"
              >
                ✕
              </button>
            </div>

            {/* Timecard Table */}
            <div className="overflow-x-auto mb-6">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-800/50 border-b border-white/10">
                    <th className="px-4 py-3 text-left font-semibold text-slate-300">Date</th>
                    <th className="px-4 py-3 text-center font-semibold text-slate-300">Check In</th>
                    <th className="px-4 py-3 text-center font-semibold text-slate-300">Meal Start</th>
                    <th className="px-4 py-3 text-center font-semibold text-slate-300">Meal End</th>
                    <th className="px-4 py-3 text-center font-semibold text-slate-300">Check Out</th>
                    <th className="px-4 py-3 text-center font-semibold text-slate-300">Working</th>
                    <th className="px-4 py-3 text-center font-semibold text-slate-300">Rate</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-300">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {getTimecardData(showTimecardModal).map((record, idx) => {
                    // Calculate working hours by subtracting meal break from total time
                    const calculateWorkingHours = (checkIn: string, checkOut: string, mealStart: string, mealEnd: string) => {
                      if (!checkIn || !checkOut) return 0;
                      
                      const [inH, inM] = checkIn.split(':').map(Number);
                      const [outH, outM] = checkOut.split(':').map(Number);
                      const totalMinutes = (outH * 60 + outM) - (inH * 60 + inM);
                      
                      let mealMinutes = 30; // Default 30-minute meal break
                      if (mealStart && mealEnd) {
                        const [mealStartH, mealStartM] = mealStart.split(':').map(Number);
                        const [mealEndH, mealEndM] = mealEnd.split(':').map(Number);
                        mealMinutes = (mealEndH * 60 + mealEndM) - (mealStartH * 60 + mealStartM);
                      }
                      
                      const workingMinutes = Math.max(0, totalMinutes - mealMinutes);
                      const workingHours = (workingMinutes / 60).toFixed(2);
                      return parseFloat(workingHours);
                    };
                    
                    const workingHours = calculateWorkingHours(record.checkIn, record.checkOut, record.mealStart, record.mealEnd);
                    const totalPay = (workingHours * record.rate).toFixed(2);
                    
                    return (
                      <tr key={idx} className="border-b border-white/5 hover:bg-white/5">
                        <td className="px-4 py-3 text-slate-300">{record.date}</td>
                        <td className="px-4 py-3 text-center">
                          <input
                            type="time"
                            value={record.checkIn}
                            onChange={(e) => {
                              const updated = [...getTimecardData(showTimecardModal)];
                              updated[idx].checkIn = e.target.value;
                              setTimecardEdits(prev => ({ ...prev, [showTimecardModal]: updated }));
                            }}
                            className="w-20 px-2 py-1 bg-slate-700 border border-white/20 rounded text-white text-xs text-center"
                          />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input
                            type="time"
                            value={record.mealStart}
                            onChange={(e) => {
                              const updated = [...getTimecardData(showTimecardModal)];
                              updated[idx].mealStart = e.target.value;
                              setTimecardEdits(prev => ({ ...prev, [showTimecardModal]: updated }));
                            }}
                            className="w-20 px-2 py-1 bg-slate-700 border border-white/20 rounded text-white text-xs text-center"
                          />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input
                            type="time"
                            value={record.mealEnd}
                            onChange={(e) => {
                              const updated = [...getTimecardData(showTimecardModal)];
                              updated[idx].mealEnd = e.target.value;
                              setTimecardEdits(prev => ({ ...prev, [showTimecardModal]: updated }));
                            }}
                            className="w-20 px-2 py-1 bg-slate-700 border border-white/20 rounded text-white text-xs text-center"
                          />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input
                            type="time"
                            value={record.checkOut}
                            onChange={(e) => {
                              const updated = [...getTimecardData(showTimecardModal)];
                              updated[idx].checkOut = e.target.value;
                              setTimecardEdits(prev => ({ ...prev, [showTimecardModal]: updated }));
                            }}
                            className="w-20 px-2 py-1 bg-slate-700 border border-white/20 rounded text-white text-xs text-center"
                          />
                        </td>
                        <td className="px-4 py-3 text-center text-blue-300 font-semibold">{workingHours.toFixed(2)}h</td>
                        <td className="px-4 py-3 text-center">
                          <input
                            type="number"
                            value={record.rate}
                            onChange={(e) => {
                              const updated = [...getTimecardData(showTimecardModal)];
                              updated[idx].rate = Number(e.target.value);
                              setTimecardEdits(prev => ({ ...prev, [showTimecardModal]: updated }));
                            }}
                            className="w-16 px-2 py-1 bg-slate-700 border border-white/20 rounded text-white text-xs text-center"
                            min="0"
                            step="0.5"
                          />
                        </td>
                        <td className="px-4 py-3 text-right text-green-300 font-semibold">${totalPay}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Notes Section - Editable */}
            <div className="mb-6">
              <label className="text-sm font-semibold text-slate-300 mb-2 block">Notes</label>
              <textarea
                value={timecardNotes[showTimecardModal] !== undefined ? timecardNotes[showTimecardModal] : ""}
                onChange={(e) => setTimecardNotes(prev => ({ ...prev, [showTimecardModal]: e.target.value }))}
                className="w-full px-4 py-3 bg-slate-700 border border-white/20 rounded text-white text-sm"
                rows={3}
                placeholder="Add any notes here..."
              />
            </div>

            {/* Summary Section */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-slate-800/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 font-semibold mb-2">TOTAL</p>
                <p className="text-2xl font-bold text-green-300">
                  ${(getTimecardData(showTimecardModal).reduce((sum, r) => {
                    // Calculate working hours for this record
                    if (!r.checkIn || !r.checkOut) return sum;
                    
                    const [inH, inM] = r.checkIn.split(':').map(Number);
                    const [outH, outM] = r.checkOut.split(':').map(Number);
                    const totalMinutes = (outH * 60 + outM) - (inH * 60 + inM);
                    
                    let mealMinutes = 30; // Default 30-minute meal break
                    if (r.mealStart && r.mealEnd) {
                      const [mealStartH, mealStartM] = r.mealStart.split(':').map(Number);
                      const [mealEndH, mealEndM] = r.mealEnd.split(':').map(Number);
                      mealMinutes = (mealEndH * 60 + mealEndM) - (mealStartH * 60 + mealStartM);
                    }
                    
                    const workingMinutes = Math.max(0, totalMinutes - mealMinutes);
                    const workingHours = workingMinutes / 60;
                    const dayTotal = workingHours * r.rate;
                    
                    return sum + dayTotal;
                  }, 0)).toFixed(2)}
                </p>
              </div>
              <div className="bg-slate-800/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 font-semibold mb-2">EXTRA</p>
                <input
                  type="number"
                  defaultValue="0"
                  className="w-full px-2 py-1 bg-slate-700 border border-white/20 rounded text-white text-center text-lg font-bold"
                  min="0"
                  step="0.01"
                />
              </div>
              <div className="bg-slate-800/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 font-semibold mb-2">DEDUCTION</p>
                <input
                  type="number"
                  defaultValue="0"
                  className="w-full px-2 py-1 bg-slate-700 border border-white/20 rounded text-white text-center text-lg font-bold"
                  min="0"
                  step="0.01"
                />
              </div>
            </div>

            {/* Grand Total */}
            <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-4 mb-6">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-cyan-300">GRAND TOTAL</p>
                <p className="text-2xl font-bold text-cyan-300">
                  ${(getTimecardData(showTimecardModal).reduce((sum, r) => {
                    // Calculate working hours for this record
                    if (!r.checkIn || !r.checkOut) return sum;
                    
                    const [inH, inM] = r.checkIn.split(':').map(Number);
                    const [outH, outM] = r.checkOut.split(':').map(Number);
                    const totalMinutes = (outH * 60 + outM) - (inH * 60 + inM);
                    
                    let mealMinutes = 30; // Default 30-minute meal break
                    if (r.mealStart && r.mealEnd) {
                      const [mealStartH, mealStartM] = r.mealStart.split(':').map(Number);
                      const [mealEndH, mealEndM] = r.mealEnd.split(':').map(Number);
                      mealMinutes = (mealEndH * 60 + mealEndM) - (mealStartH * 60 + mealStartM);
                    }
                    
                    const workingMinutes = Math.max(0, totalMinutes - mealMinutes);
                    const workingHours = workingMinutes / 60;
                    const dayTotal = workingHours * r.rate;
                    
                    return sum + dayTotal;
                  }, 0)).toFixed(2)}
                </p>
              </div>
            </div>

            {/* Additional Info */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-slate-800/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 font-semibold mb-2">Total Hours Worked</p>
                <p className="text-lg font-bold text-green-300">
                  {(getTimecardData(showTimecardModal).reduce((sum, r) => {
                    if (!r.checkIn || !r.checkOut) return sum;
                    const [inH, inM] = r.checkIn.split(':').map(Number);
                    const [outH, outM] = r.checkOut.split(':').map(Number);
                    const totalMinutes = (outH * 60 + outM) - (inH * 60 + inM);
                    let mealMinutes = 30;
                    if (r.mealStart && r.mealEnd) {
                      const [mealStartH, mealStartM] = r.mealStart.split(':').map(Number);
                      const [mealEndH, mealEndM] = r.mealEnd.split(':').map(Number);
                      mealMinutes = (mealEndH * 60 + mealEndM) - (mealStartH * 60 + mealStartM);
                    }
                    const workingMinutes = Math.max(0, totalMinutes - mealMinutes);
                    return sum + (workingMinutes / 60);
                  }, 0)).toFixed(1)} hrs
                </p>
              </div>
              <div className="bg-slate-800/50 border border-white/10 rounded-lg p-4">
                <p className="text-xs text-slate-400 font-semibold mb-2">Total Days Worked</p>
                <p className="text-lg font-bold text-blue-300">{getTimecardData(showTimecardModal).length}</p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowTimecardModal(null)}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition font-semibold text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  // Save timecard edits and notes
                  if (showTimecardModal) {
                    // Save notes to localStorage for persistence across sessions
                    const savedNotes = localStorage.getItem("timecard_notes") ? JSON.parse(localStorage.getItem("timecard_notes")!) : {};
                    savedNotes[showTimecardModal] = timecardNotes[showTimecardModal] || "";
                    localStorage.setItem("timecard_notes", JSON.stringify(savedNotes));
                    
                    // Save timecard edits to localStorage if they exist
                    if (timecardEdits[showTimecardModal]) {
                      const savedEdits = localStorage.getItem("timecard_edits") ? JSON.parse(localStorage.getItem("timecard_edits")!) : {};
                      savedEdits[showTimecardModal] = timecardEdits[showTimecardModal];
                      localStorage.setItem("timecard_edits", JSON.stringify(savedEdits));
                    }
                  }
                  setShowTimecardModal(null);
                }}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition font-semibold text-sm"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
