/**
 * Notification Center — the full "view all notifications" experience
 * opened from NotificationsMenu.tsx's bell dropdown, on both desktop (as
 * its own route, see routes/notifications.tsx) and mobile (as an in-shell
 * view inside MobileTechApp.tsx, which has no real router for its screens
 * — see that file's handleNotificationLink comment). Same two merged
 * sources as the dropdown (useMergedNotifications.ts — messages are
 * deliberately excluded, see that file's header comment), grouped two
 * levels deep: department (categoryFor()) as a LEFT SIDEBAR — a stacked
 * list of every department, all expanded, made the page grow past the
 * viewport no matter how few notifications any one department had, so a
 * fixed-height sidebar with its own scroll keeps the page a fixed height
 * instead — then, within the selected department (including "All"), a
 * Gmail-style Starred/Unread/Read filter row narrows further, and the
 * remaining items are sub-grouped again by subject (subjectFor()), shown
 * as its own filter chip row: a department like HR still mixes Jotform
 * submissions, signed-form notices, and timecard-correction pings, so
 * those get their own labeled sub-sections (and can be filtered down to
 * just one) instead of one undifferentiated feed. "All" additionally tags
 * each item with its own category inline, since subjects alone don't say
 * which department an item came from once everything's mixed together.
 */
import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Bell, CheckCheck, ChevronLeft, Mail, Star, Trash2 } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { useMergedNotifications, timeAgo, type MergedNotif } from "@/hooks/useMergedNotifications";

interface NotificationCenterPanelProps {
  /** Same purpose as NotificationsMenu.tsx's onLinkClick — mobile passes its
   * in-shell view-switcher instead of letting this navigate the real router. */
  onLinkClick?: (linkTo: string) => void;
}

const ALL_TAB = "All";
type ReadFilter = "all" | "starred" | "unread" | "read";
const READ_FILTERS: { id: ReadFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "starred", label: "Starred" },
  { id: "unread", label: "Unread" },
  { id: "read", label: "Read" },
];

