/**
 * Supabase user/profile service.
 *
 * Model:
 *  - Firebase Auth owns the login credential (email/password) + uid.
 *  - Supabase `profiles` stores who that uid is: company, role, username, etc.
 *  - RLS auto-scopes every read/write to the caller's company.
 *
 * Creating a user:
 *  - We create the Firebase Auth credential using a SECONDARY Firebase app so
 *    the currently logged-in admin is NOT signed out.
 *  - Then we insert the matching row into Supabase `profiles`.
 */

import { initializeApp, deleteApp, getApps } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword } from "firebase/auth";
import { supabase } from "./client";
import { getCompanyUsers as getFirestoreCompanyUsers } from "@/lib/firebase/users";

export type UserRole =
  | "SUPERSUPERADMIN" // Platform-level: access to all companies, creates/manages companies+admins
  | "SUPERADMIN"    // Per-company: same as ADMIN, plus can edit its own company's record
  | "ADMIN"         // Company admin, full access to company data
  | "MANAGER"       // Can manage tickets, employees, reports
  | "SENIOR_MANAGER" // Senior tier of MANAGER (generic, not branch/BizOps-specific)
  | "CSR"           // Customer Service Rep, ticket management
  | "TECHNICIAN"    // Field technician
  | "TECHNICIAN_MANAGER" // Field technician manager (supervises techs)
  | "DISPATCHER"    // Dispatch management
  | "HR"            // HR and payroll access
  | "IT"            // IT support
  | "PARTS"         // Parts management
  | "FINANCE"       // Financial reports and billing
  | "CSR_AGENT" | "CSR_TEAM_LEADER" | "CSR_MANAGER"
  | "BRANCH_MANAGER" | "SENIOR_BRANCH_MANAGER" | "CLAIMS_MANAGER"
  | "PARTS_MANAGER" | "PARTS_TEAM_LEADER" | "PARTS_ORDER" | "BIZOPS_MANAGER" | "BIZOPS_SENIOR_MANAGER" | "CLAIMS"
  | "TRIAGE_USER" | "TRIAGE_MANAGER" | "TECHNICAL_DIRECTOR" | "TECHNICAL_ASSISTANT_DIRECTOR" | "CLAIMS_TEAM_LEADER"
  | "SENIOR_DIRECTOR" | "ASSISTANT_MANAGER";

export interface ProfileRow {
  id: string;
  firebase_uid: string;
  company_id: string;
  email: string;
  username: string | null;
  display_name: string | null;
  role: UserRole;
  /** Additional roles beyond the primary one. Stored as text[] in Postgres. */
  extra_roles: UserRole[] | null;
  phone_number: string | null;
  department: string | null;
  manager_name: string | null;
  assigned_branch: string | null;
  branch_access: string | null;
  technician_id: string | null;
  po_initials: string | null;
  email_report_location: string | null;
  sms_status: string | null;
  off_days: number[] | null;
  required_check_in: string | null;
  required_check_out: string | null;
  /** Explicit override for the Time In/Out-derived scheduled shift length — see migration 0109. */
  working_hours: number | null;
  /** How many minutes this person's meal break should be. Not enforced anywhere yet, just stored/shown. */
  meal_minutes: number | null;
  /** Which zone required_check_in/required_check_out are actually in — "CST" or "EST". See migration 0155. */
  schedule_timezone: "CST" | "EST" | null;
  /** Extra Master List department tabs this person also shows up under, on top of their real/primary one. See migration 0159. */
  master_list_extra_departments: string[] | null;
  /** Personal (non-company) email — Staff List's per-branch tab. See migration 0162. */
  personal_email: string | null;
  /** A second phone number, distinct from phone_number — Staff List's per-branch tab. See migration 0162. */
  work_phone: string | null;
  /** Technician skill tier (e.g. "Tier 2") — NOT an org role, just free text from Staff List. See migration 0162. */
  tier_level: string | null;
  /** Free-text note shown on Staff List's per-branch tab. See migration 0162. */
  staff_note: string | null;
  /** Heartbeat/activity presence — see migration 0163 and touchPresenceSeen/touchPresenceActive. */
  presence_seen_at: string | null;
  presence_active_at: string | null;
  work_plan: Record<string, any> | null;
  /** Trainee vs Regular — see migration 0152. Fetched separately/best-effort in getCompanyUsers (like working_hours/meal_minutes below), so it defaults to "regular" instead of breaking the whole roster if that migration hasn't been run yet. */
  employment_type: "trainee" | "regular";
  is_active: boolean;
  /** Set by AdminUserManagementPage.tsx's Reset Password actions — see migration 0103. Forces a redirect to /profile until they change it (__root.tsx). */
  must_change_password: boolean;
  /** Consecutive failed sign-in attempts — see migration 0122 / loginLockoutBridge.ts. Resets to 0 on a successful login. */
  failed_login_count: number;
  /** Set once failed_login_count reaches 5; the account can't sign in again until this passes (or an admin clicks "Unlock Now" on LoginLockoutsPage.tsx). */
  locked_until: string | null;
  created_at: string;
}

