import { useState, useMemo } from "react";
import { ChevronLeft, RefreshCw } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { USER_TYPES, todayStr } from "@/components/shared";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const COLS = ["ID","Login Name","User Name","User Type","Login in 1Year~4W","Login in 4W~3W","Login in 3W~2W","Login in 2W~1W","Login in 1W"];

function generateRows(count = 178) {
  const names = [
    "Jeff.Lucas","Geneva.Calomarde","Johnathan.Allen","ERIC.GUZMAN","Cameron.Forrest",
    "Damon.Ottley","Darion.Lewis","AnaJessa.Vito","Jonathon.Allen","Dominic.Holman",
    "JohnOliver.Degamo","Alex.Myles","Danny.Thorton","Dustin.Earls","Nathan.Napora",
    "Matt.Simmons","Troy.Willis","Corey.Cage","Amanda.Simmons","Leo.Sun",
    "Alexy.Rayos","Percy.Smith","WincelFranz.Carusca","James.Houston","Lloyd.Tombiga",
  ];
  const types = ["Technician","CSR","Part Manager","Tech Manager","Admin","Claim Manager","Manager","Superuser"];
  const fullNames = names.map(n => n.replace("."," "));
  return Array.from({ length: count }, (_, i) => ({
    id: 16 + (i * 13) % 530,
    loginName: names[i % names.length],
    userName: fullNames[i % fullNames.length],
    userType: types[i % types.length],
    login1y4w: (i * 137) % 3800,
    login4w3w: 15 + (i * 37) % 450,
    login3w2w: 5 + (i * 11) % 200,
    login2w1w: (i * 7) % 140,
    login1w: 3 + (i * 9) % 100,
  }));
}
const ALL_ROWS = generateRows(178);

export function LoginStatistics({ mod, sub }: Props) {
  const [reportDate] = useState(todayStr());
  const [search, setSearch] = useState("");
  const [visibleCols, setVisibleCols] = useState<string[]>([...COLS]);
  const [showColMenu, setShowColMenu] = useState(false);

  const filtered = useMemo(() =>
    search ? ALL_ROWS.filter(r => [r.loginName, r.userName, r.userType].some(v => v.toLowerCase().includes(search.toLowerCase()))) : ALL_ROWS,
    [search]
  );

  const toggleCol = (col: string) => setVisibleCols(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]);

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">Report</Link><span>›</span>
        <span className="text-foreground font-medium">Login Statistics</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn"><ChevronLeft className="h-4 w-4" /></Link>
        <h1 className="text-xl font-bold">Login Statistics</h1>
      </div>

      <div className="panel panel-filter mb-5">
        <div className="flex items-center gap-4">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Report Date</span>
          <span className="text-sm font-medium">{reportDate}</span>
          <div className="flex-1" />
          
        </div>
      </div>

      <div className="flex items-center justify-between mb-2">
        <span className="text-sm"><span className="text-blue-400 font-bold">{filtered.length}</span> <span className="text-muted-foreground">records found</span></span>
        <div className="flex items-center gap-2 relative">
          <label htmlFor="ls-search" className="sr-only">Search results</label>
          <input id="ls-search" type="search" placeholder="search in result…" value={search} onChange={e => setSearch(e.target.value)} title="Search results" className="glass-input text-sm py-1.5 px-3 rounded-md w-44" />
          <button onClick={() => setShowColMenu(m => !m)} title="Column visibility" aria-label="Column visibility" className="btn p-1.5">⚙</button>
          {showColMenu && (
            <div className="absolute z-[99999] top-full right-0 mt-1 w-52 rounded-md border border-white/15 bg-(--color-surface) shadow-xl p-2" style={{background:"rgb(22,28,52)",border:"1px solid rgba(255,255,255,0.15)"}}>
              {COLS.map(c => (
                <label key={c} className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-white/5 cursor-pointer rounded">
                  <input type="checkbox" checked={visibleCols.includes(c)} onChange={() => toggleCol(c)} className="accent-blue-500" title={c} />
                  {c}
                </label>
              ))}
              <div className="flex gap-2 mt-2 px-2">
                <button onClick={() => { setVisibleCols([...COLS]); setShowColMenu(false); }} className="btn btn-primary text-xs px-3 py-1">Apply</button>
                <button onClick={() => setShowColMenu(false)} className="btn text-xs px-3 py-1">Save</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="panel overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-700/80">
              {COLS.filter(c => visibleCols.includes(c)).map(h => (
                <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-slate-200 whitespace-nowrap border-r border-white/10 last:border-r-0">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, idx) => (
              <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${idx % 2 !== 0 ? "bg-white/2" : ""}`}>
                {visibleCols.includes("ID") && <td className="px-3 py-2">{r.id}</td>}
                {visibleCols.includes("Login Name") && <td className="px-3 py-2 text-blue-400 font-mono text-xs">{r.loginName}</td>}
                {visibleCols.includes("User Name") && <td className="px-3 py-2">{r.userName}</td>}
                {visibleCols.includes("User Type") && <td className="px-3 py-2 text-muted-foreground text-xs">{r.userType}</td>}
                {visibleCols.includes("Login in 1Year~4W") && <td className="px-3 py-2 text-right">{r.login1y4w.toLocaleString()}</td>}
                {visibleCols.includes("Login in 4W~3W") && <td className="px-3 py-2 text-right">{r.login4w3w}</td>}
                {visibleCols.includes("Login in 3W~2W") && <td className="px-3 py-2 text-right">{r.login3w2w}</td>}
                {visibleCols.includes("Login in 2W~1W") && <td className="px-3 py-2 text-right">{r.login2w1w}</td>}
                {visibleCols.includes("Login in 1W") && <td className="px-3 py-2 text-right">{r.login1w}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
