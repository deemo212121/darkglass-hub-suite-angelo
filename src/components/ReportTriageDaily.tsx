import { useState, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis } from "recharts";
import { triageReportData } from "@/lib/reportData";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

const KNOWN_AGENTS=["Kemuel Tamayo","Rocky Deles","Mark Marquez","Job Alberto","Angelo Husain","Jeselton Chu"];
const ALL_DATES=Object.keys(triageReportData).sort();
const ALL_AGENTS=[...new Set(Object.values(triageReportData).flatMap((d:any)=>d.agents?.map((a:any)=>a.name)||[]))].filter(n=>n&&n.length>3).sort();
const ALL_BRANDS=["GE","SQT","ASSURANT","ELECTROLUX","HISENSE","AIG","ASURION","MIELE","CENTRICITY","SPQ","MIDEA","NSA","FIDELITY","OOW","BUILDER","SS","LG","SERVICE BENCH","SPPN","INTERNAL"];
const COLORS=["#3b82f6","#22d3ee","#a78bfa","#34d399","#fb923c","#f472b6","#facc15","#60a5fa","#4ade80","#c084fc"];
const AG_COLORS:Record<string,string>={"Kemuel Tamayo":"#3b82f6","Rocky Deles":"#22d3ee","Mark Marquez":"#a78bfa","Job Alberto":"#34d399","Angelo Husain":"#fb923c","Jeselton Chu":"#f472b6"};
const fmtDate=(s:string)=>{const c=s.trim();return c.length===3?`${c[0]}/${c.slice(1)}/26`:`${c.slice(0,-2)}/${c.slice(-2)}/26`;};

