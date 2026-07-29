/**
 * Login history — one row per login/silent-refresh, written server-side by
 * supabaseTokenBridge.ts (the only point in the login flow with access to
 * the real client IP + Cloudflare geolocation). RLS (see migration 0089)
 * restricts reads to Admin/SuperAdmin within their own company — this is
 * security-sensitive data, not general company-scoped data every signed-in
 * user can see.
 */

import { supabase } from "./client";

export interface LoginEvent {
  id: string;
  profileId: string;
  ip: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  browser: string | null;
  device: string | null;
  createdAt: string;
}

/** Login events across the caller's company from the last `sinceDays` days, most recent first. */
export async function getCompanyLoginEvents(sinceDays = 90): Promise<LoginEvent[]> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("login_events")
    .select("id, profile_id, ip, country, region, city, latitude, longitude, browser, device, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getCompanyLoginEvents error:", error.message);
    throw new Error(error.message);
  }

  return (data ?? []).map((r: any) => ({
    id: r.id,
    profileId: r.profile_id,
    ip: r.ip,
    country: r.country,
    region: r.region,
    city: r.city,
    latitude: r.latitude,
    longitude: r.longitude,
    browser: r.browser,
    device: r.device,
    createdAt: r.created_at,
  }));
}