/**
 * Generate username from display name: "Jhon Norban Rulona" -> "Jhon.Rulona"
 */
export function generateUsername(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts[0]}.${parts[parts.length - 1]}`;
}

/**
 * Get the profile for a Firebase uid (for login). Returns the auth-relevant fields.
 * Uses the company legacy_code as the companyId the rest of the app expects.
 * companyLoginAlias is a second, optional string that also works as the
 * "Company ID" typed at login (see migration 0066).
 */
export async function getProfileForLogin(firebaseUid: string): Promise<{
  email: string;
  companyId: string;
  companyLoginAlias: string | null;
  /** false only when this profile's company has been frozen (companies.is_active
   *  = false) — true (never blocks) when there's no company at all, i.e. the
   *  platform SUPERSUPERADMIN, who isn't subject to company freezes. */
  companyIsActive: boolean;
  role: string;
  /** Secondary roles this profile also holds, beyond the primary `role` — see getMyRoles(). Selected in the same row fetch as everything else here, so this is free (no extra round trip). */
  extraRoles: string[];
  displayName: string;
  isActive: boolean;
  workPlan: Record<string, any> | null;
  branchAccess: string | null;
  mustChangePassword: boolean;
} | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("email, role, extra_roles, display_name, is_active, work_plan, branch_access, must_change_password, companies:company_id (legacy_code, login_alias, is_active)")
    .eq("firebase_uid", firebaseUid)
    .maybeSingle();

  if (error) {
    console.error("getProfileForLogin error:", error.message);
    return null;
  }
  if (!data) return null;

  const legacyCode = (data as any).companies?.legacy_code ?? "";
  const loginAlias = (data as any).companies?.login_alias ?? null;
  const companyIsActive = (data as any).companies?.is_active ?? true;
  return {
    email: data.email,
    companyId: legacyCode,
    companyLoginAlias: loginAlias,
    companyIsActive,
    role: data.role,
    extraRoles: ((data as any).extra_roles as string[] | null) ?? [],
    displayName: data.display_name ?? data.email,
    isActive: data.is_active,
    workPlan: (data as any).work_plan ?? null,
    branchAccess: (data as any).branch_access ?? null,
    mustChangePassword: (data as any).must_change_password ?? false,
  };
}

/**
 * Force (or clear) "must change password on next login" for one or more
 * profiles — see migration 0103. Used by AdminUserManagementPage.tsx's
 * Reset Password / Reset All Passwords actions (value=true), and by
 * profile.tsx after a successful self-service password change (value=false).
 */
export async function setMustChangePassword(profileIds: string[], value: boolean): Promise<void> {
  if (profileIds.length === 0) return;
  const { error } = await supabase.from("profiles").update({ must_change_password: value }).in("id", profileIds);
  if (error) throw new Error(error.message);
}

/** Clears the caller's own must_change_password flag by Firebase uid — used right after a successful self-service password change. */
export async function clearMyMustChangePassword(firebaseUid: string): Promise<void> {
  const { error } = await supabase.from("profiles").update({ must_change_password: false }).eq("firebase_uid", firebaseUid);
  if (error) throw new Error(error.message);
}

/** Update a profile's last login timestamp (best-effort). */
export async function touchLastLogin(firebaseUid: string): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ last_login: new Date().toISOString() })
    .eq("firebase_uid", firebaseUid);
  if (error) console.warn("touchLastLogin skipped:", error.message);
}

/**
 * Presence heartbeat (migration 0163) — written every ~60s while the app
 * is open, regardless of activity. Master List's Online/Idle/Offline
 * column treats a stale presence_seen_at as Offline (see auth.tsx for the
 * interval that calls this).
 */
export async function touchPresenceSeen(firebaseUid: string): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ presence_seen_at: new Date().toISOString() })
    .eq("firebase_uid", firebaseUid);
  if (error) console.warn("touchPresenceSeen skipped:", error.message);
}

/**
 * Presence activity (migration 0163) — written only on real user
 * interaction (mouse/keyboard/scroll/touch), throttled client-side.
 * Master List treats a stale presence_active_at (but fresh
 * presence_seen_at) as Idle.
 */
export async function touchPresenceActive(firebaseUid: string): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ presence_active_at: new Date().toISOString() })
    .eq("firebase_uid", firebaseUid);
  if (error) console.warn("touchPresenceActive skipped:", error.message);
}

/**
 * Look up a user's email by username within a company (by legacy company code).
 * Used for username login BEFORE authentication — so there is no Supabase
 * session yet and RLS would block a direct table read. We call a SECURITY
 * DEFINER RPC (`login_email_for_username`) that safely resolves the username
 * to a single email without leaking any other company data.
 */
export async function getUserByUsername(
  username: string,
  companyLegacyCode: string
): Promise<{ email: string; isActive: boolean } | null> {
  const { data, error } = await supabase.rpc("login_email_for_username", {
    p_username: username,
    p_company_code: companyLegacyCode,
  });
  if (error) {
    // Surface the real reason. A missing function (migration not run) reports
    // a 404/"function ... does not exist" here — very different from a genuine
    // "no matching user".
    console.error("getUserByUsername RPC error:", error);
    throw new Error(`Username lookup failed: ${error.message}`);
  }
  // RPC returns the email string (or null) for an active matching profile.
  if (!data) return null;
  return { email: data as string, isActive: true };
}

/**
 * Is this Company ID currently valid for any company? Called only after
 * getUserByUsername comes back empty, to tell the user "wrong company
 * code" apart from "wrong username" instead of always blaming the
 * username.
 */
export async function isValidCompanyCode(companyCode: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("login_company_code_is_valid", {
    p_company_code: companyCode,
  });
  if (error) {
    console.error("isValidCompanyCode RPC error:", error);
    // Fail open — don't invent a "wrong company code" message off a broken check.
    return true;
  }
  return Boolean(data);
}

/**
 * Resolve the current user's Supabase profile id (uuid) from their Firebase
 * uid. Cheap, scoped by RLS. Returns null if the profile hasn't been created
 * yet (e.g. legacy Firebase-only user pre-migration).
 */
export async function getMyProfileId(firebaseUid: string): Promise<string | null> {
  if (!firebaseUid) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("firebase_uid", firebaseUid)
    .maybeSingle();
  if (error) {
    console.error("getMyProfileId error:", error.message);
    return null;
  }
  return data?.id ?? null;
}

/**
 * Resolve the current user's primary role + extra_roles from their Firebase
 * uid. Used by page-level role gates (useAuth().role alone doesn't carry
 * extra_roles — see getProfileForLogin).
 */
export async function getMyRoles(firebaseUid: string): Promise<{ role: string | null; extraRoles: string[] }> {
  if (!firebaseUid) return { role: null, extraRoles: [] };
  const { data, error } = await supabase
    .from("profiles")
    .select("role, extra_roles")
    .eq("firebase_uid", firebaseUid)
    .maybeSingle();
  if (error) {
    console.error("getMyRoles error:", error.message);
    return { role: null, extraRoles: [] };
  }
  return { role: (data?.role as string | undefined) ?? null, extraRoles: (data?.extra_roles as string[] | null) ?? [] };
}

/**
 * Firebase uids of every profile with roleCode as either their PRIMARY
 * role or one of their extra_roles — for notification fan-out that needs
 * to reach secondary-role holders too, not just the primary-role lookup
 * Firestore's users_index.userType supports (see getUidsForFirestoreRole
 * in lib/firebase/notifications.ts). No company_id filter needed:
 * profiles_select RLS already scopes plain selects to the caller's own
 * company.
 */
export async function getFirebaseUidsForRole(roleCode: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("firebase_uid, role, extra_roles")
    .or(`role.eq.${roleCode},extra_roles.cs.{${roleCode}}`);
  if (error) {
    console.error("getFirebaseUidsForRole error:", error.message);
    return [];
  }
  return (data ?? []).map((r: any) => r.firebase_uid as string).filter(Boolean);
}

/**
 * The caller's own editable account fields — used by the self-service
 * /profile page. Distinct from getProfileForLogin (login-time only, no
 * phone/department/branch) and getMyProfileSchedule (schedule fields only).
 */
export async function getMyFullProfile(firebaseUid: string): Promise<{
  profileId: string;
  email: string;
  displayName: string;
  phoneNumber: string;
  department: string;
  assignedBranch: string;
  poInitials: string;
  role: string;
  requiredCheckIn: string;
  requiredCheckOut: string;
  scheduleTimezone: "CST" | "EST";
  workingHours: number | null;
  mealMinutes: number | null;
} | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, display_name, phone_number, department, assigned_branch, po_initials, role, required_check_in, required_check_out")
    .eq("firebase_uid", firebaseUid)
    .maybeSingle();
  if (error) {
    console.error("getMyFullProfile error:", error.message);
    return null;
  }
  if (!data) return null;

  // Fetched separately, best-effort — if migration 0109 hasn't been applied
  // yet (or any future optional column has an issue), that must never take
  // down the rest of this profile (name/phone/department/etc), which is
  // exactly what happened when this was one combined select: a single
  // column-not-found error nulled out the ENTIRE profile, breaking Save
  // ("Could not resolve your profile") for fields that have nothing to do
  // with Working Hours/Meal Time.
  let workingHours: number | null = null;
  let mealMinutes: number | null = null;
  let scheduleTimezone: "CST" | "EST" = "CST";
  const { data: extra, error: extraError } = await supabase
    .from("profiles")
    .select("working_hours, meal_minutes, schedule_timezone")
    .eq("id", data.id)
    .maybeSingle();
  if (extraError) {
    console.error("getMyFullProfile (working_hours/meal_minutes/schedule_timezone) error:", extraError.message);
  } else {
    workingHours = extra?.working_hours ?? null;
    mealMinutes = extra?.meal_minutes ?? null;
    scheduleTimezone = (extra?.schedule_timezone as "CST" | "EST" | null) ?? "CST";
  }

  return {
    profileId: data.id,
    email: data.email,
    displayName: data.display_name ?? "",
    phoneNumber: data.phone_number ?? "",
    department: data.department ?? "",
    assignedBranch: data.assigned_branch ?? "",
    poInitials: data.po_initials ?? "",
    role: data.role,
    requiredCheckIn: data.required_check_in ?? "",
    requiredCheckOut: data.required_check_out ?? "",
    scheduleTimezone,
    workingHours,
    mealMinutes,
  };
}

export async function getCompanyUsers(): Promise<ProfileRow[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, firebase_uid, company_id, email, username, display_name, role, extra_roles, phone_number, department, manager_name, assigned_branch, branch_access, technician_id, po_initials, off_days, work_plan, required_check_in, required_check_out, is_active, must_change_password, failed_login_count, locked_until, created_at")
    // Only the platform-level SUPERSUPERADMIN is excluded here — the new
    // per-company SUPERADMIN role is a real company employee and should
    // show up in the roster like any ADMIN.
    .neq("role", "SUPERSUPERADMIN")
    .order("display_name", { ascending: true });

  if (error) {
    console.error("getCompanyUsers error:", error.message);
    throw new Error(error.message);
  }
  const rows = (data ?? []) as ProfileRow[];

  // Fetched separately, best-effort — see getMyFullProfile's comment on why
  // working_hours/meal_minutes (migration 0109) must never be combined into
  // the main select: this function is used across many pages (User
  // Management, Payroll, etc), so a missing/future column here must not be
  // able to break all of them at once.
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    // Two SEPARATE best-effort queries, not one combined select — if
    // migration 0162's newer columns (personal_email/work_phone/
    // tier_level/staff_note) haven't been run yet, a single combined
    // query errors out as a whole and would silently null out
    // working_hours/meal_minutes too (they've existed since 0109 and may
    // have real data) even though only the newer columns are missing.
    const [{ data: hoursRows, error: hoursError }, { data: staffListRows, error: staffListError }, { data: presenceRows, error: presenceError }] = await Promise.all([
      supabase.from("profiles").select("id, working_hours, meal_minutes, schedule_timezone, master_list_extra_departments").in("id", ids),
      supabase.from("profiles").select("id, personal_email, work_phone, tier_level, staff_note").in("id", ids),
      supabase.from("profiles").select("id, presence_seen_at, presence_active_at").in("id", ids),
    ]);
    if (hoursError) {
      console.error("getCompanyUsers (working_hours/meal_minutes/schedule_timezone/master_list_extra_departments) error:", hoursError.message);
    }
    if (staffListError) {
      console.error("getCompanyUsers (personal_email/work_phone/tier_level/staff_note) error:", staffListError.message);
    }
    if (presenceError) {
      console.error("getCompanyUsers (presence_seen_at/presence_active_at) error:", presenceError.message);
    }
    {
      const hoursById = new Map((hoursRows ?? []).map((r: any) => [r.id, r]));
      const staffListById = new Map((staffListRows ?? []).map((r: any) => [r.id, r]));
      const presenceById = new Map((presenceRows ?? []).map((r: any) => [r.id, r]));
      for (const row of rows) {
        const hours = hoursById.get(row.id);
        row.working_hours = hours?.working_hours ?? null;
        row.meal_minutes = hours?.meal_minutes ?? null;
        row.schedule_timezone = hours?.schedule_timezone ?? null;
        row.master_list_extra_departments = hours?.master_list_extra_departments ?? [];
        const staffList = staffListById.get(row.id);
        row.personal_email = staffList?.personal_email ?? null;
        row.work_phone = staffList?.work_phone ?? null;
        row.tier_level = staffList?.tier_level ?? null;
        row.staff_note = staffList?.staff_note ?? null;
        const presence = presenceById.get(row.id);
        row.presence_seen_at = presence?.presence_seen_at ?? null;
        row.presence_active_at = presence?.presence_active_at ?? null;
      }
    }
  }

  // Same best-effort pattern, in its OWN separate query (not merged into the
  // one above) — employment_type (migration 0152) is newer/optional, so it
  // must not be able to break working_hours/meal_minutes (or the rest of
  // this function's callers) if that migration hasn't been run yet.
  for (const row of rows) row.employment_type = "regular";
  if (rows.length > 0) {
    const { data: empTypeRows, error: empTypeError } = await supabase
      .from("profiles")
      .select("id, employment_type")
      .in("id", rows.map((r) => r.id));
    if (empTypeError) {
      console.error("getCompanyUsers (employment_type) error:", empTypeError.message);
    } else {
      const empTypeById = new Map((empTypeRows ?? []).map((r: any) => [r.id, r.employment_type]));
      for (const row of rows) {
        row.employment_type = empTypeById.get(row.id) ?? "regular";
      }
    }
  }
  return rows;
}

/** One real, active technician — canonical shape returned by getCompanyTechnicians(). */
export interface TechnicianOption {
  name: string;
  /** assigned_branch, for branch-scoped views (Work Planner columns, Work Map's per-location list). "" if unset. */
  branch: string;
}

/**
 * Real, active technicians for the caller's company — role === "TECHNICIAN"
 * or "TECHNICIAN_MANAGER", whether that's the primary role or a secondary
 * one (extra_roles). Canonical live source for every technician dropdown/
 * roster in the app, replacing the old hand-maintained static list
 * (TECHNICIANS_BY_LOCATION / ALL_TECHNICIANS in src/lib/locations.ts),
 * which needed a manual code edit on every hire/departure and silently
 * drifted from who's actually active.
 */
export async function getCompanyTechnicians(): Promise<TechnicianOption[]> {
  const users = await getCompanyUsers();
  return users
    .filter((u) => {
      const roles = [u.role, ...(u.extra_roles ?? [])].map((r) => (r || "").toUpperCase());
      return u.is_active && (roles.includes("TECHNICIAN") || roles.includes("TECHNICIAN_MANAGER"));
    })
    .map((u) => ({ name: u.display_name || u.email, branch: u.assigned_branch || "" }))
    .filter((t) => t.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface EmployeeInfo {
  bankName?: string;
  routingNumber?: string;
  accountNumber?: string;
  /** Name on the bank account — not always the employee's own name (e.g. a joint account). */
  accountName?: string;
  photoName?: string;
  photoDataUrl?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  employeeId?: string;
  employeeSsn?: string;
  employeeSalary?: string;
  birthDate?: string;
  hireDate?: string;
  terminateDate?: string;
  employeeNote?: string;
  attachments?: string[];
  employmentStatus?: "active" | "inactive" | "terminated" | "resigned";
  employmentStatusDate?: string;
  /** Onboarding Documents checklist — keyed by document name (e.g. "W4"), true = collected. */
  onboardingDocs?: Record<string, boolean>;
}

/** Load the employee_info JSON for a profile (by profile id). */
export async function getProfileEmployeeInfo(profileId: string): Promise<EmployeeInfo | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("employee_info")
    .eq("id", profileId)
    .maybeSingle();
  if (error) {
    console.error("getProfileEmployeeInfo error:", error.message);
    return null;
  }
  const info = (data as any)?.employee_info;
  return info && typeof info === "object" ? (info as EmployeeInfo) : null;
}

/**
 * Bulk-load employee_info for a set of profiles in one query — used by
 * employee-list views (e.g. HR & Recruitment Dashboard) that need each
 * row's hire date without paying for employee_info (which can carry a
 * base64 photoDataUrl) on every getCompanyUsers() call.
 */
export async function getEmployeeInfoByProfileIds(profileIds: string[]): Promise<Map<string, EmployeeInfo>> {
  const out = new Map<string, EmployeeInfo>();
  const uniq = Array.from(new Set(profileIds.filter(Boolean)));
  if (uniq.length === 0) return out;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, employee_info")
    .in("id", uniq);
  if (error) {
    console.error("getEmployeeInfoByProfileIds error:", error.message);
    return out;
  }
  for (const row of data ?? []) {
    const info = (row as any).employee_info;
    if (info && typeof info === "object") out.set((row as any).id, info as EmployeeInfo);
  }
  return out;
}

/** Save the employee_info JSON for a profile (by profile id). */
export async function saveProfileEmployeeInfo(profileId: string, info: EmployeeInfo): Promise<void> {
  // .select("id") so an RLS-blocked update (returns { error: null }, 0 rows
  // touched) throws instead of silently pretending to succeed — see
  // updateCompanyUser's matching fix for the full rationale.
  const { data, error } = await supabase
    .from("profiles")
    .update({ employee_info: info })
    .eq("id", profileId)
    .select("id");
  if (error) {
    console.error("saveProfileEmployeeInfo error:", error.message);
    throw new Error(error.message);
  }
  if (!data || data.length === 0) {
    throw new Error("This change wasn't saved — you may not have permission to edit this profile.");
  }
}

export interface TechnicianHome {
  name: string;          // display name
  branch: string;        // assigned branch / office location
  address: string;       // home street address
  city: string;
  state: string;
  zip: string;
}

/**
 * Return every TECHNICIAN-role user's home address + assigned branch for the
 * Work Map, so we can pin each tech's house under their branch. Reads
 * employee_info (home address) and assigned_branch. Company-scoped via RLS.
 */
export async function getCompanyTechnicianHomes(): Promise<TechnicianHome[]> {
  // Match either the primary `role` or any entry in `extra_roles` — a user
  // can be both a manager and a technician (Daven Hodge, for example), and
  // we want them on the Work Map regardless of which slot the TECHNICIAN
  // tag sits in.
  const { data, error } = await supabase
    .from("profiles")
    .select("display_name, username, email, role, extra_roles, assigned_branch, employee_info")
    .or("role.eq.TECHNICIAN,extra_roles.cs.{TECHNICIAN}");
  if (error) {
    console.error("getCompanyTechnicianHomes error:", error.message);
    return [];
  }
  return (data ?? []).map((row: any) => {
    const info = (row.employee_info && typeof row.employee_info === "object" ? row.employee_info : {}) as EmployeeInfo;
    const addr1 = info.address1 || "";
    const addr2 = info.address2 || "";
    return {
      name: row.display_name || row.username || row.email || "",
      branch: row.assigned_branch || info.city || "",
      address: [addr1, addr2].filter(Boolean).join(" "),
      city: info.city || "",
      state: info.state || "",
      zip: info.zipCode || "",
    } as TechnicianHome;
  });
}

/**
 * Create a new user: Firebase Auth credential (via secondary app so the admin
 * stays logged in) + Supabase profile row.
 *
 * @returns the new Firebase uid
 */
export async function createCompanyUser(input: {
  email: string;
  password: string;
  displayName: string;
  role: UserRole;
  extraRoles?: UserRole[];
  companyId?: string;
  phoneNumber?: string;
  department?: string;
  managerName?: string;
  assignedBranch?: string;
  branchAccess?: string;
  technicianId?: string;
  poInitials?: string;
  requiredCheckIn?: string;
  requiredCheckOut?: string;
  workingHours?: number;
  mealMinutes?: number;
}): Promise<string> {
  // --- 1. Create the Firebase Auth credential on a SECONDARY app ---
  const primaryApp = getApps()[0];
  if (!primaryApp) throw new Error("Firebase not initialized");

  // Reuse a named secondary app if present, else create one.
  const secondaryName = "user-provisioner";
  const existing = getApps().find((a) => a.name === secondaryName);
  const secondaryApp = existing ?? initializeApp(primaryApp.options, secondaryName);
  const secondaryAuth = getAuth(secondaryApp);

  let newUid: string;
  try {
    const cred = await createUserWithEmailAndPassword(
      secondaryAuth,
      input.email,
      input.password
    );
    newUid = cred.user.uid;
    // sign the secondary app back out so it holds no session
    await secondaryAuth.signOut();
  } catch (error: any) {
    if (error.code === "auth/email-already-in-use") throw new Error("Email already in use");
    if (error.code === "auth/weak-password") throw new Error("Password too weak (min 6 characters)");
    if (error.code === "auth/invalid-email") throw new Error("Invalid email address");
    throw new Error(error.message || "Failed to create login credential");
  } finally {
    // Clean up the secondary app instance.
    if (!existing) {
      try { await deleteApp(secondaryApp); } catch { /* ignore */ }
    }
  }

  // --- 2. Insert the Supabase profile row ---
  // company_id is stamped server-side by the trg_profiles_stamp_company trigger
  // from the calling admin's company (auth_company_id()), so we don't send it.
  // This avoids the client passing the wrong format (e.g. legacy "COMP001").
  const username = generateUsername(input.displayName);
  // De-duplicate extra roles and strip the primary one so it isn't double-stored.
  const extras = Array.from(new Set((input.extraRoles ?? []).filter((r) => r && r !== input.role)));
  const { error: insertErr } = await supabase.from("profiles").insert({
    firebase_uid: newUid,
    email: input.email,
    username,
    display_name: input.displayName,
    role: input.role,
    extra_roles: extras,
    phone_number: input.phoneNumber ?? "",
    department: input.department ?? "",
    manager_name: input.managerName ?? "",
    assigned_branch: input.assignedBranch ?? "",
    branch_access: input.branchAccess ?? "",
    technician_id: input.technicianId ?? "",
    po_initials: input.poInitials ?? "",
    required_check_in: input.requiredCheckIn ?? "",
    required_check_out: input.requiredCheckOut ?? "",
    working_hours: input.workingHours ?? null,
    meal_minutes: input.mealMinutes ?? null,
    is_active: true,
  });

  if (insertErr) {
    console.error("createCompanyUser profile insert error:", insertErr.message);
    throw new Error(`Login created, but profile save failed: ${insertErr.message}`);
  }

  return newUid;
}

/**
 * Create the Supabase profile for an admin created through SuperAdmin's
 * Firestore-based Add Admin flow (createUserAccount in firebase/users.ts).
 * Without this, the admin has no Supabase profile at all — every RLS
 * policy resolves the caller's company through profiles (auth_company_id()),
 * so they'd log in fine but see no tickets/users/anything Supabase-backed.
 *
 * Unlike createCompanyUser() above, this targets an ARBITRARY company (the
 * one SuperAdmin picked), not the caller's own — only a SuperAdmin session
 * can do this (profiles_insert's RLS check allows is_superadmin() with any
 * company_id; a regular admin/manager session would be rejected).
 */
export async function createSupabaseAdminProfile(input: {
  firebaseUid: string;
  email: string;
  displayName: string;
  role: UserRole;
  /** Omit only for SUPERSUPERADMIN — the platform-level role isn't tied to
   *  any one company (see 0099_role_hierarchy_split.sql's set_company_id()).
   *  Every other role must pass a real company. */
  companyLegacyCode?: string;
  phoneNumber?: string;
}): Promise<void> {
  let companyId: string | null = null;
  if (input.companyLegacyCode) {
    const { data: company, error: companyErr } = await supabase
      .from("companies")
      .select("id")
      .eq("legacy_code", input.companyLegacyCode)
      .maybeSingle();
    if (companyErr) throw new Error(companyErr.message);
    if (!company) {
      throw new Error(`No Supabase company found for '${input.companyLegacyCode}'`);
    }
    companyId = company.id;
  } else if (input.role !== "SUPERSUPERADMIN") {
    throw new Error("A company is required for every role except Super Super Admin");
  }

  const username = generateUsername(input.displayName);
  const { error } = await supabase.from("profiles").insert({
    firebase_uid: input.firebaseUid,
    company_id: companyId,
    email: input.email,
    username,
    display_name: input.displayName,
    role: input.role,
    phone_number: input.phoneNumber ?? "",
    is_active: true,
  });
  if (error) throw new Error(error.message);
}

/**
 * Delete a user's profile from Supabase (company-scoped via RLS).
 * Note: this removes the Supabase profile only. The Firebase Auth credential
 * (if any) should be removed separately in the Firebase console or via admin SDK.
 */
export async function deleteCompanyUser(profileId: string): Promise<void> {
  // manager_name is free text (not a real foreign key to another profile),
  // so nothing clears it automatically - without this, everyone who had
  // this person as their manager would keep showing that name forever,
  // pointing at someone who no longer exists. Capture it before the delete
  // since there's nothing left to look up afterward.
  const { data: deletedProfile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", profileId)
    .maybeSingle();

  const { error } = await supabase.from("profiles").delete().eq("id", profileId);
  if (error) {
    console.error("deleteCompanyUser error:", error.message);
    throw new Error(error.message);
  }

  const deletedDisplayName = deletedProfile?.display_name;
  if (deletedDisplayName) {
    const { error: clearErr } = await supabase
      .from("profiles")
      .update({ manager_name: null })
      .eq("manager_name", deletedDisplayName);
    // Best-effort - the delete itself already succeeded and is the
    // primary action; don't fail the whole operation over this cleanup.
    if (clearErr) {
      console.warn("deleteCompanyUser: failed to clear manager_name references:", clearErr.message);
    }
  }
}


/**
 * Get a single company profile by username (RLS-scoped to the caller's company).
 * Returns the full ProfileRow for the user detail page.
 */
export async function getProfileByUsername(username: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, firebase_uid, company_id, email, username, display_name, role, extra_roles, phone_number, department, manager_name, assigned_branch, branch_access, technician_id, po_initials, email_report_location, sms_status, off_days, work_plan, required_check_in, required_check_out, is_active, created_at")
    .ilike("username", username)
    .maybeSingle();
  if (error) {
    console.error("getProfileByUsername error:", error.message);
    return null;
  }
  if (!data) return null;

  // Fetched separately, best-effort — see getMyFullProfile's comment on why
  // working_hours/meal_minutes (migration 0109) must never be combined into
  // the main select: a missing/future column there shouldn't be able to null
  // out this entire profile (breaking the whole employee detail page).
  const { data: extra, error: extraError } = await supabase
    .from("profiles")
    .select("working_hours, meal_minutes")
    .eq("id", data.id)
    .maybeSingle();
  if (extraError) console.error("getProfileByUsername (working_hours/meal_minutes) error:", extraError.message);

  return {
    ...(data as ProfileRow),
    working_hours: extra?.working_hours ?? null,
    meal_minutes: extra?.meal_minutes ?? null,
  };
}

/**
 * Update an existing user's profile fields (company-scoped via RLS).
 */
export async function updateCompanyUser(
  profileId: string,
  fields: Partial<{
    username: string;
    displayName: string;
    /** Only pass this after the caller has already updated the user's real
     *  Firebase Auth email via /api/admin-update-email — see
     *  adminUpdateEmailBridge.ts for why the two must never be set independently. */
    email: string;
    role: UserRole;
    /** Additional roles beyond the primary (e.g. a manager who is also a TECHNICIAN). */
    extraRoles: UserRole[];
    phoneNumber: string;
    department: string;
    managerName: string;
    assignedBranch: string;
    branchAccess: string;
    technicianId: string;
    poInitials: string;
    requiredCheckIn: string;
    requiredCheckOut: string;
    scheduleTimezone: "CST" | "EST";
    masterListExtraDepartments: string[];
    personalEmail: string | null;
    workPhone: string | null;
    tierLevel: string | null;
    staffNote: string | null;
    workingHours: number | null;
    mealMinutes: number | null;
    emailReportLocation: string;
    smsStatus: string;
    offDays: number[];
    workPlan: Record<string, any>;
    isActive: boolean;
    /** Trainee vs Regular. See migration 0152. */
    employmentType: "trainee" | "regular";
  }>
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (fields.username !== undefined) payload.username = fields.username;
  if (fields.displayName !== undefined) payload.display_name = fields.displayName;
  if (fields.email !== undefined) payload.email = fields.email;
  if (fields.role !== undefined) payload.role = fields.role;
  if (fields.extraRoles !== undefined) {
    // Dedupe + remove the primary role from extras so it isn't double-stored.
    const primary = fields.role;
    payload.extra_roles = Array.from(
      new Set((fields.extraRoles || []).filter((r) => r && r !== primary)),
    );
  }
  if (fields.phoneNumber !== undefined) payload.phone_number = fields.phoneNumber;
  if (fields.department !== undefined) payload.department = fields.department;
  if (fields.managerName !== undefined) payload.manager_name = fields.managerName;
  if (fields.assignedBranch !== undefined) payload.assigned_branch = fields.assignedBranch;
  if (fields.branchAccess !== undefined) payload.branch_access = fields.branchAccess;
  if (fields.technicianId !== undefined) payload.technician_id = fields.technicianId;
  if (fields.poInitials !== undefined) payload.po_initials = fields.poInitials;
  if (fields.requiredCheckIn !== undefined) payload.required_check_in = fields.requiredCheckIn;
  if (fields.requiredCheckOut !== undefined) payload.required_check_out = fields.requiredCheckOut;
  if (fields.scheduleTimezone !== undefined) payload.schedule_timezone = fields.scheduleTimezone;
  if (fields.masterListExtraDepartments !== undefined) payload.master_list_extra_departments = fields.masterListExtraDepartments;
  if (fields.personalEmail !== undefined) payload.personal_email = fields.personalEmail;
  if (fields.workPhone !== undefined) payload.work_phone = fields.workPhone;
  if (fields.tierLevel !== undefined) payload.tier_level = fields.tierLevel;
  if (fields.staffNote !== undefined) payload.staff_note = fields.staffNote;
  if (fields.workingHours !== undefined) payload.working_hours = fields.workingHours;
  if (fields.mealMinutes !== undefined) payload.meal_minutes = fields.mealMinutes;
  if (fields.emailReportLocation !== undefined) payload.email_report_location = fields.emailReportLocation;
  if (fields.smsStatus !== undefined) payload.sms_status = fields.smsStatus;
  if (fields.offDays !== undefined) payload.off_days = fields.offDays;
  if (fields.workPlan !== undefined) payload.work_plan = fields.workPlan;
  if (fields.isActive !== undefined) payload.is_active = fields.isActive;
  if (fields.employmentType !== undefined) payload.employment_type = fields.employmentType;

  // .select("id") makes Supabase return the rows actually touched — without
  // it, an RLS policy silently blocking this update still comes back as
  // { error: null }, no exception, and callers have no way to tell "saved"
  // from "the database quietly ignored it". That's the exact shape of bug
  // where an edit looks like it worked (optimistic UI update stays) but
  // reverts the moment the page is reloaded and re-fetches the real value.
  const { data, error } = await supabase.from("profiles").update(payload).eq("id", profileId).select("id");
  if (error) {
    console.error("updateCompanyUser error:", error.message);
    // Postgres unique_violation on (company_id, username) - surface this
    // specific, foreseeable case in plain language instead of the raw
    // constraint-name error.
    if (error.code === "23505" && fields.username !== undefined) {
      throw new Error(`"${fields.username}" is already taken by another user in this company.`);
    }
    throw new Error(error.message);
  }
  if (!data || data.length === 0) {
    throw new Error("This change wasn't saved — you may not have permission to edit this profile.");
  }
}


/**
 * One-time migration: copy existing Firestore users for a company into
 * Supabase `profiles`. Skips users already present (by firebase_uid).
 *
 * @param firestoreCompanyId  the LEGACY company code stored in Firestore (e.g. "COMP001")
 * @returns summary of how many were migrated / skipped
 */
export async function migrateFirestoreUsersToSupabase(
  firestoreCompanyId: string
): Promise<{ migrated: number; skipped: number; failed: number; details: string[] }> {
  const details: string[] = [];
  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  // 1. Read existing Firestore users for this company.
  const fsUsers = await getFirestoreCompanyUsers(firestoreCompanyId);
  if (fsUsers.length === 0) {
    details.push("No Firestore users found for company " + firestoreCompanyId);
    return { migrated, skipped, failed, details };
  }

  // 2. Read which firebase_uids already exist in Supabase (RLS-scoped to my company).
  const { data: existing, error: existErr } = await supabase
    .from("profiles")
    .select("firebase_uid");
  if (existErr) {
    throw new Error("Could not read existing profiles: " + existErr.message);
  }
  const existingUids = new Set((existing ?? []).map((r) => r.firebase_uid));

  // 3. Insert the ones not yet in Supabase. company_id is auto-stamped from the
  //    migrating admin's session. Use upsert on firebase_uid so re-running can
  //    never create duplicates.
  for (const u of fsUsers) {
    if (existingUids.has(u.uid)) {
      skipped++;
      continue;
    }
    const username = u.username || generateUsername(u.displayName || u.email);
    const { error } = await supabase.from("profiles").upsert(
      {
        firebase_uid: u.uid,
        email: u.email,
        username,
        display_name: u.displayName || u.email,
        role: (u.role as UserRole) || "TECHNICIAN",
        phone_number: u.phoneNumber || "",
        department: u.department || "",
        is_active: u.isActive !== false,
        // company_id auto-stamped by trg_profiles_stamp_company
      },
      { onConflict: "firebase_uid", ignoreDuplicates: true }
    );
    if (error) {
      failed++;
      details.push(`❌ ${u.email}: ${error.message}`);
    } else {
      migrated++;
      details.push(`✅ ${u.email} (${username})`);
    }
  }

  return { migrated, skipped, failed, details };
}
