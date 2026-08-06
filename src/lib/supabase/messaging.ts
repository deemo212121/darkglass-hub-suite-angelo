/**
 * Internal Message Support — Supabase backed messaging.
 *
 * Talks to the four tables defined in 0001_init.sql:
 *   - message_channels   (named broadcast channels, one row per channel)
 *   - dm_threads         (1:1 chats between two profiles)
 *   - messages           (chat lines; either channel_id or dm_thread_id)
 *   - message_reads      (per-user last-read pointer per channel/dm)
 *
 * Company isolation is enforced by RLS — every query is scoped to the
 * authenticated user's company automatically.
 */

import { supabase } from "./client";

// Date.now() alone collides when two components subscribe in the same
// millisecond (e.g. MessagesMenu + NotificationsMenu both mounting in
// Header.tsx). supabase.channel(name) returns the SAME channel instance for
// a repeated name, and calling .on() on an already-.subscribe()d channel
// throws — so every channel name needs a truly unique suffix.
function uniqueChannelSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface ChannelRow {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  kind: "channel" | "dm";
  is_announcement: boolean;
  is_system: boolean;
  /** Membership-restricted (see migration 0137) — only channel_members/creator/Admin-SuperAdmin can read or post. Defaults false: every pre-existing channel stays open to the whole company. */
  is_private: boolean;
  created_by: string | null;
  created_at: string;
}

const CHANNEL_COLUMNS = "id, slug, title, subtitle, kind, is_announcement, is_system, is_private, created_by, created_at";

export interface DmThreadRow {
  id: string;
  participant_a: string;
  participant_b: string;
  created_at: string;
}

