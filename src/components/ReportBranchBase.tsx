import { useState, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend, LineChart, Line, ReferenceLine } from "recharts";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

interface Props { mod:ModuleDef; sub:SubModuleDef; data:Record<string,{branches:any[]}>; }
const fmtDate=(s:string)=>{const c=s.trim().replace(/^0+/,'');return c.length===3?`${c[0]}/${c.slice(1)}/26`:`${c.slice(0,-2)}/${c.slice(-2)}/26`;};
const ltpColor=(v:number|null)=>v===null?'':(v>=50?'#34d399':v>=40?'#facc15':'#f87171');

export function ReportBranchBase({mod,sub,data}:Props){
  const DATES=Object.keys(data).sort();
  const [date,setDate]=useState(DATES[DATES.length-1]);
  const [branchFilter,setBranchFilter]=useState("");
  const [ltpThreshold,setLtpThreshold]=useState("");

  const allBranchNames=useMemo(()=>[...new Set(Object.values(data).flatMap(d=>d.branches?.map((b:any)=>b.branch)||[]))].filter(n=>n&&n.length>2&&!['Total','None'].includes(n)).sort(),[data]);
  const allBranches=useMemo(()=>data[date]?.branches||[],[date,data]);

  const filtered=useMemo(()=>{let b=allBranches;if(branchFilter)b=b.filter((x:any)=>x.branch===branchFilter);if(ltpThreshold==="below40")b=b.filter((x:any)=>x.dailyLTP!==null&&x.dailyLTP<40);if(ltpThreshold==="below50")b=b.filter((x:any)=>x.dailyLTP!==null&&x.dailyLTP<50);if(ltpThreshold==="above50")b=b.filter((x:any)=>x.dailyLTP!==null&&x.dailyLTP>=50);return b;},[allBranches,branchFilter,ltpThreshold]);

  const avgLTP=filtered.length>0?(filtered.reduce((s:number,b:any)=>s+(b.dailyLTP||0),0)/filtered.length).toFixed(1):'—';
  const totalAssigned=filtered.reduce((s:number,b:any)=>s+(b.assigned||0),0);
  const totalCompleted=filtered.reduce((s:number,b:any)=>s+(b.completed||0),0);
  const overallComp=totalAssigned>0?((totalCompleted/totalAssigned)*100).toFixed(1):'—';

  // Charts
  const ltpChartData=filtered.filter((b:any)=>b.dailyLTP!=null&&b.branch!=='Total').map((b:any)=>({name:b.branch,dailyLTP:b.dailyLTP,monthlyLTP:b.monthlyLTP})).sort((a:any,b:any)=>b.dailyLTP-a.dailyLTP);
  const completionChartData=filtered.filter((b:any)=>b.assigned&&b.branch!=='Total').map((b:any)=>({name:b.branch,assigned:b.assigned||0,completed:b.completed||0})).sort((a:any,b:any)=>b.assigned-a.assigned).slice(0,12);
  const trendData=DATES.slice(-10).map(dt=>{const branches=data[dt]?.branches||[];const v=branchFilter?branches.find((b:any)=>b.branch===branchFilter):null;const filtered2=v?[v]:branches.filter((b:any)=>b.branch!=='Total'&&b.dailyLTP!=null);const avg=filtered2.length>0?filtered2.reduce((s:number,b:any)=>s+(b.dailyLTP||0),0)/filtered2.length:0;return{date:fmtDate(dt),avgLTP:parseFloat(avg.toFixed(1))};});

  return(
    <div className="min-h-screen flex flex-col"><main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">
      <div className="flex items-center gap-3 mb-6"><Link to="/m/$module" params={{module:mod.slug}} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4"/></Link><h1 className="text-2xl font-bold">{sub.title}</h1></div>
      <div className="panel mb-6"><div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</label>
          <select value={date} onChange={e=>setDate(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md">{DATES.map(d=><option key={d} value={d}>{fmtDate(d)}</option>)}</select></div>
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Branch</label>
          <select value={branchFilter} onChange={e=>setBranchFilter(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md"><option value="">All Branches</option>{allBranchNames.map(b=><option key={b} value={b}>{b}</option>)}</select></div>
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">LTP Filter</label>
          <select value={ltpThreshold} onChange={e=>setLtpThreshold(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md"><option value="">All LTP</option><option value="below40">Below 40%</option><option value="below50">Below 50%</option><option value="above50">50% and Above</option></select></div>
        {(branchFilter||ltpThreshold)&&<button onClick={()=>{setBranchFilter("");setLtpThreshold("");}} className="btn text-sm px-3 mb-0.5">Clear</button>}
        <span className="text-sm text-muted-foreground mb-0.5">{filtered.length} of {allBranches.length} branches</span>
      </div></div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[["Avg Daily LTP",`${avgLTP}%`,"text-blue-300"],["Total Assigned",totalAssigned,"text-foreground"],["Total Completed",totalCompleted,"text-green-300"],["Overall Comp%",`${overallComp}%`,"text-yellow-300"]].map(([l,v,c])=>(
          <div key={l as string} className="panel p-4 text-center"><p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{l}</p><p className={`text-2xl font-bold ${c}`}>{v}</p></div>
        ))}
      </div>

      {/* LTP bar chart with color coding */}
      {ltpChartData.length>0&&<div className="panel p-4 mb-4">
        <p className="text-sm font-semibold mb-1">Daily LTP % by Branch <span className="text-xs font-normal text-muted-foreground ml-2">🟢 ≥50%  🟡 40–49%  🔴 &lt;40%</span></p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={ltpChartData} margin={{left:-10}}>
            <XAxis dataKey="name" tick={{fill:"#94a3b8",fontSize:9}} angle={-25} textAnchor="end" height={50}/>
            <YAxis tick={{fill:"#94a3b8",fontSize:11}} domain={[0,100]} tickFormatter={v=>`${v}%`}/>
            <Tooltip contentStyle={{background:"#1e293b",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6}} formatter={(v:any)=>`${v}%`}/>
            <ReferenceLine y={50} stroke="#34d399" strokeDasharray="4 2" label={{value:"50%",fill:"#34d399",fontSize:10}}/>
            <ReferenceLine y={40} stroke="#facc15" strokeDasharray="4 2" label={{value:"40%",fill:"#facc15",fontSize:10}}/>
            <Bar dataKey="dailyLTP" radius={[4,4,0,0]} name="Daily LTP">
              {ltpChartData.map((entry:any,i:number)=><Cell key={i} fill={ltpColor(entry.dailyLTP)}/>)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Assigned vs Completed */}
        {completionChartData.length>0&&<div className="panel p-4">
          <p className="text-sm font-semibold mb-4">Assigned vs Completed by Branch</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={completionChartData} margin={{left:-10}}>
              <XAxis dataKey="name" tick={{fill:"#94a3b8",fontSize:9}} angle={-20} textAnchor="end" height={45}/>
              <YAxis tick={{fill:"#94a3b8",fontSize:11}}/>
              <Tooltip contentStyle={{background:"#1e293b",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6}}/>
              <Legend wrapperStyle={{fontSize:11,color:"#94a3b8"}}/>
              <Bar dataKey="assigned" fill="#3b82f6" radius={[4,4,0,0]} name="Assigned"/>
              <Bar dataKey="completed" fill="#34d399" radius={[4,4,0,0]} name="Completed"/>
            </BarChart>
          </ResponsiveContainer>
        </div>}
        {/* LTP Trend */}
        <div className="panel p-4">
          <p className="text-sm font-semibold mb-4">Avg LTP Trend — Last 10 Days</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trendData} margin={{left:-10}}>
              <XAxis dataKey="date" tick={{fill:"#94a3b8",fontSize:10}}/>
              <YAxis tick={{fill:"#94a3b8",fontSize:11}} domain={[0,100]} tickFormatter={v=>`${v}%`}/>
              <Tooltip contentStyle={{background:"#1e293b",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6}} formatter={(v:any)=>`${v}%`}/>
              <ReferenceLine y={50} stroke="#34d399" strokeDasharray="4 2"/>
              <Line type="monotone" dataKey="avgLTP" stroke="#3b82f6" strokeWidth={2} dot={{r:3}} name="Avg LTP %"/>
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Data table */}
      <div className="panel overflow-x-auto p-0">
        <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex justify-between"><span>Branch Detail</span><span className="text-xs text-muted-foreground">{filtered.length} branches</span></div>
        <table className="w-full text-sm"><thead><tr className="border-b border-white/10 bg-white/5">
          {["Branch","Daily LTP%","Monthly LTP%","Assigned","Completed","Comp%","Staff","Training","AM Reschedules","Reasons"].map(h=>(
            <th key={h} className="px-3 py-3 text-left text-xs text-muted-foreground uppercase whitespace-nowrap">{h}</th>
          ))}
        </tr></thead>
        <tbody>{filtered.length===0?<tr><td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">No data for this date or filter.</td></tr>:filtered.map((b:any,i:number)=>{
          const ltp=b.dailyLTP;
          const ltpCls=ltp===null?'':(ltp>=50?'text-green-400':ltp>=40?'text-yellow-400':'text-red-400');
          return(
            <tr key={i} className={`border-b border-white/5 hover:bg-white/5 ${i%2!==0?"bg-white/[0.02]":""}`}>
              <td className="px-3 py-2.5 font-medium whitespace-nowrap">{b.branch}</td>
              <td className={`px-3 py-2.5 text-right font-semibold ${ltpCls}`}>{ltp!=null?`${ltp}%`:'—'}</td>
              <td className="px-3 py-2.5 text-right text-muted-foreground">{b.monthlyLTP!=null?`${b.monthlyLTP}%`:'—'}</td>
              <td className="px-3 py-2.5 text-right">{b.assigned??'—'}</td>
              <td className="px-3 py-2.5 text-right text-green-400">{b.completed??'—'}</td>
              <td className="px-3 py-2.5 text-right">{b.compPct!=null?`${b.compPct}%`:'—'}</td>
              <td className="px-3 py-2.5 text-center">{b.staff??'—'}</td>
              <td className="px-3 py-2.5 text-center text-yellow-400">{b.training??'—'}</td>
              <td className="px-3 py-2.5 text-center text-orange-400">{b.morningReschedule??'—'}</td>
              <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[160px] truncate" title={b.reasons||''}>{b.reasons||'—'}</td>
            </tr>
          );
        })}</tbody></table>
      </div>
    </main></div>
  );
}
