import { useState, useMemo } from "react";
import { ChevronLeft, RefreshCw } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { SERVICE_TYPES_SS, todayStr } from "./shared";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const COLS = ["Manager","Technician","New","Pending","Confirm","Ready 2 Complete","Waiting 4 Cancel","Total","Confirm Ratio (%)"];

const MANAGER_TECH_MAP: Record<string, string[]> = {
  "": ["Nashville Admin"],
  "Alexxis Henry": ["Damon Ottley","Marc James"],
  "Annan Odongo": ["Nathan Wagner"],
  "Brandon Phillips": ["Christian Clark","Gabriel Talley","Jaylon Yarbrough"],
  "Brya'shawn Butler": ["Andres Mota","Jordan Davis","Josh Malloch","Justin Alvarez"],
  "Chris Simpson": ["Edward Lindsey","Zachary Gonzalez"],
  "Danny Thornton": ["Andre Riddle","Cole Mushinsky","Cooper Shaffett","Corey Cage","Darius Brown","Jonathan Knox","Joseph Wease","Kurt Merckel","Lashamus Dowell","Mikkel Brown","Nocona Detten"],
};

function genRow(mgr: string, tech: string, i: number) {
  const pending = (i * 7) % 20;
  const confirm = 3 + (i * 5) % 15;
  const r2c = i % 4 === 0 ? 1 + (i%3) : 0;
  const w4c = 0;
  const newT = i % 6 === 0 ? 8 : 0;
  const total = pending + confirm + r2c + w4c + newT;
  const ratio = total > 0 ? +((confirm / total) * 100).toFixed(1) : 0;
  return { manager: mgr, tech, new: newT, pending, confirm, r2c, w4c, total, ratio };
}

function generateRows() {
  const rows: ReturnType<typeof genRow>[] = [];
  let i = 0;
  Object.entries(MANAGER_TECH_MAP).forEach(([mgr, techs]) => {
    techs.forEach(tech => { rows.push(genRow(mgr, tech, i++)); });
  });
  return rows;
}
const ALL_ROWS = generateRows();

export function OpenTicketSummary({ mod, sub }: Props) {
  const [ssFilterEnabled, setSsFilterEnabled] = useState(false);
  const [selectedSS, setSelectedSS] = useState<string[]>([...SERVICE_TYPES_SS]);
  const [search, setSearch] = useState("");
  const [visibleCols, setVisibleCols] = useState<string[]>([...COLS.filter(c => c !== "TechUserId")]);
  const [showColMenu, setShowColMenu] = useState(false);

  const filtered = useMemo(() => search
    ? ALL_ROWS.filter(r => [r.manager, r.tech].some(v => v.toLowerCase().includes(search.toLowerCase())))
    : ALL_ROWS, [search]);

  const toggleCol = (c: string) => setVisibleCols(p => p.includes(c) ? p.filter(x=>x!==c) : [...p,c]);

  // Group rows so manager cell spans correctly
  const grouped: { manager: string; rows: typeof ALL_ROWS }[] = [];
  filtered.forEach(r => {
    const last = grouped[grouped.length - 1];
    if (last && last.manager === r.manager) last.rows.push(r);
    else grouped.push({ manager: r.manager, rows: [r] });
  });

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">Report</Link><span>›</span>
        <span className="text-foreground font-medium">Open Ticket Summary</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn"><ChevronLeft className="h-4 w-4" /></Link>
        <h1 className="text-xl font-bold">Open Ticket Summary</h1>
      </div>

      <div className="panel mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Report Date</span>
          <span className="text-sm font-medium">{todayStr()}</span>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer ml-4">
            <input type="checkbox" checked={ssFilterEnabled} onChange={e=>setSsFilterEnabled(e.target.checked)} className="accent-blue-500" title="Service Type (SS) filter" />
            Service Type (SS)
          </label>
          {ssFilterEnabled && (
            <div className="text-xs text-muted-foreground truncate max-w-xs">
              {SERVICE_TYPES_SS.join(", ")}
            </div>
          )}
          <div className="flex-1" />
          <button className="btn btn-primary flex items-center gap-2 px-5">
            <RefreshCw className="h-3.5 w-3.5" />Refresh
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-muted-foreground"><span className="text-foreground font-medium">{filtered.length}</span> records found</span>
        <div className="flex items-center gap-2 relative">
          <label htmlFor="ots-search" className="sr-only">Search results</label>
          <input id="ots-search" type="search" placeholder="search in result…" value={search} onChange={e=>setSearch(e.target.value)} title="Search results" className="glass-input text-sm py-1.5 px-3 rounded-md w-44" />
          <button onClick={() => setShowColMenu(m=>!m)} title="Column visibility" aria-label="Column visibility" className="btn p-1.5">⚙</button>
          {showColMenu && (
            <div className="absolute z-50 top-full right-0 mt-1 w-52 rounded-md border border-white/15 bg-(--color-surface) shadow-xl p-2">
              {[...COLS,"TechUserId"].map(c => (
                <label key={c} className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-white/5 cursor-pointer rounded">
                  <input type="checkbox" checked={visibleCols.includes(c)} onChange={()=>toggleCol(c)} className="accent-blue-500" title={c} />
                  {c}
                </label>
              ))}
              <div className="flex gap-2 mt-2 px-2">
                <button onClick={()=>setShowColMenu(false)} className="btn btn-primary text-xs px-3 py-1">Apply</button>
                <button onClick={()=>setShowColMenu(false)} className="btn text-xs px-3 py-1">Save</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="panel overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-700/80">
              {COLS.filter(c=>visibleCols.includes(c)).map(h => (
                <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-slate-200 whitespace-nowrap border-r border-white/10 last:border-r-0">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grouped.map(group =>
              group.rows.map((r, ri) => (
                <tr key={`${r.manager}-${r.tech}`} className={`border-b border-white/5 hover:bg-white/5 ${group.manager !== "" && ri % 2 !== 0 ? "bg-white/2" : ""}`}>
                  {visibleCols.includes("Manager") && ri === 0 ? (
                    <td rowSpan={group.rows.length} className="px-3 py-2.5 font-medium text-center border-r border-white/10 align-middle">
                      {group.manager}
                    </td>
                  ) : visibleCols.includes("Manager") && ri > 0 ? null : null}
                  {visibleCols.includes("Technician") && <td className="px-3 py-2.5">{r.tech}</td>}
                  {visibleCols.includes("New") && <td className={`px-3 py-2.5 text-right ${r.new>0?"text-blue-400 font-medium":""}`}>{r.new}</td>}
                  {visibleCols.includes("Pending") && <td className={`px-3 py-2.5 text-right ${r.pending>0?"text-blue-400 font-medium":""}`}>{r.pending}</td>}
                  {visibleCols.includes("Confirm") && <td className={`px-3 py-2.5 text-right ${r.confirm>0?"text-blue-400 font-medium":""}`}>{r.confirm}</td>}
                  {visibleCols.includes("Ready 2 Complete") && <td className={`px-3 py-2.5 text-right ${r.r2c>0?"text-blue-400 font-medium":""}`}>{r.r2c}</td>}
                  {visibleCols.includes("Waiting 4 Cancel") && <td className="px-3 py-2.5 text-right">{r.w4c}</td>}
                  {visibleCols.includes("Total") && <td className={`px-3 py-2.5 text-right font-medium ${r.total>0?"text-blue-400":""}`}>{r.total}</td>}
                  {visibleCols.includes("Confirm Ratio (%)") && <td className="px-3 py-2.5 text-right">{r.ratio > 0 ? r.ratio : ""}</td>}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
