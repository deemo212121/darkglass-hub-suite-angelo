import { useState, useMemo } from "react";
import { exportToCSV } from "@/lib/csvExport";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, AlertTriangle, Search, X } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, LineChart, Line } from "recharts";
import { csrReportData } from "@/lib/reportData";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

const ALL_DATES=Object.keys(csrReportData).sort();
const ALL_TEAMS=["TEAM DANIELA","TEAM ROBYN","TEAM ROCHELLE","TEAM SHANE"];
const TEAM_COLORS:Record<string,string>={"TEAM DANIELA":"#3b82f6","TEAM ROBYN":"#34d399","TEAM ROCHELLE":"#a78bfa","TEAM SHANE":"#fb923c"};
const fmtDate=(s:string)=>{const c=s.trim().replace(/^0/,'');return c.length===3?`${c[0]}/${c.slice(1)}/26`:`${c.slice(0,-2)}/${c.slice(-2)}/26`;};

function parseMistakeBadges(raw:string):string[]{
  if(!raw||raw==='null')return[];
  const s=raw.trim();
  if(/^EXT\s/i.test(s))return[s];
  if(s.length>20&&!/\d\/\d/.test(s))return[s];
  const normalised=s.replace(/\s*\/\s*/g,' / ').replace(/\s+/g,' ').trim();
  const slashParts=normalised.split(' / ').map(p=>p.trim()).filter(Boolean);
  const tokens:string[]=[];
  for(const part of slashParts){
    const dateRe=/(\d+\s+)?(\d{1,2}\/\d{1,2})/g;
    let lastIdx=0,m:RegExpExecArray|null;
    const subTokens:string[]=[];
    while((m=dateRe.exec(part))!==null){
      const prefix=m[1]?m[1].trim():'';
      subTokens.push(prefix?`${prefix} · ${m[2]}`:m[2]);
      lastIdx=m.index+m[0].length;
    }
    if(subTokens.length===0){tokens.push(part);}
    else{tokens.push(...subTokens);const tail=part.slice(lastIdx).trim();if(tail)tokens.push(tail);}
  }
  return tokens.length>0?tokens:[s];
}

function extractMistakeDates(raw:string):Array<{m:number,d:number}>{
  if(!raw||raw==='null')return[];
  const out:Array<{m:number,d:number}>=[];
  const re=/(\d{1,2})\/(\d{1,2})/g;
  let m:RegExpExecArray|null;
  while((m=re.exec(raw))!==null){out.push({m:parseInt(m[1]),d:parseInt(m[2])});}
  return out;
}

function parseDateInput(v:string):{m:number,d:number}|null{
  if(!v)return null;
  const p=v.split('-');
  if(p.length<3)return null;
  return{m:parseInt(p[1]),d:parseInt(p[2])};
}

function dateGte(a:{m:number,d:number},b:{m:number,d:number}){return a.m!==b.m?a.m>b.m:a.d>=b.d;}
function dateLte(a:{m:number,d:number},b:{m:number,d:number}){return a.m!==b.m?a.m<b.m:a.d<=b.d;}

