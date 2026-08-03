import { useEffect, useState } from "react";
import { X, ChevronDown, ChevronRight } from "lucide-react";
import { ROLE_DEPARTMENT_BREAKDOWN, normalizeRole } from "@/lib/roleLabels";
import { getCompanyUsers, updateCompanyUser, type ProfileRow } from "@/lib/supabase/users";
import {
  getBranchRoleSchedules,
  upsertBranchRoleSchedule,
  type BranchRoleScheduleRow,
} from "@/lib/supabase/branchSchedules";
import { logModuleActivity } from "@/lib/supabase/moduleActivityLog";

interface Props {
  branches: string[];
  onClose: () => void;
  /** Called after a template is applied, so the caller can refresh its own user list (schedules just changed). */
  onApplied?: () => void;
  changedByName?: string;
}

/** Every role code grouped by department, e.g. "CSR" -> [{code:"CSR_MANAGER", label:"Manager"}, ...] — same breakdown AccountingDashboard/PayrollCalculationPage use for the Department/Role columns. */
function buildDepartmentGroups(): Array<{ department: string; roles: Array<{ code: string; label: string }> }> {
  const byDept = new Map<string, Array<{ code: string; label: string }>>();
  for (const [code, { department, roleLabel }] of Object.entries(ROLE_DEPARTMENT_BREAKDOWN)) {
    if (!byDept.has(department)) byDept.set(department, []);
    byDept.get(department)!.push({ code, label: roleLabel });
  }
  return Array.from(byDept.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([department, roles]) => ({ department, roles }));
}

const DEPARTMENT_GROUPS = buildDepartmentGroups();

