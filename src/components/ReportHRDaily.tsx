import { useState, useMemo, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Plus, Trash2, AlertTriangle, CheckCircle, XCircle, Paperclip, Users, Clock, UserCheck, UserX, UserMinus, Search } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { LOCATIONS_DATA } from "@/lib/zipCoverage";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { normalizeRole, ROLE_LABELS } from "@/lib/roleLabels";
import { getCompanyUsers, getProfileEmployeeInfo, getEmployeeInfoByProfileIds, saveProfileEmployeeInfo, updateCompanyUser } from "@/lib/supabase/users";
import {
  addCandidate,
  deleteCandidate,
  getCandidateCvUrl,
  getCandidates,
  updateCandidateStatus,
  uploadCandidateCv,
  type Candidate,
  type CandidateStatus,
} from "@/lib/supabase/hrCandidates";
import { getAllAgentNotes, getPendingAgentNotes, reviewAgentNote, type CsrAgentNote } from "@/lib/supabase/csrAgentNotes";
import { parseBranchAccess } from "@/lib/locations";

const ALL_US_BRANCHES = LOCATIONS_DATA.filter(l => !l.isPhilippines).map(l => l.location).sort();
const ALL_PH_BRANCHES = LOCATIONS_DATA.filter(l => l.isPhilippines).map(l => l.location).sort();
const PH_BRANCH_NAMES = new Set(LOCATIONS_DATA.filter(l => l.isPhilippines).map(l => l.location));

// HR/Admin/Superadmin/Manager see every candidate and can finalize hires;
// Branch Managers only see + decide on their own branch's applicants —
// they run the final interview, HR finalizes the hire.
const HR_ADMIN_ROLES = new Set(["HR", "ADMIN", "SUPERADMIN", "MANAGER"]);
const BRANCH_MANAGER_ROLES = new Set(["BRANCH_MANAGER", "SENIOR_BRANCH_MANAGER"]);

const CANDIDATE_STATUS_LABEL: Record<CandidateStatus, string> = {
  applied: "Applied",
  interviewing: "Interviewing",
  selected: "Selected",
  hired: "Hired",
  rejected: "Rejected",
};
const CANDIDATE_STATUS_COLOR: Record<CandidateStatus, string> = {
  applied: "bg-blue-500/20 text-blue-300",
  interviewing: "bg-yellow-500/20 text-yellow-300",
  selected: "bg-purple-500/20 text-purple-300",
  hired: "bg-green-500/20 text-green-300",
  rejected: "bg-red-500/20 text-red-300",
};

type EmploymentStatus = "active" | "inactive" | "terminated" | "resigned";

interface Employee {
  id: string;
  name: string;
  email: string;
  position: string; // raw role code
  branch: string;
  country: "US" | "PH";
  birthday: string;
  address: string;
  ssn?: string;
  startDate: string;
  terminationDate?: string;
  terminationReason?: string;
  status: EmploymentStatus;
}

const branchesOf = (assignedBranch: string | null, branchAccess: string | null): string[] => {
  const raw = [assignedBranch ?? "", ...parseBranchAccess(branchAccess)];
  return Array.from(new Set(raw.map((s) => s.trim()).filter(Boolean)));
};

