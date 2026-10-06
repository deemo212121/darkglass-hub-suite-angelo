/**
 * NotificationsMenu — bell icon in AppHeader with a dropdown of recent
 * notifications, merged from three sources (see useMergedNotifications.ts's
 * header comment for the full breakdown of why there are three). The
 * dropdown shows a short recent list; "View all notifications" opens the
 * full Notification Center (NotificationCenterPage.tsx) — a real page on
 * desktop, an in-shell view on mobile (see onViewAll below).
 */
import { useState } from "react";
import { ArrowRight, Bell, CheckCheck } from "lucide-react";
import { GroupLabel, KindIcon, MenuEmpty, MenuHeader, fullTime, groupByDay, previewText, shortTime } from "@/components/header/menuKit";
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
      <DropdownMenuContent align="end" sideOffset={10} className="hm-panel z-[110]">
        <MenuHeader
          icon={<Bell />}
          title="Notifications"
          unread={unread}
          actions={
            unread > 0 ? (
              <button type="button" className="hm-action" onMouseDown={(e) => { e.preventDefault(); markAll(); }}>
                <CheckCheck /> Mark all read
              </button>
            ) : undefined
          }
        />
        <div className="hm-scroll">
          {notifs.length === 0 ? (
            <MenuEmpty icon={<Bell />} text="No notifications yet." />
          ) : (
            groupByDay(notifs.slice(0, 20), (n) => n.createdAt).map((g) => (
              <div key={g.label}>
                <GroupLabel>{g.label}</GroupLabel>
                {g.items.map((n) => (
                  <DropdownMenuItem key={n.id} onSelect={() => handleSelect(n)} className={`hm-row ${n.isRead ? "hm-row--read" : "hm-row--unread"}`}>
                    <KindIcon body={n.body} />
                    <span className="hm-row-body">
                      <span className="hm-row-top">
                        <span className="hm-row-name">{n.senderName || "System"}</span>
                        <span className="hm-row-time" title={fullTime(n.createdAt)}>{shortTime(n.createdAt)}</span>
                      </span>
                      <span className="hm-row-text">{previewText(n.body)}</span>
                    </span>
                    {!n.isRead && <span className="hm-dot" aria-label="Unread" />}
                  </DropdownMenuItem>
                ))}
              </div>
            ))
          )}
        </div>
        {onViewAll ? (
          <DropdownMenuItem onSelect={handleViewAll} className="hm-footer">
            View all notifications <ArrowRight />
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem asChild className="hm-footer">
            <Link to="/notifications" onClick={() => setOpen(false)}>
              View all notifications <ArrowRight />
            </Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
