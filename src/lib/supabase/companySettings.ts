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

/**
 * The Certificate of Employment's editable body paragraphs (the prose
 * between the greeting and the signature block — see DEFAULT_COE_BODY_TEMPLATE
 * in ReportHRDaily.tsx for the placeholder tokens it supports). null means
 * "use the default" — the caller falls back rather than this file owning
 * the default text, so the fallback lives next to where it's rendered.
 */
export async function getCompanyCoeBodyTemplate(): Promise<string | null> {
  const { data, error } = await supabase.from("companies").select("settings").limit(1).maybeSingle();
  if (error || !data) {
    if (error) console.error("getCompanyCoeBodyTemplate error:", error.message);
    return null;
  }
  const value = (data.settings as Record<string, unknown> | null)?.coeBodyTemplate;
  return typeof value === "string" && value.trim() ? value : null;
}

/** Admin/Superadmin only — enforced server-side by the set_company_coe_body_template RPC. */
export async function setCompanyCoeBodyTemplate(template: string): Promise<void> {
  const { error } = await supabase.rpc("set_company_coe_body_template", { p_template: template });
  if (error) {
    console.error("setCompanyCoeBodyTemplate error:", error.message);
    throw new Error(error.message);
  }
}
