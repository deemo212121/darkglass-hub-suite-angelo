import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { getModule, getSubModule } from "@/lib/modules";
import { LOCATIONS } from "@/lib/locations";
import { WORK_PLAN_DAYS, SLOT_OPTIONS, type WorkPlan } from "@/lib/workPlan";
import { getProfileByUsername, getProfileEmployeeInfo, saveProfileEmployeeInfo } from "@/lib/supabase/users";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/m/$module/$submodule/$userId")({
  ssr: false,
  loader: async ({ params }) => {
    const module = getModule(params.module);
    const submodule = getSubModule(params.module, params.submodule);
    
    if (!module || !submodule || module.slug !== "admin" || submodule.slug !== "user-management") {
      throw notFound();
    }

    return { module, submodule, userId: params.userId };
  },
  component: UserDetailsPage,
});

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "ADMIN", label: "Admin" },
  { value: "MANAGER", label: "Manager" },
  { value: "CSR", label: "CSR" },
  { value: "TECHNICIAN", label: "Technician" },
  { value: "DISPATCHER", label: "Dispatcher" },
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

/**
 * Multi-select dropdown for User Type. Mirrors the look + behavior of the
 * same control in Admin User Management's Add New User modal. First ticked
 * value becomes the primary `role` (used by RLS and access checks); the rest
 * are stored on `extra_roles`, so a user like Daven Hodge (manager who is
 * also a technician) can hold both roles simultaneously.
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
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
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
        className="w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white flex items-center justify-between text-left focus:outline-none focus:border-blue-500"
      >
        <span className={values.length ? "text-slate-100 truncate" : "text-slate-500"}>{summary}</span>
        <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-slate-900 shadow-xl">
          {options.map((opt) => {
            const checked = values.includes(opt.value);
            const isPrimary = values[0] === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-white/10"
              >
                <span className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${checked ? "bg-blue-500 border-blue-500" : "border-white/30"}`}>
                  {checked && <Check className="h-3 w-3 text-white" />}
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

const USER_TABS = [
  "General Information",
  "Work Plan",
  "Billing Information",
  "Account Information",
  "Vehicle Information",
  "Employee Information",
] as const;

const SMS_OPTIONS = ["SMS Available", "Chat available", "View available", "Not available"];
const WEEK_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function UserDetailsPage() {
  const { module, submodule, userId } = Route.useLoaderData();
  const { ready } = useAuth();

  const [loading, setLoading] = useState(true);
  const [notFoundUser, setNotFoundUser] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string>("");
  const [seqId, setSeqId] = useState<string>("");
  const [managerCandidates, setManagerCandidates] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<(typeof USER_TABS)[number]>("General Information");
  const [form, setForm] = useState({
    email: "",
    username: "",
    displayName: "",
    role: "",
    /** Full role list, including primary. First entry is the primary role; the
     *  rest are persisted into extra_roles on save. */
    roles: [] as string[],
    phoneNumber: "",
    managerName: "",
    assignedBranch: "",
    emailReportLocation: "",
    technicianId: "",
    poInitials: "",
    smsStatus: "Not available",
    offDays: [] as number[],
    isActive: true,
  });
  // Work plan grid state (per-location weekday/weekend + per-day slot).
  const [workPlan, setWorkPlan] = useState<WorkPlan>({});
  // Employee Information tab (bank, personal, home address). Stored in Supabase
  // profiles.employee_info; powers the Work Map technician house pins.
  const [employeeInfo, setEmployeeInfo] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const { getProfileByUsername, getCompanyUsers } = await import("@/lib/supabase/users");
        const p = await getProfileByUsername(userId);
        if (cancelled) return;
        if (!p) {
          setNotFoundUser(true);
          return;
        }
        setProfileId(p.id);
        try {
          const all = await getCompanyUsers();
          const idx = all.findIndex((u) => u.id === p.id);
          setSeqId(idx >= 0 ? String(idx + 1) : "");
          // Manager dropdown candidates: real users with a manager-ish or
          // admin role, not a hardcoded name list. Stored as free-text
          // (manager_name matched against real profiles by display name —
          // see resolveTeamLeadOrManager in src/lib/notifyRouting.ts).
          const eligible = all.filter((u) => (u.role || "").toUpperCase() === "ADMIN" || (u.role || "").toUpperCase().includes("MANAGER"));
          setManagerCandidates(
            Array.from(new Set(eligible.map((u) => u.display_name || u.email).filter(Boolean))).sort((a, b) => a.localeCompare(b))
          );
        } catch { /* ignore */ }
        setForm({
          email: p.email || "",
          username: p.username || "",
          displayName: p.display_name || "",
          role: p.role || "",
          // Combine primary + extra into a single ordered list so the
          // multi-select renders all roles the user holds. The primary stays
          // first so the "primary" pill marker lines up with what RLS uses.
          roles: [p.role, ...((p.extra_roles as string[] | null) ?? [])]
            .filter((r): r is string => Boolean(r))
            .filter((r, i, arr) => arr.indexOf(r) === i),
          phoneNumber: p.phone_number || "",
          managerName: p.manager_name || "",
          assignedBranch: p.assigned_branch || "",
          emailReportLocation: p.email_report_location || "",
          technicianId: p.technician_id || "",
          poInitials: p.po_initials || "",
          smsStatus: p.sms_status || "Not available",
          offDays: Array.isArray(p.off_days) ? p.off_days : [],
          isActive: p.is_active,
        });
        const { normalizeWorkPlan } = await import("@/lib/workPlan");
        setWorkPlan(normalizeWorkPlan(p.work_plan as any, LOCATIONS as unknown as string[]));
        // Load saved employee info (bank/personal/home address) from Supabase.
        try {
          const { getProfileEmployeeInfo } = await import("@/lib/supabase/users");
          const info = await getProfileEmployeeInfo(p.id);
          if (!cancelled && info) setEmployeeInfo(info as Record<string, string>);
        } catch { /* ignore */ }
      } catch (err) {
        console.error("Failed to load user:", err);
        if (!cancelled) setNotFoundUser(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ready, userId]);

  const update = (field: keyof typeof form, value: any) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const toggleOffDay = (dayIdx: number) =>
    setForm((prev) => ({
      ...prev,
      offDays: prev.offDays.includes(dayIdx)
        ? prev.offDays.filter((d) => d !== dayIdx)
        : [...prev.offDays, dayIdx],
    }));

  const setPlanFlag = (loc: string, flag: "weekday" | "weekend", value: boolean) =>
    setWorkPlan((prev) => ({
      ...prev,
      [loc]: { ...prev[loc], [flag]: value },
    }));

  const setPlanDay = (loc: string, day: string, value: string) =>
    setWorkPlan((prev) => ({
      ...prev,
      [loc]: { ...prev[loc], days: { ...prev[loc].days, [day]: value as any } },
    }));

  // Bulk toggle a column (Weekday/Weekend) across all locations.
  const setAllPlanFlag = (flag: "weekday" | "weekend", value: boolean) =>
    setWorkPlan((prev) => {
      const next = { ...prev };
      for (const loc of Object.keys(next)) next[loc] = { ...next[loc], [flag]: value };
      return next;
    });

  const handleSave = async () => {
    if (!profileId) return;
    setSaving(true);
    setStatus(null);
    try {
      const { updateCompanyUser } = await import("@/lib/supabase/users");
      // First role in the list is the primary; the rest land in extra_roles.
      const primaryRole = (form.roles[0] || form.role || "") as any;
      const extraRoles = form.roles.slice(1) as any;
      await updateCompanyUser(profileId, {
        displayName: form.displayName,
        role: primaryRole,
        extraRoles,
        phoneNumber: form.phoneNumber,
        managerName: form.managerName,
        assignedBranch: form.assignedBranch,
        emailReportLocation: form.emailReportLocation,
        technicianId: form.technicianId,
        poInitials: form.poInitials,
        smsStatus: form.smsStatus,
        offDays: form.offDays,
        workPlan: workPlan,
        isActive: form.isActive,
      });
      // Persist Employee Information (powers Work Map house pins).
      try {
        const { saveProfileEmployeeInfo } = await import("@/lib/supabase/users");
        await saveProfileEmployeeInfo(profileId, employeeInfo as any);
      } catch (e) {
        console.warn("Employee info save skipped:", e);
      }
      setStatus("Saved.");
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : "Save failed"}`);
    } finally {
      setSaving(false);
    }
  };

  const labelCls = "block text-xs uppercase tracking-[0.08em] text-slate-400";
  const inputCls = "w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500";
  const readonlyCls = "w-full rounded-md border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-400";

  // Employee Information field (bound to the employeeInfo object).
  const empField = (label: string, key: string, type: string = "text") => (
    <label className="space-y-1.5 text-sm">
      <span className={labelCls}>{label}</span>
      <input
        type={type}
        value={String(employeeInfo[key] ?? "")}
        onChange={(e) => setEmployeeInfo((p) => ({ ...p, [key]: e.target.value }))}
        className={inputCls}
      />
    </label>
  );

  const textField = (label: string, key: keyof typeof form, opts?: { type?: string; note?: string }) => (
    <label className="space-y-1.5 text-sm">
      <span className={labelCls}>{label}{opts?.note ? <span className="ml-1 normal-case text-[10px] text-slate-500">{opts.note}</span> : null}</span>
      <input
        type={opts?.type ?? "text"}
        value={String(form[key] ?? "")}
        onChange={(e) => update(key, e.target.value)}
        className={inputCls}
      />
    </label>
  );

  return (
    <>
      <AppHeader />
      <main className="flex-1 bg-slate-950 py-6">
        <div className="max-w-5xl mx-auto px-6">
          <Link
            to="/m/$module/$submodule"
            params={{ module: module.slug, submodule: submodule.slug }}
            className="inline-flex items-center gap-2 text-slate-300 hover:text-white mb-4 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to User Management
          </Link>

          <div className="rounded-xl border border-white/15 bg-white/8 p-6 text-white backdrop-blur-md">
            {loading ? (
              <p className="text-slate-300">Loading user…</p>
            ) : notFoundUser ? (
              <div>
                <h1 className="text-2xl font-bold mb-2">User not found</h1>
                <p className="text-slate-300">No user matches "{userId}" in your company.</p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                  <div>
                    <h1 className="text-3xl font-bold tracking-tight">{form.displayName || form.username}</h1>
                    <p className="mt-1 text-sm text-slate-400">{form.email}</p>
                  </div>
                  <button onClick={handleSave} disabled={saving} className="btn btn-primary disabled:opacity-50">
                    {saving ? "Saving…" : "Save Changes"}
                  </button>
                </div>

                {/* Tabs */}
                <div className="flex flex-wrap gap-1 border-b border-white/10 mb-6">
                  {USER_TABS.map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveTab(tab)}
                      className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition ${activeTab === tab ? "bg-blue-500/20 text-white border-b-2 border-blue-400" : "text-slate-400 hover:text-white"}`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                {status && (
                  <div className={`mb-4 text-sm rounded p-3 ${status.startsWith("Error") ? "text-red-400 bg-red-500/10 border border-red-500/30" : "text-green-400 bg-green-500/10 border border-green-500/30"}`}>
                    {status}
                  </div>
                )}

                {activeTab === "General Information" ? (
                  <div className="space-y-6">
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <label className="space-y-1.5 text-sm">
                        <span className={labelCls}>User ID</span>
                        <input value={seqId} disabled className={readonlyCls} />
                      </label>
                      <label className="space-y-1.5 text-sm">
                        <span className={labelCls}>Status</span>
                        <select value={form.isActive ? "Active" : "Inactive"} onChange={(e) => update("isActive", e.target.value === "Active")} className={inputCls}>
                          <option>Active</option>
                          <option>Inactive</option>
                        </select>
                      </label>
                      <label className="space-y-1.5 text-sm">
                        <span className={labelCls}>Login ID</span>
                        <input value={form.username} disabled className={readonlyCls} />
                      </label>

                      <label className="space-y-1.5 text-sm">
                        <span className={labelCls}>User Type <span className="normal-case text-[10px] text-slate-500">(tick all that apply — first ticked is primary)</span></span>
                        <RoleMultiSelect
                          values={form.roles}
                          options={ROLE_OPTIONS}
                          onChange={(next) => {
                            // Keep `role` mirrored as the primary so anywhere
                            // we still read form.role gets the right value.
                            setForm((prev) => ({ ...prev, roles: next, role: next[0] || "" }));
                          }}
                          placeholder="Select user type(s)"
                        />
                      </label>
                      {textField("User Name", "displayName")}
                      {textField("PO # Initial", "poInitials", { note: "(used as part of PO #)" })}

                      {textField("Work Phone #", "phoneNumber", { type: "tel" })}
                      <label className="space-y-1.5 text-sm">
                        <span className={labelCls}>Direct Manager <span className="normal-case text-[10px] text-slate-500">(mandatory for Tech)</span></span>
                        <select value={form.managerName} onChange={(e) => update("managerName", e.target.value)} className={inputCls}>
                          <option value="">— select —</option>
                          {!managerCandidates.includes(form.managerName) && form.managerName && <option value={form.managerName}>{form.managerName}</option>}
                          {managerCandidates.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </label>
                      <label className="space-y-1.5 text-sm">
                        <span className={labelCls}>Email</span>
                        <input value={form.email} disabled className={readonlyCls} />
                      </label>

                      <label className="space-y-1.5 text-sm">
                        <span className={labelCls}>Office Location *</span>
                        <select value={form.assignedBranch} onChange={(e) => update("assignedBranch", e.target.value)} className={inputCls}>
                          <option value="">— select —</option>
                          {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
                        </select>
                      </label>
                      <label className="space-y-1.5 text-sm">
                        <span className={labelCls}>Location for Email Report</span>
                        <select value={form.emailReportLocation} onChange={(e) => update("emailReportLocation", e.target.value)} className={inputCls}>
                          <option value="">— select —</option>
                          {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
                        </select>
                      </label>
                      <label className="space-y-1.5 text-sm">
                        <span className={labelCls}>SMS</span>
                        <select value={form.smsStatus} onChange={(e) => update("smsStatus", e.target.value)} className={inputCls}>
                          {SMS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </label>
                    </div>

                    {/* Time Off Schedule */}
                    <div>
                      <span className={labelCls}>Time Off Schedule</span>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {WEEK_DAYS.map((d, idx) => {
                          const off = form.offDays.includes(idx);
                          return (
                            <button
                              key={d}
                              type="button"
                              onClick={() => toggleOffDay(idx)}
                              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${off ? "bg-red-500/20 text-red-300 border border-red-500/40" : "bg-slate-800 text-slate-300 border border-white/10"}`}
                            >
                              {d}
                              <span className="block text-[10px] font-normal">{off ? "OFF" : "WORK"}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-slate-900/40 p-4 text-xs text-slate-400">
                      <p className="font-semibold text-slate-300 mb-1">Password requirements (for new passwords)</p>
                      minimum of 8 characters · lowercase letters · at least one uppercase letter · at least one number · must not include name, phone #, or ID.
                    </div>
                  </div>
                ) : activeTab === "Work Plan" ? (
                  <div className="space-y-4">
                    <p className="text-sm text-slate-400">
                      Check Weekday/Weekend per location to grant this user access to that
                      location's tickets and work map. Unchecked locations are hidden from them.
                    </p>
                    <div className="overflow-x-auto border border-white/10 rounded-lg">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-blue-900/40 border-b border-blue-500/30">
                            <th className="px-3 py-2 text-left font-semibold text-blue-300">Location</th>
                            <th className="px-3 py-2 text-center font-semibold text-blue-300">
                              <div>Weekday</div>
                              <div className="flex justify-center gap-1 mt-1 text-[10px] font-normal">
                                <button type="button" onClick={() => setAllPlanFlag("weekday", true)} className="text-green-400 hover:underline">all</button>
                                <span className="text-slate-600">/</span>
                                <button type="button" onClick={() => setAllPlanFlag("weekday", false)} className="text-red-400 hover:underline">none</button>
                              </div>
                            </th>
                            <th className="px-3 py-2 text-center font-semibold text-blue-300">
                              <div>Weekend</div>
                              <div className="flex justify-center gap-1 mt-1 text-[10px] font-normal">
                                <button type="button" onClick={() => setAllPlanFlag("weekend", true)} className="text-green-400 hover:underline">all</button>
                                <span className="text-slate-600">/</span>
                                <button type="button" onClick={() => setAllPlanFlag("weekend", false)} className="text-red-400 hover:underline">none</button>
                              </div>
                            </th>
                            {WORK_PLAN_DAYS.map((d) => (
                              <th key={d} className="px-2 py-2 text-center font-semibold text-blue-300">{d}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(LOCATIONS as unknown as string[]).map((loc) => {
                            const plan = workPlan[loc];
                            if (!plan) return null;
                            const enabled = plan.weekday || plan.weekend;
                            return (
                              <tr key={loc} className={`border-b border-white/5 ${enabled ? "" : "opacity-60"}`}>
                                <td className="px-3 py-2 font-medium text-slate-200 whitespace-nowrap">{loc}</td>
                                <td className="px-3 py-2 text-center">
                                  <input type="checkbox" checked={plan.weekday} onChange={(e) => setPlanFlag(loc, "weekday", e.target.checked)} />
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <input type="checkbox" checked={plan.weekend} onChange={(e) => setPlanFlag(loc, "weekend", e.target.checked)} />
                                </td>
                                {WORK_PLAN_DAYS.map((day) => (
                                  <td key={day} className="px-2 py-2">
                                    <select
                                      value={plan.days[day] ?? "AM + PM"}
                                      onChange={(e) => setPlanDay(loc, day, e.target.value)}
                                      disabled={!enabled}
                                      className="rounded-md border border-white/15 bg-slate-950/90 px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500 disabled:opacity-40"
                                    >
                                      {SLOT_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                  </td>
                                ))}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : activeTab === "Employee Information" ? (
                  <div className="space-y-6">
                    <p className="text-sm text-slate-400">
                      Bank, personal, and home-address details. The home address is used to pin the technician's house on the Work Map.
                    </p>

                    <div>
                      <h3 className="text-sm font-semibold text-blue-300 mb-3">Bank Information</h3>
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {empField("Bank Name", "bankName")}
                        {empField("Routing Number", "routingNumber")}
                        {empField("Account Number", "accountNumber")}
                      </div>
                    </div>

                    <div>
                      <h3 className="text-sm font-semibold text-blue-300 mb-3">Personal Information</h3>
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {empField("Address 1", "address1")}
                        {empField("Address 2", "address2")}
                        {empField("City", "city")}
                        {empField("State", "state")}
                        {empField("Zip Code", "zipCode")}
                        {empField("Employee ID", "employeeId")}
                        {empField("Employee SSN", "employeeSsn")}
                        {empField("Employee Salary", "employeeSalary")}
                        {empField("Birth Date", "birthDate", "date")}
                        {empField("Hire Date", "hireDate", "date")}
                        {empField("Terminate Date", "terminateDate", "date")}
                      </div>
                      <label className="mt-4 block space-y-1.5 text-sm">
                        <span className={labelCls}>Employee Note</span>
                        <textarea
                          value={employeeInfo.employeeNote || ""}
                          onChange={(e) => setEmployeeInfo((p) => ({ ...p, employeeNote: e.target.value }))}
                          className={`${inputCls} min-h-24`}
                        />
                      </label>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-white/10 bg-slate-900/40 p-8 text-center text-slate-400">
                    <p className="text-lg font-semibold text-slate-300 mb-1">{activeTab}</p>
                    <p className="text-sm">This section is coming soon.</p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

