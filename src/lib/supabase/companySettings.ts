/**
 * Company-wide settings stored in companies.settings (jsonb) — currently
 * just the Ticket Map provider. See migration 0050.
 */

import { supabase } from "./client";

export type MapProvider = "google" | "leaflet";

/** Which map provider the whole company currently renders the Ticket Map with. Defaults to "google". */
export async function getCompanyMapProvider(): Promise<MapProvider> {
  const { data, error } = await supabase.from("companies").select("settings").limit(1).maybeSingle();
  if (error || !data) {
    if (error) console.error("getCompanyMapProvider error:", error.message);
    return "google";
  }
  const value = (data.settings as Record<string, unknown> | null)?.mapProvider;
  return value === "leaflet" ? "leaflet" : "google";
}

/** Admin/Superadmin only — enforced server-side by the set_company_map_provider RPC. */
export async function setCompanyMapProvider(provider: MapProvider): Promise<void> {
  const { error } = await supabase.rpc("set_company_map_provider", { p_provider: provider });
  if (error) {
    console.error("setCompanyMapProvider error:", error.message);
    throw new Error(error.message);
  }
}
