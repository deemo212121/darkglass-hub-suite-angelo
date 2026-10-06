/**
 * Shared look for the header drop-downs (Announcements, Messages,
 * Notifications): one header style, avatars with a stable colour per
 * person, a type icon per notification, links shortened to "link",
 * Today / Yesterday / Earlier groups, and clear unread rows. Styles are the
 * .hm-* classes in styles.css.
 */
import type { ReactNode } from "react";
import {
  Bell,
  CheckCircle2,
  Clock3,
  FileSignature,
  KeyRound,
  LifeBuoy,
  ScrollText,
  TicketCheck,
  Timer,
  Wallet,
  CalendarClock,
  ClipboardEdit,
  Megaphone,
} from "lucide-react";

/** "just now", "5m", "2h", "Yesterday", "Mon", "Sep 4". */
export function shortTime(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const h = Math.round(min / 60);
  if (h < 24 && d.getDate() === new Date().getDate()) return `${h}h`;
  const day = dayBucket(iso);
  if (day === "Yesterday") return "Yesterday";
  if (Date.now() - d.getTime() < 6 * 86400000) return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
}

export function fullTime(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function dayBucket(iso: string): "Today" | "Yesterday" | "Earlier" {
  const d = new Date(iso);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (d >= start) return "Today";
  const y = new Date(start);
  y.setDate(y.getDate() - 1);
  return d >= y ? "Yesterday" : "Earlier";
}

/** Items split into Today / Yesterday / Earlier, keeping their order; empty groups dropped. */
export function groupByDay<T>(items: T[], dateOf: (t: T) => string): { label: string; items: T[] }[] {
  const order = ["Today", "Yesterday", "Earlier"] as const;
  const map = new Map<string, T[]>(order.map((k) => [k, []]));
  for (const it of items) map.get(dayBucket(dateOf(it)))!.push(it);
  return order.map((label) => ({ label, items: map.get(label)! })).filter((g) => g.items.length > 0);
}

/**
 * Preview text for a row: long links become "🔗 link", a leading
 * "Name: " that just repeats the row's name is dropped, and runs of blank
 * lines collapse.
 */
export function previewText(body: string, rowName?: string | null): string {
  let t = body.replace(/https?:\/\/\S+/g, "🔗 link").replace(/\n{2,}/g, "\n").trim();
  if (rowName) {
    const prefix = `${rowName}: `;
    if (t.startsWith(prefix)) t = t.slice(prefix.length);
  }
  return t;
}

const HUES = [210, 262, 330, 20, 150, 190, 45, 290];
function hueFor(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

export function initialsOf(name: string | null | undefined): string {
  const parts = (name || "?").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Round avatar with initials, in a stable colour for that name. */
export function Avatar({ name, icon }: { name: string | null | undefined; icon?: ReactNode }) {
  const hue = hueFor(name || "?");
  return (
    <span className="hm-avatar" style={{ ["--hue" as string]: hue }} aria-hidden>
      {icon ?? initialsOf(name)}
    </span>
  );
}

/** Icon + colour for a notification, from what it's about. */
export function notifKind(body: string): { icon: ReactNode; hue: number } {
  const b = body.toLowerCase();
  if (b.includes("it ticket")) return { icon: <LifeBuoy />, hue: 200 };
  if (b.includes("dispute")) return { icon: <TicketCheck />, hue: 35 };
  if (b.includes("password")) return { icon: <KeyRound />, hue: 280 };
  if (b.includes("payroll") || b.includes("pay ")) return { icon: <Wallet />, hue: 150 };
  if (b.includes("clocked out") || b.includes("ready for your review")) return { icon: <CheckCircle2 />, hue: 150 };
  if (b.includes("clocked in") || b.includes("clock")) return { icon: <Timer />, hue: 190 };
  if (b.includes("time correction") || b.includes("correction")) return { icon: <ClipboardEdit />, hue: 35 };
  if (b.includes("pto") || b.includes("leave") || b.includes("sick")) return { icon: <CalendarClock />, hue: 35 };
  if (b.includes("sign") || b.includes("signature")) return { icon: <FileSignature />, hue: 262 };
  if (b.includes("late") || b.includes("missed")) return { icon: <Clock3 />, hue: 0 };
  if (b.includes("announcement")) return { icon: <Megaphone />, hue: 40 };
  if (b.includes("report")) return { icon: <ScrollText />, hue: 210 };
  return { icon: <Bell />, hue: 215 };
}

/** Icon tile for a notification row. */
export function KindIcon({ body }: { body: string }) {
  const k = notifKind(body);
  return (
    <span className="hm-kind" style={{ ["--hue" as string]: k.hue }} aria-hidden>
      {k.icon}
    </span>
  );
}

/** Drop-down header: icon, title, unread count, actions on the right. */
export function MenuHeader({ icon, title, unread, actions }: { icon: ReactNode; title: string; unread: number; actions?: ReactNode }) {
  return (
    <div className="hm-header">
      <span className="hm-header-icon" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <div className="hm-header-title">{title}</div>
        <div className="hm-header-sub">{unread > 0 ? `${unread} unread` : "All caught up"}</div>
      </div>
      {actions && <div className="ml-auto flex items-center gap-1.5">{actions}</div>}
    </div>
  );
}

export function GroupLabel({ children }: { children: ReactNode }) {
  return <div className="hm-group">{children}</div>;
}

export function MenuEmpty({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="hm-empty">
      <span className="hm-empty-icon" aria-hidden>
        {icon}
      </span>
      {text}
    </div>
  );
}
