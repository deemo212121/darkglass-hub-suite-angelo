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
  | "SUPERADMIN"    // Access to all companies, can create/manage admins
  | "ADMIN"         // Company admin, full access to company data
  | "MANAGER"       // Can manage tickets, employees, reports
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
  | "PARTS_MANAGER" | "BIZOPS_MANAGER" | "BIZOPS_SENIOR_MANAGER" | "CLAIMS"
  | "TRIAGE_USER" | "TRIAGE_MANAGER";

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
  work_plan: Record<string, any> | null;
  is_active: boolean;
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
 */
export async function getProfileForLogin(firebaseUid: string): Promise<{
  email: string;
  companyId: string;
  role: string;
  displayName: string;
  isActive: boolean;
  workPlan: Record<string, any> | null;
  branchAccess: string | null;
} | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("email, role, display_name, is_active, work_plan, branch_access, companies:company_id (legacy_code)")
    .eq("firebase_uid", firebaseUid)
    .maybeSingle();

  if (error) {
    console.error("getProfileForLogin error:", error.message);
    return null;
  }
  if (!data) return null;

  const legacyCode = (data as any).companies?.legacy_code ?? "";
  return {
    email: data.email,
    companyId: legacyCode,
    role: data.role,
    displayName: data.display_name ?? data.email,
    isActive: data.is_active,
    workPlan: (data as any).work_plan ?? null,
    branchAccess: (data as any).branch_access ?? null,
  };
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

export async function getCompanyUsers(): Promise<ProfileRow[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, firebase_uid, company_id, email, username, display_name, role, extra_roles, phone_number, department, manager_name, assigned_branch, branch_access, technician_id, po_initials, is_active, created_at")
    .neq("role", "SUPERADMIN")
    .order("display_name", { ascending: true });

  if (error) {
    console.error("getCompanyUsers error:", error.message);
    throw new Error(error.message);
  }
  return (data ?? []) as ProfileRow[];
}

export interface EmployeeInfo {
  bankName?: string;
  routingNumber?: string;
  accountNumber?: string;
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

/** Save the employee_info JSON for a profile (by profile id). */
export async function saveProfileEmployeeInfo(profileId: string, info: EmployeeInfo): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ employee_info: info })
    .eq("id", profileId);
  if (error) {
    console.error("saveProfileEmployeeInfo error:", error.message);
    throw new Error(error.message);
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
    is_active: true,
  });

  if (insertErr) {
    console.error("createCompanyUser profile insert error:", insertErr.message);
    throw new Error(`Login created, but profile save failed: ${insertErr.message}`);
  }

  return newUid;
}

/**
 * Delete a user's profile from Supabase (company-scoped via RLS).
 * Note: this removes the Supabase profile only. The Firebase Auth credential
 * (if any) should be removed separately in the Firebase console or via admin SDK.
 */
export async function deleteCompanyUser(profileId: string): Promise<void> {
  const { error } = await supabase.from("profiles").delete().eq("id", profileId);
  if (error) {
    console.error("deleteCompanyUser error:", error.message);
    throw new Error(error.message);
  }
}


/**
 * Get a single company profile by username (RLS-scoped to the caller's company).
 * Returns the full ProfileRow for the user detail page.
 */
export async function getProfileByUsername(username: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, firebase_uid, company_id, email, username, display_name, role, extra_roles, phone_number, department, manager_name, assigned_branch, branch_access, technician_id, po_initials, email_report_location, sms_status, off_days, work_plan, is_active, created_at")
    .ilike("username", username)
    .maybeSingle();
  if (error) {
    console.error("getProfileByUsername error:", error.message);
    return null;
  }
  return (data as ProfileRow) ?? null;
}

/**
 * Update an existing user's profile fields (company-scoped via RLS).
 */
export async function updateCompanyUser(
  profileId: string,
  fields: Partial<{
    displayName: string;
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
    emailReportLocation: string;
    smsStatus: string;
    offDays: number[];
    workPlan: Record<string, any>;
    isActive: boolean;
  }>
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (fields.displayName !== undefined) payload.display_name = fields.displayName;
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
  if (fields.emailReportLocation !== undefined) payload.email_report_location = fields.emailReportLocation;
  if (fields.smsStatus !== undefined) payload.sms_status = fields.smsStatus;
  if (fields.offDays !== undefined) payload.off_days = fields.offDays;
  if (fields.workPlan !== undefined) payload.work_plan = fields.workPlan;
  if (fields.isActive !== undefined) payload.is_active = fields.isActive;

  const { error } = await supabase.from("profiles").update(payload).eq("id", profileId);
  if (error) {
    console.error("updateCompanyUser error:", error.message);
    throw new Error(error.message);
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
