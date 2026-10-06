/**
 * Preview-only sample announcement + ticker line, so the Announcements page
 * and the ticker can be seen with content while running locally. Only in
 * development (`vite dev`) — never in a production build — and never saved
 * to the database: nobody else sees it, and it can't be edited or put in
 * the real ticker. Set SHOW_SAMPLES to false to hide it locally too.
 */
import type { MessageRow } from "@/lib/supabase/messaging";
import { MARQUEE_CHANGED_EVENT, type MarqueeItem } from "@/lib/supabase/announcementMarquee";

const SHOW_SAMPLES = true;

export const SAMPLES_ENABLED = import.meta.env.DEV && SHOW_SAMPLES;

export const SAMPLE_ID_PREFIX = "sample-";

export function isSampleId(id: string): boolean {
  return id.startsWith(SAMPLE_ID_PREFIX);
}

export function sampleAnnouncements(): MessageRow[] {
  if (!SAMPLES_ENABLED) return [];
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  const row = (id: string, created_at: string, body: string, is_internal: boolean, sender_name: string): MessageRow => ({
    id: SAMPLE_ID_PREFIX + id,
    channel_id: null,
    dm_thread_id: null,
    sender_id: null,
    sender_name,
    body,
    kind: "user",
    is_announcement: true,
    is_internal,
    created_at,
    edited_at: null,
    deleted_at: null,
  });
  return [
    row(
      "payroll",
      hoursAgo(2),
      `Because of Friday's company holiday, all timecards and time corrections for this pay period must be submitted by Thursday, 5:00 PM Central.

What you need to do:
• Check your timecard in Employee Self-Service (ESS) for missing punches.
• File any time correction before Thursday 5:00 PM — anything later rolls into the next pay period.
• Managers: please approve your team's pending requests by Thursday 6:00 PM.

Questions? Message HR in the messenger.`,
      false,
      "HR Department"
    ),
    row(
      "branch",
      hoursAgo(30),
      `Starting Monday, trainee days must be reviewed before your own Time Out. You'll find them under Attendance Monitoring → Trainee Attendance.`,
      true,
      "Operations"
    ),
  ];
}

/** Preview-only on/off state for the sample ticker (in memory — gone on refresh). */
const sampleState = { enabled: true, inactive: new Set<string>() };

export function sampleTickerEnabled(): boolean {
  return sampleState.enabled;
}
export function setSampleTickerEnabled(enabled: boolean): void {
  sampleState.enabled = enabled;
  window.dispatchEvent(new Event(MARQUEE_CHANGED_EVENT));
}
export function setSampleActive(id: string, active: boolean): void {
  if (active) sampleState.inactive.delete(id);
  else sampleState.inactive.add(id);
  window.dispatchEvent(new Event(MARQUEE_CHANGED_EVENT));
}

/** What the ticker bar shows in preview: active sample lines, none while switched off. */
export function sampleTicker(): MarqueeItem[] {
  return sampleState.enabled ? sampleTickerAll().filter((i) => i.isActive) : [];
}

/** All sample lines, active and deactivated — for the Ticker panel. */
export function sampleTickerAll(): MarqueeItem[] {
  if (!SAMPLES_ENABLED) return [];
  const now = new Date().toISOString();
  return [
    { id: SAMPLE_ID_PREFIX + "t1", messageId: SAMPLE_ID_PREFIX + "payroll", text: "Payroll cut-off moves to Thursday this week", endsAt: null, createdByName: "HR Department", createdAt: now, removedAt: null, isActive: true },
    { id: SAMPLE_ID_PREFIX + "t2", messageId: null, text: "Friday is a company holiday — offices closed", endsAt: null, createdByName: "HR Department", createdAt: now, removedAt: null, isActive: true },
  ].map((i) => ({ ...i, isActive: !sampleState.inactive.has(i.id) }));
}

/** Titles for the sample announcements (message id → title). */
export function sampleTitles(): Map<string, string> {
  if (!SAMPLES_ENABLED) return new Map();
  return new Map([
    [SAMPLE_ID_PREFIX + "payroll", "Payroll cut-off moves to Thursday this week"],
    [SAMPLE_ID_PREFIX + "branch", "Branch managers — new trainee review step"],
  ]);
}
