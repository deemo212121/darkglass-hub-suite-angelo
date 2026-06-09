import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AccountPageShell } from "@/components/AccountPageShell";
import { useAuth } from "@/lib/auth";
import { getEmployeeFromEmail } from "@/lib/userDataSync";
import { Save, Clock, Calendar } from "lucide-react";
import { DUMMY_EMPLOYEES } from "@/lib/dummyData";

export const Route = createFileRoute("/profile")({
  head: () => ({ meta: [{ title: "My Profile — Admin Hub Solutions" }] }),
  component: ProfilePage,
});

type Profile = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  department: string;
  title: string;
};

interface TimecardRecord {
  date: string;
  checkIn: string;
  mealStart: string;
  mealEnd: string;
  checkOut: string;
  working: string;
  rate: number;
}

interface WeekDay {
  dayNum: number;
  dayName: string;
  isOffDay: boolean;
}

const KEY = "ahs:profile";
const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function ProfilePage() {
  const { email } = useAuth();
  const employee = getEmployeeFromEmail(email);
  
  const [profile, setProfile] = useState<Profile>({
    firstName: "",
    lastName: "",
    email: email ?? "",
    phone: "",
    department: "Service",
    title: "Technician",
  });
  const [password, setPassword] = useState({ current: "", next: "", confirm: "" });
  const [saved, setSaved] = useState<string>("");
  const [timecardData, setTimecardData] = useState<TimecardRecord[]>([]);
  const [currentWeekDays, setCurrentWeekDays] = useState<WeekDay[]>([]);
  const [selectedOffDays, setSelectedOffDays] = useState<number[]>([]);

  // Timecard database mapping - matches PayrollCalculationPage
  const timecardDatabase: { [key: string]: TimecardRecord[] } = {
    "006": [ // Maria Santos
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
    ],
    "008": [ // Anna Reyes
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
    ],
    "007": [ // Juan Dela Cruz
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
    ],
  };

  // Generate current week (Mon-Sun)
  const generateCurrentWeek = () => {
    const week: WeekDay[] = [];
    for (let i = 0; i < 7; i++) {
      week.push({
        dayNum: i,
        dayName: DAYS_OF_WEEK[i],
        isOffDay: selectedOffDays.includes(i),
      });
    }
    setCurrentWeekDays(week);
  };

  const toggleOffDay = (dayNum: number) => {
    setSelectedOffDays(prev => {
      const newOffDays = prev.includes(dayNum)
        ? prev.filter(d => d !== dayNum)
        : [...prev, dayNum];
      
      // Save to localStorage
      if (employee) {
        const dummyEmployee = DUMMY_EMPLOYEES.find(e => e.email === employee.email);
        if (dummyEmployee) {
          const timecardKey = dummyEmployee.id.split("-").pop() || "unknown";
          localStorage.setItem(`offDays_${timecardKey}`, JSON.stringify(newOffDays));
        }
      }
      
      return newOffDays;
    });
  };

  // Load profile data - prioritize current employee, then localStorage, then defaults
  useEffect(() => {
    generateCurrentWeek();
    
    if (employee) {
      // Always load from current employee first - this is the source of truth
      const parts = employee.name.split(" ");
      const employeeProfile: Profile = {
        firstName: parts[0] || "",
        lastName: parts.slice(1).join(" ") || "",
        email: employee.email,
        phone: "", // Phone not in employee data
        department: employee.department,
        title: employee.role,
      };
      setProfile(employeeProfile);
      
      // Load timecard data for this employee
      const dummyEmployee = DUMMY_EMPLOYEES.find(e => e.email === employee.email);
      if (dummyEmployee) {
        const timecardKey = dummyEmployee.id.split("-").pop() === "001" ? "001" : 
                           dummyEmployee.id.split("-").pop() === "002" ? "002" :
                           dummyEmployee.id.split("-").pop() === "003" ? "003" :
                           dummyEmployee.id.split("-").pop() === "004" ? "004" :
                           dummyEmployee.id.split("-").pop() === "005" ? "005" :
                           dummyEmployee.id.split("-").pop() === "006" ? "006" :
                           dummyEmployee.id.split("-").pop() === "007" ? "007" :
                           dummyEmployee.id.split("-").pop() === "008" ? "008" :
                           dummyEmployee.id.split("-").pop() === "009" ? "009" : "010";
        
        setTimecardData(timecardDatabase[timecardKey] || []);
        
        // Load saved off days from localStorage
        const savedOffDays = localStorage.getItem(`offDays_${timecardKey}`);
        if (savedOffDays) {
          const offDayIndices = JSON.parse(savedOffDays);
          setSelectedOffDays(offDayIndices);
        } else {
          // Default sample days off
          const defaultOffDays = timecardKey === "008" ? [4, 5] : []; // Friday, Saturday for Anna
          setSelectedOffDays(defaultOffDays);
        }
      }
      
      // Clear old localStorage data for this email to prevent confusion
      localStorage.removeItem(KEY);
    } else {
      // Only if not an employee email, try localStorage
      const raw = localStorage.getItem(KEY);
      if (raw) {
        try {
          setProfile((current) => ({ ...current, ...JSON.parse(raw) }));
        } catch {}
      }
    }
  }, [employee, email]);

  // Update week when selected off days change
  useEffect(() => {
    generateCurrentWeek();
  }, [selectedOffDays]);

  const save = () => {
    localStorage.setItem(KEY, JSON.stringify(profile));
    setSaved("Profile saved.");
    setTimeout(() => setSaved(""), 2000);
  };

  const changePassword = () => {
    if (!password.next || password.next !== password.confirm) {
      setSaved("Passwords don't match.");
      return;
    }
    setPassword({ current: "", next: "", confirm: "" });
    setSaved("Password updated.");
    setTimeout(() => setSaved(""), 2000);
  };

  const field = (label: string, key: keyof Profile, type = "text") => (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        className="glass-input"
        type={type}
        value={profile[key]}
        onChange={(e) => setProfile({ ...profile, [key]: e.target.value })}
      />
    </label>
  );

  return (
    <AccountPageShell title="My Profile" description="Manage your account details and password.">
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="panel">
          <h2 className="text-lg font-semibold mb-4">Account details</h2>
          {employee && (
            <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <p className="text-xs text-blue-200">
                📋 Your profile is synced with employee data for {employee.name}. Department and role reflect your current assignment.
              </p>
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-4">
            {field("First name", "firstName")}
            {field("Last name", "lastName")}
            {field("Email", "email", "email")}
            {field("Phone", "phone", "tel")}
            {field("Department", "department")}
            {field("Title", "title")}
          </div>
          <div className="flex items-center gap-3 mt-5">
            <button className="btn btn-primary" onClick={save}><Save className="h-4 w-4" />Save changes</button>
            {saved && <span className="text-xs text-muted-foreground">{saved}</span>}
          </div>
        </section>
        <section className="panel">
          <h2 className="text-lg font-semibold mb-4">Change password</h2>
          <div className="grid gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Current password</span>
              <input className="glass-input" type="password" value={password.current} onChange={(e) => setPassword({ ...password, current: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">New password</span>
              <input className="glass-input" type="password" value={password.next} onChange={(e) => setPassword({ ...password, next: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Confirm new password</span>
              <input className="glass-input" type="password" value={password.confirm} onChange={(e) => setPassword({ ...password, confirm: e.target.value })} />
            </label>
          </div>
          <div className="mt-5">
            <button className="btn btn-primary" onClick={changePassword}><Save className="h-4 w-4" />Update password</button>
          </div>
        </section>
      </div>

      {/* Time In/Out Details Section */}
      {timecardData.length > 0 && (
        <section className="panel mt-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Clock className="h-5 w-5 text-blue-400" />
            Time In/Out Details
          </h2>
          <p className="text-xs text-slate-400 mb-4">Your recent daily clock in/out records for the current payroll period.</p>
          
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-800/50 border-b border-white/10">
                  <th className="px-3 py-2 text-left font-semibold text-slate-300">Date</th>
                  <th className="px-3 py-2 text-center font-semibold text-slate-300">Check In</th>
                  <th className="px-3 py-2 text-center font-semibold text-slate-300">Meal Start</th>
                  <th className="px-3 py-2 text-center font-semibold text-slate-300">Meal End</th>
                  <th className="px-3 py-2 text-center font-semibold text-slate-300">Check Out</th>
                  <th className="px-3 py-2 text-center font-semibold text-slate-300">Hours Worked</th>
                </tr>
              </thead>
              <tbody>
                {timecardData.map((record, idx) => (
                  <tr key={idx} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2 text-slate-300 font-medium">{record.date}</td>
                    <td className="px-3 py-2 text-center text-slate-300">{record.checkIn}</td>
                    <td className="px-3 py-2 text-center text-slate-300">{record.mealStart}</td>
                    <td className="px-3 py-2 text-center text-slate-300">{record.mealEnd}</td>
                    <td className="px-3 py-2 text-center text-slate-300">{record.checkOut}</td>
                    <td className="px-3 py-2 text-center text-green-300 font-semibold">{record.working}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Days Off Section - Week Selector */}
      <section className="panel mt-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Calendar className="h-5 w-5 text-purple-400" />
          Days Off
        </h2>
        
        {/* Week Calendar */}
        <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
          <div className="grid grid-cols-7 gap-3">
            {currentWeekDays.map((day) => (
              <button
                key={day.dayNum}
                onClick={() => toggleOffDay(day.dayNum)}
                className={`p-4 rounded-lg border-2 transition flex flex-col items-center justify-center min-h-20 ${
                  day.isOffDay
                    ? "bg-red-500/20 border-red-500/50 text-red-300"
                    : "bg-slate-800/50 border-white/10 text-slate-300 hover:border-white/30"
                }`}
              >
                <span className="text-sm font-bold uppercase">{day.dayName}</span>
                <span className="text-xs mt-2 opacity-75">
                  {day.isOffDay ? "OFF" : "WORK"}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Summary */}
        {selectedOffDays.length > 0 && (
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mt-4">
            <p className="text-sm text-blue-200">
              <span className="font-semibold">Days off selected:</span> {selectedOffDays.map(d => DAYS_OF_WEEK[d]).join(", ")}
            </p>
          </div>
        )}
      </section>
    </AccountPageShell>
  );
}
