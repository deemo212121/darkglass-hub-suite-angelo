import { useState, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend, LineChart, Line } from "recharts";
import { opsReportData } from "@/lib/reportData";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

const ALL_DATES=Object.keys(opsReportData).filter(k=>k!=='Staff list').sort();
const KNOWN_AGENTS=["Maverick Nieto","Wincel Carusca","Lloyd Tombiga","Frederick Cabilao","Jerich Bolico"];
const COLORS=["#3b82f6","#34d399","#a78bfa","#fb923c","#f472b6"];
const fmtDate=(s:string)=>{const c=s.trim();return c.length===3?`${c[0]}/${c.slice(1)}/26`:`${c.slice(0,-2)}/${c.slice(-2)}/26`;};

export function ReportOperationsDaily({mod,sub}:{mod:ModuleDef;sub:SubModuleDef}){
  const [date,setDate]=useState(ALL_DATES[0]);
  const [agentFilter,setAgentFilter]=useState("");
  const [mishandledFilter,setMishandledFilter]=useState("");

  const allAgents:any[]=useMemo(()=>((opsReportData as any)[date]?.agents||[]).filter((x:any)=>KNOWN_AGENTS.some(n=>x.name?.includes(n.split(' ')[0]))),[date]);
  const filtered=useMemo(()=>{let a=allAgents;if(agentFilter)a=a.filter((x:any)=>x.name?.includes(agentFilter));if(mishandledFilter==="has")a=a.filter((x:any)=>x.mishandled&&x.mishandled!=="null");return a;},[allAgents,agentFilter,mishandledFilter]);

  const agentBarData=filtered.map((a:any,i:number)=>({name:a.name.split(' ')[0],mishandled:a.mishandled&&a.mishandled!=="null"?1:0,warning:a.warning||0}));
  const trendData=ALL_DATES.slice(-10).map(dt=>{
    const agents=((opsReportData as any)[dt]?.agents||[]).filter((x:any)=>KNOWN_AGENTS.some(n=>x.name?.includes(n.split(' ')[0])));
    return{date:fmtDate(dt),agents:agents.length,mishandled:agents.filter((a:any)=>a.mishandled&&a.mishandled!=="null").length,warnings:agents.reduce((s:number,a:any)=>s+(a.warning||0),0)};
  });

  return(
    <div className="min-h-screen flex flex-col"><main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">
      <div className="flex items-center gap-3 mb-6"><Link to="/m/$module" params={{module:mod.slug}} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4"/></Link><h1 className="text-2xl font-bold">{sub.title}</h1></div>
      <div className="panel mb-6"><div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</label>
          <select value={date} onChange={e=>setDate(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md">{ALL_DATES.map(d=><option key={d} value={d}>{fmtDate(d)}</option>)}</select></div>
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Agent</label>
          <select value={agentFilter} onChange={e=>setAgentFilter(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md"><option value="">All Agents</option>{KNOWN_AGENTS.map(n=><option key={n} value={n.split(' ')[0]}>{n}</option>)}</select></div>
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Mishandled</label>
          <select value={mishandledFilter} onChange={e=>setMishandledFilter(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md"><option value="">All</option><option value="has">Has Mishandled</option></select></div>
        {(agentFilter||mishandledFilter)&&<button onClick={()=>{setAgentFilter("");setMishandledFilter("");}} className="btn text-sm px-3 mb-0.5">Clear</button>}
        <span className="text-sm text-muted-foreground mb-0.5">{filtered.length} agents</span>
      </div></div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {[["Active Staff",filtered.length,"text-blue-300"],["With Mishandled",filtered.filter((a:any)=>a.mishandled&&a.mishandled!=="null").length,"text-red-300"],["With Warnings",filtered.filter((a:any)=>a.warning&&a.warning>0).length,"text-yellow-300"]].map(([l,v,c])=>(
          <div key={l as string} className="panel p-4 text-center"><p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{l}</p><p className={`text-3xl font-bold ${c}`}>{v}</p></div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="panel p-4">
          <p className="text-sm font-semibold mb-4">Mishandled & Warnings per Agent</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={agentBarData} margin={{left:-10}}>
              <XAxis dataKey="name" tick={{fill:"#94a3b8",fontSize:11}}/>
              <YAxis tick={{fill:"#94a3b8",fontSize:11}}/>
              <Tooltip contentStyle={{background:"#1e293b",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6}}/>
              <Legend wrapperStyle={{fontSize:11,color:"#94a3b8"}}/>
              <Bar dataKey="mishandled" fill="#f87171" radius={[4,4,0,0]} name="Mishandled"/>
              <Bar dataKey="warning" fill="#facc15" radius={[4,4,0,0]} name="Warning"/>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="panel p-4">
          <p className="text-sm font-semibold mb-4">Mishandled Trend — Last 10 Days</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trendData} margin={{left:-10}}>
              <XAxis dataKey="date" tick={{fill:"#94a3b8",fontSize:10}}/>
              <YAxis tick={{fill:"#94a3b8",fontSize:11}}/>
              <Tooltip contentStyle={{background:"#1e293b",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6}}/>
              <Legend wrapperStyle={{fontSize:11,color:"#94a3b8"}}/>
              <Line type="monotone" dataKey="mishandled" stroke="#f87171" strokeWidth={2} dot={{r:3}} name="Mishandled"/>
              <Line type="monotone" dataKey="warnings" stroke="#facc15" strokeWidth={2} dot={{r:3}} name="Warnings"/>
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="panel overflow-x-auto p-0">
        <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex justify-between"><span>Agent Detail</span><span className="text-xs text-muted-foreground">{filtered.length} agents</span></div>
        <table className="w-full text-sm"><thead><tr className="border-b border-white/10 bg-white/5">{["Name","Start Date","HR","Work Hours","Tasks","Mishandled Tickets","Warning","Remarks"].map(h=><th key={h} className="px-3 py-3 text-left text-xs text-muted-foreground uppercase whitespace-nowrap">{h}</th>)}</tr></thead>
        <tbody>{filtered.length===0?<tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">No records match filters.</td></tr>:filtered.map((a:any,i:number)=>(
          <tr key={i} className={`border-b border-white/5 hover:bg-white/5 ${i%2!==0?"bg-white/[0.02]":""}`}>
            <td className="px-3 py-2.5 font-medium whitespace-nowrap">{a.name}</td><td className="px-3 py-2.5 text-xs text-muted-foreground">{a.startDate||'—'}</td>
            <td className="px-3 py-2.5 text-muted-foreground">{a.hr||'—'}</td><td className="px-3 py-2.5 text-xs text-muted-foreground">{a.workHours||'—'}</td>
            <td className="px-3 py-2.5 text-xs max-w-[200px] truncate" title={a.tasks||''}>{a.tasks||'—'}</td>
            <td className="px-3 py-2.5 text-xs">{a.mishandled?<span className="text-red-400 text-xs">{String(a.mishandled).slice(0,60)}{String(a.mishandled).length>60?'…':''}</span>:'—'}</td>
            <td className="px-3 py-2.5 text-center">{a.warning&&a.warning>0?<span className="px-2 py-0.5 rounded text-xs bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">{a.warning}</span>:'—'}</td>
            <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[150px] truncate" title={a.remarks||''}>{a.remarks||'—'}</td>
          </tr>
        ))}</tbody></table>
      </div>
    </main></div>
  );
}
