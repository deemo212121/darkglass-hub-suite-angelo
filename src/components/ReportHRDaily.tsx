import { useState, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend, LineChart, Line } from "recharts";
import { hrReportData } from "@/lib/reportData";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

const ALL_DATES=Object.keys(hrReportData).sort();
const fmtDate=(s:string)=>{const c=s.trim();return c.length===2?`5/${c}/26`:`${c.slice(0,-2)}/${c.slice(-2)}/26`;};
const ALL_US_BRANCHES=[...new Set(Object.values(hrReportData).flatMap((d:any)=>d.us?.interviews?.map((r:any)=>r.branch)||[]))].filter(Boolean).sort();
const ALL_PH_BRANCHES=[...new Set(Object.values(hrReportData).flatMap((d:any)=>d.ph?.interviews?.map((r:any)=>r.branch)||[]))].filter(Boolean).sort();
const COLORS=["#34d399","#3b82f6","#a78bfa","#fb923c","#f472b6","#facc15","#60a5fa","#4ade80","#c084fc","#f87171"];

export function ReportHRDaily({mod,sub}:{mod:ModuleDef;sub:SubModuleDef}){
  const [date,setDate]=useState(ALL_DATES[ALL_DATES.length-1]);
  const [section,setSection]=useState<"us"|"ph">("us");
  const [branchFilter,setBranchFilter]=useState("");
  const [warningFilter,setWarningFilter]=useState("");

  const d=useMemo(()=>(hrReportData as any)[date]||{},[date]);
  const sectionData=d[section]||{interviews:[],warnings:[]};

  const interviews:any[]=useMemo(()=>{let r=sectionData.interviews||[];if(branchFilter)r=r.filter((x:any)=>x.branch===branchFilter);return r;},[sectionData,branchFilter]);
  const warnings:any[]=useMemo(()=>{let r=sectionData.warnings||[];if(branchFilter)r=r.filter((x:any)=>x.branch===branchFilter);if(warningFilter==="timecard")r=r.filter((x:any)=>x.timecardWarning&&x.timecardWarning>0);if(warningFilter==="employee")r=r.filter((x:any)=>x.employeeError&&x.employeeError>0);return r;},[sectionData,branchFilter,warningFilter]);

  const totalHired=interviews.reduce((s:number,r:any)=>s+(Number(r.hired)||0),0);
  const totalScheduled=interviews.reduce((s:number,r:any)=>s+(Number(r.scheduled)||0),0);
  const totalTCW=warnings.reduce((s:number,r:any)=>s+(Number(r.timecardWarning)||0),0);
  const totalEE=warnings.reduce((s:number,r:any)=>s+(Number(r.employeeError)||0),0);

  // Chart data
  const interviewBarData=interviews.filter(r=>r.branch&&r.scheduled!=null).map(r=>({name:r.branch,scheduled:r.scheduled||0,hired:Number(r.hired)||0})).sort((a,b)=>b.scheduled-a.scheduled).slice(0,15);
  const warningBarData=warnings.filter(r=>r.branch&&(r.timecardWarning||r.employeeError)).map(r=>({name:r.branch,timecard:r.timecardWarning||0,employee:r.employeeError||0}));
  const trendData=ALL_DATES.slice(-10).map(dt=>{const x=((hrReportData as any)[dt]||{})[section]||{};const iv=x.interviews||[];const wn=x.warnings||[];return{date:fmtDate(dt),hired:iv.reduce((s:number,r:any)=>s+(Number(r.hired)||0),0),warnings:wn.reduce((s:number,r:any)=>s+(r.timecardWarning||0)+(r.employeeError||0),0)};});

  const branchOptions=section==="us"?ALL_US_BRANCHES:ALL_PH_BRANCHES;

  return(
    <div className="min-h-screen flex flex-col"><main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
      <div className="flex items-center gap-3 mb-6"><Link to="/m/$module" params={{module:mod.slug}} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4"/></Link><h1 className="text-2xl font-bold">{sub.title}</h1></div>
      <div className="panel mb-6"><div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</label>
          <select value={date} onChange={e=>setDate(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md">{ALL_DATES.map(d=><option key={d} value={d}>{fmtDate(d)}</option>)}</select></div>
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Section</label>
          <div className="flex rounded-md overflow-hidden border border-white/15">
            <button onClick={()=>{setSection("us");setBranchFilter("");}} className={`px-4 py-1.5 text-sm font-medium ${section==="us"?"bg-blue-600 text-white":"btn rounded-none"}`}>US Employee</button>
            <button onClick={()=>{setSection("ph");setBranchFilter("");}} className={`px-4 py-1.5 text-sm font-medium ${section==="ph"?"bg-blue-600 text-white":"btn rounded-none"}`}>PH Employee</button>
          </div></div>
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Branch/Dept</label>
          <select value={branchFilter} onChange={e=>setBranchFilter(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md"><option value="">All</option>{branchOptions.map(b=><option key={b} value={b}>{b}</option>)}</select></div>
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Warning Type</label>
          <select value={warningFilter} onChange={e=>setWarningFilter(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md"><option value="">All</option><option value="timecard">Timecard</option><option value="employee">Employee Error</option></select></div>
        {(branchFilter||warningFilter)&&<button onClick={()=>{setBranchFilter("");setWarningFilter("");}} className="btn text-sm px-3 mb-0.5">Clear</button>}
      </div></div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[["Scheduled",totalScheduled,"text-blue-300"],["Hired",totalHired,"text-green-300"],["Timecard Warnings",totalTCW,"text-yellow-300"],["Employee Errors",totalEE,"text-red-300"]].map(([l,v,c])=>(
          <div key={l as string} className="panel p-4 text-center"><p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{l}</p><p className={`text-3xl font-bold ${c}`}>{v||'—'}</p></div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Interview bar */}
        <div className="panel p-4">
          <p className="text-sm font-semibold mb-4">Interviews — Scheduled vs Hired</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={interviewBarData} margin={{left:-10}}>
              <XAxis dataKey="name" tick={{fill:"#94a3b8",fontSize:9}} angle={-30} textAnchor="end" height={45}/>
              <YAxis tick={{fill:"#94a3b8",fontSize:11}}/>
              <Tooltip contentStyle={{background:"#1e293b",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6}}/>
              <Legend wrapperStyle={{fontSize:11,color:"#94a3b8"}}/>
              <Bar dataKey="scheduled" fill="#3b82f6" radius={[4,4,0,0]} name="Scheduled"/>
              <Bar dataKey="hired" fill="#34d399" radius={[4,4,0,0]} name="Hired"/>
            </BarChart>
          </ResponsiveContainer>
        </div>
        {/* Trend line */}
        <div className="panel p-4">
          <p className="text-sm font-semibold mb-4">Hired vs Warnings Trend — Last 10 Days</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trendData} margin={{left:-10}}>
              <XAxis dataKey="date" tick={{fill:"#94a3b8",fontSize:10}}/>
              <YAxis tick={{fill:"#94a3b8",fontSize:11}}/>
              <Tooltip contentStyle={{background:"#1e293b",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6}}/>
              <Legend wrapperStyle={{fontSize:11,color:"#94a3b8"}}/>
              <Line type="monotone" dataKey="hired" stroke="#34d399" strokeWidth={2} dot={{r:3}} name="Hired"/>
              <Line type="monotone" dataKey="warnings" stroke="#f87171" strokeWidth={2} dot={{r:3}} name="Total Warnings"/>
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Warning bar */}
      {warningBarData.length>0&&<div className="panel p-4 mb-4">
        <p className="text-sm font-semibold mb-4">Warnings by Branch</p>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={warningBarData} margin={{left:-10}}>
            <XAxis dataKey="name" tick={{fill:"#94a3b8",fontSize:10}} angle={-20} textAnchor="end" height={40}/>
            <YAxis tick={{fill:"#94a3b8",fontSize:11}}/>
            <Tooltip contentStyle={{background:"#1e293b",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6}}/>
            <Legend wrapperStyle={{fontSize:11,color:"#94a3b8"}}/>
            <Bar dataKey="timecard" fill="#facc15" radius={[4,4,0,0]} name="Timecard Warning"/>
            <Bar dataKey="employee" fill="#f87171" radius={[4,4,0,0]} name="Employee Error"/>
          </BarChart>
        </ResponsiveContainer>
      </div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="panel p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex justify-between"><span>Interview Report</span><span className="text-xs text-muted-foreground">{interviews.length} branches</span></div>
          <div className="overflow-y-auto max-h-72"><table className="w-full text-sm"><thead><tr className="border-b border-white/10 bg-white/5">{["Branch/Dept","Scheduled","Staff Need","Hired"].map(h=><th key={h} className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">{h}</th>)}</tr></thead>
          <tbody>{interviews.length===0?<tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground text-sm">No data.</td></tr>:interviews.map((r:any,i:number)=><tr key={i} className="border-b border-white/5 hover:bg-white/5"><td className="px-3 py-2.5 font-medium">{r.branch}</td><td className="px-3 py-2.5 text-center text-blue-400">{r.scheduled??'—'}</td><td className="px-3 py-2.5 text-xs text-muted-foreground">{r.staffNeed||'—'}</td><td className="px-3 py-2.5 text-center text-green-400 font-semibold">{r.hired??'—'}</td></tr>)}</tbody></table></div>
        </div>
        <div className="panel p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex justify-between"><span>Warning Report</span><span className="text-xs text-muted-foreground">{warnings.length} branches</span></div>
          <div className="overflow-y-auto max-h-72"><table className="w-full text-sm"><thead><tr className="border-b border-white/10 bg-white/5">{["Branch/Dept","Timecard Warning","Employee Error"].map(h=><th key={h} className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">{h}</th>)}</tr></thead>
          <tbody>{warnings.length===0?<tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground text-sm">No warning data.</td></tr>:warnings.map((r:any,i:number)=><tr key={i} className="border-b border-white/5 hover:bg-white/5"><td className="px-3 py-2.5 font-medium">{r.branch}</td><td className="px-3 py-2.5 text-center text-yellow-400 font-semibold">{r.timecardWarning??'—'}</td><td className="px-3 py-2.5 text-center text-red-400 font-semibold">{r.employeeError??'—'}</td></tr>)}</tbody></table></div>
        </div>
      </div>
    </main></div>
  );
}
