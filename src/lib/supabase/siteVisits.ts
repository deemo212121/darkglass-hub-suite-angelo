/**
 * Site visitors — every page open on the live site, signed in or not,
 * written server-side by src/lib/server/siteVisitLog.ts (migration 0340).
 * RLS restricts reads to Admin/SuperAdmin.
 */

import { supabase } from "./client";

export interface SiteVisit {
  id: string;
  createdAt: string;
  ip: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  asOrg: string | null;
  path: string | null;
  referer: string | null;
  browser: string | null;
  device: string | null;
}

const PAGE_SIZE = 1000;

/** Site visits from the last `sinceDays` days, most recent first (capped at `limit` rows). */
export async function getSiteVisits(sinceDays = 30, limit = 5000): Promise<SiteVisit[]> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const all: SiteVisit[] = [];
  for (let from = 0; from < limit; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("site_visits")
      .select("id, created_at, ip, country, region, city, as_org, path, referer, browser, device")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .range(from, Math.min(from + PAGE_SIZE, limit) - 1);
    if (error) {
      console.error("getSiteVisits error:", error.message);
      throw new Error(error.message);
    }
    all.push(
      ...(data ?? []).map((r: any) => ({
        id: r.id,
        createdAt: r.created_at,
        ip: r.ip,
        country: r.country,
        region: r.region,
        city: r.city,
        asOrg: r.as_org,
        path: r.path,
        referer: r.referer,
        browser: r.browser,
        device: r.device,
      })),
    );
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}
