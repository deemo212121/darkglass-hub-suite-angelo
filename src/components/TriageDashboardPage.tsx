import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Activity, Clock, CalendarClock } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { DailyActivityPage } from "@/components/DailyActivityPage";
import { ReportAttendanceMonitoring } from "@/components/ReportAttendanceMonitoring";
import { WorkHoursPanel } from "@/components/WorkHoursPanel";
import { isTriageRole } from "@/lib/roleLabels";
import type { ProfileRow } from "@/lib/supabase/users";

// Module-level (not defined inside the component) so both embedded pages'
// `load`/fetch effects see a stable reference across renders — an inline
// arrow recreated on every render would retrigger their data fetch each time.
const isTriageProfileFilter = (p: ProfileRow) => isTriageRole(p.role);
// Same "TOTAL # of TICKETS TO DO" scoping the Activity tab already used
// before this page grew a second tab.
const isNeedTriageStatus = (status: string) => String(status || "").trim().toLowerCase() === "tr-need triage";

/**
 * Technical Support's own department dashboard — three tabs over the exact
 * same live data every other department-level report already uses, each
 * narrowed to Technical Support (TRIAGE_USER) + Technical Support Manager
 * (TRIAGE_MANAGER) via isTriageProfileFilter:
 *   - Activity: the Daily Activity Report's per-user action breakdown.
 *   - Attendance: the Attendance Monitoring Report's present/absent/late
 *     breakdown for a date range.
 *   - Work Hours: edit each Triage employee's Required Check-In/Check-Out
 *     (see WorkHoursPanel.tsx, shared with CSRDashboard.tsx).
 * The Activity/Attendance pages render `embedded` (no own back-link/title/
 * page shell) — this page provides that chrome once, for all three tabs.
 */
export function TriageDashboardPage({ mod, sub, companyId }: { mod: ModuleDef; sub: SubModuleDef; companyId: string | null }) {
  const [tab, setTab] = useState<"activity" | "attendance" | "workHours">("activity");

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-4 py-4">
        <div className="mb-3">
          <div className="flex items-center gap-3 mb-2">
            <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
              <ChevronLeft className="h-4 w-4" /> {mod.label}
            </Link>
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight">{sub.title}</h1>
          </div>
        </div>

        <div className="flex gap-2 border-b border-white/10 mb-4 overflow-x-auto">
          {[
            { id: "activity" as const, label: "Activity", Icon: Activity },
            { id: "attendance" as const, label: "Attendance", Icon: Clock },
            { id: "workHours" as const, label: "Work Hours", Icon: CalendarClock },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 border-b-2 transition whitespace-nowrap flex items-center gap-2 text-sm ${tab === t.id ? "border-blue-500 text-blue-300" : "border-transparent text-slate-400 hover:text-slate-300"}`}
            >
              <t.Icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
        </div>

        {tab === "activity" ? (
          <DailyActivityPage mod={mod} sub={sub} companyId={companyId} filterProfile={isTriageProfileFilter} pendingStatusFilter={isNeedTriageStatus} embedded />
        ) : tab === "attendance" ? (
          <ReportAttendanceMonitoring mod={mod} sub={sub} filterProfile={isTriageProfileFilter} groupBy="employee" embedded />
        ) : (
          <WorkHoursPanel filterProfile={isTriageProfileFilter} emptyMessage="No active Technical Support employees found." />
        )}
      </main>
    </div>
  );
}
