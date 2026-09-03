import { createFileRoute, notFound, Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { getModule, getSubModule } from "@/lib/modules";
import { getUserManagementRecord } from "@/lib/user-management";
import { LOCATIONS } from "@/lib/locations";
import { WORK_PLAN_DAYS, SLOT_OPTIONS, accessibleLocations, type WorkPlan } from "@/lib/workPlan";
import { getUserByUsername, getCompanyUsers, type UserAccount } from "@/lib/firebase/users";
import { getProfileByUsername, getProfileEmployeeInfo, saveProfileEmployeeInfo } from "@/lib/supabase/users";
import { normalizeRole } from "@/lib/roleLabels";
import { useAllRoleOptions } from "@/lib/customRoles";
import { useAuth } from "@/lib/auth";
import { usePersistedTab } from "@/lib/usePersistedTab";
import { auth as firebaseAuth } from "@/lib/firebase/config";
import { logModuleActivity } from "@/lib/supabase/moduleActivityLog";

const TABS = [
  "General Information",
  "Branch Access",
  "Billing Information",
  "Account Information",
  "Vehicle Information",
  "Employee Information",
] as const;

const BRANCH_COLUMNS = ["Weekday", "Weekend", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const DAY_SCHEDULE_OPTIONS = ["AM + PM", "AM only", "PM only"] as const;
const QUARTER_MS = 90 * 24 * 60 * 60 * 1000;
const DAY_COLUMN_ACCESS: Record<string, "weekday" | "weekend"> = {
  Sunday: "weekend",
  Monday: "weekday",
  Tuesday: "weekday",
  Wednesday: "weekday",
  Thursday: "weekday",
  Friday: "weekday",
  Saturday: "weekend",
};
type BranchSettingRow = ReturnType<typeof defaultBranchSettings>;

function normalizeBranches(value: string) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function hashString(value: string) {
  return Array.from(value).reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function buildDob(recordId: string) {
  const seed = hashString(recordId);
  const year = 1975 + (seed % 22);
  const month = String((seed % 12) + 1).padStart(2, "0");
  const day = String((seed % 28) + 1).padStart(2, "0");
  return `${month}/${day}/${year}`;
}

function buildHomeAddress(userName: string, office: string) {
  const seed = hashString(`${userName}${office}`);
  const streetNo = 100 + (seed % 800);
  const streets = ["Oak", "Maple", "Cedar", "Pine", "Hillcrest", "Sunset", "River", "Main"];
  const cities = [office, "Memphis", "Nashville", "Birmingham", "Atlanta"];
  const states = ["TN", "AL", "GA", "MS", "LA", "NC", "SC"];
  return `${streetNo} ${streets[seed % streets.length]} St, ${cities[seed % cities.length]}, ${states[seed % states.length]} 0000${seed % 9}`;
}

function buildEmergencyContacts(userName: string) {
  const seed = hashString(userName);
  const contacts = ["Spouse", "Parent", "Sibling", "Friend"];
  return [
    {
      name: `${userName.split(" ")[0] || "Primary"} Contact`,
      relationship: contacts[seed % contacts.length],
      phone: `555-${String(200 + (seed % 700)).padStart(3, "0")}-${String(1000 + (seed % 9000)).slice(-4)}`,
    },
    {
      name: `${userName.split(" ")[0] || "Secondary"} Backup`,
      relationship: contacts[(seed + 1) % contacts.length],
      phone: `555-${String(300 + ((seed + 17) % 600)).padStart(3, "0")}-${String(2000 + ((seed + 17) % 7000)).slice(-4)}`,
    },
  ];
}

function getBranchAccess(user: { type: string; office: string; locations: string }) {
  const type = user.type.toLowerCase();
  if (type.includes("admin") || type === "hr" || type === "manager" || type === "claim manager" || type === "part manager" || type.includes("super admin")) {
    return [...LOCATIONS];
  }
  if (type.includes("tech manager")) {
    const locations = normalizeBranches(user.locations);
    return locations.length ? locations : [user.office].filter(Boolean);
  }
  if (type.includes("technician")) {
    return [user.office].filter(Boolean);
  }
  const locations = normalizeBranches(user.locations);
  return locations.length ? locations : [user.office].filter(Boolean);
}

function getBranchAccessReason(userType: string) {
  const type = userType.toLowerCase();
  if (type.includes("admin") || type === "hr" || type === "manager" || type.includes("super admin")) return "Full branch access";
  if (type === "part manager") return "Part team leaders can see all branches";
  if (type.includes("tech manager")) return "Branch access is limited to assigned branches";
  if (type.includes("technician")) return "Branch access is limited to the assigned branch";
  return "Branch access follows the assigned locations";
}

function defaultBranchSettings(location: string, hasAccess: boolean) {
  return {
    weekday: hasAccess,
    weekend: hasAccess,
    sunday: hasAccess ? "AM + PM" : "AM only",
    monday: hasAccess ? "AM + PM" : "AM only",
    tuesday: hasAccess ? "AM + PM" : "AM only",
    wednesday: hasAccess ? "AM + PM" : "AM only",
    thursday: hasAccess ? "AM + PM" : "AM only",
    friday: hasAccess ? "AM + PM" : "AM only",
    saturday: hasAccess ? "AM + PM" : "AM only",
  };
}

function buildBranchSettings(branchAccess: string[]) {
  return Object.fromEntries(
    LOCATIONS.map((location) => [location, defaultBranchSettings(location, branchAccess.includes(location))]),
  ) as Record<string, BranchSettingRow>;
}

function loadBranchSettings(userId: string, branchAccess: string[]) {
  const defaults = buildBranchSettings(branchAccess);
  if (typeof window === "undefined") return defaults;

  const raw = window.localStorage.getItem(`ahs:branch-access:${userId}`);
  if (!raw) return defaults;

  try {
    const parsed = JSON.parse(raw) as Partial<Record<string, Partial<BranchSettingRow>>>;
    return Object.fromEntries(
      LOCATIONS.map((location) => {
        const fallback = defaults[location];
        const row = parsed[location];
        return [location, {
          weekday: typeof row?.weekday === "boolean" ? row.weekday : fallback.weekday,
          weekend: typeof row?.weekend === "boolean" ? row.weekend : fallback.weekend,
          sunday: typeof row?.sunday === "string" ? row.sunday : fallback.sunday,
          monday: typeof row?.monday === "string" ? row.monday : fallback.monday,
          tuesday: typeof row?.tuesday === "string" ? row.tuesday : fallback.tuesday,
          wednesday: typeof row?.wednesday === "string" ? row.wednesday : fallback.wednesday,
          thursday: typeof row?.thursday === "string" ? row.thursday : fallback.thursday,
          friday: typeof row?.friday === "string" ? row.friday : fallback.friday,
          saturday: typeof row?.saturday === "string" ? row.saturday : fallback.saturday,
        }];
      }),
    ) as Record<string, BranchSettingRow>;
  } catch {
    return defaults;
  }
}

function loadAssignedOffice(userId: string, fallbackOffice: string) {
  if (typeof window === "undefined") return fallbackOffice;
  return window.localStorage.getItem(`ahs:assigned-office:${userId}`) || fallbackOffice;
}

type EmployeeInfoState = {
  bankName: string;
  routingNumber: string;
  accountNumber: string;
  photoName: string;
  photoDataUrl: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zipCode: string;
  employeeId: string;
  employeeSsn: string;
  employeeSalary: string;
  birthDate: string;
  hireDate: string;
  terminateDate: string;
  employeeNote: string;
  attachments: string[];
};

type AccountInfoRow = {
  id: string;
  account: string;
  technicianId: string;
  technicianName: string;
  groupKey: string;
  techKey: string;
};

function formatTechnicianName(value: string) {
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[parts.length - 1].toUpperCase()},${parts[0].toUpperCase()}`;
  }
  return value.toUpperCase();
}

function buildAccountInfoDefaults(user: { id: string; userName: string }) {
  return [
    {
      id: "account-row-1",
      account: "SB",
      technicianId: user.id,
      technicianName: `${user.id} - ${formatTechnicianName(user.userName)}`,
      groupKey: "",
      techKey: "",
    },
    {
      id: "account-row-2",
      account: "SP",
      technicianId: "1290884",
      technicianName: "",
      groupKey: "GE_Memphis",
      techKey: "",
    },
  ] satisfies AccountInfoRow[];
}

function loadAccountInfo(user: { id: string; userName: string }) {
  const defaults = buildAccountInfoDefaults(user);
  if (typeof window === "undefined") return defaults;
  const raw = window.localStorage.getItem(`ahs:account-info:${user.id}`);
  if (!raw) return defaults;

  try {
    const parsed = JSON.parse(raw) as Partial<{ rows: AccountInfoRow[] }>;
    if (!Array.isArray(parsed.rows)) return defaults;
    return parsed.rows
      .filter((row): row is AccountInfoRow => Boolean(row && row.id))
      .map((row, index) => ({
        id: row.id || `account-row-${index + 1}`,
        account: row.account || "SB",
        technicianId: row.technicianId || "",
        technicianName: row.technicianName || "",
        groupKey: row.groupKey || "",
        techKey: row.techKey || "",
      }));
  } catch {
    return defaults;
  }
}

function saveAccountInfo(userId: string, rows: AccountInfoRow[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`ahs:account-info:${userId}`, JSON.stringify({ rows }));
}

function buildEmployeeInfoDefaults(user: { id: string; userName: string; office: string; email?: string | null }) {
  const seed = hashString(`${user.id}${user.userName}${user.office}`);
  const bankNames = ["First National Bank", "Community Trust", "Pioneer Federal", "Summit Bank"];
  const streetNames = ["Oak", "Maple", "Cedar", "Pine", "Hillcrest", "Sunset"];
  const cityNames = [user.office, "Memphis", "Nashville", "Birmingham", "Atlanta"];
  const stateCodes = ["TN", "AL", "GA", "MS", "NC", "SC"];
  return {
    bankName: bankNames[seed % bankNames.length],
    routingNumber: String(100000000 + (seed % 900000000)),
    accountNumber: String(10000000 + (seed % 90000000)),
    photoName: "",
    photoDataUrl: "",
    address1: `${100 + (seed % 800)} ${streetNames[seed % streetNames.length]} St`,
    address2: "",
    city: cityNames[seed % cityNames.length],
    state: stateCodes[seed % stateCodes.length],
    zipCode: String(10000 + (seed % 89999)),
    employeeId: user.id,
    employeeSsn: `${String(100 + (seed % 900))}-${String(10 + (seed % 90))}-${String(1000 + (seed % 9000))}`,
    employeeSalary: String(45000 + (seed % 40000)),
    birthDate: buildDob(user.id),
    hireDate: `01/${String((seed % 28) + 1).padStart(2, "0")}/2022`,
    terminateDate: "",
    employeeNote: "",
    attachments: [] as string[],
  } satisfies EmployeeInfoState;
}

function loadEmployeeInfo(user: { id: string; userName: string; office: string; email?: string | null }) {
  const defaults = buildEmployeeInfoDefaults(user);
  if (typeof window === "undefined") return defaults;
  const keys = [
    `ahs:employee-info:${user.id}`,
    user.email ? `ahs:employee-info-email:${user.email.trim().toLowerCase()}` : "",
  ].filter(Boolean) as string[];

  const raw = keys.map((key) => window.localStorage.getItem(key)).find(Boolean);
  if (!raw) return defaults;

  try {
    const parsed = JSON.parse(raw) as Partial<EmployeeInfoState>;
    return {
      ...defaults,
      ...parsed,
      attachments: Array.isArray(parsed.attachments) ? parsed.attachments.filter((attachment) => typeof attachment === "string") : defaults.attachments,
    } satisfies EmployeeInfoState;
  } catch {
    return defaults;
  }
}

function formatEmployeeAddress(employeeInfo: EmployeeInfoState) {
  const firstLine = [employeeInfo.address1, employeeInfo.address2].filter(Boolean).join(" ");
  const secondLine = [employeeInfo.city, employeeInfo.state, employeeInfo.zipCode].filter(Boolean).join(" ");
  return [firstLine, secondLine].filter(Boolean).join(", ");
}

function saveEmployeeInfoToStorage(userId: string, email: string | undefined | null, employeeInfo: EmployeeInfoState) {
  if (typeof window === "undefined") return;
  const serialized = JSON.stringify(employeeInfo);
  window.localStorage.setItem(`ahs:employee-info:${userId}`, serialized);
  if (email) {
    window.localStorage.setItem(`ahs:employee-info-email:${email.trim().toLowerCase()}`, serialized);
  }
}

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
    for (const o of options) m[normalizeRole(o.value)] = o.label;
    return m;
  }, [options]);
  // Some profiles still carry a legacy free-text role (e.g. "CSR Manager"
  // instead of the canonical "CSR_MANAGER") — compared by exact string, that
  // value would match none of this list's option values, so its checkbox
  // never showed checked and it could never be toggled off, leaving the
  // primary role stuck on that legacy value forever. Comparing normalized
  // forms instead means the matching canonical option shows checked (and
  // can be unchecked) no matter which form is actually stored.
  const toggle = (val: string) => {
    const norm = normalizeRole(val);
    onChange(
      values.some((v) => normalizeRole(v) === norm)
        ? values.filter((v) => normalizeRole(v) !== norm)
        : [...values, val]
    );
  };
  // Reorders `values` so this already-held role becomes index 0 (the
  // primary) without touching which roles are held — a no-op if it's not
  // checked or is already primary.
  const promote = (val: string) => {
    const norm = normalizeRole(val);
    const idx = values.findIndex((v) => normalizeRole(v) === norm);
    if (idx <= 0) return;
    const next = [...values];
    const [item] = next.splice(idx, 1);
    next.unshift(item);
    onChange(next);
  };
  const summary = values.length
    ? `${values.length} selected: ${values.map((v) => labelByValue[normalizeRole(v)] || v).join(", ")}`
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
            const checked = values.some((v) => normalizeRole(v) === normalizeRole(opt.value));
            const isPrimary = values.length > 0 && normalizeRole(values[0]) === normalizeRole(opt.value);
            return (
              <div key={opt.value} className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-white/10">
                <button
                  type="button"
                  onClick={() => toggle(opt.value)}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left"
                >
                  <span className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${checked ? "bg-blue-500 border-blue-500" : "border-white/30"}`}>
                    {checked && <Check className="h-3 w-3 text-white" />}
                  </span>
                  <span className="text-slate-200 flex-1 truncate">{opt.label}</span>
                </button>
                {isPrimary ? (
                  <span className="text-[9px] font-semibold uppercase text-blue-300 shrink-0">primary</span>
                ) : checked ? (
                  <button
                    type="button"
                    onClick={() => promote(opt.value)}
                    className="text-[9px] font-semibold uppercase text-slate-400 hover:text-blue-300 shrink-0"
                  >
                    Set primary
                  </button>
                ) : null}
              </div>
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

// Only these roles may open an employee's detail/edit page at all — every
// field here (Role, Direct Manager, Status, branch, work plan, ...) can
// reshape the org hierarchy or someone's access, so it isn't limited to
// just the email field like canEditEmail below. Checked against primary
// role OR any extra_roles entry, same "holding it either way counts"
// convention as everywhere else in this file.
const ACCOUNT_EDIT_ROLES = new Set(["ADMIN", "SUPERADMIN", "SUPERSUPERADMIN", "HR", "FINANCE"]);
function canEditAccountDetails(role: string | null | undefined, extraRoles: string[] | null | undefined): boolean {
  const held = [role, ...(extraRoles ?? [])].map((r) => normalizeRole(r));
  return held.some((r) => ACCOUNT_EDIT_ROLES.has(r));
}

function UserDetailsPage() {
  const { module, submodule, userId } = Route.useLoaderData();
  const { ready, role: viewerRole, extraRoles: viewerExtraRoles, displayName: viewerDisplayName, email: viewerEmail } = useAuth();
  const navigate = useNavigate();
  // Built-in roles plus any company-created custom roles (Accessibility
  // Management's "Add Role" — see src/lib/customRoles.ts).
  const roleOptions = useAllRoleOptions();
  const hasAccountAccess = canEditAccountDetails(viewerRole, viewerExtraRoles);
  // Only Admin/SuperAdmin may edit a user's email — it's the actual Firebase
  // Auth login credential (landing.tsx's username-login path resolves a
  // username to profiles.email before calling Firebase), not just contact
  // info, so changing it has to go through /api/admin-update-email (see
  // adminUpdateEmailBridge.ts) rather than a plain Supabase field edit.
  // Held against primary role OR any extra_roles entry, same convention as
  // canEditAccountDetails above.
  const canEditEmail = [viewerRole, ...(viewerExtraRoles ?? [])].some((r) => normalizeRole(r) === "ADMIN" || normalizeRole(r) === "SUPERADMIN");

  const [loading, setLoading] = useState(true);
  const [notFoundUser, setNotFoundUser] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string>("");
  // The email as loaded from the server — compared against form.email in
  // handleSave to know whether the Firebase Auth update call is needed at all.
  const [originalEmail, setOriginalEmail] = useState<string>("");
  const [seqId, setSeqId] = useState<string>("");
  const [managerCandidates, setManagerCandidates] = useState<string[]>([]);
  const [activeTab, setActiveTab] = usePersistedTab<(typeof USER_TABS)[number]>(
    `ahs:user-details-active-tab:${userId}`,
    USER_TABS,
    "General Information",
  );
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
    requiredCheckIn: "",
    requiredCheckOut: "",
    workingHours: "",
    mealMinutes: "",
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
        setOriginalEmail(p.email || "");
        try {
          const all = await getCompanyUsers();
          const idx = all.findIndex((u) => u.id === p.id);
          setSeqId(idx >= 0 ? String(idx + 1) : "");
          // Manager dropdown candidates: real users with a manager-ish or
          // admin role, not a hardcoded name list. Stored as free-text
          // (manager_name matched against real profiles by display name —
          // see resolveTeamLeadOrManager in src/lib/notifyRouting.ts).
          // Checked against the user's FULL role set (primary + extra_roles),
          // not just the primary role — a user whose primary role is e.g.
          // "Claims Team Leader" but who also holds "Claims Manager" as a
          // secondary role should still be selectable.
          const isManagerish = (r: string | null | undefined) => {
            const v = (r || "").toUpperCase();
            return v === "ADMIN" || v === "SUPERADMIN" || v.includes("MANAGER");
          };
          const eligible = all.filter((u) => u.is_active && [u.role, ...(u.extra_roles ?? [])].some(isManagerish));
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
          requiredCheckIn: p.required_check_in || "",
          requiredCheckOut: p.required_check_out || "",
          workingHours: p.working_hours != null ? String(p.working_hours) : "",
          mealMinutes: p.meal_minutes != null ? String(p.meal_minutes) : "",
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
      // branch_access had no edit path anywhere in this page before - it
      // could only ever be set once, at user creation, and then silently
      // drifted out of sync with whatever the Work Plan tab actually said
      // (that's how a profile can end up with branch_access holding a
      // stray value that bears no relation to its real work plan). Deriving
      // it fresh from the work plan on every save, the same way the
      // location-restriction check itself does (see accessibleLocations,
      // used by src/lib/auth.tsx), keeps the two permanently in sync
      // instead of just fixing today's snapshot.
      const branchAccess = (accessibleLocations(workPlan) ?? []).join("|");
      const newUsername = form.username.trim();

      // Email changed — update the ACTUAL Firebase Auth credential first via
      // the admin-only server endpoint. Only once that succeeds do we fold
      // the new address into the Supabase update below, so profiles.email
      // and Firebase Auth never end up desynced from a partial failure.
      const emailChanged = canEditEmail && form.email.trim() !== originalEmail.trim();
      if (emailChanged) {
        const idToken = await firebaseAuth?.currentUser?.getIdToken();
        if (!idToken) throw new Error("Could not verify your session. Please re-login and try again.");
        const res = await fetch("/api/admin-update-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken, targetProfileId: profileId, newEmail: form.email.trim() }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Failed to update login email");
      }

      await updateCompanyUser(profileId, {
        username: newUsername,
        displayName: form.displayName,
        ...(emailChanged ? { email: form.email.trim() } : {}),
        role: primaryRole,
        extraRoles,
        phoneNumber: form.phoneNumber,
        managerName: form.managerName,
        assignedBranch: form.assignedBranch,
        branchAccess,
        emailReportLocation: form.emailReportLocation,
        technicianId: form.technicianId,
        poInitials: form.poInitials,
        smsStatus: form.smsStatus,
        offDays: form.offDays,
        workPlan: workPlan,
        isActive: form.isActive,
        requiredCheckIn: form.requiredCheckIn,
        requiredCheckOut: form.requiredCheckOut,
        workingHours: form.workingHours.trim() ? Number(form.workingHours) : null,
        mealMinutes: form.mealMinutes.trim() ? Number(form.mealMinutes) : null,
      });
      if (emailChanged) setOriginalEmail(form.email.trim());
      // Persist Employee Information (powers Work Map house pins).
      try {
        const { saveProfileEmployeeInfo } = await import("@/lib/supabase/users");
        await saveProfileEmployeeInfo(profileId, employeeInfo as any);
      } catch (e) {
        console.warn("Employee info save skipped:", e);
      }
      setStatus("Saved.");
      void logModuleActivity({
        module: "user-management",
        actorName: viewerDisplayName || viewerEmail || "Admin",
        action: "user_edited",
        targetType: "profile",
        targetId: profileId,
        targetLabel: form.displayName || newUsername || userId,
        details: { role: primaryRole, extraRoles, isActive: form.isActive },
      });
      // The URL is keyed by username (userId route param) - if it just
      // changed, the address bar is now stale (a refresh would 404 via
      // getProfileByUsername). Move to the new URL so it keeps working.
      if (newUsername && newUsername.toLowerCase() !== userId.toLowerCase()) {
        void navigate({
          to: "/m/$module/$submodule/$userId",
          params: { module: module.slug, submodule: submodule.slug, userId: newUsername },
          replace: true,
        });
      }
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

  if (ready && !hasAccountAccess) {
    return (
      <>
        <AppHeader />
        <main className="flex-1 bg-slate-950 py-6">
          <div className="max-w-5xl mx-auto px-6">
            <div className="rounded-xl border border-white/15 bg-white/8 p-6 text-white backdrop-blur-md">
              <h1 className="text-2xl font-bold mb-2">Access restricted</h1>
              <p className="text-slate-300">Only Admin, Super Admin, and HR can view or edit employee details.</p>
              <p className="mt-2 text-sm text-slate-400">Current sign-in: {viewerEmail}</p>
              <p className="mt-1 text-sm text-slate-400">Your role: {viewerRole || "No role assigned"}</p>
            </div>
          </div>
        </main>
        <Footer />
      </>
    );
  }

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
                      {textField("Login ID", "username", { note: "(used to log in — must stay unique)" })}

                      <label className="space-y-1.5 text-sm">
                        <span className={labelCls}>User Type <span className="normal-case text-[10px] text-slate-500">(tick all that apply — first ticked is primary)</span></span>
                        <RoleMultiSelect
                          values={form.roles}
                          options={roleOptions}
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
                      {textField("Technician ID", "technicianId")}

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
                        <span className={labelCls}>
                          Email
                          {canEditEmail && (
                            <span className="normal-case text-[10px] text-slate-500"> (this is the login credential — changing it updates their sign-in email too)</span>
                          )}
                        </span>
                        {canEditEmail ? (
                          <input
                            type="email"
                            value={form.email}
                            onChange={(e) => update("email", e.target.value)}
                            className={inputCls}
                          />
                        ) : (
                          <input value={form.email} disabled className={readonlyCls} />
                        )}
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
                      {textField("Time In Required", "requiredCheckIn", { type: "time" })}
                      {textField("Time Out Required", "requiredCheckOut", { type: "time" })}
                      {textField("Working Hours", "workingHours", { type: "number", note: "overrides Time In/Out for meal eligibility" })}
                      {textField("Meal Time (minutes)", "mealMinutes", { type: "number" })}
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
                        {empField("Account Name", "accountName")}
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