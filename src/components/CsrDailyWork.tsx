import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, RefreshCw, Users, BarChart3, Search } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  XAxis,
  YAxis,
} from "recharts";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { formatCsrCell, loadCsrWorkbook, type CsrWorkbookBlock, type CsrWorkbookSheet } from "@/lib/csr-workbook";
import {
  ChartContainer,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

function useCsrWorkbook() {
  const [sheetData, setSheetData] = useState<CsrWorkbookSheet[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setStatus("loading");

    loadCsrWorkbook()
      .then((workbook) => {
        if (!active) return;
        setSheetData(workbook.sheets);
        setStatus("ready");
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load workbook");
        setStatus("error");
      });

    return () => {
      active = false;
    };
  }, []);

  return { sheetData, status, error };
}

function SummaryCard({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof Users }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 shadow-[0_12px_30px_rgba(0,0,0,0.12)] backdrop-blur-md">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-white/55">{label}</p>
          <p className="text-lg font-bold text-white">{value}</p>
        </div>
      </div>
    </div>
  );
}

function TableBlock({ block, search }: { block: CsrWorkbookBlock; search: string }) {
  const rows = search ? block.rows.filter((row) => row.searchText.includes(search.toLowerCase())) : block.rows;

  if (rows.length === 0) return null;

  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-[0_18px_40px_rgba(0,0,0,0.16)] backdrop-blur-md">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-white/55">Team</p>
          <h2 className="text-xl font-bold text-white">{block.teamName}</h2>
          <p className="mt-1 text-sm text-white/60">
            {block.totals.rows} members • Schedule {block.totals.schedule.toLocaleString()} • Attempt {block.totals.attempt.toLocaleString()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-medium text-white/75">
          <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1">Update {block.totals.update.toLocaleString()}</span>
          <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1">Mistakes {block.totals.mistakeCount}</span>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-white/60">#</th>
              {block.columns.map((column) => (
                <th key={`${block.teamName}-${column.index}`} className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-white/60 whitespace-nowrap">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`${block.teamName}-${rowIndex}`} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-3 py-2.5 text-white/55">{rowIndex + 1}</td>
                {block.columns.map((column) => (
                  <td key={`${block.teamName}-${rowIndex}-${column.index}`} className="px-3 py-2.5 text-white/85 whitespace-nowrap">
                    {formatCsrCell(row.values[block.columns.findIndex((candidate) => candidate.index === column.index)])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const chartConfig = {
  schedule: {
    label: "Schedule",
    color: "hsl(210 90% 62%)",
  },
  attempt: {
    label: "Attempt",
    color: "hsl(151 55% 54%)",
  },
  update: {
    label: "Update",
    color: "hsl(33 95% 57%)",
  },
} as const;

export function CsrDailyWork({ mod, sub }: Props) {
  const { sheetData, status, error } = useCsrWorkbook();
  const [sheetName, setSheetName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [search, setSearch] = useState("");
  const hasInitializedTeam = useRef(false);

  useEffect(() => {
    if (!sheetName && sheetData.length > 0) {
      setSheetName(sheetData[0].sheetName);
    }
  }, [sheetData, sheetName]);

  const activeSheet = useMemo(
    () => sheetData.find((sheet) => sheet.sheetName === sheetName) ?? sheetData[0] ?? null,
    [sheetData, sheetName],
  );

  const teamOptions = useMemo(() => activeSheet?.blocks.map((block) => block.teamName) ?? [], [activeSheet]);

  useEffect(() => {
    if (!activeSheet) return;
    if (teamName && !teamOptions.includes(teamName)) {
      setTeamName(teamOptions[0] ?? "");
      return;
    }
    if (!hasInitializedTeam.current && !teamName && teamOptions.length > 0) {
      hasInitializedTeam.current = true;
      setTeamName(teamOptions[0] ?? "");
    }
  }, [activeSheet, teamName, teamOptions]);

  const visibleBlocks = useMemo(() => {
    if (!activeSheet) return [];
    const searchValue = search.toLowerCase();
    return activeSheet.blocks.filter((block) => {
      if (teamName && block.teamName !== teamName) return false;
      if (!searchValue) return true;
      return block.teamName.toLowerCase().includes(searchValue) || block.rows.some((row) => row.searchText.includes(searchValue));
    });
  }, [activeSheet, search, teamName]);

  const summary = useMemo(() => {
    const rows = visibleBlocks.flatMap((block) => block.rows);
    return {
      teams: visibleBlocks.length,
      members: rows.length,
      schedule: visibleBlocks.reduce((sum, block) => sum + block.totals.schedule, 0),
      attempt: visibleBlocks.reduce((sum, block) => sum + block.totals.attempt, 0),
      update: visibleBlocks.reduce((sum, block) => sum + block.totals.update, 0),
    };
  }, [visibleBlocks]);

  const chartData = useMemo(
    () =>
      (activeSheet?.blocks ?? []).map((block) => ({
        team: block.teamName,
        schedule: block.totals.schedule,
        attempt: block.totals.attempt,
        update: block.totals.update,
        mistakes: block.totals.mistakeCount,
      })),
    [activeSheet],
  );

  if (status === "loading") {
    return (
      <main className="max-w-350 mx-auto px-4 py-6">
        <div className="panel text-center py-16 text-muted-foreground">Loading CSR workbook…</div>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="max-w-350 mx-auto px-4 py-6">
        <div className="panel text-center py-16 text-red-300">{error}</div>
      </main>
    );
  }

  const sheetLabel = activeSheet ? `${activeSheet.label} (${activeSheet.sheetName})` : "Workbook";

  return (
    <main className="max-w-350 mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">Report</Link><span>›</span>
        <span className="text-foreground font-medium">CSR Team Report</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn"><ChevronLeft className="h-4 w-4" /></Link>
        <div>
          <h1 className="text-xl font-bold">CSR Team Report</h1>
          <p className="text-sm text-muted-foreground">Workbook view for {sheetLabel}</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
        <SummaryCard label="Teams" value={summary.teams} icon={Users} />
        <SummaryCard label="Members" value={summary.members} icon={BarChart3} />
        <SummaryCard label="Schedule" value={summary.schedule.toLocaleString()} icon={BarChart3} />
        <SummaryCard label="Update" value={summary.update.toLocaleString()} icon={BarChart3} />
      </div>

      <section className="panel space-y-4 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Comparison chart</p>
            <h2 className="text-lg font-bold">Team performance overview</h2>
            <p className="text-sm text-muted-foreground">
              Schedule, attempt, and update totals for every team in the selected date sheet.
            </p>
          </div>
          <div className="rounded-full border border-border/60 bg-background/60 px-3 py-1 text-xs text-muted-foreground">
            {chartData.length} team{chartData.length === 1 ? "" : "s"}
          </div>
        </div>

        {chartData.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 px-4 py-12 text-center text-sm text-muted-foreground">
            No chart data available for the current filters.
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[360px] w-full">
            <BarChart data={chartData} margin={{ left: 0, right: 12, top: 8, bottom: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="team" tickLine={false} axisLine={false} tickMargin={10} />
              <YAxis tickLine={false} axisLine={false} width={44} />
              <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
              <Legend content={<ChartLegendContent />} />
              <Bar dataKey="schedule" fill="var(--color-schedule)" radius={[6, 6, 0, 0]} />
              <Bar dataKey="attempt" fill="var(--color-attempt)" radius={[6, 6, 0, 0]} />
              <Bar dataKey="update" fill="var(--color-update)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </section>

      <div className="panel space-y-4">
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="space-y-1.5">
            <label htmlFor="csr-sheet" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Date Sheet</label>
            <select id="csr-sheet" value={sheetName} onChange={(event) => setSheetName(event.target.value)} className="glass-input w-full rounded-md px-3 py-2 text-sm">
              {sheetData.map((sheet) => (
                <option key={sheet.sheetName} value={sheet.sheetName}>
                  {sheet.label} ({sheet.sheetName})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="csr-team" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Team</label>
            <select id="csr-team" value={teamName} onChange={(event) => setTeamName(event.target.value)} className="glass-input w-full rounded-md px-3 py-2 text-sm">
              <option value="">All teams</option>
              {teamOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="csr-search" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Search</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="csr-search"
                type="search"
                placeholder="Search team or member"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="glass-input w-full rounded-md py-2 pl-9 pr-3 text-sm"
              />
            </div>
          </div>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setTeamName("");
              if (sheetData[0]) setSheetName(sheetData[0].sheetName);
            }}
            className="btn btn-primary flex items-center gap-2 px-5"
          >
            <RefreshCw className="h-3.5 w-3.5" />Reset filters
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {visibleBlocks.length === 0 ? (
          <div className="panel py-16 text-center text-muted-foreground">No team rows match the current filters.</div>
        ) : (
          visibleBlocks.map((block) => <TableBlock key={block.teamName} block={block} search={search} />)
        )}
      </div>
    </main>
  );
}
