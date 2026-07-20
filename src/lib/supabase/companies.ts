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
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }
  return data.id as string;
}
