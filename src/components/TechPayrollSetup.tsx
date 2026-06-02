import { useState } from "react";
import { ChevronLeft, ChevronRight, Save, Plus, Trash2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const PRODUCT_TYPES = ["Access Newwork Terminal","ACN Others","ACN Parts","Air Dresser","Air Purifier","Ashing Machine","Audio Others","Audio Parts","Audio System for Home Theater System","B/W TV","Blu Ray PLAYER","Blu-ray DVD Combo","Cable","CAL","CAM Parts","Camera & Camcorder","Car Audio"];
const BRANCHES = ["[All]","Asheville","Atlanta","Birmingham","Dallas"];
const COLS = ["Default Amount","2 Man Job","Back Tub","Major Repair","Panel 60 Over","Panel 80 Over","Sealed System","Sealed System(R600)","Seal with Trainee","Sealed System Follow Up","Stacked Unit(Washer Only)","Wall Oven"];

export function TechPayrollSetup({ mod, sub }: Props) {
  const [tab, setTab] = useState<"amount"|"date"|"tier">("amount");
  const [year, setYear] = useState(2026);
  const [amountRows] = useState<any[]>([]);
  const [dateRows] = useState<any[]>([]);
  const [tierRows, setTierRows] = useState<{id:number;name:string;rate:string}[]>([]);
  const [newTierName, setNewTierName] = useState("");
  const [newTierRate, setNewTierRate] = useState("");
  const [search, setSearch] = useState("");

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{module:mod.slug}} className="hover:text-foreground">Claim</Link><span>›</span>
        <span className="text-foreground font-medium">Tech Payroll Setup</span>
      </div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <Link to="/m/$module" params={{module:mod.slug}} className="btn"><ChevronLeft className="h-4 w-4"/></Link>
          <h1 className="text-xl font-bold">Tech Payroll Setup</h1>
        </div>
        <button className="btn flex items-center gap-2 px-4"><Save className="h-3.5 w-3.5"/>Save</button>
      </div>

      <div className="flex items-center gap-2 mb-5">
        {(["amount","date","tier"] as const).map(t=>(
          <button key={t} onClick={()=>setTab(t)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab===t?"bg-blue-600 text-white":"btn"}`}>
            {t==="amount"?"Payroll Amount":t==="date"?"Payroll Date":"Payroll Tier"}
          </button>
        ))}
      </div>

      {tab==="amount" && (
        <div className="panel p-0 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <span className="text-sm text-muted-foreground"><span className="text-foreground font-medium">0</span> record found</span>
            <input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder="search in result"
              className="glass-input text-sm py-1.5 px-3 rounded-md w-40"/>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-700/80">
                <th className="px-3 py-3 text-xs font-semibold text-slate-200 text-left">Product Type</th>
                <th className="px-3 py-3 text-xs font-semibold text-slate-200 text-left">Branch</th>
                {COLS.map(c=><th key={c} className="px-3 py-3 text-xs font-semibold text-slate-200 text-left whitespace-nowrap">{c}</th>)}
                <th className="px-3 py-3 text-xs font-semibold text-slate-200 text-left">Actions</th>
              </tr></thead>
              <tbody>
                <tr className="border-b border-white/5">
                  <td className="px-3 py-2">
                    <select aria-label="Product type" className="glass-input text-xs py-1 px-2 rounded w-36">
                      {PRODUCT_TYPES.map(p=><option key={p}>{p}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select aria-label="Branch" className="glass-input text-xs py-1 px-2 rounded w-20">
                      {BRANCHES.map(b=><option key={b}>{b}</option>)}
                    </select>
                  </td>
                  {COLS.map(c=><td key={c} className="px-3 py-2"><input type="text" className="glass-input text-xs py-1 px-2 rounded w-20 border-dashed" placeholder=""/></td>)}
                  <td className="px-3 py-2"><button className="text-blue-400 text-xs font-medium hover:text-blue-300">▶Add</button></td>
                </tr>
                {amountRows.length===0 && (
                  <tr><td colSpan={COLS.length+3} className="px-4 py-8 text-center text-muted-foreground text-sm">No records found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t border-white/10 flex items-center gap-2 text-xs text-blue-400">
            {[10,20,50,100,500].map(n=><button key={n} className={`px-1.5 py-0.5 rounded ${n===50?"bg-blue-600 text-white":""}`}>{n}</button>)}
          </div>
        </div>
      )}

      {tab==="date" && (
        <div>
          <div className="flex items-center justify-center gap-3 mb-4">
            <button onClick={()=>setYear(y=>y-1)} className="btn p-1.5"><ChevronLeft className="h-4 w-4"/></button>
            <span className="text-lg font-semibold">{year}</span>
            <button onClick={()=>setYear(y=>y+1)} className="btn p-1.5"><ChevronRight className="h-4 w-4"/></button>
          </div>
          <div className="panel p-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <span className="text-sm text-muted-foreground"><span className="text-foreground font-medium">0</span> record found</span>
              <input type="text" placeholder="search in result" className="glass-input text-sm py-1.5 px-3 rounded-md w-40"/>
            </div>
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-700/80">
                <th className="px-4 py-3 text-xs font-semibold text-slate-200 text-left w-16">#</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-200 text-left">Date From</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-200 text-left">Date To (Payroll Date)</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-200 text-left">Actions</th>
              </tr></thead>
              <tbody>
                <tr className="border-b border-white/5">
                  <td className="px-4 py-2"></td>
                  <td className="px-4 py-2"></td>
                  <td className="px-4 py-2"><input type="date" placeholder="mm/dd/yyyy" className="glass-input text-sm py-1 px-2 rounded w-36 border-dashed"/></td>
                  <td className="px-4 py-2"><button className="text-blue-400 text-xs font-medium hover:text-blue-300">▶Add</button></td>
                </tr>
                {dateRows.length===0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground text-sm">No records found.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab==="tier" && (
        <div className="panel p-0 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <span className="text-sm text-muted-foreground"><span className="text-foreground font-medium">{tierRows.length}</span> record found</span>
            <input type="text" placeholder="search in result" className="glass-input text-sm py-1.5 px-3 rounded-md w-40"/>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-700/80">
              <th className="px-4 py-3 text-xs font-semibold text-slate-200 text-left w-20">ID</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-200 text-left">Tier Name</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-200 text-left">Payroll Rate (%)</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-200 text-left">Actions</th>
            </tr></thead>
            <tbody>
              <tr className="border-b border-white/5">
                <td className="px-4 py-2"></td>
                <td className="px-4 py-2"><input type="text" value={newTierName} onChange={e=>setNewTierName(e.target.value)} placeholder="" className="glass-input text-sm py-1 px-2 rounded w-36 border-dashed"/></td>
                <td className="px-4 py-2"><input type="number" value={newTierRate} onChange={e=>setNewTierRate(e.target.value)} placeholder="" className="glass-input text-sm py-1 px-2 rounded w-28 border-dashed"/></td>
                <td className="px-4 py-2">
                  <button onClick={()=>{if(newTierName){setTierRows(p=>[...p,{id:p.length+1,name:newTierName,rate:newTierRate}]);setNewTierName("");setNewTierRate("");}}} className="text-blue-400 text-xs font-medium hover:text-blue-300">▶Add</button>
                </td>
              </tr>
              {tierRows.map((r,idx)=>(
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${idx%2!==0?"bg-white/2":""}`}>
                  <td className="px-4 py-2.5">{r.id}</td>
                  <td className="px-4 py-2.5">{r.name}</td>
                  <td className="px-4 py-2.5">{r.rate}%</td>
                  <td className="px-4 py-2.5">
                    <button onClick={()=>setTierRows(p=>p.filter(x=>x.id!==r.id))} className="text-red-400 hover:text-red-300"><Trash2 className="h-3.5 w-3.5"/></button>
                  </td>
                </tr>
              ))}
              {tierRows.length===0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground text-sm">No records found.</td></tr>}
            </tbody>
          </table>
          <div className="px-4 py-2 border-t border-white/10 flex items-center gap-2 text-xs text-blue-400">
            {[10,20,50,100,500].map(n=><button key={n} className={`px-1.5 py-0.5 rounded ${n===50?"bg-blue-600 text-white":""}`}>{n}</button>)}
          </div>
        </div>
      )}
    </main>
  );
}
