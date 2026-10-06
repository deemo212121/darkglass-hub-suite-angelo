/**
 * Header dropdown for the #announcements channel. Pulls the last few company
 * announcements straight from Supabase and shows an unread badge. Backed by
 * the same messaging tables as the announcements page so counts stay in sync.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, CheckCheck, Megaphone } from "lucide-react";
import { Avatar, GroupLabel, MenuEmpty, MenuHeader, fullTime, groupByDay, previewText, shortTime } from "@/components/header/menuKit";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth";
import { canManageChannelsRole } from "@/lib/roleLabels";
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
import { getAnnouncementTitles } from "@/lib/supabase/announcementMarquee";

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

interface AnnouncementsMenuProps {
  /**
   * Called instead of the default router navigate() to "/announcements" —
   * the mobile shell (MobileTechApp.tsx) passes `() => setView("announcements")`
   * since it's an isolated surface with its own in-memory view-switching
   * state, not real routes (same adaptation NotificationsMenu.tsx's
   * onViewAll already uses). Desktop usage (no prop) keeps the original
   * router navigation unchanged.
   */
  onViewAll?: () => void;
}

export function AnnouncementsMenu({ onViewAll }: AnnouncementsMenuProps = {}) {
  const { email, ready, uid, role, extraRoles } = useAuth();
  const navigate = useNavigate();
  const goToAnnouncements = () => (onViewAll ? onViewAll() : navigate({ to: "/announcements" }));
  const [profileId, setProfileId] = useState<string | null>(null);
  const [channel, setChannel] = useState<ChannelRow | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [titles, setTitles] = useState<Map<string, string>>(new Map());
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
          getAnnouncementsChannel(canManageChannelsRole(role, extraRoles)),
        ]);
        if (cancelled) return;
        setProfileId(pid);
        setChannel(ch);
        const [rows, t] = await Promise.all([getChannelMessages(ch.id, 50), getAnnouncementTitles()]);
        if (cancelled) return;
        setMessages(rows);
        setTitles(t.titles);
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
      <DropdownMenuContent align="end" sideOffset={10} className="hm-panel z-[110]" style={{ ["--hm-accent" as string]: "#f59e0b" }}>
        <MenuHeader
          icon={<Megaphone />}
          title="Announcements"
          unread={unreadCount}
          actions={
            unreadCount > 0 ? (
              <button type="button" className="hm-action" onMouseDown={(e) => { e.preventDefault(); void markOneRead(); }}>
                <CheckCheck /> Mark all read
              </button>
            ) : undefined
          }
        />
        <div className="hm-scroll">
          {recentAnnouncements.length === 0 ? (
            <MenuEmpty icon={<Megaphone />} text="No announcements yet." />
          ) : (
            groupByDay(recentAnnouncements, (m) => m.created_at).map((g) => (
              <div key={g.label}>
                <GroupLabel>{g.label}</GroupLabel>
                {g.items.map((m) => {
                  // There's one read pointer for the whole channel, so the newest `unreadCount` posts are the unread ones.
                  const unread = recentAnnouncements.indexOf(m) < unreadCount;
                  const title = titles.get(m.id);
                  return (
                    <DropdownMenuItem
                      key={m.id}
                      onSelect={async () => {
                        await markOneRead();
                        goToAnnouncements();
                      }}
                      className={`hm-row ${unread ? "hm-row--unread" : "hm-row--read"}`}
                    >
                      <Avatar name={m.sender_name} />
                      <span className="hm-row-body">
                        <span className="hm-row-top">
                          <span className="hm-row-name">{m.sender_name || "Unknown"}</span>
                          <span className="hm-row-time" title={fullTime(m.created_at)}>{shortTime(m.created_at)}</span>
                        </span>
                        {title && <span className="hm-row-title block">{title}</span>}
                        <span className="hm-row-text">{previewText(m.body)}</span>
                      </span>
                      {unread && <span className="hm-dot" aria-label="Unread" />}
                    </DropdownMenuItem>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <DropdownMenuItem onSelect={goToAnnouncements} className="hm-footer">
          Open announcements <ArrowRight />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
