/**
 * Page Speed (migration 0433, src/lib/pageLoadTimings.ts): starts measuring
 * every page and tells it who's signed in. For Admin and up who switch it on
 * (AHS Server Status → Page Speed, per browser), a small badge in the corner
 * shows how long the page they're on took — "Shown 420 ms · Ready 2.1 s".
 */
import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Gauge, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { isAdminOrAboveHolder } from "@/lib/roleLabels";
import { installPageLoadTracking, markPageShown, setPageSpeedUser, subscribePageSpeed, type PageSpeedEvent } from "@/lib/pageLoadTimings";

const BADGE_KEY = "ahs:page-speed-badge";
const BADGE_EVENT = "ahs:page-speed-badge";

export function isPageSpeedBadgeOn(): boolean {
  try {
    return localStorage.getItem(BADGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setPageSpeedBadge(on: boolean): void {
  try {
    if (on) localStorage.setItem(BADGE_KEY, "1");
    else localStorage.removeItem(BADGE_KEY);
  } catch {
    /* storage blocked: it just won't be remembered */
  }
  window.dispatchEvent(new Event(BADGE_EVENT));
}

export function usePageSpeedBadgeOn(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const read = () => setOn(isPageSpeedBadgeOn());
    read();
    window.addEventListener(BADGE_EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(BADGE_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);
  return on;
}

/** "420 ms" under a second, "2.1 s" above. */
export function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

/** Green under 1 s, amber under 3 s, red from 3 s. */
export function speedTone(ms: number | null): "good" | "ok" | "slow" {
  if (ms === null || ms >= 3000) return "slow";
  return ms < 1000 ? "good" : "ok";
}

const TONE_CLASS = {
  good: "border-emerald-500/40 text-emerald-300",
  ok: "border-amber-500/40 text-amber-300",
  slow: "border-rose-500/40 text-rose-300",
} as const;

/**
 * Inside a module page's Suspense, after the page: mounts once the page's own
 * component has rendered, which is when the page counts as shown. Keyed by the
 * page so moving between module pages mounts it again.
 */
export function PageShownMarker() {
  useEffect(() => {
    markPageShown();
  }, []);
  return null;
}

export function PageLoadTracker() {
  const router = useRouter();
  const { uid, role, realRole, extraRoles } = useAuth();
  const badgeOn = usePageSpeedBadgeOn();
  const canSeeBadge = isAdminOrAboveHolder(realRole ?? role, extraRoles);

  useEffect(() => installPageLoadTracking(router), [router]);
  useEffect(() => setPageSpeedUser(uid ?? null), [uid]);

  if (!canSeeBadge || !badgeOn) return null;
  return <PageSpeedBadge />;
}

function PageSpeedBadge() {
  const [event, setEvent] = useState<PageSpeedEvent | null>(null);
  useEffect(() => subscribePageSpeed(setEvent), []);
  if (!event) return null;

  let text: string;
  let tone: keyof typeof TONE_CLASS = "ok";
  if (event.state === "measuring") {
    text = "Measuring…";
  } else {
    const t = event.timing;
    tone = speedTone(t.readyMs);
    const rest = t.readyMs !== null ? `Ready ${formatMs(t.readyMs)}` : t.timedOut ? "still loading after 60 s" : `left at ${formatMs(t.leftAfterMs ?? 0)}`;
    text = `Shown ${formatMs(t.shownMs)} · ${rest}`;
  }
  const title = event.state === "done" ? `${event.timing.path}${event.timing.firstLoad ? " (full page load)" : ""} · ${event.timing.requests} request${event.timing.requests === 1 ? "" : "s"}` : undefined;

  return (
    <div
      role="status"
      aria-live="polite"
      title={title}
      className={`fixed bottom-4 left-4 z-30 inline-flex items-center gap-1.5 rounded-full border bg-slate-950/90 px-3 py-1.5 font-mono text-[11px] tabular-nums shadow-lg ${event.state === "measuring" ? "border-white/15 text-slate-300" : TONE_CLASS[tone]}`}
    >
      <Gauge className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{text}</span>
      <button type="button" onClick={() => setPageSpeedBadge(false)} className="ml-0.5 rounded-full p-0.5 text-slate-400 hover:text-white" aria-label="Hide the page speed badge">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
