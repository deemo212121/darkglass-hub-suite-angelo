import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Search } from "lucide-react";
import { getLocationRanking, getOverallStatus, getTechRanking, getTickets } from "@/lib/db-api";
import type { DashboardOverallStatus, LocationRankingRecord, ModuleDef, SubModuleDef, TechRankingRecord, Ticket } from "@/lib/db";
import { WORK_MAP_LOCATIONS, mergeLocationOptions } from "@/lib/locations";

type ActivityRow = {
  user: string;
  office: string;
  schedule: number;
  reschedule: number;
  cancel: number;
  callAttempt: number;
  csrUpdate: number;
  infoUpdate: number;
  completed: number;
  acknowledge: number;
  claimRequested: number;
  triageSupport: number;
  total: number;
};

function formatDate(date: Date) {
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}/${date.getFullYear()}`;
}

function buildActivityRow(techName: string, office: string, tickets: Ticket[]): ActivityRow {
  const schedule = tickets.filter((ticket) => ticket.status === "open").length;
  const reschedule = tickets.filter((ticket) => ticket.status === "in-progress").length;
  const completed = tickets.filter((ticket) => ticket.status === "resolved" || ticket.status === "closed").length;
  const callAttempt = tickets.filter((ticket) => ticket.priority === "high" || ticket.priority === "critical").length;
  const csrUpdate = tickets.filter((ticket) => ticket.status === "in-progress").length;
  const infoUpdate = tickets.filter((ticket) => ticket.status === "open").length;
  const acknowledge = tickets.filter((ticket) => ticket.status === "closed").length;
  const claimRequested = tickets.filter((ticket) => ticket.status === "resolved").length;
  const triageSupport = tickets.filter((ticket) => ticket.priority === "critical" && ticket.status !== "closed").length;
  const cancel = Math.max(tickets.length - (schedule + reschedule + completed), 0);

  return {
    user: techName,
    office,
    schedule,
    reschedule,
    cancel,
    callAttempt,
    csrUpdate,
    infoUpdate,
    completed,
    acknowledge,
    claimRequested,
    triageSupport,
    total: tickets.length,
  };
}

export function DailyActivityPage({ mod, sub, companyId }: { mod: ModuleDef; sub: SubModuleDef; companyId: string | null; }) {
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("ALL");
  const [workDate, setWorkDate] = useState(formatDate(new Date()));
  const [autoRefresh, setAutoRefresh] = useState("1");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [techRanking, setTechRanking] = useState<TechRankingRecord[]>([]);
  const [locationRanking, setLocationRanking] = useState<LocationRankingRecord[]>([]);
  const [overallStatus, setOverallStatus] = useState<DashboardOverallStatus | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    Promise.all([getTickets(), getTechRanking(), getLocationRanking(), getOverallStatus()])
      .then(([nextTickets, nextTechRanking, nextLocationRanking, nextOverallStatus]) => {
        if (!mounted) return;
        setTickets(nextTickets);
        setTechRanking(nextTechRanking);
        setLocationRanking(nextLocationRanking);
        setOverallStatus(nextOverallStatus[0]);
      })
      .catch((error) => console.error("Failed to load daily activity data:", error));

    return () => {
      mounted = false;
    };
  }, []);

  const offices = useMemo(() => {
    const officeSet = new Set<string>();
    locationRanking.forEach((record) => officeSet.add(record.office));
    techRanking.forEach((record) => officeSet.add(record.office));
    return mergeLocationOptions(["ALL"], WORK_MAP_LOCATIONS, Array.from(officeSet).sort((a, b) => a.localeCompare(b)));
  }, [locationRanking, techRanking]);

  const rows = useMemo<ActivityRow[]>(() => {
    const techOffice = new Map(techRanking.map((record) => [record.techName, record.office]));
    const grouped = new Map<string, Ticket[]>();

    tickets.forEach((ticket) => {
      const officeName = techOffice.get(ticket.assignedTo) ?? "Unknown";
      if (location !== "ALL" && officeName !== location) return;
      if (!grouped.has(ticket.assignedTo)) grouped.set(ticket.assignedTo, []);
      grouped.get(ticket.assignedTo)!.push(ticket);
    });

    const orderedNames = techRanking.map((record) => record.techName).filter((name) => grouped.has(name));
    const extraNames = Array.from(grouped.keys()).filter((name) => !orderedNames.includes(name)).sort((a, b) => a.localeCompare(b));

    return [...orderedNames, ...extraNames].map((techName) => {
      const office = techOffice.get(techName) ?? "Unknown";
      return buildActivityRow(techName, office, grouped.get(techName) ?? []);
    });
  }, [location, techRanking, tickets]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (!term) return true;
      return [row.user, row.office].join(" ").toLowerCase().includes(term);
    });
  }, [rows, search]);

  const liveSummary = companyId ? `Live data: ${tickets.length} ticket(s) for company ${companyId}.` : `Live data: ${tickets.length} ticket(s).`;
  const totalToDo = tickets.filter((ticket) => ticket.status === "open" || ticket.status === "in-progress").length;
  const lastModified = overallStatus?.dateRange.end ?? "—";

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-6">
            <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
              <ChevronLeft className="h-4 w-4" /> {mod.label}
            </Link>
          </div>
          <div>
            <h1 className="text-4xl font-display font-bold tracking-tight mb-2">Daily Activity Report</h1>
            <p className="text-lg text-muted-foreground">Review daily operational activities summary.</p>
          </div>
        </div>

        <div className="panel mb-6">
          <div className="grid gap-4 xl:grid-cols-3">
            <div className="control-group">
              <label htmlFor="location">Location</label>
              <select id="location" value={location} onChange={(event) => setLocation(event.target.value)} className="glass-input">
                {offices.map((office) => (
                  <option key={office} value={office}>{office === "ALL" ? "All Locations" : office}</option>
                ))}
              </select>
            </div>
            <div className="control-group">
              <label htmlFor="workDate">Work Date</label>
              <input id="workDate" type="date" value={workDate} onChange={(event) => setWorkDate(event.target.value)} className="glass-input" />
            </div>
            <div className="control-group">
              <label htmlFor="autoRefresh">Auto Refresh</label>
              <select id="autoRefresh" value={autoRefresh} onChange={(event) => setAutoRefresh(event.target.value)} className="glass-input">
                <option value="1">Every 1 minute(s)</option>
                <option value="5">Every 5 minute(s)</option>
                <option value="10">Every 10 minute(s)</option>
                <option value="0">Off</option>
              </select>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-4 text-sm text-muted-foreground">
            <div>Work Date: {workDate}</div>
            <div>Technician activity derived from live ticket records</div>
            <div>Last modified @ {lastModified}</div>
            <div>{liveSummary}</div>
          </div>

          <div className="mt-4">
            <label className="relative block max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="searchInput"
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="search in result"
                className="glass-input pl-9"
              />
            </label>
            <div className="results-count mt-2 text-sm text-muted-foreground">
              Showing {filteredRows.length} of {rows.length} records
            </div>
          </div>
        </div>

        <div className="panel mb-6">
          <div className="table-wrap overflow-x-auto">
            <table className="data-table report-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Office</th>
                  <th>* SCHEDULE</th>
                  <th>RESCHEDULE</th>
                  <th>CANCEL</th>
                  <th>CALL ATTEMPT</th>
                  <th>CSR UPDATE</th>
                  <th>INFO. UPDATE</th>
                  <th>COMPLETED</th>
                  <th>ACKNOWLEDGE</th>
                  <th>CLAIM REQUESTED</th>
                  <th>TRIAGE SUPPORT</th>
                  <th>TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={`${row.user}-${row.office}`}>
                    <td>{row.user}</td>
                    <td>{row.office}</td>
                    <td>{row.schedule}</td>
                    <td>{row.reschedule}</td>
                    <td>{row.cancel}</td>
                    <td>{row.callAttempt}</td>
                    <td>{row.csrUpdate}</td>
                    <td>{row.infoUpdate}</td>
                    <td>{row.completed}</td>
                    <td>{row.acknowledge}</td>
                    <td>{row.claimRequested}</td>
                    <td>{row.triageSupport}</td>
                    <td>{row.total}</td>
                  </tr>
                ))}
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={13} className="py-10 text-center text-muted-foreground">
                      No live activity records available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel mb-6">
          <div className="text-sm text-muted-foreground">TOTAL # of TICKETS TO DO: {totalToDo}</div>
        </div>
      </main>
    </div>
  );
}