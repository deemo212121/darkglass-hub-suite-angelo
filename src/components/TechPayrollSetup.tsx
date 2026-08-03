import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Trash2, Loader2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { usePersistedTab } from "@/lib/usePersistedTab";
import { LOCATIONS } from "@/lib/locations";
import {
  DEFAULT_REPAIR_TYPE,
  getTechRepairRates,
  upsertTechRepairRate,
  deleteTechRepairRate,
  type TechRepairRate,
} from "@/lib/supabase/techPayroll";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

// Matches the real "Repair Type (2nd Tech)" dropdown on a ticket's Visit Log
// (ticket.$ticketNo.tsx) plus DEFAULT_REPAIR_TYPE, the fallback rate used
// when a completed visit has no repair_type set.
const REPAIR_TYPES = [
  DEFAULT_REPAIR_TYPE,
  "2 Man Job", "Back Tub", "Major Repair", "Panel 60 Over", "Panel 80 Over",
  "Seal with Trainee", "Sealed System", "Sealed System Follow Up",
  "Sealed System(R600)", "Stacked Unit(Washer Only)", "Wall Oven",
];
const ALL_BRANCHES = "__ALL__";

export function TechPayrollSetup({ mod, sub }: Props) {
  const [tab, setTab] = usePersistedTab<"amount" | "date" | "tier">(
    "ahs:tech-payroll-setup-active-tab",
    ["amount", "date", "tier"],
    "amount",
  );
  const [year, setYear] = useState(2026);
  const [dateRows] = useState<any[]>([]);
  const [tierRows, setTierRows] = useState<{id:number;name:string;rate:string}[]>([]);
  const [newTierName, setNewTierName] = useState("");
  const [newTierRate, setNewTierRate] = useState("");
  const [search, setSearch] = useState("");

  // ── Payroll Amount tab: real, persisted rates (migration 0120) ──────────
  const [rates, setRates] = useState<TechRepairRate[]>([]);
  const [ratesLoading, setRatesLoading] = useState(true);
  const [newRepairType, setNewRepairType] = useState(REPAIR_TYPES[0]);
  const [newBranch, setNewBranch] = useState(ALL_BRANCHES);
  const [newAmount, setNewAmount] = useState("");
  const [savingNewRate, setSavingNewRate] = useState(false);
  const [deletingRateId, setDeletingRateId] = useState<string | null>(null);

  const loadRates = () => {
    setRatesLoading(true);
    getTechRepairRates()
      .then(setRates)
      .finally(() => setRatesLoading(false));
  };
  useEffect(() => { loadRates(); }, []);

  const handleAddRate = async () => {
    if (!newRepairType || !newAmount.trim()) return;
    setSavingNewRate(true);
    try {
      await upsertTechRepairRate({
        repairType: newRepairType,
        branch: newBranch === ALL_BRANCHES ? null : newBranch,
        amount: Number(newAmount) || 0,
      });
      setNewAmount("");
      loadRates();
    } catch (err) {
      alert(`Failed to save rate: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingNewRate(false);
    }
  };

  const handleAmountBlur = async (rate: TechRepairRate, value: string) => {
    const amount = Number(value) || 0;
    if (amount === rate.amount) return;
    try {
      await upsertTechRepairRate({ id: rate.id, repairType: rate.repairType, branch: rate.branch, amount });
      setRates((prev) => prev.map((r) => (r.id === rate.id ? { ...r, amount } : r)));
    } catch (err) {
      alert(`Failed to save rate: ${err instanceof Error ? err.message : "Unknown error"}`);
      loadRates();
    }
  };

  const handleDeleteRate = async (rate: TechRepairRate) => {
    if (!window.confirm(`Remove the rate for "${rate.repairType}"${rate.branch ? ` (${rate.branch})` : " (all branches)"}?`)) return;
    setDeletingRateId(rate.id);
    try {
      await deleteTechRepairRate(rate.id);
      setRates((prev) => prev.filter((r) => r.id !== rate.id));
    } catch (err) {
      alert(`Failed to remove rate: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setDeletingRateId(null);
    }
  };

  const filteredRates = rates.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.repairType.toLowerCase().includes(q) || (r.branch || "").toLowerCase().includes(q);
  });

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
          <p className="px-4 pt-3 text-xs text-muted-foreground">
            The $ amount a technician earns per completed repair ticket of this type. A branch-specific rate overrides the "All Branches" rate for that same repair type. "{DEFAULT_REPAIR_TYPE}" is the fallback used when a completed visit has no repair type set.
          </p>
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <span className="text-sm text-muted-foreground"><span className="text-foreground font-medium">{filteredRates.length}</span> record{filteredRates.length===1?"":"s"} found</span>
            <input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder="search in result"
              className="glass-input text-sm py-1.5 px-3 rounded-md w-40"/>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-700/80">
                <th className="px-3 py-3 text-xs font-semibold text-slate-200 text-left">Repair Type</th>
                <th className="px-3 py-3 text-xs font-semibold text-slate-200 text-left">Branch</th>
                <th className="px-3 py-3 text-xs font-semibold text-slate-200 text-left">Amount</th>
                <th className="px-3 py-3 text-xs font-semibold text-slate-200 text-left">Actions</th>
              </tr></thead>
              <tbody>
                <tr className="border-b border-white/5">
                  <td className="px-3 py-2">
                    <select aria-label="Repair type" value={newRepairType} onChange={(e)=>setNewRepairType(e.target.value)} className="glass-input text-xs py-1 px-2 rounded w-44">
                      {REPAIR_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select aria-label="Branch" value={newBranch} onChange={(e)=>setNewBranch(e.target.value)} className="glass-input text-xs py-1 px-2 rounded w-36">
                      <option value={ALL_BRANCHES}>All Branches</option>
                      {LOCATIONS.map(b=><option key={b} value={b}>{b}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" min={0} step={0.01} value={newAmount} onChange={(e)=>setNewAmount(e.target.value)} placeholder="0.00" className="glass-input text-xs py-1 px-2 rounded w-24 border-dashed"/>
                  </td>
                  <td className="px-3 py-2">
                    <button onClick={handleAddRate} disabled={savingNewRate || !newAmount.trim()} className="text-blue-400 text-xs font-medium hover:text-blue-300 disabled:opacity-40">
                      {savingNewRate ? "Saving…" : "▶Add"}
                    </button>
                  </td>
                </tr>
                {ratesLoading ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground text-sm">Loading…</td></tr>
                ) : filteredRates.length===0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground text-sm">No records found.</td></tr>
                ) : (
                  filteredRates.map((r) => (
                    <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-3 py-2.5">{r.repairType}</td>
                      <td className="px-3 py-2.5">{r.branch || <span className="text-muted-foreground">All Branches</span>}</td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          defaultValue={r.amount}
                          onBlur={(e) => handleAmountBlur(r, e.target.value)}
                          className="glass-input text-xs py-1 px-2 rounded w-24"
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <button onClick={() => handleDeleteRate(r)} disabled={deletingRateId === r.id} className="text-red-400 hover:text-red-300 disabled:opacity-40">
                          {deletingRateId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin"/> : <Trash2 className="h-3.5 w-3.5"/>}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
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
