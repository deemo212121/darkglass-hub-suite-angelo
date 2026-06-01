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
  canPostAnnouncements,
  formatAnnouncementTimestamp,
  getAnnouncementMessages,
  getUnreadAnnouncementCount,
  markAnnouncementRead,
  type AnnouncementMessage,
} from "@/lib/announcements";

export function AnnouncementsMenu() {
  const { email, ready } = useAuth();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<AnnouncementMessage[]>([]);

  useEffect(() => {
    if (!ready || !email) return;
    setMessages(getAnnouncementMessages(email));
  }, [email, ready]);

  const unreadCount = useMemo(() => getUnreadAnnouncementCount(email, messages), [email, messages]);
  const recentAnnouncements = useMemo(() => {
    return messages
      .filter((message) => message.kind !== "system")
      .slice()
      .reverse()
      .slice(0, 5);
  }, [messages]);

  if (!ready || !email) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="relative grid h-9 w-9 place-items-center rounded-full border border-[var(--color-panel-border)] bg-[oklch(0.98_0.005_250/0.05)] text-muted-foreground transition-colors hover:bg-[oklch(0.98_0.005_250/0.1)] hover:text-foreground"
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
        className="z-[110] w-[22rem] rounded-xl border border-[var(--color-panel-border)] bg-[oklch(0.20_0.04_260/0.98)] p-1.5 backdrop-blur-xl shadow-2xl"
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
          recentAnnouncements.map((message) => {
            const isUnread = !message.kind.includes("system");
            return (
              <DropdownMenuItem
                key={message.id}
                onSelect={() => {
                  markAnnouncementRead(email, message.id);
                  navigate({ to: "/announcements" });
                }}
                className="group flex cursor-pointer items-start gap-3 rounded-lg px-3 py-3"
              >
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 bg-amber-400/10 text-amber-200">
                  <CircleAlert className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-semibold text-white">{message.sender}</span>
                    <span className="shrink-0 text-[11px] text-slate-400">{formatAnnouncementTimestamp(message.createdAt)}</span>
                  </span>
                  <span className={`mt-1 line-clamp-2 block text-xs leading-5 ${isUnread ? "text-slate-200" : "text-slate-400"}`}>
                    {message.body}
                  </span>
                </span>
              </DropdownMenuItem>
            );
          })
        )}
        <DropdownMenuSeparator className="bg-[var(--color-panel-border)]" />
        <DropdownMenuItem
          onSelect={() => navigate({ to: "/announcements" })}
          className="gap-2 rounded-lg px-3 py-2 cursor-pointer text-foreground"
        >
          <Megaphone className="h-4 w-4 text-amber-200" /> Open announcements center
        </DropdownMenuItem>
        {canPostAnnouncements(email) ? (
          <div className="px-3 pb-1 pt-2 text-[11px] text-slate-400">You can post announcements from the announcements center.</div>
        ) : (
          <div className="px-3 pb-1 pt-2 text-[11px] text-slate-400">Read-only access for your role.</div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