export interface MessageRow {
  id: string;
  channel_id: string | null;
  dm_thread_id: string | null;
  sender_id: string | null;
  sender_name: string | null;
  body: string;
  kind: "system" | "user";
  is_announcement: boolean;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

/** Seed-of-the-truth default channels every company should have — all open (is_private defaults to false at the DB level). */
export const DEFAULT_CHANNELS: Array<Omit<ChannelRow, "id" | "created_at" | "is_private" | "created_by">> = [
  {
    slug: "announcements",
    title: "#announcements",
    subtitle: "Shout-outs and daily company notices",
    kind: "channel",
    is_announcement: true,
    is_system: false,
  },
  {
    slug: "all-employees",
    title: "#all-employees",
    subtitle: "Broadcast updates to every employee",
    kind: "channel",
    is_announcement: false,
    is_system: false,
  },
  {
    slug: "general",
    title: "#general",
    subtitle: "Company-wide chat and coordination",
    kind: "channel",
    is_announcement: false,
    is_system: false,
  },
  {
    slug: "service",
    title: "#service",
    subtitle: "Service, dispatch, and scheduling",
    kind: "channel",
    is_announcement: false,
    is_system: false,
  },
  {
    slug: "parts",
    title: "#parts",
    subtitle: "Parts ordering and receiving",
    kind: "channel",
    is_announcement: false,
    is_system: false,
  },
  {
    slug: "admin",
    title: "#admin",
    subtitle: "Leadership, HR, and account ops",
    kind: "channel",
    is_announcement: false,
    is_system: false,
  },
];

/**
 * Return all channels for the caller's company. Creates the default channel
 * set on first call so a brand-new tenant has a working chat UI immediately.
 */
export async function listChannels(): Promise<ChannelRow[]> {
  const { data, error } = await supabase
    .from("message_channels")
    .select(CHANNEL_COLUMNS)
    .eq("kind", "channel")
    .order("is_announcement", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const existing = (data as ChannelRow[]) ?? [];

  // Bootstrap default channels for empty tenants. (Never re-triggers just
  // because the caller isn't a member of some private channel — the
  // defaults are always is_private=false, so once seeded they stay visible
  // to everyone and `existing` is never empty again for this company.)
  if (existing.length === 0) {
    const inserts = DEFAULT_CHANNELS.map((c) => ({ ...c }));
    const { data: created, error: insErr } = await supabase
      .from("message_channels")
      .insert(inserts)
      .select(CHANNEL_COLUMNS);
    if (insErr) throw new Error(insErr.message);
    return (created as ChannelRow[]) ?? [];
  }

  return existing;
}

/**
 * Create a new private channel (Admin/SuperAdmin only — RLS enforces this
 * server-side via can_manage_channels(), migration 0137). The creator is
 * always added as a member alongside whoever else is passed in, so they
 * can immediately post/see it without a separate "add myself" step.
 */
export async function createChannel(input: {
  title: string;
  subtitle?: string;
  createdBy: string;
  memberProfileIds: string[];
}): Promise<ChannelRow> {
  const title = input.title.trim();
  if (!title) throw new Error("Channel name is required");
  const displayTitle = title.startsWith("#") ? title : `#${title}`;
  // (company_id, slug) is unique — the random suffix avoids a collision if
  // two channels would otherwise slugify to the same thing (e.g. "General"
  // and "general!").
  const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "channel"}-${Date.now().toString(36)}`;

  const { data, error } = await supabase
    .from("message_channels")
    .insert({
      slug,
      title: displayTitle,
      subtitle: input.subtitle?.trim() || null,
      kind: "channel",
      is_announcement: false,
      is_system: false,
      is_private: true,
      created_by: input.createdBy,
    })
    .select(CHANNEL_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  const channel = data as ChannelRow;

  const memberIds = Array.from(new Set([input.createdBy, ...input.memberProfileIds].filter(Boolean)));
  if (memberIds.length > 0) {
    const { error: memberErr } = await supabase
      .from("channel_members")
      .insert(memberIds.map((profileId) => ({ channel_id: channel.id, profile_id: profileId })));
    if (memberErr) throw new Error(memberErr.message);
  }
  return channel;
}

/** Every member's profile id for one channel. */
export async function getChannelMembers(channelId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("channel_members")
    .select("profile_id")
    .eq("channel_id", channelId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => r.profile_id as string);
}

/** Add one or more employees to a channel (Admin/SuperAdmin or the channel's own creator — RLS enforces it). Silently no-ops for anyone already a member. */
export async function addChannelMembers(channelId: string, profileIds: string[]): Promise<void> {
  const ids = profileIds.filter(Boolean);
  if (ids.length === 0) return;
  const { error } = await supabase
    .from("channel_members")
    .upsert(
      ids.map((profileId) => ({ channel_id: channelId, profile_id: profileId })),
      { onConflict: "channel_id,profile_id", ignoreDuplicates: true }
    );
  if (error) throw new Error(error.message);
}

/** Remove one employee from a channel (Admin/SuperAdmin, the channel's creator, or the member removing themselves). */
export async function removeChannelMember(channelId: string, profileId: string): Promise<void> {
  const { error } = await supabase
    .from("channel_members")
    .delete()
    .eq("channel_id", channelId)
    .eq("profile_id", profileId);
  if (error) throw new Error(error.message);
}

/** Resolve (or create) the dm thread between two profile ids. */
export async function getOrCreateDmThread(meId: string, otherId: string): Promise<DmThreadRow> {
  // We always store the lower uuid in participant_a so the unique constraint
  // doesn't get tripped by (a,b) vs (b,a) duplicates.
  const [a, b] = meId < otherId ? [meId, otherId] : [otherId, meId];
  const { data: existing, error: selErr } = await supabase
    .from("dm_threads")
    .select("id, participant_a, participant_b, created_at")
    .eq("participant_a", a)
    .eq("participant_b", b)
    .maybeSingle();
  if (selErr) throw new Error(selErr.message);
  if (existing) return existing as DmThreadRow;

  const { data: created, error: insErr } = await supabase
    .from("dm_threads")
    .insert({ participant_a: a, participant_b: b })
    .select("id, participant_a, participant_b, created_at")
    .single();
  if (insErr) throw new Error(insErr.message);
  return created as DmThreadRow;
}

/** Last N messages for a channel (oldest first for natural chat order). */
export async function getChannelMessages(channelId: string, limit = 200): Promise<MessageRow[]> {
  const { data, error } = await supabase
    .from("messages")
    .select(
      "id, channel_id, dm_thread_id, sender_id, sender_name, body, kind, is_announcement, created_at, edited_at, deleted_at"
    )
    .eq("channel_id", channelId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data as MessageRow[]) ?? [];
}

/** Last N messages for a DM thread. */
export async function getDmMessages(dmThreadId: string, limit = 200): Promise<MessageRow[]> {
  const { data, error } = await supabase
    .from("messages")
    .select(
      "id, channel_id, dm_thread_id, sender_id, sender_name, body, kind, is_announcement, created_at, edited_at, deleted_at"
    )
    .eq("dm_thread_id", dmThreadId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data as MessageRow[]) ?? [];
}

/**
 * Send a message to either a channel or a DM thread.
 * `senderId` and `senderName` are stored verbatim on the row for cheap display
 * — the message survives a profile rename. Announcement posting requires
 * elevated role (RLS enforces this server-side).
 */
export async function sendMessage(params: {
  channelId?: string | null;
  dmThreadId?: string | null;
  senderId: string;
  senderName: string;
  body: string;
  isAnnouncement?: boolean;
  /** "system" marks an app-generated notification (e.g. attendance note alerts) rather than a typed chat line. Defaults to "user". */
  kind?: "system" | "user";
}): Promise<MessageRow> {
  const body = params.body.trim();
  if (!body) throw new Error("Cannot send an empty message");
  if (!params.channelId && !params.dmThreadId) {
    throw new Error("sendMessage requires channelId or dmThreadId");
  }
  const payload = {
    channel_id: params.channelId ?? null,
    dm_thread_id: params.dmThreadId ?? null,
    sender_id: params.senderId,
    sender_name: params.senderName,
    body,
    kind: params.kind ?? ("user" as const),
    is_announcement: Boolean(params.isAnnouncement),
  };
  const { data, error } = await supabase
    .from("messages")
    .insert(payload)
    .select(
      "id, channel_id, dm_thread_id, sender_id, sender_name, body, kind, is_announcement, created_at, edited_at, deleted_at"
    )
    .single();
  if (error) throw new Error(error.message);
  return data as MessageRow;
}

/**
 * Bell-notify everyone @mentioned in a just-sent channel message —
 * group-chat-style "X mentioned you in #channel" alert, distinct from the
 * ordinary new-message badge the Messages icon already shows. Fire-and-
 * forget per recipient (one failure doesn't block the others); the sender
 * is skipped even if they mention themselves.
 */
export async function notifyChannelMention(input: {
  mentionedProfileIds: string[];
  senderId: string;
  senderName: string;
  channelId: string;
  channelTitle: string;
  messageBody: string;
}): Promise<void> {
  const recipients = Array.from(new Set(input.mentionedProfileIds)).filter((id) => id && id !== input.senderId);
  if (recipients.length === 0) return;
  const { createNotification } = await import("./notifications");
  const snippet = input.messageBody.length > 120 ? `${input.messageBody.slice(0, 117)}...` : input.messageBody;
  await Promise.all(
    recipients.map((recipientId) =>
      createNotification({
        recipientId,
        senderId: input.senderId,
        senderName: input.senderName,
        body: `💬 ${input.senderName} mentioned you in ${input.channelTitle}: "${snippet}"`,
        linkTo: `/m/admin/internal-message-support#channel=${input.channelId}`,
      }).catch((err) => console.error("Failed to send mention notification:", err))
    )
  );
}

