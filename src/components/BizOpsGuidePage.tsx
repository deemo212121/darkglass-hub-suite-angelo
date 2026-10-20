/**
 * Guides → BizOps Operations. The three tours from "OPERATIONS GUIDELINES
 * and Ticket PROCESSES": working the OP queues (Ticket List), checking parts
 * shipments and Need Cancel (on a ticket — the practice ticket by default).
 * Look-only: the tours highlight and explain; nothing is changed, submitted
 * or sent.
 */
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Clock, Compass, PlayCircle, Ticket } from "lucide-react";
import { queueTour, type TourDef } from "@/lib/tours/runTour";
import { PRACTICE_TICKET_NO } from "@/lib/tours/ticketTours";
import { BIZOPS_NEED_CANCEL_TOUR, BIZOPS_PARTS_TOUR, BIZOPS_QUEUE_TOUR, TICKET_LIST_TOUR_TARGET } from "@/lib/tours/bizopsTours";

const TOURS: { def: TourDef; page: "ticket-list" | "ticket" }[] = [
  { def: BIZOPS_QUEUE_TOUR, page: "ticket-list" },
  { def: BIZOPS_PARTS_TOUR, page: "ticket" },
  { def: BIZOPS_NEED_CANCEL_TOUR, page: "ticket" },
];

/** Step text for the list — tour text can carry a little markup (bold, line breaks). */
const plainText = (html: string) =>
  html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

export function BizOpsGuidePage() {
  const navigate = useNavigate();
  // The ticket tours run on the practice ticket by default; any real ticket number works too.
  const [ticketNo, setTicketNo] = useState(PRACTICE_TICKET_NO);
  const isPractice = ticketNo.trim() === PRACTICE_TICKET_NO;

  const start = (def: TourDef, page: "ticket-list" | "ticket") => {
    if (page === "ticket-list") {
      queueTour(def.id, TICKET_LIST_TOUR_TARGET);
      navigate({ to: "/m/$module/$submodule", params: { module: "tickets", submodule: "ticket-list" } });
      return;
    }
    const t = ticketNo.trim();
    if (!t) return;
    queueTour(def.id, `ticket:${t}`);
    navigate({ to: "/ticket/$ticketNo", params: { ticketNo: t } });
  };

  return (
    <main className="max-w-4xl mx-auto w-full px-6 py-8 space-y-5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate({ to: "/m/$module", params: { module: "guides" } })}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-slate-300 hover:text-white"
          aria-label="Back to Guides"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-white">
            <Compass className="h-5 w-5 text-blue-400" /> BizOps Operations
          </h1>
          <p className="text-sm text-slate-400">
            Tours from the Operations Guidelines — working the OP queues, checking parts shipments and Need Cancel. They only highlight; nothing is changed or sent.
          </p>
        </div>
      </div>

      {/* The ticket the two ticket tours run on. */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 inline-flex items-center gap-1">
            <Ticket className="h-3.5 w-3.5" /> Ticket tours run on ticket #
          </span>
          <input
            value={ticketNo}
            onChange={(e) => setTicketNo(e.target.value)}
            placeholder="Ticket number"
            className="glass-input text-sm py-1.5 px-3 rounded-md w-52"
          />
        </label>
        <p className="text-xs text-slate-400 pb-1.5 flex-1 min-w-[220px]">
          {isPractice ? (
            <>
              <span className="font-semibold text-amber-200">{PRACTICE_TICKET_NO}</span> is the practice ticket — made-up customer and sample parts, nothing on it is saved or ordered.
            </>
          ) : (
            "A real ticket — the tour only looks at it. Use the practice ticket if you want to click around."
          )}
        </p>
        {!isPractice && (
          <button type="button" onClick={() => setTicketNo(PRACTICE_TICKET_NO)} className="btn text-xs px-3 py-1.5">
            Use practice ticket
          </button>
        )}
      </div>

      {TOURS.map(({ def, page }, n) => (
        <section key={def.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex-1 min-w-[240px]">
              <h2 className="text-base font-semibold text-white">
                <span className="mr-2 text-blue-300 tabular-nums">{n + 1}.</span>
                {def.title.replace(/\s*\(BizOps\)$/, "")}
              </h2>
              <p className="text-sm text-slate-400 mt-0.5">{def.summary}</p>
              <p className="text-xs text-slate-500 mt-1 inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> {def.steps.length} steps · {page === "ticket-list" ? "runs on the Ticket List" : `runs on ticket ${ticketNo.trim() || "—"}`} · close any time with ✕ or Esc
              </p>
            </div>
            <button
              type="button"
              onClick={() => start(def, page)}
              disabled={page === "ticket" && !ticketNo.trim()}
              className="btn px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              <PlayCircle className="h-4 w-4" /> Start tour
            </button>
          </div>
          <ol className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {def.steps.map((s, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-[11px] font-semibold text-blue-300 tabular-nums">{i + 1}</span>
                <span>
                  <span className="text-slate-200 font-medium">{s.title}</span>
                  <span className="block text-xs text-slate-400 line-clamp-3">{plainText(s.text)}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </main>
  );
}
