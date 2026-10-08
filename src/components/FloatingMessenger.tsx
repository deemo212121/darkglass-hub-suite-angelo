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
import { ReceiptMark } from "@/components/ReceiptMark";
import { getDmReceipts, receiptFor, useDmReceipt, type DmReceiptState } from "@/lib/supabase/readReceipts";
import { useNavigate } from "@tanstack/react-router";
import { MessageCircle, X, Send, Search, ChevronLeft, ExternalLink, MoreHorizontal, CornerUpLeft, Forward, Copy, Mail, MailOpen } from "lucide-react";
import { toast } from "sonner";
import {
  QUICK_REACTIONS,
  getMessageLinks,
  getReactions,
  saveMessageLink,
  subscribeReactions,
  toggleReaction,
  type MessageLink,
  type ReactionGroup,
} from "@/lib/supabase/messageExtras";
import { useAuth } from "@/lib/auth";
import {
  listMyDmInbox,
  getDmMessages,
  sendMessage,
  markThreadRead,
  markThreadUnread,
  getOrCreateDmThread,
  getUnreadCounts,
  subscribeToMessages,
  type MessageRow,
  type DmInboxEntry,
} from "@/lib/supabase/messaging";
import { subscribeMessagesBus } from "@/lib/supabase/realtimeMessagesBus";
import { getCompanyUsers, getMyProfileId, type ProfileRow } from "@/lib/supabase/users";
import { MessageBody } from "@/components/MessageBody";
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

/** Dispatch on window to open the messenger from anywhere (e.g. the Home "Unread messages" card). */
export const OPEN_MESSENGER_EVENT = "ahs:open-messenger";

