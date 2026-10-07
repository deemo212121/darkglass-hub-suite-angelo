/**
 * Mobile Home building blocks (redesign): the blue hero card, the round
 * Time In / Meal / Time Out buttons, and round shortcut buttons with their
 * title underneath. Pure presentation — every action and rule still lives
 * in MobileHomeView (MobileTechApp.tsx). Styles: .mh-* in styles.css.
 */
import type { ReactNode } from "react";
import {
  CalendarClock,
  ClipboardCheck,
  ClipboardEdit,
  CalendarDays,
  ChevronRight,
  Coffee,
  FileBarChart,
  LifeBuoy,
  LogIn,
  LogOut,
  TicketCheck,
  UserCheck,
  Users,
  UtensilsCrossed,
  Wallet,
  X,
  Grid2x2,
} from "lucide-react";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Blue card at the top: who you are, and today's ticket count front and centre. */
export function HomeHero({
  name,
  greeting,
  tracking,
  assignedToday,
  onHold,
  onOpenTickets,
  onOpenOnHold,
  children,
  topRight,
}: {
  /** Small item in the card's top-right corner (today's clock-in code). */
  topRight?: ReactNode;
  /** The punch buttons — shown inside the card, under a divider. */
  children?: ReactNode;
  name: string;
  greeting: string;
  /** Set when a lead is viewing a report's day. */
  tracking: boolean;
  assignedToday: number;
  onHold: number;
  onOpenTickets: () => void;
  onOpenOnHold: () => void;
}) {
  const first = name.split(/\s+/)[0] || name;
  return (
    <section className="mh-hero">
      <div className="mh-hero-top">
        <span className="mh-avatar" aria-hidden>
          {initialsOf(name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="mh-hi">{tracking ? `Tracking ${first}` : `Hi ${first}!`}</div>
          <div className="mh-sub">{tracking ? "Their day, as of now" : `👋 ${greeting}`}</div>
        </div>
        {topRight}
      </div>
      <button type="button" className="mh-hero-main" onClick={onOpenTickets}>
        <span className="mh-pill">Assigned today</span>
        <span className="mh-big">
          {assignedToday}
          <span className="mh-big-unit">{assignedToday === 1 ? "ticket" : "tickets"}</span>
        </span>
      </button>
      <button type="button" className={`mh-hero-hold ${onHold > 0 ? "mh-hero-hold--hot" : ""}`} onClick={onOpenOnHold}>
        <span>
          <strong>{onHold}</strong> on hold{onHold > 0 ? " · needs updates" : ""}
        </span>
        <ChevronRight className="h-4 w-4" />
      </button>
      {children && <div className="mh-hero-punch">{children}</div>}
    </section>
  );
}

const CLOCK_ICON: Record<string, ReactNode> = {
  "Time In": <LogIn />,
  "Meal In": <UtensilsCrossed />,
  "Meal Out": <Coffee />,
  "Time Out": <LogOut />,
};

/** "08:02" → "8:02 AM". */
function to12h(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/**
 * One round punch button. Same behaviour as the old ClockCard: tap to punch
 * when it's available; once punched it shows the time, and the most recent
 * punch gets a small × that arms a "Remove? Yes / No" before clearing.
 */
export function ClockCircle({
  label,
  value,
  tone,
  canAct,
  onTap,
  removable,
  removeArmed,
  removing,
  onRequestRemove,
  onConfirmRemove,
  onCancelRemove,
}: {
  label: string;
  value: string;
  tone: "in" | "meal" | "out";
  canAct: boolean;
  onTap: () => void;
  removable: boolean;
  removeArmed: boolean;
  removing: boolean;
  onRequestRemove: () => void;
  onConfirmRemove: () => void;
  onCancelRemove: () => void;
}) {
  const done = !!value;
  return (
    <div className={`mh-clock mh-clock--${tone} ${done ? "mh-clock--done" : ""} ${canAct ? "mh-clock--next" : ""}`}>
      <button type="button" className="mh-circle" disabled={done || !canAct} onClick={onTap} aria-label={done ? `${label} at ${to12h(value)}` : label}>
        {CLOCK_ICON[label]}
      </button>
      <span className="mh-clock-label">{label}</span>
      {removeArmed ? (
        <span className="mh-clock-confirm">
          <button type="button" className="mh-yes" disabled={removing} onClick={onConfirmRemove}>
            {removing ? "…" : "Remove"}
          </button>
          <button type="button" className="mh-no" onClick={onCancelRemove} aria-label="Keep it">
            <X className="h-3 w-3" />
          </button>
        </span>
      ) : (
        <span className="mh-clock-time">
          {done ? to12h(value) : canAct ? "Tap" : "—"}
          {done && removable && (
            <button type="button" className="mh-clock-x" onClick={onRequestRemove} aria-label={`Remove ${label}`} title={`Remove ${label}`}>
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </span>
      )}
    </div>
  );
}

const SHORTCUT_ICON: Record<string, ReactNode> = {
  teamapprovals: <ClipboardCheck />,
  clockinteam: <UserCheck />,
  teamattendance: <Users />,
  correction: <ClipboardEdit />,
  timeoff: <CalendarClock />,
  tickettimedispute: <TicketCheck />,
  payrolldispute: <Wallet />,
  itsupport: <LifeBuoy />,
  timecard: <CalendarDays />,
  ticketattendance: <TicketCheck />,
  branchreport: <FileBarChart />,
};

/** Round shortcut button with its title underneath. */
export function ShortcutCircle({ id, label, onClick, tourId }: { id: string; label: string; onClick: () => void; tourId?: string }) {
  return (
    <button type="button" className="mh-shortcut" onClick={onClick} data-tour={tourId}>
      <span className="mh-circle mh-circle--shortcut" aria-hidden>
        {SHORTCUT_ICON[id] ?? <Grid2x2 />}
      </span>
      <span className="mh-shortcut-label">{label}</span>
    </button>
  );
}

export function SectionHead({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mh-section-head">
      <h2>{title}</h2>
      {action}
    </div>
  );
}
