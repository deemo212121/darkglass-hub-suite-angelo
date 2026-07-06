/**
 * Header dropdown for the Team Messenger. Surfaces threads with unread
 * messages plus the most recent activity. Clicking a thread jumps straight
 * to that conversation in the Team Messenger page.
 *
 * Realtime: subscribes to ALL messages in the company; on each new line it
 * refreshes the unread counts so the badge stays live without polling.
 */

import { useEffect, useMemo, useState } from "react";
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

      // 2. Issue the "latest message per thread" queries all in parallel
      // (was previously sequential — that's where the multi-second delay was
      // coming from).
      const targetChannels = channels.filter((c) => !c.is_announcement);
      const channelLatestPromises = targetChannels.map((ch) =>
        supabase
          .from("messages")
          .select(
            "id, channel_id, dm_thread_id, sender_id, sender_name, body, kind, is_announcement, created_at, edited_at, deleted_at"
          )
          .eq("channel_id", ch.id)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(1)
      );

      const dmRows = (dmRowsRes.data || []) as Array<{
        id: string;
        participant_a: string;
        participant_b: string;
      }>;
      const dmLatestPromises = dmRows.map((row) =>
        supabase
          .from("messages")
          .select(
            "id, channel_id, dm_thread_id, sender_id, sender_name, body, kind, is_announcement, created_at, edited_at, deleted_at"
          )
          .eq("dm_thread_id", row.id)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(1)
      );

      const [channelLatest, dmLatest] = await Promise.all([
        Promise.all(channelLatestPromises),
        Promise.all(dmLatestPromises),
      ]);

      const channelPreviews: ThreadPreview[] = targetChannels.map((ch, i) => {
        const last = (channelLatest[i].data || [])[0] as MessageRow | undefined;
        return {
          id: ch.id,
          kind: "channel" as const,
          title: ch.title,
          subtitle: ch.subtitle || "",
          unread: counts.perChannel[ch.id] ?? 0,
          lastMessage: last,
        };
      });

      const dmPreviews: ThreadPreview[] = dmRows.map((row, i) => {
        const otherId = row.participant_a === pid ? row.participant_b : row.participant_a;
        const other = byProfile.get(otherId);
        const last = (dmLatest[i].data || [])[0] as MessageRow | undefined;
        return {
          id: row.id,
          kind: "dm" as const,
          title: other?.display_name || other?.email || "Direct message",
          subtitle: other ? `${other.role}${other.assigned_branch ? ` · ${other.assigned_branch}` : ""}` : "",
          unread: counts.perDm[row.id] ?? 0,
          lastMessage: last,
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
    const unsub = subscribeToAllNewMessages((row) => {
      refresh(profileId);
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
          .select("id, sender_id, created_at")
          .order("created_at", { ascending: false })
          .limit(1);
        const top = (data || [])[0] as any;
        if (top?.created_at && top.created_at !== lastSeenAt) {
          const isFirstScan = lastSeenAt === "";
          lastSeenAt = top.created_at;
          // Don't beep on the very first scan after mount — that's the seed.
          if (!isFirstScan) {
            await refresh(profileId);
            if (top.sender_id !== profileId) playNotifySound();
          } else {
            await refresh(profileId);
          }
        }
      } catch { /* ignore */ }
    }, 4000);
    const onChanged = () => { refresh(profileId); };
    window.addEventListener("ahs:unread-changed", onChanged);
    return () => {
      unsub();
      window.clearInterval(poll);
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
