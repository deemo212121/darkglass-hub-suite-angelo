/**
 * NotificationsMenu — bell icon in AppHeader with a dropdown of recent
 * system notifications.
 *
 * Pulled from the upstream usapp repo. Reads from a localStorage queue
 * (`ahs:offline:notifications`) that any feature can push to via a
 * "ahs-notif-updated" CustomEvent so this menu refreshes without a
 * page reload. Comes seeded with a few demo entries so the panel is
 * never empty during walkthroughs.
 */
import { useState, useEffect } from "react";
import { Bell, CheckCheck, Package, Clock, ShieldAlert, Wrench } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface DemoNotif {
  id: string;
  kind: "system" | "part_status_change" | "cross_inventory_request" | "tech_eod_reminder" | "restock_auto" | "claim_part_tamper";
  title: string;
  body: string;
  ticketNo?: string;
  isRead: boolean;
  createdAt: string;
}

const KIND_ICON: Record<string, React.ElementType> = {
  system: Bell,
  part_status_change: Package,
  cross_inventory_request: Wrench,
  tech_eod_reminder: Clock,
  restock_auto: Package,
  claim_part_tamper: ShieldAlert,
};

const KIND_COLOR: Record<string, string> = {
  system: "text-blue-300 bg-blue-400/10 border-blue-400/20",
  part_status_change: "text-amber-300 bg-amber-400/10 border-amber-400/20",
  cross_inventory_request: "text-violet-300 bg-violet-400/10 border-violet-400/20",
  tech_eod_reminder: "text-cyan-300 bg-cyan-400/10 border-cyan-400/20",
  restock_auto: "text-green-300 bg-green-400/10 border-green-400/20",
  claim_part_tamper: "text-rose-300 bg-rose-400/10 border-rose-400/20",
};

const DEMO_NOTIFS: DemoNotif[] = [
  { id: "1", kind: "restock_auto", title: "Part back in stock", body: "Ticket #054822474136 — Drain Pump marked as Restock. Status updated to Back in Stock.", ticketNo: "054822474136", isRead: false, createdAt: new Date(Date.now() - 600000).toISOString() },
  { id: "2", kind: "cross_inventory_request", title: "Cross-branch inventory request", body: "demo@demo.com is attempting to use 'Control Board' from Nashville's inventory. Please locate and ship.", isRead: false, createdAt: new Date(Date.now() - 1800000).toISOString() },
  { id: "3", kind: "tech_eod_reminder", title: "End-of-day checklist reminder", body: "Please make sure all tickets, part statuses, and visit logs are updated before end of day.", isRead: true, createdAt: new Date(Date.now() - 7200000).toISOString() },
  { id: "4", kind: "system", title: "System notice", body: "This is a demo environment. No data is saved to any database.", isRead: true, createdAt: new Date(Date.now() - 86400000).toISOString() },
];

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
  const [liveNotifs, setLiveNotifs] = useState<DemoNotif[]>([]);
  const [demoNotifs, setDemoNotifs] = useState<DemoNotif[]>(DEMO_NOTIFS);
  const [open, setOpen] = useState(false);

  // Pull in offline-queue notifications (tamper alerts, EOD reminders, restock)
  // pushed from anywhere in the app, and refresh on the custom event.
  useEffect(() => {
    const load = () => {
      try {
        const raw = localStorage.getItem("ahs:offline:notifications");
        setLiveNotifs(raw ? JSON.parse(raw) : []);
      } catch { setLiveNotifs([]); }
    };
    load();
    window.addEventListener("ahs-notif-updated", load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener("ahs-notif-updated", load);
      window.removeEventListener("storage", load);
    };
  }, []);

  const notifs = [...liveNotifs, ...demoNotifs];
  const unread = notifs.filter(n => !n.isRead).length;

  const markRead = (id: string) => {
    setDemoNotifs(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    setLiveNotifs(prev => {
      const next = prev.map(n => n.id === id ? { ...n, isRead: true } : n);
      try { localStorage.setItem("ahs:offline:notifications", JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const markAll = (e: Event) => {
    e.preventDefault();
    setDemoNotifs(prev => prev.map(n => ({ ...n, isRead: true })));
    setLiveNotifs(prev => {
      const next = prev.map(n => ({ ...n, isRead: true }));
      try { localStorage.setItem("ahs:offline:notifications", JSON.stringify(next)); } catch {}
      return next;
    });
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
        {notifs.map(n => {
          const Icon = KIND_ICON[n.kind] ?? Bell;
          const color = KIND_COLOR[n.kind] ?? KIND_COLOR.system;
          return (
            <DropdownMenuItem key={n.id} onSelect={() => { markRead(n.id); setOpen(false); }} className="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-3">
              <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border ${color}`}><Icon className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className={`truncate text-sm font-semibold ${n.isRead ? "text-muted-foreground" : "text-foreground"}`}>{n.title}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(n.createdAt)}</span>
                </span>
                <span className={`mt-0.5 line-clamp-2 block text-xs leading-5 ${n.isRead ? "text-muted-foreground" : "text-foreground/70"}`}>{n.body}</span>
                {n.ticketNo && <span className="mt-1 inline-block rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-mono text-blue-600 dark:text-blue-300">#{n.ticketNo}</span>}
              </span>
              {!n.isRead && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-blue-400" />}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator className="bg-[var(--color-panel-border)]" />
        <div className="px-3 pb-1 pt-1.5 text-[11px] text-muted-foreground text-center">Demo mode — notifications are local only.</div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
