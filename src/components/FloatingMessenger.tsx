/**
 * Messenger-style floating widget, bottom-right of the viewport on every
 * authenticated page (mounted once in __root.tsx, same as TicketSearchFab/
 * ModuleNavigator) — talks to the same dm_threads/messages tables and
 * messaging.ts service layer as the full Team Messenger page and the
 * header's MessagesMenu dropdown, just in a compact chat-head instead of a
 * dropdown or a full-page navigation. DM-only (no channels) by design —
 * channels stay reachable from the header's "Open Team Messenger" link.
 *
 * Delivery is push-based, not polling: subscribeToAllNewMessages holds one
 * realtime postgres_changes subscription for the whole session, and a new
 * row fires a single "knock" (toast + sound) right when it lands — there is
 * no periodic "did anything change?" check here.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { MessageCircle, X, Send, Search, ChevronLeft, ExternalLink } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  listMyDmInbox,
  getDmMessages,
  sendMessage,
  markThreadRead,
  getOrCreateDmThread,
  getUnreadCounts,
  subscribeToMessages,
  type MessageRow,
  type DmInboxEntry,
} from "@/lib/supabase/messaging";
import { subscribeMessagesBus } from "@/lib/supabase/realtimeMessagesBus";
import { getCompanyUsers, getMyProfileId, type ProfileRow } from "@/lib/supabase/users";
import { playNotifySound } from "@/lib/notifySound";
import { onTabVisible } from "@/lib/pageVisibility";

function initials(name: string): string {
  return name
    .split(/[\s.@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function relativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface ActiveThread {
  id: string;
  otherProfileId: string;
  otherName: string;
}

interface Knock {
  threadId: string;
  otherProfileId: string;
  name: string;
  body: string;
}

export function FloatingMessenger() {
  const { ready, email, uid, displayName } = useAuth();
  const navigate = useNavigate();
  const currentUserName = displayName || email || "Current User";

  const [profileId, setProfileId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"list" | "thread">("list");
  const [inbox, setInbox] = useState<DmInboxEntry[]>([]);
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [search, setSearch] = useState("");
  const [activeThread, setActiveThread] = useState<ActiveThread | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [knock, setKnock] = useState<Knock | null>(null);
  // Channel unreads never show in this DM-only panel's list, but the badge
  // on the bubble itself should still match what the header's Messages icon
  // shows — otherwise a channel post looks like it never reached you here.
  // Kept per-channel (not just a total) so Mark all read can clear each one.
  const [perChannelUnread, setPerChannelUnread] = useState<Record<string, number>>({});
  const channelUnread = useMemo(() => Object.values(perChannelUnread).reduce((a, b) => a + b, 0), [perChannelUnread]);

  const activeThreadRef = useRef<ActiveThread | null>(null);
  const openRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  activeThreadRef.current = activeThread;
  openRef.current = open;

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  // Mirrored into a ref so the realtime subscription below can depend on
  // just [profileId] — depending on usersById directly meant the roster
  // finishing its async load right after mount tore down and recreated the
  // subscription, opening a real (if narrow) gap where an incoming message
  // could land between unsubscribe and resubscribe and never get counted.
  const usersByIdRef = useRef(usersById);
  usersByIdRef.current = usersById;

  const refreshInbox = async (pid: string) => {
    try {
      const rows = await listMyDmInbox(pid);
      setInbox(rows);
    } catch (err) {
      console.error("FloatingMessenger: failed to load inbox:", err);
    }
  };

  const refreshChannelUnread = async (pid: string) => {
    try {
      const counts = await getUnreadCounts(pid);
      setPerChannelUnread(counts.perChannel);
    } catch (err) {
      console.error("FloatingMessenger: failed to load channel unread count:", err);
    }
  };

  /**
   * Folds one message (mine or incoming) straight into inbox state — no
   * network call. listMyDmInbox() pages through a user's ENTIRE dm message
   * history just to compute previews/unread counts, which is far too heavy
   * to re-run on every single message; everything an inbox row needs is
   * already sitting right on the row that just landed.
   */
  const applyIncomingMessage = (row: MessageRow, opts: { bumpUnread: boolean }) => {
    if (!row.dm_thread_id) return;
    const threadId = row.dm_thread_id;
    setInbox((prev) => {
      const idx = prev.findIndex((e) => e.threadId === threadId);
      if (idx === -1) {
        if (!row.sender_id) return prev;
        const otherProfileId = row.sender_id === profileId ? "" : row.sender_id;
        const entry: DmInboxEntry = {
          threadId,
          otherProfileId,
          lastMessageBody: row.body,
          lastMessageAt: row.created_at,
          lastMessageSenderId: row.sender_id,
          unreadCount: opts.bumpUnread ? 1 : 0,
        };
        return [entry, ...prev];
      }
      const next = [...prev];
      const existing = next[idx];
      next[idx] = {
        ...existing,
        lastMessageBody: row.body,
        lastMessageAt: row.created_at,
        lastMessageSenderId: row.sender_id,
        unreadCount: opts.bumpUnread ? existing.unreadCount + 1 : existing.unreadCount,
      };
      return next;
    });
  };

  // Resolve identity, then load inbox + the company roster (for "start a
  // new conversation" search) once.
  useEffect(() => {
    if (!ready || !uid) return;
    let cancelled = false;
    (async () => {
      const pid = await getMyProfileId(uid);
      if (cancelled || !pid) return;
      setProfileId(pid);
      const [, , allUsers] = await Promise.all([
        refreshInbox(pid),
        refreshChannelUnread(pid),
        getCompanyUsers().catch(() => []),
      ]);
      if (!cancelled) setUsers(allUsers as ProfileRow[]);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, uid]);

  // Channel-unread is bumped optimistically as messages arrive (see the
  // realtime handler below) but only actually goes back DOWN once the full
  // Team Messenger marks a channel read elsewhere — resync on tab refocus
  // and whenever the bubble opens rather than polling on an interval.
  useEffect(() => {
    if (!profileId) return;
    return onTabVisible(() => void refreshChannelUnread(profileId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  const unreadTotal = useMemo(
    () => inbox.reduce((sum, e) => sum + e.unreadCount, 0) + channelUnread,
    [inbox, channelUnread]
  );

  const openThread = async (threadId: string, otherProfileId: string, otherName: string) => {
    setActiveThread({ id: threadId, otherProfileId, otherName });
    setView("thread");
    setKnock(null);
    try {
      const rows = await getDmMessages(threadId);
      setMessages(rows);
    } catch (err) {
      console.error("FloatingMessenger: failed to load thread:", err);
    }
    if (profileId) {
      void markThreadRead({ profileId, dmThreadId: threadId });
      setInbox((prev) => prev.map((e) => (e.threadId === threadId ? { ...e, unreadCount: 0 } : e)));
    }
  };

  const markAllRead = async () => {
    if (!profileId) return;
    const unreadThreadIds = inbox.filter((e) => e.unreadCount > 0).map((e) => e.threadId);
    const unreadChannelIds = Object.entries(perChannelUnread).filter(([, n]) => n > 0).map(([id]) => id);
    if (unreadThreadIds.length === 0 && unreadChannelIds.length === 0) return;
    // Optimistic — clear every badge immediately, then fire the read-pointer
    // writes in the background (same per-thread upsert openThread already uses).
    setInbox((prev) => prev.map((e) => (e.unreadCount > 0 ? { ...e, unreadCount: 0 } : e)));
    setPerChannelUnread({});
    await Promise.all([
      ...unreadThreadIds.map((threadId) => markThreadRead({ profileId, dmThreadId: threadId })),
      ...unreadChannelIds.map((channelId) => markThreadRead({ profileId, channelId })),
    ]);
  };

  const startConversation = async (other: ProfileRow) => {
    if (!profileId) return;
    try {
      const thread = await getOrCreateDmThread(profileId, other.id);
      setSearch("");
      await openThread(thread.id, other.id, other.display_name || other.email);
      // A brand-new thread has no messages yet to derive a preview from —
      // seed an empty inbox row locally rather than a full listMyDmInbox refetch.
      setInbox((prev) =>
        prev.some((e) => e.threadId === thread.id)
          ? prev
          : [{ threadId: thread.id, otherProfileId: other.id, lastMessageBody: "", lastMessageAt: thread.created_at, lastMessageSenderId: null, unreadCount: 0 }, ...prev]
      );
    } catch (err) {
      console.error("FloatingMessenger: failed to start conversation:", err);
    }
  };

  const handleSend = async () => {
    const body = composer.trim();
    if (!body || !activeThread || !profileId || sending) return;
    setSending(true);
    setComposer("");
    try {
      const row = await sendMessage({ dmThreadId: activeThread.id, senderId: profileId, senderName: currentUserName, body });
      setMessages((prev) => [...prev, row]);
      applyIncomingMessage(row, { bumpUnread: false });
    } catch (err) {
      console.error("FloatingMessenger: failed to send:", err);
      setComposer(body);
    } finally {
      setSending(false);
    }
  };

  // Thread-scoped realtime — so a reply lands live while the thread is open,
  // without waiting on the company-wide subscription's own dispatch below.
  useEffect(() => {
    if (!activeThread) return;
    return subscribeToMessages({
      dmThreadId: activeThread.id,
      onMessage: (row) => {
        if (row.sender_id === profileId) return; // already appended optimistically on send
        setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
        if (profileId) void markThreadRead({ profileId, dmThreadId: activeThread.id });
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread?.id, profileId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Company-wide push — the "knock": fires once per real new DM message,
  // right when it's inserted. No poll, no repeated "anything new?" check.
  useEffect(() => {
    if (!profileId) return;
    const unsub = subscribeMessagesBus((row) => {
      if (row.sender_id === profileId) return;
      if (row.channel_id) {
        // No knock/sound for channels — this widget is DM-focused — just
        // keep the badge accurate. A real resync (not an optimistic +1)
        // since an optimistic counter drifts under any missed/duplicated
        // event, which is exactly the "header says 2, bubble says 1" bug.
        void refreshChannelUnread(profileId);
        return;
      }
      if (!row.dm_thread_id) return;
      const isViewingThisThread = openRef.current && activeThreadRef.current?.id === row.dm_thread_id;
      if (isViewingThisThread) return; // thread-scoped subscription above already handled it
      // Any other incoming DM is meant for me — RLS already guarantees I'm a
      // participant, even for a brand-new thread I haven't loaded yet. Patch
      // it into state directly instead of a full inbox refetch.
      applyIncomingMessage(row, { bumpUnread: true });
      playNotifySound();
      const otherId = row.sender_id ?? "";
      const other = usersByIdRef.current.get(otherId);
      setKnock({
        threadId: row.dm_thread_id,
        otherProfileId: otherId,
        name: row.sender_name || other?.display_name || other?.email || "Someone",
        body: row.body,
      });
      window.clearTimeout((window as any).__ahsMessengerKnockTimer);
      (window as any).__ahsMessengerKnockTimer = window.setTimeout(() => setKnock(null), 6000);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  if (!ready || !email || !profileId) return null;

  const searchResults =
    search.trim().length > 0
      ? users
          .filter((u) => u.id !== profileId && u.is_active !== false)
          .filter((u) => (u.display_name || u.email).toLowerCase().includes(search.trim().toLowerCase()))
          .slice(0, 8)
      : [];

  return (
    <>
      {/* Knock toast — sits just above the bubble, clicking jumps straight into that thread. */}
      {knock && !open && (
        <button
          type="button"
          onClick={() => {
            setKnock(null);
            setOpen(true);
            void openThread(knock.threadId, knock.otherProfileId, knock.name);
          }}
          className="fixed bottom-[132px] right-5 z-[70] flex w-72 items-start gap-3 rounded-xl border border-white/10 bg-slate-800 p-3 text-left shadow-2xl transition-transform hover:-translate-y-0.5"
        >
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-500/20 text-blue-200 text-[11px] font-bold">
            {initials(knock.name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-white">{knock.name}</span>
            <span className="mt-0.5 line-clamp-2 block text-xs text-slate-300">{knock.body}</span>
          </span>
        </button>
      )}

      {open && (
        <div className="fixed bottom-[132px] right-5 z-[65] flex h-[520px] max-h-[70vh] w-[360px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
          <div className="flex shrink-0 items-center gap-2 border-b border-white/10 bg-slate-800/80 px-4 py-3">
            {view === "thread" && (
              <button onClick={() => { setView("list"); setActiveThread(null); }} className="text-slate-400 hover:text-white transition p-0.5 -ml-1">
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{view === "thread" ? activeThread?.otherName : "Messages"}</p>
              {view === "list" && <p className="text-[10px] text-slate-400">{unreadTotal > 0 ? `${unreadTotal} unread` : "Direct messages"}</p>}
            </div>
            {view === "list" && unreadTotal > 0 && (
              <button
                onClick={() => void markAllRead()}
                title="Mark all read"
                className="rounded-full px-2 py-1 text-[10px] font-semibold text-blue-300 hover:bg-white/5 hover:text-blue-200 transition whitespace-nowrap"
              >
                Mark all read
              </button>
            )}
            {view === "list" && (
              <button
                onClick={() =>
                  navigate({ to: "/m/$module/$submodule", params: { module: "admin", submodule: "internal-message-support" } })
                }
                title="Open full Team Messenger"
                className="text-slate-400 hover:text-white transition p-1"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            )}
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white transition p-1">
              <X className="h-4 w-4" />
            </button>
          </div>

          {view === "list" ? (
            <>
              <div className="relative shrink-0 border-b border-white/10 px-3 py-2">
                <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search people…"
                  className="w-full rounded-lg border border-white/10 bg-slate-800 py-1.5 pl-8 pr-3 text-sm text-white placeholder:text-slate-500 outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex-1 overflow-y-auto">
                {search.trim() ? (
                  searchResults.length === 0 ? (
                    <p className="px-4 py-6 text-center text-xs text-slate-500">No one matches "{search.trim()}".</p>
                  ) : (
                    searchResults.map((u) => (
                      <button
                        key={u.id}
                        onClick={() => void startConversation(u)}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-white/5 transition-colors"
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-500/15 text-blue-200 text-[11px] font-bold">
                          {initials(u.display_name || u.email)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-white">{u.display_name || u.email}</span>
                          <span className="block truncate text-[11px] text-slate-400">{u.role}</span>
                        </span>
                      </button>
                    ))
                  )
                ) : inbox.length === 0 ? (
                  <p className="px-4 py-8 text-center text-xs text-slate-500">No conversations yet — search above to message a coworker.</p>
                ) : (
                  [...inbox]
                    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
                    .map((entry) => {
                      const other = usersById.get(entry.otherProfileId);
                      const name = other?.display_name || other?.email || "Direct message";
                      return (
                        <button
                          key={entry.threadId}
                          onClick={() => void openThread(entry.threadId, entry.otherProfileId, name)}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-white/5 transition-colors"
                        >
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-500/15 text-blue-200 text-[11px] font-bold">
                            {initials(name)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-semibold text-white">{name}</span>
                              <span className="shrink-0 text-[10px] text-slate-500">{relativeTime(entry.lastMessageAt)}</span>
                            </span>
                            <span className="mt-0.5 flex items-center justify-between gap-2">
                              <span className={`truncate text-xs ${entry.unreadCount > 0 ? "text-slate-100" : "text-slate-400"}`}>
                                {entry.lastMessageSenderId === profileId ? "You: " : ""}
                                {entry.lastMessageBody || "No messages yet"}
                              </span>
                              {entry.unreadCount > 0 && (
                                <span className="shrink-0 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                  {entry.unreadCount > 99 ? "99+" : entry.unreadCount}
                                </span>
                              )}
                            </span>
                          </span>
                        </button>
                      );
                    })
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
                {messages.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-slate-500">No messages yet — say hello.</p>
                ) : (
                  messages.map((m) => {
                    const mine = m.sender_id === profileId;
                    return (
                      <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[75%] rounded-2xl px-3 py-1.5 text-sm ${mine ? "bg-blue-600 text-white" : "bg-slate-700 text-slate-100"}`}>
                          {m.body}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>
              <div className="flex shrink-0 items-center gap-2 border-t border-white/10 p-2.5">
                <input
                  type="text"
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  placeholder="Type a message…"
                  className="flex-1 rounded-full border border-white/10 bg-slate-800 px-3.5 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-blue-500"
                />
                <button
                  onClick={() => void handleSend()}
                  disabled={!composer.trim() || sending}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-600 text-white transition-colors hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setKnock(null);
          if (profileId) void refreshChannelUnread(profileId);
        }}
        aria-label="Messages"
        title={unreadTotal > 0 ? `Messages (${unreadTotal} unread)` : "Messages"}
        className="fixed bottom-16 right-20 z-[65] grid h-14 w-14 place-items-center rounded-full bg-blue-600 text-white shadow-[0_12px_30px_rgba(0,0,0,0.35)] transition-transform hover:scale-105 hover:bg-blue-500"
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
        {!open && unreadTotal > 0 && (
          <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white shadow-lg">
            {unreadTotal > 99 ? "99+" : unreadTotal}
          </span>
        )}
      </button>
    </>
  );
}
