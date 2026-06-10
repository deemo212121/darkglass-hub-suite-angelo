import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Search, Plus, Trash2 } from "lucide-react";
import { getLocationRanking, getOverallStatus, getTechRanking, getTicketStatistics, getTickets } from "@/lib/db-api";
import type { ModuleDef, SubModuleDef, DashboardOverallStatus, LocationRankingRecord, TechRankingRecord, TicketStatistic, Ticket } from "@/lib/db";
import { LOCATIONS } from "@/lib/locations";

type StatsSnapshot = {
  totalTickets: number;
  pendingTickets: number;
  completedTickets: number;
  ftfRate: string;
};

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.round(value * 10) / 10}%`;
}

function buildSnapshot(overallStatus: DashboardOverallStatus | undefined, tickets: Ticket[]): StatsSnapshot {
  if (overallStatus) {
    const completed = overallStatus.resolvedTickets + overallStatus.closedTickets;
    const pending = overallStatus.openTickets + overallStatus.inProgressTickets;
    const total = overallStatus.totalTickets || tickets.length;
    return {
      totalTickets: total,
      pendingTickets: pending,
      completedTickets: completed,
      ftfRate: total > 0 ? formatPercent((completed / total) * 100) : "0%",
    };
  }

  const total = tickets.length;
  const pending = tickets.filter((ticket) => ticket.status === "open" || ticket.status === "in-progress").length;
  const completed = tickets.filter((ticket) => ticket.status === "resolved" || ticket.status === "closed").length;
  return {
    totalTickets: total,
    pendingTickets: pending,
    completedTickets: completed,
    ftfRate: total > 0 ? formatPercent((completed / total) * 100) : "0%",
  };
}

function groupTicketStats(stats: TicketStatistic[]) {
  return stats.reduce<Record<string, TicketStatistic[]>>((acc, stat) => {
    acc[stat.type] = acc[stat.type] ?? [];
    acc[stat.type].push(stat);
    return acc;
  }, {});
}

function compareText(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

interface InterviewCandidate {
  id: string;
  name: string;
  position: string;
  branch: string;
  interviewDate: string;
  interviewTime: string;
  status: "scheduled" | "completed" | "hired" | "rejected";
  notes: string;
}

export function OverallStatusPage({ mod, sub, companyId }: { mod: ModuleDef; sub: SubModuleDef; companyId: string | null; }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketStats, setTicketStats] = useState<TicketStatistic[]>([]);
  const [techRanking, setTechRanking] = useState<TechRankingRecord[]>([]);
  const [locationRanking, setLocationRanking] = useState<LocationRankingRecord[]>([]);
  const [overallStatus, setOverallStatus] = useState<DashboardOverallStatus | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [activeStatType, setActiveStatType] = useState<"monthly" | "daily">("monthly");
  
  // HR Interview Management State
  const [candidates, setCandidates] = useState<InterviewCandidate[]>([
    { id: "1", name: "John Smith", position: "Technician", branch: "Atlanta", interviewDate: "2026-06-12", interviewTime: "10:00", status: "scheduled", notes: "" },
    { id: "2", name: "Sarah Johnson", position: "CSR", branch: "Nashville", interviewDate: "2026-06-15", interviewTime: "14:00", status: "scheduled", notes: "" },
    { id: "3", name: "Mike Davis", position: "Technician", branch: "Memphis", interviewDate: "2026-06-10", interviewTime: "09:30", status: "completed", notes: "Strong technical background" },
    { id: "4", name: "Emily Wilson", position: "Tech Manager", branch: "Birmingham", interviewDate: "2026-06-08", interviewTime: "11:00", status: "hired", notes: "Excellent fit for team" },
  ]);
  const [showAddInterview, setShowAddInterview] = useState(false);
  const [newCandidate, setNewCandidate] = useState<Partial<InterviewCandidate>>({
    name: "",
    position: "",
    branch: "",
    interviewDate: "",
    interviewTime: "",
    status: "scheduled",
    notes: "",
  });

  useEffect(() => {
    let mounted = true;

    Promise.all([getTickets(), getTicketStatistics(), getTechRanking(), getLocationRanking(), getOverallStatus()])
      .then(([nextTickets, nextStats, nextTechRanking, nextLocationRanking, nextOverallStatus]) => {
        if (!mounted) return;
        setTickets(nextTickets);
        setTicketStats(nextStats);
        setTechRanking(nextTechRanking);
        setLocationRanking(nextLocationRanking);
        setOverallStatus(nextOverallStatus[0]);
      })
      .catch((error) => {
        console.error("Failed to load overall status data:", error);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const snapshot = useMemo(() => buildSnapshot(overallStatus, tickets), [overallStatus, tickets]);
  const ticketGroups = useMemo(() => groupTicketStats(ticketStats), [ticketStats]);
  const filteredTechRanking = useMemo(() => {
    const term = search.trim().toLowerCase();
    return techRanking.filter((record) => {
      if (!term) return true;
      return [record.techName, record.office, String(record.rank)]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [search, techRanking]);

  const filteredLocationRanking = useMemo(() => {
    const term = search.trim().toLowerCase();
    return locationRanking.filter((record) => {
      if (!term) return true;
      return [record.office, String(record.rank)]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [search, locationRanking]);

  const dateRange = overallStatus?.dateRange;
  const totalTickets = snapshot.totalTickets;
  const pendingTickets = snapshot.pendingTickets;
  const completedTickets = snapshot.completedTickets;

  const monthlyStats = (ticketGroups.monthly ?? []).slice().sort((a, b) => compareText(a.date, b.date));
  const dailyStats = (ticketGroups.daily ?? []).slice().sort((a, b) => compareText(a.date, b.date));
  const liveDataLabel = companyId
    ? `Live data: ${totalTickets} ticket(s) for company ${companyId}.`
    : `Live data: ${totalTickets} ticket(s).`;

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-6">
            <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
              <ChevronLeft className="h-4 w-4" /> {mod.label}
            </Link>
          </div>

          <div className="panel mb-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Location</p>
                <div className="mt-2 text-2xl font-display font-semibold">ALL</div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Date</p>
                <div className="mt-2 text-lg font-medium text-foreground/90">
                  {dateRange ? (
                    <span>
                      {dateRange.start}
                      <span className="mx-3 text-muted-foreground">~</span>
                      {dateRange.end}
                    </span>
                  ) : (
                    <span>—</span>
                  )}
                </div>
              </div>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">{liveDataLabel}</p>
          </div>

          <div>
            <h1 className="text-4xl font-display font-bold tracking-tight mb-2">Overall Status</h1>
            <p className="text-lg text-muted-foreground">System-wide health, tickets, and ranking summaries.</p>
          </div>
        </div>

        <section className="panel">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm text-muted-foreground">Total Tickets</p>
              <p className="mt-2 text-3xl font-semibold">{totalTickets}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm text-muted-foreground">Pending</p>
              <p className="mt-2 text-3xl font-semibold">{pendingTickets}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm text-muted-foreground">Completed</p>
              <p className="mt-2 text-3xl font-semibold">{completedTickets}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm text-muted-foreground">FTF Rate</p>
              <p className="mt-2 text-3xl font-semibold">{snapshot.ftfRate}</p>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="panel">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-2xl font-semibold">Ticket Statistics</h2>
                <p className="text-sm text-muted-foreground">Ticket Statistics ({activeStatType === "monthly" ? "Monthly" : "Daily"})</p>
              </div>
              <div className="flex gap-2">
                <button className={`btn ${activeStatType === "monthly" ? "btn-primary" : ""}`} onClick={() => setActiveStatType("monthly")}>Ticket Statistics (Monthly)</button>
                <button className={`btn ${activeStatType === "daily" ? "btn-primary" : ""}`} onClick={() => setActiveStatType("daily")}>Ticket Statistics (Daily)</button>
              </div>
            </div>
            <div className="table-wrap overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Status</th>
                    <th className="text-center">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {(activeStatType === "monthly" ? monthlyStats : dailyStats).map((row) => (
                    <tr key={`${row.type}-${row.date}-${row.status}`}>
                      <td>{row.date}</td>
                      <td>{row.status}</td>
                      <td className="text-center">{row.count}</td>
                    </tr>
                  ))}
                  {(activeStatType === "monthly" ? monthlyStats : dailyStats).length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-10 text-center text-muted-foreground">No live ticket statistics available.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <h2 className="text-2xl font-semibold mb-4">Pending Tickets Analysis</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-sm text-muted-foreground">Pending Tickets by Status</p>
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex items-center justify-between"><span>Open</span><span>{tickets.filter((ticket) => ticket.status === "open").length}</span></div>
                  <div className="flex items-center justify-between"><span>In Progress</span><span>{tickets.filter((ticket) => ticket.status === "in-progress").length}</span></div>
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-sm text-muted-foreground">Ready for Service</p>
                <p className="mt-3 text-3xl font-semibold">{tickets.filter((ticket) => ticket.status === "resolved").length}</p>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm text-muted-foreground">CSR Activity</p>
              <p className="mt-2 text-lg">{overallStatus ? `${overallStatus.csrActivityCount} activities recorded` : `${tickets.length} live tickets available`}</p>
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm text-muted-foreground">Activity Distribution</p>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-black/10 p-3">
                  <div className="text-muted-foreground">Pending</div>
                  <div className="text-xl font-semibold">{pendingTickets}</div>
                </div>
                <div className="rounded-lg bg-black/10 p-3">
                  <div className="text-muted-foreground">Completed</div>
                  <div className="text-xl font-semibold">{completedTickets}</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
            <div>
              <h2 className="text-2xl font-semibold">Tech Ranking Report</h2>
              <p className="text-sm text-muted-foreground">{filteredTechRanking.length} records out of {techRanking.length} found</p>
            </div>
            <label className="relative w-full md:w-[320px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                className="glass-input pl-9"
                placeholder="Search in result..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>
          <div className="table-wrap overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Tech Name</th>
                  <th>Office</th>
                  <th className="text-center">Tickets</th>
                  <th className="text-center">Completed</th>
                  <th className="text-center">Pending</th>
                  <th className="text-center">Completion %</th>
                </tr>
              </thead>
              <tbody>
                {filteredTechRanking.map((record) => (
                  <tr key={`${record.rank}-${record.techName}`}>
                    <td>{record.rank}</td>
                    <td>{record.techName}</td>
                    <td>{record.office}</td>
                    <td className="text-center">{record.completions + record.redos}</td>
                    <td className="text-center">{record.completions}</td>
                    <td className="text-center">{record.redos}</td>
                    <td className="text-center">{formatPercent((record.completions / Math.max(record.completions + record.redos, 1)) * 100)}</td>
                  </tr>
                ))}
                {filteredTechRanking.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-muted-foreground">No live tech ranking records available.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="mb-4">
            <h2 className="text-2xl font-semibold">Location Ranking Report</h2>
            <p className="text-sm text-muted-foreground">{filteredLocationRanking.length} records out of {locationRanking.length} found</p>
          </div>
          <div className="table-wrap overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Office</th>
                  <th className="text-center">30-Day Score</th>
                  <th className="text-center">10-Day Score</th>
                </tr>
              </thead>
              <tbody>
                {filteredLocationRanking.map((record) => (
                  <tr key={`${record.rank}-${record.office}`}>
                    <td>{record.rank}</td>
                    <td>{record.office}</td>
                    <td className="text-center">{record.thirtydayScore}%</td>
                    <td className="text-center">{record.tendayScore}%</td>
                  </tr>
                ))}
                {filteredLocationRanking.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-muted-foreground">No live location ranking records available.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <p className="text-sm text-muted-foreground">No dummy data is rendered on this page. It displays whatever live records exist in the database tables.</p>
        </section>
      </main>
    </div>
  );
}