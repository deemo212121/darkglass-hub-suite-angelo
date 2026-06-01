import { useEffect, useMemo, useState } from "react";
import { Megaphone, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  formatAnnouncementTimestamp,
  getAnnouncementMessages,
  getUnreadAnnouncements,
  markAnnouncementRead,
} from "@/lib/announcements";

export function AnnouncementBanner() {
  const { email, ready } = useAuth();
  const [visible, setVisible] = useState(false);
  const [announcement, setAnnouncement] = useState<ReturnType<typeof getAnnouncementMessages>[number] | null>(null);

  useEffect(() => {
    if (!ready || !email || typeof window === "undefined") return;
    const unread = getUnreadAnnouncements(email, getAnnouncementMessages(email));
    const latest = unread[unread.length - 1] ?? null;
    setAnnouncement(latest);
    setVisible(Boolean(latest));
  }, [email, ready]);

  if (!ready || !email || !visible || !announcement) return null;

  const dismiss = () => {
    markAnnouncementRead(email, announcement.id);
    setVisible(false);
  };

  return (
    <div className="fixed left-1/2 top-20 z-50 w-[min(92vw,52rem)] -translate-x-1/2 px-4">
      <div className="rounded-2xl border border-amber-400/30 bg-slate-950/95 text-white shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl">
        <div className="flex items-start gap-4 p-4 sm:p-5">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-amber-400/20 bg-amber-400/10 text-amber-200">
            <Megaphone className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200/80">Announcement</div>
              <div className="text-[11px] text-slate-400">{formatAnnouncementTimestamp(announcement.createdAt)}</div>
            </div>
            <div className="mt-1 text-sm font-semibold text-white">{announcement.sender}</div>
            <p className="mt-2 text-sm leading-6 text-slate-200">{announcement.body}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => {
                markAnnouncementRead(email, announcement.id);
                setVisible(false);
              }}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10 hover:text-white"
            >
              View announcements
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white"
              aria-label="Dismiss announcement"
              title="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
