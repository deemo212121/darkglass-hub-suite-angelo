import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Users, CheckCircle, Calendar, TrendingUp, AlertCircle, Clock, Download, Edit2, Save, X } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";

interface EmployeeStatus {
  id: string;
  name: string;
  status: "present" | "absent" | "late";
  checkInTime?: string;
  checkOutTime?: string;
  mealInTime?: string;
  mealOutTime?: string;
  hoursWorked?: number;
  overtimeHours?: number;
  location?: string;
  department?: string;
  manager?: string;
}

interface AttendanceAlert {
  type: "overtime" | "undertime" | "no_meal_break" | "no_lunch_break";
  message: string;
  severity: "warning" | "critical";
}

interface AttendanceNote {
  id: string;
  date: string;
  content: string;
  createdBy: string;
  notifyIndividual: boolean;
  notifyTeamLead: boolean;
  timestamp: string;
}

interface EmployeeMonthlyStats {
  employeeId: string;
  employeeName: string;
  lateCount: number;
  absentCount: number;
  presentCount: number;
  totalWorkingDays: number;
}

interface EmployeeDetail extends EmployeeStatus {
  monthlyStats: EmployeeMonthlyStats;
  totalHoursMonth: number;
  totalOvertimeMonth: number;
  totalPTOHours: number;
  totalAbsences: number;
  totalHolidayPay: number;
  performance: "Excellent" | "Good" | "Average" | "Needs Improvement";
  hourlyRate: number;
  dailyTimecards: DailyTimecard[];
  notes?: string;
}

interface DailyTimecard {
  id: string;
  date: string;
  dayOfWeek: string;
  timeIn?: string;
  timeOut?: string;
  mealInTime?: string;
  mealOutTime?: string;
  lunchBreakStart?: string;
  lunchBreakEnd?: string;
  hoursWorked: number;
  status: "present" | "absent" | "pto" | "holiday";
  notes?: string;
}

interface AuditLogEntry {
  id: string;
  timestamp: string;
  editedBy: string;
  field: string;
  oldValue: string;
  newValue: string;
  action: "edited" | "created";
}