export function ReportCSRDaily({mod,sub}:{mod:ModuleDef;sub:SubModuleDef}){
  // Top-bar filters
  const [date,setDate]=useState(ALL_DATES[ALL_DATES.length-1]);
  const [teamFilter,setTeamFilter]=useState("");
  const [taskFilter,setTaskFilter]=useState("");
  const [mistakeFilter,setMistakeFilter]=useState("");
  const [warningFilter,setWarningFilter]=useState("");

  // Agent table filters (replaces old Mistake Details section)
  const [tblNameSearch,setTblNameSearch]=useState("");
  const [tblTeam,setTblTeam]=useState("");
  const [tblDateFrom,setTblDateFrom]=useState("");
  const [tblDateTo,setTblDateTo]=useState("");

  const allAgents:any[]=useMemo(()=>(csrReportData as any)[date]?.agents||[],[date]);

  // Primary filtered list (top-bar filters)
  const primaryFiltered=useMemo(()=>{
    let a=allAgents;
    if(teamFilter) a=a.filter((x:any)=>x.team===teamFilter);
    if(taskFilter) a=a.filter((x:any)=>x.task&&x.task.toLowerCase().includes(taskFilter.toLowerCase()));
    if(mistakeFilter==="has") a=a.filter((x:any)=>x.mistake&&x.mistake!=='null');
    if(warningFilter==="has") a=a.filter((x:any)=>x.warning&&x.warning>0);
    return a;
  },[allAgents,teamFilter,taskFilter,mistakeFilter,warningFilter]);

  // Table-level filters applied on top of primary
  const filtered=useMemo(()=>{
    const fromParsed=parseDateInput(tblDateFrom);
    const toParsed=parseDateInput(tblDateTo);
    return primaryFiltered.filter((a:any)=>{
      if(tblNameSearch&&!a.name.toLowerCase().includes(tblNameSearch.toLowerCase()))return false;
      if(tblTeam&&a.team!==tblTeam)return false;
      if(fromParsed||toParsed){
        if(!a.mistake||a.mistake==='null')return false;
        const dates=extractMistakeDates(a.mistake);
        if(dates.length===0)return false;
        const inRange=dates.some(d=>{
          const fromOk=!fromParsed||dateGte(d,fromParsed);
          const toOk=!toParsed||dateLte(d,toParsed);
          return fromOk&&toOk;
        });
        if(!inRange)return false;
      }
      return true;
    });
  },[primaryFiltered,tblNameSearch,tblTeam,tblDateFrom,tblDateTo]);

  const tblHasFilters=!!(tblNameSearch||tblTeam||tblDateFrom||tblDateTo);
  const clearTblFilters=()=>{setTblNameSearch("");setTblTeam("");setTblDateFrom("");setTblDateTo("");};

  const teamSummaries=useMemo(()=>(teamFilter?[teamFilter]:ALL_TEAMS).map(t=>{
    const ta=allAgents.filter((a:any)=>a.team===t);
    return{team:t,count:ta.length,totalGH:ta.reduce((s:number,a:any)=>s+(Number(a.gh)||0),0),totalSchedule:ta.reduce((s:number,a:any)=>s+(Number(a.schedule)||0),0),totalAttempt:ta.reduce((s:number,a:any)=>s+(Number(a.attempt)||0),0),totalUpdate:ta.reduce((s:number,a:any)=>s+(Number(a.update)||0),0),warnings:ta.reduce((s:number,a:any)=>s+(Number(a.warning)||0),0),mistakes:ta.filter((a:any)=>a.mistake&&a.mistake!=='null').length};
  }).filter(s=>s.count>0),[allAgents,teamFilter]);

  const teamBarData=teamSummaries.map(s=>({name:s.team.replace("TEAM ",""),GH:s.totalGH,Schedule:s.totalSchedule,Attempt:s.totalAttempt,Update:s.totalUpdate}));
  const agentBarData=primaryFiltered.slice(0,12).map((a:any)=>({name:a.name.split(' ')[0],total:a.total||0,schedule:a.schedule||0,attempt:a.attempt||0,update:a.update||0}));
  const trendData=ALL_DATES.slice(-10).map(dt=>{
    const agents=(csrReportData as any)[dt]?.agents||[];
    const ta=teamFilter?agents.filter((a:any)=>a.team===teamFilter):agents;
    return{date:fmtDate(dt),totalGH:ta.reduce((s:number,a:any)=>s+(Number(a.gh)||0),0),schedule:ta.reduce((s:number,a:any)=>s+(Number(a.schedule)||0),0)};
  });

  const taskColor=(t:string|null)=>{if(!t)return'';if(t==='In')return'bg-green-500/20 text-green-300';if(t==='Out')return'bg-blue-500/20 text-blue-300';if(t==='Absent')return'bg-red-500/20 text-red-300';return'bg-purple-500/20 text-purple-300';};

  const handleExportCSV=()=>{
    exportToCSV("csr_daily_report",
      ["Team","Name","Start Date","Task","GH","Total","Schedule","Attempt","Update","Mistake","Warning"],
      filtered.map((a:any)=>[a.team,a.name,a.startDate,a.task,a.gh,a.total,a.schedule,a.attempt,a.update,a.mistake,a.warning])
    );
  };

  return(
    <div className="min-h-screen flex flex-col"><main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/m/$module/$submodule" params={{module:"dashboard",submodule:"csr-dashboard"}} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4"/></Link>
        <h1 className="text-2xl font-bold">{sub.title}</h1>
      </div>

      {/* Top-bar filters */}
      <div className="panel mb-6"><div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</label>
          <select value={date} onChange={e=>setDate(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md">{ALL_DATES.map(d=><option key={d} value={d}>{fmtDate(d)}</option>)}</select></div>
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Team</label>
          <select value={teamFilter} onChange={e=>setTeamFilter(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md"><option value="">All Teams</option>{ALL_TEAMS.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Task</label>
          <select value={taskFilter} onChange={e=>setTaskFilter(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md"><option value="">All</option><option value="In">In</option><option value="Out">Out</option><option value="Absent">Absent</option></select></div>
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Mistakes</label>
          <select value={mistakeFilter} onChange={e=>setMistakeFilter(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md"><option value="">All</option><option value="has">Has Mistakes</option></select></div>
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Warnings</label>
          <select value={warningFilter} onChange={e=>setWarningFilter(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md"><option value="">All</option><option value="has">Has Warnings</option></select></div>
        {(teamFilter||taskFilter||mistakeFilter||warningFilter)&&
          <button onClick={()=>{setTeamFilter("");setTaskFilter("");setMistakeFilter("");setWarningFilter("");}} className="btn text-sm px-3 mb-0.5">Clear</button>}
        <span className="text-sm text-muted-foreground mb-0.5">{primaryFiltered.length} of {allAgents.length} agents</span>
      </div></div>

      {/* Team summary cards */}
      {teamSummaries.length>0&&<div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {teamSummaries.map(s=>(
          <div key={s.team} className="panel p-4">
            <p className="text-xs font-semibold mb-2" style={{color:TEAM_COLORS[s.team]||"#94a3b8"}}>{s.team}</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <span className="text-muted-foreground">Agents</span><span className="text-right font-medium">{s.count}</span>
              <span className="text-muted-foreground">GH Total</span><span className="text-right text-blue-300 font-semibold">{s.totalGH}</span>
              <span className="text-muted-foreground">Schedule</span><span className="text-right text-green-300">{s.totalSchedule}</span>
              <span className="text-muted-foreground">Attempt</span><span className="text-right">{s.totalAttempt}</span>
              <span className="text-muted-foreground">Update</span><span className="text-right">{s.totalUpdate}</span>
              <span className="text-muted-foreground">Warnings</span><span className={`text-right ${s.warnings>0?'text-red-300':''}`}>{s.warnings}</span>
              <span className="text-muted-foreground">Mistakes</span><span className={`text-right ${s.mistakes>0?'text-orange-300':''}`}>{s.mistakes}</span>
            </div>
          </div>
        ))}
      </div>}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="panel p-4">
          <p className="text-sm font-semibold mb-4">Team Performance Comparison</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={teamBarData} margin={{left:-10}}>
              <XAxis dataKey="name" tick={{fill:"#94a3b8",fontSize:11}}/><YAxis tick={{fill:"#94a3b8",fontSize:11}}/>
              <Tooltip contentStyle={{background:"#1e293b",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6}}/><Legend wrapperStyle={{fontSize:11,color:"#94a3b8"}}/>
              <Bar dataKey="GH" fill="#3b82f6" radius={[4,4,0,0]}/><Bar dataKey="Schedule" fill="#34d399" radius={[4,4,0,0]}/>
              <Bar dataKey="Attempt" fill="#a78bfa" radius={[4,4,0,0]}/><Bar dataKey="Update" fill="#fb923c" radius={[4,4,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="panel p-4">
          <p className="text-sm font-semibold mb-4">GH Trend — Last 10 Days</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trendData} margin={{left:-10}}>
              <XAxis dataKey="date" tick={{fill:"#94a3b8",fontSize:10}}/><YAxis tick={{fill:"#94a3b8",fontSize:11}}/>
              <Tooltip contentStyle={{background:"#1e293b",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6}}/><Legend wrapperStyle={{fontSize:11,color:"#94a3b8"}}/>
              <Line type="monotone" dataKey="totalGH" stroke="#3b82f6" strokeWidth={2} dot={{r:3}} name="Total GH"/>
              <Line type="monotone" dataKey="schedule" stroke="#34d399" strokeWidth={2} dot={{r:3}} name="Schedule"/>
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {agentBarData.length>0&&<div className="panel p-4 mb-4">
        <p className="text-sm font-semibold mb-4">Agent — GH & Schedule (top 12)</p>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={agentBarData} margin={{left:-10}}>
            <XAxis dataKey="name" tick={{fill:"#94a3b8",fontSize:10}}/><YAxis tick={{fill:"#94a3b8",fontSize:11}}/>
            <Tooltip contentStyle={{background:"#1e293b",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6}}/><Legend wrapperStyle={{fontSize:11,color:"#94a3b8"}}/>
            <Bar dataKey="total" fill="#3b82f6" radius={[4,4,0,0]} name="GH"/>
            <Bar dataKey="schedule" fill="#34d399" radius={[4,4,0,0]} name="Schedule"/>
          </BarChart>
        </ResponsiveContainer>
      </div>}

      {/* ── Agent Details Table ── */}
      <div className="panel overflow-x-auto p-0">
        {/* Table header with inline filters */}
        <div className="px-4 py-3 border-b border-white/10">
          <div className="flex flex-wrap items-end gap-3">
            <span className="font-semibold text-sm mr-1">Agent Details</span>
            {/* Employee name search */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Employee Name</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"/>
                <input value={tblNameSearch} onChange={e=>setTblNameSearch(e.target.value)} placeholder="Search name…"
                  className="glass-input text-sm py-1.5 pl-8 pr-3 rounded-md w-40"/>
              </div>
            </div>
            {/* Team filter */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Team</label>
              <select value={tblTeam} onChange={e=>setTblTeam(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md">
                <option value="">All Teams</option>
                {ALL_TEAMS.map(t=><option key={t} value={t}>{t.replace('TEAM ','')}</option>)}
              </select>
            </div>
            {/* Mistake date from */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Mistake Date From</label>
              <input type="date" value={tblDateFrom} onChange={e=>setTblDateFrom(e.target.value)}
                className="glass-input text-sm py-1.5 px-3 rounded-md" style={{colorScheme:"dark"}}/>
            </div>
            {/* Mistake date to */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Mistake Date To</label>
              <input type="date" value={tblDateTo} onChange={e=>setTblDateTo(e.target.value)}
                className="glass-input text-sm py-1.5 px-3 rounded-md" style={{colorScheme:"dark"}}/>
            </div>
            {tblHasFilters&&(
              <button onClick={clearTblFilters}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-white/10 border border-white/10 transition-colors self-end mb-0.5">
                <X className="h-3.5 w-3.5"/>Clear
              </button>
            )}
            {/* Spacer + count + CSV */}
            <div className="ml-auto flex items-center gap-2 self-end mb-0.5">
              <span className="text-xs text-muted-foreground">
                {filtered.length}{tblHasFilters&&filtered.length!==primaryFiltered.length?` of ${primaryFiltered.length}`:''} agents
              </span>
              <button onClick={handleExportCSV} title="Download CSV"
                className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              </button>
            </div>
          </div>
        </div>

        <table className="w-full text-sm">
          <thead><tr className="border-b border-white/10 bg-white/5">
            {["Team","Name","Start Date","Task","GH","Total","Schedule","Attempt","Update","Mistakes","Warning"].map(h=>(
              <th key={h} className="px-3 py-2.5 text-left text-xs text-muted-foreground uppercase whitespace-nowrap">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {filtered.length===0
              ?<tr><td colSpan={11} className="px-4 py-12 text-center text-muted-foreground">No records match filters.</td></tr>
              :filtered.map((a:any,i:number)=>{
                const hasMistake=a.mistake&&a.mistake!=='null';
                const badgeCount=hasMistake?parseMistakeBadges(a.mistake).length:0;
                const employeeId=encodeURIComponent(a.name);
                return(
                  <tr key={i} className={`border-b border-white/5 hover:bg-white/5 ${i%2!==0?"bg-white/[0.02]":""}`}>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap" style={{color:TEAM_COLORS[a.team]||"#94a3b8"}}>{a.team||'—'}</td>
                    {/* Clickable name — opens employee mistake detail page */}
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <a href={`/csr/mistake/${employeeId}`} target="_blank" rel="noopener noreferrer"
                        className="font-medium hover:text-blue-300 hover:underline underline-offset-2 transition-colors">
                        {a.name}
                      </a>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{a.startDate||'—'}</td>
                    <td className="px-3 py-2.5"><span className={`px-1.5 py-0.5 rounded text-xs font-medium ${taskColor(a.task)}`}>{a.task||'—'}</span></td>
                    <td className="px-3 py-2.5 text-right font-semibold text-blue-400">{a.gh??'—'}</td>
                    <td className="px-3 py-2.5 text-right font-semibold">{a.total??'—'}</td>
                    <td className="px-3 py-2.5 text-right text-green-400">{a.schedule??'—'}</td>
                    <td className="px-3 py-2.5 text-right">{a.attempt??'—'}</td>
                    <td className="px-3 py-2.5 text-right">{a.update??'—'}</td>
                    <td className="px-3 py-2.5 text-center">
                      {hasMistake
                        ?<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/15 text-red-400 border border-red-500/25">
                            <AlertTriangle className="h-3 w-3"/>{badgeCount}
                          </span>
                        :<span className="text-white/20">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {a.warning&&a.warning>0
                        ?<span className="px-1.5 py-0.5 rounded text-xs bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">{a.warning}</span>
                        :'—'}
                    </td>
                  </tr>
                );
              })
            }
          </tbody>
        </table>
      </div>

    </main></div>
  );
}
