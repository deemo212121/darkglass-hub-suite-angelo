import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { auth as firebaseAuth } from "@/lib/firebase/config";
import {
  getStaffListTierLevel,
  type StaffListTierLevelRow,
} from "@/lib/supabase/staffList";
import { getLeadersRoster } from "@/lib/supabase/leadersRoster";
import {
  getCompanyUsers,
  getEmployeeInfoByProfileIds,
  getProfileEmployeeInfo,
  saveProfileEmployeeInfo,
  updateCompanyUser,
} from "@/lib/supabase/users";
import { ROLE_LABELS, normalizeRole } from "@/lib/roleLabels";

/** Fixed options for the Tier Level dropdown — the exact tag set from the original Excel column, not free text. */
const TIER_LEVEL_OPTIONS = ["Senior Branch Manager", "Branch Manager", "Technical Manager", "Tier 1", "Tier 2", "Tier 3", "Training"];

/**
 * Staff List only covers the field-branch-facing roles the original
 * "Title" column tagged (Branch Manager, Parts, Technician, Claims, CSR)
 * — HR/IT/Accounting/BizOps/etc. show up on Master List but not here.
 * Checked against BOTH the primary role and every extra_role (the user's
 * "primary secondary etc idc" — either slot counts).
 */
const STAFF_LIST_ROLE_CODES = new Set([
  "BRANCH_MANAGER", "SENIOR_BRANCH_MANAGER",
  "PARTS", "PARTS_MANAGER", "PARTS_TEAM_LEADER",
  "TECHNICIAN", "TECHNICIAN_MANAGER", "TECHNICAL_DIRECTOR", "TECHNICAL_ASSISTANT_DIRECTOR",
  "CLAIMS", "CLAIMS_MANAGER", "CLAIMS_TEAM_LEADER",
  "CSR", "CSR_AGENT", "CSR_TEAM_LEADER", "CSR_MANAGER",
]);
function isStaffListRole(role: string, extraRoles: string[]): boolean {
  if (STAFF_LIST_ROLE_CODES.has(normalizeRole(role))) return true;
  return extraRoles.some((r) => STAFF_LIST_ROLE_CODES.has(normalizeRole(r)));
}

/** Same hierarchy shape as Master List's Current Technicians tab (Technical Director > Assistant > Senior/Branch Manager > Team Leader > base) — used to sort each branch's roster so the manager reads at the top instead of A-Z. */
function positionRank(role: string): number {
  const code = normalizeRole(role);
  if (code === "TECHNICAL_DIRECTOR") return 6;
  if (code === "TECHNICAL_ASSISTANT_DIRECTOR") return 5;
  if (code === "SENIOR_BRANCH_MANAGER" || code === "SENIOR_MANAGER") return 4;
  if (code === "BRANCH_MANAGER" || code.includes("MANAGER")) return 3;
  if (code.includes("TEAM_LEADER")) return 2;
  return 1;
}

interface BranchEmployee {
  id: string;
  name: string;
  branch: string;
  role: string;
  position: string;
  startDate: string;
  companyEmail: string;
  personalEmail: string;
  phone: string;
  workPhone: string;
  tierLevel: string;
  note: string;
}

/**
 * Dashboard "Staff List" submodule — Current Staff and Tier Level are
 * their own small reference tables (migration 0161); the per-branch
 * PERSON roster below is a LIVE view of the same Master List/profiles
 * data (see migration 0162's header comment for why) — grouped by
 * assigned_branch, so a new hire added in User Management shows up here
 * automatically with no separate import step. personal_email, work_phone,
 * tier_level, and note are editable straight from here and write to the
 * exact profiles row Master List reads.
 */
