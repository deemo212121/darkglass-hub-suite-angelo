import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { BedDouble, Car, ChevronLeft, Plane, Receipt } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ExpenseTrackingPage } from "@/components/ExpenseTrackingPage";

/**
 * Accounting's "Expenses" module — a category-tabbed container, same
 * "one page, several sections, room to grow" shape as Absent List's own
 * view toggle. Flash Tech is the only category for now (its own Hotel/
 * Transportation expense rows, scoped out of the full Expense Tracking
 * list via ExpenseTrackingPage's flashTechOnly prop); Employee Requests
 * holds the expenses employees send themselves from Employee Self-Service
 * → My Requests (selfFiledOnly). More expense categories land here
 * as their own tabs later without restructuring this page.
 */
type ExpensesTab = "flashTech" | "employeeRequests" | "hotel" | "carRental";

const TABS: { key: ExpensesTab; label: string; icon: typeof Plane }[] = [
  { key: "flashTech", label: "Flash Tech", icon: Plane },
  { key: "employeeRequests", label: "Employee Requests", icon: Receipt },
  { key: "hotel", label: "Hotel", icon: BedDouble },
  { key: "carRental", label: "Car Rental", icon: Car },
];

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

        <div className="flex flex-wrap gap-1.5 mb-4">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`btn text-sm px-3 py-1.5 inline-flex items-center gap-1.5 ${tab === key ? "bg-primary/20 text-primary" : ""}`}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        {tab === "flashTech" && <ExpenseTrackingPage mod={mod} sub={sub} embedded flashTechOnly />}
        {tab === "employeeRequests" && <ExpenseTrackingPage mod={mod} sub={sub} embedded selfFiledOnly />}
        {tab === "hotel" && <ExpenseTrackingPage mod={mod} sub={sub} embedded categoryOnly="Hotel" />}
        {tab === "carRental" && <ExpenseTrackingPage mod={mod} sub={sub} embedded categoryOnly="Car Rental" />}
      </div>
    </main>
  );
}
