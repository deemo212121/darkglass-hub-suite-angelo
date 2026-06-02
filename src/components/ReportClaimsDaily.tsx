import { useState, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { claimsReportData } from "@/lib/reportData";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

const ALL_DATES = Object.keys(claimsReportData).sort();
const ALL_BRANDS = ["GE","SQT","ASSURANT","AIG","SS","MIDEA"];
const COLORS = ["#3b82f6","#22d3ee","#a78bfa","#34d399","#fb923c","#f472b6","#facc15","#60a5fa"];
const fmtDate=(s:string)=>{const c=s.trim();return c.length===3?`${c[0]}/${c.slice(1)}/26`:`${c.slice(0,-2)}/${c.slice(-2)}/26`;};

export function ReportClaimsDaily({mod,sub}:{mod:ModuleDef;sub:SubModuleDef}){
  const [date,setDate]=useState(ALL_DATES[ALL_DATES.length-1]);
  const [brandFilter,setBrandFilter]=useState("");
  const [pendingFilter,setPendingFilter]=useState("");
  const d=useMemo(()=>(claimsReportData as any)[date]||{},[date]);
  const brands=d.brands||{};
  const pending=d.pending||{};
  const allPendingTypes=[...new Set(Object.values(claimsReportData).flatMap((x:any)=>Object.keys(x.pending||{})))].sort();
  const filteredBrands=brandFilter?Object.fromEntries(Object.entries(brands).filter(([b])=>b===brandFilter)):brands;
  const filteredPending=pendingFilter?Object.fromEntries(Object.entries(pending).filter(([t])=>t===pendingFilter)):pending;

  const brandChartData=Object.entries(filteredBrands).map(([name,value])=>({name,value:Number(value)})).sort((a,b)=>b.value-a.value);
  const pendingChartData=Object.entries(filteredPending).map(([name,value])=>({name,value:Number(value)}));
  const trendData=ALL_DATES.slice(-10).map(dt=>{const x=(claimsReportData as any)[dt]||{};return{date:fmtDate(dt),completed:x.completed||0,remaining:x.remaining||0};});

  return(
    <div className="min-h-screen flex flex-col"><main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
      <div className="flex items-center gap-3 mb-6"><Link to="/m/$module" params={{module:mod.slug}} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4"/></Link><h1 className="text-2xl font-bold">{sub.title}</h1></div>
      <div className="panel mb-6"><div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</label>
          <select value={date} onChange={e=>setDate(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md">{ALL_DATES.map(d=><option key={d} value={d}>{fmtDate(d)}</option>)}</select></div>
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Brand</label>
          <select value={brandFilter} onChange={e=>setBrandFilter(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md"><option value="">All Brands</option>{ALL_BRANDS.map(b=><option key={b} value={b}>{b}</option>)}</select></div>
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pending Type</label>
          <select value={pendingFilter} onChange={e=>setPendingFilter(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md"><option value="">All Types</option>{allPendingTypes.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
        {(brandFilter||pendingFilter)&&<button onClick={()=>{setBrandFilter("");setPendingFilter("");}} className="btn text-sm px-3 mb-0.5">Clear</button>}
      </div></div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[["Completed",d.completed,"text-green-300"],["Remaining",d.remaining,"text-yellow-300"],["Brands",Object.keys(brands).length,"text-blue-300"],["Pending Types",Object.keys(pending).length,"text-purple-300"]].map(([l,v,c])=>(
          <div key={l as string} className="panel p-4 text-center"><p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{l}</p><p className={`text-3xl font-bold ${c}`}>{v??'—'}</p></div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Brand bar chart */}
        <div className="panel p-4">
          <p className="text-sm font-semibold mb-4">Brand Breakdown — Completed</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={brandChartData} margin={{left:-10}}>
              <XAxis dataKey="name" tick={{fill:"#94a3b8",fontSize:11}} />
              <YAxis tick={{fill:"#94a3b8",fontSize:11}} />
              <Tooltip contentStyle={{background:"#1e293b",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6}} labelStyle={{color:"#f1f5f9"}} />
              <Bar dataKey="value" radius={[4,4,0,0]}>{brandChartData.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Pending pie chart */}
        <div className="panel p-4">
          <p className="text-sm font-semibold mb-4">Pending Breakdown</p>
          {pendingChartData.length>0
            ?<ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={pendingChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({name,value})=>`${name}: ${value}`} labelLine={false}>
                  {pendingChartData.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                </Pie>
                <Tooltip contentStyle={{background:"#1e293b",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6}} />
              </PieChart>
            </ResponsiveContainer>
            :<div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">No pending data.</div>}
        </div>
      </div>

      {/* Trend line */}
      <div className="panel p-4 mb-4">
        <p className="text-sm font-semibold mb-4">Completed vs Remaining — Last 10 Days</p>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={trendData} margin={{left:-10}}>
            <XAxis dataKey="date" tick={{fill:"#94a3b8",fontSize:10}} />
            <YAxis tick={{fill:"#94a3b8",fontSize:11}} />
            <Tooltip contentStyle={{background:"#1e293b",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6}} />
            <Legend wrapperStyle={{fontSize:12,color:"#94a3b8"}} />
            <Bar dataKey="completed" fill="#34d399" radius={[4,4,0,0]} name="Completed" />
            <Bar dataKey="remaining" fill="#fb923c" radius={[4,4,0,0]} name="Remaining" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Tables */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="panel p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex justify-between"><span>Brand Table</span><span className="text-xs text-muted-foreground">{Object.keys(filteredBrands).length} brands</span></div>
          <table className="w-full text-sm"><thead><tr className="border-b border-white/10 bg-white/5"><th className="px-4 py-2 text-left text-xs text-muted-foreground uppercase">Brand</th><th className="px-4 py-2 text-right text-xs text-muted-foreground uppercase">Count</th></tr></thead>
          <tbody>{Object.entries(filteredBrands).sort(([,a],[,b])=>Number(b)-Number(a)).map(([b,c])=><tr key={b} className="border-b border-white/5 hover:bg-white/5"><td className="px-4 py-2.5 font-medium">{b}</td><td className="px-4 py-2.5 text-right text-blue-400 font-semibold">{String(c)}</td></tr>)}</tbody></table>
        </div>
        <div className="panel p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex justify-between"><span>Pending Table</span><span className="text-xs text-muted-foreground">{Object.keys(filteredPending).length} types</span></div>
          <table className="w-full text-sm"><thead><tr className="border-b border-white/10 bg-white/5"><th className="px-4 py-2 text-left text-xs text-muted-foreground uppercase">Type</th><th className="px-4 py-2 text-right text-xs text-muted-foreground uppercase">Count</th></tr></thead>
          <tbody>{Object.keys(filteredPending).length===0?<tr><td colSpan={2} className="px-4 py-8 text-center text-muted-foreground text-sm">No pending data.</td></tr>:Object.entries(filteredPending).map(([t,c])=><tr key={t} className="border-b border-white/5 hover:bg-white/5"><td className="px-4 py-2.5">{t}</td><td className="px-4 py-2.5 text-right text-yellow-400 font-semibold">{String(c)}</td></tr>)}</tbody></table>
        </div>
      </div>
    </main></div>
  );
}
