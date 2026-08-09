import { createFileRoute, useNavigate, useLocation, Link, Outlet } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import {
  createUserAccount,
  getAllUsers,
  getAllCompanies,
  createCompany,
  updateCompany,
  type UserAccount,
  type Company,
  type UserRole,
} from "@/lib/firebase/users";
import { getCurrentUser } from "@/lib/firebase/auth";
import {
  createSupabaseCompany,
  getSupabaseCompanyLoginAlias,
  updateSupabaseCompanyLoginAlias,
  setCompanyActiveStatus,
} from "@/lib/supabase/companies";
import { createSupabaseAdminProfile } from "@/lib/supabase/users";

export const Route = createFileRoute("/superadmin")({
  component: SuperAdminDashboard,
});

function SuperAdminDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { ready, email, role, logout } = useAuth();
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddingAdmin, setIsAddingAdmin] = useState(false);
  const [isAddingCompany, setIsAddingCompany] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [syncingUsernames, setSyncingUsernames] = useState(false);

  const [newAdminForm, setNewAdminForm] = useState({
    email: "",
    password: "",
    displayName: "",
    phoneNumber: "",
    phoneCountry: "+1", // Default to US
    userType: "ADMIN" as UserRole,
    companyId: "",
  });

  const [newCompanyForm, setNewCompanyForm] = useState({
    companyId: "",
    companyName: "",
    address: "",
    city: "",
    state: "",
    zipCode: "",
    phoneNumber: "",
    phoneCountry: "+1", // Default to US
    email: "",
    subscriptionPlan: "professional" as "basic" | "professional" | "enterprise",
    loginAlias: "",
  });

  // Common country codes with flags
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

  const handleLogout = async () => {
    if (confirm("Are you sure you want to logout?")) {
      try {
        // logout() itself navigates to /landing (a full reload, not a
        // router transition) once sign-out settles — see auth.tsx.
        await logout();
      } catch (error) {
        console.error("Logout error:", error);
      }
    }
  };

  useEffect(() => {
    // The child route (/superadmin/company/$companyId) owns its own guard
    // and its own data loading entirely — this effect (hooks always run
    // regardless of which JSX branch the component ends up returning, so
    // this can't just be skipped by the `<Outlet />` check below) must stay
    // out of its way completely. Without this, this effect's own
    // navigate({ to: "/" }) / loadData() still fire in the background on
    // every visit to the child page too, and the two components' guards
    // racing each other in an unpredictable order could bounce a real
    // SUPERSUPERADMIN off the child page before it ever got to render.
    if (location.pathname.startsWith("/superadmin/company/")) return;
    // Wait for auth to actually resolve before deciding — on a fresh mount
    // (hard refresh, or a new tab) `role` is still null until Firebase/
    // Supabase finish resolving. Deciding too early (this used to run once
    // on mount regardless of `ready`) could bounce a real SUPERSUPERADMIN
    // out before their role ever loaded.
    if (!ready) return;
    // This console is exclusive to the platform-level SUPERSUPERADMIN role
    // (case-insensitive) — the per-company SUPERADMIN role does NOT get in
    // here, same as a regular ADMIN wouldn't.
    const userRole = role?.toUpperCase();
    if (userRole !== "SUPERSUPERADMIN") {
      console.log(`Access denied. User role: ${role}, required: SUPERSUPERADMIN`);
      navigate({ to: "/" });
      return;
    }
    console.log("SuperSuperAdmin access granted");
    loadData();
  }, [ready, role, location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      console.log("Loading users and companies from Firebase...");
      
      const [allUsers, allCompanies] = await Promise.all([
        getAllUsers(),
        getAllCompanies(),
      ]);
      
      console.log(`Loaded ${allUsers.length} users and ${allCompanies.length} companies`);
      
      setUsers(allUsers);
      setCompanies(allCompanies);
    } catch (err: any) {
      console.error("Error loading data:", err);
      setError(`Failed to load data from Firebase: ${err.message || "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  };

  // Filter to show every admin EXCEPT the platform-level SUPERSUPERADMIN
  // tier — the new per-company SUPERADMIN accounts are real company admins
  // and should show up here like any other admin.
  const adminUsers = useMemo(() => {
    return users.filter((user) => user.role !== "SUPERSUPERADMIN");
  }, [users]);

  // /superadmin/company/$companyId is a CHILD route of /superadmin (see
  // routeTree.gen.ts's parentRoute), so this component needs to explicitly
  // defer to it via <Outlet /> — same pattern as m.$module.$submodule.tsx's
  // hasNestedUserRoute. Placed after every hook above (Rules of Hooks) but
  // before the loading/data-fetch-driven JSX below, so navigating to the
  // company detail page doesn't first flash this page's own "Loading..." state.
  if (location.pathname.startsWith("/superadmin/company/")) {
    return <Outlet />;
  }

  const getCompanyName = (companyId: string): string => {
    const company = companies.find((c) => c.companyId === companyId);
    return company?.companyName || "Unknown";
  };

  const handleCreateCompany = async () => {
    try {
      setError(null);
      
      if (!newCompanyForm.companyId || !newCompanyForm.companyName || !newCompanyForm.address || 
          !newCompanyForm.city || !newCompanyForm.state || !newCompanyForm.zipCode || 
          !newCompanyForm.phoneNumber || !newCompanyForm.email) {
        setError("Please fill in all required fields for the company");
        return;
      }

      // Validate company ID format (alphanumeric, no spaces)
      if (!/^[A-Z0-9]+$/.test(newCompanyForm.companyId)) {
        setError("Company ID must contain only letters and numbers (no spaces or special characters)");
        return;
      }

      // Login alias is optional, but if set must follow the same format rule.
      if (newCompanyForm.loginAlias && !/^[A-Z0-9]+$/.test(newCompanyForm.loginAlias)) {
        setError("Login Company ID must contain only letters and numbers (no spaces or special characters)");
        return;
      }

      // Check if company ID already exists
      const existingCompany = companies.find(c => c.companyId === newCompanyForm.companyId);
      if (existingCompany) {
        setError(`Company ID '${newCompanyForm.companyId}' already exists. Please use a different ID.`);
        return;
      }

      const authUser = getCurrentUser();
      if (!authUser) {
        setError("Not authenticated");
        return;
      }
      
      // Combine country code with phone number
      const fullPhoneNumber = `${newCompanyForm.phoneCountry} ${newCompanyForm.phoneNumber}`;
      
      await createCompany(
        {
          companyId: newCompanyForm.companyId,
          companyName: newCompanyForm.companyName,
          address: newCompanyForm.address,
          city: newCompanyForm.city,
          state: newCompanyForm.state,
          zipCode: newCompanyForm.zipCode,
          phoneNumber: fullPhoneNumber,
          email: newCompanyForm.email,
          subscriptionPlan: newCompanyForm.subscriptionPlan,
          isActive: true,
        },
        authUser.uid
      );

      // Also create the matching Supabase row — every business table
      // (tickets, parts, profiles, ...) foreign-keys to Supabase's
      // companies.id, not the Firestore doc, so the company can't
      // actually be used for anything until this row exists too.
      try {
        await createSupabaseCompany({
          legacyCode: newCompanyForm.companyId,
          companyName: newCompanyForm.companyName,
          address: newCompanyForm.address,
          city: newCompanyForm.city,
          state: newCompanyForm.state,
          zipCode: newCompanyForm.zipCode,
          phoneNumber: fullPhoneNumber,
          email: newCompanyForm.email,
          subscriptionPlan: newCompanyForm.subscriptionPlan,
          isActive: true,
          loginAlias: newCompanyForm.loginAlias || undefined,
        });
        setSuccess(`✅ Company '${newCompanyForm.companyName}' created with ID: ${newCompanyForm.companyId}`);
        setTimeout(() => setSuccess(null), 5000);
      } catch (supabaseErr: any) {
        console.error("Error creating Supabase company row:", supabaseErr);
        setError(
          `Company '${newCompanyForm.companyName}' was created, but failed to sync to Supabase (${supabaseErr.message || supabaseErr}). Its tickets/users won't work until this is fixed manually.`
        );
      }

      resetCompanyForm();
      setIsAddingCompany(false);
      loadData();
    } catch (err: any) {
      console.error("Error creating company:", err);
      setError(err.message || "Failed to create company");
    }
  };

  const handleCreateAdmin = async () => {
    try {
      setError(null);
      
      // Super Super Admin is the platform-level role — it isn't tied to any
      // one company, so it's the only role that doesn't require picking one.
      const isPlatformAdmin = newAdminForm.userType === "SUPERSUPERADMIN";

      if (!newAdminForm.email || !newAdminForm.password || !newAdminForm.displayName || (!isPlatformAdmin && !newAdminForm.companyId)) {
        setError("Please fill in all required fields");
        return;
      }

      if (newAdminForm.password.length < 6) {
        setError("Password must be at least 6 characters");
        return;
      }

      // Validate company exists (skipped for Super Super Admin — no company)
      const company = isPlatformAdmin ? null : companies.find((c) => c.companyId === newAdminForm.companyId);
      if (!isPlatformAdmin && !company) {
        setError("Selected company does not exist");
        return;
      }

      const authUser = getCurrentUser();
      if (!authUser) {
        setError("Not authenticated");
        return;
      }

      // Combine country code with phone number if phone number is provided
      const fullPhoneNumber = newAdminForm.phoneNumber 
        ? `${newAdminForm.phoneCountry} ${newAdminForm.phoneNumber}`
        : "";

      const newUid = await createUserAccount(
        {
          email: newAdminForm.email,
          password: newAdminForm.password,
          displayName: newAdminForm.displayName,
          companyId: isPlatformAdmin ? "" : newAdminForm.companyId,
          role: newAdminForm.userType,
          phoneNumber: fullPhoneNumber,
        },
        authUser.uid
      );

      // Also create the matching Supabase profile — every RLS policy
      // resolves the caller's company through profiles, so without this
      // the admin can log in but sees no tickets/users/anything
      // Supabase-backed at all.
      try {
        await createSupabaseAdminProfile({
          firebaseUid: newUid,
          email: newAdminForm.email,
          displayName: newAdminForm.displayName,
          role: newAdminForm.userType,
          companyLegacyCode: isPlatformAdmin ? undefined : newAdminForm.companyId,
          phoneNumber: fullPhoneNumber,
        });
        setSuccess(
          isPlatformAdmin
            ? `✅ Super Super Admin '${newAdminForm.displayName}' created successfully!`
            : `✅ Admin '${newAdminForm.displayName}' created successfully for ${company!.companyName}!`
        );
        setTimeout(() => setSuccess(null), 5000);
      } catch (supabaseErr: any) {
        console.error("Error creating Supabase admin profile:", supabaseErr);
        setError(
          `Admin '${newAdminForm.displayName}' was created, but failed to sync to Supabase (${supabaseErr.message || supabaseErr}). They can log in but won't see any tickets/data until this is fixed.`
        );
      }

      resetAdminForm();
      setIsAddingAdmin(false);
      loadData();
    } catch (err: any) {
      console.error("Error creating admin:", err);
      if (err.code === "auth/email-already-in-use") {
        setError("Email is already in use");
      } else if (err.code === "auth/weak-password") {
        setError("Password is too weak");
      } else {
        setError(err.message || "Failed to create admin");
      }
    }
  };

  const handleUpdateCompany = async () => {
    try {
      setError(null);

      if (!editingCompany) return;

      // Login alias is optional, but if set must follow the same format rule.
      if (newCompanyForm.loginAlias && !/^[A-Z0-9]+$/.test(newCompanyForm.loginAlias)) {
        setError("Login Company ID must contain only letters and numbers (no spaces or special characters)");
        return;
      }

      await updateCompany(editingCompany.companyId, {
        companyName: newCompanyForm.companyName,
        address: newCompanyForm.address,
        city: newCompanyForm.city,
        state: newCompanyForm.state,
        zipCode: newCompanyForm.zipCode,
        phoneNumber: newCompanyForm.phoneNumber,
        email: newCompanyForm.email,
        subscriptionPlan: newCompanyForm.subscriptionPlan,
      });

      // Login alias lives only in Supabase (see migration 0066) — Firestore
      // has no equivalent field, so this is a separate write.
      try {
        await updateSupabaseCompanyLoginAlias(editingCompany.companyId, newCompanyForm.loginAlias || null);
        setSuccess(`✅ Company updated successfully`);
        setTimeout(() => setSuccess(null), 5000);
      } catch (aliasErr: any) {
        console.error("Error updating Supabase login alias:", aliasErr);
        setError(`Company updated, but the login alias failed to save (${aliasErr.message || aliasErr}).`);
      }

      resetCompanyForm();
      loadData();
    } catch (err: any) {
      console.error("Error updating company:", err);
      setError(err.message || "Failed to update company");
    }
  };

  // Freeze/unfreeze a company — stops (or resumes) every one of its users
  // from being able to log in (enforced in auth.tsx via companyIsActive).
  // Dual-write, mirroring every other company field on this page: Firebase
  // is what this page's own Status badge reads, Supabase's companies.is_active
  // is what auth.tsx actually enforces at login.
  const handleToggleCompanyStatus = async (company: Company) => {
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

  const startEditCompany = (company: Company) => {
    setEditingCompany(company);
    setNewCompanyForm({
      companyId: company.companyId,
      companyName: company.companyName,
      address: company.address || "",
      city: company.city || "",
      state: company.state || "",
      zipCode: company.zipCode || "",
      phoneNumber: company.phoneNumber || "",
      phoneCountry: "+1",
      email: company.email || "",
      subscriptionPlan: company.subscriptionPlan || "professional",
      loginAlias: "",
    });
    // Login alias lives only in Supabase (see migration 0066), not on the
    // Firestore company record — fetch it separately so opening the modal
    // isn't blocked on a round-trip.
    getSupabaseCompanyLoginAlias(company.companyId)
      .then((alias) => setNewCompanyForm((f) => ({ ...f, loginAlias: alias || "" })))
      .catch((err) => console.error("Failed to load login alias:", err));
  };

  const syncUsernamesToFirebase = async () => {
    if (!confirm("This will add usernames to all users who don't have one. Continue?")) {
      return;
    }

    setSyncingUsernames(true);
    setError(null);
    setSuccess(null);

    try {
      const { generateUsername } = await import("@/lib/firebase/users");
      const { doc, updateDoc } = await import("firebase/firestore");
      const { db } = await import("@/lib/firebase/config");

      if (!db) {
        throw new Error("Firestore not configured");
      }

      let updatedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const user of users) {
        try {
          // Check if user already has username
          if (user.username) {
            console.log(`⏭️ Skipping ${user.displayName} - already has username`);
            skippedCount++;
            continue;
          }

          // Generate username from displayName
          const username = generateUsername(user.displayName);

          if (!username) {
            console.error(`❌ Could not generate username for ${user.displayName}`);
            errorCount++;
            continue;
          }

          // Update user document
          const userRef = doc(db, "users", user.uid);
          await updateDoc(userRef, { username });

          console.log(`✅ Updated ${user.displayName} → ${username}`);
          updatedCount++;
        } catch (err: any) {
          console.error(`❌ Error updating ${user.displayName}:`, err);
          errorCount++;
        }
      }

      const message = `✅ Sync complete! Updated: ${updatedCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`;
      setSuccess(message);
      setTimeout(() => setSuccess(null), 8000);

      // Reload data to show updated usernames
      await loadData();
    } catch (err: any) {
      console.error("Error syncing usernames:", err);
      setError(err.message || "Failed to sync usernames");
    } finally {
      setSyncingUsernames(false);
    }
  };

  const resetAdminForm = () => {
    setNewAdminForm({
      email: "",
      password: "",
      displayName: "",
      phoneNumber: "",
      phoneCountry: "+1",
      userType: "ADMIN",
      companyId: "",
    });
    setIsAddingAdmin(false);
  };

  const resetCompanyForm = () => {
    setNewCompanyForm({
      companyId: "",
      companyName: "",
      address: "",
      city: "",
      state: "",
      zipCode: "",
      phoneNumber: "",
      phoneCountry: "+1",
      email: "",
      subscriptionPlan: "professional",
      loginAlias: "",
    });
    setIsAddingCompany(false);
    setEditingCompany(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-4xl font-display font-bold tracking-tight text-white mb-2">
                Super Super Admin Dashboard
              </h1>
              <p className="text-lg text-slate-400">Oversee companies and their accounts</p>
            </div>
            <div className="text-right">
              <div className="text-sm text-slate-400">Logged in as</div>
              <div className="text-white font-semibold">{email}</div>
              <div className="flex items-center gap-2 mt-2">
                <div className="inline-block px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 text-xs font-semibold border border-purple-500/30">
                  Super Super Admin
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

        {/* Error/Success Messages */}
        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-500/20 border border-red-500/30 text-red-300">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-6 p-4 rounded-lg bg-green-500/20 border border-green-500/30 text-green-300">
            {success}
          </div>
        )}

        {/* Action Buttons */}
        <div className="mb-6 flex gap-3">
          <button
            onClick={() => setIsAddingCompany(true)}
            className="px-6 py-3 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold transition-colors"
          >
            + Add Company
          </button>
          <button
            onClick={() => setIsAddingAdmin(true)}
            className="px-6 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors"
          >
            + Add New Admin
          </button>
          <button
            onClick={syncUsernamesToFirebase}
            disabled={syncingUsernames || users.length === 0}
            className="px-6 py-3 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {syncingUsernames ? (
              <>
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Syncing...
              </>
            ) : (
              "🔄 Sync Usernames to Firebase"
            )}
          </button>
        </div>

        {/* Company Warning */}
        {companies.length === 0 && (
          <div className="mb-6 p-4 rounded-lg bg-yellow-500/20 border border-yellow-500/30 text-yellow-300">
            ⚠️ No companies found. Please create a company first before adding admin users.
          </div>
        )}

        {/* Username Sync Info */}
        {users.some(u => !u.username) && (
          <div className="mb-6 p-4 rounded-lg bg-blue-500/20 border border-blue-500/30 text-blue-300">
            ℹ️ Some users don't have usernames yet. Click "Sync Usernames to Firebase" to automatically generate usernames for all users (format: FirstName.LastName).
          </div>
        )}

        {/* Add Company Form */}
        {isAddingCompany && (
          <div className="mb-8 p-6 rounded-xl border border-white/15 bg-white/8 backdrop-blur-md">
            <h3 className="text-xl font-semibold text-white mb-4">Add New Company</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">
                  Company ID * (unique identifier)
                </label>
                <input
                  type="text"
                  value={newCompanyForm.companyId}
                  onChange={(e) => setNewCompanyForm({ ...newCompanyForm, companyId: e.target.value.toUpperCase() })}
                  className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500 font-mono"
                  placeholder="COMP001"
                  maxLength={20}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">
                  Company Name *
                </label>
                <input
                  type="text"
                  value={newCompanyForm.companyName}
                  onChange={(e) => setNewCompanyForm({ ...newCompanyForm, companyName: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                  placeholder="Acme Corporation"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">
                  Email *
                </label>
                <input
                  type="email"
                  value={newCompanyForm.email}
                  onChange={(e) => setNewCompanyForm({ ...newCompanyForm, email: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                  placeholder="info@company.com"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">
                  Address *
                </label>
                <input
                  type="text"
                  value={newCompanyForm.address}
                  onChange={(e) => setNewCompanyForm({ ...newCompanyForm, address: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                  placeholder="123 Main Street"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">
                  City *
                </label>
                <input
                  type="text"
                  value={newCompanyForm.city}
                  onChange={(e) => setNewCompanyForm({ ...newCompanyForm, city: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                  placeholder="New York"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">
                  State * (2 characters)
                </label>
                <input
                  type="text"
                  value={newCompanyForm.state}
                  onChange={(e) => setNewCompanyForm({ ...newCompanyForm, state: e.target.value.toUpperCase() })}
                  maxLength={2}
                  className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                  placeholder="NY"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">
                  ZIP Code *
                </label>
                <input
                  type="text"
                  value={newCompanyForm.zipCode}
                  onChange={(e) => setNewCompanyForm({ ...newCompanyForm, zipCode: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                  placeholder="10001"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">
                  Phone Number *
                </label>
                <div className="flex gap-2">
                  <select
                    value={newCompanyForm.phoneCountry}
                    onChange={(e) => setNewCompanyForm({ ...newCompanyForm, phoneCountry: e.target.value })}
                    className="px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                    style={{ minWidth: '80px' }}
                  >
                    {countryCodes.map((item, idx) => (
                      <option key={`${item.code}-${idx}`} value={item.code}>
                        {item.flag} {item.code}
                      </option>
                    ))}
                  </select>
                  <input
                    type="tel"
                    value={newCompanyForm.phoneNumber}
                    onChange={(e) => setNewCompanyForm({ ...newCompanyForm, phoneNumber: e.target.value })}
                    className="flex-1 px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                    placeholder="123-456-7890"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">
                  Subscription Plan
                </label>
                <select
                  value={newCompanyForm.subscriptionPlan}
                  onChange={(e) => setNewCompanyForm({ ...newCompanyForm, subscriptionPlan: e.target.value as any })}
                  className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="basic">Basic</option>
                  <option value="professional">Professional</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">
                  Login Company ID (optional)
                </label>
                <input
                  type="text"
                  value={newCompanyForm.loginAlias}
                  onChange={(e) => setNewCompanyForm({ ...newCompanyForm, loginAlias: e.target.value.toUpperCase() })}
                  className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500 font-mono"
                  placeholder="Once set, this REPLACES Company ID above for login"
                  maxLength={20}
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={handleCreateCompany}
                className="px-6 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold transition-colors"
              >
                Create Company
              </button>
              <button
                onClick={resetCompanyForm}
                className="px-6 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-semibold transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}


        {/* Add/Edit Admin Form */}
        {isAddingAdmin && (
          <div className="mb-8 p-6 rounded-xl border border-white/15 bg-white/8 backdrop-blur-md">
            <h3 className="text-xl font-semibold text-white mb-4">
              Add New Admin Account
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">
                  Email *
                </label>
                <input
                  type="email"
                  value={newAdminForm.email}
                  onChange={(e) => setNewAdminForm({ ...newAdminForm, email: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                  placeholder="admin@company.com"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">
                  Password * (min 6 characters)
                </label>
                <input
                  type="password"
                  value={newAdminForm.password}
                  onChange={(e) => setNewAdminForm({ ...newAdminForm, password: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                  placeholder="••••••"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">
                  Full Name *
                </label>
                <input
                  type="text"
                  value={newAdminForm.displayName}
                  onChange={(e) => setNewAdminForm({ ...newAdminForm, displayName: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                  placeholder="John Doe"
                />
                {newAdminForm.displayName && (
                  <p className="mt-1 text-xs text-slate-400">
                    Username will be: <span className="font-mono text-blue-300">{newAdminForm.displayName.trim().split(/\s+/).length > 1 ? `${newAdminForm.displayName.trim().split(/\s+/)[0]}.${newAdminForm.displayName.trim().split(/\s+/).slice(-1)[0]}` : newAdminForm.displayName.trim()}</span>
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">
                  Phone Number
                </label>
                <div className="flex gap-2">
                  <select
                    value={newAdminForm.phoneCountry}
                    onChange={(e) => setNewAdminForm({ ...newAdminForm, phoneCountry: e.target.value })}
                    className="px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                    style={{ minWidth: '80px' }}
                  >
                    {countryCodes.map((item, idx) => (
                      <option key={`${item.code}-${idx}`} value={item.code}>
                        {item.flag} {item.code}
                      </option>
                    ))}
                  </select>
                  <input
                    type="tel"
                    value={newAdminForm.phoneNumber}
                    onChange={(e) => setNewAdminForm({ ...newAdminForm, phoneNumber: e.target.value })}
                    className="flex-1 px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                    placeholder="123-456-7890"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">
                  User Type *
                </label>
                <select
                  value={newAdminForm.userType}
                  onChange={(e) => setNewAdminForm({ ...newAdminForm, userType: e.target.value as UserRole })}
                  className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="SUPERSUPERADMIN">Super Super Admin (platform, all companies)</option>
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
              {newAdminForm.userType !== "SUPERSUPERADMIN" && (
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-2">
                    Company *
                  </label>
                  <select
                    value={newAdminForm.companyId}
                    onChange={(e) => setNewAdminForm({ ...newAdminForm, companyId: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="">Select company</option>
                    {companies.map((company, companyIdx) => (
                      <option key={company.companyId || `company-${companyIdx}`} value={company.companyId}>
                        {company.companyName} ({company.companyId})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {newAdminForm.userType === "SUPERSUPERADMIN" && (
                <p className="text-xs text-slate-500">
                  Super Super Admin is a platform-wide role — it isn't tied to any one company, so no company selection is needed.
                </p>
              )}
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={handleCreateAdmin}
                className="px-6 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold transition-colors"
              >
                Create Admin
              </button>
              <button
                onClick={resetAdminForm}
                className="px-6 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-semibold transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}


        {/* Companies List — company + how many users it has, click through
            (new tab) for the full detail/roster/freeze page. */}
        <div className="mt-8 rounded-xl border border-white/15 bg-white/8 backdrop-blur-md overflow-hidden">
          <div className="px-6 py-4 border-b border-white/10">
            <h2 className="text-xl font-semibold text-white">
              Companies ({companies.length})
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-green-900/30 border-b border-white/10">
                  <th className="px-4 py-3 text-left font-semibold text-green-300">Company</th>
                  <th className="px-4 py-3 text-center font-semibold text-green-300">Users</th>
                  <th className="px-4 py-3 text-left font-semibold text-green-300">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-green-300">Plan</th>
                  <th className="px-4 py-3 text-center font-semibold text-green-300">Actions</th>
                </tr>
              </thead>
              <tbody>
                {companies.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                      No companies created yet. Click "Add Company" to get started.
                    </td>
                  </tr>
                ) : (
                  companies.map((company, companyIdx) => {
                    const userCount = adminUsers.filter((u) => u.companyId === company.companyId).length;
                    return (
                    <tr key={company.companyId || `company-${companyIdx}`} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="px-4 py-3">
                        <Link
                          to="/superadmin/company/$companyId"
                          params={{ companyId: company.companyId }}
                          target="_blank"
                          className="text-white font-semibold hover:text-blue-300 hover:underline"
                        >
                          {company.companyName}
                        </Link>
                        <div className="text-slate-400 font-mono text-xs">{company.companyId}</div>
                      </td>
                      <td className="px-4 py-3 text-center text-slate-200 font-semibold">{userCount}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-semibold ${
                            company.isActive
                              ? "bg-green-500/20 text-green-300 border border-green-500/30"
                              : "bg-red-500/20 text-red-300 border border-red-500/30"
                          }`}
                        >
                          {company.isActive ? "Active" : "Frozen"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-300 capitalize">{company.subscriptionPlan || "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => startEditCompany(company)}
                            className="px-3 py-1 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 text-xs font-semibold transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleToggleCompanyStatus(company)}
                            className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                              company.isActive
                                ? "bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30"
                                : "bg-green-500/20 text-green-300 border border-green-500/30 hover:bg-green-500/30"
                            }`}
                          >
                            {company.isActive ? "Freeze" : "Unfreeze"}
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Edit Company modal */}
        {editingCompany && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6 backdrop-blur-sm">
            <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/15 bg-slate-900 p-6 text-white shadow-2xl">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
                <h4 className="text-xl font-bold text-white">Edit Company</h4>
                <button
                  type="button"
                  onClick={resetCompanyForm}
                  className="rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-200/40"
                >
                  Close
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-2">Company ID (read-only)</label>
                  <div className="w-full px-4 py-2 rounded-lg bg-slate-900/50 border border-white/10 text-slate-400 font-mono">
                    {newCompanyForm.companyId}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-2">Company Name *</label>
                  <input
                    type="text"
                    value={newCompanyForm.companyName}
                    onChange={(e) => setNewCompanyForm({ ...newCompanyForm, companyName: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                    placeholder="Acme Appliance Repair"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-2">Email</label>
                  <input
                    type="email"
                    value={newCompanyForm.email}
                    onChange={(e) => setNewCompanyForm({ ...newCompanyForm, email: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                    placeholder="contact@company.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-2">Phone Number</label>
                  <div className="flex gap-2">
                    <select
                      value={newCompanyForm.phoneCountry}
                      onChange={(e) => setNewCompanyForm({ ...newCompanyForm, phoneCountry: e.target.value })}
                      className="px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                      style={{ minWidth: '80px' }}
                    >
                      {countryCodes.map((item, idx) => (
                        <option key={`${item.code}-${idx}`} value={item.code}>
                          {item.flag} {item.code}
                        </option>
                      ))}
                    </select>
                    <input
                      type="tel"
                      value={newCompanyForm.phoneNumber}
                      onChange={(e) => setNewCompanyForm({ ...newCompanyForm, phoneNumber: e.target.value })}
                      className="flex-1 px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                      placeholder="123-456-7890"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-2">Address</label>
                  <input
                    type="text"
                    value={newCompanyForm.address}
                    onChange={(e) => setNewCompanyForm({ ...newCompanyForm, address: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                    placeholder="123 Main St"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-2">City</label>
                  <input
                    type="text"
                    value={newCompanyForm.city}
                    onChange={(e) => setNewCompanyForm({ ...newCompanyForm, city: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                    placeholder="Jackson"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-2">State</label>
                  <input
                    type="text"
                    value={newCompanyForm.state}
                    onChange={(e) => setNewCompanyForm({ ...newCompanyForm, state: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                    placeholder="MS"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-2">ZIP Code</label>
                  <input
                    type="text"
                    value={newCompanyForm.zipCode}
                    onChange={(e) => setNewCompanyForm({ ...newCompanyForm, zipCode: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                    placeholder="39056"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-2">Subscription Plan</label>
                  <select
                    value={newCompanyForm.subscriptionPlan}
                    onChange={(e) => setNewCompanyForm({ ...newCompanyForm, subscriptionPlan: e.target.value as "basic" | "professional" | "enterprise" })}
                    className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="basic">Basic</option>
                    <option value="professional">Professional</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-2">Login Company ID (optional)</label>
                  <input
                    type="text"
                    value={newCompanyForm.loginAlias}
                    onChange={(e) => setNewCompanyForm({ ...newCompanyForm, loginAlias: e.target.value.toUpperCase() })}
                    className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-blue-500 font-mono"
                    placeholder="Once set, this REPLACES Company ID above for login"
                    maxLength={20}
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-5">
                <button
                  onClick={handleUpdateCompany}
                  className="px-6 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold transition-colors"
                >
                  Update Company
                </button>
                <button
                  onClick={resetCompanyForm}
                  className="px-6 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-semibold transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