// Mock employee data
const EMPLOYEES_DATA: Record<string, EmployeeDetail> = {
  "1": {
    id: "1",
    name: "John Doe",
    status: "present",
    checkInTime: "08:00",
    checkOutTime: "17:30",
    hoursWorked: 9.5,
    overtimeHours: 0,
    location: "Atlanta",
    department: "Operations",
    manager: "Sarah Manager",
    monthlyStats: {
      employeeId: "1",
      employeeName: "John Doe",
      lateCount: 1,
      absentCount: 0,
      presentCount: 19,
      totalWorkingDays: 20,
    },
    totalHoursMonth: 190,
    totalOvertimeMonth: 4,
    totalPTOHours: 8,
    totalAbsences: 0,
    totalHolidayPay: 160,
    performance: "Good",
    hourlyRate: 20,
    notes: "FIRST PAY",
    dailyTimecards: [
      { id: "1", date: "2026-06-01", dayOfWeek: "Monday", timeIn: "08:00", timeOut: "17:00", mealInTime: "12:00", mealOutTime: "12:30", hoursWorked: 8.5, status: "present" },
      { id: "2", date: "2026-06-02", dayOfWeek: "Tuesday", timeIn: "08:15", timeOut: "17:30", mealInTime: "12:00", mealOutTime: "12:45", hoursWorked: 8.75, status: "present" },
      { id: "3", date: "2026-06-03", dayOfWeek: "Wednesday", timeIn: "08:00", timeOut: "17:00", mealInTime: "12:00", mealOutTime: "12:30", hoursWorked: 8.5, status: "present" },
      { id: "4", date: "2026-06-04", dayOfWeek: "Thursday", timeIn: "07:30", timeOut: "17:00", mealInTime: "12:00", mealOutTime: "12:30", hoursWorked: 9, status: "present" },
      { id: "5", date: "2026-06-05", dayOfWeek: "Friday", timeIn: "08:00", timeOut: "17:00", mealInTime: "12:00", mealOutTime: "12:30", hoursWorked: 8.5, status: "present" },
      { id: "6", date: "2026-06-08", dayOfWeek: "Monday", timeIn: "08:00", timeOut: "17:00", mealInTime: "12:00", mealOutTime: "12:30", hoursWorked: 8.5, status: "present" },
      { id: "7", date: "2026-06-09", dayOfWeek: "Tuesday", timeIn: "08:00", timeOut: "17:00", mealInTime: "12:00", mealOutTime: "12:30", hoursWorked: 8.5, status: "present" },
      { id: "8", date: "2026-06-10", dayOfWeek: "Wednesday", timeIn: "08:00", timeOut: "17:00", mealInTime: "12:00", mealOutTime: "12:30", hoursWorked: 8.5, status: "present" },
      { id: "9", date: "2026-06-11", dayOfWeek: "Thursday", timeIn: "08:00", timeOut: "18:00", mealInTime: "12:00", mealOutTime: "12:30", hoursWorked: 9.5, status: "present" },
      { id: "10", date: "2026-06-12", dayOfWeek: "Friday", timeIn: "08:00", timeOut: "17:00", mealInTime: "12:00", mealOutTime: "12:30", hoursWorked: 8.5, status: "present" },
    ],
  },
  "2": {
    id: "2",
    name: "Jane Smith",
    status: "present",
    checkInTime: "08:15",
    checkOutTime: "18:00",
    hoursWorked: 9.75,
    overtimeHours: 0,
    monthlyStats: {
      employeeId: "2",
      employeeName: "Jane Smith",
      lateCount: 0,
      absentCount: 1,
      presentCount: 19,
      totalWorkingDays: 20,
    },
    totalHoursMonth: 192,
    totalOvertimeMonth: 2,
    totalPTOHours: 0,
    totalAbsences: 8,
    totalHolidayPay: 0,
    performance: "Excellent",
    hourlyRate: 22,
    dailyTimecards: [
      { id: "1", date: "2026-06-01", dayOfWeek: "Monday", timeIn: "08:15", timeOut: "17:30", hoursWorked: 9.25, status: "present" },
      { id: "2", date: "2026-06-02", dayOfWeek: "Tuesday", timeIn: "08:00", timeOut: "18:00", hoursWorked: 10, status: "present" },
      { id: "3", date: "2026-06-03", dayOfWeek: "Wednesday", status: "absent", hoursWorked: 0 },
      { id: "4", date: "2026-06-04", dayOfWeek: "Thursday", timeIn: "08:15", timeOut: "17:45", hoursWorked: 9.5, status: "present" },
      { id: "5", date: "2026-06-05", dayOfWeek: "Friday", timeIn: "08:00", timeOut: "17:00", hoursWorked: 9, status: "present" },
    ],
  },
  "3": {
    id: "3",
    name: "Bob Johnson",
    status: "late",
    checkInTime: "09:45",
    checkOutTime: "18:30",
    hoursWorked: 8.75,
    overtimeHours: 0.5,
    monthlyStats: {
      employeeId: "3",
      employeeName: "Bob Johnson",
      lateCount: 4,
      absentCount: 0,
      presentCount: 16,
      totalWorkingDays: 20,
    },
    totalHoursMonth: 172,
    totalOvertimeMonth: 8,
    totalPTOHours: 4,
    totalAbsences: 0,
    totalHolidayPay: 80,
    performance: "Needs Improvement",
    hourlyRate: 18,
    dailyTimecards: [
      { id: "1", date: "2026-06-01", dayOfWeek: "Monday", timeIn: "08:45", timeOut: "17:30", hoursWorked: 8.75, status: "present" },
      { id: "2", date: "2026-06-02", dayOfWeek: "Tuesday", timeIn: "10:00", timeOut: "18:30", hoursWorked: 8.5, status: "present" },
      { id: "3", date: "2026-06-03", dayOfWeek: "Wednesday", timeIn: "08:00", timeOut: "17:00", hoursWorked: 9, status: "present" },
    ],
  },
  "4": {
    id: "4",
    name: "Alice Brown",
    status: "absent",
    monthlyStats: {
      employeeId: "4",
      employeeName: "Alice Brown",
      lateCount: 2,
      absentCount: 3,
      presentCount: 15,
      totalWorkingDays: 20,
    },
    totalHoursMonth: 150,
    totalOvertimeMonth: 0,
    totalPTOHours: 16,
    totalAbsences: 24,
    totalHolidayPay: 0,
    performance: "Needs Improvement",
    hourlyRate: 19,
    dailyTimecards: [
      { id: "1", date: "2026-06-01", dayOfWeek: "Monday", timeIn: "08:00", timeOut: "17:00", hoursWorked: 9, status: "present" },
      { id: "2", date: "2026-06-02", dayOfWeek: "Tuesday", status: "pto", hoursWorked: 8 },
      { id: "3", date: "2026-06-03", dayOfWeek: "Wednesday", status: "absent", hoursWorked: 0 },
    ],
  },
  "5": {
    id: "5",
    name: "Charlie Wilson",
    status: "present",
    checkInTime: "07:30",
    checkOutTime: "17:00",
    hoursWorked: 9.5,
    overtimeHours: 0,
    monthlyStats: {
      employeeId: "5",
      employeeName: "Charlie Wilson",
      lateCount: 0,
      absentCount: 0,
      presentCount: 20,
      totalWorkingDays: 20,
    },
    totalHoursMonth: 200,
    totalOvertimeMonth: 2,
    totalPTOHours: 0,
    totalAbsences: 0,
    totalHolidayPay: 0,
    performance: "Excellent",
    hourlyRate: 21,
    dailyTimecards: [
      { id: "1", date: "2026-06-01", dayOfWeek: "Monday", timeIn: "07:30", timeOut: "17:00", hoursWorked: 9.5, status: "present" },
      { id: "2", date: "2026-06-02", dayOfWeek: "Tuesday", timeIn: "07:30", timeOut: "17:00", hoursWorked: 9.5, status: "present" },
    ],
  },
  "6": {
    id: "6",
    name: "Diana Lee",
    status: "present",
    checkInTime: "08:00",
    checkOutTime: "18:00",
    hoursWorked: 10,
    overtimeHours: 1,
    monthlyStats: {
      employeeId: "6",
      employeeName: "Diana Lee",
      lateCount: 0,
      absentCount: 0,
      presentCount: 20,
      totalWorkingDays: 20,
    },
    totalHoursMonth: 205,
    totalOvertimeMonth: 10,
    totalPTOHours: 8,
    totalAbsences: 0,
    totalHolidayPay: 160,
    performance: "Excellent",
    hourlyRate: 23,
    dailyTimecards: [
      { id: "1", date: "2026-06-01", dayOfWeek: "Monday", timeIn: "08:00", timeOut: "18:00", hoursWorked: 10, status: "present" },
      { id: "2", date: "2026-06-02", dayOfWeek: "Tuesday", timeIn: "08:00", timeOut: "18:30", hoursWorked: 10.5, status: "present" },
    ],
  },
  "7": {
    id: "7",
    name: "Edward Davis",
    status: "late",
    checkInTime: "10:00",
    checkOutTime: "19:00",
    hoursWorked: 8.5,
    overtimeHours: 0,
    monthlyStats: {
      employeeId: "7",
      employeeName: "Edward Davis",
      lateCount: 3,
      absentCount: 1,
      presentCount: 16,
      totalWorkingDays: 20,
    },
    totalHoursMonth: 168,
    totalOvertimeMonth: 4,
    totalPTOHours: 4,
    totalAbsences: 8,
    totalHolidayPay: 0,
    performance: "Needs Improvement",
    hourlyRate: 20,
    dailyTimecards: [
      { id: "1", date: "2026-06-01", dayOfWeek: "Monday", timeIn: "09:45", timeOut: "18:30", hoursWorked: 8.75, status: "present" },
      { id: "2", date: "2026-06-02", dayOfWeek: "Tuesday", timeIn: "10:00", timeOut: "18:00", hoursWorked: 8, status: "present" },
    ],
  },
  "8": {
    id: "8",
    name: "Fiona Garcia",
    status: "present",
    checkInTime: "08:00",
    checkOutTime: "17:00",
    hoursWorked: 9,
    overtimeHours: 0,
    monthlyStats: {
      employeeId: "8",
      employeeName: "Fiona Garcia",
      lateCount: 0,
      absentCount: 0,
      presentCount: 20,
      totalWorkingDays: 20,
    },
    totalHoursMonth: 200,
    totalOvertimeMonth: 0,
    totalPTOHours: 0,
    totalAbsences: 0,
    totalHolidayPay: 0,
    performance: "Excellent",
    hourlyRate: 20,
    dailyTimecards: [
      { id: "1", date: "2026-06-01", dayOfWeek: "Monday", timeIn: "08:00", timeOut: "17:00", hoursWorked: 9, status: "present" },
      { id: "2", date: "2026-06-02", dayOfWeek: "Tuesday", timeIn: "08:00", timeOut: "17:00", hoursWorked: 9, status: "present" },
    ],
  },
};

