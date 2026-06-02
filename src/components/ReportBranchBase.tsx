import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

interface BranchData {
  branch: string;
  ltp: number;
  completed: number;
  rate: number;
  techs: number;
}

interface TechnicianData {
  name: string;
  branch: string;
  ltp: number;
  completed: number;
  rate: number;
}

interface ReportBranchData {
  summary: {
    ltpTotal: number;
    completionRate: number;
    branches: number;
  };
  branches: BranchData[];
  technicians: TechnicianData[];
}

export function ReportBranchBase({ 
  mod, 
  sub, 
  data 
}: { 
  mod: ModuleDef; 
  sub: SubModuleDef; 
  data: ReportBranchData;
}) {
  const [branchFilter, setBranchFilter] = useState("");
  const [sortBy, setSortBy] = useState<"ltp" | "rate">("ltp");

  const filteredBranches = branchFilter
    ? data.branches.filter(b => b.branch === branchFilter)
    : data.branches;

  const filteredTechnicians = branchFilter
    ? data.technicians.filter(t => t.branch === branchFilter)
    : data.technicians;

  const sortedTechnicians = [...filteredTechnicians].sort((a, b) => {
    if (sortBy === "ltp") return b.ltp - a.ltp;
    return b.rate - a.rate;
  });

  const branchChartData = filteredBranches.map(b => ({
    name: b.branch,
    LTP: b.ltp,
    Completed: b.completed,
  }));

  const allBranches = [...new Set(data.branches.map(b => b.branch))];

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-2xl font-bold">{sub.title}</h1>
        </div>

        {/* Filters */}
        <div className="panel mb-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Branch
              </label>
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="glass-input text-sm py-1.5 px-3 rounded-md"
              >
                <option value="">All Branches</option>
                {allBranches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Sort By
              </label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as "ltp" | "rate")}
                className="glass-input text-sm py-1.5 px-3 rounded-md"
              >
                <option value="ltp">LTP Count</option>
                <option value="rate">Completion Rate</option>
              </select>
            </div>
            {branchFilter && (
              <button onClick={() => setBranchFilter("")} className="btn text-sm px-3 mb-0.5">
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          <div className="panel p-4 text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Total LTP</p>
            <p className="text-3xl font-bold text-blue-300">{data.summary.ltpTotal}</p>
          </div>
          <div className="panel p-4 text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
              Completion Rate
            </p>
            <p className="text-3xl font-bold text-green-300">{data.summary.completionRate}%</p>
          </div>
          <div className="panel p-4 text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Branches</p>
            <p className="text-3xl font-bold text-purple-300">{data.summary.branches}</p>
          </div>
        </div>

        {/* Branch Chart */}
        <div className="panel p-4 mb-4">
          <p className="text-sm font-semibold mb-4">Branch Performance</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={branchChartData} margin={{ left: -10 }}>
              <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  background: "#1e293b",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 6,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
              <Bar dataKey="LTP" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Completed" fill="#34d399" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Branch Table */}
        <div className="panel p-0 overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex justify-between">
            <span>Branch Metrics</span>
            <span className="text-xs text-muted-foreground">{filteredBranches.length} branches</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                {["Branch", "LTP", "Completed", "Rate %", "Techs"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2 text-left text-xs text-muted-foreground uppercase"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredBranches.map((b, i) => (
                <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-4 py-2.5 font-medium">{b.branch}</td>
                  <td className="px-4 py-2.5 text-center text-blue-400 font-semibold">{b.ltp}</td>
                  <td className="px-4 py-2.5 text-center text-green-400">{b.completed}</td>
                  <td className="px-4 py-2.5 text-center font-semibold">{b.rate}%</td>
                  <td className="px-4 py-2.5 text-center text-muted-foreground">{b.techs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Technician Table */}
        <div className="panel p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex justify-between">
            <span>Technician Performance</span>
            <span className="text-xs text-muted-foreground">
              {sortedTechnicians.length} technicians
            </span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                {["Technician", "Branch", "LTP", "Completed", "Rate %"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2 text-left text-xs text-muted-foreground uppercase"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedTechnicians.map((t, i) => (
                <tr
                  key={i}
                  className={`border-b border-white/5 hover:bg-white/5 ${
                    i % 2 !== 0 ? "bg-white/[0.02]" : ""
                  }`}
                >
                  <td className="px-4 py-2.5 font-medium">{t.name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">{t.branch}</td>
                  <td className="px-4 py-2.5 text-center text-blue-400 font-semibold">{t.ltp}</td>
                  <td className="px-4 py-2.5 text-center text-green-400">{t.completed}</td>
                  <td className="px-4 py-2.5 text-center font-semibold">{t.rate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
