import { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS } from "@/components/shared";
import { FloatingHorizontalScrollbar } from "@/components/FloatingHorizontalScrollbar";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

function isoWeek(d: Date) {
  const t = new Date(d); t.setHours(0,0,0,0); t.setDate(t.getDate()+3-((t.getDay()+6)%7));
  const w1 = new Date(t.getFullYear(),0,4);
  return 1+Math.round(((t.getTime()-w1.getTime())/86400000-3+((w1.getDay()+6)%7))/7);
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month+1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay(); // 0=Sun
}

function seedCount(year: number, month: number, day: number, loc: string): number {
  const seed = year * 10000 + month * 100 + day + loc.length;
  const isWeekend = new Date(year, month, day).getDay() % 6 === 0;
  if (isWeekend) return Math.floor(seed % 10);
  return 150 + (seed * 37) % 250;
}

export function ClaimCalendarMonthly({ mod, sub }: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [location, setLocation] = useState("");
  const [locOpen, setLocOpen] = useState(false);
  const tableScrollRef = useRef<HTMLDivElement>(null);

  // Portaled to document.body (position: fixed, computed from the button's
  // own bounding rect) instead of a locally `absolute`-positioned overlay —
  // the old version didn't reserve layout space when open, so it floated on
  // top of whatever came next in normal flow instead of cleanly above it.
  // Same pattern as ClaimList.tsx / ClaimCalendarWeekly.tsx / ClaimPlanner.tsx.
  const locBtnRef = useRef<HTMLButtonElement>(null);
  const locListRef = useRef<HTMLDivElement>(null);
  const [locPos, setLocPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const updateLocPos = useCallback(() => {
    if (!locBtnRef.current) return;
    const b = locBtnRef.current.getBoundingClientRect();
    setLocPos({ top: b.bottom + 4, left: b.left, width: b.width });
  }, []);

  useLayoutEffect(() => { if (locOpen) updateLocPos(); }, [locOpen, updateLocPos]);

  useEffect(() => {
    if (!locOpen) return;
    window.addEventListener("scroll", updateLocPos, true);
    window.addEventListener("resize", updateLocPos);
    return () => {
      window.removeEventListener("scroll", updateLocPos, true);
      window.removeEventListener("resize", updateLocPos);
    };
  }, [locOpen, updateLocPos]);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      const t = e.target as Node;
      if (locOpen && !locBtnRef.current?.contains(t) && !locListRef.current?.contains(t)) setLocOpen(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [locOpen]);

  const prevMonth = () => { if (month === 0) { setYear(y=>y-1); setMonth(11); } else setMonth(m=>m-1); };
  const nextMonth = () => { if (month === 11) { setYear(y=>y+1); setMonth(0); } else setMonth(m=>m+1); };

  const monthName = new Date(year, month).toLocaleString("default", { month: "long", year: "numeric" });
  const firstDay = getFirstDayOfMonth(year, month);
  const daysInMonth = getDaysInMonth(year, month);

  // Build calendar weeks
  const weeks: { weekNo: number; days: { date: number | null; count: number }[] }[] = [];
  let dayNum = 1;
  let weekIdx = 0;
  while (dayNum <= daysInMonth) {
    const week: (number | null)[] = [];
    for (let dow = 0; dow < 7; dow++) {
      if (weekIdx === 0 && dow < firstDay) { week.push(null); }
      else if (dayNum > daysInMonth) { week.push(null); }
      else { week.push(dayNum); dayNum++; }
    }
    const firstReal = week.find(d => d !== null);
    const wn = firstReal ? isoWeek(new Date(year, month, firstReal)) : weekIdx + 1;
    weeks.push({
      weekNo: wn,
      days: week.map(d => ({
        date: d,
        count: d ? seedCount(year, month, d, location || "all") : 0,
      })),
    });
    weekIdx++;
  }

  const isToday = (d: number | null) => d !== null && new Date(year, month, d).toDateString() === new Date().toDateString();
  const isWeekend = (dow: number) => dow === 0 || dow === 6;

  return (
    <div className="min-h-screen flex flex-col">
    <main className="flex-1 max-w-[1900px] mx-auto w-full px-4 py-6">
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn"><ChevronLeft className="h-4 w-4"/></Link>
        <h1 className="text-xl font-bold">Claim Calendar (Monthly)</h1>
      </div>

      {/* Filter bar */}
      <div className="panel panel-filter mb-5">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Location</span>
          <div className="flex-1">
            <button ref={locBtnRef} aria-label="Select location" aria-expanded={locOpen} onClick={()=>setLocOpen(o=>!o)}
              className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
              <span className={location?"":"text-muted-foreground"}>{location||"All Locations"}</span>
              <svg className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${locOpen?"rotate-180":""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            {locOpen && locPos && createPortal(
              <div
                ref={locListRef}
                style={{ position: "fixed", top: locPos.top, left: locPos.left, width: locPos.width, zIndex: 99999, background: "rgb(22,28,52)", border: "1px solid rgba(255,255,255,0.15)" }}
                className="max-h-64 overflow-y-auto rounded-md shadow-xl"
              >
                {LOCATIONS.map((l,i)=>(
                  <button key={i} onClick={()=>{setLocation(l);setLocOpen(false);}}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${location===l?"bg-blue-600 text-white":l===""?"text-muted-foreground":""}`}>
                    {l||"— All Locations —"}
                  </button>
                ))}
              </div>,
              document.body
            )}
          </div>
          
        </div>
      </div>

      {/* Month nav */}
      <div className="flex items-center justify-center gap-3 mb-4">
        <button onClick={prevMonth} className="btn p-1.5" aria-label="Previous month"><ChevronLeft className="h-4 w-4"/></button>
        <label htmlFor="cal-month" className="sr-only">Select month</label>
        <input id="cal-month" type="month" value={`${year}-${String(month+1).padStart(2,"0")}`}
          onChange={e=>{const [y,m]=e.target.value.split("-");setYear(+y);setMonth(+m-1);}}
          title="Select month" className="glass-input text-sm py-1 px-3 rounded-md w-36 text-center"/>
        <button onClick={nextMonth} className="btn p-1.5" aria-label="Next month"><ChevronRight className="h-4 w-4"/></button>
      </div>

      {/* Calendar grid */}
      <FloatingHorizontalScrollbar targetRef={tableScrollRef} />
      <div ref={tableScrollRef} className="panel overflow-x-auto p-0">
        <table className="w-full min-w-max text-sm border-collapse">
          <thead>
            <tr className="bg-slate-700/80">
              <th className="px-3 py-3 text-xs font-semibold text-slate-300 w-16 border-r border-white/10"></th>
              {["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map((d,i)=>(
                <th key={d} className={`px-3 py-3 text-xs font-semibold text-center border-r border-white/10 last:border-r-0 ${isWeekend(i)?"text-blue-300":"text-slate-200"}`}>{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week,wi)=>(
              <tr key={wi} className="border-b border-white/10">
                <td className="px-2 py-2 text-xs text-muted-foreground text-center bg-white/3 border-r border-white/10 align-top font-medium">
                  Week {week.weekNo}
                </td>
                {week.days.map((cell,dow)=>(
                  <td key={dow} className={`px-2 py-1 border-r border-white/10 last:border-r-0 align-top min-w-20 h-20 ${cell.date===null?"bg-white/[0.01]":""}`}>
                    {cell.date!==null && (
                      <>
                        <div className={`text-xs font-medium text-right mb-1 ${isToday(cell.date)?"text-blue-400 font-bold":isWeekend(dow)?"text-blue-300":"text-muted-foreground"}`}>
                          {cell.date}
                        </div>
                        <div className={`text-center text-sm font-medium ${isWeekend(dow)?"text-blue-400":cell.count>0?"text-blue-400":"text-muted-foreground"}`}>
                          {cell.count}
                        </div>
                      </>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
    </div>
  );
}
