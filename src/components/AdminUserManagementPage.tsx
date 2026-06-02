import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { USER_MANAGEMENT_RECORDS, type UserManagementRecord } from "@/lib/user-management";

type ViewMode = "list" | "hierarchy";

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
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [search, setSearch] = useState("");
  const [showAddUserModal, setShowAddUserModal] = useState(false);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return USER_MANAGEMENT_RECORDS;
    return USER_MANAGEMENT_RECORDS.filter((record) =>
      [record.id, record.loginName, record.userName, record.type, record.email, record.manager, record.technicianId, record.office, record.locations]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [search]);

  const managerGroups = useMemo(() => {
    const groups = new Map<string, UserManagementRecord[]>();
    filtered.forEach((record) => {
      const key = record.manager || "Unassigned";
      groups.set(key, [...(groups.get(key) ?? []), record]);
    });
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <main className="flex-1 bg-slate-950 py-6">
      <div className="max-w-[1500px] mx-auto px-6">
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
              <div className="text-2xl font-bold text-white">177 records found</div>
              <div className="text-sm text-slate-400">search in result</div>
            </div>
            <div className="ml-auto w-full max-w-md">
              <label className="block text-xs font-semibold uppercase tracking-[0.04em] text-slate-400">Search</label>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by login name, user name, manager, email, office..."
                className="glass-input mt-2 w-full"
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
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 bg-slate-950/60 text-slate-200">
                {filtered.map((record) => (
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
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-slate-400">No records match that search.</td>
                  </tr>
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
                <p className="mt-1 text-sm text-slate-300">Create a new user account (ID will be auto-generated)</p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <button type="button" onClick={() => setShowAddUserModal(false)} className="btn hover:bg-slate-800">Cancel</button>
                <button type="button" onClick={() => setShowAddUserModal(false)} className="btn btn-primary">Create User</button>
              </div>
            </div>
            <div className="p-5">
              <div className="grid gap-4 lg:grid-cols-2">
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Login Name *</span>
                  <input placeholder="Enter login name" className="glass-input w-full text-[11px] px-2 py-1" />
                </label>
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">User Name *</span>
                  <input placeholder="Enter user name" className="glass-input w-full text-[11px] px-2 py-1" />
                </label>
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Email *</span>
                  <input type="email" placeholder="Enter email address" className="glass-input w-full text-[11px] px-2 py-1" />
                </label>
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">User Type *</span>
                  <select className="glass-input w-full text-[11px] px-2 py-1">
                    <option value="">Select user type</option>
                    <option value="admin">Admin</option>
                    <option value="hr">HR</option>
                    <option value="manager">Manager</option>
                    <option value="technician">Technician</option>
                  </select>
                </label>
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Manager *</span>
                  <input placeholder="Assign manager" className="glass-input w-full text-[11px] px-2 py-1" />
                </label>
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Technician ID</span>
                  <input placeholder="Enter technician ID (optional)" className="glass-input w-full text-[11px] px-2 py-1" />
                </label>
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Assigned Branch *</span>
                  <input placeholder="Select branch office" className="glass-input w-full text-[11px] px-2 py-1" />
                </label>
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Branch Access *</span>
                  <input placeholder="Enter branch access (comma separated)" className="glass-input w-full text-[11px] px-2 py-1" />
                </label>
              </div>
              <div className="mt-4 text-xs text-slate-400">
                <span className="font-semibold">Note:</span> Fields marked with * are required. ID will be automatically generated upon creation.
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

