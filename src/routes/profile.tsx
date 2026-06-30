import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AccountPageShell } from "@/components/AccountPageShell";
import { useAuth } from "@/lib/auth";
import { getEmployeeFromEmail } from "@/lib/userDataSync";
import { Save, Clock, Calendar, Lock } from "lucide-react";
import { DUMMY_EMPLOYEES } from "@/lib/dummyData";
import {
  getMyProfileSchedule,
} from "@/lib/supabase/timecards";
import { updateCompanyUser } from "@/lib/supabase/users";
import { supabase } from "@/lib/supabase/client";

// Roles that are allowed to change a user's Required Schedule and Days Off.
const SCHEDULE_EDIT_ROLES = new Set([
  "SUPERADMIN",
  "ADMIN",
  "HR",
  "MANAGER",
  "BRANCH_MANAGER",
  "SENIOR_BRANCH_MANAGER",
  "CSR_MANAGER",
  "CLAIMS_MANAGER",
  "PARTS_MANAGER",
  "BIZOPS_MANAGER",
  "BIZOPS_SENIOR_MANAGER",
]);

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
  officeLocation: string;
  poInitials: string;
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

interface RequiredSchedule {
  requiredCheckIn: string;
  requiredCheckOut: string;
}

const KEY = "ahs:profile";
const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const LOCATION_STORAGE_KEY = "ahs:location-management:locations";

// Default locations matching LocationManagementPage defaults
const DEFAULT_LOCATIONS = [
  "Memphis",
  "Nashville",
  "Jacksonville",
  "Tallahassee",
  "Birmingham",
  "Huntsville",
  "Jonesboro",
  "Atlanta",
  "Knoxville",
  "Wilmington",
  "Mobile",
  "Savannah",
  "Montgomery",
  "Chattanooga",
  "Columbus",
  "Jackson,MS",
  "Raleigh",
  "New Orleans",
  "Louisville",
  "St. Louis",
  "Richmond",
  "Jackson,TN",
  "Asheville",
  "Norfolk",
  "Little Rock",
  "Cape Girardeau",
  "Destin",
  "San Antonio",
  "Lake Charles",
  "Dallas",
  "Philippines",
];