export const Route = createFileRoute("/employee/$employeeId")({
  ssr: false,
  head: () => ({
    meta: [{
      title: `Employee Details — Admin Hub Solutions`,
    }],
  }),
  component: EmployeeDetailsPage,
});

function EmployeeDetailsPage() {
  const { employeeId } = Route.useParams();
  const navigate = useNavigate();
  const { email: currentUserEmail } = useAuth();
  const employee = EMPLOYEES_DATA[employeeId];
  
  const [isEditing, setIsEditing] = useState(false);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [selectedTimecardIndex, setSelectedTimecardIndex] = useState<number | null>(null);
  const [timecardModalOpen, setTimecardModalOpen] = useState(false);
  
  // Editable fields
  const [editedHours, setEditedHours] = useState(employee?.totalHoursMonth || 0);
  const [editedOvertime, setEditedOvertime] = useState(employee?.totalOvertimeMonth || 0);
  const [editedPTO, setEditedPTO] = useState(employee?.totalPTOHours || 0);
  const [editedAbsences, setEditedAbsences] = useState(employee?.totalAbsences || 0);
  const [editedHolidayPay, setEditedHolidayPay] = useState(employee?.totalHolidayPay || 0);
  const [editedHourlyRate, setEditedHourlyRate] = useState(employee?.hourlyRate || 20);
  const [editedTimecards, setEditedTimecards] = useState(employee?.dailyTimecards || []);
  
  // Work hours setting
  const [workDays, setWorkDays] = useState<string[]>(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
  const [workTimeIn, setWorkTimeIn] = useState("08:00");
  const [workTimeOut, setWorkTimeOut] = useState("17:00");
  const [mealInTime, setMealInTime] = useState("12:00");
  const [mealOutTime, setMealOutTime] = useState("12:30");

  const handleSaveChanges = () => {
    const currentUser = currentUserEmail || "Current User";
    const changes: AuditLogEntry[] = [];

    if (editedHours !== employee?.totalHoursMonth) {
      changes.push({
        id: crypto.randomUUID?.() || Date.now().toString(),
        timestamp: new Date().toISOString(),
        editedBy: currentUser,
        field: "Total Hours",
        oldValue: employee?.totalHoursMonth.toString() || "0",
        newValue: editedHours.toString(),
        action: "edited",
      });
    }

    if (editedOvertime !== employee?.totalOvertimeMonth) {
      changes.push({
        id: crypto.randomUUID?.() || Date.now().toString(),
        timestamp: new Date().toISOString(),
        editedBy: currentUser,
        field: "Overtime Hours",
        oldValue: employee?.totalOvertimeMonth.toString() || "0",
        newValue: editedOvertime.toString(),
        action: "edited",
      });
    }

    if (editedPTO !== employee?.totalPTOHours) {
      changes.push({
        id: crypto.randomUUID?.() || Date.now().toString(),
        timestamp: new Date().toISOString(),
        editedBy: currentUser,
        field: "PTO Hours",
        oldValue: employee?.totalPTOHours.toString() || "0",
        newValue: editedPTO.toString(),
        action: "edited",
      });
    }

    if (editedAbsences !== employee?.totalAbsences) {
      changes.push({
        id: crypto.randomUUID?.() || Date.now().toString(),
        timestamp: new Date().toISOString(),
        editedBy: currentUser,
        field: "Absences",
        oldValue: employee?.totalAbsences.toString() || "0",
        newValue: editedAbsences.toString(),
        action: "edited",
      });
    }

    if (editedHolidayPay !== employee?.totalHolidayPay) {
      changes.push({
        id: crypto.randomUUID?.() || Date.now().toString(),
        timestamp: new Date().toISOString(),
        editedBy: currentUser,
        field: "Holiday Pay",
        oldValue: `$${employee?.totalHolidayPay.toFixed(2)}` || "$0.00",
        newValue: `$${editedHolidayPay.toFixed(2)}`,
        action: "edited",
      });
    }

    if (editedHourlyRate !== employee?.hourlyRate) {
      changes.push({
        id: crypto.randomUUID?.() || Date.now().toString(),
        timestamp: new Date().toISOString(),
        editedBy: currentUser,
        field: "Hourly Rate",
        oldValue: `$${employee?.hourlyRate.toFixed(2)}` || "$20.00",
        newValue: `$${editedHourlyRate.toFixed(2)}`,
        action: "edited",
      });
    }

    if (changes.length > 0) {
      setAuditLog((prev) => [...changes, ...prev]);
    }

    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditedHours(employee?.totalHoursMonth || 0);
    setEditedOvertime(employee?.totalOvertimeMonth || 0);
    setEditedPTO(employee?.totalPTOHours || 0);
    setEditedAbsences(employee?.totalAbsences || 0);
    setEditedHolidayPay(employee?.totalHolidayPay || 0);
    setEditedHourlyRate(employee?.hourlyRate || 20);
    setEditedTimecards(employee?.dailyTimecards || []);
    setIsEditing(false);
  };

  const handleSaveWorkSchedule = () => {
    const currentUser = currentUserEmail || "Current User";
    const changes: AuditLogEntry[] = [];

    // Log the work schedule change
    changes.push({
      id: crypto.randomUUID?.() || Date.now().toString(),
      timestamp: new Date().toISOString(),
      editedBy: currentUser,
      field: "Work Schedule",
      oldValue: `Days: Mon-Fri, In: 08:00, Out: 17:00`,
      newValue: `Days: ${workDays.join(", ")}, In: ${workTimeIn}, Out: ${workTimeOut}`,
      action: "edited",
    });

    if (changes.length > 0) {
      setAuditLog((prev) => [...changes, ...prev]);
    }

    // Show success feedback
    alert(`Work schedule saved successfully!\nWorking Days: ${workDays.join(", ")}\nDuty Time: ${workTimeIn} - ${workTimeOut}`);
  };

  const handleTimecardChange = (index: number, field: string, value: any) => {
    const updated = [...editedTimecards];
    updated[index] = { ...updated[index], [field]: value };
    
    // Auto-calculate hours if time in and out are provided
    if ((field === "timeIn" || field === "timeOut") && updated[index].timeIn && updated[index].timeOut) {
      const timeIn = new Date(`2000-01-01T${updated[index].timeIn}`);
      const timeOut = new Date(`2000-01-01T${updated[index].timeOut}`);
      const lunchBreakMins = 30; // Fixed 30-minute lunch break
      
      const totalMins = (timeOut.getTime() - timeIn.getTime()) / (1000 * 60) - lunchBreakMins;
      updated[index].hoursWorked = Math.round((totalMins / 60) * 100) / 100;
    }
    
    setEditedTimecards(updated);
  };

  const openTimecardModal = (index: number) => {
    setSelectedTimecardIndex(index);
    setTimecardModalOpen(true);
  };

  const closeTimecardModal = () => {
    // Track timecard changes immediately when closing modal
    if (selectedTimecardIndex !== null) {
      const currentUser = currentUserEmail || "Current User";
      const tc = editedTimecards[selectedTimecardIndex];
      const orig = employee?.dailyTimecards[selectedTimecardIndex];
      
      if (orig) {
        const timeInChanged = tc.timeIn !== orig.timeIn;
        const timeOutChanged = tc.timeOut !== orig.timeOut;
        const hoursChanged = tc.hoursWorked !== orig.hoursWorked;
        const statusChanged = tc.status !== orig.status;
        
        if (timeInChanged || timeOutChanged || hoursChanged || statusChanged) {
          const oldDetails = [];
          const newDetails = [];
          
          if (timeInChanged) {
            oldDetails.push(`In: ${orig.timeIn || "—"}`);
            newDetails.push(`In: ${tc.timeIn || "—"}`);
          }
          if (timeOutChanged) {
            oldDetails.push(`Out: ${orig.timeOut || "—"}`);
            newDetails.push(`Out: ${tc.timeOut || "—"}`);
          }
          if (hoursChanged) {
            oldDetails.push(`${orig.hoursWorked}hrs`);
            newDetails.push(`${tc.hoursWorked}hrs`);
          }
          if (statusChanged) {
            oldDetails.push(`${orig.status}`);
            newDetails.push(`${tc.status}`);
          }
          
          const auditEntry: AuditLogEntry = {
            id: crypto.randomUUID?.() || Date.now().toString(),
            timestamp: new Date().toISOString(),
            editedBy: currentUser,
            field: `Timecard ${tc.date}`,
            oldValue: oldDetails.join(", "),
            newValue: newDetails.join(", "),
            action: "edited",
          };
          
          setAuditLog((prev) => [auditEntry, ...prev]);
        }
      }
    }
    
    setTimecardModalOpen(false);
    setSelectedTimecardIndex(null);
  };

  const handleGeneratePayslip = async () => {
    // Generate a simple payslip document with logo
    // Convert logo to data URL
    const response = await fetch(logoImage);
    const blob = await response.blob();
    const logoDataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });

    const payslipContent = generatePayslipHTML(
      {
        ...employee!,
        totalHoursMonth: editedHours,
        totalOvertimeMonth: editedOvertime,
        totalPTOHours: editedPTO,
        totalAbsences: editedAbsences,
        totalHolidayPay: editedHolidayPay,
      },
      logoDataUrl
    );
    const payslipBlob = new Blob([payslipContent], { type: "text/html" });
    const url = URL.createObjectURL(payslipBlob);
    
    // Open in new window for printing
    const printWindow = window.open(url, "_blank");
    if (printWindow) {
      printWindow.addEventListener("load", () => {
        printWindow.print();
      });
    }
  };

  if (!employee) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <AppHeader />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-2xl font-bold text-white mb-4">Employee Not Found</p>
            <button
              onClick={() => navigate({ to: "/m/dashboard/accounting-dashboard" })}
              className="btn px-4 py-2 rounded-md hover:bg-white/10 transition"
            >
              <ChevronLeft className="h-4 w-4 inline mr-2" />
              Back to Dashboard
            </button>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  const attendanceRate = ((employee.monthlyStats.presentCount / employee.monthlyStats.totalWorkingDays) * 100).toFixed(1);

  return (
    <div className="min-h-screen flex flex-col bg-slate-950">
      <AppHeader />
      
      <header className="border-b border-white/10 bg-slate-900/50 backdrop-blur">
        <div className="max-w-[1600px] mx-auto px-6 py-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate({ to: "/m/dashboard/accounting-dashboard" })}
              className="btn hover:bg-white/15 p-2 rounded-md"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-white">{employee.name}</h1>
              <p className="text-sm text-slate-400">Employee Details & Work Information</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isEditing ? (
              <>
                <button
                  onClick={handleSaveChanges}
                  className="bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-2 rounded-md flex items-center gap-2 transition"
                >
                  <Save className="h-4 w-4" />
                  Save Changes
                </button>
                <button
                  onClick={handleCancel}
                  className="bg-red-600 hover:bg-red-700 text-white font-semibold px-4 py-2 rounded-md flex items-center gap-2 transition"
                >
                  <X className="h-4 w-4" />
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setIsEditing(true)}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded-md flex items-center gap-2 transition"
                >
                  <Edit2 className="h-4 w-4" />
                  Edit
                </button>
                <button
                  onClick={handleGeneratePayslip}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded-md flex items-center gap-2 transition"
                >
                  <Download className="h-4 w-4" />
                  Generate Payslip
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">
        <div className="space-y-6">
          {/* Today's Status Section */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
            <h2 className="text-lg font-bold mb-6 flex items-center gap-2">
              <Clock className="h-5 w-5 text-blue-400" />
              Today's Status
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <div className="bg-white/5 p-4 rounded-lg">
                <p className="text-xs text-slate-400 mb-2 uppercase">Status</p>
                <p className={`text-sm font-semibold px-2 py-1 rounded w-fit ${
                  employee.status === "present" ? "bg-green-500/20 text-green-300" :
                  employee.status === "late" ? "bg-yellow-500/20 text-yellow-300" :
                  "bg-red-500/20 text-red-300"
                }`}>
                  {employee.status.charAt(0).toUpperCase() + employee.status.slice(1)}
                </p>
              </div>
              <div className="bg-white/5 p-4 rounded-lg">
                <p className="text-xs text-slate-400 mb-2 uppercase">Check In</p>
                <p className="text-lg font-semibold text-white">{employee.checkInTime || "—"}</p>
              </div>
              <div className="bg-white/5 p-4 rounded-lg">
                <p className="text-xs text-slate-400 mb-2 uppercase">Check Out</p>
                <p className="text-lg font-semibold text-white">{employee.checkOutTime || "—"}</p>
              </div>
              <div className="bg-white/5 p-4 rounded-lg">
                <p className="text-xs text-slate-400 mb-2 uppercase">Hours Worked</p>
                <p className="text-lg font-semibold text-blue-300">{employee.hoursWorked?.toFixed(2) || "—"}</p>
              </div>
              <div className="bg-white/5 p-4 rounded-lg">
                <p className="text-xs text-slate-400 mb-2 uppercase">Overtime</p>
                <p className="text-lg font-semibold text-orange-300">{employee.overtimeHours?.toFixed(2) || "0"}</p>
              </div>
            </div>
          </div>

          {/* Performance Rating */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
            <h2 className="text-lg font-bold mb-6 flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-green-400" />
              Performance Rating
            </h2>
            <div className={`px-6 py-4 rounded-lg text-center font-bold text-lg ${
              employee.performance === "Excellent" ? "bg-green-500/20 text-green-300" :
              employee.performance === "Good" ? "bg-blue-500/20 text-blue-300" :
              employee.performance === "Average" ? "bg-yellow-500/20 text-yellow-300" :
              "bg-red-500/20 text-red-300"
            }`}>
              {employee.performance}
            </div>
          </div>

          {/* Combined Work Summary */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
            <h2 className="text-lg font-bold mb-6 flex items-center gap-2">
              <Calendar className="h-5 w-5 text-purple-400" />
              Work Summary - June 2026
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-7 gap-4">
              <div className="bg-white/5 p-4 rounded-lg">
                <p className="text-xs text-slate-400 mb-2 uppercase">Present</p>
                <p className="text-2xl font-bold text-green-300">{employee.monthlyStats.presentCount}</p>
                <p className="text-xs text-slate-500 mt-1">days</p>
              </div>
              <div className="bg-white/5 p-4 rounded-lg">
                <p className="text-xs text-slate-400 mb-2 uppercase">Late</p>
                <p className="text-2xl font-bold text-yellow-300">{employee.monthlyStats.lateCount}</p>
                <p className="text-xs text-slate-500 mt-1">days</p>
              </div>
              <div className="bg-white/5 p-4 rounded-lg">
                <p className="text-xs text-slate-400 mb-2 uppercase">Absent</p>
                <p className="text-2xl font-bold text-red-300">{employee.monthlyStats.absentCount}</p>
                <p className="text-xs text-slate-500 mt-1">days</p>
              </div>
              <div className="bg-white/5 p-4 rounded-lg">
                {isEditing ? (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-400 uppercase">Regular Hours</label>
                    <input
                      type="number"
                      value={editedHours}
                      onChange={(e) => setEditedHours(parseFloat(e.target.value) || 0)}
                      className="glass-input text-sm rounded px-2 py-1"
                    />
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-slate-400 mb-2 uppercase">Regular Hours</p>
                    <p className="text-2xl font-bold text-blue-300">{editedHours}</p>
                  </>
                )}
              </div>
              <div className="bg-white/5 p-4 rounded-lg">
                {isEditing ? (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-400 uppercase">Overtime</label>
                    <input
                      type="number"
                      value={editedOvertime}
                      onChange={(e) => setEditedOvertime(parseFloat(e.target.value) || 0)}
                      className="glass-input text-sm rounded px-2 py-1"
                    />
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-slate-400 mb-2 uppercase">Overtime</p>
                    <p className="text-2xl font-bold text-orange-300">{editedOvertime}</p>
                  </>
                )}
              </div>
              <div className="bg-white/5 p-4 rounded-lg">
                {isEditing ? (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-400 uppercase">Hourly Rate</label>
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-semibold text-slate-300">$</span>
                      <input
                        type="number"
                        value={editedHourlyRate}
                        onChange={(e) => setEditedHourlyRate(parseFloat(e.target.value) || 0)}
                        className="glass-input text-sm rounded px-2 py-1 flex-1"
                        step="0.01"
                        min="0"
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-slate-400 mb-2 uppercase">Hourly Rate</p>
                    <p className="text-2xl font-bold text-green-300">${editedHourlyRate.toFixed(2)}</p>
                  </>
                )}
              </div>
              <div className="bg-white/5 p-4 rounded-lg">
                <p className="text-xs text-slate-400 mb-2 uppercase">Total Days</p>
                <p className="text-2xl font-bold text-blue-300">{employee.monthlyStats.totalWorkingDays}</p>
                <p className="text-xs text-slate-500 mt-1">month</p>
              </div>
            </div>
          </div>

          {/* PTO, Absences & Holiday Pay */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
            <h2 className="text-lg font-bold mb-6 flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-orange-400" />
              Time Off & Compensation
            </h2>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white/5 p-4 rounded-lg">
                {isEditing ? (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-400 uppercase">PTO Hours</label>
                    <input
                      type="number"
                      value={editedPTO}
                      onChange={(e) => setEditedPTO(parseFloat(e.target.value) || 0)}
                      className="glass-input text-sm rounded px-2 py-1"
                    />
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-slate-400 mb-2 uppercase">PTO Hours</p>
                    <p className="text-3xl font-bold text-purple-300">{editedPTO}</p>
                  </>
                )}
              </div>
              <div className="bg-white/5 p-4 rounded-lg">
                {isEditing ? (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-400 uppercase">Absences</label>
                    <input
                      type="number"
                      value={editedAbsences}
                      onChange={(e) => setEditedAbsences(parseFloat(e.target.value) || 0)}
                      className="glass-input text-sm rounded px-2 py-1"
                    />
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-slate-400 mb-2 uppercase">Absences</p>
                    <p className="text-3xl font-bold text-red-300">{editedAbsences}</p>
                  </>
                )}
              </div>
              <div className="bg-white/5 p-4 rounded-lg">
                {isEditing ? (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-400 uppercase">Holiday Pay</label>
                    <input
                      type="number"
                      value={editedHolidayPay}
                      onChange={(e) => setEditedHolidayPay(parseFloat(e.target.value) || 0)}
                      className="glass-input text-sm rounded px-2 py-1"
                    />
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-slate-400 mb-2 uppercase">Holiday Pay</p>
                    <p className="text-3xl font-bold text-green-300">${editedHolidayPay.toFixed(2)}</p>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Work Hours Setting */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
            <h2 className="text-lg font-bold mb-6 flex items-center gap-2">
              <Clock className="h-5 w-5 text-blue-400" />
              Set Work Hours
            </h2>
            <div className="mb-6">
              <label className="block text-sm font-semibold text-slate-300 mb-3">Working Days</label>
              <div className="flex flex-wrap gap-2">
                {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day) => (
                  <button
                    key={day}
                    onClick={() => {
                      if (workDays.includes(day)) {
                        setWorkDays(workDays.filter((d) => d !== day));
                      } else {
                        setWorkDays([...workDays, day]);
                      }
                    }}
                    className={`px-4 py-2 rounded-lg font-semibold text-sm transition ${
                      workDays.includes(day)
                        ? "bg-blue-600 text-white"
                        : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                    }`}
                  >
                    {day.slice(0, 3)}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-slate-300">Duty Time In</label>
                <input
                  type="time"
                  value={workTimeIn}
                  onChange={(e) => setWorkTimeIn(e.target.value)}
                  className="glass-input rounded px-3 py-2 text-sm"
                />
                <p className="text-xs text-slate-500">Employee work starts at this time</p>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-slate-300">Duty Time Out</label>
                <input
                  type="time"
                  value={workTimeOut}
                  onChange={(e) => setWorkTimeOut(e.target.value)}
                  className="glass-input rounded px-3 py-2 text-sm"
                />
                <p className="text-xs text-slate-500">Employee work ends at this time</p>
              </div>
            </div>

            <button onClick={handleSaveWorkSchedule} className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2 rounded-md transition">
              Save Work Schedule
            </button>
          </div>

          {/* Daily Timecards */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
            <h2 className="text-lg font-bold mb-6 flex items-center gap-2">
              <Clock className="h-5 w-5 text-blue-400" />
              Daily Timecards - June 2026
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Location</th>
                    <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Department</th>
                    <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Manager</th>
                    <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Date</th>
                    <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Check In</th>
                    <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Meal In</th>
                    <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Meal Out</th>
                    <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Check Out</th>
                    <th className="px-4 py-3 text-center text-xs text-slate-400 uppercase">Hours</th>
                    <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {editedTimecards.map((timecard, idx) => (
                    <tr 
                      key={timecard.id} 
                      onClick={() => openTimecardModal(idx)}
                      className="border-b border-white/5 hover:bg-white/10 cursor-pointer transition"
                    >
                      <td className="px-4 py-3 text-sm text-slate-300">{employee.location || "—"}</td>
                      <td className="px-4 py-3 text-sm text-slate-300">{employee.department || "—"}</td>
                      <td className="px-4 py-3 text-sm text-slate-300">{employee.manager || "—"}</td>
                      <td className="px-4 py-3 text-sm">{timecard.date}</td>
                      <td className="px-4 py-3 text-sm">{timecard.timeIn || "—"}</td>
                      <td className="px-4 py-3 text-sm">{timecard.mealInTime || "—"}</td>
                      <td className="px-4 py-3 text-sm">{timecard.mealOutTime || "—"}</td>
                      <td className="px-4 py-3 text-sm">{timecard.timeOut || "—"}</td>
                      <td className="px-4 py-3 text-center text-sm font-semibold text-blue-300">
                        {timecard.hoursWorked.toFixed(2)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          timecard.status === "present" ? "bg-green-500/20 text-green-300" :
                          timecard.status === "absent" ? "bg-red-500/20 text-red-300" :
                          timecard.status === "pto" ? "bg-purple-500/20 text-purple-300" :
                          "bg-blue-500/20 text-blue-300"
                        }`}>
                          {timecard.status.charAt(0).toUpperCase() + timecard.status.slice(1)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {isEditing && (
              <p className="text-xs text-slate-500 mt-4">
                📝 Click on any day to edit time in/out and lunch breaks
              </p>
            )}
          </div>

          {/* Attendance Rate */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
            <h2 className="text-lg font-bold mb-6 flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-400" />
              Attendance Rate
            </h2>
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium">Monthly Attendance</span>
                <span className="text-lg font-bold">
                  {attendanceRate}%
                </span>
              </div>
              <div className="w-full bg-white/10 rounded-full h-3">
                <div
                  className={`h-3 rounded-full transition-all ${
                    Number(attendanceRate) >= 95 ? "bg-green-500" :
                    Number(attendanceRate) >= 90 ? "bg-blue-500" :
                    "bg-red-500"
                  }`}
                  style={{
                    width: `${attendanceRate}%`
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Audit Log Section */}
        {auditLog.length > 0 && (
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 mt-6">
            <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
              <Clock className="h-5 w-5 text-blue-400" />
              Edit History
            </h3>
            <div className="space-y-3">
              {auditLog.map((entry) => {
                const editDate = new Date(entry.timestamp).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                });
                const editTime = new Date(entry.timestamp).toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                });

                return (
                  <div key={entry.id} className="bg-white/5 p-3 rounded-lg border border-white/10">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-white">
                          {entry.field} changed
                        </p>
                        <p className="text-xs text-slate-400 mt-1">
                          From: <span className="text-red-300">{entry.oldValue}</span> → To: <span className="text-green-300">{entry.newValue}</span>
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-slate-500 font-medium">{entry.editedBy}</p>
                        <p className="text-xs text-slate-600">
                          {editDate} at {editTime}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Timecard Edit Modal */}
        {timecardModalOpen && selectedTimecardIndex !== null && editedTimecards[selectedTimecardIndex] && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-white/10 rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-white">
                  Edit Timecard - {editedTimecards[selectedTimecardIndex].date}
                </h3>
                <button
                  onClick={closeTimecardModal}
                  className="p-1 rounded-md hover:bg-white/10 transition"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Time In */}
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-slate-300">Time In</label>
                  <input
                    type="time"
                    value={editedTimecards[selectedTimecardIndex].timeIn || ""}
                    onChange={(e) => handleTimecardChange(selectedTimecardIndex, "timeIn", e.target.value)}
                    className="glass-input rounded px-3 py-2"
                    disabled={editedTimecards[selectedTimecardIndex].status !== "present"}
                  />
                </div>

                {/* Time Out */}
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-slate-300">Time Out</label>
                  <input
                    type="time"
                    value={editedTimecards[selectedTimecardIndex].timeOut || ""}
                    onChange={(e) => handleTimecardChange(selectedTimecardIndex, "timeOut", e.target.value)}
                    className="glass-input rounded px-3 py-2"
                    disabled={editedTimecards[selectedTimecardIndex].status !== "present"}
                  />
                </div>

                {/* Lunch Break Info */}
                <div className="bg-blue-500/10 border border-blue-500/30 rounded px-3 py-2">
                  <p className="text-sm font-semibold text-blue-300">Lunch Break</p>
                  <p className="text-xs text-slate-400 mt-1">Fixed 30-minute lunch break deducted from work hours</p>
                </div>

                {/* Hours Worked (Auto-calculated) */}
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-slate-300">Hours Worked</label>
                  <input
                    type="number"
                    value={editedTimecards[selectedTimecardIndex].hoursWorked}
                    onChange={(e) => handleTimecardChange(selectedTimecardIndex, "hoursWorked", parseFloat(e.target.value) || 0)}
                    className="glass-input rounded px-3 py-2 bg-white/10"
                    step="0.25"
                    disabled={editedTimecards[selectedTimecardIndex].status !== "present"}
                  />
                  <p className="text-xs text-slate-500">Auto-calculated: (Time Out - Time In) - 30min lunch break</p>
                </div>

                {/* Status */}
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-slate-300">Status</label>
                  <select
                    value={editedTimecards[selectedTimecardIndex].status}
                    onChange={(e) => handleTimecardChange(selectedTimecardIndex, "status", e.target.value)}
                    className="glass-input rounded px-3 py-2"
                  >
                    <option value="present">Present</option>
                    <option value="absent">Absent</option>
                    <option value="pto">PTO</option>
                    <option value="holiday">Holiday</option>
                  </select>
                </div>

                {/* Notes */}
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-slate-300">Notes</label>
                  <textarea
                    value={editedTimecards[selectedTimecardIndex].notes || ""}
                    onChange={(e) => handleTimecardChange(selectedTimecardIndex, "notes", e.target.value)}
                    className="glass-input rounded px-3 py-2 min-h-[80px] resize-none"
                    placeholder="Add any notes for this timecard..."
                  />
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 pt-4 border-t border-white/10">
                  <button
                    onClick={closeTimecardModal}
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-2 rounded transition"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}

// Import logo
import logoImage from "@/assets/logo.png";

function generatePayslipHTML(employee: EmployeeDetail, logoDataUrl: string): string {
  const currentDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Calculate payroll values
  const hourlyRate = 20;
  const overtimeRate = 30;
  const ptoRate = 20;
  const regularPay = employee.totalHoursMonth * hourlyRate;
  const overtimePay = employee.totalOvertimeMonth * overtimeRate;
  const ptoPay = employee.totalPTOHours * ptoRate;
  const holidayPay = employee.totalHolidayPay;
  const grossPay = regularPay + overtimePay + ptoPay + holidayPay;
  const absenceCost = employee.totalAbsences * 20; // Unpaid absences
  const deductions = grossPay * 0.2; // 20% deductions
  const netPay = grossPay - deductions;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payslip - ${employee.name}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: white;
      padding: 10px;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      background: white;
      border: 1px solid #e5e7eb;
      padding: 20px;
    }
    .header {
      display: flex;
      flex-direction: row;
      gap: 15px;
      align-items: center;
      justify-content: center;
      margin-bottom: 20px;
      padding: 15px;
      border-bottom: 2px solid #1e40af;
      background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%);
      border-radius: 8px;
      position: relative;
    }
    .logo {
      width: 80px;
      height: 80px;
      object-fit: contain;
      flex-shrink: 0;
    }
    .header-content {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: flex-start;
      margin-left: 10px;
    }
    .header h1 {
      color: white;
      font-size: 28px;
      margin-bottom: 0;
      letter-spacing: 1px;
    }
    .header p {
      color: #e0e7ff;
      font-size: 14px;
      display: none;
    }
    .payslip-info {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 15px;
      margin-bottom: 15px;
    }
    .info-section {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .info-section label {
      font-size: 11px;
      color: #6b7280;
      text-transform: uppercase;
      font-weight: 600;
    }
    .info-section span {
      font-size: 13px;
      color: #1f2937;
      font-weight: 500;
    }
    .employee-highlight {
      background: #eff6ff;
      border-left: 4px solid #1e40af;
      padding: 10px;
      border-radius: 4px;
    }
    .employee-highlight .info-section label {
      color: #1e40af;
      font-weight: 700;
    }
    .employee-highlight .info-section span {
      font-size: 16px;
      font-weight: 700;
      color: #1e40af;
    }
    .table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
    }
    .table th {
      background: #f3f4f6;
      color: #1f2937;
      padding: 8px;
      text-align: left;
      font-weight: 600;
      font-size: 12px;
      border: 1px solid #e5e7eb;
    }
    .table td {
      padding: 8px;
      border: 1px solid #e5e7eb;
      font-size: 12px;
      color: #374151;
    }
    .table tr:nth-child(even) {
      background: #fafafa;
    }
    .summary-section {
      margin-top: 15px;
      border-top: 2px solid #e5e7eb;
      padding-top: 10px;
    }
    .summary-row {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 10px;
      align-items: center;
      padding: 6px 0;
      border-bottom: 1px solid #e5e7eb;
    }
    .summary-row.gross {
      background: #f0f9ff;
      border: 1px solid #bfdbfe;
      border-radius: 4px;
      padding: 10px;
      margin: 8px 0;
      font-weight: 600;
      font-size: 14px;
      color: #1e40af;
    }
    .summary-row.total {
      background: #1e40af;
      color: white;
      border-radius: 4px;
      padding: 12px;
      margin: 8px 0;
      font-weight: 700;
      font-size: 16px;
    }
    .summary-row.total .amount {
      text-align: right;
      font-size: 18px;
    }
    .amount {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .footer {
      text-align: center;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid #e5e7eb;
      color: #6b7280;
      font-size: 11px;
    }
    @media print {
      body {
        background: white;
        padding: 0;
      }
      .container {
        border: none;
        padding: 20px;
      }
      .header {
        background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%) !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        color-adjust: exact !important;
      }
      .header h1, .header p {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        color-adjust: exact !important;
      }
      table {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        color-adjust: exact !important;
      }
      th, td {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        color-adjust: exact !important;
      }
      .summary-row.gross {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        color-adjust: exact !important;
      }
      .summary-row.total {
        background: #1e40af !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        color-adjust: exact !important;
      }
      .footer {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        color-adjust: exact !important;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${logoDataUrl}" alt="Admin Hub Solutions Logo" class="logo" />
      <div class="header-content">
        <h1>PAYSLIP</h1>
      </div>
    </div>

    <div class="payslip-info">
      <div class="employee-highlight">
        <div class="info-section">
          <label>👤 Employee Name</label>
          <span>${employee.name}</span>
        </div>
        <div class="info-section" style="margin-top: 15px;">
          <label>Department</label>
          <span>${employee.department || "—"}</span>
        </div>
      </div>
      <div>
        <div class="info-section">
          <label>Payslip Date</label>
          <span>${currentDate}</span>
        </div>
        <div class="info-section" style="margin-top: 15px;">
          <label>Period</label>
          <span>June 1-30, 2026</span>
        </div>
      </div>
    </div>

    <!-- Timecard Detail Table -->
    <div style="margin-top: 15px; margin-bottom: 15px;">
      <h3 style="font-size: 14px; font-weight: 700; color: #1f2937; margin-bottom: 8px; border-bottom: 2px solid #1e40af; padding-bottom: 5px;">Daily Timecard Details</h3>
      <table class="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Check In</th>
            <th>Meal Start</th>
            <th>Meal End</th>
            <th>Check Out</th>
            <th>Working Hours</th>
            <th>Rate</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          ${employee.dailyTimecards.map(tc => {
            const checkInTime = tc.timeIn || "—";
            const checkOutTime = tc.timeOut || "—";
            const mealStart = tc.mealInTime || "—";
            const mealEnd = tc.mealOutTime || "—";
            const hours = tc.hoursWorked.toFixed(2);
            const amount = (tc.hoursWorked * hourlyRate).toFixed(2);
            return `
          <tr>
            <td>${tc.date}</td>
            <td>${checkInTime}</td>
            <td>${mealStart}</td>
            <td>${mealEnd}</td>
            <td>${checkOutTime}</td>
            <td>${hours}</td>
            <td>$${hourlyRate}</td>
            <td class="amount">$${amount}</td>
          </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>

    <div class="summary-section">
      <table class="table">
        <thead>
          <tr>
            <th>Description</th>
            <th style="text-align: right;">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Regular Hours</td>
            <td class="amount">$${regularPay.toFixed(2)}</td>
          </tr>
          ${employee.totalOvertimeMonth > 0 ? `
          <tr>
            <td>Overtime Hours</td>
            <td class="amount">$${overtimePay.toFixed(2)}</td>
          </tr>
          ` : ''}
          ${employee.totalPTOHours > 0 ? `
          <tr>
            <td>PTO Hours</td>
            <td class="amount">$${ptoPay.toFixed(2)}</td>
          </tr>
          ` : ''}
          ${employee.totalAbsences > 0 ? `
          <tr>
            <td>Absences (${employee.totalAbsences} days)</td>
            <td class="amount">-$${absenceCost.toFixed(2)}</td>
          </tr>
          ` : ''}
          ${employee.totalHolidayPay > 0 ? `
          <tr>
            <td>Holiday Pay</td>
            <td class="amount">$${holidayPay.toFixed(2)}</td>
          </tr>
          ` : ''}
        </tbody>
      </table>
      
      <div class="summary-row gross" style="border: none; grid-template-columns: 2fr 1fr;">
        <div>💰 Gross Pay</div>
        <div class="amount">$${grossPay.toFixed(2)}</div>
      </div>

      <table class="table" style="margin-top: 15px;">
        <tbody>
          <tr>
            <td>Deductions (20%)</td>
            <td class="amount">-$${deductions.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>

      <div class="summary-row total" style="border: none; grid-template-columns: 2fr 1fr;">
        <div>💵 NET PAY</div>
        <div class="amount">$${netPay.toFixed(2)}</div>
      </div>
    </div>

    <div class="footer">
      ${employee.notes ? `<div style="text-align: left; margin-bottom: 20px; padding: 12px; background: #f3f4f6; border-left: 4px solid #1e40af; border-radius: 4px;"><p style="margin: 0; font-size: 12px;"><strong style="color: #1e40af;">Notes:</strong> <span style="color: #374151;">${employee.notes}</span></p></div>` : ''}
      <p style="margin: 0; margin-bottom: 10px;">This is an electronically generated payslip. No signature is required.</p>
      <p style="margin: 0;">© ${new Date().getFullYear()} Admin Hub Solutions. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `;
}

