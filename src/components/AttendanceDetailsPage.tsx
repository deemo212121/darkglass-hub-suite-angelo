import { useState, useMemo } from "react";
import { ChevronLeft, Filter, Bell, MessageSquare, AlertTriangle, Clock, Search, X } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

interface DailyAttendance {
  employeeId: string;
  employeeName: string;
  location: string;
  department: string;
  manager: string;
  workDate: string;
  checkIn: string;
  mealIn: string;
  mealOut: string;
  checkOut: string;
  alerts: AttendanceAlert[];
  notes: AttendanceNote[];
}

interface AttendanceAlert {
  type: "overtime" | "undertime" | "no_meal_break" | "no_lunch_break";
  message: string;
  severity: "warning" | "critical";
}

interface AttendanceNote {
  id: string;
  content: string;
  createdBy: string;
  notifyIndividual: boolean;
  notifyTeamLead: boolean;
  timestamp: string;
}

// Mock data for employees with all new fields
const ATTENDANCE_DATA: DailyAttendance[] = [
  {
    employeeId: "1",
    employeeName: "John Doe",
    location: "Atlanta",
    department: "Operations",
    manager: "Sarah Manager",
    workDate: "2026-06-03",
    checkIn: "08:00",
    mealIn: "12:00",
    mealOut: "12:30",
    checkOut: "17:00",
    alerts: [],
    notes: [],
  },
  {
    employeeId: "1",
    employeeName: "John Doe",
    location: "Atlanta",
    department: "Operations",
    manager: "Sarah Manager",
    workDate: "2026-06-02",
    checkIn: "08:15",
    mealIn: "12:00",
    mealOut: "12:45",
    checkOut: "17:30",
    alerts: [{ type: "overtime", message: "9.25 hours worked (over 9 hours)", severity: "warning" }],
    notes: [],
  },
  {
    employeeId: "2",
    employeeName: "Jane Smith",
    location: "Dallas",
    department: "Sales",
    manager: "Mike Director",
    workDate: "2026-06-03",
    checkIn: "08:15",
    mealIn: "12:15",
    mealOut: "12:45",
    checkOut: "18:00",
    alerts: [],
    notes: [],
  },
  {
    employeeId: "3",
    employeeName: "Bob Johnson",
    location: "Houston",
    department: "Operations",
    manager: "Sarah Manager",
    workDate: "2026-06-03",
    checkIn: "09:45",
    mealIn: "13:00",
    mealOut: "13:30",
    checkOut: "18:30",
    alerts: [
      { type: "overtime", message: "9 hours worked (over 9 hours)", severity: "warning" },
      { type: "no_lunch_break", message: "Lunch break only 30 minutes (exactly on limit)", severity: "warning" },
    ],
    notes: [],
  },
  {
    employeeId: "4",
    employeeName: "Alice Brown",
    location: "Phoenix",
    department: "HR",
    manager: "Emma HR Lead",
    workDate: "2026-06-03",
    checkIn: "08:00",
    mealIn: "",
    mealOut: "",
    checkOut: "17:00",
    alerts: [{ type: "no_meal_break", message: "No meal break recorded", severity: "critical" }],
    notes: [],
  },
  {
    employeeId: "5",
    employeeName: "Charlie Wilson",
    location: "Chicago",
    department: "Operations",
    manager: "Sarah Manager",
    workDate: "2026-06-03",
    checkIn: "07:30",
    mealIn: "11:30",
    mealOut: "12:00",
    checkOut: "16:45",
    alerts: [{ type: "undertime", message: "8.25 hours worked (under 8.5 hours)", severity: "warning" }],
    notes: [],
  },
  {
    employeeId: "6",
    employeeName: "Diana Lee",
    location: "Austin",
    department: "Sales",
    manager: "Mike Director",
    workDate: "2026-06-03",
    checkIn: "08:00",
    mealIn: "12:00",
    mealOut: "12:30",
    checkOut: "18:00",
    alerts: [{ type: "overtime", message: "10 hours worked (over 9 hours)", severity: "warning" }],
    notes: [],
  },
  {
    employeeId: "7",
    employeeName: "Edward Davis",
    location: "Denver",
    department: "Operations",
    manager: "Sarah Manager",
    workDate: "2026-06-03",
    checkIn: "10:00",
    mealIn: "13:00",
    mealOut: "13:30",
    checkOut: "19:00",
    alerts: [
      { type: "overtime", message: "8.5 hours worked (over 9 hours)", severity: "warning" },
      { type: "no_lunch_break", message: "Lunch break only 30 minutes (exactly on limit)", severity: "warning" },
    ],
    notes: [],
  },
  {
    employeeId: "8",
    employeeName: "Fiona Garcia",
    location: "Atlanta",
    department: "HR",
    manager: "Emma HR Lead",
    workDate: "2026-06-03",
    checkIn: "08:00",
    mealIn: "12:00",
    mealOut: "12:30",
    checkOut: "17:00",
    alerts: [],
    notes: [],
  },
];

