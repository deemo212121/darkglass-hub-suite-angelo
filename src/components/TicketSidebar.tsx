import { useRef, useState } from "react";
import {
  FileText,
  Wrench,
  DollarSign,
  Receipt,
  Link2,
  ClipboardList,
  Package,
  ScrollText,
  Paperclip,
  ChevronRight,
} from "lucide-react";

type TabKey = "general" | "tracking" | "compensation" | "billing";

interface TicketSidebarProps {
  activeTab: TabKey;
  setActiveTab: (tab: TabKey) => void;
}

const TRACKING_SECTIONS = [
  { id: "section-related-tickets", label: "Related Tickets", icon: Link2 },
  { id: "section-visit-log", label: "Visit Log", icon: ClipboardList },
  { id: "section-part-transaction", label: "Part Transaction", icon: Package },
  { id: "section-claim-transaction", label: "Claim Transaction", icon: ScrollText },
  { id: "section-attachments", label: "Attachments", icon: Paperclip },
];

/**
 * Hover-driven left rail on the ticket detail page.
 *
 *  - A clearly visible "Sections" tab sits a short distance from the
 *    viewport's left edge. Hovering it (or the panel) slides the rail
 *    out; the rail tucks back when the cursor leaves both.
 *  - Switches the parent's activeTab; tracking sub-sections also smooth-
 *    scroll their anchor into view.
 *  - Hidden under xl so it never crowds smaller layouts.
 *  - z-index sits BELOW typical modals/dropdowns (z=20) so it never
 *    overlaps open menus or dialogs.
 */
export function TicketSidebar({ activeTab, setActiveTab }: TicketSidebarProps) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 220);
  };

  const jumpToTracking = (anchorId: string) => {
    setActiveTab("tracking");
    setTimeout(() => {
      document.getElementById(anchorId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  };

  const TopBtn = ({ tab, label, Icon }: { tab: TabKey; label: string; Icon: React.ElementType }) => (
    <button
      onClick={() => setActiveTab(tab)}
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
        activeTab === tab
          ? "bg-blue-500/25 text-white font-semibold border border-blue-400/40"
          : "text-slate-300 hover:bg-white/8 hover:text-white border border-transparent"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </button>
  );

  return (
    <div
      // 16px from the left edge so the tab is clearly off the screen
      // border. z-index 20 leaves room above for modals (z-50) and the
      // header (z-30) so it never overlaps either.
      // Hidden only on small touch screens (<md = 768px) where it would
      // overlap the body content; on every laptop/desktop width it
      // stays available so users don't lose their navigation rail when
      // the window is narrowed.
      className="hidden md:block fixed left-4 top-28 z-20"
      onMouseEnter={() => { cancelClose(); setOpen(true); }}
      onMouseLeave={scheduleClose}
    >
      {/* Visible "Sections" tab — slim vertical pill. Hovers reveal the
          panel; this tab stays as a permanent anchor when collapsed. */}
      <div
        className={`flex items-center gap-0.5 rounded-md border border-blue-400/40 bg-blue-500/20 text-blue-200 px-1 py-2 shadow-md shadow-blue-900/30 select-none transition-opacity ${
          open ? "opacity-0 pointer-events-none" : "opacity-100"
        }`}
        aria-hidden="true"
      >
        <ChevronRight className="h-3 w-3" />
        <span className="text-[9px] font-semibold uppercase tracking-[0.18em] [writing-mode:vertical-rl]">
          Sections
        </span>
      </div>

      {/* Expanded panel — slides over from the left when hovered. */}
      <aside
        className={`absolute left-0 top-0 w-60 pr-3 transition-transform duration-200 ease-out ${
          open ? "translate-x-0" : "-translate-x-[110%]"
        }`}
      >
        <div className="rounded-xl border border-white/10 bg-slate-900/85 backdrop-blur-md p-2.5 shadow-2xl">
          <div className="px-2 py-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              Ticket Sections
            </span>
          </div>
          <div className="space-y-1">
            <TopBtn tab="general" label="General" Icon={FileText} />
            <TopBtn tab="tracking" label="Service Tracking" Icon={Wrench} />

            <div className="ml-3 border-l border-white/10 pl-2 space-y-0.5 py-1">
              {TRACKING_SECTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => jumpToTracking(s.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-slate-400 hover:bg-white/8 hover:text-white transition-colors"
                >
                  <s.icon className="h-3.5 w-3.5 shrink-0" />
                  {s.label}
                </button>
              ))}
            </div>

            <TopBtn tab="compensation" label="Compensation" Icon={DollarSign} />
            <TopBtn tab="billing" label="Billing" Icon={Receipt} />
          </div>
        </div>
      </aside>
    </div>
  );
}