export function ReportHRDaily({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const { role: myRole, ready, uid } = useAuth();
  const normalizedMyRole = normalizeRole(myRole);
  const isHrOrAdmin = ready && HR_ADMIN_ROLES.has(normalizedMyRole);
  const isBranchManager = ready && BRANCH_MANAGER_ROLES.has(normalizedMyRole);

  const today = new Date().toISOString().slice(0, 10);

  const [error, setError] = useState<string | null>(null);
  // One section visible at a time — the page used to stack Hiring, Pending
  // Reviews, the Approved log, the department trend chart, and the full
  // Employee Directory all on top of each other, forcing a long scroll to
  // reach anything below Hiring.
  const [activeTab, setActiveTab] = useState<"hiring" | "warnings" | "directory">("hiring");

  // ── Employee Directory (live) ──
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [roleByProfileId, setRoleByProfileId] = useState<Map<string, string>>(new Map());
  const [employeesLoading, setEmployeesLoading] = useState(true);
  const [myLocations, setMyLocations] = useState<string[]>([]);

  const [confirmDialog, setConfirmDialog] = useState<{ show: boolean; employeeId: string; employeeName: string; newStatus: EmploymentStatus } | null>(null);

  const [employeeFilters, setEmployeeFilters] = useState({
    search: "",
    status: "" as "" | EmploymentStatus,
    branch: "",
    sortBy: "name" as "name" | "startDate" | "warnings",
    sortOrder: "asc" as "asc" | "desc",
  });

  const loadEmployees = async () => {
    setEmployeesLoading(true);
    try {
      const profiles = await getCompanyUsers();

      const me = profiles.find((p) => p.id === uid);
      setMyLocations(me ? branchesOf(me.assigned_branch, me.branch_access) : []);
      setRoleByProfileId(new Map(profiles.map((p) => [p.id, p.role || ""])));

      // getCompanyUsers() doesn't select employee_info (it can carry a
      // base64 photoDataUrl, too heavy to pull on every profile-list load)
      // — fetch hire dates etc. for just this list in one bulk query.
      const infoByProfileId = await getEmployeeInfoByProfileIds(profiles.map((p) => p.id));

      const mapped: Employee[] = profiles.map(p => {
        const info = infoByProfileId.get(p.id) || {};
        const employmentStatus: EmploymentStatus = info.employmentStatus || (p.is_active ? "active" : "inactive");
        return {
          id: p.id,
          name: p.display_name || p.email,
          email: p.email,
          position: p.role,
          branch: p.assigned_branch || "",
          country: PH_BRANCH_NAMES.has(p.assigned_branch || "") ? "PH" : "US",
          birthday: info.birthDate || "",
          address: [info.address1, info.city, info.state].filter(Boolean).join(", "),
          ssn: info.employeeSsn || undefined,
          startDate: info.hireDate || p.created_at?.slice(0, 10) || "",
          terminationDate: info.employmentStatusDate || info.terminateDate || undefined,
          terminationReason: info.employeeNote || undefined,
          status: employmentStatus,
        };
      });
      setEmployees(mapped);
    } catch (err) {
      console.error("ReportHRDaily employees load error:", err);
    } finally {
      setEmployeesLoading(false);
    }
  };

  // ── Hiring / Candidates (live) ──
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(true);
  const [showAddCandidate, setShowAddCandidate] = useState(false);
  const [newCandidate, setNewCandidate] = useState({ name: "", phone: "", email: "", position: "", branch: "" });
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [savingCandidate, setSavingCandidate] = useState(false);
  const [hiringSearch, setHiringSearch] = useState("");
  const [hiringStatusFilter, setHiringStatusFilter] = useState<"" | CandidateStatus>("");

  const loadCandidates = async () => {
    setCandidatesLoading(true);
    try {
      setCandidates(await getCandidates());
    } catch (err) {
      console.error("Failed to load candidates:", err);
    } finally {
      setCandidatesLoading(false);
    }
  };

  // ── Warnings/mistakes (company-wide, generalized from the CSR workflow) ──
  const [allNotes, setAllNotes] = useState<CsrAgentNote[]>([]);
  const [pendingNotes, setPendingNotes] = useState<CsrAgentNote[]>([]);
  const [pendingNotesLoading, setPendingNotesLoading] = useState(true);

  const loadNotes = async () => {
    try {
      const [all, awaitingReview] = await Promise.all([
        getAllAgentNotes().catch(() => []),
        isHrOrAdmin ? getPendingAgentNotes().catch(() => []) : Promise.resolve([]),
      ]);
      setAllNotes(all);
      // getPendingAgentNotes() returns both stages — HR's queue is stage 2
      // only (items a department manager already approved).
      setPendingNotes(awaitingReview.filter((n) => n.status === "manager_approved"));
    } finally {
      setPendingNotesLoading(false);
    }
  };

  useEffect(() => {
    if (!ready) return;
    loadEmployees();
    loadCandidates();
    loadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, isHrOrAdmin]);

  const decideNote = async (id: string, status: "approved" | "rejected") => {
    try {
      await reviewAgentNote(id, status);
      await loadNotes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update review status.");
    }
  };

  // ── Approved Warnings & Mistakes — one centralized log across every
  // department, so HR doesn't have to open each employee's page one by one. ──
  const [logSearch, setLogSearch] = useState("");
  const [logType, setLogType] = useState<"" | "warning" | "mistake">("");
  const [logDept, setLogDept] = useState("");

  const deptLabelOf = (roleCode: string | undefined) => ROLE_LABELS[normalizeRole(roleCode)] ?? roleCode ?? "Unknown";

  const approvedLog = useMemo(() => {
    return allNotes
      .filter((n) => n.status === "approved")
      .map((n) => ({
        ...n,
        employeeName: employees.find((e) => e.id === n.agentProfileId)?.name || "Unknown employee",
        department: deptLabelOf(roleByProfileId.get(n.agentProfileId)),
      }))
      .sort((a, b) => (b.reviewedAt || b.createdAt).localeCompare(a.reviewedAt || a.createdAt));
  }, [allNotes, employees, roleByProfileId]);

  const approvedDepartments = useMemo(
    () => Array.from(new Set(approvedLog.map((n) => n.department))).sort(),
    [approvedLog],
  );

  const filteredApprovedLog = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    return approvedLog.filter((n) => {
      if (logType && n.type !== logType) return false;
      if (logDept && n.department !== logDept) return false;
      if (q && !n.employeeName.toLowerCase().includes(q) && !n.note.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [approvedLog, logType, logDept, logSearch]);

  // ── Candidate handlers ──
  const allBranches = useMemo(() => LOCATIONS_DATA.map(l => l.location).sort(), []);
  const branchOptions = isBranchManager && myLocations.length > 0 ? myLocations : allBranches;

  const visibleCandidates = useMemo(() => {
    if (!isBranchManager) return candidates;
    return candidates.filter((c) => c.branch && myLocations.includes(c.branch));
  }, [candidates, isBranchManager, myLocations]);

  // Search/Status filters narrow what the table shows — KPI tiles and the
  // tab badge count stay based on visibleCandidates (unfiltered) above.
  const filteredCandidates = useMemo(() => {
    let result = visibleCandidates;
    if (hiringStatusFilter) result = result.filter((c) => c.status === hiringStatusFilter);
    const q = hiringSearch.trim().toLowerCase();
    if (q) {
      result = result.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        (c.position ?? "").toLowerCase().includes(q) ||
        (c.branch ?? "").toLowerCase().includes(q),
      );
    }
    return result;
  }, [visibleCandidates, hiringSearch, hiringStatusFilter]);

  const kpi = useMemo(() => ({
    candidates: visibleCandidates.length,
    scheduled: visibleCandidates.filter((c) => c.status === "interviewing").length,
    preSelected: visibleCandidates.filter((c) => c.status === "selected").length,
    rejected: visibleCandidates.filter((c) => c.status === "rejected").length,
    hired: visibleCandidates.filter((c) => c.status === "hired").length,
    terminated: employees.filter((e) => e.status === "terminated").length,
    resigned: employees.filter((e) => e.status === "resigned").length,
  }), [visibleCandidates, employees]);

  const handleAddCandidate = async () => {
    if (!newCandidate.name.trim()) return;
    setSavingCandidate(true);
    setError(null);
    try {
      const created = await addCandidate(newCandidate);
      // The candidate row is saved at this point — close the form and
      // refresh the list regardless of what happens next, so a CV upload
      // failure doesn't strand the UI on a stale, still-open form.
      setNewCandidate({ name: "", phone: "", email: "", position: "", branch: "" });
      setCvFile(null);
      setShowAddCandidate(false);
      await loadCandidates();

      if (cvFile && created.companyId) {
        try {
          // Use the company_id the server actually stamped on the row
          // (set by the DB trigger in this same request) rather than the
          // client's cached auth context — guaranteed to match what the
          // Storage RLS policy checks against, no staleness possible.
          await uploadCandidateCv(created.id, created.companyId, cvFile);
          await loadCandidates();
        } catch (err) {
          setError(`${created.name} was added, but the CV upload failed: ${err instanceof Error ? err.message : "unknown error"}`);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add candidate.");
    } finally {
      setSavingCandidate(false);
    }
  };

  const handleCandidateStatus = async (id: string, status: CandidateStatus) => {
    try {
      await updateCandidateStatus(id, status);
      await loadCandidates();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update candidate status.");
    }
  };

  const handleDeleteCandidate = async (id: string) => {
    try {
      await deleteCandidate(id);
      await loadCandidates();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete candidate.");
    }
  };

  const handleViewCv = async (cvPath: string) => {
    try {
      const url = await getCandidateCvUrl(cvPath);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open CV.");
    }
  };

  // Branch Managers run the final interview and pick a candidate, but HR
  // finalizes the actual hire.
  const candidateStatusOptions = (isHrOrAdmin
    ? ["applied", "interviewing", "selected", "hired", "rejected"]
    : ["interviewing", "selected", "rejected"]) as CandidateStatus[];

  // ── Employee status handlers (now real — persists to employee_info + is_active) ──
  const handleUpdateEmployeeStatus = (id: string, newStatus: EmploymentStatus) => {
    if (newStatus === "terminated" || newStatus === "resigned") {
      const employee = employees.find(e => e.id === id);
      if (employee) setConfirmDialog({ show: true, employeeId: id, employeeName: employee.name, newStatus });
    } else {
      void persistEmployeeStatus(id, newStatus);
    }
  };

  const persistEmployeeStatus = async (id: string, newStatus: EmploymentStatus) => {
    try {
      const info = (await getProfileEmployeeInfo(id)) || {};
      await saveProfileEmployeeInfo(id, { ...info, employmentStatus: newStatus, employmentStatusDate: today });
      await updateCompanyUser(id, { isActive: newStatus === "active" });
      setEmployees((prev) => prev.map((e) => (e.id === id ? { ...e, status: newStatus, terminationDate: newStatus === "terminated" || newStatus === "resigned" ? today : e.terminationDate } : e)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update employment status.");
    }
  };

  const handleConfirmStatusChange = async () => {
    if (!confirmDialog) return;
    await persistEmployeeStatus(confirmDialog.employeeId, confirmDialog.newStatus);
    setConfirmDialog(null);
  };

  const handleCancelStatusChange = () => setConfirmDialog(null);

  // Warnings actually approved by HR (final stage) — not timecard-derived.
  const approvedWarningCountByProfile = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of allNotes) {
      if (n.status !== "approved" || n.type !== "warning") continue;
      map.set(n.agentProfileId, (map.get(n.agentProfileId) ?? 0) + 1);
    }
    return map;
  }, [allNotes]);

  // Filtered and sorted employees
  const filteredEmployees = useMemo(() => {
    let result = [...employees];
    const q = employeeFilters.search.trim().toLowerCase();
    if (q) {
      result = result.filter(e =>
        e.name.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        e.branch.toLowerCase().includes(q) ||
        (ROLE_LABELS[normalizeRole(e.position)] ?? e.position ?? "").toLowerCase().includes(q),
      );
    }
    if (employeeFilters.status) result = result.filter(e => e.status === employeeFilters.status);
    if (employeeFilters.branch) result = result.filter(e => e.branch === employeeFilters.branch);
    result.sort((a, b) => {
      let compareVal = 0;
      if (employeeFilters.sortBy === "name") compareVal = a.name.localeCompare(b.name);
      else if (employeeFilters.sortBy === "startDate") compareVal = new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
      else if (employeeFilters.sortBy === "warnings") compareVal = (approvedWarningCountByProfile.get(a.id) ?? 0) - (approvedWarningCountByProfile.get(b.id) ?? 0);
      return employeeFilters.sortOrder === "asc" ? compareVal : -compareVal;
    });
    return result;
  }, [employees, employeeFilters, approvedWarningCountByProfile]);

  // ── Warnings / Termination / Resigned per-department trend ──
  const [trendMode, setTrendMode] = useState<"monthly" | "range">("monthly");
  const [trendMonth, setTrendMonth] = useState(today.slice(0, 7)); // YYYY-MM
  const [trendFrom, setTrendFrom] = useState("");
  const [trendTo, setTrendTo] = useState("");

  const inTrendWindow = (dateStr: string | undefined | null) => {
    if (!dateStr) return false;
    if (trendMode === "monthly") return dateStr.slice(0, 7) === trendMonth;
    if (trendFrom && dateStr < trendFrom) return false;
    if (trendTo && dateStr > trendTo) return false;
    return true;
  };

  const departmentTrendData = useMemo(() => {
    const byDept = new Map<string, { department: string; Warnings: number; Terminated: number; Resigned: number }>();
    const deptLabel = (roleCode: string | undefined) => ROLE_LABELS[normalizeRole(roleCode)] ?? roleCode ?? "Unknown";
    const bump = (roleCode: string | undefined, key: "Warnings" | "Terminated" | "Resigned") => {
      const dept = deptLabel(roleCode);
      if (!byDept.has(dept)) byDept.set(dept, { department: dept, Warnings: 0, Terminated: 0, Resigned: 0 });
      byDept.get(dept)![key] += 1;
    };

    for (const n of allNotes) {
      if (n.status !== "approved" || n.type !== "warning") continue;
      if (!inTrendWindow(n.createdAt.slice(0, 10))) continue;
      bump(roleByProfileId.get(n.agentProfileId), "Warnings");
    }
    for (const e of employees) {
      if (e.status !== "terminated" && e.status !== "resigned") continue;
      if (!inTrendWindow(e.terminationDate)) continue;
      bump(e.position, e.status === "terminated" ? "Terminated" : "Resigned");
    }
    return Array.from(byDept.values()).sort((a, b) => (b.Warnings + b.Terminated + b.Resigned) - (a.Warnings + a.Terminated + a.Resigned));
  }, [allNotes, employees, roleByProfileId, trendMode, trendMonth, trendFrom, trendTo]);

  return (
    <div className="min-h-screen flex flex-col"><main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-6">
      <div className="flex items-center gap-3 mb-4"><Link to="/m/$module" params={{module:mod.slug}} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4"/></Link><h1 className="text-2xl font-bold">{sub.title}</h1></div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 flex items-start justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-300/70 hover:text-red-300 shrink-0">✕</button>
        </div>
      )}

      {/* ── Total Employees ── */}
      <div className="panel p-4 mb-4 flex items-center gap-4">
        <div className="flex items-center justify-center h-11 w-11 rounded-lg bg-blue-500/15 text-blue-300 shrink-0">
          <Users className="h-5 w-5" />
        </div>
        <div>
          <p className="text-2xl font-bold leading-tight">{employees.length}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Total Employees</p>
        </div>
      </div>

      {/* ── KPI overview ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-4">
        {[
          { label: "Candidates", value: kpi.candidates, color: "text-blue-300", icon: <Users className="h-4 w-4" /> },
          { label: "Scheduled for Interview", value: kpi.scheduled, color: "text-yellow-300", icon: <Clock className="h-4 w-4" /> },
          { label: "Pre-Selected", value: kpi.preSelected, color: "text-purple-300", icon: <CheckCircle className="h-4 w-4" /> },
          { label: "Rejected", value: kpi.rejected, color: "text-red-300", icon: <XCircle className="h-4 w-4" /> },
          { label: "Hired", value: kpi.hired, color: "text-green-300", icon: <UserCheck className="h-4 w-4" /> },
          { label: "Terminated", value: kpi.terminated, color: "text-red-400", icon: <UserX className="h-4 w-4" /> },
          { label: "Resigned", value: kpi.resigned, color: "text-slate-300", icon: <UserMinus className="h-4 w-4" /> },
        ].map((k) => (
          <div key={k.label} className="panel p-3 text-center">
            <div className="flex justify-center mb-1 text-muted-foreground">{k.icon}</div>
            <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{k.label}</p>
          </div>
        ))}
      </div>

      {/* ── Tab navigation ── */}
      <div className="flex gap-1 mb-4 border-b border-white/10">
        {([
          { key: "hiring", label: "Hiring", count: visibleCandidates.length },
          { key: "warnings", label: "Warnings & Mistakes", count: isHrOrAdmin ? pendingNotes.length : 0 },
          { key: "directory", label: "Employee Directory", count: employees.length },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === tab.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${activeTab === tab.key ? "bg-primary/20 text-primary" : "bg-white/10 text-muted-foreground"}`}>{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Hiring ── */}
      {activeTab === "hiring" && (
      <div className="panel p-0 overflow-hidden mb-4">
        <div className="px-4 py-4 border-b border-white/10 flex justify-between items-center">
          <div>
            <h2 className="font-semibold text-sm">Hiring</h2>
            {isBranchManager && <p className="text-[10px] text-muted-foreground mt-0.5">Showing applicants for your branch{myLocations.length > 1 ? "es" : ""}: {myLocations.join(", ") || "none assigned"}</p>}
          </div>
          <button onClick={() => setShowAddCandidate(!showAddCandidate)} className="btn text-sm px-3 py-1.5 flex items-center gap-2">
            <Plus className="h-4 w-4" /> Add Candidate
          </button>
        </div>

        {/* Hiring Filters */}
        <div className="px-4 py-3 border-b border-white/10 bg-white/5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Search</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input value={hiringSearch} onChange={(e) => setHiringSearch(e.target.value)} placeholder="Name, position, or branch…" className="glass-input text-sm py-1.5 pl-8 pr-3 rounded-md w-56" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Status</label>
              <select value={hiringStatusFilter} onChange={(e) => setHiringStatusFilter(e.target.value as any)} className="glass-input text-sm py-1.5 px-3 rounded-md">
                <option value="">All</option>
                {(["applied", "interviewing", "selected", "hired", "rejected"] as CandidateStatus[]).map((s) => (
                  <option key={s} value={s}>{CANDIDATE_STATUS_LABEL[s]}</option>
                ))}
              </select>
            </div>
            {(hiringSearch || hiringStatusFilter) && (
              <button onClick={() => { setHiringSearch(""); setHiringStatusFilter(""); }} className="btn text-sm px-3 mb-0.5">Clear</button>
            )}
            <span className="text-xs text-muted-foreground mb-1.5 ml-auto">
              {filteredCandidates.length}{(hiringSearch || hiringStatusFilter) ? ` of ${visibleCandidates.length}` : ""} candidates
            </span>
          </div>
        </div>

        {showAddCandidate && (
          <div className="px-4 py-4 border-b border-white/10 bg-white/5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              <input type="text" placeholder="Name *" value={newCandidate.name} onChange={(e) => setNewCandidate({ ...newCandidate, name: e.target.value })} className="glass-input text-sm py-1.5 px-3 rounded-md" />
              <input type="text" placeholder="Phone Number" value={newCandidate.phone} onChange={(e) => setNewCandidate({ ...newCandidate, phone: e.target.value })} className="glass-input text-sm py-1.5 px-3 rounded-md" />
              <input type="email" placeholder="Email" value={newCandidate.email} onChange={(e) => setNewCandidate({ ...newCandidate, email: e.target.value })} className="glass-input text-sm py-1.5 px-3 rounded-md" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              <input type="text" placeholder="Position" value={newCandidate.position} onChange={(e) => setNewCandidate({ ...newCandidate, position: e.target.value })} className="glass-input text-sm py-1.5 px-3 rounded-md" />
              <select value={newCandidate.branch} onChange={(e) => setNewCandidate({ ...newCandidate, branch: e.target.value })} className="glass-input text-sm py-1.5 px-3 rounded-md"><option value="">Select Branch</option>{branchOptions.map((b) => <option key={b} value={b}>{b}</option>)}</select>
              <label className="glass-input text-sm py-1.5 px-3 rounded-md flex items-center gap-2 cursor-pointer text-muted-foreground">
                <Paperclip className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{cvFile ? cvFile.name : "Upload CV"}</span>
                <input type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => setCvFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>
            <div className="flex gap-2">
              <button onClick={handleAddCandidate} disabled={savingCandidate || !newCandidate.name.trim()} className="btn bg-green-600 hover:bg-green-700 text-white text-sm px-4 py-1.5 disabled:opacity-50">{savingCandidate ? "Saving…" : "Save"}</button>
              <button onClick={() => setShowAddCandidate(false)} className="btn text-sm px-4 py-1.5">Cancel</button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Candidate</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Position</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Branch</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Contact</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">CV</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {candidatesLoading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">Loading candidates…</td></tr>
              ) : filteredCandidates.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">{visibleCandidates.length === 0 ? "No candidates yet." : "No candidates match these filters."}</td></tr>
              ) : (
                filteredCandidates.map((c) => (
                  <tr key={c.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{c.position || "—"}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{c.branch || "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{c.phone || c.email ? <>{c.phone && <div>{c.phone}</div>}{c.email && <div>{c.email}</div>}</> : "—"}</td>
                    <td className="px-4 py-3">
                      {c.cvPath ? (
                        <button onClick={() => handleViewCv(c.cvPath!)} className="text-blue-400 hover:text-blue-300 text-xs underline">View CV</button>
                      ) : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <select value={c.status} onChange={(e) => handleCandidateStatus(c.id, e.target.value as CandidateStatus)} className={`text-xs font-semibold px-2 py-1 rounded border-0 ${CANDIDATE_STATUS_COLOR[c.status]}`}>
                        {!candidateStatusOptions.includes(c.status) && <option value={c.status}>{CANDIDATE_STATUS_LABEL[c.status]}</option>}
                        {candidateStatusOptions.map((s) => <option key={s} value={s}>{CANDIDATE_STATUS_LABEL[s]}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      {isHrOrAdmin && (
                        <button onClick={() => handleDeleteCandidate(c.id)} className="btn text-red-400 hover:text-red-300 text-sm p-1"><Trash2 className="h-4 w-4" /></button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* ── Warnings & Mistakes tab: Pending Reviews, Approved log, department trend ── */}
      {activeTab === "warnings" && (
      <>
      {/* Pending Reviews — HR's final call (stage 2) */}
      {isHrOrAdmin && (
        <div className="panel p-4 mb-4">
          <p className="text-sm font-semibold mb-1 flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 text-yellow-400" /> Pending Reviews
            {pendingNotes.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-yellow-500/15 text-yellow-300 border border-yellow-500/25">{pendingNotes.length}</span>
            )}
          </p>
          <p className="text-[10px] text-muted-foreground mb-3">Already approved by the employee's manager — awaiting your final decision.</p>
          {pendingNotesLoading ? (
            <p className="text-xs text-muted-foreground py-2">Loading…</p>
          ) : pendingNotes.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">Nothing waiting on your final decision.</p>
          ) : (
            <div className="space-y-2">
              {pendingNotes.map((n) => {
                const employeeName = employees.find((e) => e.id === n.agentProfileId)?.name || "Unknown employee";
                return (
                  <div key={n.id} className="rounded-lg border border-white/10 bg-white/5 p-3 flex items-start gap-3">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${n.type === "warning" ? "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30" : "bg-orange-500/20 text-orange-300 border border-orange-500/30"}`}>
                      {n.type === "warning" ? "Warning" : "Mistake"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs"><span className="font-semibold">{employeeName}</span> — {n.note}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {n.ticketNo && <>Ticket <span className="font-mono text-blue-400">{n.ticketNo}</span> · </>}
                        Submitted by {n.createdByName || "Unknown"} · {new Date(n.createdAt).toLocaleString()}
                        {n.managerReviewedByName && <> · Approved by {n.managerReviewedByName}{n.managerReviewedAt ? ` · ${new Date(n.managerReviewedAt).toLocaleString()}` : ""}</>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button type="button" onClick={() => decideNote(n.id, "approved")} className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-green-500/15 text-green-300 border border-green-500/30 hover:bg-green-500/25 transition-colors">
                        <CheckCircle className="h-3 w-3" /> Approve
                      </button>
                      <button type="button" onClick={() => decideNote(n.id, "rejected")} className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25 transition-colors">
                        <XCircle className="h-3 w-3" /> Reject
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Approved Warnings & Mistakes — centralized, company-wide ── */}
      {isHrOrAdmin && (
        <div className="panel p-0 overflow-hidden mb-4">
          <div className="px-4 py-4 border-b border-white/10">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <h2 className="font-semibold text-sm flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4 text-yellow-400" /> Approved Warnings &amp; Mistakes
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-white/10 text-muted-foreground">{filteredApprovedLog.length}</span>
                </h2>
                <p className="text-[10px] text-muted-foreground mt-0.5">Every approved note across every department, in one place — no need to open each employee's page.</p>
              </div>
              <div className="ml-auto flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Search</label>
                  <input value={logSearch} onChange={(e) => setLogSearch(e.target.value)} placeholder="Employee or note…" className="glass-input text-sm py-1.5 px-3 rounded-md w-48" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Type</label>
                  <select value={logType} onChange={(e) => setLogType(e.target.value as any)} className="glass-input text-sm py-1.5 px-3 rounded-md">
                    <option value="">All</option>
                    <option value="warning">Warning</option>
                    <option value="mistake">Mistake</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Department</label>
                  <select value={logDept} onChange={(e) => setLogDept(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md">
                    <option value="">All</option>
                    {approvedDepartments.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                {(logSearch || logType || logDept) && (
                  <button onClick={() => { setLogSearch(""); setLogType(""); setLogDept(""); }} className="btn text-sm px-3 mb-0.5">Clear</button>
                )}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="border-b border-white/10 bg-slate-900">
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Employee</th>
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Department</th>
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Type</th>
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Note</th>
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Ticket</th>
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Submitted</th>
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Manager</th>
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">HR (Final)</th>
                </tr>
              </thead>
              <tbody>
                {filteredApprovedLog.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground text-xs">No approved warnings or mistakes{logSearch || logType || logDept ? " match these filters." : " yet."}</td></tr>
                ) : (
                  filteredApprovedLog.map((n) => (
                    <tr key={n.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-3 py-2 font-medium whitespace-nowrap">
                        <a href={`/csr-agent/${n.agentProfileId}`} target="_blank" rel="noopener noreferrer" className="hover:text-blue-300 hover:underline transition">{n.employeeName}</a>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{n.department}</td>
                      <td className="px-3 py-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${n.type === "warning" ? "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30" : "bg-orange-500/20 text-orange-300 border border-orange-500/30"}`}>
                          {n.type === "warning" ? "Warning" : "Mistake"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground max-w-xs truncate" title={n.note}>{n.note}</td>
                      <td className="px-3 py-2 font-mono text-blue-400 whitespace-nowrap">{n.ticketNo || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {n.createdByName || "Unknown"}<br />
                        <span className="text-[10px]">{new Date(n.createdAt).toLocaleString()}</span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {n.managerReviewedByName || "—"}<br />
                        {n.managerReviewedAt && <span className="text-[10px]">{new Date(n.managerReviewedAt).toLocaleString()}</span>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {n.reviewedByName || "Unknown"}<br />
                        <span className="text-[10px]">{n.reviewedAt ? new Date(n.reviewedAt).toLocaleString() : "—"}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Warnings, Termination & Resigned — per department ── */}
      <div className="panel p-4 mb-4">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <p className="text-sm font-semibold">Warnings, Termination &amp; Resigned — by Department</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">View</label>
              <div className="flex rounded-md overflow-hidden border border-white/15 h-7.5">
                <button type="button" onClick={() => setTrendMode("monthly")} className={`px-3 text-xs font-medium transition-colors ${trendMode === "monthly" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"}`}>Monthly</button>
                <button type="button" onClick={() => setTrendMode("range")} className={`px-3 text-xs font-medium transition-colors border-l border-white/15 ${trendMode === "range" ? "bg-blue-600 text-white" : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"}`}>Date Range</button>
              </div>
            </div>
            {trendMode === "monthly" ? (
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Month</label>
                <input type="month" value={trendMonth} onChange={(e) => setTrendMonth(e.target.value)} className="glass-input text-xs py-1.5 px-3 rounded-md h-7.5" />
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">From</label>
                  <input type="date" value={trendFrom} onChange={(e) => setTrendFrom(e.target.value)} className="glass-input text-xs py-1.5 px-3 rounded-md h-7.5" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">To</label>
                  <input type="date" value={trendTo} onChange={(e) => setTrendTo(e.target.value)} className="glass-input text-xs py-1.5 px-3 rounded-md h-7.5" />
                </div>
              </>
            )}
          </div>
        </div>
        {departmentTrendData.length === 0 ? (
          <p className="text-xs text-muted-foreground py-8 text-center">No warnings, terminations, or resignations in this window.</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={departmentTrendData} margin={{ left: -10 }}>
              <XAxis dataKey="department" tick={{ fill: "#94a3b8", fontSize: 10 }} angle={-25} textAnchor="end" height={55} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--foreground)", fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
              <Bar dataKey="Warnings" fill="#facc15" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Terminated" fill="#f87171" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Resigned" fill="#94a3b8" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      </>
      )}

      {/* ── Employee Directory ── */}
      {activeTab === "directory" && (
      <div className="panel p-0 overflow-hidden">
        <div className="px-4 py-4 border-b border-white/10 flex justify-between items-center">
          <h2 className="font-semibold text-sm">Employee Directory</h2>
          <span className="text-xs text-muted-foreground">Click a name to view statistics, mistakes &amp; warnings</span>
        </div>

        {/* Employee Filters */}
        <div className="px-4 py-3 border-b border-white/10 bg-white/5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Search</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input value={employeeFilters.search} onChange={(e) => setEmployeeFilters({ ...employeeFilters, search: e.target.value })} placeholder="Name, email, branch, or position…" className="glass-input text-sm py-1.5 pl-8 pr-3 rounded-md w-56" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</label>
              <select value={employeeFilters.status} onChange={(e) => setEmployeeFilters({ ...employeeFilters, status: e.target.value as any })} className="glass-input text-sm py-1.5 px-3 rounded-md">
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="terminated">Terminated</option>
                <option value="resigned">Resigned</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Branch</label>
              <select value={employeeFilters.branch} onChange={(e) => setEmployeeFilters({ ...employeeFilters, branch: e.target.value })} className="glass-input text-sm py-1.5 px-3 rounded-md">
                <option value="">All</option>
                {allBranches.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sort By</label>
              <select value={employeeFilters.sortBy} onChange={(e) => setEmployeeFilters({ ...employeeFilters, sortBy: e.target.value as any })} className="glass-input text-sm py-1.5 px-3 rounded-md">
                <option value="name">Name</option>
                <option value="startDate">Start Date</option>
                <option value="warnings">Warnings</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Order</label>
              <select value={employeeFilters.sortOrder} onChange={(e) => setEmployeeFilters({ ...employeeFilters, sortOrder: e.target.value as any })} className="glass-input text-sm py-1.5 px-3 rounded-md">
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </div>
            {(employeeFilters.search || employeeFilters.status || employeeFilters.branch) && (
              <button onClick={() => setEmployeeFilters({ search: "", status: "", branch: "", sortBy: "name", sortOrder: "asc" })} className="btn text-sm px-3 mb-0.5">Clear Filters</button>
            )}
            <span className="text-xs text-muted-foreground mb-1.5 ml-auto">
              {filteredEmployees.length}{(employeeFilters.search || employeeFilters.status || employeeFilters.branch) ? ` of ${employees.length}` : ""} employees
            </span>
          </div>
        </div>

        {/* Employee Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Name</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Email</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Position</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Branch</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Start Date</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Warnings</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Termination</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground text-xs">{employeesLoading ? "Loading employees…" : employees.length === 0 ? "No employees found." : "No employees match these filters."}</td></tr>
              ) : (
                filteredEmployees.map((employee) => (
                  <tr key={employee.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2 font-medium">
                      <a href={`/csr-agent/${employee.id}`} target="_blank" rel="noopener noreferrer" className="hover:text-blue-300 hover:underline transition cursor-pointer" title={`View ${employee.name}'s statistics`}>
                        {employee.name}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{employee.email}</td>
                    <td className="px-3 py-2 text-muted-foreground">{ROLE_LABELS[normalizeRole(employee.position)] ?? employee.position}</td>
                    <td className="px-3 py-2 text-muted-foreground">{employee.branch || "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{employee.startDate || "—"}</td>
                    <td className="px-3 py-2">
                      {(approvedWarningCountByProfile.get(employee.id) ?? 0) > 0 ? (
                        <span className="bg-yellow-500/20 text-yellow-300 px-2 py-1 rounded text-xs font-semibold">{approvedWarningCountByProfile.get(employee.id)}</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">
                      {employee.terminationDate ? (
                        <div className="text-yellow-400 text-xs">
                          <div>{employee.terminationDate}</div>
                          <div className="text-xs text-yellow-300">{employee.terminationReason || "N/A"}</div>
                        </div>
                      ) : <span>—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={employee.status}
                        onChange={(e) => handleUpdateEmployeeStatus(employee.id, e.target.value as EmploymentStatus)}
                        className="text-xs font-semibold px-2 py-1 rounded border-0 bg-slate-700 text-slate-100"
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                        <option value="terminated">Terminated</option>
                        <option value="resigned">Resigned</option>
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Confirmation Dialog */}
      {confirmDialog?.show && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-lg p-6 max-w-sm">
            <h3 className="text-lg font-bold mb-2">Confirm Status Change</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Are you sure you want to mark <span className="font-semibold text-white">{confirmDialog.employeeName}</span> as <span className="font-semibold text-white capitalize">{confirmDialog.newStatus}</span>? This will also deactivate their account.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={handleCancelStatusChange} className="btn text-sm px-4 py-2">Cancel</button>
              <button onClick={handleConfirmStatusChange} className={`btn text-sm px-4 py-2 text-white ${confirmDialog.newStatus === "terminated" ? "bg-red-600 hover:bg-red-700" : "bg-orange-600 hover:bg-orange-700"}`}>
                Confirm {confirmDialog.newStatus === "terminated" ? "Termination" : "Resignation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main></div>
  );
}
