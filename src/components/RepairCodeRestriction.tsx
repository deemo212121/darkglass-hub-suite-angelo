import { useState } from "react";
import { ChevronLeft, Search } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

interface Props { mod: ModuleDef; sub: SubModuleDef; }
const RESTRICTIONS = ["No Restriction","Should have part","Should not have any part"];
const BASE_ROWS = [
  {code:102,desc:"SW,PRL,OTSL RESET",needPart:"Should not have any part"},
  {code:103,desc:"UPGRADED PRL",needPart:"Should not have any part"},
  {code:104,desc:"UPGRADE S/W VERSION",needPart:"Should not have any part"},
  {code:105,desc:"RESET OTSL",needPart:"Should not have any part"},
  {code:106,desc:"QC PASSED",needPart:"Should not have any part"},
  {code:107,desc:"BATTERY TESTED",needPart:"Should not have any part"},
  {code:108,desc:"REFURB REPAIR COMPLETE",needPart:"No Restriction"},
  {code:110,desc:"PHONE RESET - CLEAR TOOL",needPart:"Should not have any part"},
  {code:111,desc:"RF COMPLIANCE/CALIBRATION TEST PASSED",needPart:"Should not have any part"},
  {code:112,desc:"COMPLIANCE TEST FAILED",needPart:"Should not have any part"},
  {code:114,desc:"UPGRADED HARDWARE",needPart:"Should not have any part"},
  {code:115,desc:"PASS EXTENDED TEST",needPart:"Should not have any part"},
  {code:122,desc:"ECR WTDECR-001 (2&3) 1000 STD",needPart:"Should not have any part"},
  {code:131,desc:"CDPD TEST S/W",needPart:"Should not have any part"},
  {code:132,desc:"FINAL DATA ENTRY",needPart:"Should not have any part"},
  {code:19,desc:"CLEAN",needPart:"Should not have any part"},
  {code:202,desc:"FULL SW UPGRADE/PHONE RESET",needPart:"Should not have any part"},
  {code:203,desc:"REPLACED BATTERY",needPart:"Should have part"},
  {code:204,desc:"REPLACED SCREEN",needPart:"Should have part"},
  {code:205,desc:"REPLACED BACK COVER",needPart:"Should have part"},
];

export function RepairCodeRestriction({ mod, sub }: Props) {
  const [rows, setRows] = useState(BASE_ROWS);
  const [search, setSearch] = useState("");
  const filtered = rows.filter(r=>
    !search || r.code.toString().includes(search) || r.desc.toLowerCase().includes(search.toLowerCase())
  );
  const updateRow = (code: number, val: string) =>
    setRows(prev => prev.map(r => r.code===code ? {...r, needPart:val} : r));

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{module:mod.slug}} className="hover:text-foreground">Claim</Link><span>›</span>
        <span className="text-foreground font-medium">Repair Code Restriction</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{module:mod.slug}} className="btn"><ChevronLeft className="h-4 w-4"/></Link>
        <h1 className="text-xl font-bold">Repair Code Restriction</h1>
      </div>
      <div className="panel p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span className="text-sm text-muted-foreground"><span className="text-foreground font-medium">{filtered.length}</span> records found</span>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"/>
            <input type="text" value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="search in result" className="glass-input text-sm py-1.5 pl-8 pr-3 rounded-md w-44"/>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-700/80">
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-200 w-32">Repair Code</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-200">Description</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-200 w-64">Need Part</th>
          </tr></thead>
          <tbody>
            {filtered.map((r,idx)=>(
              <tr key={r.code} className={`border-b border-white/5 hover:bg-white/5 ${idx%2!==0?"bg-white/2":""}`}>
                <td className="px-4 py-2.5 font-mono font-medium">{r.code}</td>
                <td className="px-4 py-2.5">{r.desc}</td>
                <td className="px-4 py-2.5">
                  <select value={r.needPart} onChange={e=>updateRow(r.code,e.target.value)}
                    aria-label={`Need part for ${r.code}`}
                    className="glass-input text-sm py-1 px-2 rounded w-full">
                    {RESTRICTIONS.map(opt=><option key={opt}>{opt}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
