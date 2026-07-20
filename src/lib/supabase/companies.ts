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
