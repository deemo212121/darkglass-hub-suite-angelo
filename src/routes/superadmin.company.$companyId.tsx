import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import {
  getAllUsers,
  getAllCompanies,
  updateUserAccount,
  deactivateUserAccount,
  activateUserAccount,
  updateCompany,
  type UserAccount,
  type Company,
  type UserRole,
} from "@/lib/firebase/users";
import { setCompanyActiveStatus, getSupabaseCompanyLoginAlias, updateCompanyDetails } from "@/lib/supabase/companies";
import { getMyProfileId, updateCompanyUser } from "@/lib/supabase/users";

export const Route = createFileRoute("/superadmin/company/$companyId")({
  component: CompanyDetailPage,
});

// Same country-code list as the main /superadmin page (phone editing on an
// existing admin needs it too).
const countryCodes = [
  { code: "+1", flag: "🇺🇸", country: "US" },
  { code: "+1", flag: "🇨🇦", country: "CA" },
  { code: "+63", flag: "🇵🇭", country: "PH" },
  { code: "+44", flag: "🇬🇧", country: "UK" },
  { code: "+61", flag: "🇦🇺", country: "AU" },
  { code: "+81", flag: "🇯🇵", country: "JP" },
  { code: "+82", flag: "🇰🇷", country: "KR" },
  { code: "+86", flag: "🇨🇳", country: "CN" },
  { code: "+91", flag: "🇮🇳", country: "IN" },
  { code: "+49", flag: "🇩🇪", country: "DE" },
  { code: "+33", flag: "🇫🇷", country: "FR" },
  { code: "+39", flag: "🇮🇹", country: "IT" },
  { code: "+34", flag: "🇪🇸", country: "ES" },
  { code: "+52", flag: "🇲🇽", country: "MX" },
  { code: "+55", flag: "🇧🇷", country: "BR" },
  { code: "+7", flag: "🇷🇺", country: "RU" },
];

