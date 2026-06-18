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
  | "SUPERADMIN" | "ADMIN" | "MANAGER" | "CSR"
  | "TECHNICIAN" | "CLAIMS" | "HR" | "IT" | "PARTS" | "FINANCE";

export interface ProfileRow {
  id: string;
  firebase_uid: string;
  company_id: string;
  email: string;
  username: string | null;
  display_name: string | null;
  role: UserRole;
  phone_number: string | null;
  department: string | null;
  manager_name: string | null;
  assigned_branch: string | null;
  branch_access: string | null;
  technician_id: string | null;
  po_initials: string | null;
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
} | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("email, role, display_name, is_active, companies:company_id (legacy_code)")
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
export async function getCompanyUsers(): Promise<ProfileRow[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, firebase_uid, company_id, email, username, display_name, role, phone_number, department, manager_name, assigned_branch, branch_access, technician_id, po_initials, is_active, created_at")
    .neq("role", "SUPERADMIN")
    .order("display_name", { ascending: true });

  if (error) {
    console.error("getCompanyUsers error:", error.message);
    throw new Error(error.message);
  }
  return (data ?? []) as ProfileRow[];
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
  const { error: insertErr } = await supabase.from("profiles").insert({
    firebase_uid: newUid,
    email: input.email,
    username,
    display_name: input.displayName,
    role: input.role,
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
    .select("id, firebase_uid, company_id, email, username, display_name, role, phone_number, department, manager_name, assigned_branch, branch_access, technician_id, po_initials, is_active, created_at")
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
    phoneNumber: string;
    department: string;
    managerName: string;
    assignedBranch: string;
    branchAccess: string;
    technicianId: string;
    poInitials: string;
    requiredCheckIn: string;
    requiredCheckOut: string;
    isActive: boolean;
  }>
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (fields.displayName !== undefined) payload.display_name = fields.displayName;
  if (fields.role !== undefined) payload.role = fields.role;
  if (fields.phoneNumber !== undefined) payload.phone_number = fields.phoneNumber;
  if (fields.department !== undefined) payload.department = fields.department;
  if (fields.managerName !== undefined) payload.manager_name = fields.managerName;
  if (fields.assignedBranch !== undefined) payload.assigned_branch = fields.assignedBranch;
  if (fields.branchAccess !== undefined) payload.branch_access = fields.branchAccess;
  if (fields.technicianId !== undefined) payload.technician_id = fields.technicianId;
  if (fields.poInitials !== undefined) payload.po_initials = fields.poInitials;
  if (fields.requiredCheckIn !== undefined) payload.required_check_in = fields.requiredCheckIn;
  if (fields.requiredCheckOut !== undefined) payload.required_check_out = fields.requiredCheckOut;
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
