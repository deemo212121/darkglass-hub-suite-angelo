/**
 * Header dropdown for the #announcements channel. Pulls the last few company
 * announcements straight from Supabase and shows an unread badge. Backed by
 * the same messaging tables as the announcements page so counts stay in sync.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Megaphone, CircleAlert } from "lucide-react";
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
  getAnnouncementsChannel,
  getChannelMessages,
  getUnreadCounts,
  subscribeToMessages,
  markThreadRead,
} from "@/lib/supabase/messaging";
import { getMyProfileId } from "@/lib/supabase/users";

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
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function AnnouncementsMenu() {
  const { email, ready, uid, role } = useAuth();
  const navigate = useNavigate();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [channel, setChannel] = useState<ChannelRow | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // Real, server-side unread count (same message_reads-backed query
  // MessagesMenu.tsx already uses correctly) — NOT a localStorage guess.
  // The previous version cached a "last seen" timestamp in localStorage,
  // which the Announcements page's "Mark all read" never wrote to, so the
  // badge silently reverted to a stale count on the next page load/remount
  // even though Supabase's real last_read_at pointer had been updated.
  const refreshUnread = async (pid: string, channelId: string) => {
    try {
      const counts = await getUnreadCounts(pid);
      setUnreadCount(counts.perChannel[channelId] ?? 0);
    } catch {
      // Silently ignore — the badge just keeps its last known value.
    }
  };

  useEffect(() => {
    if (!ready || !uid) return;
    let cancelled = false;
    (async () => {
      try {
        const [pid, ch] = await Promise.all([
          getMyProfileId(uid),
          getAnnouncementsChannel(),
        ]);
        if (cancelled) return;
        setProfileId(pid);
        setChannel(ch);
        const rows = await getChannelMessages(ch.id, 50);
        if (cancelled) return;
        setMessages(rows);
        if (pid) await refreshUnread(pid, ch.id);
      } catch {
        // Silently ignore — the badge just shows 0 if Supabase isn't reachable.
      }
    })();
    return () => { cancelled = true; };
  }, [ready, uid]);

  useEffect(() => {
    if (!channel) return;
    const unsub = subscribeToMessages({
      channelId: channel.id,
      onMessage: (row) => {
        setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
        if (profileId) refreshUnread(profileId, channel.id);
      },
    });
    return unsub;
  }, [channel?.id, profileId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for the announcements page (or another tab/instance of this menu)
  // broadcasting that the user marked-all-read — re-pull the real count
  // rather than guessing "now" locally.
  useEffect(() => {
    const onChanged = () => { if (profileId && channel) refreshUnread(profileId, channel.id); };
    window.addEventListener("ahs:unread-changed", onChanged);
    return () => window.removeEventListener("ahs:unread-changed", onChanged);
  }, [profileId, channel?.id]);

  const recentAnnouncements = useMemo(() => {
    return messages
      .filter((m) => m.kind === "user")
      .slice()
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      // DropdownMenuContent already has max-h-[available-height] +
      // overflow-y-auto (same shared component MessagesMenu.tsx uses), so a
      // longer list here just scrolls within the dropdown instead of pushing
      // it off-screen - was previously capped at 5 for no functional reason,
      // which meant there was never enough content to actually need to
      // scroll.
      .slice(0, 20);
  }, [messages]);

  const canPost = HIGHER_UP_ROLES.has(String(role || "").toUpperCase());

  // markThreadRead always marks the whole channel read up to now (there's no
  // per-message read pointer), so opening any one announcement clears the
  // badge entirely - matches "Mark all read" on the full page.
  const markOneRead = async () => {
    if (!profileId || !channel) return;
    await markThreadRead({ profileId, channelId: channel.id });
    await refreshUnread(profileId, channel.id);
    window.dispatchEvent(new CustomEvent("ahs:unread-changed"));
  };

  if (!ready || !email) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="relative grid h-9 w-9 place-items-center rounded-full border border-[var(--color-panel-border)] bg-[var(--color-panel)] text-muted-foreground transition-colors hover:bg-[var(--color-secondary)] hover:text-foreground"
          aria-label="Announcements"
          title="Announcements"
        >
          <Megaphone className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white shadow-lg">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="z-[110] w-[22rem] rounded-xl border border-[var(--color-panel-border)] bg-[var(--color-card)] p-1.5 backdrop-blur-xl shadow-2xl"
      >
        <DropdownMenuLabel className="px-2 py-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-white">Announcements</div>
              <div className="text-[11px] text-muted-foreground">{unreadCount} unread</div>
            </div>
            <Megaphone className="h-4 w-4 text-amber-200" />
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-[var(--color-panel-border)]" />
        {recentAnnouncements.length === 0 ? (
          <div className="px-3 py-4 text-sm text-slate-400">No announcements available.</div>
        ) : (
          recentAnnouncements.map((m) => (
            <DropdownMenuItem
              key={m.id}
              onSelect={async () => {
                await markOneRead();
                navigate({ to: "/announcements" });
              }}
              className="group flex cursor-pointer items-start gap-3 rounded-lg px-3 py-3"
            >
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 bg-amber-400/10 text-amber-200">
                <CircleAlert className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-semibold text-white">{m.sender_name || "Unknown"}</span>
                  <span className="shrink-0 text-[11px] text-slate-400">{formatTimestamp(m.created_at)}</span>
                </span>
                <span className="mt-1 line-clamp-2 block text-xs leading-5 text-slate-200">
                  {m.body}
                </span>
              </span>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator className="bg-[var(--color-panel-border)]" />
        <DropdownMenuItem
          onSelect={() => navigate({ to: "/announcements" })}
          className="gap-2 rounded-lg px-3 py-2 cursor-pointer text-foreground"
        >
          <Megaphone className="h-4 w-4 text-amber-200" /> Open announcements center
        </DropdownMenuItem>
        {canPost ? (
          <div className="px-3 pb-1 pt-2 text-[11px] text-slate-400">You can post announcements from the announcements center.</div>
        ) : (
          <div className="px-3 pb-1 pt-2 text-[11px] text-slate-400">Read-only access for your role.</div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