function ProfilePage() {
  const { email, uid, role } = useAuth();
  const employee = getEmployeeFromEmail(email);
  const canEditSchedule = SCHEDULE_EDIT_ROLES.has(String(role || "").toUpperCase());
  const [profileId, setProfileId] = useState<string | null>(null);
  
  const [profile, setProfile] = useState<Profile>({
    firstName: "",
    lastName: "",
    email: email ?? "",
    phone: "",
    department: "Service",
    title: "Technician",
    officeLocation: "US",
    poInitials: "",
  });
  const [password, setPassword] = useState({ current: "", next: "", confirm: "" });
  const [saved, setSaved] = useState<string>("");
  const [timecardData, setTimecardData] = useState<TimecardRecord[]>([]);
  const [currentWeekDays, setCurrentWeekDays] = useState<WeekDay[]>([]);
  const [selectedOffDays, setSelectedOffDays] = useState<number[]>([]);
  const [requiredSchedule, setRequiredSchedule] = useState<RequiredSchedule>({
    requiredCheckIn: "08:00",
    requiredCheckOut: "17:00",
  });
  const [locations, setLocations] = useState<string[]>(DEFAULT_LOCATIONS);

  // Timecard database mapping
  const timecardDatabase: { [key: string]: TimecardRecord[] } = {
    "006": [ // Maria Santos
      { date: "06/01/2026", checkIn: "06:00", mealStart: "10:00", mealEnd: "11:00", checkOut: "15:00", working: "8:00:00", rate: 850 },
      { date: "06/02/2026", checkIn: "06:00", mealStart: "10:00", mealEnd: "11:00", checkOut: "15:00", working: "8:00:00", rate: 850 },
      { date: "06/03/2026", checkIn: "06:00", mealStart: "10:00", mealEnd: "11:00", checkOut: "15:00", working: "8:00:00", rate: 850 },
      { date: "06/04/2026", checkIn: "06:00", mealStart: "10:00", mealEnd: "11:00", checkOut: "15:00", working: "8:00:00", rate: 850 },
      { date: "06/05/2026", checkIn: "06:00", mealStart: "10:00", mealEnd: "11:00", checkOut: "15:00", working: "8:00:00", rate: 850 },
    ],
    "008": [ // Anna Reyes
      { date: "06/01/2026", checkIn: "07:30", mealStart: "11:30", mealEnd: "12:30", checkOut: "16:30", working: "8:00:00", rate: 550 },
      { date: "06/02/2026", checkIn: "07:30", mealStart: "11:30", mealEnd: "12:30", checkOut: "16:30", working: "8:00:00", rate: 550 },
      { date: "06/03/2026", checkIn: "07:30", mealStart: "11:30", mealEnd: "12:30", checkOut: "16:30", working: "8:00:00", rate: 550 },
      { date: "06/04/2026", checkIn: "07:30", mealStart: "11:30", mealEnd: "12:30", checkOut: "16:30", working: "8:00:00", rate: 550 },
      { date: "06/05/2026", checkIn: "07:30", mealStart: "11:30", mealEnd: "12:30", checkOut: "20:30", working: "12:00:00", rate: 550 },
    ],
    "007": [ // Juan Dela Cruz
      { date: "06/01/2026", checkIn: "10:00", mealStart: "13:00", mealEnd: "14:00", checkOut: "19:00", working: "8:00:00", rate: 650 },
      { date: "06/02/2026", checkIn: "10:00", mealStart: "13:00", mealEnd: "14:00", checkOut: "19:00", working: "8:00:00", rate: 650 },
      { date: "06/03/2026", checkIn: "10:00", mealStart: "13:00", mealEnd: "14:00", checkOut: "19:00", working: "8:00:00", rate: 650 },
      { date: "06/04/2026", checkIn: "10:00", mealStart: "13:00", mealEnd: "14:00", checkOut: "19:00", working: "8:00:00", rate: 650 },
      { date: "06/05/2026", checkIn: "10:00", mealStart: "13:00", mealEnd: "14:00", checkOut: "19:00", working: "8:00:00", rate: 650 },
    ],
  };

  // Generate current week
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
    if (!canEditSchedule) return;
    setSelectedOffDays(prev => {
      const newOffDays = prev.includes(dayNum)
        ? prev.filter(d => d !== dayNum)
        : [...prev, dayNum];
      
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

  useEffect(() => {
    generateCurrentWeek();
    
    // Load locations from localStorage (synced with LocationManagementPage)
    const loadLocations = () => {
      try {
        const raw = localStorage.getItem(LOCATION_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed.rows) && parsed.rows.length > 0) {
            // Extract location names from storage
            const locationNames = parsed.rows.map((row: any) => row.location).filter(Boolean);
            
            // Filter to only include locations that are in DEFAULT_LOCATIONS (removes duplicates/custom entries)
            const validLocations = locationNames.filter((name: string) => 
              DEFAULT_LOCATIONS.includes(name)
            );
            
            if (validLocations.length > 0) {
              // Sort to match DEFAULT_LOCATIONS order
              const sorted = validLocations.sort((a: string, b: string) => 
                DEFAULT_LOCATIONS.indexOf(a) - DEFAULT_LOCATIONS.indexOf(b)
              );
              setLocations(sorted);
              return;
            }
          }
        }
      } catch (error) {
        console.error('Failed to load locations from storage:', error);
      }
      // Fall back to default locations (which includes Asheville)
      setLocations(DEFAULT_LOCATIONS);
    };
    
    loadLocations();
    
    if (employee) {
      const parts = employee.name.split(" ");
      // Determine default office location based on country and available locations
      let defaultLocation = "Atlanta"; // Default to Atlanta for US
      if (employee.country === "PH") {
        defaultLocation = "Philippines"; // Default to Philippines for PH employees
      }
      
      const employeeProfile: Profile = {
        firstName: parts[0] || "",
        lastName: parts.slice(1).join(" ") || "",
        email: employee.email,
        phone: "",
        department: employee.department,
        title: employee.role,
        officeLocation: defaultLocation,
        poInitials: "",
      };
      setProfile(employeeProfile);
      
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
        
        const savedOffDays = localStorage.getItem(`offDays_${timecardKey}`);
        if (savedOffDays) {
          setSelectedOffDays(JSON.parse(savedOffDays));
        } else {
          const defaultOffDays = timecardKey === "008" ? [4, 5] : [];
          setSelectedOffDays(defaultOffDays);
        }
        
        const savedSchedule = localStorage.getItem(`requiredSchedule_${timecardKey}`);
        if (savedSchedule) {
          setRequiredSchedule(JSON.parse(savedSchedule));
        }
        
        const savedPOInitials = localStorage.getItem(`poInitials_${timecardKey}`);
        if (savedPOInitials) {
          setProfile(prev => ({ ...prev, poInitials: savedPOInitials }));
        }
      }
      localStorage.removeItem(KEY);
    }
  }, [employee, email]);

  useEffect(() => {
    generateCurrentWeek();
  }, [selectedOffDays]);

  // Load the authoritative Required Schedule + days off from Supabase. This
  // is what the timecard page also reads, so changes here keep both views in
  // sync. Falls back to whatever localStorage had if Supabase is unreachable.
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      try {
        const sched = await getMyProfileSchedule(uid);
        if (cancelled) return;
        if (sched.profileId) {
          setProfileId(sched.profileId);
          if (sched.requiredCheckIn || sched.requiredCheckOut) {
            setRequiredSchedule({
              requiredCheckIn: sched.requiredCheckIn || "08:00",
              requiredCheckOut: sched.requiredCheckOut || "17:00",
            });
          }
        }
        // Pull off_days separately — getMyProfileSchedule doesn't return it.
        const { data } = await supabase
          .from("profiles")
          .select("off_days")
          .eq("firebase_uid", uid)
          .maybeSingle();
        if (!cancelled && Array.isArray((data as any)?.off_days)) {
          setSelectedOffDays((data as any).off_days as number[]);
        }
      } catch (err) {
        console.warn("Profile load (Supabase) skipped:", err);
      }
    })();
    return () => { cancelled = true; };
    // void unused import to satisfy linter when getProfileIdByFirebaseUid is
    // reserved for future use.
  }, [uid]);

  const save = async () => {
    localStorage.setItem(KEY, JSON.stringify(profile));

    // Also save required schedule and PO initials locally so other parts of
    // the legacy UI that still read from localStorage stay current.
    if (employee) {
      const dummyEmployee = DUMMY_EMPLOYEES.find(e => e.email === employee.email);
      if (dummyEmployee) {
        const timecardKey = dummyEmployee.id.split("-").pop() || "unknown";
        localStorage.setItem(`requiredSchedule_${timecardKey}`, JSON.stringify(requiredSchedule));
        if (profile.poInitials) {
          localStorage.setItem(`poInitials_${timecardKey}`, profile.poInitials);
        }
      }
    }

    // Persist the schedule + off-days to Supabase so the timecard and
    // attendance dashboards pick them up too. Only do this if the user has
    // permission (RLS will also reject otherwise).
    if (profileId && canEditSchedule) {
      try {
        await updateCompanyUser(profileId, {
          requiredCheckIn: requiredSchedule.requiredCheckIn,
          requiredCheckOut: requiredSchedule.requiredCheckOut,
          offDays: selectedOffDays,
          poInitials: profile.poInitials || "",
        });
      } catch (err) {
        console.warn("Schedule save (Supabase) failed:", err);
      }
    }

    setSaved("Profile saved.");
    setTimeout(() => setSaved(""), 2000);
  };

  const changePassword = async () => {
    if (!password.next || password.next.length < 6) {
      setSaved("New password must be at least 6 characters.");
      return;
    }
    if (password.next !== password.confirm) {
      setSaved("Passwords don't match.");
      return;
    }
    if (!password.current) {
      setSaved("Enter your current password to confirm.");
      return;
    }
    try {
      const [{ auth }, firebaseAuth] = await Promise.all([
        import("@/lib/firebase/config"),
        import("firebase/auth"),
      ]);
      const user = auth?.currentUser;
      if (!user || !user.email) {
        setSaved("Not signed in.");
        return;
      }
      // Re-authenticate with the current password before changing it; Firebase
      // requires this for security-sensitive operations on long-lived sessions.
      const credential = firebaseAuth.EmailAuthProvider.credential(
        user.email,
        password.current,
      );
      await firebaseAuth.reauthenticateWithCredential(user, credential);
      await firebaseAuth.updatePassword(user, password.next);
      setPassword({ current: "", next: "", confirm: "" });
      setSaved("Password updated.");
      setTimeout(() => setSaved(""), 3000);
    } catch (err: any) {
      const code = String(err?.code || "");
      if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
        setSaved("Current password is incorrect.");
      } else if (code === "auth/weak-password") {
        setSaved("New password is too weak.");
      } else if (code === "auth/requires-recent-login") {
        setSaved("Please sign out and back in, then try again.");
      } else {
        setSaved(err?.message || "Could not update password.");
      }
    }
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

  const locationField = () => (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">Office Location</span>
      <select
        value={profile.officeLocation}
        onChange={(e) => setProfile({ ...profile, officeLocation: e.target.value })}
        className="glass-input"
      >
        <option value="">Select a location</option>
        {locations.map((location) => (
          <option key={location} value={location}>
            {location}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <AccountPageShell title="My Profile" description="Manage your account details and password.">
      <section className="panel">
        <h2 className="text-lg font-semibold mb-4">Account details</h2>
        {employee && (
          <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <p className="text-xs text-blue-200">
              📋 Your profile is synced with employee data for {employee.name}. Department and role reflect your current assignment.
            </p>
          </div>
        )}
        <div className="grid sm:grid-cols-2 gap-4 mb-6">
          {field("First name", "firstName")}
          {field("Last name", "lastName")}
          {field("Email", "email", "email")}
          {field("Phone", "phone", "tel")}
          {field("Department", "department")}
          {field("Title", "title")}
          {locationField()}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">PO # Initial</span>
            <input
              className="glass-input"
              type="text"
              placeholder="Enter initials for purchase orders"
              value={profile.poInitials}
              onChange={(e) => setProfile({ ...profile, poInitials: e.target.value.toUpperCase() })}
              maxLength={5}
            />
          </label>
        </div>

        {/* Required Schedule */}
        <div className="pt-6 border-t border-white/10">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h3 className="text-sm font-semibold text-slate-300">Required Schedule</h3>
            {!canEditSchedule && (
              <span className="inline-flex items-center gap-1 text-[11px] text-amber-300/90">
                <Lock className="h-3 w-3" />
                Only HR, admins, and managers can change this
              </span>
            )}
          </div>
          <div className="grid sm:grid-cols-2 gap-4 mb-4">
            <label className="flex flex-col gap-2">
              <span className="text-xs text-slate-400">Check-In Time</span>
              <input
                type="time"
                value={requiredSchedule.requiredCheckIn}
                onChange={(e) => setRequiredSchedule({ ...requiredSchedule, requiredCheckIn: e.target.value })}
                disabled={!canEditSchedule}
                className="px-3 py-2 bg-slate-700 border border-white/20 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-xs text-slate-400">Check-Out Time</span>
              <input
                type="time"
                value={requiredSchedule.requiredCheckOut}
                onChange={(e) => setRequiredSchedule({ ...requiredSchedule, requiredCheckOut: e.target.value })}
                disabled={!canEditSchedule}
                className="px-3 py-2 bg-slate-700 border border-white/20 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
              />
            </label>
          </div>
        </div>

        {/* Days Off */}
        <div className="pt-6 border-t border-white/10">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h3 className="text-sm font-semibold text-slate-300">Days Off</h3>
            {!canEditSchedule && (
              <span className="inline-flex items-center gap-1 text-[11px] text-amber-300/90">
                <Lock className="h-3 w-3" />
                Only HR, admins, and managers can change this
              </span>
            )}
          </div>
          <div className="grid grid-cols-7 gap-2 mb-4">
            {currentWeekDays.map((day) => (
              <button
                key={day.dayNum}
                onClick={() => toggleOffDay(day.dayNum)}
                disabled={!canEditSchedule}
                className={`p-2 rounded border transition text-xs font-semibold flex flex-col items-center justify-center h-16 disabled:cursor-not-allowed disabled:opacity-70 ${
                  day.isOffDay
                    ? "bg-red-500/20 border-red-500/50 text-red-300"
                    : "bg-slate-700 border-white/10 text-slate-300 hover:border-white/30"
                }`}
              >
                <span className="text-xs truncate">{day.dayName.slice(0, 3)}</span>
                <span className="text-xs mt-1 opacity-75">{day.isOffDay ? "OFF" : "WORK"}</span>
              </button>
            ))}
          </div>
          {selectedOffDays.length > 0 && (
            <p className="text-xs text-blue-300">Selected: {selectedOffDays.map(d => DAYS_OF_WEEK[d]).join(", ")}</p>
          )}
        </div>

        <div className="flex items-center gap-2 mt-6 flex-wrap">
          <button className="btn btn-primary" onClick={save}><Save className="h-4 w-4" />Save changes</button>
          {saved && <span className="text-xs text-muted-foreground">{saved}</span>}
        </div>
      </section>

      {/* Time In/Out Details */}
      {timecardData.length > 0 && (
        <section className="panel mt-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Clock className="h-5 w-5 text-blue-400" />
            Time In/Out Details
          </h2>
          <p className="text-xs text-slate-400 mb-4">Your recent daily clock in/out records.</p>
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

      {/* Change Password - At Bottom */}
      <section className="panel mt-6">
        <h2 className="text-lg font-semibold mb-4">Change password</h2>
        <div className="grid gap-4 mb-4">
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
        <button className="btn btn-primary" onClick={changePassword}><Save className="h-4 w-4" />Update password</button>
      </section>
    </AccountPageShell>
  );
}
