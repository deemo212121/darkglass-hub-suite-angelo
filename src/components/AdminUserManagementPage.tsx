import { useMemo, useState, useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, Check, Filter, Search } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { type UserManagementRecord } from "@/lib/user-management";
import { useAuth } from "@/lib/auth";
import { createCompanyUser, getCompanyUsers, deleteCompanyUser, type ProfileRow } from "@/lib/supabase/users";

type ViewMode = "list" | "hierarchy";

interface NewUserFormData {
  loginName: string;
  userName: string;
  email: string;
  /** Primary role code (first ticked in the checkbox grid). Drives RLS / legacy checks. */
  userType: string;
  /** All ticked role codes including the primary one. */
  userTypes: string[];
  manager: string;
  technicianId: string;
  assignedBranch: string;
  branchAccess: string;
  poInitials: string;
  requiredCheckIn: string;
  requiredCheckOut: string;
  selectedOffDays: number[];
}

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// Branch/office locations (used by Assigned Branch + Branch Access dropdowns)
const LOCATIONS = [
  "Asheville", "Atlanta", "Birmingham", "Cape Girardeau", "Chattanooga",
  "Columbus", "Destin", "Dallas", "Huntsville", "Jackson, MS", "Jackson, TN",
  "Jacksonville", "Jonesboro", "Knoxville", "Lake Charles", "Little Rock",
  "Memphis", "Mobile", "Montgomery", "Nashville", "New Orleans", "Norfolk",
  "Richmond", "Raleigh", "San Antonio", "St. Louis", "Savannah",
  "Tallahassee", "Wilmington", "Philippines",
];

// User types: { value stored as Firestore role, label shown in the dropdown }
// Users can tick multiple — the first ticked value becomes the primary `role`
// (used by RLS / legacy access checks); the rest go into `extra_roles`.
const USER_TYPES: { value: string; label: string }[] = [
  { value: "ADMIN", label: "Admin" },
  { value: "MANAGER", label: "Manager" },
  { value: "TECHNICIAN", label: "Technician" },
  { value: "TECHNICIAN_MANAGER", label: "Tech Manager" },
  { value: "CLAIMS", label: "Claims" },
  { value: "HR", label: "HR" },
  { value: "IT", label: "IT" },
  { value: "PARTS", label: "Parts" },
  { value: "FINANCE", label: "Finance" },
  { value: "CSR_AGENT", label: "CSR Agent" },
  { value: "CSR_TEAM_LEADER", label: "CSR Team Leader" },
  { value: "CSR_MANAGER", label: "CSR Manager" },
  { value: "BRANCH_MANAGER", label: "Branch Manager" },
  { value: "SENIOR_BRANCH_MANAGER", label: "Senior Branch Manager" },
  { value: "CLAIMS_MANAGER", label: "Claims Manager" },
  { value: "PARTS_MANAGER", label: "Parts Manager" },
  { value: "BIZOPS_MANAGER", label: "BizOps Manager" },
  { value: "BIZOPS_SENIOR_MANAGER", label: "BizOps Senior Manager" },
  { value: "TRIAGE_USER", label: "Triage User" },
  { value: "TRIAGE_MANAGER", label: "Triage Manager" },
];

// Sentinel for the "All Locations" entry in Branch Access. Picking this clears
// every individual selection — the user can see every branch. Stored as-is so
// downstream code can detect it explicitly.
const ALL_LOCATIONS_TOKEN = "*";

// Columns that get a funnel filter on the user management table header.
// Mirrors the Ticket List column-filter pattern.
const UM_FILTERABLE_FIELDS = [
  "id",
  "loginName",
  "userName",
  "type",
  "email",
  "manager",
  "technicianId",
  "office",
] as const;

type UMFilterableField = (typeof UM_FILTERABLE_FIELDS)[number];

/**
 * Plain-text representation of a user record column. Mirrors what the
 * cell renders, so the funnel dropdown shows the same values the user
 * sees in the table.
 */
function colValue(record: { id: string; loginName: string; userName: string; type: string; email?: string; manager?: string; technicianId?: string; office?: string }, field: string): string {
  switch (field as UMFilterableField) {
    case "id":            return String(record.id ?? "");
    case "loginName":     return String(record.loginName ?? "");
    case "userName":      return String(record.userName ?? "");
    case "type":          return String(record.type ?? "");
    case "email":         return String(record.email ?? "");
    case "manager":       return String(record.manager ?? "");
    case "technicianId":  return String(record.technicianId ?? "");
    case "office":        return String(record.office ?? "");
    default:              return String((record as any)[field] ?? "");
  }
}

