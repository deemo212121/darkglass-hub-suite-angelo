/**
 * Announcement ticker + titles (migration 0359).
 *
 * Ticker lines show announcement titles scrolling under the app header.
 * Each line can be deactivated (kept, just not shown) and activated again,
 * and the whole ticker can be switched off for the company. Rows are never
 * deleted: removing one stamps removed_*, so the history stays on record.
 */
import { supabase } from "./client";

export interface MarqueeItem {
  id: string;
  messageId: string | null;
  text: string;
  endsAt: string | null;
  createdByName: string | null;
  createdAt: string;
  removedAt: string | null;
  /** Deactivated lines stay in the list but aren't shown in the ticker. */
  isActive: boolean;
}

/** Fired on window after the ticker changes, so the bar and the page refresh right away. */
export const MARQUEE_CHANGED_EVENT = "ahs:marquee-changed";

const isMissing = (msg: string, what: string) => msg.includes(what) && /does not exist|schema cache|could not find/i.test(msg);
const changed = () => window.dispatchEvent(new Event(MARQUEE_CHANGED_EVENT));

function mapRow(r: any): MarqueeItem {
  return {
    id: r.id,
    messageId: r.message_id ?? null,
    text: r.text,
    endsAt: r.ends_at ?? null,
    createdByName: r.created_by_name ?? null,
    createdAt: r.created_at,
    removedAt: r.removed_at ?? null,
    isActive: r.is_active ?? true,
  };
}

/** Every ticker line that hasn't been removed or passed its end date — active and deactivated — oldest first. */
export async function getTickerItems(): Promise<MarqueeItem[]> {
  let cols = "id, message_id, text, ends_at, created_by_name, created_at, removed_at, is_active";
  const run = () => supabase.from("announcement_marquees").select(cols).is("removed_at", null).order("created_at", { ascending: true });
  let { data, error } = await run();
  if (error && isMissing(error.message, "is_active")) {
    cols = cols.replace(", is_active", "");
    ({ data, error } = await run());
  }
  if (error) {
    if (!isMissing(error.message, "announcement_marquees")) console.error("getTickerItems error:", error.message);
    return [];
  }
  const now = new Date().toISOString();
  return (data ?? []).map(mapRow).filter((m) => !m.endsAt || m.endsAt > now);
}

/** Is the ticker switched on for the company? On unless someone switched it off. */
export async function getTickerEnabled(): Promise<boolean> {
  const { data, error } = await supabase.from("announcement_marquee_settings").select("enabled").maybeSingle();
  if (error) {
    if (!isMissing(error.message, "announcement_marquee_settings")) console.error("getTickerEnabled error:", error.message);
    return true;
  }
  return data ? !!data.enabled : true;
}

/** What the ticker bar shows: active lines, and nothing at all while the ticker is switched off. */
export async function getActiveMarquees(): Promise<MarqueeItem[]> {
  const [items, enabled] = await Promise.all([getTickerItems(), getTickerEnabled()]);
  return enabled ? items.filter((i) => i.isActive) : [];
}

export async function addMarquee(input: { messageId: string | null; text: string; endsAt: string | null; byName: string }): Promise<MarqueeItem> {
  const { data, error } = await supabase
    .from("announcement_marquees")
    .insert({ message_id: input.messageId, text: input.text.trim(), ends_at: input.endsAt, created_by_name: input.byName })
    .select("id, message_id, text, ends_at, created_by_name, created_at, removed_at")
    .single();
  if (error) {
    if (isMissing(error.message, "announcement_marquees")) throw new Error("The ticker isn't set up yet — run migration 0359 in Supabase first.");
    throw new Error(error.message);
  }
  changed();
  return mapRow(data);
}

/** Deactivate (hide from the ticker, keep in the list) or activate a line again. */
export async function setMarqueeActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from("announcement_marquees").update({ is_active: active }).eq("id", id);
  if (error) {
    if (isMissing(error.message, "is_active")) throw new Error("Activate / Deactivate isn't set up yet — run migration 0359 in Supabase first.");
    throw new Error(error.message);
  }
  changed();
}

/** Take a line off the ticker for good (kept on record as removed). */
export async function removeMarquee(id: string, byName: string): Promise<void> {
  const { error } = await supabase.from("announcement_marquees").update({ removed_at: new Date().toISOString(), removed_by_name: byName }).eq("id", id);
  if (error) throw new Error(error.message);
  changed();
}

/** Switch the whole ticker on or off for the company. */
export async function setTickerEnabled(enabled: boolean, byName: string): Promise<void> {
  const { error } = await supabase.rpc("set_ticker_enabled", { p_enabled: enabled, p_by_name: byName });
  if (error) {
    if (isMissing(error.message, "set_ticker_enabled")) throw new Error("The ticker switch isn't set up yet — run migration 0359 in Supabase first.");
    throw new Error(error.message);
  }
  changed();
}

/** A short ticker line from an announcement: its first non-empty line, trimmed to ~160 characters. */
export function tickerTextFrom(body: string): string {
  const first = body.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  return first.length > 160 ? `${first.slice(0, 157).trimEnd()}…` : first;
}

// ── Announcement titles ────────────────────────────────────────────────────

/** message id → title, for every titled announcement. `available` is false until migration 0359 has been run. */
export async function getAnnouncementTitles(): Promise<{ titles: Map<string, string>; available: boolean }> {
  const titles = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("announcement_titles").select("message_id, title").range(from, from + 999);
    if (error) {
      const missing = isMissing(error.message, "announcement_titles");
      if (!missing) console.error("getAnnouncementTitles error:", error.message);
      return { titles, available: !missing };
    }
    for (const r of data ?? []) titles.set(r.message_id as string, r.title as string);
    if (!data || data.length < 1000) return { titles, available: true };
  }
}

export async function setAnnouncementTitle(messageId: string, title: string, byName: string): Promise<void> {
  const { error } = await supabase
    .from("announcement_titles")
    .upsert({ message_id: messageId, title: title.trim(), updated_by_name: byName, updated_at: new Date().toISOString() }, { onConflict: "message_id" });
  if (error) {
    if (isMissing(error.message, "announcement_titles")) throw new Error("Titles aren't set up yet — run migration 0359 in Supabase first.");
    throw new Error(error.message);
  }
}
