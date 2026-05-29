import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Megaphone, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { USER_MANAGEMENT_RECORDS } from "@/lib/user-management";

type ChatMessage = {
  id: string;
  sender: string;
  body: string;
  createdAt: string;
  kind: "system" | "me" | "other";
};

type MessengerStore = Record<string, ChatMessage[]>;

const STORE_KEY = "ahs:team-messenger:v1";
const ANNOUNCEMENT_THREAD_ID = "channel:announcements";
const SEEN_KEY_PREFIX = "ahs:announcement-banner-seen:";

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function loadStore(): MessengerStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as MessengerStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveStore(store: MessengerStore) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

function seedAnnouncements(currentUserName: string): ChatMessage[] {
  const leaders = USER_MANAGEMENT_RECORDS.filter((record) => ["Admin", "Manager", "HR", "Tech Manager", "Claim Manager", "Part Manager"].includes(record.type)).slice(0, 3);
  return [
    {
      id: `${ANNOUNCEMENT_THREAD_ID}-system`,
      sender: "System",
      body: "Company announcements and shout-outs appear here on first login each day.",
      createdAt: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
      kind: "system",
    },
    {
      id: `${ANNOUNCEMENT_THREAD_ID}-1`,
      sender: leaders[0]?.userName ?? "Memphis Admin",
      body: "Great work today. Please review your queue and keep the updates flowing.",
      createdAt: new Date(Date.now() - 1000 * 60 * 75).toISOString(),
      kind: "other",
    },
    {
      id: `${ANNOUNCEMENT_THREAD_ID}-2`,
      sender: leaders[1]?.userName ?? "Nashville Admin",
      body: `Thanks for logging in, ${currentUserName}. Check announcements for shout-outs and daily notes.`,
      createdAt: new Date(Date.now() - 1000 * 60 * 20).toISOString(),
      kind: "other",
    },
  ];
}

function getLatestAnnouncement(messages: ChatMessage[]) {
  const visibleMessages = messages.filter((message) => message.kind !== "system");
  return visibleMessages[visibleMessages.length - 1] ?? messages[messages.length - 1] ?? null;
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function AnnouncementBanner() {
  const { email, ready } = useAuth();
  const [visible, setVisible] = useState(false);
  const [announcement, setAnnouncement] = useState<ChatMessage | null>(null);

  const currentUserName = useMemo(() => {
    const match = USER_MANAGEMENT_RECORDS.find((record) => record.email.toLowerCase() === String(email || "").toLowerCase());
    return match?.userName ?? email ?? "Current User";
  }, [email]);

  useEffect(() => {
    if (!ready || !email || typeof window === "undefined") return;

    const store = loadStore();
    if (!store[ANNOUNCEMENT_THREAD_ID] || store[ANNOUNCEMENT_THREAD_ID].length === 0) {
      store[ANNOUNCEMENT_THREAD_ID] = seedAnnouncements(currentUserName);
      saveStore(store);
    }

    const latest = getLatestAnnouncement(store[ANNOUNCEMENT_THREAD_ID] ?? []);
    if (!latest) {
      setAnnouncement(null);
      setVisible(false);
      return;
    }

    const seenKey = `${SEEN_KEY_PREFIX}${String(email).toLowerCase()}`;
    const seenToday = window.localStorage.getItem(seenKey) === todayKey();
    setAnnouncement(latest);
    if (!seenToday) {
      window.localStorage.setItem(seenKey, todayKey());
      setVisible(true);
    } else {
      setVisible(false);
    }
  }, [currentUserName, email, ready]);

  if (!ready || !email || !visible || !announcement) return null;

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
              <div className="text-[11px] text-slate-400">{formatTimestamp(announcement.createdAt)}</div>
            </div>
            <div className="mt-1 text-sm font-semibold text-white">{announcement.sender}</div>
            <p className="mt-2 text-sm leading-6 text-slate-200">{announcement.body}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              to="/m/$module/$submodule"
              params={{ module: "admin", submodule: "internal-message-support" }}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10 hover:text-white"
            >
              Open Messenger
            </Link>
            <button
              type="button"
              onClick={() => setVisible(false)}
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
