import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/superadmin")({
  component: SuperAdminDashboard,
});

interface AdminAccount {
  id: string;
  email: string;
  username: string;
  name: string;
  contactNumber: string;
  companyId: string;
  companyName: string;
  createdAt: string;
  status: "Active" | "Inactive";
}

const ADMIN_STORAGE_KEY = "ahs:superadmin:admins";

function loadAdmins(): AdminAccount[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(ADMIN_STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveAdmins(admins: AdminAccount[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(admins));
}

function SuperAdminDashboard() {
  const navigate = useNavigate();
  const { email, role, logout } = useAuth();
  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [isAddingAdmin, setIsAddingAdmin] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState<AdminAccount | null>(null);

  const [formData, setFormData] = useState({
    email: "",
    username: "",
    name: "",
    contactNumber: "",
    companyId: "",
    companyName: "",
  });

  const handleLogout = () => {
    if (confirm("Are you sure you want to logout?")) {
      logout();
      navigate({ to: "/landing" });
    }
  };

  useEffect(() => {
    // Check if user is superadmin
    if (role !== "superadmin") {
      navigate({ to: "/" });
      return;
    }
    setAdmins(loadAdmins());
  }, [role, navigate]);

  const handleAddAdmin = () => {
    if (!formData.email || !formData.username || !formData.name || !formData.companyId) {
      alert("Please fill in all required fields");
      return;
    }

    const newAdmin: AdminAccount = {
      id: crypto.randomUUID(),
      email: formData.email,
      username: formData.username,
      name: formData.name,
      contactNumber: formData.contactNumber,
      companyId: formData.companyId,
      companyName: formData.companyName,
      createdAt: new Date().toISOString(),
      status: "Active",
    };

    const updatedAdmins = [...admins, newAdmin];
    setAdmins(updatedAdmins);
    saveAdmins(updatedAdmins);
    resetForm();
    setIsAddingAdmin(false);
  };

  const handleUpdateAdmin = () => {
    if (!editingAdmin) return;

    const updatedAdmins = admins.map((admin) =>
      admin.id === editingAdmin.id
        ? {
            ...editingAdmin,
            email: formData.email,
            username: formData.username,
            name: formData.name,
            contactNumber: formData.contactNumber,
            companyId: formData.companyId,
            companyName: formData.companyName,
          }
        : admin
    );

    setAdmins(updatedAdmins);
    saveAdmins(updatedAdmins);
    resetForm();
    setEditingAdmin(null);
  };

  const handleDeleteAdmin = (id: string) => {
    if (!confirm("Are you sure you want to delete this admin account?")) return;

    const updatedAdmins = admins.filter((admin) => admin.id !== id);
    setAdmins(updatedAdmins);
    saveAdmins(updatedAdmins);
  };

  const handleToggleStatus = (id: string) => {
    const updatedAdmins = admins.map((admin) =>
      admin.id === id
        ? { ...admin, status: admin.status === "Active" ? "Inactive" : "Active" as "Active" | "Inactive" }
        : admin
    );
    setAdmins(updatedAdmins);
    saveAdmins(updatedAdmins);
  };

  const startEditAdmin = (admin: AdminAccount) => {
    setEditingAdmin(admin);
    setFormData({
      email: admin.email,
      username: admin.username,
      name: admin.name,
      contactNumber: admin.contactNumber,
      companyId: admin.companyId,
      companyName: admin.companyName,
    });
  };

  const resetForm = () => {
    setFormData({
      email: "",
      username: "",
      name: "",
      contactNumber: "",
      companyId: "",
      companyName: "",
    });
    setIsAddingAdmin(false);
    setEditingAdmin(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-4xl font-display font-bold tracking-tight text-white mb-2">
                SuperAdmin Dashboard
              </h1>
              <p className="text-lg text-slate-400">Manage company admin accounts</p>
            </div>
            <div className="text-right">
              <div className="text-sm text-slate-400">Logged in as</div>
              <div className="text-white font-semibold">{email}</div>
              <div className="flex items-center gap-2 mt-2">
                <div className="inline-block px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 text-xs font-semibold border border-purple-500/30">
                  SuperAdmin
                </div>
                <button
                  onClick={handleLogout}
                  className="px-4 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 text-xs font-semibold border border-red-500/30 transition-colors"
                >
                  Logout
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Add Admin Button */}
        <div className="mb-6">
          <button
            onClick={() => setIsAddingAdmin(true)}
            className="px-6 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors"
          >
            + Add New Admin
          </button>
        </div>

        {/* Add/Edit Admin Form */}
        {(isAddingAdmin || editingAdmin) && (
          <div className="mb-8 p-6 rounded-xl border border-white/15 bg-white/8 backdrop-blur-md">
            <h3 className="text-xl font-semibold text-white mb-4">
              {editingAdmin ? "Edit Admin Account" : "Add New Admin Account"}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">
                  Email *
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                  placeholder="admin@company.com"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">
                  Username *
                </label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                  placeholder="johndoe"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">
                  Full Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                  placeholder="John Doe"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">
                  Contact Number
                </label>
                <input
                  type="tel"
                  value={formData.contactNumber}
                  onChange={(e) => setFormData({ ...formData, contactNumber: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                  placeholder="+1 (555) 123-4567"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">
                  Company ID *
                </label>
                <input
                  type="text"
                  value={formData.companyId}
                  onChange={(e) => setFormData({ ...formData, companyId: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                  placeholder="COMP-001"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">
                  Company Name
                </label>
                <input
                  type="text"
                  value={formData.companyName}
                  onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                  placeholder="Acme Corporation"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={editingAdmin ? handleUpdateAdmin : handleAddAdmin}
                className="px-6 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold transition-colors"
              >
                {editingAdmin ? "Update Admin" : "Create Admin"}
              </button>
              <button
                onClick={resetForm}
                className="px-6 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-semibold transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Admins List */}
        <div className="rounded-xl border border-white/15 bg-white/8 backdrop-blur-md overflow-hidden">
          <div className="px-6 py-4 border-b border-white/10">
            <h2 className="text-xl font-semibold text-white">
              Admin Accounts ({admins.length})
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-blue-900/30 border-b border-white/10">
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Email</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Username</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Name</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Contact</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Company ID</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Company Name</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Created</th>
                  <th className="px-4 py-3 text-center font-semibold text-blue-300">Actions</th>
                </tr>
              </thead>
              <tbody>
                {admins.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                      No admin accounts created yet. Click "Add New Admin" to get started.
                    </td>
                  </tr>
                ) : (
                  admins.map((admin) => (
                    <tr key={admin.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="px-4 py-3 text-slate-300">{admin.email}</td>
                      <td className="px-4 py-3 text-slate-300 font-mono">{admin.username}</td>
                      <td className="px-4 py-3 text-white font-semibold">{admin.name}</td>
                      <td className="px-4 py-3 text-slate-300">{admin.contactNumber || "—"}</td>
                      <td className="px-4 py-3 text-slate-300 font-mono">{admin.companyId}</td>
                      <td className="px-4 py-3 text-slate-300">{admin.companyName || "—"}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleToggleStatus(admin.id)}
                          className={`px-3 py-1 rounded-full text-xs font-semibold ${
                            admin.status === "Active"
                              ? "bg-green-500/20 text-green-300 border border-green-500/30"
                              : "bg-red-500/20 text-red-300 border border-red-500/30"
                          }`}
                        >
                          {admin.status}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">
                        {new Date(admin.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => startEditAdmin(admin)}
                            className="px-3 py-1 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 text-xs font-semibold transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteAdmin(admin.id)}
                            className="px-3 py-1 rounded bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 text-xs font-semibold transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
