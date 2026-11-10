/**
 * Page Speed (migration 0433) — saving the timings the browser measures, and
 * reading them back for AHS Server Status → Page Speed (Admin and up; the
 * table's rule returns nothing to anyone else).
 */
import { supabase } from "./client";

export type PageTimingRow = {
  path: string;
  first_load: boolean;
  shown_ms: number;
  ready_ms: number | null;
  left_after_ms: number | null;
  timed_out: boolean;
  requests: number;
  device: "phone" | "tablet" | "computer";
  connection: string | null;
  memory_gb: number | null;
  cores: number | null;
  screen_width: number | null;
  git_sha: string | null;
};

export const PAGE_TIMINGS_TABLE = "page_load_timings";

/** "isn't set up yet" — the migration hasn't been run. */
export function isMissingTable(message: string): boolean {
  return /page_load_(timings|summary|daily)/i.test(message) && /does not exist|schema cache|could not find/i.test(message);
}

export async function insertPageTimings(rows: PageTimingRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase.from(PAGE_TIMINGS_TABLE).insert(rows);
  if (error) throw new Error(error.message);
}

export type PageSpeedSummary = {
  path: string;
  opens: number;
  shownMedian: number | null;
  readyMedian: number | null;
  readyP90: number | null;
  readyMax: number | null;
  leftEarly: number;
  timedOut: number;
  onPhone: number;
  lastOpened: string;
};

export type PageSpeedDay = { day: string; opens: number; readyMedian: number | null; readyP90: number | null };

export type SlowPageLoad = {
  createdAt: string;
  path: string;
  personName: string | null;
  firstLoad: boolean;
  shownMs: number;
  readyMs: number | null;
  leftAfterMs: number | null;
  timedOut: boolean;
  device: string;
  connection: string | null;
  memoryGb: number | null;
};

export type PageSpeedDevice = "phone" | "tablet" | "computer" | null;

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function getPageSpeedSummary(since: Date, device: PageSpeedDevice): Promise<PageSpeedSummary[]> {
  const { data, error } = await supabase.rpc("page_load_summary", { p_since: since.toISOString(), p_device: device });
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((r) => ({
    path: r.path,
    opens: Number(r.opens),
    shownMedian: num(r.shown_median),
    readyMedian: num(r.ready_median),
    readyP90: num(r.ready_p90),
    readyMax: num(r.ready_max),
    leftEarly: Number(r.left_early),
    timedOut: Number(r.timed_out),
    onPhone: Number(r.on_phone),
    lastOpened: r.last_opened,
  }));
}

export async function getPageSpeedDaily(since: Date, device: PageSpeedDevice): Promise<PageSpeedDay[]> {
  const { data, error } = await supabase.rpc("page_load_daily", { p_since: since.toISOString(), p_device: device });
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((r) => ({ day: r.day, opens: Number(r.opens), readyMedian: num(r.ready_median), readyP90: num(r.ready_p90) }));
}

/** The slowest single page loads in the period (ready, or how long before they left / gave up). */
export async function getSlowestPageLoads(since: Date, device: PageSpeedDevice, limit = 25): Promise<SlowPageLoad[]> {
  const columns = "created_at, path, first_load, shown_ms, ready_ms, left_after_ms, timed_out, device, connection, memory_gb, person:profiles(display_name)";
  const run = (orderBy: "ready_ms" | "left_after_ms") => {
    let q = supabase.from(PAGE_TIMINGS_TABLE).select(columns).gte("created_at", since.toISOString()).not(orderBy, "is", null);
    if (device) q = q.eq("device", device);
    return q.order(orderBy, { ascending: false }).limit(limit);
  };
  const [ready, left] = await Promise.all([run("ready_ms"), run("left_after_ms")]);
  if (ready.error) throw new Error(ready.error.message);
  if (left.error) throw new Error(left.error.message);
  const map = (r: any): SlowPageLoad => ({
    createdAt: r.created_at,
    path: r.path,
    personName: r.person?.display_name ?? null,
    firstLoad: !!r.first_load,
    shownMs: Number(r.shown_ms),
    readyMs: num(r.ready_ms),
    leftAfterMs: num(r.left_after_ms),
    timedOut: !!r.timed_out,
    device: r.device,
    connection: r.connection ?? null,
    memoryGb: num(r.memory_gb),
  });
  const waited = (l: SlowPageLoad) => l.readyMs ?? l.leftAfterMs ?? 0;
  return [...(ready.data ?? []), ...(left.data ?? [])].map(map).sort((a, b) => waited(b) - waited(a)).slice(0, limit);
}