/** The list itself — reused as-is by both the standalone desktop route below and MobileTechApp.tsx's "notifications" view. */
export function NotificationCenterPanel({ onLinkClick }: NotificationCenterPanelProps) {
  const navigate = useNavigate();
  const { notifs, unread, markRead, markUnread, markAll, deleteOne, toggleStar } = useMergedNotifications({ limit: 500 });
  const [activeTab, setActiveTabRaw] = useState(ALL_TAB);
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null);
  // Switching department invalidates whatever subject was picked for the
  // PREVIOUS department (its subjects don't necessarily exist in the new one).
  const setActiveTab = (tab: string) => {
    setActiveTabRaw(tab);
    setSubjectFilter(null);
  };

  const groups = useMemo(() => {
    const byCategory = new Map<string, MergedNotif[]>();
    for (const n of notifs) {
      const list = byCategory.get(n.category);
      if (list) list.push(n);
      else byCategory.set(n.category, [n]);
    }
    // Categories ordered by their most recent notification, newest first —
    // notifs is already sorted newest-first, so each group's first item is its newest.
    return Array.from(byCategory.entries()).sort(
      (a, b) => b[1][0].createdAt.localeCompare(a[1][0].createdAt)
    );
  }, [notifs]);

  const departmentVisible = activeTab === ALL_TAB ? notifs : groups.find(([c]) => c === activeTab)?.[1] ?? [];

  const filterCounts = useMemo(
    () => ({
      all: departmentVisible.length,
      starred: departmentVisible.filter((n) => n.starred).length,
      unread: departmentVisible.filter((n) => !n.isRead).length,
      read: departmentVisible.filter((n) => n.isRead).length,
    }),
    [departmentVisible]
  );

  const visible = useMemo(() => {
    switch (readFilter) {
      case "starred": return departmentVisible.filter((n) => n.starred);
      case "unread": return departmentVisible.filter((n) => !n.isRead);
      case "read": return departmentVisible.filter((n) => n.isRead);
      default: return departmentVisible;
    }
  }, [departmentVisible, readFilter]);

  // Sub-groups within whichever list is currently showing (a specific
  // department, or "All" spanning every department) — available everywhere
  // so the subject filter is never mysteriously missing. Computed from
  // `visible` (post read-filter) BEFORE subjectFilter is applied, so the
  // subject-filter chip row below can show every subject actually present,
  // with real counts, regardless of which one (if any) is currently selected.
  const subjectGroups = useMemo(() => {
    const bySubject = new Map<string, MergedNotif[]>();
    for (const n of visible) {
      const list = bySubject.get(n.subject);
      if (list) list.push(n);
      else bySubject.set(n.subject, [n]);
    }
    return Array.from(bySubject.entries()).sort((a, b) => b[1][0].createdAt.localeCompare(a[1][0].createdAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, visible]);

  const filteredVisible = subjectFilter ? visible.filter((n) => n.subject === subjectFilter) : visible;
  const filteredSubjectGroups = subjectFilter && subjectGroups ? subjectGroups.filter(([s]) => s === subjectFilter) : subjectGroups;

  const handleSelect = (n: MergedNotif) => {
    markRead(n);
    if (!n.linkTo) return;
    if (onLinkClick) onLinkClick(n.linkTo);
    else navigate({ to: n.linkTo });
  };

  const renderItem = (n: MergedNotif) => (
    <div key={n.id} className="group flex items-start gap-1 hover:bg-white/5 transition-colors">
      <button
        type="button"
        onClick={() => handleSelect(n)}
        className={`flex-1 min-w-0 flex items-start gap-3 px-4 py-3.5 text-left ${n.linkTo ? "cursor-pointer" : "cursor-default"}`}
      >
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full border text-blue-300 bg-blue-400/10 border-blue-400/20">
          <Bell className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className={`truncate text-sm font-semibold ${n.isRead ? "text-muted-foreground" : "text-foreground"}`}>{n.senderName || "System"}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(n.createdAt)}</span>
          </span>
          {activeTab === ALL_TAB && (
            <span className="mt-0.5 inline-block text-[10px] text-blue-300/80">{n.category}</span>
          )}
          <span className={`mt-1 block text-xs leading-5 whitespace-pre-wrap ${n.isRead ? "text-muted-foreground" : "text-foreground/80"}`}>{n.body}</span>
        </span>
        {!n.isRead && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-red-500" />}
      </button>
      <button
        type="button"
        onClick={() => toggleStar(n)}
        title={n.starred ? "Unstar" : "Star"}
        aria-label={n.starred ? "Unstar" : "Star"}
        className={`mt-3.5 shrink-0 grid h-7 w-7 place-items-center rounded-md transition-opacity hover:bg-amber-500/10 hover:text-amber-300 ${
          n.starred ? "text-amber-400 opacity-100" : "text-muted-foreground opacity-40 group-hover:opacity-100"
        }`}
      >
        <Star className="h-3.5 w-3.5" fill={n.starred ? "currentColor" : "none"} />
      </button>
      {n.isRead && (
        <button
          type="button"
          onClick={() => markUnread(n)}
          title="Mark as unread"
          aria-label="Mark as unread"
          className="mt-3.5 shrink-0 grid h-7 w-7 place-items-center rounded-md text-muted-foreground opacity-40 group-hover:opacity-100 hover:bg-blue-500/10 hover:text-blue-300 transition-opacity"
        >
          <Mail className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={() => deleteOne(n)}
        title="Delete notification"
        aria-label="Delete notification"
        className="mt-3.5 mr-3 shrink-0 grid h-7 w-7 place-items-center rounded-md text-muted-foreground opacity-40 group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-300 transition-opacity"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  return (
    <div className="panel p-0 overflow-hidden flex flex-col">
      <div className="px-4 py-4 border-b border-white/10 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-sm">Notifications</h2>
            {unread > 0 && (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">{unread}</span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">{unread} unread</p>
        </div>
        {unread > 0 && (
          <button onClick={() => markAll()} className="btn text-xs px-3 py-1.5 flex items-center gap-1.5 shrink-0">
            <CheckCheck className="h-3.5 w-3.5" /> Mark all read
          </button>
        )}
      </div>

      {groups.length === 0 ? (
        <div className="p-12 text-center text-sm text-muted-foreground">No notifications yet.</div>
      ) : (
        <div className="flex">
          {/* Left sidebar — departments */}
          <div className="w-40 sm:w-48 shrink-0 border-r border-white/10 flex flex-col gap-0.5 py-2 overflow-y-auto" style={{ maxHeight: "68vh" }}>
            {(
              [[ALL_TAB, notifs], ...groups] as [string, MergedNotif[]][]
            ).map(([category, items]) => {
              const unreadInGroup = items.filter((n) => !n.isRead).length;
              const active = activeTab === category;
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => setActiveTab(category)}
                  className={`flex items-center justify-between gap-2 mx-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-left transition-colors ${
                    active
                      ? "bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                  }`}
                >
                  <span className="truncate">{category}</span>
                  <span className="flex items-center gap-1 shrink-0">
                    <span className="text-[10px] text-muted-foreground">{items.length}</span>
                    {unreadInGroup > 0 && (
                      <span className="grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{unreadInGroup}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Right content — Starred/Unread/Read filter, then the list */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex flex-wrap gap-1.5 px-4 py-2.5 border-b border-white/10 bg-white/[0.02]">
              {READ_FILTERS.map((f) => {
                const active = readFilter === f.id;
                const count = filterCounts[f.id];
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setReadFilter(f.id)}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors border ${
                      active
                        ? f.id === "starred"
                          ? "bg-amber-500/10 border-amber-400/30 text-amber-300"
                          : "bg-primary/10 border-primary/30 text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"
                    }`}
                  >
                    {f.id === "starred" && <Star className="h-3 w-3" fill={active ? "currentColor" : "none"} />}
                    {f.label}
                    <span className="text-[10px] text-muted-foreground">{count}</span>
                  </button>
                );
              })}
            </div>

            {subjectGroups && subjectGroups.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-4 py-2 border-b border-white/10">
                <button
                  type="button"
                  onClick={() => setSubjectFilter(null)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors border ${
                    !subjectFilter
                      ? "bg-primary/10 border-primary/30 text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"
                  }`}
                >
                  All subjects
                </button>
                {subjectGroups.map(([subject, items]) => (
                  <button
                    key={subject}
                    type="button"
                    onClick={() => setSubjectFilter(subject)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors border ${
                      subjectFilter === subject
                        ? "bg-primary/10 border-primary/30 text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"
                    }`}
                  >
                    {subject} <span className="text-muted-foreground">{items.length}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="overflow-y-auto" style={{ maxHeight: "60vh" }}>
              {filteredVisible.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">Nothing here.</div>
              ) : filteredSubjectGroups ? (
                filteredSubjectGroups.map(([subject, items]) => (
                  <div key={subject}>
                    <div className="sticky top-0 z-10 px-4 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide bg-slate-900/95 backdrop-blur border-y border-white/10">
                      {subject} <span className="normal-case font-normal">· {items.length}</span>
                    </div>
                    <div className="divide-y divide-white/5">{items.map(renderItem)}</div>
                  </div>
                ))
              ) : (
                <div className="divide-y divide-white/5">{filteredVisible.map(renderItem)}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Standalone route wrapper (`/notifications`) for desktop. */
export function NotificationCenterPage() {
  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-4xl mx-auto p-4">
        <Link to="/home" className="btn text-xs px-2.5 py-1.5 flex items-center gap-1 w-fit mb-4">
          <ChevronLeft className="h-3.5 w-3.5" /> Home
        </Link>
        <NotificationCenterPanel />
      </main>
    </div>
  );
}
