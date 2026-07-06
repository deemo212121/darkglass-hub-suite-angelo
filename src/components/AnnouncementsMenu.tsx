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
  subscribeToMessages,
  markThreadRead,
} from "@/lib/supabase/messaging";
import { getMyProfileId } from "@/lib/supabase/users";

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
  const [lastReadAt, setLastReadAt] = useState<string | null>(null);

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
        const rows = await getChannelMessages(ch.id, 25);
        if (cancelled) return;
        setMessages(rows);
        // Cheap unread baseline: use whatever's in localStorage; the user's
        // accurate read pointer lives in Supabase via the Announcements page.
        const cached = localStorage.getItem(`ahs:ann-last-seen:${pid}`);
        setLastReadAt(cached);
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
      },
    });
    return unsub;
  }, [channel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for the announcements page broadcasting that the user marked-all-read.
  useEffect(() => {
    const onChanged = () => setLastReadAt(new Date().toISOString());
    window.addEventListener("ahs:unread-changed", onChanged);
    return () => window.removeEventListener("ahs:unread-changed", onChanged);
  }, []);

  const unreadCount = useMemo(() => {
    if (!profileId) return 0;
    return messages.filter((m) => {
      if (m.kind !== "user") return false;
      if (m.sender_id === profileId) return false;
      if (!lastReadAt) return true;
      return m.created_at > lastReadAt;
    }).length;
  }, [messages, profileId, lastReadAt]);

  const recentAnnouncements = useMemo(() => {
    return messages
      .filter((m) => m.kind === "user")
      .slice()
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 5);
  }, [messages]);

  const canPost = HIGHER_UP_ROLES.has(String(role || "").toUpperCase());

  const markOneRead = async (createdAt: string) => {
    if (!profileId || !channel) return;
    const next = createdAt > (lastReadAt ?? "") ? createdAt : (lastReadAt ?? createdAt);
    setLastReadAt(next);
    localStorage.setItem(`ahs:ann-last-seen:${profileId}`, next);
    await markThreadRead({ profileId, channelId: channel.id });
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
                await markOneRead(m.created_at);
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
