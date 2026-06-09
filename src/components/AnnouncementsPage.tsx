import { useEffect, useMemo, useState } from "react";
import { Megaphone, Send } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { USER_MANAGEMENT_RECORDS } from "@/lib/user-management";
import {
  canPostAnnouncements,
  ensureAnnouncementThread,
  formatAnnouncementTimestamp,
  getAnnouncementMessages,
  getUnreadAnnouncementCount,
  markAllAnnouncementsRead,
  markAnnouncementRead,
  saveAnnouncementStore,
  type AnnouncementMessage,
} from "@/lib/announcements";

interface Props {
  mod?: ModuleDef;
  sub?: SubModuleDef;
}

const HIGHER_UP_HINT = "Only HR, managers, admins, and supervisors can post announcements.";

function getDisplayName(email: string | null) {
  const record = USER_MANAGEMENT_RECORDS.find((item) => item.email.toLowerCase() === String(email || "").toLowerCase());
  return record?.userName ?? email ?? "Current User";
}

export function AnnouncementsPage({ mod, sub }: Props) {
  const { email, ready } = useAuth();
  const currentUserName = useMemo(() => getDisplayName(email), [email]);
  const [messages, setMessages] = useState<AnnouncementMessage[]>([]);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!ready || !email) return;
    ensureAnnouncementThread(email);
    setMessages(getAnnouncementMessages(email));
  }, [email, ready]);

  const unreadCount = useMemo(() => getUnreadAnnouncementCount(email, messages), [email, messages]);
  const canPost = canPostAnnouncements(email);

  const refresh = () => {
    if (!email) return;
    setMessages(getAnnouncementMessages(email));
  };

  const postAnnouncement = () => {
    if (!email || !canPost) return;
    const body = draft.trim();
    if (!body) return;

    const nextMessage: AnnouncementMessage = {
      id: `channel:announcements-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      sender: currentUserName,
      body,
      createdAt: new Date().toISOString(),
      kind: "other",
    };

    const store = ensureAnnouncementThread(email);
    store["channel:announcements"] = [...(store["channel:announcements"] ?? []), nextMessage];
    saveAnnouncementStore(store);
    setDraft("");
    setMessages(store["channel:announcements"]);
  };

  const markRead = (messageId: string) => {
    if (!email) return;
    markAnnouncementRead(email, messageId);
    refresh();
  };

  const markAllRead = () => {
    if (!email) return;
    markAllAnnouncementsRead(email, messages);
    refresh();
  };

  if (!ready) return null;

  return (
    <main className="max-w-[1200px] mx-auto px-6 py-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-amber-200/80">Announcements</div>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-white">Company Announcements</h1>
          <p className="mt-2 text-sm text-slate-300">Read company notices, mark them as read, and post new ones if your role allows it.</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-right text-sm text-slate-300 backdrop-blur-md">
          <div className="font-semibold text-white">{currentUserName}</div>
          <div>{unreadCount} unread</div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="rounded-2xl border border-white/15 bg-white/8 p-4 text-white backdrop-blur-md">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-amber-200" />
              <div className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-300">Announcement feed</div>
            </div>
            <button type="button" onClick={markAllRead} className="btn text-sm">
              Mark all read
            </button>
          </div>

          <div className="space-y-3">
            {messages.filter((message) => message.kind !== "system").slice().reverse().map((message) => (
              <button
                key={message.id}
                type="button"
                onClick={() => markRead(message.id)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 p-4 text-left transition hover:border-amber-300/30 hover:bg-slate-950"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white">{message.sender}</div>
                    <div className="text-[11px] uppercase tracking-[0.12em] text-slate-400">{formatAnnouncementTimestamp(message.createdAt)}</div>
                  </div>
                  <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-100">
                    Read / mark
                  </span>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-200">{message.body}</p>
              </button>
            ))}
            {messages.filter((message) => message.kind !== "system").length === 0 && (
              <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/70 p-6 text-sm text-slate-400">
                No announcements have been posted yet.
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-white/15 bg-white/8 p-4 text-white backdrop-blur-md">
            <div className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-300">Post announcement</div>
            <p className="mt-2 text-sm text-slate-300">{canPost ? "Your role can post announcements." : HIGHER_UP_HINT}</p>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={!canPost}
              placeholder="Type a company announcement..."
              className="glass-input mt-4 min-h-36 w-full rounded-xl bg-slate-900 text-white placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <button
              type="button"
              onClick={postAnnouncement}
              disabled={!canPost}
              className="btn btn-primary mt-3 inline-flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-4 w-4" /> Send announcement
            </button>
          </div>

          <div className="rounded-2xl border border-white/15 bg-white/8 p-4 text-white backdrop-blur-md">
            <div className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-300">Read state</div>
            <p className="mt-2 text-sm text-slate-300">
              Once you mark an announcement as read, it will stop surfacing as unread in the header and banner.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
