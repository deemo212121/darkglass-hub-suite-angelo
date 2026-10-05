import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { trainingWindow } from "@/lib/fieldStartDate";
import { TicketColumnFilter } from "@/components/TicketColumnFilter";

type Employee = { id: string; full_name: string; department: string | null; assigned_branch?: string | null; roleLabel?: string | null; isTrainee: boolean; trainingEndDate: string | null; hrTrainingStart?: string | null; hrFieldStart?: string | null };
type Props = { employees: Employee[]; hireDates: Map<string, string>; start: string; end: string; setStart: (v: string) => void; setEnd: (v: string) => void; search: string; setSearch: (v: string) => void; departments: Set<string>; setDepartments: (v: Set<string>) => void };
type Punch = { work_date: string; check_in: string | null; check_out: string | null; status: string | null };

function Punches({ id, start, end }: { id: string; start: string; end: string }) {
  const [state, setState] = useState<{ rows: Punch[]; loading: boolean; error: string }>({ rows: [], loading: true, error: "" });
  useEffect(() => {
    let cancelled = false;
    setState({ rows: [], loading: true, error: "" });
    async function load(table: string) {
      const rows: Punch[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from(table).select("work_date,check_in,check_out,status")
          .eq("profile_id", id).gte("work_date", start).lte("work_date", end).order("work_date").order("id").range(from, from + 999);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < 1000) return rows;
      }
    }
    void Promise.all([load("timecard_entries"), load("trainee_timecard_entries")]).then(([approved, trainee]) => {
      const byDate = new Map<string, Punch>();
      for (const row of trainee) byDate.set(row.work_date, row);
      for (const row of approved) byDate.set(row.work_date, { ...row, status: "Recorded" });
      if (!cancelled) setState({ rows: [...byDate.values()].sort((a,b) => a.work_date.localeCompare(b.work_date)), loading: false, error: "" });
    }).catch((e) => { if (!cancelled) setState({ rows: [], loading: false, error: e.message || "Unable to load attendance" }); });
    return () => { cancelled = true; };
  }, [id, start, end]);
  if (state.loading) return <p className="p-3 text-slate-400">Loading attendance...</p>;
  if (state.error) return <p role="alert" className="p-3 text-red-300">{state.error}</p>;
  if (!state.rows.length) return <p className="p-3 text-slate-400">No clock records in this date range.</p>;
  return <table className="w-full text-xs text-left"><thead className="text-slate-400"><tr>{["Date", "Clock In", "Clock Out", "Status"].map(h => <th key={h} className="px-3 py-1.5">{h}</th>)}</tr></thead><tbody>{state.rows.map(r => <tr key={r.work_date} className="border-t border-white/5"><td className="px-3 py-1.5">{r.work_date}</td><td className="px-3 py-1.5 text-green-300">{r.check_in || "?"}</td><td className="px-3 py-1.5 text-red-300">{r.check_out || "?"}</td><td className="px-3 py-1.5 capitalize">{r.status || "Recorded"}</td></tr>)}</tbody></table>;
}

export function TraineeMonitoringTab(p: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [branches, setBranches] = useState<Set<string>>(new Set());
  const [roles, setRoles] = useState<Set<string>>(new Set());
  const invalid = !p.start || !p.end || p.start > p.end;
  const trainees = p.employees.filter(e => {
    const window = trainingWindow(e.hrTrainingStart, e.hrFieldStart, p.hireDates.get(e.id), e.isTrainee);
    return !!window.end && window.end >= p.start && (!window.start || window.start <= p.end);
  });
  const rows = trainees.filter(e => e.full_name.toLowerCase().includes(p.search.trim().toLowerCase())
    && (!p.departments.size || p.departments.has(e.department || ""))
    && (!branches.size || branches.has(e.assigned_branch || ""))
    && (!roles.size || roles.has(e.roleLabel || ""))).sort((a,b) => a.full_name.localeCompare(b.full_name));
  return <section className="space-y-2 text-xs">
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-xs text-slate-400">From<input aria-label="Trainee monitoring start date" type="date" value={p.start} max={p.end || undefined} onChange={e=>p.setStart(e.target.value)} className="block bg-slate-800 rounded px-2 py-1.5 text-white" /></label>
      <label className="text-xs text-slate-400">To<input aria-label="Trainee monitoring end date" type="date" value={p.end} min={p.start || undefined} onChange={e=>p.setEnd(e.target.value)} className="block bg-slate-800 rounded px-2 py-1.5 text-white" /></label>
      <label className="text-xs text-slate-400">Name<input value={p.search} onChange={e=>p.setSearch(e.target.value)} placeholder="Search employee..." className="block bg-slate-800 rounded px-2 py-1.5 text-white" /></label>
      <span className="flex items-center">Department<TicketColumnFilter options={[...new Set(trainees.map(e=>e.department || ""))]} selected={p.departments} onChange={p.setDepartments} label="Filter department" /></span>
      <span className="flex items-center">Branch<TicketColumnFilter options={[...new Set(trainees.map(e=>e.assigned_branch || ""))]} selected={branches} onChange={setBranches} label="Filter branch" /></span>
      <span className="flex items-center">Role<TicketColumnFilter options={[...new Set(trainees.map(e=>e.roleLabel || ""))]} selected={roles} onChange={setRoles} label="Filter role" /></span>
      <button className="text-xs text-blue-300" onClick={()=>{ p.setSearch(""); p.setDepartments(new Set()); setBranches(new Set()); setRoles(new Set()); }}>Clear filters</button>
    </div>
    {invalid ? <p role="alert">Select a valid date range.</p> : <>
      <p className="text-xs text-slate-400">{rows.length} trainees. Click a name to view clock records.</p>
      {!rows.length && <p className="p-4 text-slate-400">No trainees match these filters.</p>}
      <div className="border border-white/10 rounded-lg overflow-hidden">{rows.map(e => <div key={e.id} className="border-b border-white/10 last:border-0">
        <button aria-expanded={expanded.has(e.id)} onClick={()=>setExpanded(prev=>{const next=new Set(prev); next.has(e.id)?next.delete(e.id):next.add(e.id); return next;})} className="w-full flex items-center gap-2 text-left px-3 py-1.5 hover:bg-white/5">
          {expanded.has(e.id)?<ChevronDown className="h-4 w-4"/>:<ChevronRight className="h-4 w-4"/>}<span className="font-semibold text-blue-300">{e.full_name}</span><span className="ml-auto flex items-center text-xs text-slate-400">{e.department}<span className="mx-2 border-l border-white/20" aria-hidden="true" />{e.assigned_branch || "Unassigned"}</span>
        </button>
        {expanded.has(e.id) && <div className="bg-slate-900/60"><Punches id={e.id} start={p.start} end={p.end}/></div>}
      </div>)}</div>
    </>}
  </section>;
}
