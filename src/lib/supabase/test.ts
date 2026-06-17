/**
 * Quick Supabase connectivity + isolation test.
 *
 * Call testSupabaseConnection() from the browser console (or temporarily from a
 * component) AFTER logging in. It verifies:
 *   1. The Supabase session token is attached.
 *   2. RLS returns ONLY the logged-in user's company + profile.
 *
 * Expected: your company (COMP001 / AH Solutions) and your profile (Jhon.Rulona).
 */

import { supabase, hasSupabaseSession } from "./client";

export async function testSupabaseConnection() {
  console.log("🧪 Supabase test starting...");

  if (!hasSupabaseSession()) {
    console.error("❌ No Supabase session. Are you logged in? Did the token exchange run?");
    return;
  }

  // 1. Read companies — RLS should return only the caller's company.
  const { data: companies, error: companyErr } = await supabase
    .from("companies")
    .select("legacy_code, company_name, is_active");

  if (companyErr) {
    console.error("❌ companies query failed:", companyErr.message);
  } else {
    console.log(`✅ companies visible to me: ${companies?.length ?? 0}`, companies);
  }

  // 2. Read my profile(s) — RLS scopes to my company.
  const { data: profiles, error: profileErr } = await supabase
    .from("profiles")
    .select("username, display_name, role, company_id");

  if (profileErr) {
    console.error("❌ profiles query failed:", profileErr.message);
  } else {
    console.log(`✅ profiles visible to me: ${profiles?.length ?? 0}`, profiles);
  }

  console.log("🧪 Test complete. You should see exactly 1 company (COMP001) and your profile.");
}

// Expose on window for easy console testing in dev.
if (typeof window !== "undefined") {
  (window as unknown as { testSupabase?: () => void }).testSupabase = testSupabaseConnection;
}