/**
 * Single-select branch dropdown (Assigned Branch).
 * A checkbox sits on the LEFT of each location; picking one selects it.
 */
function BranchSingleSelect({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="glass-input w-full text-[11px] px-2 py-1 flex items-center justify-between text-left">
        <span className={value ? "text-slate-100" : "text-slate-500"}>{value || placeholder}</span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-white/10 bg-slate-900 shadow-xl">
          {LOCATIONS.map(loc => {
            const checked = value === loc;
            return (
              <button key={loc} type="button"
                onClick={() => { onChange(loc); setOpen(false); }}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-left hover:bg-white/10">
                <span className={`h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0 ${checked ? "bg-blue-500 border-blue-500" : "border-white/30"}`}>
                  {checked && <Check className="h-2.5 w-2.5 text-white" />}
                </span>
                <span className="text-slate-200">{loc}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Multi-select branch dropdown (Branch Access).
 * Each location has a LEFT checkbox; multiple may be selected. Stored as a
 * pipe-delimited string ("Jackson, MS|Jackson, TN") so location names that
 * already contain a comma (Jackson, MS / Jackson, TN) don't get split into
 * two phantom entries when re-parsed. Legacy comma-separated values are still
 * recognized via a fallback parser below.
 */
const BRANCH_DELIMITER = "|";

function parseSelectedBranches(value: string): string[] {
  const raw = String(value || "").trim();
  if (!raw) return [];
  // New pipe-delimited format.
  if (raw.includes(BRANCH_DELIMITER)) {
    return raw.split(BRANCH_DELIMITER).map((s) => s.trim()).filter(Boolean);
  }
  // Legacy comma-delimited format: greedy-match against the known location
  // list so multi-word names like "Jackson, MS" stay intact even when stored
  // with a comma separator.
  const remaining = raw;
  const found: string[] = [];
  // Sort longest-first so "Jackson, MS" matches before "Jackson".
  const sorted = [...LOCATIONS].sort((a, b) => b.length - a.length);
  let working = remaining;
  while (working.length > 0) {
    working = working.replace(/^[\s,]+/, "");
    if (!working) break;
    const hit = sorted.find((loc) => working.startsWith(loc));
    if (!hit) {
      // Unknown token — drop everything up to the next comma so we don't loop.
      const next = working.indexOf(",");
      working = next === -1 ? "" : working.slice(next + 1);
      continue;
    }
    found.push(hit);
    working = working.slice(hit.length);
  }
  // De-duplicate.
  return Array.from(new Set(found));
}

function BranchMultiSelect({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isAll = value === ALL_LOCATIONS_TOKEN;
  const selected = useMemo(() => (isAll ? [] : parseSelectedBranches(value)), [value, isAll]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const toggle = (loc: string) => {
    // Tapping any specific location while "All" is on switches us to a normal
    // multi-select with just that location ticked.
    if (isAll) { onChange(loc); return; }
    const next = selected.includes(loc) ? selected.filter(s => s !== loc) : [...selected, loc];
    onChange(next.join(BRANCH_DELIMITER));
  };
  const toggleAll = () => onChange(isAll ? "" : ALL_LOCATIONS_TOKEN);
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="glass-input w-full text-[11px] px-2 py-1 flex items-center justify-between text-left">
        <span className={(isAll || selected.length) ? "text-slate-100 truncate" : "text-slate-500"}>
          {isAll
            ? "All Locations"
            : selected.length
              ? `${selected.length} selected: ${selected.join(", ")}`
              : placeholder}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-white/10 bg-slate-900 shadow-xl">
          {/* All Locations sentinel — selecting this clears individual picks. */}
          <button
            type="button"
            onClick={toggleAll}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-left hover:bg-white/10 border-b border-white/5"
          >
            <span className={`h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0 ${isAll ? "bg-blue-500 border-blue-500" : "border-white/30"}`}>
              {isAll && <Check className="h-2.5 w-2.5 text-white" />}
            </span>
            <span className="font-semibold text-blue-300">All Locations</span>
          </button>
          {LOCATIONS.map(loc => {
            const checked = !isAll && selected.includes(loc);
            return (
              <button key={loc} type="button" onClick={() => toggle(loc)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-left hover:bg-white/10 ${isAll ? "opacity-60" : ""}`}>
                <span className={`h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0 ${checked ? "bg-blue-500 border-blue-500" : "border-white/30"}`}>
                  {checked && <Check className="h-2.5 w-2.5 text-white" />}
                </span>
                <span className="text-slate-200">{loc}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Multi-select dropdown for User Type. Stored on the form as a string[] of
 * role codes. The first entry is treated as the primary role (drives RLS /
 * legacy access checks); the rest land in `extra_roles` on the profile row.
 *
 * Lays out exactly like BranchMultiSelect / BranchSingleSelect so the form
 * grid stays uniform — closed state is a single-line dropdown button.
 */
function RoleMultiSelect({
  values,
  options,
  onChange,
  placeholder,
}: {
  values: string[];
  options: { value: string; label: string }[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const labelByValue = useMemo(() => {
    const m: Record<string, string> = {};
    for (const o of options) m[o.value] = o.label;
    return m;
  }, [options]);
  const toggle = (val: string) => {
    onChange(values.includes(val) ? values.filter((v) => v !== val) : [...values, val]);
  };
  const summary = values.length
    ? `${values.length} selected: ${values.map((v) => labelByValue[v] || v).join(", ")}`
    : placeholder;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="glass-input w-full text-[11px] px-2 py-1 flex items-center justify-between text-left"
      >
        <span className={values.length ? "text-slate-100 truncate" : "text-slate-500"}>{summary}</span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-white/10 bg-slate-900 shadow-xl">
          {options.map((opt) => {
            const checked = values.includes(opt.value);
            const isPrimary = values[0] === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-left hover:bg-white/10"
              >
                <span className={`h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0 ${checked ? "bg-blue-500 border-blue-500" : "border-white/30"}`}>
                  {checked && <Check className="h-2.5 w-2.5 text-white" />}
                </span>
                <span className="text-slate-200 flex-1 truncate">{opt.label}</span>
                {isPrimary && (
                  <span className="text-[9px] font-semibold uppercase text-blue-300">primary</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Map a Supabase profile row to the table's UserManagementRecord shape.
// Row shape for the table: UserManagementRecord plus the Supabase profile id
// (needed for the delete action).
type UserRow = UserManagementRecord & { profileId: string };

function mapProfilesToRecords(profiles: ProfileRow[]): UserRow[] {
  return profiles.map((p, index) => ({
    profileId: p.id,
    id: String(index + 1), // sequential display id: 1, 2, 3...
    loginName: p.username || p.email.split("@")[0],
    userName: p.display_name || p.email,
    type: p.role,
    email: p.email,
    manager: p.manager_name || "",
    technicianId: p.technician_id || "",
    office: p.assigned_branch || "",
    locations: p.branch_access || "",
  }));
}

function UserLink({ moduleSlug, submoduleSlug, userId, children }: { moduleSlug: string; submoduleSlug: string; userId: string; children: React.ReactNode }) {
  return (
    <Link
      to="/m/$module/$submodule/$userId"
      params={{ module: moduleSlug, submodule: submoduleSlug, userId }}
      target="_blank"
      rel="noopener noreferrer"
      className="font-semibold text-blue-300 hover:text-blue-200 hover:underline"
    >
      {children}
    </Link>
  );
}

// ── Per-column funnel filter ──
// Mirrors the Ticket List / CSR Status Summary pattern: each column header
// gets a small funnel icon that opens a checkbox list of the distinct values
// present in the current dataset, with search-in-list and (Select All).
// The funnel turns blue when the filter is narrowing the view so it's easy
// to see at a glance which columns are filtered.
function ColumnFilter({
  field,
  label,
  options,
  selected,
  onChange,
}: {
  field: string;
  label: string;
  options: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const visible = useMemo(
    () => options.filter((o) => !search || o.toLowerCase().includes(search.toLowerCase())),
    [options, search],
  );
  // selected.size === 0 means "no filter applied" (all rows shown).
  // selected.has("__none__") means "explicitly empty" (no rows match).
  const allChecked = selected.size === 0 || selected.size === options.length;
  const active = (selected.size > 0 && selected.size < options.length) || selected.has("__none__");

  const toggle = (opt: string) => {
    const base = selected.size === 0 ? new Set(options) : new Set(selected);
    if (base.has(opt)) base.delete(opt);
    else base.add(opt);
    onChange(base.size === options.length ? new Set<string>() : base);
  };
  const toggleAll = () => {
    if (allChecked) onChange(new Set(["__none__"]));
    else onChange(new Set<string>());
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const el = document.getElementById(`umfilter-${field}`);
      if (el && !el.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, field]);

  return (
    <span id={`umfilter-${field}`} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={`ml-1 inline-grid h-4 w-4 place-items-center rounded ${active ? "text-blue-100" : "text-blue-300/60"} hover:text-white`}
        title={`Filter by ${label}`}
      >
        <Filter className="h-3 w-3" fill={active ? "currentColor" : "none"} />
      </button>
      {open && (
        <div className="absolute left-0 top-6 z-50 w-60 rounded-lg border border-white/15 bg-slate-900 shadow-2xl p-2 text-left normal-case">
          <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Filter by {label}
          </div>
          <div className="relative mb-1">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full rounded border border-white/15 bg-slate-800 pl-7 pr-2 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            <label className="flex items-center gap-2 px-1 py-1 text-xs text-white cursor-pointer hover:bg-white/5 rounded">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={toggleAll}
                className="accent-blue-500 h-3.5 w-3.5"
              />
              <span className="font-semibold">(Select All)</span>
            </label>
            {visible.map((opt) => {
              const checked = selected.size === 0 || selected.size === options.length || selected.has(opt);
              return (
                <label
                  key={opt}
                  className="flex items-center gap-2 px-1 py-1 text-xs text-slate-200 cursor-pointer hover:bg-white/5 rounded"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(opt)}
                    className="accent-blue-500 h-3.5 w-3.5"
                  />
                  <span className="truncate">{opt || "(blank)"}</span>
                </label>
              );
            })}
            {visible.length === 0 && (
              <div className="px-1 py-2 text-xs text-slate-500">No matches</div>
            )}
          </div>
        </div>
      )}
    </span>
  );
}

export function AdminUserManagementPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const auth = useAuth();
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [search, setSearch] = useState("");
  // Per-column funnel filters: { fieldName: Set<allowed values> }
  // Empty set or missing key = no filter on that column.
  // "__none__" sentinel = user toggled (Select All) off → hide everything.
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});
  const setColFilter = (field: string, next: Set<string>) =>
    setColFilters((prev) => ({ ...prev, [field]: next }));
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newUserForm, setNewUserForm] = useState<NewUserFormData>({
    loginName: "",
    userName: "",
    email: "",
    userType: "",
    userTypes: [],
    manager: "",
    technicianId: "",
    assignedBranch: "",
    branchAccess: "",
    poInitials: "",
    requiredCheckIn: "08:00",
    requiredCheckOut: "17:00",
    selectedOffDays: [5, 6], // Saturday and Sunday by default
  });

  // Load users from Supabase on mount (RLS scopes to the caller's company).
  // Supabase is now the source of truth — we read only from it.
  useEffect(() => {
    const loadUsers = async () => {
      if (!auth.companyId) {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const profiles = await getCompanyUsers();
        setUsers(mapProfilesToRecords(profiles));
      } catch (error) {
        console.error("❌ Error loading users:", error);
        alert(`Error loading users: ${error instanceof Error ? error.message : "Unknown error"}`);
      } finally {
        setLoading(false);
      }
    };
    loadUsers();
  }, [auth.companyId]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter((record) => {
      // Free-text search across the visible fields.
      if (query) {
        const blob = [record.id, record.loginName, record.userName, record.type, record.email, record.manager, record.technicianId, record.office, record.locations]
          .join(" ")
          .toLowerCase();
        if (!blob.includes(query)) return false;
      }
      // Per-column funnel filters (mirrors Ticket List behaviour).
      for (const [field, sel] of Object.entries(colFilters)) {
        if (!sel || sel.size === 0) continue; // no filter on this column
        if (sel.has("__none__")) return false; // explicitly hide everything
        const value = colValue(record, field);
        if (!sel.has(value)) return false;
      }
      return true;
    });
  }, [search, users, colFilters]);

  // Distinct values per column for the funnel dropdowns. Built from the
  // free-text-filtered set so column dropdowns shrink with the search.
  const columnOptions = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const field of UM_FILTERABLE_FIELDS) {
      map[field] = Array.from(
        new Set(users.map((r) => colValue(r, field)).filter(Boolean)),
      ).sort((a, b) => a.localeCompare(b));
    }
    return map;
  }, [users]);

  const managerGroups = useMemo(() => {
    const groups = new Map<string, UserManagementRecord[]>();
    filtered.forEach((record) => {
      const key = record.manager || "Unassigned";
      groups.set(key, [...(groups.get(key) ?? []), record]);
    });
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const handleAddUserFormChange = (field: keyof NewUserFormData, value: any) => {
    setNewUserForm((prev) => ({ ...prev, [field]: value }));
  };

  const toggleOffDay = (dayNum: number) => {
    setNewUserForm((prev) => ({
      ...prev,
      selectedOffDays: prev.selectedOffDays.includes(dayNum)
        ? prev.selectedOffDays.filter((d) => d !== dayNum)
        : [...prev.selectedOffDays, dayNum],
    }));
  };

  const handleDeleteUser = async (row: UserRow) => {
    if (!confirm(`Delete ${row.userName} (${row.email})? This removes their profile from the system.`)) {
      return;
    }
    try {
      await deleteCompanyUser(row.profileId);
      const profiles = await getCompanyUsers();
      setUsers(mapProfilesToRecords(profiles));
    } catch (error) {
      console.error("Delete error:", error);
      alert(`Error deleting user: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleCreateUser = async () => {
    // Validate required fields
    if (!newUserForm.loginName || !newUserForm.userName || !newUserForm.email || newUserForm.userTypes.length === 0 || !newUserForm.manager || !newUserForm.assignedBranch || !newUserForm.branchAccess) {
      alert("Please fill in all required fields.");
      return;
    }

    if (!auth.companyId || !auth.uid) {
      alert("Error: User not authenticated properly.");
      return;
    }

    try {
      // Pick the first ticked role as the primary; remaining go into extra_roles.
      const primaryRole = newUserForm.userTypes[0];
      const extraRoles = newUserForm.userTypes.slice(1);

      // Create user: Firebase Auth credential + Supabase profile (company-scoped)
      const newUid = await createCompanyUser({
        email: newUserForm.email,
        password: "Welcome2024!", // Default password
        displayName: newUserForm.userName,
        role: primaryRole as any,
        extraRoles: extraRoles as any,
        phoneNumber: "",
        department: "",
        managerName: newUserForm.manager,
        assignedBranch: newUserForm.assignedBranch,
        branchAccess: newUserForm.branchAccess,
        technicianId: newUserForm.technicianId,
        poInitials: newUserForm.poInitials,
        requiredCheckIn: newUserForm.requiredCheckIn,
        requiredCheckOut: newUserForm.requiredCheckOut,
      });

      // Save schedule / off-days / PO initials to localStorage (until employees domain is wired)
      localStorage.setItem(`requiredSchedule_${newUid}`, JSON.stringify({
        requiredCheckIn: newUserForm.requiredCheckIn,
        requiredCheckOut: newUserForm.requiredCheckOut,
      }));
      localStorage.setItem(`offDays_${newUid}`, JSON.stringify(newUserForm.selectedOffDays));
      if (newUserForm.poInitials) {
        localStorage.setItem(`poInitials_${newUid}`, newUserForm.poInitials);
      }

      alert(`User ${newUserForm.userName} created successfully!\nDefault password: Welcome2024!`);

      // Reload users from Supabase
      const profiles = await getCompanyUsers();
      setUsers(mapProfilesToRecords(profiles));

      // Reset form
      setNewUserForm({
        loginName: "",
        userName: "",
        email: "",
        userType: "",
        userTypes: [],
        manager: "",
        technicianId: "",
        assignedBranch: "",
        branchAccess: "",
        poInitials: "",
        requiredCheckIn: "08:00",
        requiredCheckOut: "17:00",
        selectedOffDays: [5, 6],
      });
      setShowAddUserModal(false);
    } catch (error: any) {
      console.error("Error creating user:", error);
      alert(`Error creating user: ${error.message || "Unknown error"}`);
    }
  };

  return (
    <main className="flex-1 bg-slate-950 py-6">
      <div className="max-w-[1500px] mx-auto px-6">
        {/* Back Button */}
        <Link 
          to="/m/$module" 
          params={{ module: mod.slug }}
          className="inline-flex items-center gap-2 text-slate-300 hover:text-white mb-4 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to {mod.label}
        </Link>
        
        <div className="rounded-xl border border-white/15 bg-white/8 p-5 text-white backdrop-blur-md">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-3xl font-bold tracking-tight">{sub.title}</h1>
              <p className="mt-1 text-sm text-slate-300">{sub.description}</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 rounded-full border border-white/15 bg-slate-900/80 p-1">
                {(["list", "hierarchy"] as ViewMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setViewMode(mode)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${viewMode === mode ? "bg-blue-500/30 text-white" : "text-slate-300 hover:text-white"}`}
                  >
                    {mode === "list" ? "List" : "Hierarchy"}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setShowAddUserModal(true)}
                className="btn btn-primary whitespace-nowrap"
              >
                + Add User
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-end gap-4">
            <div>
              <div className="text-2xl font-bold text-white">
                {loading ? "Loading..." : `${users.length} records found`}
              </div>
              <div className="text-sm text-slate-400">
                {loading ? "Fetching from database..." : "search in result"}
                {!loading && !auth.companyId && (
                  <span className="text-red-400 ml-2">⚠️ No company ID found</span>
                )}
              </div>
            </div>
            <div className="ml-auto w-full max-w-md">
              <label className="block text-xs font-semibold uppercase tracking-[0.04em] text-slate-400">Search</label>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by login name, user name, manager, email, office..."
                className="glass-input mt-2 w-full"
                disabled={loading}
              />
            </div>
          </div>
        </div>

        {viewMode === "list" ? (
          <div className="mt-5 overflow-x-auto rounded-xl border border-white/15 bg-white/8 backdrop-blur-md">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-900/90 text-blue-200">
                  <th className="px-4 py-3 text-left">
                    <span className="inline-flex items-center">ID
                      <ColumnFilter field="id" label="ID" options={columnOptions["id"] || []}
                        selected={colFilters["id"] || new Set()} onChange={(n) => setColFilter("id", n)} />
                    </span>
                  </th>
                  <th className="px-4 py-3 text-left">
                    <span className="inline-flex items-center">Login Name
                      <ColumnFilter field="loginName" label="Login Name" options={columnOptions["loginName"] || []}
                        selected={colFilters["loginName"] || new Set()} onChange={(n) => setColFilter("loginName", n)} />
                    </span>
                  </th>
                  <th className="px-4 py-3 text-left">
                    <span className="inline-flex items-center">User Name
                      <ColumnFilter field="userName" label="User Name" options={columnOptions["userName"] || []}
                        selected={colFilters["userName"] || new Set()} onChange={(n) => setColFilter("userName", n)} />
                    </span>
                  </th>
                  <th className="px-4 py-3 text-left">
                    <span className="inline-flex items-center">Type
                      <ColumnFilter field="type" label="Type" options={columnOptions["type"] || []}
                        selected={colFilters["type"] || new Set()} onChange={(n) => setColFilter("type", n)} />
                    </span>
                  </th>
                  <th className="px-4 py-3 text-left">
                    <span className="inline-flex items-center">Email
                      <ColumnFilter field="email" label="Email" options={columnOptions["email"] || []}
                        selected={colFilters["email"] || new Set()} onChange={(n) => setColFilter("email", n)} />
                    </span>
                  </th>
                  <th className="px-4 py-3 text-left">
                    <span className="inline-flex items-center">Manager
                      <ColumnFilter field="manager" label="Manager" options={columnOptions["manager"] || []}
                        selected={colFilters["manager"] || new Set()} onChange={(n) => setColFilter("manager", n)} />
                    </span>
                  </th>
                  <th className="px-4 py-3 text-left">
                    <span className="inline-flex items-center">Technician ID
                      <ColumnFilter field="technicianId" label="Technician ID" options={columnOptions["technicianId"] || []}
                        selected={colFilters["technicianId"] || new Set()} onChange={(n) => setColFilter("technicianId", n)} />
                    </span>
                  </th>
                  <th className="px-4 py-3 text-left">
                    <span className="inline-flex items-center">Assigned Branch
                      <ColumnFilter field="office" label="Assigned Branch" options={columnOptions["office"] || []}
                        selected={colFilters["office"] || new Set()} onChange={(n) => setColFilter("office", n)} />
                    </span>
                  </th>
                  <th className="px-4 py-3 text-left">Branch Access</th>
                  <th className="px-4 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 bg-slate-950/60 text-slate-200">
                {loading ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-slate-400">
                      Loading users...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-slate-400">
                      {users.length === 0 ? "No users found. Create your first user above." : "No records match that search."}
                    </td>
                  </tr>
                ) : (
                  filtered.map((record) => (
                    <tr key={`${record.id}-${record.loginName}`} className="hover:bg-white/5">
                      <td className="px-4 py-3 whitespace-nowrap">{record.id}</td>
                      <td className="px-4 py-3 whitespace-nowrap"><UserLink moduleSlug={mod.slug} submoduleSlug={sub.slug} userId={record.loginName}>{record.loginName}</UserLink></td>
                      <td className="px-4 py-3 whitespace-nowrap"><UserLink moduleSlug={mod.slug} submoduleSlug={sub.slug} userId={record.loginName}>{record.userName}</UserLink></td>
                      <td className="px-4 py-3 whitespace-nowrap">{record.type}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-300">{record.email || "—"}</td>
                      <td className="px-4 py-3 whitespace-nowrap"><UserLink moduleSlug={mod.slug} submoduleSlug={sub.slug} userId={record.manager || record.loginName}>{record.manager || "—"}</UserLink></td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-300">{record.technicianId || "—"}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-300">{record.office}</td>
                      <td className="px-4 py-3 text-slate-300">{record.locations}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleDeleteUser(record)}
                          className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs font-semibold text-red-300 hover:bg-red-500/20"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {managerGroups.map(([managerName, users]) => (
              <section key={managerName} className="rounded-xl border border-white/15 bg-white/8 p-4 text-white backdrop-blur-md">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold">{managerName}</div>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{users.length} direct reports</div>
                  </div>
                  <UserLink moduleSlug={mod.slug} submoduleSlug={sub.slug} userId={users[0]?.loginName ?? managerName}>
                    Open
                  </UserLink>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {users.map((record) => (
                    <UserLink key={record.loginName} moduleSlug={mod.slug} submoduleSlug={sub.slug} userId={record.loginName}>
                      {record.userName}
                    </UserLink>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {showAddUserModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6 backdrop-blur-sm">
          <div className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-white/15 bg-slate-950/95 shadow-2xl shadow-black/60">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-white/10 bg-slate-950/95 px-5 py-4 backdrop-blur-md">
              <div>
                <h2 className="text-2xl font-bold tracking-tight">Add New User</h2>
                <p className="mt-1 text-sm text-slate-300">Create a new user account (Default password: Welcome2024!)</p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <button type="button" onClick={() => setShowAddUserModal(false)} className="btn hover:bg-slate-800">Cancel</button>
                <button type="button" onClick={handleCreateUser} className="btn btn-primary">Create User</button>
              </div>
            </div>
            <div className="p-5 space-y-6">
              {/* Basic Information */}
              <div>
                <h3 className="text-sm font-semibold text-slate-300 mb-4">Basic Information</h3>
                <div className="grid gap-4 lg:grid-cols-2">
                  <label className="space-y-2 text-sm text-slate-200">
                    <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Login Name *</span>
                    <input 
                      placeholder="Enter login name" 
                      className="glass-input w-full text-[11px] px-2 py-1"
                      value={newUserForm.loginName}
                      onChange={(e) => handleAddUserFormChange("loginName", e.target.value)}
                    />
                  </label>
                  <label className="space-y-2 text-sm text-slate-200">
                    <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">User Name *</span>
                    <input 
                      placeholder="Enter user name" 
                      className="glass-input w-full text-[11px] px-2 py-1"
                      value={newUserForm.userName}
                      onChange={(e) => handleAddUserFormChange("userName", e.target.value)}
                    />
                  </label>
                  <label className="space-y-2 text-sm text-slate-200">
                    <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Email *</span>
                    <input 
                      type="email" 
                      placeholder="Enter email address" 
                      className="glass-input w-full text-[11px] px-2 py-1"
                      value={newUserForm.email}
                      onChange={(e) => handleAddUserFormChange("email", e.target.value)}
                    />
                  </label>
                  <label className="space-y-2 text-sm text-slate-200">
                    <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">User Type *</span>
                    <RoleMultiSelect
                      values={newUserForm.userTypes}
                      options={USER_TYPES}
                      placeholder="Select user type(s)"
                      onChange={(next) => setNewUserForm((prev) => ({
                        ...prev,
                        userTypes: next,
                        // Primary role stays in sync with the first ticked.
                        userType: next[0] || "",
                      }))}
                    />
                  </label>
                </div>
              </div>

              {/* Assignment Details */}
              <div>
                <h3 className="text-sm font-semibold text-slate-300 mb-4">Assignment Details</h3>
                <div className="grid gap-4 lg:grid-cols-2">
                  <label className="space-y-2 text-sm text-slate-200">
                    <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Manager *</span>
                    <select
                      className="glass-input w-full text-[11px] px-2 py-1"
                      value={newUserForm.manager}
                      onChange={(e) => handleAddUserFormChange("manager", e.target.value)}
                    >
                      <option value="">Assign manager</option>
                      <option>Aleena Hii</option>
                      <option>Daven Hodge</option>
                      <option>Ian Montesclaros</option>
                      <option>Jerich Leonard</option>
                      <option>Jonathon Allen</option>
                      <option>Justin Parker</option>
                      <option>Naveen Lakhani</option>
                      <option>Raul Bayuyos Jr</option>
                    </select>
                  </label>
                  <label className="space-y-2 text-sm text-slate-200">
                    <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Technician ID</span>
                    <input 
                      placeholder="Enter technician ID (optional)" 
                      className="glass-input w-full text-[11px] px-2 py-1"
                      value={newUserForm.technicianId}
                      onChange={(e) => handleAddUserFormChange("technicianId", e.target.value)}
                    />
                  </label>
                  <label className="space-y-2 text-sm text-slate-200">
                    <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Assigned Branch *</span>
                    <BranchSingleSelect
                      placeholder="Select branch office"
                      value={newUserForm.assignedBranch}
                      onChange={(v) => handleAddUserFormChange("assignedBranch", v)}
                    />
                  </label>
                  <label className="space-y-2 text-sm text-slate-200">
                    <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Branch Access *</span>
                    <BranchMultiSelect
                      placeholder="Select branch access"
                      value={newUserForm.branchAccess}
                      onChange={(v) => handleAddUserFormChange("branchAccess", v)}
                    />
                  </label>
                  <label className="space-y-2 text-sm text-slate-200">
                    <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">PO # Initial</span>
                    <input 
                      placeholder="Enter initials for purchase orders" 
                      className="glass-input w-full text-[11px] px-2 py-1"
                      value={newUserForm.poInitials}
                      onChange={(e) => handleAddUserFormChange("poInitials", e.target.value.toUpperCase())}
                      maxLength={5}
                    />
                  </label>
                </div>
              </div>

              {/* Required Schedule */}
              <div className="pt-4 border-t border-white/10">
                <h3 className="text-sm font-semibold text-slate-300 mb-4">Required Schedule</h3>
                <div className="grid gap-4 lg:grid-cols-2">
                  <label className="flex flex-col gap-2">
                    <span className="text-xs text-slate-400">Check-In Time</span>
                    <input
                      type="time"
                      value={newUserForm.requiredCheckIn}
                      onChange={(e) => handleAddUserFormChange("requiredCheckIn", e.target.value)}
                      className="px-3 py-2 bg-slate-700 border border-white/20 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-xs text-slate-400">Check-Out Time</span>
                    <input
                      type="time"
                      value={newUserForm.requiredCheckOut}
                      onChange={(e) => handleAddUserFormChange("requiredCheckOut", e.target.value)}
                      className="px-3 py-2 bg-slate-700 border border-white/20 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                    />
                  </label>
                </div>
              </div>

              {/* Days Off */}
              <div className="pt-4 border-t border-white/10">
                <h3 className="text-sm font-semibold text-slate-300 mb-4">Days Off</h3>
                <div className="grid grid-cols-7 gap-2 mb-4">
                  {DAYS_OF_WEEK.map((dayName, dayNum) => (
                    <button
                      key={dayNum}
                      type="button"
                      onClick={() => toggleOffDay(dayNum)}
                      className={`p-2 rounded border transition text-xs font-semibold flex flex-col items-center justify-center h-16 ${
                        newUserForm.selectedOffDays.includes(dayNum)
                          ? "bg-red-500/20 border-red-500/50 text-red-300"
                          : "bg-slate-700 border-white/10 text-slate-300 hover:border-white/30"
                      }`}
                    >
                      <span className="text-xs truncate">{dayName.slice(0, 3)}</span>
                      <span className="text-xs mt-1 opacity-75">{newUserForm.selectedOffDays.includes(dayNum) ? "OFF" : "WORK"}</span>
                    </button>
                  ))}
                </div>
                {newUserForm.selectedOffDays.length > 0 && (
                  <p className="text-xs text-blue-300">Selected: {newUserForm.selectedOffDays.map((d) => DAYS_OF_WEEK[d]).join(", ")}</p>
                )}
              </div>

              <div className="text-xs text-slate-400 pt-4 border-t border-white/10">
                <p className="mb-2"><span className="font-semibold">Note:</span> Fields marked with * are required.</p>
                <p className="mb-2">• User will be created with company ID: <span className="text-blue-300 font-mono">{auth.companyId || "N/A"}</span></p>
                <p className="mb-2">• Default password: <span className="text-blue-300 font-mono">Welcome2024!</span> (user should change on first login)</p>
                <p>• Username will be auto-generated from display name (FirstName.LastName format)</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