function CompanyDetailPage() {
  const { companyId } = Route.useParams();
  const navigate = useNavigate();
  const { ready, role } = useAuth();

  const [company, setCompany] = useState<Company | null>(null);
  const [loginAlias, setLoginAlias] = useState<string | null>(null);
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingAdmin, setEditingAdmin] = useState<UserAccount | null>(null);
  const [editingCompanyInfo, setEditingCompanyInfo] = useState(false);
  const [companyForm, setCompanyForm] = useState({
    companyName: "",
    email: "",
    phoneNumber: "",
    address: "",
    city: "",
    state: "",
    zipCode: "",
    subscriptionPlan: "basic" as "basic" | "professional" | "enterprise",
    loginAlias: "",
  });
  const [editForm, setEditForm] = useState({
    displayName: "",
    phoneNumber: "",
    phoneCountry: "+1",
    userType: "ADMIN" as UserRole,
  });

  useEffect(() => {
    // Wait for auth to actually resolve before deciding — this page is
    // always opened in a brand-new tab (target="_blank" from the main
    // /superadmin page), so on first mount `role` is still null until
    // Firebase/Supabase finish resolving. Deciding too early (this used to
    // run once on mount regardless) bounced a real SUPERSUPERADMIN straight
    // back out before their role ever loaded.
    if (!ready) return;
    if (role?.toUpperCase() !== "SUPERSUPERADMIN") {
      navigate({ to: "/" });
      return;
    }
    loadData();
  }, [ready, role]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [allUsers, allCompanies, alias] = await Promise.all([
        getAllUsers(),
        getAllCompanies(),
        getSupabaseCompanyLoginAlias(companyId),
      ]);
      setUsers(allUsers);
      setCompany(allCompanies.find((c) => c.companyId === companyId) ?? null);
      setLoginAlias(alias);
    } catch (err: any) {
      console.error("Error loading company data:", err);
      setError(err.message || "Failed to load company data");
    } finally {
      setLoading(false);
    }
  };

  const startEditCompanyInfo = () => {
    if (!company) return;
    setCompanyForm({
      companyName: company.companyName,
      email: company.email || "",
      phoneNumber: company.phoneNumber || "",
      address: company.address || "",
      city: company.city || "",
      state: company.state || "",
      zipCode: company.zipCode || "",
      subscriptionPlan: company.subscriptionPlan || "basic",
      loginAlias: loginAlias || "",
    });
    setEditingCompanyInfo(true);
  };

  const handleSaveCompanyInfo = async () => {
    if (!company) return;
    if (companyForm.loginAlias && !/^[A-Z0-9]+$/.test(companyForm.loginAlias)) {
      setError("Login Company ID must contain only letters and numbers (no spaces or special characters)");
      return;
    }
    try {
      setError(null);
      await updateCompany(company.companyId, {
        companyName: companyForm.companyName,
        email: companyForm.email,
        phoneNumber: companyForm.phoneNumber,
        address: companyForm.address,
        city: companyForm.city,
        state: companyForm.state,
        zipCode: companyForm.zipCode,
        subscriptionPlan: companyForm.subscriptionPlan,
      });
      await updateCompanyDetails(company.companyId, {
        companyName: companyForm.companyName,
        email: companyForm.email,
        phoneNumber: companyForm.phoneNumber,
        address: companyForm.address,
        city: companyForm.city,
        state: companyForm.state,
        zipCode: companyForm.zipCode,
        subscriptionPlan: companyForm.subscriptionPlan,
        loginAlias: companyForm.loginAlias || null,
      });
      setSuccess("✅ Company details updated");
      setTimeout(() => setSuccess(null), 5000);
      setEditingCompanyInfo(false);
      loadData();
    } catch (err: any) {
      console.error("Error updating company details:", err);
      setError(err.message || "Failed to update company details");
    }
  };

  const accounts = useMemo(
    () => users.filter((u) => u.companyId === companyId && u.role !== "SUPERSUPERADMIN"),
    [users, companyId]
  );

  const handleToggleCompanyStatus = async () => {
    if (!company) return;
    const verb = company.isActive ? "freeze" : "unfreeze";
    if (!confirm(`Are you sure you want to ${verb} ${company.companyName}? ${company.isActive ? "This will sign out and block every one of its users." : ""}`)) return;
    try {
      setError(null);
      await updateCompany(company.companyId, { isActive: !company.isActive });
      await setCompanyActiveStatus(company.companyId, !company.isActive);
      setSuccess(`✅ ${company.companyName} has been ${company.isActive ? "frozen" : "unfrozen"}`);
      setTimeout(() => setSuccess(null), 5000);
      loadData();
    } catch (err: any) {
      console.error("Error toggling company status:", err);
      setError(err.message || "Failed to update company status");
    }
  };

  const startEditAdmin = (user: UserAccount) => {
    setEditingAdmin(user);
    setEditForm({
      displayName: user.displayName,
      phoneNumber: user.phoneNumber || "",
      phoneCountry: "+1",
      userType: user.role,
    });
  };

  const handleUpdateAdmin = async () => {
    if (!editingAdmin) return;
    try {
      setError(null);
      const fullPhoneNumber = editForm.phoneNumber ? `${editForm.phoneCountry} ${editForm.phoneNumber}` : "";

      await updateUserAccount(editingAdmin.uid, {
        displayName: editForm.displayName,
        phoneNumber: fullPhoneNumber,
        role: editForm.userType,
        isActive: editingAdmin.isActive,
      });

      // Also sync to Supabase — RLS and everything else in the app reads
      // profiles.role, not the Firestore doc above.
      try {
        const profileId = await getMyProfileId(editingAdmin.uid);
        if (profileId) {
          await updateCompanyUser(profileId, {
            displayName: editForm.displayName,
            phoneNumber: fullPhoneNumber,
            role: editForm.userType as any,
            isActive: editingAdmin.isActive,
          });
        } else {
          console.warn(`No Supabase profile found for ${editingAdmin.uid} — role change only applied in Firebase.`);
        }
      } catch (supabaseErr) {
        console.error("Error syncing admin update to Supabase:", supabaseErr);
      }

      setSuccess("✅ Admin updated successfully");
      setTimeout(() => setSuccess(null), 5000);
      setEditingAdmin(null);
      loadData();
    } catch (err: any) {
      console.error("Error updating admin:", err);
      setError(err.message || "Failed to update admin");
    }
  };

  const handleToggleAdminStatus = async (user: UserAccount) => {
    try {
      setError(null);
      if (user.isActive) {
        if (!confirm(`Are you sure you want to deactivate ${user.displayName}?`)) return;
        await deactivateUserAccount(user.uid);
        setSuccess(`✅ ${user.displayName} has been deactivated`);
      } else {
        await activateUserAccount(user.uid);
        setSuccess(`✅ ${user.displayName} has been activated`);
      }
      setTimeout(() => setSuccess(null), 5000);
      loadData();
    } catch (err: any) {
      console.error("Error toggling user status:", err);
      setError(err.message || "Failed to update user status");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="text-white text-xl">Company '{companyId}' not found.</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <Link to="/superadmin" className="text-sm text-slate-400 hover:text-white">
          ← Back to Companies
        </Link>

        {error && (
          <div className="mt-6 p-4 rounded-lg bg-red-500/20 border border-red-500/30 text-red-300">{error}</div>
        )}
        {success && (
          <div className="mt-6 p-4 rounded-lg bg-green-500/20 border border-green-500/30 text-green-300">{success}</div>
        )}

        {/* Company details — editable via the modal below (Edit button). */}
        <div className="mt-6 rounded-xl border border-white/15 bg-white/8 backdrop-blur-md p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-white">{company.companyName}</h1>
              <p className="text-slate-400 font-mono text-sm mt-1">{company.companyId}</p>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`px-3 py-1 rounded-full text-xs font-semibold ${
                  company.isActive
                    ? "bg-green-500/20 text-green-300 border border-green-500/30"
                    : "bg-red-500/20 text-red-300 border border-red-500/30"
                }`}
              >
                {company.isActive ? "Active" : "Frozen"}
              </span>
              <button
                onClick={startEditCompanyInfo}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors"
              >
                Edit
              </button>
              <button
                onClick={handleToggleCompanyStatus}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  company.isActive
                    ? "bg-red-600 hover:bg-red-700 text-white"
                    : "bg-green-600 hover:bg-green-700 text-white"
                }`}
              >
                {company.isActive ? "Freeze Company" : "Unfreeze Company"}
              </button>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-slate-500 text-xs uppercase">Email</div>
              <div className="text-slate-200">{company.email || "—"}</div>
            </div>
            <div>
              <div className="text-slate-500 text-xs uppercase">Phone</div>
              <div className="text-slate-200">{company.phoneNumber || "—"}</div>
            </div>
            <div>
              <div className="text-slate-500 text-xs uppercase">Plan</div>
              <div className="text-slate-200 capitalize">{company.subscriptionPlan || "—"}</div>
            </div>
            <div>
              <div className="text-slate-500 text-xs uppercase">Address</div>
              <div className="text-slate-200">{company.address || "—"}</div>
            </div>
            <div>
              <div className="text-slate-500 text-xs uppercase">City</div>
              <div className="text-slate-200">{company.city || "—"}</div>
            </div>
            <div>
              <div className="text-slate-500 text-xs uppercase">State</div>
              <div className="text-slate-200">{company.state || "—"}</div>
            </div>
            <div>
              <div className="text-slate-500 text-xs uppercase">Login Company ID</div>
              <div className="text-slate-200 font-mono">
                {loginAlias || <span className="text-slate-500 font-sans italic">Not set — employees use {company.companyId} above</span>}
              </div>
            </div>
          </div>
        </div>

        {/* Account list — this company's own accounts, still editable/deactivatable here. */}
        <div className="mt-8 rounded-xl border border-white/15 bg-white/8 backdrop-blur-md overflow-hidden">
          <div className="px-6 py-4 border-b border-white/10">
            <h2 className="text-xl font-semibold text-white">Accounts ({accounts.length})</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-blue-900/30 border-b border-white/10">
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Email</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Name</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Role</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Contact</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Status</th>
                  <th className="px-4 py-3 text-center font-semibold text-blue-300">Actions</th>
                </tr>
              </thead>
              <tbody>
                {accounts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                      No accounts for this company yet.
                    </td>
                  </tr>
                ) : (
                  accounts.map((admin) => (
                    <tr key={admin.uid} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="px-4 py-3 text-slate-300">{admin.email}</td>
                      <td className="px-4 py-3 text-white font-semibold">{admin.displayName}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 rounded bg-blue-500/20 text-blue-300 text-xs font-semibold border border-blue-500/30">
                          {admin.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-300">{admin.phoneNumber || "—"}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-semibold ${
                            admin.isActive
                              ? "bg-green-500/20 text-green-300 border border-green-500/30"
                              : "bg-red-500/20 text-red-300 border border-red-500/30"
                          }`}
                        >
                          {admin.isActive ? "Active" : "Inactive"}
                        </span>
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
                            onClick={() => handleToggleAdminStatus(admin)}
                            className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                              admin.isActive
                                ? "bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30"
                                : "bg-green-500/20 text-green-300 border border-green-500/30 hover:bg-green-500/30"
                            }`}
                          >
                            {admin.isActive ? "Deactivate" : "Activate"}
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

      {/* Edit Company Info modal */}
      {editingCompanyInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/15 bg-slate-900 p-6 text-white shadow-2xl">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
              <h4 className="text-xl font-bold text-white">Edit Company</h4>
              <button
                type="button"
                onClick={() => setEditingCompanyInfo(false)}
                className="rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-200/40"
              >
                Close
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">Company ID (read-only)</label>
                <div className="w-full px-4 py-2 rounded-lg bg-slate-900/50 border border-white/10 text-slate-400 font-mono">
                  {company.companyId}
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">Company Name *</label>
                <input
                  type="text"
                  value={companyForm.companyName}
                  onChange={(e) => setCompanyForm({ ...companyForm, companyName: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">Email</label>
                <input
                  type="email"
                  value={companyForm.email}
                  onChange={(e) => setCompanyForm({ ...companyForm, email: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">Phone Number</label>
                <input
                  type="tel"
                  value={companyForm.phoneNumber}
                  onChange={(e) => setCompanyForm({ ...companyForm, phoneNumber: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">Address</label>
                <input
                  type="text"
                  value={companyForm.address}
                  onChange={(e) => setCompanyForm({ ...companyForm, address: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">City</label>
                <input
                  type="text"
                  value={companyForm.city}
                  onChange={(e) => setCompanyForm({ ...companyForm, city: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">State</label>
                <input
                  type="text"
                  value={companyForm.state}
                  onChange={(e) => setCompanyForm({ ...companyForm, state: e.target.value.toUpperCase() })}
                  maxLength={2}
                  className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">ZIP Code</label>
                <input
                  type="text"
                  value={companyForm.zipCode}
                  onChange={(e) => setCompanyForm({ ...companyForm, zipCode: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">Subscription Plan</label>
                <select
                  value={companyForm.subscriptionPlan}
                  onChange={(e) => setCompanyForm({ ...companyForm, subscriptionPlan: e.target.value as "basic" | "professional" | "enterprise" })}
                  className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="basic">Basic</option>
                  <option value="professional">Professional</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">
                  Login Company ID <span className="normal-case text-[10px] text-slate-500">(optional — once set, REPLACES the Company ID above for login)</span>
                </label>
                <input
                  type="text"
                  value={companyForm.loginAlias}
                  onChange={(e) => setCompanyForm({ ...companyForm, loginAlias: e.target.value.toUpperCase() })}
                  className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500 font-mono"
                  maxLength={20}
                />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={handleSaveCompanyInfo}
                className="px-6 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold transition-colors"
              >
                Save Changes
              </button>
              <button
                onClick={() => setEditingCompanyInfo(false)}
                className="px-6 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-semibold transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Admin Account modal */}
      {editingAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/15 bg-slate-900 p-6 text-white shadow-2xl">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
              <h4 className="text-xl font-bold text-white">Edit Admin Account</h4>
              <button
                type="button"
                onClick={() => setEditingAdmin(null)}
                className="rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-200/40"
              >
                Close
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">Email</label>
                <div className="w-full px-4 py-2 rounded-lg bg-slate-900/50 border border-white/10 text-slate-400">
                  {editingAdmin.email}
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">Full Name *</label>
                <input
                  type="text"
                  value={editForm.displayName}
                  onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                  placeholder="John Doe"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">Phone Number</label>
                <div className="flex gap-2">
                  <select
                    value={editForm.phoneCountry}
                    onChange={(e) => setEditForm({ ...editForm, phoneCountry: e.target.value })}
                    className="px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                    style={{ minWidth: "80px" }}
                  >
                    {countryCodes.map((item, idx) => (
                      <option key={`${item.code}-${idx}`} value={item.code}>
                        {item.flag} {item.code}
                      </option>
                    ))}
                  </select>
                  <input
                    type="tel"
                    value={editForm.phoneNumber}
                    onChange={(e) => setEditForm({ ...editForm, phoneNumber: e.target.value })}
                    className="flex-1 px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                    placeholder="123-456-7890"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">User Type *</label>
                <select
                  value={editForm.userType}
                  onChange={(e) => setEditForm({ ...editForm, userType: e.target.value as UserRole })}
                  className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="SUPERADMIN">SuperAdmin (this company only)</option>
                  <option value="ADMIN">Admin</option>
                  <option value="MANAGER">Manager</option>
                  <option value="CSR">CSR (Customer Service)</option>
                  <option value="TECHNICIAN">Technician</option>
                  <option value="DISPATCHER">Dispatcher</option>
                  <option value="HR">HR (Human Resources)</option>
                  <option value="IT">IT Support</option>
                  <option value="PARTS">Parts Management</option>
                  <option value="FINANCE">Finance</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">Company (read-only)</label>
                <div className="w-full px-4 py-2 rounded-lg bg-slate-900/50 border border-white/10 text-slate-400">
                  {company.companyName} ({company.companyId})
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={handleUpdateAdmin}
                className="px-6 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold transition-colors"
              >
                Update Admin
              </button>
              <button
                onClick={() => setEditingAdmin(null)}
                className="px-6 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-semibold transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
