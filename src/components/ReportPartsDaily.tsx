import { useState, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend } from "recharts";
import { partsReportData } from "@/lib/reportData";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

const ALL_DATES=Object.keys(partsReportData).sort();
const ALL_BRANCHES=[...new Set(Object.values(partsReportData).flatMap((d:any)=>d.agents?.map((a:any)=>a.branch)||[]))].filter(Boolean).sort();
const ALL_ROLES=["Assistant","Associate","Training","Team Training"];
const COLORS=["#3b82f6","#22d3ee","#a78bfa","#34d399","#fb923c","#f472b6","#facc15","#60a5fa","#4ade80","#c084fc"];
const fmtDate=(s:string)=>{const c=s.replace(/^0/,'');return c.length===3?`${c[0]}/${c.slice(1)}/26`:`${c.slice(0,-2)}/${c.slice(-2)}/26`;};

export function ReportPartsDaily({mod,sub}:{mod:ModuleDef;sub:SubModuleDef}){
  const [date,setDate]=useState(ALL_DATES[0]);
  const [branchFilter,setBranchFilter]=useState("");
  const [roleFilter,setRoleFilter]=useState("");
  const [warningFilter,setWarningFilter]=useState("");

  const allAgents:any[]=useMemo(()=>(partsReportData as any)[date]?.agents||[],[date]);
  const filtered=useMemo(()=>{let a=allAgents;if(branchFilter)a=a.filter((x:any)=>String(x.branch||'')===branchFilter);if(roleFilter)a=a.filter((x:any)=>String(x.role||'').trim().toLowerCase().includes(roleFilter.toLowerCase()));if(warningFilter==="has")a=a.filter((x:any)=>x.warnings&&x.warnings!==0);return a;},[allAgents,branchFilter,roleFilter,warningFilter]);

  const branchChartData=useMemo(()=>{
    const map:Record<string,{collections:number,pendingRA:number,receives:number}> = {};
    filtered.forEach((a:any)=>{const b=String(a.branch||'Other');if(!map[b])map[b]={collections:0,pendingRA:0,receives:0};map[b].collections+=a.collections||0;map[b].pendingRA+=a.pendingRA||0;map[b].receives+=a.receives||0;});
    return Object.entries(map).map(([name,v])=>({name,...v})).sort((a,b)=>b.collections-a.collections).slice(0,12);
  },[filtered]);

  const agentChartData=filtered.slice(0,12).map((a:any)=>({name:a.name.split(' ')[0],collections:a.collections||0,receives:a.receives||0,pendingRA:a.pendingRA||0}));
  const trendData=ALL_DATES.slice(-10).map(dt=>{const agents=(partsReportData as any)[dt]?.agents||[];return{date:fmtDate(dt),collections:agents.reduce((s:number,a:any)=>s+(a.collections||0),0),receives:agents.reduce((s:number,a:any)=>s+(a.receives||0),0)};});

  const totalCollections=filtered.reduce((s:number,a:any)=>s+(a.collections||0),0);
  const totalPendingRA=filtered.reduce((s:number,a:any)=>s+(a.pendingRA||0),0);
  const totalReceives=filtered.reduce((s:number,a:any)=>s+(a.receives||0),0);
  const totalWarnings=filtered.reduce((s:number,a:any)=>s+(a.warnings||0),0);

  return(
    <div className="min-h-screen flex flex-col"><main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">
      <div className="flex items-center gap-3 mb-6"><Link to="/m/$module" params={{module:mod.slug}} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4"/></Link><h1 className="text-2xl font-bold">{sub.title}</h1></div>
      <div className="panel mb-6"><div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</label>
          <select value={date} onChange={e=>setDate(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md">{ALL_DATES.map(d=><option key={d} value={d}>{fmtDate(d)}</option>)}</select></div>
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Branch</label>
          <select value={branchFilter} onChange={e=>setBranchFilter(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md"><option value="">All Branches</option>{ALL_BRANCHES.map(b=><option key={b} value={b}>{b}</option>)}</select></div>
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Role</label>
          <select value={roleFilter} onChange={e=>setRoleFilter(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md"><option value="">All Roles</option>{ALL_ROLES.map(r=><option key={r} value={r}>{r}</option>)}</select></div>
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Warnings</label>
          <select value={warningFilter} onChange={e=>setWarningFilter(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md"><option value="">All</option><option value="has">Has Warning</option></select></div>
        {(branchFilter||roleFilter||warningFilter)&&<button onClick={()=>{setBranchFilter("");setRoleFilter("");setWarningFilter("");}} className="btn text-sm px-3 mb-0.5">Clear</button>}
        <span className="text-sm text-muted-foreground mb-0.5">{filtered.length} of {allAgents.length} staff</span>
      </div></div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[["Collections",totalCollections,"text-green-300"],["Pending RA",totalPendingRA,"text-yellow-300"],["Receives",totalReceives,"text-blue-300"],["Warnings",totalWarnings,"text-red-300"]].map(([l,v,c])=>(
          <div key={l as string} className="panel p-4 text-center"><p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{l}</p><p className={`text-3xl font-bold ${c}`}>{v}</p></div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="panel p-4">
          <p className="text-sm font-semibold mb-4">Collections by Branch</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={branchChartData} margin={{left:-10}}>
              <XAxis dataKey="name" tick={{fill:"#94a3b8",fontSize:9}} angle={-25} textAnchor="end" height={45}/>
              <YAxis tick={{fill:"#94a3b8",fontSize:11}}/>
              <Tooltip contentStyle={{background:"#1e293b",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6}}/>
              <Legend wrapperStyle={{fontSize:11,color:"#94a3b8"}}/>
              <Bar dataKey="collections" fill="#34d399" radius={[4,4,0,0]} name="Collections"/>
              <Bar dataKey="receives" fill="#3b82f6" radius={[4,4,0,0]} name="Receives"/>
              <Bar dataKey="pendingRA" fill="#fb923c" radius={[4,4,0,0]} name="Pending RA"/>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="panel p-4">
          <p className="text-sm font-semibold mb-4">Collections Trend — Last 10 Days</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={trendData} margin={{left:-10}}>
              <XAxis dataKey="date" tick={{fill:"#94a3b8",fontSize:10}}/>
              <YAxis tick={{fill:"#94a3b8",fontSize:11}}/>
              <Tooltip contentStyle={{background:"#1e293b",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6}}/>
              <Legend wrapperStyle={{fontSize:11,color:"#94a3b8"}}/>
              <Bar dataKey="collections" fill="#34d399" radius={[4,4,0,0]} name="Collections"/>
              <Bar dataKey="receives" fill="#3b82f6" radius={[4,4,0,0]} name="Receives"/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {agentChartData.length>0&&<div className="panel p-4 mb-4">
        <p className="text-sm font-semibold mb-4">Agent Collections (top 12)</p>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={agentChartData} margin={{left:-10}}>
            <XAxis dataKey="name" tick={{fill:"#94a3b8",fontSize:10}}/>
            <YAxis tick={{fill:"#94a3b8",fontSize:11}}/>
            <Tooltip contentStyle={{background:"#1e293b",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6}}/>
            <Bar dataKey="collections" radius={[4,4,0,0]} name="Collections">{agentChartData.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>}

      <div className="panel overflow-x-auto p-0">
        <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex justify-between"><span>Staff Detail</span><span className="text-xs text-muted-foreground">{filtered.length} staff</span></div>
        <table className="w-full text-sm"><thead><tr className="border-b border-white/10 bg-white/5">{["Branch","Name","Role","Collections","Pending RA","RA Created","Receives","Warnings"].map(h=><th key={h} className="px-3 py-3 text-left text-xs text-muted-foreground uppercase whitespace-nowrap">{h}</th>)}</tr></thead>
        <tbody>{filtered.length===0?<tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">No records match filters.</td></tr>:filtered.map((a:any,i:number)=>(
          <tr key={i} className={`border-b border-white/5 hover:bg-white/5 ${i%2!==0?"bg-white/[0.02]":""}`}>
            <td className="px-3 py-2.5 font-medium">{a.branch}</td><td className="px-3 py-2.5">{a.name}</td><td className="px-3 py-2.5 text-xs text-muted-foreground">{a.role||'—'}</td>
            <td className="px-3 py-2.5 text-center text-green-400 font-medium">{a.collections??'—'}</td><td className="px-3 py-2.5 text-center text-yellow-400">{a.pendingRA??'—'}</td>
            <td className="px-3 py-2.5 text-center">{a.raCreated??'—'}</td><td className="px-3 py-2.5 text-center text-blue-400">{a.receives??'—'}</td>
            <td className="px-3 py-2.5 text-center">{a.warnings?<span className="px-2 py-0.5 rounded text-xs bg-red-500/20 text-red-300 border border-red-500/30">{a.warnings}</span>:'—'}</td>
          </tr>
        ))}</tbody></table>
      </div>
    </main></div>
  );
}
