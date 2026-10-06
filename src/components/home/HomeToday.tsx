/**
 * Home → "Today": a greeting with the date, then a compact "Needs your
 * attention" strip — one card per thing waiting on this person, each
 * linking to the page that handles it. What counts for whom lives in
 * useAttention (src/lib/attention.ts), shared with the badges elsewhere;
 * Parts "click DONE" is added here since it lives in this browser.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Bell, CalendarClock, CheckCheck, ClipboardCheck, ClipboardEdit, Flag, HeartPulse, MessageCircle, PartyPopper, TicketCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { normalizeRole } from "@/lib/roleLabels";
import { useAttention, badgeText, type AttentionItem, type AttentionKind, type AttentionTone } from "@/lib/attention";
import { getPendingDoneItems, PARTS_DONE_QUEUE_EVENT } from "@/lib/partsDoneQueue";
import { OPEN_MESSENGER_EVENT } from "@/components/FloatingMessenger";

const PARTS_ROLES = new Set(["PARTS", "PARTS_TEAM_LEADER", "PARTS_MANAGER", "PARTS_ORDER"]);

const ICONS: Record<AttentionKind | "parts-done", ReactNode> = {
  pto: <CalendarClock />,
  sick: <HeartPulse />,
  corrections: <ClipboardEdit />,
  disputes: <TicketCheck />,
  "over-limit": <Flag />,
  coaching: <ClipboardCheck />,
  notifications: <Bell />,
  messages: <MessageCircle />,
  "parts-done": <CheckCheck />,
};

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

type Card = Omit<AttentionItem, "kind"> & { kind: AttentionKind | "parts-done"; toModule?: string };

export function HomeToday() {
  const { displayName, email, role, extraRoles } = useAuth();
  const attention = useAttention();
  const firstName = (displayName || email || "").split(/[\s@]/)[0];
  const isParts = [role, ...(extraRoles ?? [])].filter(Boolean).some((r) => PARTS_ROLES.has(normalizeRole(r as string)));

  const [partsDone, setPartsDone] = useState(() => getPendingDoneItems().length);
  useEffect(() => {
    const refresh = () => setPartsDone(getPendingDoneItems().length);
    window.addEventListener(PARTS_DONE_QUEUE_EVENT, refresh);
    return () => window.removeEventListener(PARTS_DONE_QUEUE_EVENT, refresh);
  }, []);

  const cards: Card[] | null = attention
    ? [
        ...(isParts && partsDone > 0
          ? [{ kind: "parts-done" as const, count: partsDone, label: partsDone === 1 ? "Part updated — click DONE" : "Parts updated — click DONE", tone: "alert" as AttentionTone, toModule: "parts" }]
          : []),
        ...attention.items,
      ]
    : null;

  const renderCard = (it: Card) => {
    const body = (
      <>
        <span className="home-attn-icon">{ICONS[it.kind]}</span>
        <span className="home-attn-count">{badgeText(it.count)}</span>
        <span className="home-attn-label">{it.label}</span>
      </>
    );
    const cls = `home-attn home-attn--${it.tone}`;
    if (it.opensMessenger)
      return (
        <button key={it.kind} type="button" onClick={() => window.dispatchEvent(new Event(OPEN_MESSENGER_EVENT))} className={cls} title={it.title}>
          {body}
        </button>
      );
    if (it.href)
      return (
        <a key={it.kind} href={it.href} className={cls} title={it.title}>
          {body}
        </a>
      );
    if (it.to)
      return (
        <Link key={it.kind} to="/m/$module/$submodule" params={{ module: it.to[0], submodule: it.to[1] }} className={cls} title={it.title}>
          {body}
        </Link>
      );
    if (it.toModule)
      return (
        <Link key={it.kind} to="/m/$module" params={{ module: it.toModule }} className={cls} title={it.title}>
          {body}
        </Link>
      );
    return (
      <div key={it.kind} className={cls} title={it.title}>
        {body}
      </div>
    );
  };

  return (
    <section className="home-today" aria-label="Today">
      <p className="home-eyebrow">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
      <h1 className="home-title">
        {greeting()}
        {firstName ? `, ${firstName}` : ""}
      </h1>
      <p className="home-sub">
        {cards === null
          ? "Checking what needs you today…"
          : cards.length === 0
            ? "Nothing is waiting on you right now."
            : `${cards.length} ${cards.length === 1 ? "thing needs" : "things need"} your attention.`}
      </p>
      <div className="home-attn-grid">
        {cards === null ? (
          [0, 1, 2].map((i) => <div key={i} className="home-attn home-attn--skeleton ui-skeleton" />)
        ) : cards.length === 0 ? (
          <div className="home-attn home-attn--clear">
            <span className="home-attn-icon">
              <PartyPopper />
            </span>
            <span className="home-attn-label">You're all caught up</span>
          </div>
        ) : (
          cards.map(renderCard)
        )}
      </div>
    </section>
  );
}
