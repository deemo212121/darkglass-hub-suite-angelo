/**
 * Header dropdown for the Team Messenger. Surfaces threads with unread
 * messages plus the most recent activity. Clicking a thread jumps straight
 * to that conversation in the Team Messenger page.
 *
 * Realtime: subscribes to ALL messages in the company; on each new line it
 * refreshes the unread counts so the badge stays live without polling.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Hash, MessageCircle, MessageSquare } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth";
import {
  type ChannelRow,
  type MessageRow,
  getUnreadCounts,
  listChannels,
  subscribeToAllNewMessages,
} from "@/lib/supabase/messaging";
import { getCompanyUsers, getMyProfileId, type ProfileRow } from "@/lib/supabase/users";
import { supabase } from "@/lib/supabase/client";
import { playNotifySound } from "@/lib/notifySound";

interface ThreadPreview {
  id: string;
  kind: "channel" | "dm";
  title: string;
  subtitle: string;
  unread: number;
  lastMessage?: MessageRow;
  // For DMs we need the participant uuid to jump straight into the thread.
  otherProfileId?: string;
}

function formatTimestamp(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function initials(name: string) {
  return name
    .split(/[\s.@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function MessagesMenu() {
  const { email, ready, uid } = useAuth();
  const navigate = useNavigate();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [previews, setPreviews] = useState<ThreadPreview[]>([]);
  const [unreadTotal, setUnreadTotal] = useState(0);
  // Which DM threads are actually mine — kept current by refresh() below, and
  // checked by the realtime/poll handlers so a DM between two OTHER
  // coworkers doesn't ding everyone else in the company who happens to have
  // this menu mounted. Channels don't need this check: they're company-wide.
  const myDmThreadIdsRef = useRef<Set<string>>(new Set());

  const refresh = async (pid: string) => {
    try {
      // 1. Identity / lookups in parallel.
      const [channels, users, counts, dmRowsRes] = await Promise.all([
        listChannels(),
        getCompanyUsers(),
        getUnreadCounts(pid),
        supabase
          .from("dm_threads")
          .select("id, participant_a, participant_b")
          .or(`participant_a.eq.${pid},participant_b.eq.${pid}`),
      ]);

      const byProfile = new Map<string, ProfileRow>();
      for (const u of users) byProfile.set(u.id, u);

      // 2. "Latest message per thread" — one query instead of one per
      // channel/DM (was N+1: a user with 10 channels + 20 DMs fired 30
      // queries here on every refresh). Pull back the most recent
      // MAX_THREADS_FOR_PREVIEW messages across every relevant thread in one
      // shot, ordered newest-first, then take the first occurrence per
      // thread — since only the newest matters, that first occurrence IS
      // that thread's latest message, same result as the old per-thread
      // `.limit(1)` queries.
      const targetChannels = channels.filter((c) => !c.is_announcement);
      const dmRows = (dmRowsRes.data || []) as Array<{
        id: string;
        participant_a: string;
        participant_b: string;
      }>;
      const targetChannelIds = targetChannels.map((c) => c.id);
      const dmIds = dmRows.map((r) => r.id);
      myDmThreadIdsRef.current = new Set(dmIds);
      const latestByThread = new Map<string, MessageRow>();
      if (targetChannelIds.length > 0 || dmIds.length > 0) {
        const orParts = [
          targetChannelIds.length > 0 ? `channel_id.in.(${targetChannelIds.join(",")})` : null,
          dmIds.length > 0 ? `dm_thread_id.in.(${dmIds.join(",")})` : null,
        ].filter(Boolean) as string[];
        // Generous cap — comfortably covers "most recent message per thread"
        // for any realistic number of channels/DMs without being unbounded.
        const MAX_RECENT_ROWS = Math.max(200, (targetChannelIds.length + dmIds.length) * 5);
        const { data: recent } = await supabase
          .from("messages")
          .select("id, channel_id, dm_thread_id, sender_id, sender_name, body, kind, is_announcement, created_at, edited_at, deleted_at")
          .is("deleted_at", null)
          .or(orParts.join(","))
          .order("created_at", { ascending: false })
          .limit(MAX_RECENT_ROWS);
        for (const row of (recent || []) as MessageRow[]) {
          const key = row.channel_id ? `c:${row.channel_id}` : `d:${row.dm_thread_id}`;
          if (!latestByThread.has(key)) latestByThread.set(key, row);
        }
      }

      const channelPreviews: ThreadPreview[] = targetChannels.map((ch) => ({
        id: ch.id,
        kind: "channel" as const,
        title: ch.title,
        subtitle: ch.subtitle || "",
        unread: counts.perChannel[ch.id] ?? 0,
        lastMessage: latestByThread.get(`c:${ch.id}`),
      }));

      const dmPreviews: ThreadPreview[] = dmRows.map((row) => {
        const otherId = row.participant_a === pid ? row.participant_b : row.participant_a;
        const other = byProfile.get(otherId);
        return {
          id: row.id,
          kind: "dm" as const,
          title: other?.display_name || other?.email || "Direct message",
          subtitle: other ? `${other.role}${other.assigned_branch ? ` · ${other.assigned_branch}` : ""}` : "",
          unread: counts.perDm[row.id] ?? 0,
          lastMessage: latestByThread.get(`d:${row.id}`),
          otherProfileId: otherId,
        };
      });

      // Sort: unread threads first, then most recent activity.
      const all = [...channelPreviews, ...dmPreviews]
        .filter((p) => p.lastMessage || p.unread > 0 || p.kind === "channel")
        .sort((a, b) => {
          if (a.unread !== b.unread) return b.unread - a.unread;
          const at = a.lastMessage?.created_at ?? "";
          const bt = b.lastMessage?.created_at ?? "";
          return bt.localeCompare(at);
        })
        .slice(0, 8);

      setPreviews(all);

      // Unread total shown on the icon excludes the announcements channel,
      // because that count is already surfaced by the Megaphone bell next to
      // it. Otherwise an unread announcement would double-count.
      const announcementChannelIds = new Set(
        channels.filter((c) => c.is_announcement).map((c) => c.id)
      );
      const channelUnread = Object.entries(counts.perChannel)
        .filter(([id]) => !announcementChannelIds.has(id))
        .reduce((sum, [, n]) => sum + n, 0);
      const dmUnread = Object.values(counts.perDm).reduce((sum, n) => sum + n, 0);
      setUnreadTotal(channelUnread + dmUnread);
    } catch {
      // Keep stale data rather than clearing on transient errors.
    }
  };

  // Resolve identity once, then load.
  useEffect(() => {
    if (!ready || !uid) return;
    let cancelled = false;
    (async () => {
      const pid = await getMyProfileId(uid);
      if (cancelled || !pid) return;
      setProfileId(pid);
      await refresh(pid);
    })();
    return () => { cancelled = true; };
  }, [ready, uid]);

  // Subscribe to ALL new messages so the menu refreshes when anything moves.
  // Realtime is the fast path; polling every 8s is the fallback so the menu
  // still updates if Supabase realtime isn't enabled on the messages table.
  useEffect(() => {
    if (!profileId) return;
    let lastSeenAt = "";
    // Realtime fires refresh() (a ~dozen-query fan-out) on EVERY message in
    // the company, and a busy company/channel can fire several inserts back
    // to back — debouncing coalesces a burst into one refresh instead of one
    // per message. The poll and the custom event below funnel through the
    // same debounce so all three triggers can never stack into overlapping
    // refreshes either.
    let debounceTimer: number | undefined;
    const debouncedRefresh = () => {
      if (debounceTimer) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => { void refresh(profileId); }, 800);
    };
    // A DM row is only relevant if I'm actually a participant — channels
    // don't need this check since every channel is company-wide.
    const isRelevant = (row: { channel_id?: string | null; dm_thread_id?: string | null }) =>
      !row.dm_thread_id || myDmThreadIdsRef.current.has(row.dm_thread_id);
    const unsub = subscribeToAllNewMessages((row) => {
      if (!isRelevant(row)) return;
      debouncedRefresh();
      if (row?.sender_id && row.sender_id !== profileId) {
        playNotifySound();
      }
    });
    const poll = window.setInterval(async () => {
      // Cheap "did anything new arrive?" check — peek at the latest message in
      // the company (RLS scopes this to my company) and beep if its timestamp
      // is newer than what we've seen.
      try {
        const { data } = await supabase
          .from("messages")
          .select("id, sender_id, created_at, channel_id, dm_thread_id")
          .order("created_at", { ascending: false })
          .limit(1);
        const top = (data || [])[0] as any;
        if (top?.created_at && top.created_at !== lastSeenAt) {
          const isFirstScan = lastSeenAt === "";
          lastSeenAt = top.created_at;
          if (!isRelevant(top)) return;
          // Don't beep on the very first scan after mount — that's the seed.
          debouncedRefresh();
          if (!isFirstScan && top.sender_id !== profileId) playNotifySound();
        }
      } catch { /* ignore */ }
    }, 8000);
    const onChanged = () => { debouncedRefresh(); };
    window.addEventListener("ahs:unread-changed", onChanged);
    return () => {
      unsub();
      window.clearInterval(poll);
      if (debounceTimer) window.clearTimeout(debounceTimer);
      window.removeEventListener("ahs:unread-changed", onChanged);
    };
  }, [profileId]);

  const recent = useMemo(() => previews.slice(0, 6), [previews]);

  const goTo = (p: ThreadPreview) => {
    // The team messenger reads channel/dm ids from the URL hash so the
    // dropdown can hand-off without needing per-thread routes. TanStack
    // Router's `hash` option expects the value WITHOUT the leading "#".
    const hashValue = p.kind === "channel" ? `channel=${p.id}` : `dm=${p.otherProfileId || p.id}`;
    navigate({
      to: "/m/$module/$submodule",
      params: { module: "admin", submodule: "internal-message-support" },
      hash: hashValue,
    });
  };

  if (!ready || !email) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="relative grid h-9 w-9 place-items-center rounded-full border border-[var(--color-panel-border)] bg-[var(--color-panel)] text-muted-foreground transition-colors hover:bg-[var(--color-secondary)] hover:text-foreground"
          aria-label="Messages"
          title={unreadTotal > 0 ? `Messages (${unreadTotal} unread)` : "Messages"}
        >
          <MessageCircle className="h-4 w-4" />
          {unreadTotal > 0 && (
            <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white shadow-lg">
              {unreadTotal > 99 ? "99+" : unreadTotal}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="z-[110] w-[24rem] rounded-xl border border-[var(--color-panel-border)] bg-[var(--color-card)] p-1.5 backdrop-blur-xl shadow-2xl"
      >
        <DropdownMenuLabel className="px-2 py-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-white">Messages</div>
              <div className="text-[11px] text-muted-foreground">{unreadTotal} unread</div>
            </div>
            <MessageSquare className="h-4 w-4 text-blue-200" />
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-[var(--color-panel-border)]" />
        <DropdownMenuItem
          onSelect={() =>
            navigate({
              to: "/m/$module/$submodule",
              params: { module: "admin", submodule: "internal-message-support" },
            })
          }
          className="gap-2 rounded-lg px-3 py-2 cursor-pointer text-foreground"
        >
          <MessageCircle className="h-4 w-4 text-blue-200" /> Open Team Messenger
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-[var(--color-panel-border)]" />
        {recent.length === 0 ? (
          <div className="px-3 py-4 text-sm text-slate-400">No conversations yet.</div>
        ) : (
          recent.map((p) => (
            <DropdownMenuItem
              key={`${p.kind}-${p.id}`}
              onSelect={() => goTo(p)}
              className="group flex cursor-pointer items-start gap-3 rounded-lg px-3 py-3"
            >
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-blue-400/10 text-blue-200 text-[11px] font-bold">
                {p.kind === "channel" ? <Hash className="h-4 w-4" /> : initials(p.title)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-semibold text-white">{p.title}</span>
                  <span className="shrink-0 text-[11px] text-slate-400">{formatTimestamp(p.lastMessage?.created_at)}</span>
                </span>
                <span className="mt-1 flex items-center justify-between gap-3">
                  <span className={`line-clamp-1 block text-xs leading-5 ${p.unread > 0 ? "text-slate-100" : "text-slate-400"}`}>
                    {p.lastMessage
                      ? `${p.lastMessage.sender_name ? p.lastMessage.sender_name + ": " : ""}${p.lastMessage.body}`
                      : "No messages yet"}
                  </span>
                  {p.unread > 0 && (
                    <span className="shrink-0 rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-bold text-white">
                      {p.unread > 99 ? "99+" : p.unread}
                    </span>
                  )}
                </span>
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
