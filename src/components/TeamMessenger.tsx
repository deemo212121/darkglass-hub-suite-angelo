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
import { ChevronLeft, Hash, Home, Lock, MessageCircle, Plus, Search, Send, UserPlus, Users2, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { hasDashboardAccess } from "@/lib/dashboardAccess";
import { resolvePresenceStatus, PRESENCE_DOT_CLASS, PRESENCE_LABEL } from "@/lib/presence";
import { MessageBody } from "@/components/MessageBody";
import {
  type ChannelRow,
  type MessageRow,
  addChannelMembers,
  createChannel,
  getChannelMembers,
  getChannelMessages,
  getDmMessages,
  getOrCreateDmThread,
  listChannels,
  markThreadRead,
  notifyChannelMention,
  removeChannelMember,
  sendMessage as sendMessageRow,
  subscribeToMessages,
} from "@/lib/supabase/messaging";
import {
  getCompanyUsers,
  getMyProfileId,
  type ProfileRow,
} from "@/lib/supabase/users";

const CHANNEL_ADMIN_ROLES = ["ADMIN", "SUPERADMIN"];

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
  "SENIOR_MANAGER",
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
  const { email, ready, uid, displayName, role, extraRoles } = useAuth();
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
  const draftRef = useRef<HTMLTextAreaElement>(null);

  const currentUserName = displayName || email || "Current User";
  const canPostAnnouncement = HIGHER_UP_ROLES.has(String(role || "").toUpperCase());
  // Who can create channels and add/remove employees from them (server-side
  // enforced too — RLS's can_manage_channels(), migration 0137).
  const canManageChannels = hasDashboardAccess(CHANNEL_ADMIN_ROLES, role, extraRoles);

  // Members of the currently-open channel (channel_members rows) — empty
  // for every pre-0137 open channel, since membership was never populated
  // for those; mention/member-list UI falls back to "everyone" in that case.
  const [channelMemberIds, setChannelMemberIds] = useState<string[]>([]);

  // Create Channel modal
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState(false);
  const [newChannelTitle, setNewChannelTitle] = useState("");
  const [newChannelSubtitle, setNewChannelSubtitle] = useState("");
  const [newChannelMemberIds, setNewChannelMemberIds] = useState<Set<string>>(new Set());
  const [newChannelDeptFilter, setNewChannelDeptFilter] = useState("");
  const [creatingChannel, setCreatingChannel] = useState(false);

  // Add Employee (to the currently-open channel) modal
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [addMemberIds, setAddMemberIds] = useState<Set<string>>(new Set());
  const [addMemberDeptFilter, setAddMemberDeptFilter] = useState("");
  const [savingMembers, setSavingMembers] = useState(false);

  // "@" mention autocomplete in the composer.
  const [mentionTrigger, setMentionTrigger] = useState<{ start: number; query: string } | null>(null);
  const [mentionedIds, setMentionedIds] = useState<Set<string>>(new Set());

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
        const others = users.filter((u) => u.id !== profileId && u.is_active);
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

  // Membership list for the open channel — drives the Thread Details member
  // list, "Add Employee", and who can be @mentioned.
  useEffect(() => {
    setMentionTrigger(null);
    setMentionedIds(new Set());
    if (active?.kind !== "channel") { setChannelMemberIds([]); return; }
    let cancelled = false;
    getChannelMembers(active.id)
      .then((ids) => { if (!cancelled) setChannelMemberIds(ids); })
      .catch((err) => console.error("Failed to load channel members:", err));
    return () => { cancelled = true; };
  }, [active?.id, active?.kind]);

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

  // Every distinct department among company employees — narrows the long
  // employee-picker checkbox lists in Create Channel / Add Employee.
  const departmentOptions = useMemo(
    () => Array.from(new Set(contacts.map((c) => c.department).filter((d): d is string => Boolean(d)))).sort((a, b) => a.localeCompare(b)),
    [contacts]
  );

  const openDm = async (other: ProfileRow) => {
    if (!profileId) return;
    try {
      const thread = await getOrCreateDmThread(profileId, other.id);
      setActive({ kind: "dm", id: thread.id, participant: other });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Everyone eligible to be @mentioned in the open channel — restricted to
  // channel_members when the channel actually has any recorded, otherwise
  // every company contact (covers every pre-0137 open channel, which never
  // had channel_members populated, so an empty list there means "nobody's
  // membership was ever tracked", not "nobody's in it").
  const mentionCandidates = useMemo<ProfileRow[]>(() => {
    if (active?.kind !== "channel" || !profileId) return [];
    const self = { id: profileId, display_name: currentUserName, email: email || "" } as ProfileRow;
    const pool = [self, ...contacts];
    if (channelMemberIds.length > 0) {
      const memberSet = new Set(channelMemberIds);
      return pool.filter((p) => memberSet.has(p.id));
    }
    return pool;
  }, [active?.kind, active?.id, contacts, channelMemberIds, profileId, currentUserName, email]);

  const mentionNames = useMemo(
    () => mentionCandidates.map((p) => p.display_name || p.email).filter((n): n is string => Boolean(n)),
    [mentionCandidates]
  );

  const mentionSuggestions = useMemo(() => {
    if (!mentionTrigger) return [];
    const q = mentionTrigger.query.trim().toLowerCase();
    const list = q
      ? mentionCandidates.filter((p) => (p.display_name || p.email || "").toLowerCase().includes(q))
      : mentionCandidates;
    return list.slice(0, 8);
  }, [mentionTrigger, mentionCandidates]);

  // Detects an in-progress "@partial name" trigger ending at the cursor —
  // names can contain spaces, so this looks back from the cursor to the
  // nearest "@" rather than splitting on whitespace.
  const handleDraftChange = (value: string, cursorPos: number) => {
    setDraft(value);
    const uptoCursor = value.slice(0, cursorPos);
    const atIndex = uptoCursor.lastIndexOf("@");
    if (atIndex === -1) { setMentionTrigger(null); return; }
    const between = uptoCursor.slice(atIndex + 1);
    if (between.includes("\n") || between.length > 40) { setMentionTrigger(null); return; }
    const charBefore = atIndex > 0 ? value[atIndex - 1] : "";
    if (charBefore && !/\s/.test(charBefore)) { setMentionTrigger(null); return; }
    setMentionTrigger({ start: atIndex, query: between });
  };

  const selectMention = (p: ProfileRow) => {
    if (!mentionTrigger) return;
    const name = p.display_name || p.email;
    const cursorPos = draftRef.current?.selectionStart ?? draft.length;
    const before = draft.slice(0, mentionTrigger.start);
    const after = draft.slice(cursorPos);
    const next = `${before}@${name} ${after}`;
    setDraft(next);
    setMentionedIds((prev) => new Set(prev).add(p.id));
    setMentionTrigger(null);
    const newCursor = before.length + name.length + 2;
    requestAnimationFrame(() => {
      draftRef.current?.focus();
      draftRef.current?.setSelectionRange(newCursor, newCursor);
    });
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

      // Notify anyone @mentioned via the autocomplete AND still present in
      // the sent text (covers a mention that got backspaced out afterward).
      if (active.kind === "channel" && mentionedIds.size > 0) {
        const stillMentioned = mentionCandidates
          .filter((p) => mentionedIds.has(p.id) && body.includes(`@${p.display_name || p.email}`))
          .map((p) => p.id);
        if (stillMentioned.length > 0) {
          void notifyChannelMention({
            mentionedProfileIds: stillMentioned,
            senderId: profileId,
            senderName: currentUserName,
            channelId: active.id,
            channelTitle: active.channel.title,
            messageBody: body,
          });
        }
      }

      setDraft("");
      setMentionedIds(new Set());
      setMentionTrigger(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCreateChannel = async () => {
    if (!profileId || !newChannelTitle.trim()) return;
    setCreatingChannel(true);
    try {
      const channel = await createChannel({
        title: newChannelTitle,
        subtitle: newChannelSubtitle,
        createdBy: profileId,
        memberProfileIds: Array.from(newChannelMemberIds),
      });
      setChannels((prev) => [...prev, channel]);
      setActive({ kind: "channel", id: channel.id, channel });
      setIsCreateChannelOpen(false);
      setNewChannelTitle("");
      setNewChannelSubtitle("");
      setNewChannelMemberIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingChannel(false);
    }
  };

  const handleAddMembers = async () => {
    if (active?.kind !== "channel" || addMemberIds.size === 0) return;
    setSavingMembers(true);
    try {
      await addChannelMembers(active.id, Array.from(addMemberIds));
      setChannelMemberIds((prev) => Array.from(new Set([...prev, ...addMemberIds])));
      setIsAddMemberOpen(false);
      setAddMemberIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingMembers(false);
    }
  };

  const handleRemoveMember = async (memberProfileId: string) => {
    if (active?.kind !== "channel") return;
    try {
      await removeChannelMember(active.id, memberProfileId);
      setChannelMemberIds((prev) => prev.filter((id) => id !== memberProfileId));
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
          {mod.label}
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
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                <Hash className="h-3.5 w-3.5" />
                Channels
              </div>
              {canManageChannels && (
                <button
                  type="button"
                  onClick={() => { setNewChannelDeptFilter(""); setIsCreateChannelOpen(true); }}
                  className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-300 transition hover:bg-white/10 hover:text-white"
                  title="Create a new channel"
                >
                  <Plus className="h-3 w-3" /> New
                </button>
              )}
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
                      {ch.is_private ? <Lock className="h-4 w-4 text-slate-400" /> : <Hash className="h-4 w-4 text-slate-400" />}
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
                      <div className="relative shrink-0">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white">
                          {initials(r.display_name || r.email)}
                        </div>
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-slate-950 ${PRESENCE_DOT_CLASS[resolvePresenceStatus(r)]}`}
                          title={PRESENCE_LABEL[resolvePresenceStatus(r)]}
                        />
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
              <h2 className="mt-1 flex items-center gap-2 text-2xl font-bold">
                {activeTitle}
                {active?.kind === "dm" && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300" title={PRESENCE_LABEL[resolvePresenceStatus(active.participant)]}>
                    <span className={`h-2 w-2 rounded-full ${PRESENCE_DOT_CLASS[resolvePresenceStatus(active.participant)]}`} />
                    {PRESENCE_LABEL[resolvePresenceStatus(active.participant)]}
                  </span>
                )}
              </h2>
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
                  <MessageBody
                    text={m.body}
                    className="whitespace-pre-wrap leading-6"
                    mentionNames={active?.kind === "channel" ? mentionNames : undefined}
                  />
                </div>
              );
            })}
            <div ref={endRef} />
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/80 p-3">
            <label htmlFor="team-messenger-draft" className="sr-only">Message composer</label>
            <div className="relative">
              {mentionTrigger && mentionSuggestions.length > 0 && (
                <div className="absolute bottom-full left-0 z-20 mb-2 w-72 overflow-hidden rounded-xl border border-white/15 bg-slate-900 shadow-2xl">
                  {mentionSuggestions.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); selectMention(p); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-white/10"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold text-white">
                        {initials(p.display_name || p.email)}
                      </span>
                      <span className="truncate">{p.display_name || p.email}</span>
                    </button>
                  ))}
                </div>
              )}
              <textarea
                id="team-messenger-draft"
                ref={draftRef}
                value={draft}
                onChange={(e) => handleDraftChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && mentionTrigger) {
                    setMentionTrigger(null);
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey && !mentionTrigger) {
                    e.preventDefault();
                    send();
                  }
                }}
                disabled={!active || (isAnnouncementsChannel && !canPostAnnouncement)}
                placeholder={
                  !active
                    ? "Select a channel or teammate to start chatting…"
                    : active.kind === "channel"
                      ? `Message ${activeTitle}… (type @ to mention someone)`
                      : `Message ${activeTitle}…`
                }
                className="glass-input min-h-28 w-full resize-none rounded-xl bg-slate-900 text-white placeholder:text-slate-500"
              />
            </div>
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
              <div className="mt-2 flex items-center gap-2 text-white">
                {active.channel.is_private && <Lock className="h-3.5 w-3.5 text-slate-400" />}
                {active.channel.title}
              </div>
              {active.channel.subtitle && (
                <div className="mt-1 text-slate-300">{active.channel.subtitle}</div>
              )}
              <div className="mt-3 text-xs text-slate-400">
                {active.channel.is_announcement
                  ? "Broadcast channel — only leadership can post."
                  : active.channel.is_private
                    ? "Private — only added employees can see and post here."
                    : "Open to all employees in this company."}
              </div>

              {active.channel.is_private && (
                <div className="mt-4 border-t border-white/10 pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">
                      Members ({mentionCandidates.length})
                    </span>
                    {canManageChannels && (
                      <button
                        type="button"
                        onClick={() => { setAddMemberIds(new Set()); setAddMemberDeptFilter(""); setIsAddMemberOpen(true); }}
                        className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-300 transition hover:bg-white/10 hover:text-white"
                      >
                        <UserPlus className="h-3 w-3" /> Add
                      </button>
                    )}
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {mentionCandidates.map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-2 py-1.5">
                        <span className="truncate text-slate-200">
                          {p.display_name || p.email}{p.id === profileId ? " (you)" : ""}
                        </span>
                        {canManageChannels && p.id !== active.channel.created_by && (
                          <button
                            type="button"
                            onClick={() => handleRemoveMember(p.id)}
                            title="Remove from channel"
                            className="shrink-0 text-slate-500 transition hover:text-red-300"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
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

      {isCreateChannelOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setIsCreateChannelOpen(false)}>
          <div
            className="w-full max-w-md rounded-2xl border border-white/15 bg-slate-900 p-5 text-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-lg font-bold">Create Channel</h3>
              <button type="button" onClick={() => setIsCreateChannelOpen(false)} className="text-white/40 hover:text-white/80">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Name</label>
                <input
                  value={newChannelTitle}
                  onChange={(e) => setNewChannelTitle(e.target.value)}
                  placeholder="e.g. project-launch"
                  className="glass-input w-full bg-slate-800/50 text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Description (optional)</label>
                <input
                  value={newChannelSubtitle}
                  onChange={(e) => setNewChannelSubtitle(e.target.value)}
                  placeholder="What's this channel for?"
                  className="glass-input w-full bg-slate-800/50 text-white"
                />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Add employees ({newChannelMemberIds.size} selected)
                  </label>
                  <select
                    value={newChannelDeptFilter}
                    onChange={(e) => setNewChannelDeptFilter(e.target.value)}
                    className="glass-input w-40 bg-slate-800/50 py-1 text-xs text-white"
                  >
                    <option value="">All Departments</option>
                    {departmentOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-slate-950/60 p-2">
                  {contacts.filter((c) => !newChannelDeptFilter || c.department === newChannelDeptFilter).map((c) => {
                    const checked = newChannelMemberIds.has(c.id);
                    return (
                      <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-white/5">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setNewChannelMemberIds((prev) => {
                            const next = new Set(prev);
                            if (checked) next.delete(c.id); else next.add(c.id);
                            return next;
                          })}
                          className="accent-blue-500"
                        />
                        <span className="truncate text-slate-200">{c.display_name || c.email}</span>
                      </label>
                    );
                  })}
                  {contacts.filter((c) => !newChannelDeptFilter || c.department === newChannelDeptFilter).length === 0 && (
                    <div className="px-2 py-4 text-center text-xs text-slate-500">No employees in this department.</div>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500">You're added automatically. This channel is private — only added employees (plus Admin/SuperAdmin) can see it.</p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsCreateChannelOpen(false)}
                className="rounded-md border border-white/15 bg-slate-950/90 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-slate-200/40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateChannel}
                disabled={creatingChannel || !newChannelTitle.trim()}
                className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creatingChannel ? "Creating…" : "Create Channel"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isAddMemberOpen && active?.kind === "channel" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setIsAddMemberOpen(false)}>
          <div
            className="w-full max-w-md rounded-2xl border border-white/15 bg-slate-900 p-5 text-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-lg font-bold">Add Employees to {active.channel.title}</h3>
              <button type="button" onClick={() => setIsAddMemberOpen(false)} className="text-white/40 hover:text-white/80">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4">
              <div className="mb-1 flex items-center justify-end">
                <select
                  value={addMemberDeptFilter}
                  onChange={(e) => setAddMemberDeptFilter(e.target.value)}
                  className="glass-input w-40 bg-slate-800/50 py-1 text-xs text-white"
                >
                  <option value="">All Departments</option>
                  {departmentOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-slate-950/60 p-2">
                {contacts.filter((c) => !channelMemberIds.includes(c.id) && (!addMemberDeptFilter || c.department === addMemberDeptFilter)).map((c) => {
                  const checked = addMemberIds.has(c.id);
                  return (
                    <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-white/5">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setAddMemberIds((prev) => {
                          const next = new Set(prev);
                          if (checked) next.delete(c.id); else next.add(c.id);
                          return next;
                        })}
                        className="accent-blue-500"
                      />
                      <span className="truncate text-slate-200">{c.display_name || c.email}</span>
                    </label>
                  );
                })}
                {contacts.filter((c) => !channelMemberIds.includes(c.id) && (!addMemberDeptFilter || c.department === addMemberDeptFilter)).length === 0 && (
                  <div className="px-2 py-4 text-center text-xs text-slate-500">No matching employees to add.</div>
                )}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsAddMemberOpen(false)}
                className="rounded-md border border-white/15 bg-slate-950/90 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-slate-200/40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddMembers}
                disabled={savingMembers || addMemberIds.size === 0}
                className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingMembers ? "Adding…" : `Add ${addMemberIds.size || ""}`.trim()}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
