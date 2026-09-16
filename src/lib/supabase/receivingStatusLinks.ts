/**
 * Receiving Status portal links (migration 0263) — one URL per provider
 * portal family (e.g. "ServicePower"), editable by Admin/SuperAdmin
 * directly on the Receiving Status page. See receivingStatusData.ts's
 * providerFamilyOf() for how a ticket's raw ticket_source maps to a family.
 */

import { supabase } from "./client";

/** Every saved link for this company, keyed by provider family name. */
export async function getReceivingStatusProviderLinks(): Promise<Map<string, string>> {
  const { data, error } = await supabase.from("receiving_status_provider_links").select("provider, url");
  if (error) {
    console.error("getReceivingStatusProviderLinks error:", error.message);
    return new Map();
  }
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    if (row.url) map.set(row.provider, row.url);
  }
  return map;
}

export async function upsertReceivingStatusProviderLink(provider: string, url: string): Promise<void> {
  const { error } = await supabase
    .from("receiving_status_provider_links")
    .upsert({ provider, url: url.trim() }, { onConflict: "company_id,provider" });
  if (error) {
    console.error("upsertReceivingStatusProviderLink error:", error.message);
    throw new Error(error.message);
  }
}
