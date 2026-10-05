/**
 * Guides → Self-Service Guide. What the Employee Self-Service tour covers;
 * Start tour opens Dashboard → Employee Self-Service and the tour starts
 * there (it only highlights — nothing is submitted).
 */
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Compass, PlayCircle, Clock } from "lucide-react";
import { queueTour } from "@/lib/tours/runTour";
import { SELF_SERVICE_TOUR, SELF_SERVICE_TOUR_TARGET } from "@/lib/tours/selfServiceTour";

export function SelfServiceGuidePage() {
  const navigate = useNavigate();
  const tour = SELF_SERVICE_TOUR;

  const start = () => {
    queueTour(tour.id, SELF_SERVICE_TOUR_TARGET);
    navigate({ to: "/m/$module/$submodule", params: { module: "dashboard", submodule: "employee-self-service" } });
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
            <Compass className="h-5 w-5 text-blue-400" /> Self-Service Guide
          </h1>
          <p className="text-sm text-slate-400">For everyone — your clock, pay, attendance and requests.</p>
        </div>
      </div>

      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-[240px]">
            <h2 className="text-base font-semibold text-white">{tour.title}</h2>
            <p className="text-sm text-slate-400 mt-0.5">{tour.summary}</p>
            <p className="text-xs text-slate-500 mt-1 inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> {tour.steps.length} steps · about {Math.max(1, Math.round(tour.steps.length / 4))} min · only highlights, nothing is submitted
            </p>
          </div>
          <button type="button" onClick={start} className="btn px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1.5">
            <PlayCircle className="h-4 w-4" /> Start tour
          </button>
        </div>
        <ol className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {tour.steps.map((s, i) => (
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
    </main>
  );
}
