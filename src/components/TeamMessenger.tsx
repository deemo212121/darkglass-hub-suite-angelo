/**
 * Team Messenger — backed by Supabase.
 *
 * Channels and DMs are read from / written to the messaging tables defined
 * in 0001_init.sql. Company isolation is enforced by RLS. Default channels
 * (#announcements, #general, …) are auto-seeded for new tenants on first
 * load.
 *
 * Realtime: subscribes to INSERT on the messages table filtered to the
 * currently-open channel/thread so other tabs and users see new lines as
 * they arrive.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Hash, Home, MessageCircle, Search, Send, Users2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { MessageBody } from "@/components/MessageBody";
import {
  type ChannelRow,
  type MessageRow,
  getChannelMessages,
  getDmMessages,
  getOrCreateDmThread,
  listChannels,
  markThreadRead,
  sendMessage as sendMessageRow,
  subscribeToMessages,
} from "@/lib/supabase/messaging";
import {
  getCompanyUsers,
  getMyProfileId,
  type ProfileRow,
} from "@/lib/supabase/users";

interface Props {
  mod: ModuleDef;
  sub: SubModuleDef;
}

type ActiveThread =
  | { kind: "channel"; id: string; channel: ChannelRow }
  | { kind: "dm"; id: string; participant: ProfileRow };

// Higher-up roles are the only ones allowed to post in #announcements.
const HIGHER_UP_ROLES = new Set([
  "SUPERADMIN",
  "ADMIN",
  "MANAGER",
  "HR",
  "BRANCH_MANAGER",
  "SENIOR_BRANCH_MANAGER",
  "CSR_MANAGER",
  "CLAIMS_MANAGER",
  "PARTS_MANAGER",
  "BIZOPS_MANAGER",
  "BIZOPS_SENIOR_MANAGER",
]);

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function initials(name: string) {
  return name
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function TeamMessenger({ mod, sub }: Props) {
  const { email, ready, uid, displayName, role } = useAuth();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [contacts, setContacts] = useState<ProfileRow[]>([]);
  const [active, setActive] = useState<ActiveThread | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [loadingThread, setLoadingThread] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const currentUserName = displayName || email || "Current User";
  const canPostAnnouncement = HIGHER_UP_ROLES.has(String(role || "").toUpperCase());

  // 1. Resolve my Supabase profile id from my Firebase uid (once).
  useEffect(() => {
    if (!ready || !uid) return;
    let cancelled = false;
    getMyProfileId(uid)
      .then((id) => { if (!cancelled) setProfileId(id); })
      .catch((err) => { if (!cancelled) setError(err.message || String(err)); });
    return () => { cancelled = true; };
  }, [ready, uid]);

  // 2. Load channels + contacts. Channels auto-seed on empty tenant.
  useEffect(() => {
    if (!ready || !profileId) return;
    let cancelled = false;
    Promise.all([listChannels(), getCompanyUsers()])
      .then(async ([chans, users]) => {
        if (cancelled) return;
        setChannels(chans);
        // Hide myself from the contact list.
        const others = users.filter((u) => u.id !== profileId);
        setContacts(others);

        // If the URL hash points to a specific thread (#channel=… or #dm=…)
        // open it; otherwise default to the first channel.
        const hash = typeof window !== "undefined" ? window.location.hash : "";
        if (hash.startsWith("#channel=")) {
          const id = hash.slice("#channel=".length);
          const ch = chans.find((c) => c.id === id);
          if (ch) {
            setActive({ kind: "channel", id: ch.id, channel: ch });
            return;
          }
        }
        if (hash.startsWith("#dm=")) {
          const otherId = hash.slice("#dm=".length);
          const other = others.find((u) => u.id === otherId);
          if (other) {
            try {
              const { getOrCreateDmThread } = await import("@/lib/supabase/messaging");
              const thread = await getOrCreateDmThread(profileId, other.id);
              setActive({ kind: "dm", id: thread.id, participant: other });
              return;
            } catch { /* fall through to default */ }
          }
        }

        if (!active && chans.length > 0) {
          setActive({ kind: "channel", id: chans[0].id, channel: chans[0] });
        }
      })
      .catch((err) => { if (!cancelled) setError(err.message || String(err)); });
    return () => { cancelled = true; };
  }, [ready, profileId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Watch the URL hash so that clicking a thread from the header dropdown
  // (which already lives at this route) actually switches the open thread.
  useEffect(() => {
    if (!profileId) return;
    const handleHash = async () => {
      const hash = window.location.hash.replace(/^#/, "");
      if (!hash) return;
      if (hash.startsWith("channel=")) {
        const id = hash.slice("channel=".length);
        const ch = channels.find((c) => c.id === id);
        if (ch) setActive({ kind: "channel", id: ch.id, channel: ch });
        return;
      }
      if (hash.startsWith("dm=")) {
        const otherId = hash.slice("dm=".length);
        const other = contacts.find((u) => u.id === otherId);
        if (!other) return;
        try {
          const thread = await getOrCreateDmThread(profileId, other.id);
          setActive({ kind: "dm", id: thread.id, participant: other });
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, [profileId, channels, contacts]);
  useEffect(() => {
    if (!active) return;
    setLoadingThread(true);
    let cancelled = false;
    const loader = active.kind === "channel"
      ? getChannelMessages(active.id)
      : getDmMessages(active.id);

    loader
      .then((rows) => {
        if (cancelled) return;
        setMessages(rows);
        // Opening a thread marks it read. Also tell the header so it can drop
        // its unread badge immediately.
        if (profileId) {
          markThreadRead({
            profileId,
            channelId: active.kind === "channel" ? active.id : null,
            dmThreadId: active.kind === "dm" ? active.id : null,
          }).then(() => {
            window.dispatchEvent(new CustomEvent("ahs:unread-changed"));
          }).catch(() => { /* ignore */ });
        }
      })
      .catch((err) => { if (!cancelled) setError(err.message || String(err)); })
      .finally(() => { if (!cancelled) setLoadingThread(false); });

    const unsubscribe = subscribeToMessages({
      channelId: active.kind === "channel" ? active.id : null,
      dmThreadId: active.kind === "dm" ? active.id : null,
      onMessage: (row) => {
        setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
      },
    });

    // Polling fallback (2s) — covers tenants that don't have Supabase realtime
    // turned on for the messages table. Cheap: it's just one indexed query per
    // active thread, and only while the thread is open.
    const pollId = window.setInterval(async () => {
      try {
        const rows = active.kind === "channel"
          ? await getChannelMessages(active.id)
          : await getDmMessages(active.id);
        if (cancelled) return;
        setMessages((prev) => {
          if (prev.length === rows.length) return prev;
          return rows;
        });
      } catch { /* ignore */ }
    }, 2000);

    return () => {
      cancelled = true;
      unsubscribe();
      window.clearInterval(pollId);
    };
  }, [active?.id, active?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to bottom whenever new messages arrive.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, active?.id]);

  const filteredContacts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return contacts;
    return contacts.filter((r) => {
      const haystack = [
        r.display_name ?? "",
        r.email,
        r.username ?? "",
        r.role,
        r.assigned_branch ?? "",
        r.department ?? "",
      ].join(" ").toLowerCase();
      return haystack.includes(term);
    });
  }, [contacts, search]);

  const openDm = async (other: ProfileRow) => {
    if (!profileId) return;
    try {
      const thread = await getOrCreateDmThread(profileId, other.id);
      setActive({ kind: "dm", id: thread.id, participant: other });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const send = async () => {
    if (!active || !profileId) return;
    const body = draft.trim();
    if (!body) return;
    const isAnnouncement = active.kind === "channel" && active.channel.is_announcement;
    if (isAnnouncement && !canPostAnnouncement) return;

    try {
      const row = await sendMessageRow({
        channelId: active.kind === "channel" ? active.id : null,
        dmThreadId: active.kind === "dm" ? active.id : null,
        senderId: profileId,
        senderName: currentUserName,
        body,
        isAnnouncement,
      });
      // Optimistically append; the realtime subscription will dedupe by id.
      setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!ready) return null;

  const activeTitle = active?.kind === "channel"
    ? active.channel.title
    : active?.kind === "dm"
      ? (active.participant.display_name || active.participant.email)
      : "";
  const activeSubtitle = active?.kind === "channel"
    ? (active.channel.subtitle || "")
    : active?.kind === "dm"
      ? `${active.participant.role}${active.participant.assigned_branch ? ` · ${active.participant.assigned_branch}` : ""}`
      : "";
  const isAnnouncementsChannel = active?.kind === "channel" && active.channel.is_announcement;

  return (
    <main className="max-w-[1600px] mx-auto px-4 py-6 lg:px-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="inline-flex items-center hover:text-foreground" aria-label="Home" title="Home">
          <Home className="h-3.5 w-3.5" />
        </Link>
        <span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">{mod.label}</Link>
        <span>›</span>
        <span className="text-foreground font-medium">{sub.title}</span>
      </div>

      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Team Messenger</h1>
          <p className="text-sm text-muted-foreground">Chat with employees, teams, and broadcast channels.</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_300px]">
        <aside className="rounded-2xl border border-white/15 bg-white/8 p-4 text-white backdrop-blur-md">
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people or channels"
              className="w-full bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
            />
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
              <Hash className="h-3.5 w-3.5" />
              Channels
            </div>
            <div className="space-y-2">
              {channels.map((ch) => {
                const isActive = active?.kind === "channel" && active.id === ch.id;
                return (
                  <button
                    key={ch.id}
                    onClick={() => setActive({ kind: "channel", id: ch.id, channel: ch })}
                    className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                      isActive
                        ? "border-blue-400/50 bg-blue-500/15 text-white"
                        : "border-white/10 bg-slate-950/70 text-slate-200 hover:bg-white/8 hover:text-white"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Hash className="h-4 w-4 text-slate-400" />
                      <span className="font-semibold">{ch.title}</span>
                      {ch.is_announcement && (
                        <span className="ml-auto rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-300">
                          Broadcast
                        </span>
                      )}
                    </div>
                    {ch.subtitle && <div className="mt-1 text-xs text-slate-400">{ch.subtitle}</div>}
                  </button>
                );
              })}
              {channels.length === 0 && (
                <div className="rounded-xl border border-dashed border-white/10 bg-slate-950/70 px-3 py-3 text-xs text-slate-400">
                  Loading channels…
                </div>
              )}
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
              <Users2 className="h-3.5 w-3.5" />
              Employees
            </div>
            <div className="max-h-[42rem] space-y-2 overflow-y-auto pr-1">
              {filteredContacts.map((r) => {
                const isActive = active?.kind === "dm" && active.participant.id === r.id;
                return (
                  <button
                    key={r.id}
                    onClick={() => openDm(r)}
                    className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                      isActive
                        ? "border-blue-400/50 bg-blue-500/15 text-white"
                        : "border-white/10 bg-slate-950/70 text-slate-200 hover:bg-white/8 hover:text-white"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white">
                        {initials(r.display_name || r.email)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">{r.display_name || r.email}</div>
                        <div className="truncate text-xs text-slate-400">
                          {r.role}{r.assigned_branch ? ` · ${r.assigned_branch}` : ""}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
              {filteredContacts.length === 0 && (
                <div className="rounded-xl border border-dashed border-white/10 bg-slate-950/70 px-3 py-3 text-xs text-slate-400">
                  No teammates match that search.
                </div>
              )}
            </div>
          </div>
        </aside>

        <section className="rounded-2xl border border-white/15 bg-white/8 p-4 text-white backdrop-blur-md">
          <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
            <div>
              <div className="text-xs uppercase tracking-[0.12em] text-slate-400">
                {active?.kind === "channel" ? "Channel" : active?.kind === "dm" ? "Direct Message" : ""}
              </div>
              <h2 className="mt-1 text-2xl font-bold">{activeTitle}</h2>
              {activeSubtitle && <p className="mt-1 text-sm text-slate-300">{activeSubtitle}</p>}
            </div>
            <div className="rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-right text-xs text-slate-400">
              <div className="font-semibold text-white">{currentUserName}</div>
              <div>{role || ""}</div>
            </div>
          </div>

          <div className="mt-4 max-h-[50rem] space-y-3 overflow-y-auto pr-1">
            {loadingThread && (
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                Loading messages…
              </div>
            )}
            {!loadingThread && messages.length === 0 && (
              <div className="rounded-xl border border-dashed border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-400">
                No messages yet. Be the first to say hi.
              </div>
            )}
            {messages.map((m) => {
              const isMe = m.sender_id === profileId;
              const isSystem = m.kind === "system";
              return (
                <div
                  key={m.id}
                  className={`rounded-2xl border px-4 py-3 text-sm shadow-sm ${
                    isSystem
                      ? "border-white/10 bg-white/5 text-slate-300"
                      : isMe
                        ? "ml-auto max-w-[82%] border-blue-500/30 bg-blue-500/15 text-white"
                        : "mr-auto max-w-[82%] border-white/10 bg-slate-950/90 text-slate-100"
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.08em] text-slate-400">
                    <span>{m.sender_name || (isMe ? currentUserName : "—")}</span>
                    <span>{formatTimestamp(m.created_at)}</span>
                  </div>
                  <MessageBody text={m.body} className="whitespace-pre-wrap leading-6" />
                </div>
              );
            })}
            <div ref={endRef} />
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/80 p-3">
            <label htmlFor="team-messenger-draft" className="sr-only">Message composer</label>
            <textarea
              id="team-messenger-draft"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              disabled={!active || (isAnnouncementsChannel && !canPostAnnouncement)}
              placeholder={
                !active
                  ? "Select a channel or teammate to start chatting…"
                  : `Message ${activeTitle}…`
              }
              className="glass-input min-h-28 w-full resize-none rounded-xl bg-slate-900 text-white placeholder:text-slate-500"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="text-xs text-slate-400">
                {isAnnouncementsChannel && !canPostAnnouncement
                  ? "Only admins, managers, and HR can post announcements."
                  : "Enter sends. Shift+Enter for newline."}
              </div>
              <button
                onClick={send}
                disabled={!active || (isAnnouncementsChannel && !canPostAnnouncement) || !draft.trim()}
                className="btn btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                Send
              </button>
            </div>
          </div>
        </section>

        <aside className="rounded-2xl border border-white/15 bg-white/8 p-4 text-white backdrop-blur-md">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
            <MessageCircle className="h-3.5 w-3.5" />
            Thread Details
          </div>

          {active?.kind === "channel" ? (
            <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/80 p-4 text-sm">
              <div className="text-xs uppercase tracking-[0.12em] text-slate-400">Channel</div>
              <div className="mt-2 text-white">{active.channel.title}</div>
              {active.channel.subtitle && (
                <div className="mt-1 text-slate-300">{active.channel.subtitle}</div>
              )}
              <div className="mt-3 text-xs text-slate-400">
                {active.channel.is_announcement
                  ? "Broadcast channel — only leadership can post."
                  : "Open to all employees in this company."}
              </div>
            </div>
          ) : active?.kind === "dm" ? (
            <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/80 p-4 text-sm">
              <div className="text-xs uppercase tracking-[0.12em] text-slate-400">Direct Message</div>
              <div className="mt-2 space-y-2 text-slate-300">
                <div><span className="text-slate-500">Name:</span> {active.participant.display_name || "—"}</div>
                <div><span className="text-slate-500">Role:</span> {active.participant.role}</div>
                <div><span className="text-slate-500">Branch:</span> {active.participant.assigned_branch || "—"}</div>
                <div><span className="text-slate-500">Email:</span> {active.participant.email}</div>
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/80 p-4 text-sm text-slate-300">
              Pick a channel or teammate to start a conversation.
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