export function FloatingMessenger() {
  const { ready, email, uid, displayName } = useAuth();
  const navigate = useNavigate();
  const currentUserName = displayName || email || "Current User";

  const [profileId, setProfileId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"list" | "thread">("list");
  useEffect(() => {
    const openMessenger = () => setOpen(true);
    window.addEventListener(OPEN_MESSENGER_EVENT, openMessenger);
    return () => window.removeEventListener(OPEN_MESSENGER_EVENT, openMessenger);
  }, []);
  const [inbox, setInbox] = useState<DmInboxEntry[]>([]);
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [search, setSearch] = useState("");
  const [activeThread, setActiveThread] = useState<ActiveThread | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [composer, setComposer] = useState("");
  // Reactions / replies / forwards (migration 0361) — same as the Team Messenger page.
  const [reactions, setReactions] = useState<Map<string, ReactionGroup[]>>(new Map());
  const [links, setLinks] = useState<Map<string, MessageLink>>(new Map());
  const [replyTo, setReplyTo] = useState<MessageRow | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [forwardMsg, setForwardMsg] = useState<MessageRow | null>(null);
  const [forwardSearch, setForwardSearch] = useState("");
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

  // One conversation: "Mark as unread" (flag, keeps the other person's Seen) or "Mark as read".
  const toggleThreadRead = async (threadId: string, unreadCount: number) => {
    if (!profileId) return;
    if (unreadCount > 0) {
      setInbox((prev) => prev.map((e) => (e.threadId === threadId ? { ...e, unreadCount: 0 } : e)));
      await markThreadRead({ profileId, dmThreadId: threadId });
      window.dispatchEvent(new CustomEvent("ahs:unread-changed"));
    } else {
      setInbox((prev) => prev.map((e) => (e.threadId === threadId ? { ...e, unreadCount: 1 } : e)));
      try {
        await markThreadUnread({ profileId, dmThreadId: threadId });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't mark it as unread.");
        void refreshInbox(profileId);
      }
    }
  };

  // Marked read/unread from the header drop-down — pick it up here too.
  useEffect(() => {
    if (!profileId) return;
    const onChanged = () => {
      void refreshInbox(profileId);
      void refreshChannelUnread(profileId);
    };
    window.addEventListener("ahs:unread-changed", onChanged);
    return () => window.removeEventListener("ahs:unread-changed", onChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

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
      if (replyTo) {
        const replyToId = replyTo.id;
        setReplyTo(null);
        setLinks((prev) => new Map(prev).set(row.id, { replyToId, forwardedFromMessageId: null, forwardedFromName: null }));
        saveMessageLink(row.id, { replyToId }).catch((err) => toast.error(err instanceof Error ? err.message : "Couldn't save the reply link."));
      }
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

  // Reactions + reply/forward links for the open conversation (live on reactions).
  const messageIdsKey = messages.map((m) => m.id).join(",");
  useEffect(() => {
    if (!messageIdsKey) {
      setReactions(new Map());
      setLinks(new Map());
      return;
    }
    let alive = true;
    const ids = messageIdsKey.split(",");
    const load = () => {
      getReactions(ids).then((r) => alive && setReactions(r));
      getMessageLinks(ids).then((l) => alive && setLinks((prev) => new Map([...prev, ...l])));
    };
    load();
    const again = window.setTimeout(load, 1500);
    const unsub = subscribeReactions(() => getReactions(ids).then((r) => alive && setReactions(r)));
    return () => {
      alive = false;
      window.clearTimeout(again);
      unsub();
    };
  }, [messageIdsKey]);
  useEffect(() => {
    setReplyTo(null);
    setMenuFor(null);
  }, [activeThread?.id]);
  useEffect(() => {
    if (!menuFor) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".tm-menu, .tm-more")) setMenuFor(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuFor]);

  const react = async (m: MessageRow, emoji: string) => {
    if (!profileId) return;
    setMenuFor(null);
    const mine = (reactions.get(m.id) ?? []).find((g) => g.emoji === emoji)?.profileIds.includes(profileId) ?? false;
    setReactions((prev) => {
      const next = new Map(prev);
      const list = (next.get(m.id) ?? []).map((g) => ({ ...g, profileIds: [...g.profileIds] }));
      const g = list.find((x) => x.emoji === emoji);
      if (mine && g) g.profileIds = g.profileIds.filter((id) => id !== profileId);
      else if (g) g.profileIds.push(profileId);
      else list.push({ emoji, profileIds: [profileId] });
      next.set(m.id, list.filter((x) => x.profileIds.length > 0));
      return next;
    });
    try {
      await toggleReaction(m.id, emoji, profileId, mine);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't react — try again.");
      getReactions(messageIdsKey.split(",")).then(setReactions);
    }
  };

  const forwardTo = async (person: ProfileRow) => {
    if (!forwardMsg || !profileId) return;
    try {
      const thread = await getOrCreateDmThread(profileId, person.id);
      const row = await sendMessage({ dmThreadId: thread.id, senderId: profileId, senderName: currentUserName, body: forwardMsg.body });
      const fromName = links.get(forwardMsg.id)?.forwardedFromName || forwardMsg.sender_name || "someone";
      await saveMessageLink(row.id, { forwardedFromMessageId: forwardMsg.id, forwardedFromName: fromName }).catch(() => undefined);
      if (activeThread && thread.id === activeThread.id) {
        setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
        setLinks((prev) => new Map(prev).set(row.id, { replyToId: null, forwardedFromMessageId: forwardMsg.id, forwardedFromName: fromName }));
      }
      applyIncomingMessage(row, { bumpUnread: false });
      toast.success(`Forwarded to ${person.display_name || person.email}`);
      setForwardMsg(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't forward — try again.");
    }
  };

  // Sent / Delivered / Seen — the open conversation (live), and the inbox rows whose last message is mine.
  const threadReceipt = useDmReceipt(activeThread?.id ?? null, activeThread?.otherProfileId || null, messages.length);
  const [inboxReceipts, setInboxReceipts] = useState<Map<string, DmReceiptState>>(new Map());
  const myLastThreads = inbox.filter((e) => e.lastMessageSenderId === profileId && e.otherProfileId).map((e) => `${e.threadId}|${e.otherProfileId}`).join(",");
  useEffect(() => {
    if (!open || view !== "list" || !myLastThreads) return;
    let alive = true;
    const load = () => {
      if (document.visibilityState === "hidden") return;
      const threads = myLastThreads.split(",").map((k) => {
        const [threadId, otherProfileId] = k.split("|");
        return { threadId, otherProfileId };
      });
      getDmReceipts(threads).then((m) => alive && setInboxReceipts(m)).catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, 8000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [open, view, myLastThreads]);

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
          className="fixed bottom-[132px] right-5 z-30 flex w-72 items-start gap-3 rounded-xl border border-white/10 bg-slate-800 p-3 text-left shadow-2xl transition-transform hover:-translate-y-0.5"
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
        <div className="fixed bottom-[132px] right-5 z-30 flex h-[520px] max-h-[70vh] w-[360px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
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
                        <div key={entry.threadId} className="group relative">
                        <button
                          onClick={() => void openThread(entry.threadId, entry.otherProfileId, name)}
                          className="flex w-full items-center gap-3 px-4 py-2.5 pr-11 text-left hover:bg-white/5 transition-colors"
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
                                {entry.lastMessageSenderId === profileId && (
                                  <ReceiptMark status={receiptFor(entry.lastMessageAt, inboxReceipts.get(entry.threadId))} state={inboxReceipts.get(entry.threadId)} className="mr-1 align-[-2px]" />
                                )}
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
                        <button
                          type="button"
                          onClick={() => void toggleThreadRead(entry.threadId, entry.unreadCount)}
                          title={entry.unreadCount > 0 ? "Mark as read" : "Mark as unread"}
                          aria-label={entry.unreadCount > 0 ? `Mark ${name} as read` : `Mark ${name} as unread`}
                          className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-slate-400 opacity-0 transition hover:bg-white/10 hover:text-white focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                        >
                          {entry.unreadCount > 0 ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                        </button>
                        </div>
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
                  messages.map((m, i) => {
                    const mine = m.sender_id === profileId;
                    const isLastMine = mine && !messages.slice(i + 1).some((x) => x.sender_id === profileId);
                    return (
                      <div key={m.id} className={`fm-msg flex flex-col ${mine ? "fm-msg--mine items-end" : "items-start"}`}>
                        {links.get(m.id)?.forwardedFromName && (
                          <div className="tm-fwd">
                            <Forward className="h-3 w-3" /> Forwarded from {links.get(m.id)!.forwardedFromName}
                          </div>
                        )}
                        {(() => {
                          const replyId = links.get(m.id)?.replyToId;
                          if (!replyId) return null;
                          const orig = messages.find((x) => x.id === replyId);
                          return (
                            <button type="button" className="tm-quote max-w-[75%]" onClick={() => document.getElementById(`fm-msg-${replyId}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>
                              <span className="tm-quote-name">{orig ? (orig.sender_id === profileId ? "You" : orig.sender_name || "—") : "Original message"}</span>
                              <span className="tm-quote-text">{orig ? orig.body : "Not loaded"}</span>
                            </button>
                          );
                        })()}
                        <div className={`flex w-full items-center gap-1 ${mine ? "flex-row-reverse" : ""}`}>
                        <div id={`fm-msg-${m.id}`} className={`max-w-[75%] min-w-0 rounded-2xl px-3 py-1.5 text-sm ${mine ? "bg-blue-600 text-white" : "bg-slate-700 text-slate-100"}`}>
                          <MessageBody text={m.body} className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]" />
                        </div>
                          <div className="relative">
                            <button type="button" className={`tm-more ${menuFor === m.id ? "tm-more--open" : ""}`} onClick={() => setMenuFor(menuFor === m.id ? null : m.id)} aria-label="Message actions">
                              <MoreHorizontal />
                            </button>
                            {menuFor === m.id && (
                              <div className={`tm-menu fm-menu ${mine ? "fm-menu--mine" : ""}`} role="menu">
                                <div className="tm-menu-emojis">
                                  {QUICK_REACTIONS.map((e) => (
                                    <button key={e} type="button" onClick={() => void react(m, e)} className="tm-emoji" aria-label={`React ${e}`}>
                                      {e}
                                    </button>
                                  ))}
                                </div>
                                <button type="button" role="menuitem" className="tm-menu-item" onClick={() => { setMenuFor(null); setReplyTo(m); }}>
                                  <CornerUpLeft /> Reply
                                </button>
                                <button type="button" role="menuitem" className="tm-menu-item" onClick={() => { setMenuFor(null); setForwardSearch(""); setForwardMsg(m); }}>
                                  <Forward /> Forward
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="tm-menu-item"
                                  onClick={() => {
                                    setMenuFor(null);
                                    navigator.clipboard.writeText(m.body).then(() => toast.success("Copied"), () => toast.error("Couldn't copy"));
                                  }}
                                >
                                  <Copy /> Copy text
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                        {(reactions.get(m.id) ?? []).length > 0 && (
                          <div className="tm-reactions">
                            {(reactions.get(m.id) ?? []).map((g) => {
                              const mineR = g.profileIds.includes(profileId);
                              return (
                                <button key={g.emoji} type="button" onClick={() => void react(m, g.emoji)} className={`tm-react ${mineR ? "tm-react--mine" : ""}`} title={g.profileIds.map((id) => (id === profileId ? "You" : usersById.get(id)?.display_name || "Someone")).join(", ")}>
                                  <span>{g.emoji}</span>
                                  <span className="tabular-nums">{g.profileIds.length}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                        {isLastMine && <ReceiptMark status={receiptFor(m.created_at, threadReceipt)} state={threadReceipt} withText className="mt-0.5 mr-1" />}
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>
              {forwardMsg && (
                <div className="fm-forward">
                  <div className="flex items-center gap-2 px-3 pt-2.5">
                    <Forward className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
                    <span className="flex-1 truncate text-xs font-semibold">Forward to…</span>
                    <button type="button" onClick={() => setForwardMsg(null)} className="btn btn-ghost btn-sm" aria-label="Cancel forward">
                      <X />
                    </button>
                  </div>
                  <label className="tm-search !mx-3 !my-2">
                    <Search className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
                    <input autoFocus value={forwardSearch} onChange={(e) => setForwardSearch(e.target.value)} placeholder="Search people" />
                  </label>
                  <div className="max-h-48 overflow-y-auto px-1.5 pb-2">
                    {users
                      .filter((u) => u.id !== profileId && (u.display_name || u.email || "").toLowerCase().includes(forwardSearch.trim().toLowerCase()))
                      .slice(0, 40)
                      .map((u) => (
                        <button key={u.id} type="button" onClick={() => void forwardTo(u)} className="tm-item">
                          <span className="truncate font-semibold">{u.display_name || u.email}</span>
                          <Forward className="ml-auto h-3.5 w-3.5 opacity-50" />
                        </button>
                      ))}
                  </div>
                </div>
              )}
              {replyTo && (
                <div className="tm-replybar !mx-2.5 !mb-0 !mt-2">
                  <CornerUpLeft className="h-3.5 w-3.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-semibold">Replying to {replyTo.sender_id === profileId ? "yourself" : replyTo.sender_name || "—"}</div>
                    <div className="truncate text-[12px] text-[var(--color-muted-foreground)]">{replyTo.body}</div>
                  </div>
                  <button type="button" onClick={() => setReplyTo(null)} className="btn btn-ghost btn-sm" aria-label="Cancel reply">
                    <X />
                  </button>
                </div>
              )}
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
        className="fixed bottom-16 right-20 z-30 grid h-14 w-14 place-items-center rounded-full bg-blue-600 text-white shadow-[0_12px_30px_rgba(0,0,0,0.35)] transition-transform hover:scale-105 hover:bg-blue-500"
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
