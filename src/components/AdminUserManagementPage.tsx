import { useMemo, useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { type UserManagementRecord } from "@/lib/user-management";
import { useAuth } from "@/lib/auth";
import { createCompanyUser, getCompanyUsers, deleteCompanyUser, type ProfileRow } from "@/lib/supabase/users";

type ViewMode = "list" | "hierarchy";

interface NewUserFormData {
  loginName: string;
  userName: string;
  email: string;
  userType: string;
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

export function AdminUserManagementPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const auth = useAuth();
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [search, setSearch] = useState("");
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newUserForm, setNewUserForm] = useState<NewUserFormData>({
    loginName: "",
    userName: "",
    email: "",
    userType: "",
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
    if (!query) return users;
    return users.filter((record) =>
      [record.id, record.loginName, record.userName, record.type, record.email, record.manager, record.technicianId, record.office, record.locations]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [search, users]);

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
    if (!newUserForm.loginName || !newUserForm.userName || !newUserForm.email || !newUserForm.userType || !newUserForm.manager || !newUserForm.assignedBranch || !newUserForm.branchAccess) {
      alert("Please fill in all required fields.");
      return;
    }

    if (!auth.companyId || !auth.uid) {
      alert("Error: User not authenticated properly.");
      return;
    }

    try {
      // Create user: Firebase Auth credential + Supabase profile (company-scoped)
      const newUid = await createCompanyUser({
        email: newUserForm.email,
        password: "Welcome2024!", // Default password
        displayName: newUserForm.userName,
        role: newUserForm.userType as any,
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
                  <th className="px-4 py-3 text-left">ID</th>
                  <th className="px-4 py-3 text-left">Login Name</th>
                  <th className="px-4 py-3 text-left">User Name</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Email</th>
                  <th className="px-4 py-3 text-left">Manager</th>
                  <th className="px-4 py-3 text-left">Technician ID</th>
                  <th className="px-4 py-3 text-left">Assigned Branch</th>
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
                    <select 
                      className="glass-input w-full text-[11px] px-2 py-1"
                      value={newUserForm.userType}
                      onChange={(e) => handleAddUserFormChange("userType", e.target.value)}
                    >
                      <option value="">Select user type</option>
                      <option value="ADMIN">Admin</option>
                      <option value="MANAGER">Manager</option>
                      <option value="CSR">CSR</option>
                      <option value="TECHNICIAN">Technician</option>
                      <option value="CLAIMS">Claims</option>
                      <option value="HR">HR</option>
                      <option value="IT">IT</option>
                      <option value="PARTS">Parts</option>
                      <option value="FINANCE">Finance</option>
                    </select>
                  </label>
                </div>
              </div>

              {/* Assignment Details */}
              <div>
                <h3 className="text-sm font-semibold text-slate-300 mb-4">Assignment Details</h3>
                <div className="grid gap-4 lg:grid-cols-2">
                  <label className="space-y-2 text-sm text-slate-200">
                    <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Manager *</span>
                    <input 
                      placeholder="Assign manager" 
                      className="glass-input w-full text-[11px] px-2 py-1"
                      value={newUserForm.manager}
                      onChange={(e) => handleAddUserFormChange("manager", e.target.value)}
                    />
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
                    <input 
                      placeholder="Select branch office" 
                      className="glass-input w-full text-[11px] px-2 py-1"
                      value={newUserForm.assignedBranch}
                      onChange={(e) => handleAddUserFormChange("assignedBranch", e.target.value)}
                    />
                  </label>
                  <label className="space-y-2 text-sm text-slate-200">
                    <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Branch Access *</span>
                    <input 
                      placeholder="Enter branch access (comma separated)" 
                      className="glass-input w-full text-[11px] px-2 py-1"
                      value={newUserForm.branchAccess}
                      onChange={(e) => handleAddUserFormChange("branchAccess", e.target.value)}
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