export function ReportTriageDaily({mod,sub}:{mod:ModuleDef;sub:SubModuleDef}){
  const [date,setDate]=useState(ALL_DATES[ALL_DATES.length-1]);
  const [agentFilter,setAgentFilter]=useState("");
  const [brandFilter,setBrandFilter]=useState("");
  const [warningFilter,setWarningFilter]=useState("");

  const d=useMemo(()=>(triageReportData as any)[date]||{},[date]);
  const brands:Record<string,number>=d.brands||{};
  const brandsRem:Record<string,number>=d.brands_remaining||{};
  const allAgents:any[]=d.agents||[];
  const mistakeRemarks:any[]=d.mistake_remarks||[];

  const filteredAgents=useMemo(()=>{
    let a=allAgents;
    if(agentFilter) a=a.filter((x:any)=>x.name===agentFilter);
    if(warningFilter==="has") a=a.filter((x:any)=>x.warning&&x.warning>0);
    return a;
  },[allAgents,agentFilter,warningFilter]);

  const filteredBrands=useMemo(()=>brandFilter?{[brandFilter]:brands[brandFilter]??0}:brands,[brands,brandFilter]);
  const filteredBrandsRem=useMemo(()=>brandFilter?{[brandFilter]:brandsRem[brandFilter]??0}:brandsRem,[brandsRem,brandFilter]);

  // Chart data
  const agentBarData=filteredAgents.map((a:any)=>({name:a.name.split(' ')[0],complete:a.complete||0,remaining:a.remaining||0,pending:a.pending||0,monthly:a.monthlyComplete||0}));
  const brandBarData=Object.entries(filteredBrands).map(([name,val])=>({name,completed:Number(val),remaining:Number(filteredBrandsRem[name]||0)})).sort((a,b)=>b.completed-a.completed);
  const trendData=ALL_DATES.slice(-10).map(dt=>{const x=(triageReportData as any)[dt]||{};return{date:fmtDate(dt),completed:x.completed||0,remaining:x.remaining||0};});
  const radarData=filteredAgents.map((a:any)=>({name:a.name.split(' ')[0],complete:a.complete||0,remaining:a.remaining||0,pending:a.pending||0}));

  return(
    <div className="min-h-screen flex flex-col"><main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">
      <div className="flex items-center gap-3 mb-6"><Link to="/m/$module" params={{module:mod.slug}} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4"/></Link><h1 className="text-2xl font-bold">{sub.title}</h1></div>
      <div className="panel mb-6"><div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</label>
          <select value={date} onChange={e=>setDate(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md">{ALL_DATES.map(d=><option key={d} value={d}>{fmtDate(d)}</option>)}</select></div>
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Agent</label>
          <select value={agentFilter} onChange={e=>setAgentFilter(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md"><option value="">All Agents</option>{ALL_AGENTS.map(n=><option key={n} value={n}>{n}</option>)}</select></div>
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Brand</label>
          <select value={brandFilter} onChange={e=>setBrandFilter(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md"><option value="">All Brands</option>{ALL_BRANDS.filter(b=>b in brands).map(b=><option key={b} value={b}>{b}</option>)}</select></div>
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Warnings</label>
          <select value={warningFilter} onChange={e=>setWarningFilter(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md"><option value="">All</option><option value="has">Has Warning</option></select></div>
        {(agentFilter||brandFilter||warningFilter)&&<button onClick={()=>{setAgentFilter("");setBrandFilter("");setWarningFilter("");}} className="btn text-sm px-3 mb-0.5">Clear</button>}
      </div></div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[["Completed",d.completed,"text-green-300"],["Remaining",d.remaining,"text-yellow-300"],["Staff",d.staff,"text-blue-300"],["Training",d.training,"text-purple-300"]].map(([l,v,c])=>(
          <div key={l as string} className="panel p-4 text-center"><p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{l}</p><p className={`text-3xl font-bold ${c}`}>{v??'—'}</p></div>
        ))}
      </div>

      {/* Row 1: Agent bar chart + Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="panel p-4">
          <p className="text-sm font-semibold mb-4">Agent — Complete vs Remaining</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={agentBarData} margin={{left:-10}}>
              <XAxis dataKey="name" tick={{fill:"#94a3b8",fontSize:11}}/>
              <YAxis tick={{fill:"#94a3b8",fontSize:11}}/>
              <Tooltip contentStyle={{background:"#1e293b",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6}}/>
              <Legend wrapperStyle={{fontSize:11,color:"#94a3b8"}}/>
              <Bar dataKey="complete" fill="#34d399" radius={[4,4,0,0]} name="Complete"/>
              <Bar dataKey="remaining" fill="#fb923c" radius={[4,4,0,0]} name="Remaining"/>
              <Bar dataKey="pending" fill="#a78bfa" radius={[4,4,0,0]} name="Pending"/>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="panel p-4">
          <p className="text-sm font-semibold mb-4">Daily Trend — Last 10 Days</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={trendData} margin={{left:-10}}>
              <XAxis dataKey="date" tick={{fill:"#94a3b8",fontSize:10}}/>
              <YAxis tick={{fill:"#94a3b8",fontSize:11}}/>
              <Tooltip contentStyle={{background:"#1e293b",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6}}/>
              <Legend wrapperStyle={{fontSize:11,color:"#94a3b8"}}/>
              <Bar dataKey="completed" fill="#34d399" radius={[4,4,0,0]} name="Completed"/>
              <Bar dataKey="remaining" fill="#fb923c" radius={[4,4,0,0]} name="Remaining"/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Row 2: Brand chart */}
      <div className="panel p-4 mb-4">
        <p className="text-sm font-semibold mb-4">Brand — Completed vs Remaining</p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={brandBarData} margin={{left:-10}}>
            <XAxis dataKey="name" tick={{fill:"#94a3b8",fontSize:10}}/>
            <YAxis tick={{fill:"#94a3b8",fontSize:11}}/>
            <Tooltip contentStyle={{background:"#1e293b",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6}}/>
            <Legend wrapperStyle={{fontSize:11,color:"#94a3b8"}}/>
            <Bar dataKey="completed" fill="#3b82f6" radius={[4,4,0,0]} name="Completed"/>
            <Bar dataKey="remaining" fill="#f472b6" radius={[4,4,0,0]} name="Remaining"/>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Agent monthly bar */}
      <div className="panel p-4 mb-4">
        <p className="text-sm font-semibold mb-4">Agent Monthly Total</p>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={agentBarData} margin={{left:-10}}>
            <XAxis dataKey="name" tick={{fill:"#94a3b8",fontSize:11}}/>
            <YAxis tick={{fill:"#94a3b8",fontSize:11}}/>
            <Tooltip contentStyle={{background:"#1e293b",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6}}/>
            <Bar dataKey="monthly" radius={[4,4,0,0]} name="Monthly Total">
              {agentBarData.map((entry,i)=><Cell key={i} fill={AG_COLORS[filteredAgents[i]?.name]||COLORS[i%COLORS.length]}/>)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Agent table */}
      <div className="panel overflow-x-auto p-0 mb-4">
        <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex justify-between"><span>Agent Performance</span><span className="text-xs text-muted-foreground">{filteredAgents.length} of {allAgents.length}</span></div>
        <table className="w-full text-sm"><thead><tr className="border-b border-white/10 bg-white/5">
          {["Name","HR","Work Hours","Rate","Covered Locations","Pending","Warning","Sick","Vacation","Complete","Remaining","Mistakes","Monthly Total"].map(h=>(
            <th key={h} className="px-3 py-2.5 text-left text-xs text-muted-foreground uppercase whitespace-nowrap">{h}</th>
          ))}
        </tr></thead>
        <tbody>{filteredAgents.length===0?<tr><td colSpan={13} className="px-4 py-8 text-center text-muted-foreground">No agents match filter.</td></tr>:filteredAgents.map((a:any,i:number)=>(
          <tr key={i} className={`border-b border-white/5 hover:bg-white/5 ${i%2!==0?"bg-white/[0.02]":""}`}>
            <td className="px-3 py-2.5 font-medium whitespace-nowrap">{a.name}</td>
            <td className="px-3 py-2.5 text-center text-muted-foreground">{a.hr??'—'}</td>
            <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{a.workHours??'—'}</td>
            <td className="px-3 py-2.5 text-center">{a.rate??'—'}</td>
            <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[160px] truncate" title={a.covered||''}>{a.covered||'—'}</td>
            <td className="px-3 py-2.5 text-center text-yellow-400 font-medium">{a.pending??'—'}</td>
            <td className="px-3 py-2.5 text-center">{a.warning!=null&&a.warning>0?<span className="px-2 py-0.5 rounded text-xs bg-red-500/20 text-red-300 border border-red-500/30">{a.warning}</span>:'—'}</td>
            <td className="px-3 py-2.5 text-center text-muted-foreground">{a.sickDay??'—'}</td>
            <td className="px-3 py-2.5 text-center text-muted-foreground">{a.vacationDay??'—'}</td>
            <td className="px-3 py-2.5 text-center text-green-400 font-semibold">{a.complete??'—'}</td>
            <td className="px-3 py-2.5 text-center text-orange-400">{a.remaining??'—'}</td>
            <td className="px-3 py-2.5 text-center">{a.mistakes!=null&&a.mistakes>0?<span className="px-2 py-0.5 rounded text-xs bg-red-500/20 text-red-300 border border-red-500/30">{a.mistakes}</span>:'—'}</td>
            <td className="px-3 py-2.5 text-center text-blue-400">{a.monthlyComplete??'—'}</td>
          </tr>
        ))}</tbody></table>
      </div>

      {/* Mistake Remarks */}
      {mistakeRemarks.length>0&&<div className="panel p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm">Mistake Remarks</div>
        <table className="w-full text-sm"><thead><tr className="border-b border-white/10 bg-white/5"><th className="px-4 py-2 text-left text-xs text-muted-foreground uppercase w-40">Agent</th><th className="px-4 py-2 text-left text-xs text-muted-foreground uppercase">Remarks</th></tr></thead>
        <tbody>{KNOWN_AGENTS.filter(name=>!agentFilter||agentFilter===name).map(name=>{
          const remark=mistakeRemarks.find((r:any)=>r.agent===name);
          return(<tr key={name} className="border-b border-white/5 hover:bg-white/5"><td className="px-4 py-3 font-medium whitespace-nowrap text-blue-400">{name}</td><td className="px-4 py-3 text-sm text-muted-foreground">{remark?.remark||<span className="italic text-white/20">—</span>}</td></tr>);
        })}</tbody></table>
      </div>}
    </main></div>
  );
}
