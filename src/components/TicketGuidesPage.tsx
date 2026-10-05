/**
 * Guides → Ticket Guides. Guided tours of the ticket page, one per
 * department (CSR, Triage, Parts, Claims). Pick a department, read what the
 * tour covers, and Start tour — it opens the ticket entered above (the
 * practice ticket by default) and highlights the page step by step.
 */
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Compass, PlayCircle, Ticket, Clock } from "lucide-react";
import { queueTour, type TourDef } from "@/lib/tours/runTour";
import { CSR_TICKET_TOUR, TRIAGE_TICKET_TOUR, PARTS_TICKET_TOUR, PRACTICE_TICKET_NO, canSeeTicketTour } from "@/lib/tours/ticketTours";
import { useAuth } from "@/lib/auth";

interface DepartmentTour {
  key: string;
  label: string;
  intro: string;
  tour: TourDef | null; // null = coming soon
}

const DEPARTMENTS: DepartmentTour[] = [
  { key: "csr", label: "CSR", intro: "Working a ticket — customer, product, schedule, notes, visits and status.", tour: CSR_TICKET_TOUR },
  { key: "triage", label: "Triage", intro: "Diagnosing a ticket — product, problem, Tech Tips, Triage Note and identifying the part.", tour: TRIAGE_TICKET_TOUR },
  { key: "parts", label: "Parts", intro: "Parts on a ticket — status colours, Submit POs, Truck Stock, order tracking and drop-ship requests.", tour: PARTS_TICKET_TOUR },
  { key: "claims", label: "Claims", intro: "Getting a finished ticket paid — claims readiness, Claim Transaction and Pre-Claim.", tour: null },
];

export function TicketGuidesPage() {
  const navigate = useNavigate();
  // Runs on the practice ticket by default; any real ticket number works too.
  const [ticketNo, setTicketNo] = useState(PRACTICE_TICKET_NO);
  // Each department only sees its own tour (Admin / Super Admin see all).
  const { role, extraRoles } = useAuth();
  const visible = DEPARTMENTS.filter((d) => canSeeTicketTour(d.key, role, extraRoles));
  const [deptKey, setDeptKey] = useState("");
  const dept = visible.find((d) => d.key === deptKey) ?? visible[0];
  const isPractice = ticketNo.trim() === PRACTICE_TICKET_NO;

  const start = (tour: TourDef) => {
    const t = ticketNo.trim();
    if (!t) return;
    queueTour(tour.id, `ticket:${t}`);
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
            <Compass className="h-5 w-5 text-blue-400" /> Ticket Guides
          </h1>
          <p className="text-sm text-slate-400">Guided tours of the ticket page, one for each department. The tour only highlights — nothing on the ticket changes.</p>
        </div>
      </div>

      {/* One ticket for every tour. */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 inline-flex items-center gap-1">
            <Ticket className="h-3.5 w-3.5" /> Run the tour on ticket #
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

      {!dept && (
        <section className="rounded-xl border border-dashed border-white/15 p-6 text-center text-sm text-slate-400">
          There's no ticket guide for your role yet. Ticket guides are for CSR, Technical Support (Triage), Parts and Claims.
        </section>
      )}

      {/* Department tabs (only the ones for your role) */}
      {visible.length > 1 && (
      <div className="flex flex-wrap gap-1.5">
        {visible.map((d) => (
          <button
            key={d.key}
            type="button"
            onClick={() => setDeptKey(d.key)}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
              d.key === dept.key ? "border-blue-400/50 bg-blue-500/20 text-white" : "border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]"
            }`}
          >
            {d.label}
            {d.tour ? (
              <span className="ml-1.5 text-[11px] font-normal text-slate-400 tabular-nums">{d.tour.steps.length} steps</span>
            ) : (
              <span className="ml-1.5 text-[11px] font-normal text-slate-500">soon</span>
            )}
          </button>
        ))}
      </div>
      )}

      {dept && (dept.tour ? (
        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex-1 min-w-[240px]">
              <h2 className="text-base font-semibold text-white">{dept.tour.title}</h2>
              <p className="text-sm text-slate-400 mt-0.5">{dept.intro}</p>
              <p className="text-xs text-slate-500 mt-1 inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> {dept.tour.steps.length} steps · about {Math.max(1, Math.round(dept.tour.steps.length / 4))} min · close any time with ✕ or Esc
              </p>
            </div>
            <button
              type="button"
              onClick={() => dept.tour && start(dept.tour)}
              disabled={!ticketNo.trim()}
              className="btn px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              <PlayCircle className="h-4 w-4" /> Start tour
            </button>
          </div>

          <ol className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {dept.tour.steps.map((s, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-[11px] font-semibold text-blue-300 tabular-nums">{i + 1}</span>
                <span>
                  <span className="text-slate-200 font-medium">{s.title}</span>
                  <span className="block text-xs text-slate-400">{s.text}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <section className="rounded-xl border border-dashed border-white/15 p-6 text-center">
          <h2 className="text-sm font-semibold text-slate-300">{dept.label} tour — coming soon</h2>
          <p className="text-sm text-slate-400 mt-1">{dept.intro}</p>
        </section>
      ))}
    </main>
  );
}
