/**
 * NotificationsMenu — bell icon in AppHeader with a dropdown of recent
 * notifications, merged from three sources:
 *
 *  1. "system" kind DMs sent to the caller (e.g. Attendance Monitoring's
 *     "Notify Individual" / "Notify Team Lead" alerts — see
 *     AttendanceMonitoringPage.tsx). Read state is the same per-thread
 *     message_reads pointer the Messages menu uses, so reading one here
 *     also clears its unread count there.
 *  2. The dedicated `notifications` table (see migration 0035) — used by
 *     alerts that should NEVER show up in the internal messenger (e.g.
 *     "new employee request submitted" pinging HR/Finance/Admin). These
 *     can carry a `linkTo` so clicking one navigates straight to the
 *     relevant page.
 *  3. HR only: a realtime Firestore subscription (notifications/{uid}/items
 *     via subscribeNotifications) — this is the existing
 *     sendNotificationToRole()/users_index Firestore architecture (also used
 *     by e.g. PartInventory's cross-inventory alerts), and is how the
 *     Jotform webhook (api/jotform.ts) delivers "New Form Submitted" pings
 *     since a Cloudflare Worker can't run the Supabase-scoped, session-based
 *     write path the other two sources use. Chimes on genuinely new arrivals
 *     (not on the first snapshot after subscribing).
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import {
  getMySystemNotifications,
  markThreadRead,
  subscribeToAllNewMessages,
  type SystemNotification,
} from "@/lib/supabase/messaging";
import {
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  subscribeToMyNotifications,
  type NotificationRow,
} from "@/lib/supabase/notifications";
import {
  subscribeNotifications,
  markNotificationRead as markFirestoreNotificationRead,
  markAllNotificationsRead as markAllFirestoreNotificationsRead,
  type AppNotification,
} from "@/lib/firebase/notifications";
import { playNotifySound } from "@/lib/notifySound";

interface MergedNotif {
  id: string;
  source: "dm" | "table" | "firestore";
  dmThreadId?: string;
  senderName: string | null;
  body: string;
  createdAt: string;
  isRead: boolean;
  linkTo: string | null;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function NotificationsMenu() {
  const { uid, ready, role } = useAuth();
  const navigate = useNavigate();
  const isHr = ready && (role ?? "").toUpperCase() === "HR";
  const [profileId, setProfileId] = useState<string | null>(null);
  const [dmNotifs, setDmNotifs] = useState<SystemNotification[]>([]);
  const [tableNotifs, setTableNotifs] = useState<NotificationRow[]>([]);
  const [firestoreNotifs, setFirestoreNotifs] = useState<AppNotification[]>([]);
  const seenFirestoreIds = useRef<Set<string> | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async (pid: string) => {
    try {
      const [dmRows, tableRows] = await Promise.all([
        getMySystemNotifications(pid),
        getMyNotifications(pid),
      ]);
      setDmNotifs(dmRows);
      setTableNotifs(tableRows);
    } catch (err) {
      console.error("Failed to load notifications:", err);
    }
  }, []);

  useEffect(() => {
    if (!ready || !uid) return;
    let cancelled = false;
    getMyProfileId(uid).then((pid) => {
      if (cancelled || !pid) return;
      setProfileId(pid);
      load(pid);
    });
    return () => { cancelled = true; };
  }, [ready, uid, load]);

  // Live-append any new system DM addressed to me.
  useEffect(() => {
    if (!profileId) return;
    const unsubscribe = subscribeToAllNewMessages((row) => {
      if (row.kind !== "system" || row.sender_id === profileId || !row.dm_thread_id) return;
      load(profileId);
    });
    return unsubscribe;
  }, [profileId, load]);

  // Live-append any new table-based notification addressed to me.
  useEffect(() => {
    if (!profileId) return;
    const unsubscribe = subscribeToMyNotifications(profileId, () => load(profileId));
    return unsubscribe;
  }, [profileId, load]);

  // HR only: realtime Firestore subscription (see file header). Re-subscribes
  // only when isHr or uid actually changes; the cleanup below always
  // unsubscribes the previous listener first, so there's never more than one
  // live listener for a given mount.
  useEffect(() => {
    if (!isHr || !uid) {
      setFirestoreNotifs([]);
      return;
    }
    seenFirestoreIds.current = null;
    const unsubscribe = subscribeNotifications(uid, (items) => {
      setFirestoreNotifs(items);
      if (seenFirestoreIds.current === null) {
        // First snapshot after (re)subscribing — establish the baseline
        // without chiming for notifications that already existed.
        seenFirestoreIds.current = new Set(items.map((i) => i.id));
      } else {
        const hasNewArrival = items.some((i) => !seenFirestoreIds.current!.has(i.id));
        seenFirestoreIds.current = new Set(items.map((i) => i.id));
        if (hasNewArrival) playNotifySound();
      }
    });
    return unsubscribe;
  }, [isHr, uid]);

  const notifs: MergedNotif[] = useMemo(() => {
    const merged: MergedNotif[] = [
      ...dmNotifs.map((n): MergedNotif => ({
        id: `dm-${n.id}`,
        source: "dm",
        dmThreadId: n.dmThreadId,
        senderName: n.senderName,
        body: n.body,
        createdAt: n.createdAt,
        isRead: n.isRead,
        linkTo: null,
      })),
      ...tableNotifs.map((n): MergedNotif => ({
        id: `tbl-${n.id}`,
        source: "table",
        senderName: n.senderName,
        body: n.body,
        createdAt: n.createdAt,
        isRead: n.isRead,
        linkTo: n.linkTo,
      })),
      ...firestoreNotifs.map((n): MergedNotif => ({
        id: `fs-${n.id}`,
        source: "firestore",
        senderName: n.title,
        body: n.body,
        createdAt: n.createdAt,
        isRead: n.isRead,
        linkTo: n.link ?? null,
      })),
    ];
    return merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [dmNotifs, tableNotifs, firestoreNotifs]);

  const unread = notifs.filter((n) => !n.isRead).length;

  const markRead = async (n: MergedNotif) => {
    if (n.isRead) return;
    if (n.source === "firestore") {
      if (!uid) return;
      const rawId = n.id.replace(/^fs-/, "");
      setFirestoreNotifs((prev) => prev.map((x) => (x.id === rawId ? { ...x, isRead: true } : x)));
      try {
        await markFirestoreNotificationRead(uid, rawId);
      } catch (err) {
        console.error("Failed to mark notification read:", err);
      }
      return;
    }
    if (!profileId) return;
    if (n.source === "dm") {
      setDmNotifs((prev) => prev.map((x) => (x.dmThreadId === n.dmThreadId ? { ...x, isRead: true } : x)));
      try {
        await markThreadRead({ profileId, dmThreadId: n.dmThreadId! });
      } catch (err) {
        console.error("Failed to mark notification read:", err);
      }
    } else {
      const rawId = n.id.replace(/^tbl-/, "");
      setTableNotifs((prev) => prev.map((x) => (x.id === rawId ? { ...x, isRead: true } : x)));
      try {
        await markNotificationRead(rawId);
      } catch (err) {
        console.error("Failed to mark notification read:", err);
      }
    }
  };

  const markAll = async (e: Event) => {
    e.preventDefault();
    setFirestoreNotifs((prev) => prev.map((x) => ({ ...x, isRead: true })));
    const firestoreMark = uid && firestoreNotifs.length > 0 ? markAllFirestoreNotificationsRead(uid) : Promise.resolve();
    if (!profileId) {
      try {
        await firestoreMark;
      } catch (err) {
        console.error("Failed to mark all notifications read:", err);
      }
      return;
    }
    const threadIds = Array.from(new Set(dmNotifs.map((n) => n.dmThreadId)));
    setDmNotifs((prev) => prev.map((x) => ({ ...x, isRead: true })));
    setTableNotifs((prev) => prev.map((x) => ({ ...x, isRead: true })));
    try {
      await Promise.all([
        ...threadIds.map((dmThreadId) => markThreadRead({ profileId, dmThreadId })),
        markAllNotificationsRead(profileId),
        firestoreMark,
      ]);
    } catch (err) {
      console.error("Failed to mark all notifications read:", err);
    }
  };

  const handleSelect = (n: MergedNotif) => {
    markRead(n);
    setOpen(false);
    if (n.linkTo) navigate({ to: n.linkTo });
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
            {unread > 0 && (
              <button onMouseDown={e => markAll(e.nativeEvent)} className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300">
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-[var(--color-panel-border)]" />
        {notifs.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">No notifications yet.</div>
        ) : notifs.map(n => (
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
        <DropdownMenuSeparator className="bg-[var(--color-panel-border)]" />
        <Link
          to="/m/$module/$submodule"
          params={{ module: "admin", submodule: "internal-message-support" }}
          onClick={() => setOpen(false)}
          className="block px-3 py-2 text-center text-[11px] text-blue-400 hover:text-blue-300"
        >
          View all messages
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
