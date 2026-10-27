/**
 * Guides → Claims & Pre-Auth. Two look-only tours: filing a claim without
 * errors (Need Claim List → Pre-Claim) and Pre-Auth (Claims → Pre-Auth).
 * They only highlight; nothing is saved, submitted or sent.
 */
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Clock, FileCheck2, PlayCircle } from "lucide-react";
import { queueTour } from "@/lib/tours/runTour";
import { CLAIMS_TOURS } from "@/lib/tours/claimsTours";

/** Step text for the list — tour text can carry a little markup (bold, line breaks). */
const plainText = (html: string) =>
  html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

export function ClaimsGuidePage() {
  const navigate = useNavigate();

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
            <FileCheck2 className="h-5 w-5 text-emerald-400" /> Claims &amp; Pre-Auth
          </h1>
          <p className="text-sm text-slate-400">
            How to file a claim ServicePower accepts the first time, and how to fill in a Pre-Auth. The tours only highlight — nothing is saved, submitted or sent.
          </p>
        </div>
      </div>

      {CLAIMS_TOURS.map(({ def, target, page, where }, n) => (
        <section key={def.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex-1 min-w-[240px]">
              <h2 className="text-base font-semibold text-white">
                <span className="mr-2 text-emerald-300 tabular-nums">{n + 1}.</span>
                {def.title}
              </h2>
              <p className="text-sm text-slate-400 mt-0.5">{def.summary}</p>
              <p className="text-xs text-slate-500 mt-1 inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> {def.steps.length} steps · {where} · close any time with ✕ or Esc
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                queueTour(def.id, target);
                navigate({ to: "/m/$module/$submodule", params: page });
              }}
              className="btn px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white inline-flex items-center gap-1.5"
            >
              <PlayCircle className="h-4 w-4" /> Start tour
            </button>
          </div>
          <ol className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {def.steps.map((s, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-[11px] font-semibold text-emerald-300 tabular-nums">{i + 1}</span>
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
