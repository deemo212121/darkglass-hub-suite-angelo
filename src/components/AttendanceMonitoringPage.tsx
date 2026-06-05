import { AlertCircle, Clock, Users, UserCheck, UserX, Bell, MessageSquare, ChevronLeft, Download, Calendar, FileText, CheckCircle, XCircle } from "lucide-react";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/db";

interface AttendanceRecord {
  id: string;
  name: string;
  location: string;
  department: string;
  manager: string;
  workDate: string;
  checkIn: string;
  mealIn: string;
  mealOut: string;
  checkOut: string;
  alerts: string[];
  notes: string;
  notifyIndividual: boolean;
  notifyTeamLead: boolean;
}

interface PTORequest {
  id: string;
  employeeName: string;
  type: string;
  startDate: string;
  endDate: string;
  days: number;
  status: "pending" | "approved" | "rejected";
  reason: string;
  requestDate: string;
}

interface AttendanceCorrection {
  id: string;
  employeeName: string;
  employeeId: string;
  originalTime: string;
  correctedTime: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  requestDate: string;
  workDate: string;
}

interface CorrectionHistory {
  id: string;
  correctionId: string;
  action: string;
  changedBy: string;
  changedAt: string;
  previousStatus: string;
  newStatus: string;
}

const ATTENDANCE_DATA: AttendanceRecord[] = [
  { id: "1", name: "John Doe", location: "Atlanta", department: "Operations", manager: "Sarah Manager", workDate: "2026-06-04", checkIn: "8:00 AM", mealIn: "12:00 PM", mealOut: "12:30 PM", checkOut: "5:00 PM", alerts: [], notes: "", notifyIndividual: false, notifyTeamLead: false },
  { id: "2", name: "Jane Smith", location: "Atlanta", department: "Customer Service", manager: "John Manager", workDate: "2026-06-04", checkIn: "8:15 AM", mealIn: "12:00 PM", mealOut: "12:45 PM", checkOut: "5:00 PM", alerts: ["Late Check In"], notes: "Traffic delay", notifyIndividual: true, notifyTeamLead: false },
  { id: "3", name: "Mike Brown", location: "Dallas", department: "Parts", manager: "Bob Parts Manager", workDate: "2026-06-04", checkIn: "—", mealIn: "—", mealOut: "—", checkOut: "—", alerts: ["Absent", "No Clock In"], notes: "Called in sick", notifyIndividual: true, notifyTeamLead: true },
  { id: "4", name: "Sarah Johnson", location: "Houston", department: "Finance", manager: "Finance Lead", workDate: "2026-06-04", checkIn: "7:45 AM", mealIn: "12:15 PM", mealOut: "12:45 PM", checkOut: "4:45 PM", alerts: ["Under Time (8h 0m)"], notes: "", notifyIndividual: true, notifyTeamLead: false },
  { id: "5", name: "Tom Wilson", location: "Austin", department: "Operations", manager: "Sarah Manager", workDate: "2026-06-04", checkIn: "8:30 AM", mealIn: "1:00 PM", mealOut: "1:30 PM", checkOut: "5:15 PM", alerts: ["Late Check In", "Over Time (8h 45m)"], notes: "Completed urgent project", notifyIndividual: true, notifyTeamLead: true },
];

const PTO_REQUESTS: PTORequest[] = [
  { id: "p1", employeeName: "Alice Green", type: "Vacation", startDate: "2026-06-10", endDate: "2026-06-14", days: 5, status: "pending", reason: "Summer vacation", requestDate: "2026-06-01" },
  { id: "p2", employeeName: "Bob White", type: "Sick", startDate: "2026-06-05", endDate: "2026-06-05", days: 1, status: "pending", reason: "Medical appointment", requestDate: "2026-06-04" },
  { id: "p3", employeeName: "Carol Black", type: "Personal", startDate: "2026-06-20", endDate: "2026-06-21", days: 2, status: "approved", reason: "Personal matters", requestDate: "2026-05-28" },
];

const ATTENDANCE_CORRECTIONS: AttendanceCorrection[] = [
  { id: "c1", employeeName: "John Doe", employeeId: "1", originalTime: "8:00 AM", correctedTime: "7:55 AM", reason: "System error", status: "pending", requestDate: "2026-06-03", workDate: "2026-06-02" },
  { id: "c2", employeeName: "Jane Smith", employeeId: "2", originalTime: "5:00 PM", correctedTime: "5:15 PM", reason: "Forgot to clock out", status: "approved", requestDate: "2026-06-02", workDate: "2026-06-01" },
  { id: "c3", employeeName: "Mike Brown", employeeId: "3", originalTime: "—", correctedTime: "8:30 AM", reason: "Late clock in", status: "pending", requestDate: "2026-06-04", workDate: "2026-06-04" },
];