export function StaffListPage({ mod: _mod, sub: _sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const { role: viewerRole } = useAuth();
  // Company Email is the real Firebase Auth login credential, not just
  // contact info — changing it has to go through /api/admin-update-email
  // (see adminUpdateEmailBridge.ts) rather than a plain Supabase field
  // edit, and only Admin/SuperAdmin are trusted with that, same
  // restriction as the User Management detail page.
  const canEditEmail = normalizeRole(viewerRole) === "ADMIN" || normalizeRole(viewerRole) === "SUPERADMIN";
  const [employees, setEmployees] = useState<BranchEmployee[]>([]);
  const [tierLevel, setTierLevel] = useState<StaffListTierLevelRow[]>([]);
  // Senior Branch Managers oversee several branches at once, but a
  // profile only has ONE assigned_branch (their own home branch) — so
  // matching purely on assigned_branch would only ever surface them
  // under that one branch. This is the Leaders tab's Technician
  // hierarchy (migration 0154/0156/0157/0158): branchManagerName ->
  // whichever Senior Branch Manager they report to, which correctly
  // covers every branch a senior manager actually oversees.
  const [seniorManagerByBranchManager, setSeniorManagerByBranchManager] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [activeBranch, setActiveBranch] = useState<string>("__current_staff__");
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [profiles, t, leaders] = await Promise.all([getCompanyUsers(), getStaffListTierLevel(), getLeadersRoster()]);
      const infoByProfileId = await getEmployeeInfoByProfileIds(profiles.map((p) => p.id));
      const reportsToMap = new Map<string, string>();
      for (const row of leaders) {
        if (row.department === "Technician" && row.reportsTo) reportsToMap.set(row.personName, row.reportsTo);
      }
      setSeniorManagerByBranchManager(reportsToMap);
      const mapped: BranchEmployee[] = profiles
        .filter((p) => p.is_active && (p.assigned_branch || "").trim() && isStaffListRole(p.role, p.extra_roles ?? []))
        .map((p) => {
          const info = infoByProfileId.get(p.id) || {};
          return {
            id: p.id,
            name: p.display_name || p.email,
            branch: (p.assigned_branch || "").trim(),
            role: p.role,
            position: ROLE_LABELS[normalizeRole(p.role)] ?? p.role,
            startDate: info.hireDate || p.created_at?.slice(0, 10) || "",
            companyEmail: p.email || "",
            personalEmail: (p as any).personal_email || "",
            phone: p.phone_number || "",
            workPhone: (p as any).work_phone || "",
            tierLevel: (p as any).tier_level || "",
            note: (p as any).staff_note || "",
          };
        });
      setEmployees(mapped);
      setTierLevel(t);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  // Current Staff (branch-manager summary) is derived live from the same
  // branch roster above instead of a separately imported table — a
  // branch's Senior Branch Manager/Branch Manager/Technical Manager/Part
  // Manager is just whoever at that branch holds that role right now, so
  // this can never drift the way a frozen Excel snapshot would.
  const branches = useMemo(() => {
    const set = new Set<string>();
    for (const e of employees) set.add(e.branch);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [employees]);

  const currentStaff = useMemo(() => {
    const byRole = (branch: string, ...codes: string[]) =>
      employees.find((e) => e.branch === branch && codes.includes(normalizeRole(e.role)))?.name || null;
    return branches.map((branch) => {
      const branchManager = byRole(branch, "BRANCH_MANAGER");
      // Prefer the Leaders-hierarchy lookup (covers every branch a senior
      // manager actually oversees) — only fall back to a same-branch
      // Senior Branch Manager profile if this branch's manager isn't in
      // that hierarchy yet.
      const seniorBranchManager =
        (branchManager && seniorManagerByBranchManager.get(branchManager)) ||
        byRole(branch, "SENIOR_BRANCH_MANAGER", "SENIOR_MANAGER");
      return {
        branch,
        seniorBranchManager,
        branchManager,
        technicalManager: byRole(branch, "TECHNICIAN_MANAGER"),
        partManager: byRole(branch, "PARTS_MANAGER"),
      };
    });
  }, [employees, branches, seniorManagerByBranchManager]);

  const branchRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = employees.filter((e) => e.branch === activeBranch);
    const filtered = q
      ? rows.filter((e) => e.name.toLowerCase().includes(q) || e.position.toLowerCase().includes(q) || e.tierLevel.toLowerCase().includes(q))
      : rows;
    return [...filtered].sort((a, b) => positionRank(b.role) - positionRank(a.role) || a.name.localeCompare(b.name));
  }, [employees, activeBranch, search]);

  const handleUpdateProfileField = async (id: string, field: "personalEmail" | "workPhone" | "tierLevel" | "note", value: string) => {
    const prev = employees.find((e) => e.id === id);
    if (!prev) return;
    const prevValue = prev[field];
    setEmployees((p) => p.map((e) => (e.id === id ? { ...e, [field]: value } : e)));
    try {
      const apiField = field === "note" ? "staffNote" : field;
      await updateCompanyUser(id, { [apiField]: value || null } as any);
    } catch (err) {
      console.error("Failed to save Staff List field:", err);
      setEmployees((p) => p.map((e) => (e.id === id ? { ...e, [field]: prevValue } : e)));
    }
  };

  const handleUpdatePhone = async (id: string, value: string) => {
    const prev = employees.find((e) => e.id === id);
    if (!prev) return;
    const prevValue = prev.phone;
    setEmployees((p) => p.map((e) => (e.id === id ? { ...e, phone: value } : e)));
    try {
      await updateCompanyUser(id, { phoneNumber: value });
    } catch (err) {
      console.error("Failed to save phone:", err);
      setEmployees((p) => p.map((e) => (e.id === id ? { ...e, phone: prevValue } : e)));
    }
  };

  const handleUpdateCompanyEmail = async (id: string, value: string) => {
    const prev = employees.find((e) => e.id === id);
    if (!prev || !value || value === prev.companyEmail) return;
    const prevValue = prev.companyEmail;
    setEmployees((p) => p.map((e) => (e.id === id ? { ...e, companyEmail: value } : e)));
    try {
      const idToken = await firebaseAuth?.currentUser?.getIdToken();
      if (!idToken) throw new Error("Could not verify your session. Please re-login and try again.");
      const res = await fetch("/api/admin-update-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, targetProfileId: id, newEmail: value }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to update login email");
      await updateCompanyUser(id, { email: value });
    } catch (err) {
      alert(`Failed to update company email: ${err instanceof Error ? err.message : "Unknown error"}`);
      setEmployees((p) => p.map((e) => (e.id === id ? { ...e, companyEmail: prevValue } : e)));
    }
  };

  const handleUpdateStartDate = async (id: string, value: string) => {
    const prev = employees.find((e) => e.id === id);
    if (!prev) return;
    const prevValue = prev.startDate;
    setEmployees((p) => p.map((e) => (e.id === id ? { ...e, startDate: value } : e)));
    try {
      const info = (await getProfileEmployeeInfo(id)) || {};
      await saveProfileEmployeeInfo(id, { ...info, hireDate: value });
    } catch (err) {
      console.error("Failed to save start date:", err);
      setEmployees((p) => p.map((e) => (e.id === id ? { ...e, startDate: prevValue } : e)));
    }
  };

  return (
    <div className="panel p-0 overflow-hidden">
      <div className="px-4 pt-4 pb-2 border-b border-white/10 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-semibold">Staff List</h2>
          <p className="text-xs text-muted-foreground">Live view of Master List, grouped by branch — a new hire shows up here automatically.</p>
        </div>
        {activeBranch !== "__current_staff__" && activeBranch !== "__tier_level__" && (
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, position, or tier…"
              className="glass-input text-sm py-1.5 pl-8 pr-3 rounded-md w-56"
            />
          </div>
        )}
      </div>

      <div className="px-4 pt-3 border-b border-white/10 flex gap-1 overflow-x-auto">
        <button
          onClick={() => setActiveBranch("__current_staff__")}
          className={`px-3 py-1.5 text-xs font-semibold rounded-t-md border-b-2 whitespace-nowrap transition ${
            activeBranch === "__current_staff__" ? "border-blue-500 text-blue-300 bg-white/5" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Current Staff
        </button>
        <button
          onClick={() => setActiveBranch("__tier_level__")}
          className={`px-3 py-1.5 text-xs font-semibold rounded-t-md border-b-2 whitespace-nowrap transition ${
            activeBranch === "__tier_level__" ? "border-blue-500 text-blue-300 bg-white/5" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Tier Level
        </button>
        {branches.map((b) => {
          const count = employees.filter((e) => e.branch === b).length;
          return (
            <button
              key={b}
              onClick={() => setActiveBranch(b)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-t-md border-b-2 whitespace-nowrap transition ${
                activeBranch === b ? "border-blue-500 text-blue-300 bg-white/5" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {b} ({count})
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="px-4 py-8 text-center text-muted-foreground text-sm">Loading…</div>
      ) : activeBranch === "__current_staff__" ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                {["Branch", "Senior Branch Manager", "Branch Manager", "Technical Manager", "Part Manager"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-xs text-muted-foreground uppercase whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {currentStaff.map((r) => (
                <tr key={r.branch} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{r.branch}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.seniorBranchManager || "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.branchManager || "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.technicalManager || "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.partManager || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : activeBranch === "__tier_level__" ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                {["Tier", "Ticket Rate", "200 Mile", "300 Mile", "400 Mile", "Mileage Pay", "Branch Incentive", "Distance Home Comp."].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-xs text-muted-foreground uppercase whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tierLevel.map((r) => (
                <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{r.tier}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.ticketRate ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.mile200 ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.mile300 ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.mile400 ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.mileagePay ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{r.branchIncentive || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{r.distanceHomeComp || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                {["Name", "Position", "Start Date", "Company Email", "Personal Email", "Phone", "Work #", "Tier Level", "Note"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-xs text-muted-foreground uppercase whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {branchRows.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground text-xs">No one on file for this branch yet.</td></tr>
              ) : (
                branchRows.map((e) => (
                  <tr key={e.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2 font-medium whitespace-nowrap">
                      <a href={`/csr-agent/${e.id}`} target="_blank" rel="noopener noreferrer" className="hover:text-blue-300 hover:underline transition">{e.name}</a>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{e.position}</td>
                    <td className="px-2 py-1.5">
                      <input
                        type="date"
                        defaultValue={e.startDate}
                        onBlur={(ev) => { if (ev.target.value !== e.startDate) void handleUpdateStartDate(e.id, ev.target.value); }}
                        className="glass-input text-xs py-1 px-1.5 rounded-md"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      {canEditEmail ? (
                        <input
                          key={`ce:${e.id}:${e.companyEmail}`}
                          defaultValue={e.companyEmail}
                          title="This is the real login email — changing it updates their Firebase Auth credential too."
                          onBlur={(ev) => { const v = ev.target.value.trim(); if (v && v !== e.companyEmail) void handleUpdateCompanyEmail(e.id, v); }}
                          className="glass-input text-xs py-1 px-1.5 rounded-md w-44"
                        />
                      ) : (
                        <span className="text-muted-foreground whitespace-nowrap" title="Only Admin/Super Admin can change the login email">{e.companyEmail || "—"}</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        key={`pe:${e.id}:${e.personalEmail}`}
                        defaultValue={e.personalEmail}
                        onBlur={(ev) => { const v = ev.target.value.trim(); if (v !== e.personalEmail) void handleUpdateProfileField(e.id, "personalEmail", v); }}
                        className="glass-input text-xs py-1 px-1.5 rounded-md w-40"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        key={`phone:${e.id}:${e.phone}`}
                        defaultValue={e.phone}
                        onBlur={(ev) => { const v = ev.target.value.trim(); if (v !== e.phone) void handleUpdatePhone(e.id, v); }}
                        className="glass-input text-xs py-1 px-1.5 rounded-md w-28"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        key={`wp:${e.id}:${e.workPhone}`}
                        defaultValue={e.workPhone}
                        onBlur={(ev) => { const v = ev.target.value.trim(); if (v !== e.workPhone) void handleUpdateProfileField(e.id, "workPhone", v); }}
                        className="glass-input text-xs py-1 px-1.5 rounded-md w-28"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        value={e.tierLevel}
                        onChange={(ev) => void handleUpdateProfileField(e.id, "tierLevel", ev.target.value)}
                        className="glass-input text-xs py-1 px-1.5 rounded-md w-32"
                      >
                        <option value="">—</option>
                        {!TIER_LEVEL_OPTIONS.includes(e.tierLevel) && e.tierLevel && <option value={e.tierLevel}>{e.tierLevel}</option>}
                        {TIER_LEVEL_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        key={`note:${e.id}:${e.note}`}
                        defaultValue={e.note}
                        onBlur={(ev) => { const v = ev.target.value.trim(); if (v !== e.note) void handleUpdateProfileField(e.id, "note", v); }}
                        className="glass-input text-xs py-1 px-1.5 rounded-md w-40"
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
