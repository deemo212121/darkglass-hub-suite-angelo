import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AccountPageShell } from "@/components/AccountPageShell";
import { useAuth } from "@/lib/auth";
import { Save, Lock, Eye, EyeOff, Loader2 } from "lucide-react";
import { LOCATIONS } from "@/lib/locations";
import { ROLE_LABELS, normalizeRole } from "@/lib/roleLabels";
import { getMyFullProfile, updateCompanyUser, clearMyMustChangePassword } from "@/lib/supabase/users";
import { supabase } from "@/lib/supabase/client";

// Roles that are allowed to change a user's Required Schedule and Days Off.
const SCHEDULE_EDIT_ROLES = new Set([
  "SUPERADMIN",
  "ADMIN",
  "HR",
  "MANAGER",
  "SENIOR_MANAGER",
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
  phone: string;
  department: string;
  officeLocation: string;
  poInitials: string;
};

interface WeekDay {
  dayNum: number;
  dayName: string;
  isOffDay: boolean;
}

interface RequiredSchedule {
  requiredCheckIn: string;
  requiredCheckOut: string;
  workingHours: string;
  mealMinutes: string;
}

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function ProfilePage() {
  const { email, uid, role, mustChangePassword, clearMustChangePasswordFlag } = useAuth();
  const canEditSchedule = SCHEDULE_EDIT_ROLES.has(String(role || "").toUpperCase());
  const [profileId, setProfileId] = useState<string | null>(null);

  const [profile, setProfile] = useState<Profile>({
    firstName: "",
    lastName: "",
    phone: "",
    department: "",
    officeLocation: "",
    poInitials: "",
  });
  const [password, setPassword] = useState({ current: "", next: "", confirm: "" });
  const [showPassword, setShowPassword] = useState({ current: false, next: false, confirm: false });
  const [saved, setSaved] = useState<string>("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [currentWeekDays, setCurrentWeekDays] = useState<WeekDay[]>([]);
  const [selectedOffDays, setSelectedOffDays] = useState<number[]>([]);
  const [requiredSchedule, setRequiredSchedule] = useState<RequiredSchedule>({
    requiredCheckIn: "08:00",
    requiredCheckOut: "17:00",
    workingHours: "",
    mealMinutes: "",
  });
  // Working Hours / Meal Time is a one-time self-service edit for regular
  // employees (canEditSchedule roles can always change it) — once either
  // value has ever been set (by the employee themselves or by an admin),
  // it locks and further changes have to go through IT/Admin/HR.
  const [scheduleFieldsAlreadySet, setScheduleFieldsAlreadySet] = useState(false);
  const canEditWorkingHoursMeal = canEditSchedule || !scheduleFieldsAlreadySet;

  useEffect(() => {
    const week: WeekDay[] = [];
    for (let i = 0; i < 7; i++) {
      week.push({ dayNum: i, dayName: DAYS_OF_WEEK[i], isOffDay: selectedOffDays.includes(i) });
    }
    setCurrentWeekDays(week);
  }, [selectedOffDays]);

  const toggleOffDay = (dayNum: number) => {
    if (!canEditSchedule) return;
    setSelectedOffDays((prev) => (prev.includes(dayNum) ? prev.filter((d) => d !== dayNum) : [...prev, dayNum]));
  };

  // Load the caller's real Supabase profile — account fields, schedule, and
  // role all come from the same row, so this is the single source of truth
  // for everything on this page (see getMyFullProfile in lib/supabase/users.ts).
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      try {
        const p = await getMyFullProfile(uid);
        if (cancelled || !p) return;
        setProfileId(p.profileId);
        const [firstName, ...rest] = p.displayName.trim().split(/\s+/);
        setProfile({
          firstName: p.displayName ? firstName : "",
          lastName: rest.join(" "),
          phone: p.phoneNumber,
          department: p.department,
          officeLocation: p.assignedBranch,
          poInitials: p.poInitials,
        });
        setRequiredSchedule({
          requiredCheckIn: p.requiredCheckIn || "08:00",
          requiredCheckOut: p.requiredCheckOut || "17:00",
          workingHours: p.workingHours != null ? String(p.workingHours) : "",
          mealMinutes: p.mealMinutes != null ? String(p.mealMinutes) : "",
        });
        setScheduleFieldsAlreadySet(p.workingHours != null || p.mealMinutes != null);
        // Pull off_days separately — getMyFullProfile doesn't return it.
        const { data } = await supabase.from("profiles").select("off_days").eq("firebase_uid", uid).maybeSingle();
        if (!cancelled && Array.isArray((data as any)?.off_days)) {
          setSelectedOffDays((data as any).off_days as number[]);
        }
      } catch (err) {
        console.error("Failed to load profile:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const save = async () => {
    if (!profileId) {
      setSaved("Could not resolve your profile. Please re-login.");
      return;
    }
    setSaving(true);
    try {
      await updateCompanyUser(profileId, {
        displayName: [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim(),
        phoneNumber: profile.phone,
        department: profile.department,
        assignedBranch: profile.officeLocation,
        poInitials: profile.poInitials,
        ...(canEditSchedule
          ? {
              requiredCheckIn: requiredSchedule.requiredCheckIn,
              requiredCheckOut: requiredSchedule.requiredCheckOut,
              offDays: selectedOffDays,
            }
          : {}),
      });
      setSaved("Profile saved.");
    } catch (err) {
      setSaved(`Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaved(""), 2500);
    }
  };

  // Separate from save() and always reachable (even while mustChangePassword
  // hides the rest of Account Details) — a brand-new employee whose password
  // was just admin-reset is exactly who most needs to set this on day one,
  // so it can't wait behind the password-change gate.
  const saveWorkingHoursMeal = async () => {
    if (!canEditWorkingHoursMeal) return;
    if (!profileId) {
      setSaved("Could not resolve your profile. Please re-login.");
      return;
    }
    // Regular employees only get ONE shot at setting this themselves — make
    // sure they know that before it locks, since there's no undo after.
    if (!canEditSchedule && (requiredSchedule.workingHours.trim() || requiredSchedule.mealMinutes.trim())) {
      const proceed = confirm(
        "You can only set Working Hours / Meal Time once. After saving, you'll need to request any changes through HR, IT, or Admin. Continue?"
      );
      if (!proceed) return;
    }
    setSaving(true);
    try {
      await updateCompanyUser(profileId, {
        workingHours: requiredSchedule.workingHours.trim() ? Number(requiredSchedule.workingHours) : null,
        mealMinutes: requiredSchedule.mealMinutes.trim() ? Number(requiredSchedule.mealMinutes) : null,
      });
      // A regular employee just used their one-time edit — lock it from here on.
      if (!canEditSchedule) setScheduleFieldsAlreadySet(true);
      setSaved("Working Hours / Meal Time saved.");
    } catch (err) {
      setSaved(`Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaved(""), 2500);
    }
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
    setChangingPassword(true);
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
      // Clear an admin-triggered "must change password" flag, if set (see
      // migration 0103) — both server-side and in-memory, so the /profile
      // redirect gate in __root.tsx stops immediately.
      if (uid) {
        clearMustChangePasswordFlag();
        clearMyMustChangePassword(uid).catch((err) => console.error("Failed to clear must_change_password flag:", err));
      }
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
    } finally {
      setChangingPassword(false);
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

  return (
    <AccountPageShell title="My Profile" description="Manage your account details and password.">
      {mustChangePassword && (
        <div className="panel border-amber-500/40 bg-amber-500/10">
          <p className="text-sm font-semibold text-amber-200">🔒 You need to change your password to continue.</p>
          <p className="mt-1 text-xs text-amber-200/80">
            An admin reset your account for security. You can keep using your current password to log in, but you must set a new one below before you can reach the rest of the dashboards.
          </p>
        </div>
      )}
      <section className="panel">
        <h2 className="text-lg font-semibold mb-2">Working Hours &amp; Meal Time</h2>
        <p className="text-xs text-muted-foreground mb-4">
          If you haven't set your Working Hours and Meal Time yet, please set them now — you only get one chance to
          set these yourself. Once set, any changes need to be raised with IT or HR.
        </p>
        {!canEditSchedule && scheduleFieldsAlreadySet && (
          <p className="mb-4 inline-flex items-center gap-1 text-[11px] text-amber-300/90">
            <Lock className="h-3 w-3 shrink-0" />
            Already set — contact IT, admins, or HR to change it.
          </p>
        )}
        <div className="grid sm:grid-cols-2 gap-4 mb-4">
          <label className="flex flex-col gap-2">
            <span className="text-xs text-slate-400">Working Hours</span>
            <input
              type="number"
              min={0}
              step={0.5}
              placeholder="e.g. 7.5"
              value={requiredSchedule.workingHours}
              onChange={(e) => setRequiredSchedule({ ...requiredSchedule, workingHours: e.target.value })}
              disabled={!canEditWorkingHoursMeal}
              className="px-3 py-2 bg-slate-700 border border-white/20 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-xs text-slate-400">Meal Time (minutes)</span>
            <input
              type="number"
              min={0}
              step={5}
              placeholder="e.g. 30"
              value={requiredSchedule.mealMinutes}
              onChange={(e) => setRequiredSchedule({ ...requiredSchedule, mealMinutes: e.target.value })}
              disabled={!canEditWorkingHoursMeal}
              className="px-3 py-2 bg-slate-700 border border-white/20 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
            />
          </label>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn btn-primary" onClick={saveWorkingHoursMeal} disabled={saving || !canEditWorkingHoursMeal}>
            <Save className="h-4 w-4" />
            {saving ? "Saving…" : "Save"}
          </button>
          {saved && <span className="text-xs text-muted-foreground">{saved}</span>}
        </div>
      </section>

      {!mustChangePassword && (
      <section className="panel">
        <h2 className="text-lg font-semibold mb-4">Account details</h2>
        <div className="grid sm:grid-cols-2 gap-4 mb-6">
          {field("First name", "firstName")}
          {field("Last name", "lastName")}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Email</span>
            <input className="glass-input opacity-70" type="email" value={email ?? ""} disabled title="Contact an admin to change your login email" />
          </label>
          {field("Phone", "phone", "tel")}
          {field("Department", "department")}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Role</span>
            <input className="glass-input opacity-70" type="text" value={ROLE_LABELS[normalizeRole(role)] || role || ""} disabled />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Office Location</span>
            <select
              value={profile.officeLocation}
              onChange={(e) => setProfile({ ...profile, officeLocation: e.target.value })}
              className="glass-input"
            >
              <option value="">Select a location</option>
              {LOCATIONS.map((location) => (
                <option key={location} value={location}>
                  {location}
                </option>
              ))}
            </select>
          </label>
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
                Check-In/Out Time: only HR, admins, and managers can change this
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
            <p className="text-xs text-blue-300">Selected: {selectedOffDays.map((d) => DAYS_OF_WEEK[d]).join(", ")}</p>
          )}
        </div>

        <div className="flex items-center gap-2 mt-6 flex-wrap">
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            <Save className="h-4 w-4" />
            {saving ? "Saving…" : "Save changes"}
          </button>
          {saved && <span className="text-xs text-muted-foreground">{saved}</span>}
        </div>
      </section>
      )}

      {/* Change Password - At Bottom */}
      <section className="panel mt-6">
        <h2 className="text-lg font-semibold mb-4">Change password</h2>
        <div className="grid gap-4 mb-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Current password</span>
            <div className="relative">
              <input
                className="glass-input w-full pr-10"
                type={showPassword.current ? "text" : "password"}
                value={password.current}
                onChange={(e) => setPassword({ ...password, current: e.target.value })}
              />
              <button
                type="button"
                onClick={() => setShowPassword({ ...showPassword, current: !showPassword.current })}
                tabIndex={-1}
                title={showPassword.current ? "Hide password" : "Show password"}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword.current ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">New password</span>
            <div className="relative">
              <input
                className="glass-input w-full pr-10"
                type={showPassword.next ? "text" : "password"}
                value={password.next}
                onChange={(e) => setPassword({ ...password, next: e.target.value })}
              />
              <button
                type="button"
                onClick={() => setShowPassword({ ...showPassword, next: !showPassword.next })}
                tabIndex={-1}
                title={showPassword.next ? "Hide password" : "Show password"}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword.next ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Confirm new password</span>
            <div className="relative">
              <input
                className="glass-input w-full pr-10"
                type={showPassword.confirm ? "text" : "password"}
                value={password.confirm}
                onChange={(e) => setPassword({ ...password, confirm: e.target.value })}
              />
              <button
                type="button"
                onClick={() => setShowPassword({ ...showPassword, confirm: !showPassword.confirm })}
                tabIndex={-1}
                title={showPassword.confirm ? "Hide password" : "Show password"}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword.confirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>
        </div>
        <button className="btn btn-primary disabled:opacity-50" onClick={changePassword} disabled={changingPassword}>
          {changingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {changingPassword ? "Updating…" : "Update password"}
        </button>
      </section>
    </AccountPageShell>
  );
}
