/**
 * NotificationsMenu — bell icon in AppHeader with a dropdown of recent
 * notifications, merged from three sources (see useMergedNotifications.ts's
 * header comment for the full breakdown of why there are three). The
 * dropdown shows a short recent list; "View all notifications" opens the
 * full Notification Center (NotificationCenterPage.tsx) — a real page on
 * desktop, an in-shell view on mobile (see onViewAll below).
 */
import { useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMergedNotifications, timeAgo, type MergedNotif } from "@/hooks/useMergedNotifications";

interface NotificationsMenuProps {
  /**
   * Called instead of the default router navigate() when a notification
   * carries a link — the mobile shell (MobileTechApp.tsx) passes this
   * since it's an isolated surface with its own in-memory view-switching
   * state, not real routes: every stored linkTo is a DESKTOP path (e.g.
   * "/m/dashboard/attendance-monitoring?tab=disputes-inquiries"), and
   * navigating there from mobile would jump out of the mobile shell into
   * an un-adapted desktop page. Desktop usage (no prop) keeps the
   * original router navigation unchanged.
   */
  onLinkClick?: (linkTo: string) => void;
  /**
   * Called instead of the default router navigate() to "/notifications"
   * when "View all notifications" is clicked — mobile passes
   * `() => setView("notifications")` for the same reason as onLinkClick
   * above (there's no real "/notifications" route reachable from inside
   * the mobile shell).
   */
  onViewAll?: () => void;
}

export function NotificationsMenu({ onLinkClick, onViewAll }: NotificationsMenuProps = {}) {
  const navigate = useNavigate();
  const { notifs, unread, markRead, markAll } = useMergedNotifications();
  const [open, setOpen] = useState(false);

  const handleSelect = (n: MergedNotif) => {
    markRead(n);
    setOpen(false);
    if (!n.linkTo) return;
    if (onLinkClick) onLinkClick(n.linkTo);
    else navigate({ to: n.linkTo });
  };

  const handleViewAll = () => {
    setOpen(false);
    if (onViewAll) onViewAll();
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="relative grid h-9 w-9 place-items-center rounded-full border border-[var(--color-panel-border)] bg-[var(--color-panel)] text-muted-foreground transition-colors hover:bg-[var(--color-secondary)] hover:text-foreground"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-blue-500 px-1 text-[10px] font-bold text-white shadow-lg">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="z-[110] w-[22rem] rounded-xl border border-[var(--color-panel-border)] bg-[var(--color-card)] p-1.5 backdrop-blur-xl shadow-2xl">
        <DropdownMenuLabel className="px-2 py-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-foreground">Notifications</div>
              <div className="text-[11px] text-muted-foreground">{unread} unread</div>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              {onViewAll ? (
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); handleViewAll(); }}
                  className="rounded-md border border-blue-400/30 bg-blue-400/10 px-2.5 py-1 text-[11px] font-medium text-blue-300 hover:bg-blue-400/20 hover:text-blue-200 transition-colors"
                >
                  View all
                </button>
              ) : (
                <Link
                  to="/notifications"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-blue-400/30 bg-blue-400/10 px-2.5 py-1 text-[11px] font-medium text-blue-300 hover:bg-blue-400/20 hover:text-blue-200 transition-colors"
                >
                  View all
                </Link>
              )}
              {unread > 0 && (
                <button onMouseDown={e => { e.preventDefault(); markAll(); }} className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300">
                  <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                </button>
              )}
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-[var(--color-panel-border)]" />
        {notifs.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">No notifications yet.</div>
        ) : notifs.slice(0, 20).map(n => (
          <DropdownMenuItem key={n.id} onSelect={() => handleSelect(n)} className="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-3">
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border text-blue-300 bg-blue-400/10 border-blue-400/20">
              <Bell className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className={`truncate text-sm font-semibold ${n.isRead ? "text-muted-foreground" : "text-foreground"}`}>{n.senderName || "System"}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(n.createdAt)}</span>
              </span>
              <span className={`mt-0.5 line-clamp-2 block text-xs leading-5 ${n.isRead ? "text-muted-foreground" : "text-foreground/70"}`}>{n.body}</span>
            </span>
            {!n.isRead && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-blue-400" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
