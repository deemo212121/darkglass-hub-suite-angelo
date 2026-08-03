import { useState, useRef, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, CSR_NAMES, pick } from "@/components/shared";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const TICKET_PREFIXES = ["SNWV54E","SA-","2600","1007","087941","727","BN21","AW","4850","SMO"];
const COLORS = ["text-blue-400","text-green-400","text-purple-400","text-orange-400","text-pink-400"];

function genTicket(i: number) {
  return pick(TICKET_PREFIXES,i) + String(1000000+i*137).slice(0,8) + (i%3===0?"DF":i%3===1?"-10":"");
}
function genMiles(i: number) { return (10 + (i*37)%120).toFixed(1); }

function getWeekDates(startDate: Date) {
  return Array.from({length:7},(_,i)=>{ const d=new Date(startDate); d.setDate(d.getDate()+i); return d; });
}

function getMondayOfWeek(d: Date) {
  const day = new Date(d); const dow = day.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  day.setDate(day.getDate() + diff);
  return day;
}

function generateTechWeekData(techs: string[], dates: Date[]) {
  return techs.map((tech, ti) => ({
    tech,
    days: dates.map((d, di) => {
      const count = (ti + di + d.getDate()) % 5;
      if (count === 0) return [];
      return Array.from({length:count},(_,j)=>({
        ticket: genTicket(ti*7+di*3+j),
        miles: genMiles(ti+di+j),
        color: COLORS[(ti+j)%COLORS.length],
        isLate: (ti+di+j)%7===0,
        isRed: (ti+j)%11===0,
      }));
    }),
  }));
}

export function ClaimCalendarWeekly({ mod, sub }: Props) {
  const today = new Date();
  const [weekStart, setWeekStart] = useState(getMondayOfWeek(today));
  const [location, setLocation] = useState("");
  const [locOpen, setLocOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setLocOpen(false); };
    document.addEventListener("mousedown", fn); return () => document.removeEventListener("mousedown", fn);
  }, []);

  const dates = getWeekDates(weekStart);
  const techs = CSR_NAMES.slice(0,20);
  const data = generateTechWeekData(techs, dates);

  const prevWeek = () => { const d=new Date(weekStart); d.setDate(d.getDate()-7); setWeekStart(d); };
  const nextWeek = () => { const d=new Date(weekStart); d.setDate(d.getDate()+7); setWeekStart(d); };

  const fmtDate = (d: Date) => d.toISOString().slice(0,10);
  const endDate = dates[6];

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">Claim</Link><span>›</span>
        <span className="text-foreground font-medium">Claim Calendar (Weekly)</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn"><ChevronLeft className="h-4 w-4"/></Link>
        <h1 className="text-xl font-bold">Claim Calendar (Weekly)</h1>
      </div>

      {/* Filter bar */}
      <div className="panel panel-filter mb-5">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Location</span>
          <div ref={ref} className="relative flex-1">
            <button aria-label="Select location" aria-expanded={locOpen} onClick={()=>setLocOpen(o=>!o)}
              className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
              <span className={location?"":"text-muted-foreground"}>{location||"All Locations"}</span>
              <svg className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${locOpen?"rotate-180":""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            {locOpen && (
              <div className="absolute z-[99999] top-full mt-1 left-0 w-full max-h-64 overflow-y-auto rounded-md border border-white/15 bg-(--color-surface) shadow-xl" style={{background:"rgb(22,28,52)",border:"1px solid rgba(255,255,255,0.15)"}}>
                {LOCATIONS.map((l,i)=>(
                  <button key={i} onClick={()=>{setLocation(l);setLocOpen(false);}}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${location===l?"bg-blue-600 text-white":l===""?"text-muted-foreground":""}`}>
                    {l||"— All Locations —"}
                  </button>
                ))}
              </div>
            )}
          </div>
          
        </div>
      </div>

      {/* Week nav */}
      <div className="flex items-center justify-center gap-3 mb-4">
        <button onClick={prevWeek} className="btn p-1.5" aria-label="Previous week"><ChevronLeft className="h-4 w-4"/></button>
        <div className="flex items-center gap-2">
          <label htmlFor="week-start" className="sr-only">Week start</label>
          <input id="week-start" type="date" value={fmtDate(weekStart)} onChange={e=>{const d=new Date(e.target.value);setWeekStart(getMondayOfWeek(d));}} title="Week start" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1 px-2 rounded-md w-32.5"/>
          <span className="text-muted-foreground text-xs">~</span>
          <label htmlFor="week-end" className="sr-only">Week end</label>
          <input id="week-end" type="date" value={fmtDate(endDate)} readOnly title="Week end" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1 px-2 rounded-md w-32.5 opacity-60"/>
        </div>
        <button onClick={nextWeek} className="btn p-1.5" aria-label="Next week"><ChevronRight className="h-4 w-4"/></button>
      </div>

      {/* Weekly grid */}
      <div className="panel overflow-x-auto p-0">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-slate-700/80">
              <th className="px-3 py-3 text-xs font-semibold text-slate-200 text-left border-r border-white/10 min-w-32"></th>
              {dates.map(d=>(
                <th key={d.toISOString()} className="px-2 py-3 text-xs font-semibold text-slate-200 text-center border-r border-white/10 last:border-r-0 min-w-28">
                  {fmtDate(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map(({tech, days},ti)=>(
              <tr key={tech} className={`border-b border-white/10 ${ti%2===0?"":"bg-white/[0.015]"}`}>
                <td className="px-3 py-2 text-sm font-medium border-r border-white/10 align-top">{tech}</td>
                {days.map((tickets,di)=>(
                  <td key={di} className="px-2 py-2 align-top border-r border-white/10 last:border-r-0">
                    <div className="flex flex-col gap-0.5">
                      {tickets.map((t,j)=>(
                        <div key={j} className="flex items-center gap-1 flex-wrap">
                          <span className={`text-xs font-mono ${t.isRed?"text-red-400":t.isLate?"text-yellow-400":t.color}`}>{t.ticket}</span>
                          <span className="text-xs px-1 py-0 rounded font-medium bg-green-600 text-white">{t.miles} mi</span>
                        </div>
                      ))}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