export function ManageWorkingHoursModal({ branches, onClose, onApplied, changedByName }: Props) {
  const [selectedBranches, setSelectedBranches] = useState<Set<string>>(new Set());
  const [branchFilter, setBranchFilter] = useState("");
  const [expandedDept, setExpandedDept] = useState<string | null>(null);
  const [schedules, setSchedules] = useState<BranchRoleScheduleRow[]>([]);
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Per-role editable form state, keyed by role code — only populated for roles the admin has actually opened.
  const [roleForms, setRoleForms] = useState<
    Record<string, { checkIn: string; checkOut: string; selected: Set<string> }>
  >({});
  const [savingRole, setSavingRole] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [scheduleRows, profileRows] = await Promise.all([getBranchRoleSchedules(), getCompanyUsers()]);
      setSchedules(scheduleRows);
      setUsers(profileRows);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  // Reset per-role form state whenever the branch selection changes — the
  // previous selection's edits/checkbox picks shouldn't leak into the new one.
  useEffect(() => {
    setRoleForms({});
    setExpandedDept(null);
  }, [selectedBranches]);

  const toggleBranch = (branch: string) => {
    setSelectedBranches((prev) => {
      const next = new Set(prev);
      if (next.has(branch)) next.delete(branch);
      else next.add(branch);
      return next;
    });
  };

  const allBranchesSelected = branches.length > 0 && selectedBranches.size === branches.length;
  const toggleAllBranches = () => {
    setSelectedBranches(allBranchesSelected ? new Set() : new Set(branches));
  };

  const employeesFor = (roleCode: string) =>
    users.filter((u) => u.assigned_branch && selectedBranches.has(u.assigned_branch) && normalizeRole(u.role) === roleCode);

  // Multiple branches can already have different saved hours for this role —
  // prefill from whichever selected branch has a template first, just as a
  // starting point; Save always writes the one form value to every selected branch.
  const existingScheduleFor = (roleCode: string) =>
    schedules.find((s) => selectedBranches.has(s.branch) && s.role === roleCode);

  const ensureRoleForm = (roleCode: string) => {
    if (roleForms[roleCode]) return;
    const existing = existingScheduleFor(roleCode);
    const employees = employeesFor(roleCode);
    setRoleForms((prev) => ({
      ...prev,
      [roleCode]: {
        checkIn: existing?.requiredCheckIn ?? "08:00",
        checkOut: existing?.requiredCheckOut ?? "17:00",
        selected: new Set(employees.map((e) => e.id)), // default: everyone currently in these branches+role
      },
    }));
  };

  const toggleEmployee = (roleCode: string, employeeId: string) => {
    setRoleForms((prev) => {
      const form = prev[roleCode];
      if (!form) return prev;
      const nextSelected = new Set(form.selected);
      if (nextSelected.has(employeeId)) nextSelected.delete(employeeId);
      else nextSelected.add(employeeId);
      return { ...prev, [roleCode]: { ...form, selected: nextSelected } };
    });
  };

  const handleSave = async (roleCode: string, roleLabel: string, department: string) => {
    const form = roleForms[roleCode];
    if (!form) return;
    if (!form.checkIn || !form.checkOut) {
      alert("Please set both a Check-In Time and Check-Out Time.");
      return;
    }
    const branchList = Array.from(selectedBranches);
    if (branchList.length === 0) {
      alert("Select at least one branch first.");
      return;
    }
    setSavingRole(roleCode);
    try {
      await Promise.all(
        branchList.map((branch) =>
          upsertBranchRoleSchedule({
            branch,
            role: roleCode,
            requiredCheckIn: form.checkIn,
            requiredCheckOut: form.checkOut,
          })
        )
      );
      const targetIds = Array.from(form.selected);
      await Promise.all(
        targetIds.map((id) =>
          updateCompanyUser(id, { requiredCheckIn: form.checkIn, requiredCheckOut: form.checkOut })
        )
      );
      await load();
      void logModuleActivity({
        module: "user-management",
        actorName: changedByName || "Admin",
        action: "working_hours_template_saved",
        targetType: "branch_role_schedule",
        targetLabel: `${branchList.join(", ")} · ${department} (${roleLabel})`,
        details: { branches: branchList, role: roleCode, employeesUpdated: targetIds.length },
      });
      onApplied?.();
    } catch (err) {
      alert(`Failed to save working hours: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingRole(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-slate-900 border border-white/15 rounded-xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-slate-950 rounded-t-xl">
          <div>
            <p className="font-semibold text-white">Manage Working Hours per Branch</p>
            <p className="text-xs text-slate-400">Set a Required Schedule once per branch + role — applies to everyone selected below.</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 transition">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-white/10">
          <label className="block text-[10px] text-slate-400 uppercase mb-1">
            Branches ({selectedBranches.size}/{branches.length} selected)
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold text-white py-1 border-b border-white/10 mb-1.5">
            <input
              type="checkbox"
              checked={allBranchesSelected}
              onChange={toggleAllBranches}
              className="h-3.5 w-3.5 accent-blue-600 cursor-pointer"
            />
            All Branches
          </label>
          <input
            type="text"
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            placeholder="Filter branches…"
            className="w-full max-w-xs bg-slate-800 border border-white/10 rounded px-2 py-1 text-xs text-white mb-1.5 focus:outline-none focus:border-blue-500"
          />
          <div className="max-h-28 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1">
            {branches.filter((b) => b.toLowerCase().includes(branchFilter.trim().toLowerCase())).map((b) => (
              <label key={b} className="flex items-center gap-2 text-xs text-slate-300 py-0.5">
                <input
                  type="checkbox"
                  checked={selectedBranches.has(b)}
                  onChange={() => toggleBranch(b)}
                  className="h-3.5 w-3.5 accent-blue-600 cursor-pointer"
                />
                {b}
              </label>
            ))}
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-3">
          {loading ? (
            <p className="text-xs text-slate-400 text-center py-4">Loading…</p>
          ) : selectedBranches.size === 0 ? (
            <p className="text-xs text-slate-500 text-center py-4">Select one or more branches above to manage their working hours.</p>
          ) : (
            DEPARTMENT_GROUPS.map(({ department, roles }) => (
              <div key={department} className="bg-slate-800/30 border border-white/10 rounded-lg">
                <button
                  type="button"
                  onClick={() => setExpandedDept((d) => (d === department ? null : department))}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-white"
                >
                  <span>{department}</span>
                  {expandedDept === department ? (
                    <ChevronDown className="h-4 w-4 text-slate-400" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  )}
                </button>
                {expandedDept === department && (
                  <div className="px-4 pb-4 space-y-4">
                    {roles.map(({ code, label }) => {
                      ensureRoleForm(code);
                      const form = roleForms[code];
                      const employees = employeesFor(code);
                      if (!form) return null;
                      return (
                        <div key={code} className="bg-slate-900/60 border border-white/10 rounded-lg p-3">
                          <p className="text-xs font-semibold text-blue-300 mb-2">{label}</p>
                          <div className="grid gap-2 md:grid-cols-3 items-end mb-3">
                            <div>
                              <label className="block text-[10px] text-slate-400 uppercase mb-1">Check-In Time</label>
                              <input
                                type="time"
                                value={form.checkIn}
                                onChange={(e) =>
                                  setRoleForms((prev) => ({ ...prev, [code]: { ...prev[code], checkIn: e.target.value } }))
                                }
                                className="w-full bg-slate-800 border border-white/10 rounded px-2 py-1 text-sm text-white"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] text-slate-400 uppercase mb-1">Check-Out Time</label>
                              <input
                                type="time"
                                value={form.checkOut}
                                onChange={(e) =>
                                  setRoleForms((prev) => ({ ...prev, [code]: { ...prev[code], checkOut: e.target.value } }))
                                }
                                className="w-full bg-slate-800 border border-white/10 rounded px-2 py-1 text-sm text-white"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => handleSave(code, label, department)}
                              disabled={savingRole === code}
                              className="px-3 py-1.5 rounded bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-semibold"
                            >
                              {savingRole === code ? "Saving…" : "Save & Apply"}
                            </button>
                          </div>
                          {employees.length === 0 ? (
                            <p className="text-[11px] text-slate-500">No employees currently in these branches + role — the schedule will still be saved as a template for future hires.</p>
                          ) : (
                            <div className="space-y-1">
                              <p className="text-[10px] text-slate-500 uppercase">Apply to ({form.selected.size}/{employees.length} selected)</p>
                              {employees.map((emp) => (
                                <label key={emp.id} className="flex items-center gap-2 text-xs text-slate-300 py-0.5">
                                  <input
                                    type="checkbox"
                                    checked={form.selected.has(emp.id)}
                                    onChange={() => toggleEmployee(code, emp.id)}
                                    className="h-3.5 w-3.5 accent-blue-600 cursor-pointer"
                                  />
                                  {emp.display_name || emp.email}
                                  {selectedBranches.size > 1 && (
                                    <span className="text-slate-500">— {emp.assigned_branch}</span>
                                  )}
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
