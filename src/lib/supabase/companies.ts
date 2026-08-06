/**
 * Supabase-side company creation. The `companies` table here is the one
 * every business table actually foreign-keys to (company_id); Firestore's
 * `companies` collection (src/lib/firebase/users.ts) is a separate record
 * used for SuperAdmin/login. `legacy_code` is what bridges the two — it
 * holds the Firestore-style companyId (e.g. "COMP001").
 *
 * Row is only insertable by a caller whose Supabase profile has
 * role = SUPERADMIN (see companies_insert policy in 0001_init.sql).
 */

import { supabase } from "./client";

export async function createSupabaseCompany(input: {
  legacyCode: string;
  companyName: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  phoneNumber?: string;
  email?: string;
  isActive?: boolean;
  subscriptionPlan?: "basic" | "professional" | "enterprise";
  loginAlias?: string;
}): Promise<string> {
  const { data, error } = await supabase
    .from("companies")
    .insert({
      legacy_code: input.legacyCode,
      company_name: input.companyName,
      address: input.address || null,
      city: input.city || null,
      state: input.state || null,
      zip_code: input.zipCode || null,
      phone_number: input.phoneNumber || null,
      email: input.email || null,
      is_active: input.isActive ?? true,
      subscription_plan: input.subscriptionPlan || "basic",
      login_alias: input.loginAlias || null,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }
  return data.id as string;
}

export interface CompanyDetails {
  companyName: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  phoneNumber: string | null;
  email: string | null;
  subscriptionPlan: "basic" | "professional" | "enterprise" | null;
  loginAlias: string | null;
}

/**
 * Read a company's own editable record by its canonical legacy_code. Used
 * by the self-service Company Settings page (role = SUPERADMIN/
 * SUPERSUPERADMIN) — companies_select already permits any user to read
 * their own company row, so this needs no special RLS beyond what exists.
 */
export async function getCompanyByLegacyCode(legacyCode: string): Promise<CompanyDetails | null> {
  const { data, error } = await supabase
    .from("companies")
    .select("company_name, address, city, state, zip_code, phone_number, email, subscription_plan, login_alias")
    .eq("legacy_code", legacyCode)
    .maybeSingle();
  if (error) {
    console.error("getCompanyByLegacyCode error:", error.message);
    return null;
  }
  if (!data) return null;
  return {
    companyName: data.company_name,
    address: data.address,
    city: data.city,
    state: data.state,
    zipCode: data.zip_code,
    phoneNumber: data.phone_number,
    email: data.email,
    subscriptionPlan: data.subscription_plan,
    loginAlias: data.login_alias,
  };
}

/**
 * Update a company's own editable fields by its canonical legacy_code —
 * the write side of the new companies_update RLS clause that lets the
 * per-company SUPERADMIN role edit only its own company row.
 */
export async function updateCompanyDetails(
  legacyCode: string,
  fields: Partial<{
    companyName: string;
    address: string;
    city: string;
    state: string;
    zipCode: string;
    phoneNumber: string;
    email: string;
    subscriptionPlan: "basic" | "professional" | "enterprise";
    loginAlias: string | null;
  }>
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (fields.companyName !== undefined) payload.company_name = fields.companyName;
  if (fields.address !== undefined) payload.address = fields.address;
  if (fields.city !== undefined) payload.city = fields.city;
  if (fields.state !== undefined) payload.state = fields.state;
  if (fields.zipCode !== undefined) payload.zip_code = fields.zipCode;
  if (fields.phoneNumber !== undefined) payload.phone_number = fields.phoneNumber;
  if (fields.email !== undefined) payload.email = fields.email;
  if (fields.subscriptionPlan !== undefined) payload.subscription_plan = fields.subscriptionPlan;
  if (fields.loginAlias !== undefined) payload.login_alias = fields.loginAlias;

  // RLS silently drops updates to rows the caller isn't allowed to touch —
  // PostgREST returns 200 with an empty array, NOT an error — so an
  // explicit empty-result check is required to catch it (same pattern as
  // updateSupabaseCompanyLoginAlias below).
  const { data, error } = await supabase
    .from("companies")
    .update(payload)
    .eq("legacy_code", legacyCode)
    .select("id");
  if (error) {
    throw new Error(error.message);
  }
  if (!data || data.length === 0) {
    throw new Error(
      "Update was rejected (no matching company, or your account isn't recognized as this company's SuperAdmin)."
    );
  }
}

/**
 * Freeze/unfreeze a company by its canonical legacy_code — sets
 * companies.is_active, which auth.tsx checks at login (via
 * getProfileForLogin's companyIsActive) to sign out and block every user of
 * a frozen company. Only the platform SUPERSUPERADMIN can call this
 * (companies_update is is_superadmin()-only besides the per-company
 * SUPERADMIN's own-row exception — see 0099/0100).
 */
export async function setCompanyActiveStatus(legacyCode: string, isActive: boolean): Promise<void> {
  // RLS silently drops updates to rows the caller isn't allowed to touch —
  // PostgREST returns 200 with an empty array, NOT an error — so an
  // explicit empty-result check is required to catch it (same pattern as
  // updateSupabaseCompanyLoginAlias below).
  const { data, error } = await supabase
    .from("companies")
    .update({ is_active: isActive })
    .eq("legacy_code", legacyCode)
    .select("id");
  if (error) {
    throw new Error(error.message);
  }
  if (!data || data.length === 0) {
    throw new Error("Update was rejected (no matching company, or your session isn't recognized as SuperSuperAdmin).");
  }
}

/** Read a company's current login alias (or null) by its canonical legacy_code. */
export async function getSupabaseCompanyLoginAlias(legacyCode: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("companies")
    .select("login_alias")
    .eq("legacy_code", legacyCode)
    .maybeSingle();
  if (error) {
    console.error("getSupabaseCompanyLoginAlias error:", error.message);
    return null;
  }
  return (data as any)?.login_alias ?? null;
}

export interface CompanyAdminAccount {
  id: string;
  firebaseUid: string | null;
  email: string;
  username: string;
  displayName: string;
  role: string;
  extraRoles: string[];
  isActive: boolean;
  phoneNumber: string | null;
  department: string | null;
  createdAt: string;
}

/**
 * Every ADMIN/SUPERADMIN-tier account for one company, by its canonical
 * legacy_code — the source of truth for the SuperAdmin console's per-company
 * account list. Supabase profiles, NOT the Firestore `users` collection
 * (src/lib/firebase/users.ts's getAllUsers()) — that collection has gone
 * stale for a while (accounts created/edited straight in Supabase never
 * synced back to it), so filtering it by companyId silently misses real
 * admins and can surface unrelated leftover records. Callable cross-company
 * because profiles_select allows is_superadmin() (see 0001_init.sql) —
 * ordinary company-scoped RLS would otherwise return nothing here.
 */
export async function getCompanyAdminAccounts(legacyCode: string): Promise<CompanyAdminAccount[]> {
  const { data: company, error: companyErr } = await supabase
    .from("companies")
    .select("id")
    .eq("legacy_code", legacyCode)
    .maybeSingle();
  if (companyErr) throw new Error(companyErr.message);
  if (!company) return [];

  const { data, error } = await supabase
    .from("profiles")
    .select("id, firebase_uid, email, username, display_name, role, extra_roles, is_active, phone_number, department, created_at")
    .eq("company_id", (company as any).id)
    .in("role", ["ADMIN", "SUPERADMIN"])
    .order("display_name", { ascending: true });
  if (error) throw new Error(error.message);

  return ((data ?? []) as any[]).map((p) => ({
    id: p.id,
    firebaseUid: p.firebase_uid ?? null,
    email: p.email,
    username: p.username ?? "",
    displayName: p.display_name || p.email,
    role: p.role,
    extraRoles: (p.extra_roles as string[] | null) ?? [],
    isActive: p.is_active,
    createdAt: p.created_at,
    phoneNumber: p.phone_number ?? null,
    department: p.department ?? null,
  }));
}

/** Set (or clear, with null) a company's login alias by its canonical legacy_code. */
export async function updateSupabaseCompanyLoginAlias(
  legacyCode: string,
  loginAlias: string | null
): Promise<void> {
  // RLS silently drops updates to rows the caller isn't allowed to touch —
  // PostgREST returns 200 with an empty array, NOT an error, so `.select()`
  // + an explicit empty-result check is required to catch it. Without this,
  // a stale/expired Supabase session reports "success" while writing nothing.
  const { data, error } = await supabase
    .from("companies")
    .update({ login_alias: loginAlias })
    .eq("legacy_code", legacyCode)
    .select("id");
  if (error) {
    throw new Error(error.message);
  }
  if (!data || data.length === 0) {
    throw new Error(
      "Update was rejected (no matching company, or your session isn't recognized as SuperAdmin — try refreshing the page and signing in again)."
    );
  }
}
