/**
 * The announcement ticker — a thin scrolling line under the app header with
 * whatever announcements are pinned to it (Announcements page → "Show in
 * ticker"). Pauses on hover; clicking it opens Announcements. Hidden when
 * nothing is pinned. Refreshes every few minutes and right after a change.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Megaphone } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getTickerItems, getTickerEnabled, MARQUEE_CHANGED_EVENT, type MarqueeItem } from "@/lib/supabase/announcementMarquee";
import { sampleTicker } from "@/lib/announcementSamples";

const REFRESH_MS = 5 * 60_000;

export function AnnouncementMarquee() {
  const { ready, uid } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<MarqueeItem[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!ready || !uid) return;
    let alive = true;
    const load = () => {
      setTick((t) => t + 1); // preview samples live in memory — re-read them too
      Promise.all([getTickerItems(), getTickerEnabled()]).then(([rows, on]) => {
        if (!alive) return;
        setItems(rows);
        setEnabled(on);
      });
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    window.addEventListener(MARQUEE_CHANGED_EVENT, load);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener(MARQUEE_CHANGED_EVENT, load);
    };
  }, [ready, uid]);

  // Real lines: active ones, none while the ticker is switched off.
  // Local preview only: sample lines when there are no real lines at all.
  const isSample = items.length === 0;
  const shown = isSample ? sampleTicker() : enabled ? items.filter((i) => i.isActive) : [];
  if (shown.length === 0) return null;

  // Each loop enters from the right edge and scrolls fully off the left, so the
  // distance is the screen width plus the text: keep a steady, readable speed.
  const chars = shown.reduce((n, i) => n + i.text.length + 6, 0);
  const seconds = Math.max(14, Math.round(chars / 9) + 10);
  const line = (
    <>
      {shown.map((i) => (
        <span key={i.id} className="marquee-item">
          {i.text}
        </span>
      ))}
    </>
  );

  return (
    <button
      type="button"
      onClick={() => navigate({ to: "/announcements" })}
      className="marquee-bar"
      title="Open Announcements"
      aria-label={`Announcements: ${shown.map((i) => i.text).join(" • ")}`}
    >
      <span className="marquee-label">
        <Megaphone className="h-3.5 w-3.5" />
        Announcements
        {isSample && <span className="marquee-sample">Sample</span>}
      </span>
      <span className="marquee-viewport" aria-hidden>
        <span className="marquee-track" style={{ animationDuration: `${seconds}s` }}>
          <span className="marquee-run">{line}</span>
        </span>
      </span>
    </button>
  );
}