const CORRECTION_HISTORY: CorrectionHistory[] = [
  { id: "h1", correctionId: "c2", action: "Approved", changedBy: "Sarah Manager", changedAt: "2026-06-02 10:30 AM", previousStatus: "pending", newStatus: "approved" },
  { id: "h2", correctionId: "c1", action: "Submitted", changedBy: "John Doe", changedAt: "2026-06-03 09:15 AM", previousStatus: "draft", newStatus: "pending" },
];

export function AttendanceMonitoringPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [activeTab, setActiveTab] = useState<"daily-attendance" | "pto-management" | "corrections">("daily-attendance");
  const [summaryView, setSummaryView] = useState<"weekly" | "monthly">("weekly");
  const [searchEmployee, setSearchEmployee] = useState<string>("");
  const [filterDepartment, setFilterDepartment] = useState<string>("all");
  const [filterLocation, setFilterLocation] = useState<string>("all");
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  const [selectedCorrection, setSelectedCorrection] = useState<AttendanceCorrection | null>(null);
  const [correctionTimecardData, setCorrectionTimecardData] = useState<{ checkIn: string; checkOut: string }>({ checkIn: "", checkOut: "" });
  const [notesData, setNotesData] = useState<Record<string, { content: string; notifyIndividual: boolean; notifyTeamLead: boolean }>>({});
  const [newNote, setNewNote] = useState("");
  const [notifyIndividual, setNotifyIndividual] = useState(false);
  const [notifyTeamLead, setNotifyTeamLead] = useState(false);
  const [alertModalOpen, setAlertModalOpen] = useState(false);
  const [selectedAlertType, setSelectedAlertType] = useState<"missing-clockin" | "missing-clockout" | "late-arrival" | null>(null);

  const totalEmployees = ATTENDANCE_DATA.length;
  const presentToday = ATTENDANCE_DATA.filter((r) => r.checkIn !== "—").length;
  const absentToday = ATTENDANCE_DATA.filter((r) => r.checkIn === "—").length;
  const lateToday = ATTENDANCE_DATA.filter((r) => r.alerts.some((a) => a.includes("Late"))).length;
  const ptoPendingApproval = PTO_REQUESTS.filter((r) => r.status === "pending").length;

  const getAlertColor = (alert: string) => {
    if (alert.includes("Over Time")) return "bg-blue-500/20 text-blue-300 border-blue-500/30";
    if (alert.includes("Under Time")) return "bg-yellow-500/20 text-yellow-300 border-yellow-500/30";
    if (alert.includes("No Meal") || alert.includes("No Lunch")) return "bg-orange-500/20 text-orange-300 border-orange-500/30";
    if (alert.includes("Late")) return "bg-yellow-500/20 text-yellow-300 border-yellow-500/30";
    return "bg-red-500/20 text-red-300 border-red-500/30";
  };

  const filteredAndSortedData = ATTENDANCE_DATA.filter((record) => {
    if (searchEmployee && !record.name.toLowerCase().includes(searchEmployee.toLowerCase())) return false;
    if (filterDepartment !== "all" && record.department !== filterDepartment) return false;
    if (filterLocation !== "all" && record.location !== filterLocation) return false;
    return true;
  }).sort((a, b) => {
    return a.name.localeCompare(b.name);
  });

  const departments = Array.from(new Set(ATTENDANCE_DATA.map(r => r.department)));
  const locations = Array.from(new Set(ATTENDANCE_DATA.map(r => r.location)));

  const handleDownloadSummary = () => {
    const today = new Date().toISOString().split("T")[0];
    let csvContent = "Attendance Summary Report\n";
    csvContent += `Date: ${today}\n\n`;
    csvContent += "Key Metrics\n";
    csvContent += `Total Employees,${totalEmployees}\n`;
    csvContent += `Present Today,${presentToday}\n`;
    csvContent += `Absent Today,${absentToday}\n`;
    csvContent += `Late Today,${lateToday}\n\n`;
    csvContent += "Daily Attendance Tracker\n";
    csvContent += "Employee Name,Location,Department,Manager,Work Date,Check In,Meal In,Meal Out,Check Out,Alerts,Notes\n";
    ATTENDANCE_DATA.forEach((record) => {
      const alerts = record.alerts.join("; ");
      const notes = notesData[record.id]?.content || record.notes || "";
      csvContent += `"${record.name}","${record.location}","${record.department}","${record.manager}","${record.workDate}","${record.checkIn}","${record.mealIn}","${record.mealOut}","${record.checkOut}","${alerts}","${notes}"\n`;
    });
    const element = document.createElement("a");
    element.setAttribute("href", "data:text/csv;charset=utf-8," + encodeURIComponent(csvContent));
    element.setAttribute("download", `attendance-summary-${today}.csv`);
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
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
          {/* KPI Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase">Total Employees</p>
                  <p className="text-2xl font-bold text-white mt-2">{totalEmployees}</p>
                </div>
                <Users className="h-8 w-8 text-blue-400 opacity-50" />
              </div>
            </div>
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase">Present Today</p>
                  <p className="text-2xl font-bold text-green-400 mt-2">{presentToday}</p>
                </div>
                <UserCheck className="h-8 w-8 text-green-400 opacity-50" />
              </div>
            </div>
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase">Absent Today</p>
                  <p className="text-2xl font-bold text-red-400 mt-2">{absentToday}</p>
                </div>
                <UserX className="h-8 w-8 text-red-400 opacity-50" />
              </div>
            </div>
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase">Late Today</p>
                  <p className="text-2xl font-bold text-yellow-400 mt-2">{lateToday}</p>
                </div>
                <Clock className="h-8 w-8 text-yellow-400 opacity-50" />
              </div>
            </div>
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase">PTO Pending</p>
                  <p className="text-2xl font-bold text-purple-400 mt-2">{ptoPendingApproval}</p>
                </div>
                <Calendar className="h-8 w-8 text-purple-400 opacity-50" />
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 border-b border-white/10 overflow-x-auto">
            {[
              { id: "daily-attendance", label: "Daily Attendance", Icon: Clock },
              { id: "pto-management", label: "PTO Management", Icon: Calendar },
              { id: "corrections", label: "Corrections", Icon: FileText },
            ].map(tab => {
              const Icon = tab.Icon;
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`px-4 py-2 border-b-2 transition whitespace-nowrap flex items-center gap-2 ${activeTab === tab.id ? "border-blue-500 text-blue-300" : "border-transparent text-slate-400 hover:text-slate-300"}`}>
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Tab Content */}
          {activeTab === "daily-attendance" && (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 bg-gradient-to-br from-slate-800/80 to-slate-900/50 border border-white/10 rounded-lg p-4 backdrop-blur">
                  <h2 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-orange-400" />
                    Attendance Alerts
                  </h2>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <button 
                      onClick={() => { setSelectedAlertType("missing-clockin"); setAlertModalOpen(true); }}
                      className="bg-gradient-to-br from-red-500/15 to-red-600/5 border border-red-500/40 rounded p-2 hover:border-red-500/60 hover:bg-red-500/20 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-red-500/20 rounded">
                          <AlertCircle className="h-3 w-3 text-red-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-red-300 truncate">Missing Clock In</p>
                          <div className="flex items-center gap-1">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500"></span>
                            <span className="text-xs font-bold text-red-300">{ATTENDANCE_DATA.filter(r => r.checkIn === "—").length}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                    <button 
                      onClick={() => { setSelectedAlertType("missing-clockout"); setAlertModalOpen(true); }}
                      className="bg-gradient-to-br from-yellow-500/15 to-yellow-600/5 border border-yellow-500/40 rounded p-2 hover:border-yellow-500/60 hover:bg-yellow-500/20 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-yellow-500/20 rounded">
                          <AlertCircle className="h-3 w-3 text-yellow-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-yellow-300 truncate">Missing Clock Out</p>
                          <div className="flex items-center gap-1">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-500"></span>
                            <span className="text-xs font-bold text-yellow-300">{ATTENDANCE_DATA.filter(r => r.checkOut === "—" && r.checkIn !== "—").length}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                    <button 
                      onClick={() => { setSelectedAlertType("late-arrival"); setAlertModalOpen(true); }}
                      className="bg-gradient-to-br from-orange-500/15 to-orange-600/5 border border-orange-500/40 rounded p-2 hover:border-orange-500/60 hover:bg-orange-500/20 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-orange-500/20 rounded">
                          <AlertCircle className="h-3 w-3 text-orange-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-orange-300 truncate">Late Arrival</p>
                          <div className="flex items-center gap-1">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-500"></span>
                            <span className="text-xs font-bold text-orange-300">{ATTENDANCE_DATA.filter(r => r.alerts.some(a => a.includes("Late"))).length}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  </div>
                </div>
                <button onClick={handleDownloadSummary} className="group relative px-4 py-3 bg-gradient-to-br from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white rounded-lg transition shadow-lg hover:shadow-blue-500/50 flex flex-col items-center justify-center gap-1 h-fit min-w-fit">
                  <Download className="h-5 w-5 group-hover:scale-110 transition transform" />
                  <div className="text-xs font-semibold">Download</div>
                </button>
              </div>

              {/* Filters and Search for Daily */}
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-2">Search Employee</label>
                    <input 
                      type="text" 
                      placeholder="Enter employee name..." 
                      value={searchEmployee} 
                      onChange={(e) => setSearchEmployee(e.target.value)} 
                      className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm placeholder-slate-500 focus:border-blue-500 focus:outline-none transition" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-2">Filter by Department</label>
                    <select value={filterDepartment} onChange={(e) => setFilterDepartment(e.target.value)} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none">
                      <option value="all">All Departments</option>
                      {departments.map(dept => (
                        <option key={dept} value={dept}>{dept}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-2">Filter by Location</label>
                    <select value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none">
                      <option value="all">All Locations</option>
                      {locations.map(loc => (
                        <option key={loc} value={loc}>{loc}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Daily Attendance Table */}
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 overflow-x-auto">
                <h2 className="text-lg font-bold text-white mb-4">Daily Attendance Tracker</h2>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Employee</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Location</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Department</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Check In</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Check Out</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Alerts</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAndSortedData.map((record) => (
                      <tr key={record.id} className="border-b border-white/5 hover:bg-white/5 transition">
                        <td className="px-3 py-3 text-white font-medium">
                          <a href={`/employee/${record.id}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer">
                            {record.name}
                          </a>
                        </td>
                        <td className="px-3 py-3 text-slate-300">{record.location}</td>
                        <td className="px-3 py-3 text-slate-300">{record.department}</td>
                        <td className="px-3 py-3 text-slate-300">{record.checkIn}</td>
                        <td className="px-3 py-3 text-slate-300">{record.checkOut}</td>
                        <td className="px-3 py-3">
                          {record.alerts.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {record.alerts.map((alert, i) => (
                                <span key={i} className={`inline-block px-2 py-1 rounded text-xs font-semibold border ${getAlertColor(alert)}`}>
                                  {alert}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-green-400 text-xs font-semibold">✓ OK</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <button onClick={() => { setSelectedNote(record.id); setNewNote(notesData[record.id]?.content || ""); setNotifyIndividual(notesData[record.id]?.notifyIndividual || false); setNotifyTeamLead(notesData[record.id]?.notifyTeamLead || false); }} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 transition">
                            <MessageSquare className="h-4 w-4" />
                            <span className="text-xs">{notesData[record.id] ? "Edit" : "Add"}</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Summary View Toggle */}
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4 mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-300">View:</span>
                  <button 
                    onClick={() => setSummaryView("weekly")} 
                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${summaryView === "weekly" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
                  >
                    Weekly
                  </button>
                  <button 
                    onClick={() => setSummaryView("monthly")} 
                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${summaryView === "monthly" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
                  >
                    Monthly
                  </button>
                </div>
              </div>

              {/* Weekly Attendance */}
              {summaryView === "weekly" && (
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 overflow-x-auto">
                <h2 className="text-lg font-bold text-white mb-4">Weekly Attendance Summary</h2>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Employee</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Mon</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Tue</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Wed</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Thu</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Fri</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Total Days</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Attendance %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ATTENDANCE_DATA.map((record) => (
                      <tr key={record.id} className="border-b border-white/5 hover:bg-white/5 transition">
                        <td className="px-3 py-3 text-white font-medium">
                          <a href={`/employee/${record.id}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer">
                            {record.name}
                          </a>
                        </td>
                        <td className="px-3 py-3 text-center text-slate-300 text-xs"><span className="inline-block px-2 py-1 rounded bg-green-500/20 text-green-300">✓</span></td>
                        <td className="px-3 py-3 text-center text-slate-300 text-xs"><span className="inline-block px-2 py-1 rounded bg-green-500/20 text-green-300">✓</span></td>
                        <td className="px-3 py-3 text-center text-slate-300 text-xs"><span className="inline-block px-2 py-1 rounded bg-green-500/20 text-green-300">✓</span></td>
                        <td className="px-3 py-3 text-center text-slate-300 text-xs"><span className="inline-block px-2 py-1 rounded bg-green-500/20 text-green-300">✓</span></td>
                        <td className="px-3 py-3 text-center text-slate-300 text-xs"><span className="inline-block px-2 py-1 rounded bg-red-500/20 text-red-300">✗</span></td>
                        <td className="px-3 py-3 text-center text-white font-semibold">4 / 5</td>
                        <td className="px-3 py-3 text-center text-white font-semibold">80%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}

              {/* Monthly Attendance */}
              {summaryView === "monthly" && (
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 overflow-x-auto">
                <h2 className="text-lg font-bold text-white mb-4">Monthly Attendance Summary</h2>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Employee</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Total Days</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Present</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Absent</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Late</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Attendance %</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ATTENDANCE_DATA.map((record) => (
                      <tr key={record.id} className="border-b border-white/5 hover:bg-white/5 transition">
                        <td className="px-3 py-3 text-white font-medium">
                          <a href={`/employee/${record.id}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer">
                            {record.name}
                          </a>
                        </td>
                        <td className="px-3 py-3 text-center text-slate-300">22</td>
                        <td className="px-3 py-3 text-center text-green-300 font-semibold">21</td>
                        <td className="px-3 py-3 text-center text-red-300 font-semibold">1</td>
                        <td className="px-3 py-3 text-center text-yellow-300 font-semibold">2</td>
                        <td className="px-3 py-3 text-center text-white font-semibold">95%</td>
                        <td className="px-3 py-3">
                          <span className="inline-block px-2 py-1 rounded text-xs font-semibold bg-green-500/20 text-green-300 border border-green-500/30">Good</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}
            </>
          )}

          {activeTab === "pto-management" && (
            <div className="space-y-6">
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 overflow-x-auto">
                <h2 className="text-lg font-bold text-white mb-4">PTO Requests</h2>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Employee</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Type</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Dates</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Days</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Status</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PTO_REQUESTS.map((request) => (
                      <tr key={request.id} className="border-b border-white/5 hover:bg-white/5 transition">
                        <td className="px-3 py-3 text-white font-medium">{request.employeeName}</td>
                        <td className="px-3 py-3 text-slate-300">{request.type}</td>
                        <td className="px-3 py-3 text-slate-300">{request.startDate} to {request.endDate}</td>
                        <td className="px-3 py-3 text-center text-slate-300">{request.days}</td>
                        <td className="px-3 py-3">
                          <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${request.status === "pending" ? "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30" : request.status === "approved" ? "bg-green-500/20 text-green-300 border border-green-500/30" : "bg-red-500/20 text-red-300 border border-red-500/30"}`}>
                            {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          {request.status === "pending" && (
                            <div className="flex gap-1">
                              <button className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs transition flex items-center gap-1">
                                <CheckCircle className="h-3 w-3" />
                                Approve
                              </button>
                              <button className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs transition flex items-center gap-1">
                                <XCircle className="h-3 w-3" />
                                Reject
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* PTO History */}
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
                <h2 className="text-lg font-bold text-white mb-4">PTO History</h2>
                <div className="space-y-3">
                  {[
                    { id: "1", employeeName: "Carol Black", type: "Personal", dates: "Jun 20-21, 2026", status: "Approved", approvedBy: "Sarah Manager", approvedDate: "May 28, 2026" },
                    { id: "2", employeeName: "Tom Wilson", type: "Vacation", dates: "Jun 1-7, 2026", status: "Approved", approvedBy: "John Manager", approvedDate: "May 25, 2026" },
                    { id: "3", employeeName: "Lisa Jones", type: "Sick", dates: "May 30, 2026", status: "Rejected", approvedBy: "Sarah Manager", approvedDate: "May 29, 2026" },
                    { id: "4", employeeName: "David Lee", type: "Vacation", dates: "May 15-19, 2026", status: "Approved", approvedBy: "Finance Lead", approvedDate: "May 10, 2026" },
                  ].map((history) => (
                    <div key={history.id} className="bg-slate-800/50 border border-white/10 rounded-lg p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-white">{history.employeeName} - {history.type}</p>
                          <p className="text-xs text-slate-400 mt-1">{history.dates}</p>
                          <p className="text-xs text-slate-500 mt-2">
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold mr-2 ${
                              history.status === "Approved" ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"
                            }`}>
                              {history.status}
                            </span>
                            by {history.approvedBy} on {history.approvedDate}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === "corrections" && (
            <div className="space-y-6">
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 overflow-x-auto">
                <h2 className="text-lg font-bold text-white mb-4">Attendance Corrections</h2>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Employee</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Work Date</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Original Time</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Reason</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Status</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ATTENDANCE_CORRECTIONS.map((correction) => (
                      <tr key={correction.id} className="border-b border-white/5 hover:bg-white/5 transition">
                        <td className="px-3 py-3 text-white font-medium">
                          <a href={`/employee/${correction.employeeId}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer">
                            {correction.employeeName}
                          </a>
                        </td>
                        <td className="px-3 py-3 text-slate-300">{correction.workDate}</td>
                        <td className="px-3 py-3 text-slate-300">{correction.originalTime}</td>
                        <td className="px-3 py-3 text-slate-300">{correction.reason}</td>
                        <td className="px-3 py-3">
                          <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${correction.status === "pending" ? "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30" : correction.status === "approved" ? "bg-green-500/20 text-green-300 border border-green-500/30" : "bg-red-500/20 text-red-300 border border-red-500/30"}`}>
                            {correction.status.charAt(0).toUpperCase() + correction.status.slice(1)}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          {correction.status === "pending" && (
                            <button onClick={() => { setSelectedCorrection(correction); setCorrectionTimecardData({ checkIn: correction.originalTime, checkOut: correction.correctedTime }); }} className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs transition flex items-center gap-1">
                              View Timecard
                            </button>
                          )}
                          {correction.status === "approved" && (
                            <span className="text-slate-400 text-xs">Approved</span>
                          )}
                          {correction.status === "rejected" && (
                            <span className="text-slate-400 text-xs">Rejected</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Correction History */}
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
                <h2 className="text-lg font-bold text-white mb-4">Correction History</h2>
                <div className="space-y-3">
                  {CORRECTION_HISTORY.length > 0 ? (
                    CORRECTION_HISTORY.map((history) => {
                      const relatedCorrection = ATTENDANCE_CORRECTIONS.find(c => c.id === history.correctionId);
                      return (
                        <div key={history.id} className="bg-slate-800/50 border border-white/10 rounded-lg p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <p className="text-sm font-semibold text-white">{history.action}</p>
                              <p className="text-xs text-slate-400 mt-1">Changed by <span className="text-slate-300">{history.changedBy}</span> on {history.changedAt}</p>
                              {relatedCorrection && (
                                <p className="text-xs text-slate-400 mt-2">
                                  Employee: <span className="text-slate-300 font-semibold">{relatedCorrection.employeeName}</span> | 
                                  Date: <span className="text-slate-300">{relatedCorrection.workDate}</span> | 
                                  Original: <span className="text-slate-300">{relatedCorrection.originalTime}</span> → 
                                  Corrected: <span className="text-slate-300 font-semibold">{relatedCorrection.correctedTime}</span>
                                </p>
                              )}
                              <p className="text-xs text-slate-500 mt-2">
                                Status: <span className={`font-semibold ${history.previousStatus === "pending" ? "text-yellow-300" : history.previousStatus === "approved" ? "text-green-300" : "text-red-300"}`}>{history.previousStatus}</span> → 
                                <span className={`font-semibold ${history.newStatus === "pending" ? "text-yellow-300" : history.newStatus === "approved" ? "text-green-300" : "text-red-300"}`}> {history.newStatus}</span>
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-8">
                      <p className="text-slate-400 text-sm">No correction history yet</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Notes Modal */}
        {selectedNote && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-md w-full mx-4">
              {ATTENDANCE_DATA.filter((r) => r.id === selectedNote).map((record) => (
                <div key={record.id}>
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-white">{record.name}</h3>
                      <p className="text-sm text-slate-400">{record.workDate}</p>
                    </div>
                    <button onClick={() => setSelectedNote(null)} className="text-slate-400 hover:text-white transition p-1">✕</button>
                  </div>
                  <div className="mb-4">
                    <label className="block text-sm font-semibold text-slate-300 mb-2">Add Note</label>
                    <textarea value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Add note for this employee..." className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-3 text-white text-sm placeholder-slate-500 focus:border-blue-500 focus:outline-none resize-none" rows={4} />
                  </div>
                  <div className="space-y-3 mb-6">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={notifyIndividual} onChange={(e) => setNotifyIndividual(e.target.checked)} className="rounded border border-white/20 w-4 h-4 accent-blue-500" />
                      <div className="flex items-center gap-2">
                        <Bell className="h-4 w-4 text-blue-400" />
                        <span className="text-sm text-slate-300">Notify Individual</span>
                      </div>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={notifyTeamLead} onChange={(e) => setNotifyTeamLead(e.target.checked)} className="rounded border border-white/20 w-4 h-4 accent-blue-500" />
                      <div className="flex items-center gap-2">
                        <Bell className="h-4 w-4 text-orange-400" />
                        <span className="text-sm text-slate-300">Notify Team Lead</span>
                      </div>
                    </label>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => { setNotesData({ ...notesData, [record.id]: { content: newNote, notifyIndividual, notifyTeamLead } }); setSelectedNote(null); alert("Note saved successfully!"); }} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-semibold text-sm">Save Note</button>
                    <button onClick={() => setSelectedNote(null)} className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition font-semibold text-sm">Close</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Timecard Correction Modal */}
        {selectedCorrection && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-white">Timecard Correction</h2>
                  <p className="text-sm text-slate-400 mt-1">Employee: <a href={`/employee/${selectedCorrection.employeeId}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">{selectedCorrection.employeeName}</a></p>
                  <p className="text-sm text-slate-400">Work Date: {selectedCorrection.workDate}</p>
                </div>
                <button onClick={() => setSelectedCorrection(null)} className="text-slate-400 hover:text-white transition p-1">✕</button>
              </div>

              {/* Timecard Details */}
              <div className="bg-slate-800/50 border border-white/10 rounded-lg p-4 mb-6">
                <h3 className="text-sm font-bold text-white mb-4">Clock Times</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-2">Check In</label>
                    <input type="time" value={correctionTimecardData.checkIn} onChange={(e) => setCorrectionTimecardData({ ...correctionTimecardData, checkIn: e.target.value })} className="w-full bg-slate-700/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-2">Check Out</label>
                    <input type="time" value={correctionTimecardData.checkOut} onChange={(e) => setCorrectionTimecardData({ ...correctionTimecardData, checkOut: e.target.value })} className="w-full bg-slate-700/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
                  </div>
                </div>
              </div>

              {/* Correction Details */}
              <div className="bg-slate-800/50 border border-white/10 rounded-lg p-4 mb-6">
                <h3 className="text-sm font-bold text-white mb-4">Correction Details</h3>
                <div className="space-y-2">
                  <p className="text-sm text-slate-300"><span className="text-slate-400">Reason:</span> {selectedCorrection.reason}</p>
                  <p className="text-sm text-slate-300"><span className="text-slate-400">Requested:</span> {selectedCorrection.requestDate}</p>
                  <p className="text-sm text-slate-300"><span className="text-slate-400">Status:</span> <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${selectedCorrection.status === "pending" ? "bg-yellow-500/20 text-yellow-300" : selectedCorrection.status === "approved" ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"}`}>{selectedCorrection.status}</span></p>
                </div>
              </div>

              {/* Action Buttons */}
              {selectedCorrection.status === "pending" && (
                <div className="grid gap-3 mb-6 md:grid-cols-2">
                  <button onClick={() => { 
                    const updatedCorrections = ATTENDANCE_CORRECTIONS.map(c => 
                      c.id === selectedCorrection.id 
                        ? { ...c, status: "approved" as const, correctedTime: correctionTimecardData.checkOut } 
                        : c
                    );
                    alert(`Correction approved! ${selectedCorrection.employeeName}'s timecard updated.\nCheck In: ${correctionTimecardData.checkIn}\nCheck Out: ${correctionTimecardData.checkOut}`); 
                    setSelectedCorrection(null); 
                  }} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition font-semibold text-sm flex items-center justify-center gap-2">
                    <CheckCircle className="h-4 w-4" />
                    Save & Approve
                  </button>
                  <button onClick={() => { 
                    alert("Correction rejected!"); 
                    setSelectedCorrection(null); 
                  }} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition font-semibold text-sm flex items-center justify-center gap-2">
                    <XCircle className="h-4 w-4" />
                    Reject
                  </button>
                </div>
              )}

              {/* Correction History for this item */}
              <div className="border-t border-white/10 pt-4">
                <h3 className="text-sm font-bold text-white mb-3">This Correction's History</h3>
                <div className="space-y-2">
                  {CORRECTION_HISTORY.filter(h => h.correctionId === selectedCorrection.id).length > 0 ? (
                    CORRECTION_HISTORY.filter(h => h.correctionId === selectedCorrection.id).map((history) => (
                      <div key={history.id} className="bg-slate-700/30 border border-white/5 rounded p-3 text-xs">
                        <p className="text-slate-300">{history.action} by <span className="font-semibold text-white">{history.changedBy}</span></p>
                        <p className="text-slate-500">{history.changedAt}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-slate-500 text-xs">No history yet</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Alert Details Modal */}
        {alertModalOpen && selectedAlertType && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setAlertModalOpen(false)}>
            <div className="bg-slate-900 border border-white/10 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
              {/* Modal Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
                <h2 className="text-lg font-bold text-white">
                  {selectedAlertType === "missing-clockin" && "Missing Clock In"}
                  {selectedAlertType === "missing-clockout" && "Missing Clock Out"}
                  {selectedAlertType === "late-arrival" && "Late Arrival"}
                </h2>
                <button
                  onClick={() => setAlertModalOpen(false)}
                  className="p-1 hover:bg-white/10 rounded transition"
                >
                  <svg className="w-5 h-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Modal Content */}
              <div className="flex-1 overflow-y-auto p-6">
                <div className="space-y-3">
                  {selectedAlertType === "missing-clockin" && ATTENDANCE_DATA.filter(r => r.checkIn === "—").map(record => (
                    <div key={record.id} className="bg-slate-800/50 border border-red-500/30 rounded-lg p-4 hover:bg-slate-800/70 transition">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-white font-semibold">{record.name}</p>
                          <p className="text-xs text-slate-400 mt-1">{record.department} • {record.location}</p>
                          <p className="text-xs text-slate-500 mt-2">Manager: {record.manager}</p>
                        </div>
                        <div className="text-right">
                          <span className="inline-block px-3 py-1 bg-red-500/20 text-red-300 text-xs font-semibold rounded border border-red-500/40">
                            No Clock In
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}

                  {selectedAlertType === "missing-clockout" && ATTENDANCE_DATA.filter(r => r.checkOut === "—" && r.checkIn !== "—").map(record => (
                    <div key={record.id} className="bg-slate-800/50 border border-yellow-500/30 rounded-lg p-4 hover:bg-slate-800/70 transition">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-white font-semibold">{record.name}</p>
                          <p className="text-xs text-slate-400 mt-1">{record.department} • {record.location}</p>
                          <p className="text-xs text-slate-400 mt-2">Clock In: <span className="font-mono font-semibold">{record.checkIn}</span></p>
                          <p className="text-xs text-slate-500 mt-1">Manager: {record.manager}</p>
                        </div>
                        <div className="text-right">
                          <span className="inline-block px-3 py-1 bg-yellow-500/20 text-yellow-300 text-xs font-semibold rounded border border-yellow-500/40">
                            No Clock Out
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}

                  {selectedAlertType === "late-arrival" && ATTENDANCE_DATA.filter(r => r.alerts.some(a => a.includes("Late"))).map(record => (
                    <div key={record.id} className="bg-slate-800/50 border border-orange-500/30 rounded-lg p-4 hover:bg-slate-800/70 transition">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-white font-semibold">{record.name}</p>
                          <p className="text-xs text-slate-400 mt-1">{record.department} • {record.location}</p>
                          <p className="text-xs text-slate-400 mt-2">Check In: <span className="font-mono font-semibold">{record.checkIn}</span></p>
                          <p className="text-xs text-slate-500 mt-1">Manager: {record.manager}</p>
                        </div>
                        <div className="text-right">
                          <span className="inline-block px-3 py-1 bg-orange-500/20 text-orange-300 text-xs font-semibold rounded border border-orange-500/40">
                            Late
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Modal Footer */}
              <div className="border-t border-white/10 px-6 py-4">
                <button
                  onClick={() => setAlertModalOpen(false)}
                  className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
