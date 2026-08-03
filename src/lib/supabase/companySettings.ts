/**
 * Company-wide settings stored in companies.settings (jsonb) — currently
 * just the Ticket Map provider. See migration 0050.
 */

import { supabase } from "./client";

export type MapProvider = "google" | "leaflet";

// This setting changes maybe once ever (an admin flips it), but every
// single map-bearing page (Ticket Map, Work Planner, Work Map, ticket
// mileage, ...) was paying for a fresh Supabase round-trip just to learn
// "google" vs "leaflet" before it could even start loading the map
// library — a real, avoidable chunk of the "map feels slow to open"
// delay. Cached in-memory for the tab's session; invalidated below
// whenever this tab itself changes the setting.
let mapProviderPromise: Promise<MapProvider> | null = null;

async function fetchCompanyMapProvider(): Promise<MapProvider> {
  const { data, error } = await supabase.from("companies").select("settings").limit(1).maybeSingle();
  if (error || !data) {
    if (error) console.error("getCompanyMapProvider error:", error.message);
    return "google";
  }
  const value = (data.settings as Record<string, unknown> | null)?.mapProvider;
  return value === "leaflet" ? "leaflet" : "google";
}

/** Which map provider the whole company currently renders the Ticket Map with. Defaults to "google". */
export function getCompanyMapProvider(): Promise<MapProvider> {
  if (!mapProviderPromise) mapProviderPromise = fetchCompanyMapProvider();
  return mapProviderPromise;
}

/** Admin/Superadmin only — enforced server-side by the set_company_map_provider RPC. */
export async function setCompanyMapProvider(provider: MapProvider): Promise<void> {
  const { error } = await supabase.rpc("set_company_map_provider", { p_provider: provider });
  if (error) {
    console.error("setCompanyMapProvider error:", error.message);
    throw new Error(error.message);
  }
  // This tab just changed it — make the next getCompanyMapProvider() call
  // pick up the new value instead of serving the stale cached one.
  mapProviderPromise = Promise.resolve(provider);
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

/**
 * The one technician every new ticket is created with (see migration
 * 0067). Empty string means "leave new tickets unassigned", same as
 * before this setting existed.
 */
export async function getCompanyDefaultTechnician(): Promise<string> {
  const { data, error } = await supabase.from("companies").select("settings").limit(1).maybeSingle();
  if (error || !data) {
    if (error) console.error("getCompanyDefaultTechnician error:", error.message);
    return "";
  }
  const value = (data.settings as Record<string, unknown> | null)?.defaultTechnician;
  return typeof value === "string" ? value : "";
}

/** Admin/Superadmin only — enforced server-side by the set_company_default_technician RPC. */
export async function setCompanyDefaultTechnician(technician: string): Promise<void> {
  const { error } = await supabase.rpc("set_company_default_technician", { p_technician: technician });
  if (error) {
    console.error("setCompanyDefaultTechnician error:", error.message);
    throw new Error(error.message);
  }
}

/**
 * "Also notify HR" toggles (see migration 0090) for the three sends that
 * are otherwise strictly one-to-one DMs — Employee Warning Form,
 * Certificate of Employment, and the W-8BEN/W-4/W-9 tax forms. Recipients
 * are whoever carries the HR role (primary or extra_roles) — see
 * hrRoleNotify.ts. Custom Forms already broadcast to HR/Admin/Manager by
 * default and aren't covered here.
 */
export interface HrNotificationSettings {
  warningForm: boolean;
  coe: boolean;
  taxForms: boolean;
}

export async function getHrNotificationSettings(): Promise<HrNotificationSettings> {
  const { data, error } = await supabase.from("companies").select("settings").limit(1).maybeSingle();
  if (error || !data) {
    if (error) console.error("getHrNotificationSettings error:", error.message);
    return { warningForm: false, coe: false, taxForms: false };
  }
  const s = (data.settings as Record<string, unknown> | null) ?? {};
  return {
    warningForm: s.notifyAdminsWarningForm === true,
    coe: s.notifyAdminsCoe === true,
    taxForms: s.notifyAdminsTaxForms === true,
  };
}

/** Admin/Superadmin only — enforced server-side by the set_notify_admins_warning_form RPC. */
export async function setNotifyAdminsWarningForm(enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_notify_admins_warning_form", { p_enabled: enabled });
  if (error) {
    console.error("setNotifyAdminsWarningForm error:", error.message);
    throw new Error(error.message);
  }
}

/** Admin/Superadmin only — enforced server-side by the set_notify_admins_coe RPC. */
export async function setNotifyAdminsCoe(enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_notify_admins_coe", { p_enabled: enabled });
  if (error) {
    console.error("setNotifyAdminsCoe error:", error.message);
    throw new Error(error.message);
  }
}

/** Admin/Superadmin only — enforced server-side by the set_notify_admins_tax_forms RPC. */
export async function setNotifyAdminsTaxForms(enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_notify_admins_tax_forms", { p_enabled: enabled });
  if (error) {
    console.error("setNotifyAdminsTaxForms error:", error.message);
    throw new Error(error.message);
  }
}
