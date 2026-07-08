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
  created_at: string;
}

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

/** Seed-of-the-truth default channels every company should have. */
export const DEFAULT_CHANNELS: Array<Omit<ChannelRow, "id" | "created_at">> = [
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
    .select("id, slug, title, subtitle, kind, is_announcement, is_system, created_at")
    .eq("kind", "channel")
    .order("is_announcement", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const existing = (data as ChannelRow[]) ?? [];

  // Bootstrap default channels for empty tenants.
  if (existing.length === 0) {
    const inserts = DEFAULT_CHANNELS.map((c) => ({ ...c }));
    const { data: created, error: insErr } = await supabase
      .from("message_channels")
      .insert(inserts)
      .select("id, slug, title, subtitle, kind, is_announcement, is_system, created_at");
    if (insErr) throw new Error(insErr.message);
    return (created as ChannelRow[]) ?? [];
  }

  return existing;
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
    .select("id, slug, title, subtitle, kind, is_announcement, is_system, created_at")
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
