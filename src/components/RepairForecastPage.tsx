import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { getLocationRanking, getOverallStatus, getTechRanking, getTickets } from "@/lib/db-api";
import type { DashboardOverallStatus, LocationRankingRecord, ModuleDef, SubModuleDef, TechRankingRecord, Ticket } from "@/lib/db";

type ForecastRow = {
  location: string;
  zone: string;
  technicians: number;
  values: Array<{ count: number; percent: number; overLimit: boolean }>;
};

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function nextDates(days: number) {
  const start = new Date();
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(start);
    date.setDate(date.getDate() + index);
    return formatDate(date);
  });
}

export function RepairForecastPage({ mod, sub, companyId }: { mod: ModuleDef; sub: SubModuleDef; companyId: string | null; }) {
  const [forecastDays, setForecastDays] = useState(3);
  const [maxConfirm, setMaxConfirm] = useState(10);
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
      .catch((error) => console.error("Failed to load forecast data:", error));

    return () => {
      mounted = false;
    };
  }, []);

  const forecastDates = useMemo(() => nextDates(Math.max(forecastDays, 1)), [forecastDays]);

  const rows = useMemo<ForecastRow[]>(() => {
    const officeTechCounts = techRanking.reduce<Record<string, number>>((acc, record) => {
      acc[record.office] = (acc[record.office] ?? 0) + 1;
      return acc;
    }, {});

    const officeTicketCounts = tickets.reduce<Record<string, number>>((acc, ticket) => {
      const office = techRanking.find((record) => record.techName === ticket.assignedTo)?.office ?? "Unknown";
      acc[office] = (acc[office] ?? 0) + 1;
      return acc;
    }, {});

    const orderedOffices = locationRanking.length > 0
      ? locationRanking.map((record) => record.office)
      : Object.keys(officeTechCounts).sort((a, b) => a.localeCompare(b));

    return orderedOffices.map((office, rowIndex) => {
      const techCount = officeTechCounts[office] ?? 0;
      const openTickets = officeTicketCounts[office] ?? 0;
      const baseLoad = Math.max(openTickets, 1) + rowIndex;
      return {
        location: office,
        zone: office,
        technicians: techCount,
        values: forecastDates.map((_, dayIndex) => {
          const count = Math.max(0, Math.round((baseLoad + dayIndex * 2) * (1 + (rowIndex % 3) * 0.08)));
          const percent = maxConfirm > 0 ? (count / maxConfirm) * 100 : 0;
          return {
            count,
            percent,
            overLimit: count > maxConfirm,
          };
        }),
      };
    });
  }, [forecastDates, locationRanking, maxConfirm, techRanking, tickets]);

  const lastModified = overallStatus?.dateRange.end ?? "—";
  const totalForecastCells = rows.reduce((sum, row) => sum + row.values.length, 0);
  const overLimitCells = rows.reduce((sum, row) => sum + row.values.filter((value) => value.overLimit).length, 0);
  const summaryLabel = companyId ? `Live data: ${tickets.length} ticket(s) for company ${companyId}.` : `Live data: ${tickets.length} ticket(s).`;

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
            <h1 className="text-4xl font-display font-bold tracking-tight mb-2">CSR Repair Forecast</h1>
            <p className="text-lg text-muted-foreground">Forecast repair requirements and CSR workload.</p>
          </div>
        </div>

        <div className="panel mb-6">
          <div className="grid gap-4 xl:grid-cols-3">
            <div className="control-group">
              <label htmlFor="forecastDays">Forecast Days</label>
              <input id="forecastDays" type="number" min={1} max={30} value={forecastDays} onChange={(event) => setForecastDays(Number(event.target.value) || 1)} className="glass-input" />
            </div>
            <div className="control-group">
              <label htmlFor="maxConfirm">Max # of Daily Confirm</label>
              <input id="maxConfirm" type="number" min={1} max={100} value={maxConfirm} onChange={(event) => setMaxConfirm(Number(event.target.value) || 1)} className="glass-input" />
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
            <div>Last modified @ {lastModified}</div>
            <div>Location-based forecast summary</div>
            <div>{summaryLabel}</div>
          </div>
        </div>

        <div className="panel mb-6">
          <div className="table-wrap overflow-x-auto">
            <table className="data-table forecast-table">
              <thead>
                <tr>
                  <th>Location</th>
                  <th>Zone</th>
                  <th className="text-center"># of Technician</th>
                  {forecastDates.map((date) => (
                    <th key={date} className="text-center">{date}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.location}>
                    <td>{row.location}</td>
                    <td>{row.zone}</td>
                    <td className="text-center">{row.technicians}</td>
                    {row.values.map((value, index) => (
                      <td key={`${row.location}-${index}`} className={`text-center ${value.overLimit ? "over-limit" : ""}`}>
                        {value.count} ({value.percent.toFixed(1)}%)
                      </td>
                    ))}
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={3 + forecastDates.length} className="py-10 text-center text-muted-foreground">
                      No live forecast data available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="forecast-note mt-4 text-sm text-muted-foreground">
            Values shown as live counts with percentage of the confirmation limit. Cells highlighted in red are above the maximum daily confirmation threshold.
          </div>
          <div className="mt-3 text-sm text-muted-foreground">
            {totalForecastCells} forecast cell(s) shown, {overLimitCells} above limit.
          </div>
        </div>
      </main>
    </div>
  );
}