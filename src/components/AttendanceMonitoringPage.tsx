import { AlertCircle, Clock, Users, UserCheck, UserX, Bell, MessageSquare, ChevronLeft, Download } from "lucide-react";
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

const ATTENDANCE_DATA: AttendanceRecord[] = [
  {
    id: "1",
    name: "John Doe",
    location: "Atlanta",
    department: "Operations",
    manager: "Sarah Manager",
    workDate: "2026-06-04",
    checkIn: "8:00 AM",
    mealIn: "12:00 PM",
    mealOut: "12:30 PM",
    checkOut: "5:00 PM",
    alerts: [],
    notes: "",
    notifyIndividual: false,
    notifyTeamLead: false,
  },
  {
    id: "2",
    name: "Jane Smith",
    location: "Atlanta",
    department: "Customer Service",
    manager: "John Manager",
    workDate: "2026-06-04",
    checkIn: "8:15 AM",
    mealIn: "12:00 PM",
    mealOut: "12:45 PM",
    checkOut: "5:00 PM",
    alerts: ["Late Check In"],
    notes: "Traffic delay",
    notifyIndividual: true,
    notifyTeamLead: false,
  },
  {
    id: "3",
    name: "Mike Brown",
    location: "Dallas",
    department: "Parts",
    manager: "Bob Parts Manager",
    workDate: "2026-06-04",
    checkIn: "—",
    mealIn: "—",
    mealOut: "—",
    checkOut: "—",
    alerts: ["Absent", "No Clock In"],
    notes: "Called in sick",
    notifyIndividual: true,
    notifyTeamLead: true,
  },
  {
    id: "4",
    name: "Sarah Johnson",
    location: "Houston",
    department: "Finance",
    manager: "Finance Lead",
    workDate: "2026-06-04",
    checkIn: "7:45 AM",
    mealIn: "12:15 PM",
    mealOut: "12:45 PM",
    checkOut: "4:45 PM",
    alerts: ["Under Time (8h 0m)"],
    notes: "",
    notifyIndividual: true,
    notifyTeamLead: false,
  },
  {
    id: "5",
    name: "Tom Wilson",
    location: "Austin",
    department: "Operations",
    manager: "Sarah Manager",
    workDate: "2026-06-04",
    checkIn: "8:30 AM",
    mealIn: "1:00 PM",
    mealOut: "1:30 PM",
    checkOut: "5:15 PM",
    alerts: ["Late Check In", "Over Time (8h 45m)"],
    notes: "Completed urgent project",
    notifyIndividual: true,
    notifyTeamLead: true,
  },
];