/**
 * Subscribe to new messages on a channel or DM thread. Returns an unsubscribe
 * function. Caller renders the row immediately when invoked.
 */
export function subscribeToMessages(params: {
  channelId?: string | null;
  dmThreadId?: string | null;
  onMessage: (row: MessageRow) => void;
}): () => void {
  const filter = params.channelId
    ? `channel_id=eq.${params.channelId}`
    : params.dmThreadId
      ? `dm_thread_id=eq.${params.dmThreadId}`
      : null;
  if (!filter) return () => {};

  const channelName = `messages-${params.channelId ?? params.dmThreadId}-${uniqueChannelSuffix()}`;
  const sub = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter },
      (payload: any) => {
        const row = payload?.new as MessageRow | undefined;
        if (row) params.onMessage(row);
      }
    )
    .subscribe();
  return () => {
    try { supabase.removeChannel(sub); } catch { /* ignore */ }
  };
}


/**
 * Resolve (or auto-create) the company's #announcements channel. Used by the
 * announcements page and the header badge counter.
 */
export async function getAnnouncementsChannel(): Promise<ChannelRow> {
  const channels = await listChannels();
  const ann = channels.find((c) => c.slug === "announcements" || c.is_announcement);
  if (ann) return ann;
  // Defensive fallback — listChannels normally seeds it, but if a tenant
  // somehow lost the row we recreate just this one.
  const { data, error } = await supabase
    .from("message_channels")
    .insert(DEFAULT_CHANNELS[0])
    .select(CHANNEL_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as ChannelRow;
}

/**
 * Get all DM thread ids the user participates in. Used to count unread DMs
 * for the header badge.
 */
export async function listMyDmThreadIds(profileId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("dm_threads")
    .select("id")
    .or(`participant_a.eq.${profileId},participant_b.eq.${profileId}`);
  if (error) throw new Error(error.message);
  return (data || []).map((row: any) => row.id as string);
}

/**
 * Upsert the user's "last read" pointer for a channel OR dm thread. Skips
 * silently if the row already exists with a newer timestamp.
 */
export async function markThreadRead(params: {
  profileId: string;
  channelId?: string | null;
  dmThreadId?: string | null;
}): Promise<void> {
  if (!params.profileId) return;
  if (!params.channelId && !params.dmThreadId) return;
  const now = new Date().toISOString();
  const payload: Record<string, any> = {
    profile_id: params.profileId,
    channel_id: params.channelId ?? null,
    dm_thread_id: params.dmThreadId ?? null,
    last_read_at: now,
  };
  // onConflict columns mirror the unique indexes:
  //   (profile_id, channel_id)  and  (profile_id, dm_thread_id)
  const conflictTarget = params.channelId
    ? "profile_id,channel_id"
    : "profile_id,dm_thread_id";
  const { error } = await supabase
    .from("message_reads")
    .upsert(payload, { onConflict: conflictTarget });
  if (error) console.warn("markThreadRead:", error.message);
}

/**
 * Per-channel and per-DM unread counts for the current user, plus the grand
 * total. One query for the read pointers + one query for messages so we don't
 * pay an N+1 cost as the number of threads grows.
 *
 * Strategy: read all my message_reads rows (cheap, one per channel/dm),
 * then for each thread count messages newer than that timestamp.
 */
export async function getUnreadCounts(profileId: string): Promise<{
  perChannel: Record<string, number>;
  perDm: Record<string, number>;
  total: number;
}> {
  const empty = { perChannel: {}, perDm: {}, total: 0 };
  if (!profileId) return empty;

  // 1. Read pointers + channel list + my DM threads — in parallel.
  const [readsRes, channels, dmIds] = await Promise.all([
    supabase
      .from("message_reads")
      .select("channel_id, dm_thread_id, last_read_at")
      .eq("profile_id", profileId),
    listChannels(),
    listMyDmThreadIds(profileId),
  ]);

  if (readsRes.error) throw new Error(readsRes.error.message);
  const channelReadAt = new Map<string, string>();
  const dmReadAt = new Map<string, string>();
  for (const r of readsRes.data || []) {
    if (r.channel_id) channelReadAt.set(r.channel_id as string, r.last_read_at as string);
    if (r.dm_thread_id) dmReadAt.set(r.dm_thread_id as string, r.last_read_at as string);
  }

  // 2. Count queries for every thread — issue them all at once.
  const channelCountPromises = channels.map(async (ch) => {
    const since = channelReadAt.get(ch.id);
    let q = supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("channel_id", ch.id)
      .is("deleted_at", null)
      .neq("sender_id", profileId);
    if (since) q = q.gt("created_at", since);
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return [ch.id, count ?? 0] as const;
  });

  const dmCountPromises = dmIds.map(async (id) => {
    const since = dmReadAt.get(id);
    let q = supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("dm_thread_id", id)
      .is("deleted_at", null)
      .neq("sender_id", profileId);
    if (since) q = q.gt("created_at", since);
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return [id, count ?? 0] as const;
  });

  const [channelCounts, dmCounts] = await Promise.all([
    Promise.all(channelCountPromises),
    Promise.all(dmCountPromises),
  ]);

  const perChannel: Record<string, number> = Object.fromEntries(channelCounts);
  const perDm: Record<string, number> = Object.fromEntries(dmCounts);
  const total =
    Object.values(perChannel).reduce((a, b) => a + b, 0) +
    Object.values(perDm).reduce((a, b) => a + b, 0);
  return { perChannel, perDm, total };
}

export interface DmInboxEntry {
  threadId: string;
  otherProfileId: string;
  lastMessageBody: string;
  lastMessageAt: string;
  lastMessageSenderId: string | null;
  unreadCount: number;
}

/**
 * Messenger-style inbox: every DM thread the user is part of, with its
 * other participant, last message preview, and unread count - the shape a
 * real chat list needs (contact name + last message + timestamp + unread
 * badge), not just a bare list of thread ids.
 *
 * Three queries total regardless of how many threads exist (my threads,
 * my read pointers, every message across those threads) - reduced to
 * "latest + unread count per thread" client-side, same bulk-then-reduce
 * shape as getUnreadCounts, rather than one query per thread.
 */
export async function listMyDmInbox(profileId: string): Promise<DmInboxEntry[]> {
  if (!profileId) return [];

  const { data: threads, error: threadsErr } = await supabase
    .from("dm_threads")
    .select("id, participant_a, participant_b, created_at")
    .or(`participant_a.eq.${profileId},participant_b.eq.${profileId}`);
  if (threadsErr) throw new Error(threadsErr.message);
  const threadRows = threads || [];
  if (threadRows.length === 0) return [];
  const threadIds = threadRows.map((t: any) => t.id as string);

  const [readsRes, messagesRes] = await Promise.all([
    supabase
      .from("message_reads")
      .select("dm_thread_id, last_read_at")
      .eq("profile_id", profileId)
      .in("dm_thread_id", threadIds),
    supabase
      .from("messages")
      .select("dm_thread_id, sender_id, body, created_at")
      .in("dm_thread_id", threadIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  ]);
  if (readsRes.error) throw new Error(readsRes.error.message);
  if (messagesRes.error) throw new Error(messagesRes.error.message);

  const readAt = new Map<string, string>();
  for (const r of readsRes.data || []) {
    if (r.dm_thread_id) readAt.set(r.dm_thread_id as string, r.last_read_at as string);
  }

  // Messages arrive newest-first, so the first row seen per thread is its
  // latest message.
  const lastByThread = new Map<string, any>();
  const unreadByThread = new Map<string, number>();
  for (const m of messagesRes.data || []) {
    const tid = m.dm_thread_id as string | null;
    if (!tid) continue;
    if (!lastByThread.has(tid)) lastByThread.set(tid, m);
    const since = readAt.get(tid);
    const isUnread = m.sender_id !== profileId && (!since || (m.created_at as string) > since);
    if (isUnread) unreadByThread.set(tid, (unreadByThread.get(tid) ?? 0) + 1);
  }

  return threadRows.map((t: any) => {
    const otherProfileId = t.participant_a === profileId ? t.participant_b : t.participant_a;
    const last = lastByThread.get(t.id);
    return {
      threadId: t.id as string,
      otherProfileId: otherProfileId as string,
      lastMessageBody: last?.body ?? "",
      lastMessageAt: (last?.created_at ?? t.created_at) as string,
      lastMessageSenderId: (last?.sender_id ?? null) as string | null,
      unreadCount: unreadByThread.get(t.id) ?? 0,
    };
  });
}

export interface SystemNotification {
  id: string;
  dmThreadId: string;
  senderId: string | null;
  senderName: string | null;
  body: string;
  createdAt: string;
  isRead: boolean;
}

/**
 * The bell-icon notification feed: "system" kind DMs sent TO the caller
 * (attendance note alerts, etc.), newest first. Read state is derived from
 * the same per-thread `message_reads` pointer the Messages UI already
 * uses — marking a notification read marks its whole DM thread read, which
 * is the same "read" the Messages menu shows.
 *
 * Self-sent messages are excluded EXCEPT in a "self thread" (both
 * participants are the caller — e.g. an admin filing an Attendance note
 * about their own account). The recipient of a Notify-Individual/Notify-
 * Team-Lead alert is whoever the DM thread's OTHER participant is; when
 * that happens to be you too, you're still the intended recipient and
 * should see it. In a normal two-person thread, excluding your own sends
 * avoids every note you file about someone else also "notifying" you.
 */
export async function getMySystemNotifications(profileId: string, limit = 30): Promise<SystemNotification[]> {
  if (!profileId) return [];
  const { data: threads, error: threadsErr } = await supabase
    .from("dm_threads")
    .select("id, participant_a, participant_b")
    .or(`participant_a.eq.${profileId},participant_b.eq.${profileId}`);
  if (threadsErr) throw new Error(threadsErr.message);
  const dmIds = (threads ?? []).map((t: any) => t.id as string);
  if (dmIds.length === 0) return [];
  const selfThreadIds = new Set(
    (threads ?? []).filter((t: any) => t.participant_a === t.participant_b).map((t: any) => t.id as string)
  );

  const [msgsRes, readsRes] = await Promise.all([
    supabase
      .from("messages")
      .select("id, dm_thread_id, sender_id, sender_name, body, created_at")
      .in("dm_thread_id", dmIds)
      .eq("kind", "system")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(limit * 2), // headroom for the self-sent rows filtered out below
    supabase
      .from("message_reads")
      .select("dm_thread_id, last_read_at")
      .eq("profile_id", profileId)
      .not("dm_thread_id", "is", null),
  ]);
  if (msgsRes.error) throw new Error(msgsRes.error.message);
  if (readsRes.error) throw new Error(readsRes.error.message);

  const readAt = new Map<string, string>();
  for (const r of readsRes.data ?? []) {
    if (r.dm_thread_id) readAt.set(r.dm_thread_id as string, r.last_read_at as string);
  }

  return (msgsRes.data ?? [])
    .filter((m: any) => m.sender_id !== profileId || selfThreadIds.has(m.dm_thread_id))
    .slice(0, limit)
    .map((m: any) => {
      const since = readAt.get(m.dm_thread_id);
      return {
        id: m.id,
        dmThreadId: m.dm_thread_id,
        senderId: m.sender_id,
        senderName: m.sender_name,
        body: m.body,
        createdAt: m.created_at,
        isRead: Boolean(since && since >= m.created_at),
      };
    });
}

/**
 * Subscribe to ANY new message in this company (RLS filters automatically).
 * Caller decides how to react — e.g. bump the unread badge.
 */
export function subscribeToAllNewMessages(onMessage: (row: MessageRow) => void): () => void {
  const channelName = `messages-all-${uniqueChannelSuffix()}`;
  const sub = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      (payload: any) => {
        const row = payload?.new as MessageRow | undefined;
        if (row) onMessage(row);
      }
    )
    .subscribe();
  return () => {
    try { supabase.removeChannel(sub); } catch { /* ignore */ }
  };
}
