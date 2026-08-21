import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { ROLE_LABELS, normalizeRole, isAttendanceManagerTierRole, isAttendanceFullAccessRole } from "@/lib/roleLabels";
import { getCompanyUsers, updateCompanyUser, type ProfileRow } from "@/lib/supabase/users";

/** Readable role text — same fallback rule AdminUserManagementPage.tsx's roleDisplay uses. */
function roleDisplay(role: string | null | undefined): string {
  if (!role) return "";
  return ROLE_LABELS[normalizeRole(role)] || role;
}

/**
 * Required Check-In/Check-Out editor for a department roster, scoped by
 * `filterProfile` (e.g. Technical Support on TriageDashboardPage.tsx, CSR
 * Associates/Team Leaders on CSRDashboard.tsx). Writes straight to
 * profiles.required_check_in/required_check_out (+ schedule_timezone) via
 * updateCompanyUser — the SAME columns HR's Master List "Hours of Work"
 * column edits (ReportHRDaily.tsx) and the SAME columns the employee's own
 * My Profile "Required Schedule" section reads (EmployeeSelfServicePage.tsx).
 * There's no separate sync step: it's one shared field, so a change made
 * here shows up in both places immediately.
 *
 * Editing is restricted to manager-tier+ roles (same gate Attendance
 * Monitoring uses) — a rank-and-file employee can still open this panel and
 * see everyone's hours (useful to know your own required schedule) but the
 * inputs render as read-only text for them instead of live time pickers.
 */
export function WorkHoursPanel({
  filterProfile,
  emptyMessage = "No active employees found.",
}: {
  filterProfile: (p: ProfileRow) => boolean;
  emptyMessage?: string;
}) {
  const { role, extraRoles } = useAuth();
  const canEdit = isAttendanceManagerTierRole(role, extraRoles) || isAttendanceFullAccessRole(role, extraRoles);

  const [employees, setEmployees] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await getCompanyUsers();
      setEmployees(
        rows
          .filter((u) => filterProfile(u) && u.is_active !== false)
          .sort((a, b) => (a.display_name || "").localeCompare(b.display_name || ""))
      );
    } catch (e) {
      console.error("Work hours: load failed", e);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveCheckIn = async (id: string, value: string) => {
    const prev = employees.find((e) => e.id === id)?.required_check_in ?? null;
    setEmployees((list) => list.map((e) => (e.id === id ? { ...e, required_check_in: value } : e)));
    setSavingId(id);
    try {
      await updateCompanyUser(id, { requiredCheckIn: value });
    } catch (err) {
      console.error("Failed to save required check-in:", err);
      setEmployees((list) => list.map((e) => (e.id === id ? { ...e, required_check_in: prev } : e)));
      alert(`Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingId(null);
    }
  };

  const saveCheckOut = async (id: string, value: string) => {
    const prev = employees.find((e) => e.id === id)?.required_check_out ?? null;
    setEmployees((list) => list.map((e) => (e.id === id ? { ...e, required_check_out: value } : e)));
    setSavingId(id);
    try {
      await updateCompanyUser(id, { requiredCheckOut: value });
    } catch (err) {
      console.error("Failed to save required check-out:", err);
      setEmployees((list) => list.map((e) => (e.id === id ? { ...e, required_check_out: prev } : e)));
      alert(`Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingId(null);
    }
  };

  const saveTimezone = async (id: string, value: "CST" | "EST") => {
    const prev = employees.find((e) => e.id === id)?.schedule_timezone ?? null;
    setEmployees((list) => list.map((e) => (e.id === id ? { ...e, schedule_timezone: value } : e)));
    setSavingId(id);
    try {
      await updateCompanyUser(id, { scheduleTimezone: value });
    } catch (err) {
      console.error("Failed to save schedule timezone:", err);
      setEmployees((list) => list.map((e) => (e.id === id ? { ...e, schedule_timezone: prev } : e)));
      alert(`Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="rounded-xl border border-white/15 bg-white/8 backdrop-blur-md">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div>
          <p className="font-semibold text-white text-sm">Required Work Hours</p>
          <p className="text-xs text-slate-400">
            {canEdit
              ? "Set each employee's Required Check-In/Check-Out — syncs live with HR's Master List and the employee's own My Profile page."
              : "Read-only — same required hours shown on HR's Master List and My Profile."}
          </p>
        </div>
        <p className="text-xs text-slate-400 whitespace-nowrap">{employees.length} employee{employees.length === 1 ? "" : "s"}</p>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
      ) : employees.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-8">{emptyMessage}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-900/60 text-blue-200">
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Role</th>
                <th className="px-3 py-2 text-left">Branch</th>
                <th className="px-3 py-2 text-left">Required Check-In</th>
                <th className="px-3 py-2 text-left">Required Check-Out</th>
                <th className="px-3 py-2 text-left">Timezone</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10 text-slate-200">
              {employees.map((emp) => (
                <tr key={emp.id} className={savingId === emp.id ? "opacity-60" : ""}>
                  <td className="px-3 py-2 font-medium text-white whitespace-nowrap">{emp.display_name || emp.email}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-300">{roleDisplay(emp.role)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-300">{emp.assigned_branch || "—"}</td>
                  <td className="px-3 py-2">
                    {canEdit ? (
                      <input
                        type="time"
                        defaultValue={emp.required_check_in?.slice(0, 5) || ""}
                        onBlur={(e) => {
                          const v = e.target.value;
                          if (v && v !== emp.required_check_in?.slice(0, 5)) void saveCheckIn(emp.id, v);
                        }}
                        className="glass-input text-xs py-1 px-2 rounded-md w-[100px]"
                      />
                    ) : (
                      <span className="text-slate-300">{emp.required_check_in?.slice(0, 5) || "—"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {canEdit ? (
                      <input
                        type="time"
                        defaultValue={emp.required_check_out?.slice(0, 5) || ""}
                        onBlur={(e) => {
                          const v = e.target.value;
                          if (v && v !== emp.required_check_out?.slice(0, 5)) void saveCheckOut(emp.id, v);
                        }}
                        className="glass-input text-xs py-1 px-2 rounded-md w-[100px]"
                      />
                    ) : (
                      <span className="text-slate-300">{emp.required_check_out?.slice(0, 5) || "—"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {canEdit ? (
                      <select
                        value={emp.schedule_timezone || "CST"}
                        onChange={(e) => void saveTimezone(emp.id, e.target.value as "CST" | "EST")}
                        className="glass-input text-xs py-1 px-2 rounded-md w-[70px]"
                      >
                        <option value="CST">CST</option>
                        <option value="EST">EST</option>
                      </select>
                    ) : (
                      <span className="text-slate-300">{emp.schedule_timezone || "CST"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
