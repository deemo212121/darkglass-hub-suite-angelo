import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Plane } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ExpenseTrackingPage } from "@/components/ExpenseTrackingPage";

/**
 * Accounting's "Expenses" module — a category-tabbed container, same
 * "one page, several sections, room to grow" shape as Absent List's own
 * view toggle. Flash Tech is the only category for now (its own Hotel/
 * Transportation expense rows, scoped out of the full Expense Tracking
 * list via ExpenseTrackingPage's flashTechOnly prop); more expense
 * categories land here as their own tabs later without restructuring
 * this page.
 */
type ExpensesTab = "flashTech";

export function ExpensesModulePage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const [tab, setTab] = useState<ExpensesTab>("flashTech");

  return (
    <main className="flex-1 bg-slate-950 py-6">
      <div className="max-w-[1600px] mx-auto px-6">
        <div className="mb-4 flex flex-wrap items-center gap-3 text-white">
          <button onClick={goBack} className="btn">
            <ChevronLeft className="h-4 w-4" />
            {mod.label}
          </button>
          <div>
            <h1 className="text-2xl font-semibold leading-tight">{sub.title}</h1>
            <p className="text-sm text-muted-foreground">{sub.description}</p>
          </div>
        </div>

        <div className="flex gap-1.5 mb-4">
          <button
            type="button"
            onClick={() => setTab("flashTech")}
            className={`btn text-sm px-3 py-1.5 inline-flex items-center gap-1.5 ${tab === "flashTech" ? "bg-primary/20 text-primary" : ""}`}
          >
            <Plane className="h-3.5 w-3.5" /> Flash Tech
          </button>
        </div>

        {tab === "flashTech" && <ExpenseTrackingPage mod={mod} sub={sub} embedded flashTechOnly />}
      </div>
    </main>
  );
}