const DEPARTMENTS = ["Operations", "Sales", "HR"];
const LOCATIONS = ["Atlanta", "Dallas", "Houston", "Phoenix", "Chicago", "Austin", "Denver"];

export function AttendanceDetailsPage() {
  const navigate = useNavigate();
  const [selectedDepartment, setSelectedDepartment] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [attendanceData, setAttendanceData] = useState<DailyAttendance[]>(ATTENDANCE_DATA);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [notesModalOpen, setNotesModalOpen] = useState(false);
  const [noteContent, setNoteContent] = useState("");
  const [notifyIndividual, setNotifyIndividual] = useState(true);
  const [notifyTeamLead, setNotifyTeamLead] = useState(true);

  // Filter data by department and search query
  const filteredData = useMemo(() => {
    let filtered = attendanceData;
    
    // Filter by department
    if (selectedDepartment !== "All") {
      filtered = filtered.filter((row) => row.department === selectedDepartment);
    }
    
    // Filter by search query (employee name)
    if (searchQuery.trim()) {
      filtered = filtered.filter((row) =>
        row.employeeName.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    return filtered;
  }, [attendanceData, selectedDepartment, searchQuery]);

  const handleEmployeeClick = (employeeId: string) => {
    window.open(`/employee/${employeeId}`, "_blank");
  };

  const handleAddNote = (rowIndex: number) => {
    const actualIndex = attendanceData.indexOf(filteredData[rowIndex]);
    setSelectedRow(actualIndex);
    setNoteContent("");
    setNotifyIndividual(true);
    setNotifyTeamLead(true);
    setNotesModalOpen(true);
  };

  const handleSaveNote = () => {
    if (!noteContent.trim() || selectedRow === null) return;

    const newNote: AttendanceNote = {
      id: crypto.randomUUID?.() || Date.now().toString(),
      content: noteContent,
      createdBy: "Current User",
      notifyIndividual,
      notifyTeamLead,
      timestamp: new Date().toISOString(),
    };

    const updated = [...attendanceData];
    updated[selectedRow].notes.push(newNote);
    setAttendanceData(updated);

    // Show notification
    if (notifyIndividual || notifyTeamLead) {
      const notifyList = [];
      if (notifyIndividual) notifyList.push(updated[selectedRow].employeeName);
      if (notifyTeamLead) notifyList.push(updated[selectedRow].manager);
      console.log(`Notification sent to: ${notifyList.join(", ")}`);
    }

    setNotesModalOpen(false);
    setNoteContent("");
  };

  const getAlertColor = (severity: "warning" | "critical") => {
    return severity === "critical" ? "bg-red-500/20 text-red-300 border-red-500/30" : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30";
  };

  const calculateHours = (checkIn: string, checkOut: string, mealIn: string, mealOut: string) => {
    if (!checkIn || !checkOut) return "—";

    const checkInTime = new Date(`2000-01-01T${checkIn}`);
    const checkOutTime = new Date(`2000-01-01T${checkOut}`);
    let totalMins = (checkOutTime.getTime() - checkInTime.getTime()) / (1000 * 60);

    // Deduct lunch break if both meal times are recorded
    if (mealIn && mealOut) {
      const mealInTime = new Date(`2000-01-01T${mealIn}`);
      const mealOutTime = new Date(`2000-01-01T${mealOut}`);
      const lunchMins = (mealOutTime.getTime() - mealInTime.getTime()) / (1000 * 60);
      totalMins -= lunchMins;
    } else {
      // Deduct fixed 30-minute lunch break if no meal times recorded
      totalMins -= 30;
    }

    const hours = totalMins / 60;
    return hours.toFixed(2);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="border-b border-white/10 bg-slate-900/50 backdrop-blur sticky top-0 z-40">
        <div className="max-w-[1600px] mx-auto px-6 py-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate({ to: "/m/dashboard" })}
              className="hover:bg-white/15 p-2 rounded-md transition"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-2xl font-bold">Attendance Details</h1>
              <p className="text-sm text-slate-400">Daily employee attendance tracking</p>
            </div>
          </div>

          {/* Department Filter */}
          <div className="flex items-center gap-3">
            <Filter className="h-5 w-5 text-slate-400" />
            <select
              value={selectedDepartment}
              onChange={(e) => setSelectedDepartment(e.target.value)}
              className="glass-input rounded px-3 py-2 bg-white/10 border border-white/20 text-sm"
            >
              <option value="All">All Departments</option>
              {DEPARTMENTS.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>

            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search employee..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="glass-input rounded pl-9 pr-9 py-2 bg-white/10 border border-white/20 text-sm w-48"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-200"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1600px] mx-auto px-6 py-8">
        <div className="bg-slate-900/50 border border-white/10 rounded-lg overflow-hidden">
          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Employee Name</th>
                  <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Location</th>
                  <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Department</th>
                  <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Manager</th>
                  <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Work Date</th>
                  <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Check In</th>
                  <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Meal In</th>
                  <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Meal Out</th>
                  <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Check Out</th>
                  <th className="px-4 py-3 text-center text-xs text-slate-400 uppercase">Hours</th>
                  <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Alerts</th>
                  <th className="px-4 py-3 text-center text-xs text-slate-400 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.map((row, idx) => {
                  const hours = calculateHours(row.checkIn, row.checkOut, row.mealIn, row.mealOut);
                  return (
                    <tr key={idx} className="border-b border-white/5 hover:bg-white/10 transition">
                      <td className="px-4 py-3 text-sm font-medium">
                        <button
                          onClick={() => handleEmployeeClick(row.employeeId)}
                          className="text-blue-400 hover:text-blue-300 cursor-pointer font-medium flex items-center gap-1"
                        >
                          {row.employeeName}
                          <span className="text-xs">↗</span>
                        </button>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-300">{row.location}</td>
                      <td className="px-4 py-3 text-sm text-slate-300">{row.department}</td>
                      <td className="px-4 py-3 text-sm text-slate-300">{row.manager}</td>
                      <td className="px-4 py-3 text-sm text-slate-300">{row.workDate}</td>
                      <td className="px-4 py-3 text-sm">{row.checkIn || "—"}</td>
                      <td className="px-4 py-3 text-sm">{row.mealIn || "—"}</td>
                      <td className="px-4 py-3 text-sm">{row.mealOut || "—"}</td>
                      <td className="px-4 py-3 text-sm">{row.checkOut || "—"}</td>
                      <td className="px-4 py-3 text-center text-sm font-semibold text-blue-300">{hours}</td>
                      <td className="px-4 py-3 text-sm">
                        {row.alerts.length > 0 ? (
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 text-yellow-400" />
                            <span className="text-xs text-yellow-300">{row.alerts.length} alert{row.alerts.length !== 1 ? "s" : ""}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-green-300">✓ OK</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleAddNote(idx)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 transition text-xs"
                        >
                          <MessageSquare className="h-3 w-3" />
                          Note
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Alert Details Section */}
          {filteredData.some((row) => row.alerts.length > 0) && (
            <div className="border-t border-white/10 p-6">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-yellow-400" />
                Alert Details
              </h3>
              <div className="space-y-3">
                {filteredData.map((row, idx) => {
                  if (row.alerts.length === 0) return null;
                  return row.alerts.map((alert, alertIdx) => (
                    <div
                      key={`${idx}-${alertIdx}`}
                      className={`p-3 rounded border ${getAlertColor(alert.severity)}`}
                    >
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="font-semibold text-sm">
                            {row.employeeName} — {row.workDate}
                          </p>
                          <p className="text-xs mt-1">{alert.message}</p>
                        </div>
                      </div>
                    </div>
                  ));
                })}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Notes Modal */}
      {notesModalOpen && selectedRow !== null && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-bold mb-4">
              Add Note for {attendanceData[selectedRow]?.employeeName}
            </h3>

            {/* Note Content */}
            <div className="mb-4">
              <label className="text-sm font-semibold text-slate-300 block mb-2">Note</label>
              <textarea
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                className="glass-input rounded px-3 py-2 w-full min-h-[100px] resize-none"
                placeholder="Enter your note here..."
              />
            </div>

            {/* Notification Options */}
            <div className="space-y-2 mb-6 pb-6 border-b border-white/10">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifyIndividual}
                  onChange={(e) => setNotifyIndividual(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm text-slate-300">Notify Individual</span>
                <Bell className="h-3 w-3 text-slate-400" />
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifyTeamLead}
                  onChange={(e) => setNotifyTeamLead(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm text-slate-300">Notify Team Leader</span>
                <Bell className="h-3 w-3 text-slate-400" />
              </label>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setNotesModalOpen(false)}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-2 rounded transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveNote}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-2 rounded transition"
              >
                Save Note
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