export function AttendanceMonitoringPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef; }) {
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  const [notesData, setNotesData] = useState<Record<string, { content: string; notifyIndividual: boolean; notifyTeamLead: boolean }>>({});
  const [newNote, setNewNote] = useState("");
  const [notifyIndividual, setNotifyIndividual] = useState(false);
  const [notifyTeamLead, setNotifyTeamLead] = useState(false);
  
  const totalEmployees = ATTENDANCE_DATA.length;
  const presentToday = ATTENDANCE_DATA.filter((r) => r.checkIn !== "—").length;
  const absentToday = ATTENDANCE_DATA.filter((r) => r.checkIn === "—").length;
  const lateToday = ATTENDANCE_DATA.filter((r) => r.alerts.some((a) => a.includes("Late"))).length;

  const getAlertColor = (alert: string) => {
    if (alert.includes("Over Time")) return "bg-blue-500/20 text-blue-300 border-blue-500/30";
    if (alert.includes("Under Time")) return "bg-yellow-500/20 text-yellow-300 border-yellow-500/30";
    if (alert.includes("No Meal") || alert.includes("No Lunch")) return "bg-orange-500/20 text-orange-300 border-orange-500/30";
    if (alert.includes("Late")) return "bg-yellow-500/20 text-yellow-300 border-yellow-500/30";
    return "bg-red-500/20 text-red-300 border-red-500/30";
  };

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
          {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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
      </div>

      {/* Automated Alerts Section */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 bg-slate-900/50 border border-white/10 rounded-lg p-4">
          <h2 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-orange-400" />
            Automated Alerts
          </h2>
          <div className="grid gap-2 sm:grid-cols-3">
            {/* Failed to Log In Alert */}
            <div className="bg-red-500/10 border border-red-500/30 rounded p-2">
              <p className="text-xs font-semibold text-red-300 mb-1">Failed to Log In</p>
              <div className="flex items-center gap-2">
                <input type="checkbox" defaultChecked className="rounded w-3 h-3 accent-red-500" />
                <span className="text-xs text-slate-300">Supervisor: {ATTENDANCE_DATA.filter(r => r.checkIn === "—").length} alert(s)</span>
              </div>
            </div>

            {/* Missing Clock Out Alert */}
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-2">
              <p className="text-xs font-semibold text-yellow-300 mb-1">Missing Clock Out</p>
              <div className="flex items-center gap-2">
                <input type="checkbox" defaultChecked className="rounded w-3 h-3 accent-yellow-500" />
                <span className="text-xs text-slate-300">Employee: {ATTENDANCE_DATA.filter(r => r.checkOut === "—" && r.checkIn !== "—").length} alert(s)</span>
              </div>
            </div>

            {/* Repeated Tardiness Alert */}
            <div className="bg-orange-500/10 border border-orange-500/30 rounded p-2">
              <p className="text-xs font-semibold text-orange-300 mb-1">Repeated Tardiness</p>
              <div className="flex items-center gap-2">
                <input type="checkbox" defaultChecked className="rounded w-3 h-3 accent-orange-500" />
                <span className="text-xs text-slate-300">Manager: {ATTENDANCE_DATA.filter(r => r.alerts.some(a => a.includes("Late"))).length} alert(s)</span>
              </div>
            </div>
          </div>
        </div>
        <button
          onClick={handleDownloadSummary}
          className="px-4 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-semibold flex items-center gap-2 h-fit whitespace-nowrap"
        >
          <Download className="h-4 w-4" />
          <span className="text-sm">Download Summary</span>
        </button>
      </div>

      {/* Detailed Attendance Tracker */}
      <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
        <h2 className="text-lg font-bold text-white mb-4">Daily Attendance Tracker</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Employee Name</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Location</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Department</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Manager</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Work Date</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Check In</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Meal In</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Meal Out</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Check Out</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Alerts</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Notes</th>
              </tr>
            </thead>
            <tbody>
              {ATTENDANCE_DATA.map((record) => (
                <tr key={record.id} className="border-b border-white/5 hover:bg-white/5 transition">
                  <td className="px-3 py-3 text-white font-medium">
                    <a href={`/employee/${record.id}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 hover:underline">
                      {record.name}
                    </a>
                  </td>
                  <td className="px-3 py-3 text-slate-300">{record.location}</td>
                  <td className="px-3 py-3 text-slate-300">{record.department}</td>
                  <td className="px-3 py-3 text-slate-300">{record.manager}</td>
                  <td className="px-3 py-3 text-slate-300">{record.workDate}</td>
                  <td className="px-3 py-3 text-slate-300">{record.checkIn}</td>
                  <td className="px-3 py-3 text-slate-300">{record.mealIn}</td>
                  <td className="px-3 py-3 text-slate-300">{record.mealOut}</td>
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
                    <button
                      onClick={() => {
                        setSelectedNote(record.id);
                        setNewNote(notesData[record.id]?.content || "");
                        setNotifyIndividual(notesData[record.id]?.notifyIndividual || false);
                        setNotifyTeamLead(notesData[record.id]?.notifyTeamLead || false);
                      }}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 transition"
                    >
                      <MessageSquare className="h-4 w-4" />
                      <span className="text-xs">{notesData[record.id] ? "Edit" : "Add"}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
                  <button
                    onClick={() => setSelectedNote(null)}
                    className="text-slate-400 hover:text-white transition p-1"
                  >
                    ✕
                  </button>
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-semibold text-slate-300 mb-2">Add Note</label>
                  <textarea
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="Add note for this employee..."
                    className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-3 text-white text-sm placeholder-slate-500 focus:border-blue-500 focus:outline-none resize-none"
                    rows={4}
                  />
                </div>

                <div className="space-y-3 mb-6">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={notifyIndividual}
                      onChange={(e) => setNotifyIndividual(e.target.checked)}
                      className="rounded border border-white/20 w-4 h-4 accent-blue-500"
                    />
                    <div className="flex items-center gap-2">
                      <Bell className="h-4 w-4 text-blue-400" />
                      <span className="text-sm text-slate-300">Notify Individual Employee</span>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={notifyTeamLead}
                      onChange={(e) => setNotifyTeamLead(e.target.checked)}
                      className="rounded border border-white/20 w-4 h-4 accent-blue-500"
                    />
                    <div className="flex items-center gap-2">
                      <Bell className="h-4 w-4 text-orange-400" />
                      <span className="text-sm text-slate-300">Notify Team Lead</span>
                    </div>
                  </label>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setNotesData({
                        ...notesData,
                        [record.id]: {
                          content: newNote,
                          notifyIndividual,
                          notifyTeamLead,
                        },
                      });
                      setSelectedNote(null);
                      alert("Note saved successfully!");
                    }}
                    className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-semibold text-sm"
                  >
                    Save Note
                  </button>
                  <button
                    onClick={() => setSelectedNote(null)}
                    className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition font-semibold text-sm"
                  >
                    Close
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
        </div>
      </main>
    </div>
  );
}
