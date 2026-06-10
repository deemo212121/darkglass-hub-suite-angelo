import { useState, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Plus, Trash2, Clock, AlertCircle, ArrowUpDown } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, LineChart, Line } from "recharts";
import { hrReportData } from "@/lib/reportData";
import { LOCATIONS_DATA } from "@/lib/zipCoverage";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

const ALL_DATES=Object.keys(hrReportData).sort();
const fmtDate=(s:string)=>{const c=s.trim();return c.length===2?`5/${c}/26`:`${c.slice(0,-2)}/${c.slice(-2)}/26`;};
const ALL_US_BRANCHES = LOCATIONS_DATA.filter(l => !l.isPhilippines).map(l => l.location).sort();
const ALL_PH_BRANCHES = LOCATIONS_DATA.filter(l => l.isPhilippines).map(l => l.location).sort();

interface InterviewCandidate {
  id: string;
  name: string;
  position: string;
  branch: string;
  interviewDate: string;
  interviewTime: string;
  status: "scheduled" | "completed" | "hired" | "rejected";
  notes: string;
}

interface Employee {
  id: string;
  name: string;
  email: string;
  position: string;
  branch: string;
  country: "US" | "PH";
  birthday: string;
  address: string;
  ssn?: string;
  startDate: string;
  terminationDate?: string;
  terminationReason?: string;
  status: "active" | "inactive" | "terminated" | "resigned";
  warningCount: number;
  inTraining?: boolean;
}

export function ReportHRDaily({mod,sub}:{mod:ModuleDef;sub:SubModuleDef}){
  const [date,setDate]=useState(ALL_DATES[ALL_DATES.length-1]);
  const [section,setSection]=useState<"us"|"ph">("us");
  const [branchFilter,setBranchFilter]=useState("");
  const [warningFilter,setWarningFilter]=useState("");
  
  // Interview management state
  const [showAddInterview, setShowAddInterview] = useState(false);
  const [candidates, setCandidates] = useState<InterviewCandidate[]>([
    { id: "1", name: "John Smith", position: "Technician", branch: "Atlanta", interviewDate: "2026-06-10", interviewTime: "10:00", status: "scheduled", notes: "Phone interview" },
    { id: "2", name: "Sarah Johnson", position: "CSR", branch: "Nashville", interviewDate: "2026-06-10", interviewTime: "14:30", status: "scheduled", notes: "In-person interview" },
    { id: "3", name: "Mike Davis", position: "Technician", branch: "Memphis", interviewDate: "2026-06-12", interviewTime: "09:30", status: "scheduled", notes: "Strong technical background" },
    { id: "4", name: "Emily Wilson", position: "Tech Manager", branch: "Birmingham", interviewDate: "2026-06-15", interviewTime: "11:00", status: "scheduled", notes: "Excellent fit for team" },
  ]);
  
  const [newCandidate, setNewCandidate] = useState<Partial<InterviewCandidate>>({
    name: "",
    position: "",
    branch: "",
    interviewDate: "",
    interviewTime: "",
    status: "scheduled",
    notes: "",
  });

  // Employee management state
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([
    { id: "e1", name: "Alex Chen", email: "alex.chen@company.com", position: "Tech Manager", branch: "Atlanta", country: "US", birthday: "1990-03-15", address: "123 Main St, Atlanta, GA 30301", ssn: "123-45-6789", startDate: "2024-01-10", status: "active", warningCount: 0, inTraining: false },
    { id: "e2", name: "Maria Santos", email: "maria.santos@company.com", position: "CSR", branch: "Manila", country: "PH", birthday: "1992-07-22", address: "456 Business Ave, Manila, PH", startDate: "2023-06-20", status: "active", warningCount: 1, inTraining: true },
  ]);

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{ show: boolean; employeeId: string; employeeName: string; newStatus: Employee["status"] } | null>(null);

  const [employeeFilters, setEmployeeFilters] = useState({
    status: "" as "" | "active" | "inactive" | "terminated" | "resigned",
    branch: "",
    sortBy: "name" as "name" | "startDate" | "warnings",
    sortOrder: "asc" as "asc" | "desc",
  });

  const [newEmployee, setNewEmployee] = useState<Partial<Employee>>({
    name: "",
    email: "",
    position: "",
    branch: "",
    country: "US",
    birthday: "",
    address: "",
    ssn: "",
    startDate: "",
    status: "active",
    warningCount: 0,
    inTraining: false,
  });

  // Calculate today's date
  const today = new Date().toISOString().slice(0, 10);
  
  // Get today's interviews
  const todaysInterviews = useMemo(() => {
    return candidates.filter(c => c.interviewDate === today && c.status === "scheduled");
  }, [candidates, today]);

  // Filtered and sorted employees
  const filteredEmployees = useMemo(() => {
    let result = [...employees];
    
    if (employeeFilters.status) {
      result = result.filter(e => e.status === employeeFilters.status);
    }
    if (employeeFilters.branch) {
      result = result.filter(e => e.branch === employeeFilters.branch);
    }
    
    // Sort
    result.sort((a, b) => {
      let compareVal = 0;
      if (employeeFilters.sortBy === "name") {
        compareVal = a.name.localeCompare(b.name);
      } else if (employeeFilters.sortBy === "startDate") {
        compareVal = new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
      } else if (employeeFilters.sortBy === "warnings") {
        compareVal = a.warningCount - b.warningCount;
      }
      return employeeFilters.sortOrder === "asc" ? compareVal : -compareVal;
    });
    
    return result;
  }, [employees, employeeFilters]);

  // Get all branches for filters - use actual locations from LOCATIONS_DATA
  const allBranches = useMemo(() => {
    return LOCATIONS_DATA.map(l => l.location).sort();
  }, []);

  const d=useMemo(()=>(hrReportData as any)[date]||{},[date]);
  const sectionData=d[section]||{interviews:[],warnings:[]};

  const interviews:any[]=useMemo(()=>{let r=sectionData.interviews||[];if(branchFilter)r=r.filter((x:any)=>x.branch===branchFilter);return r;},[sectionData,branchFilter]);
  const warnings:any[]=useMemo(()=>{let r=sectionData.warnings||[];if(branchFilter)r=r.filter((x:any)=>x.branch===branchFilter);if(warningFilter==="timecard")r=r.filter((x:any)=>x.timecardWarning&&x.timecardWarning>0);if(warningFilter==="employee")r=r.filter((x:any)=>x.employeeError&&x.employeeError>0);return r;},[sectionData,branchFilter,warningFilter]);

  const totalHired=interviews.reduce((s:number,r:any)=>s+(Number(r.hired)||0),0);
  const totalScheduled=interviews.reduce((s:number,r:any)=>s+(Number(r.scheduled)||0),0);
  const totalTCW=warnings.reduce((s:number,r:any)=>s+(Number(r.timecardWarning)||0),0);
  const totalEE=warnings.reduce((s:number,r:any)=>s+(Number(r.employeeError)||0),0);

  // Interview candidate metrics
  const hiredCount = candidates.filter(c => c.status === "hired").length;
  const scheduledCount = candidates.filter(c => c.status === "scheduled").length;

  // Chart data
  const interviewBarData=interviews.filter(r=>r.branch&&r.scheduled!=null).map(r=>({name:r.branch,scheduled:r.scheduled||0,hired:Number(r.hired)||0})).sort((a,b)=>b.scheduled-a.scheduled).slice(0,15);
  const warningBarData=warnings.filter(r=>r.branch&&(r.timecardWarning||r.employeeError)).map(r=>({name:r.branch,timecard:r.timecardWarning||0,employee:r.employeeError||0}));
  const trendData=ALL_DATES.slice(-10).map(dt=>{const x=((hrReportData as any)[dt]||{})[section]||{};const iv=x.interviews||[];const wn=x.warnings||[];return{date:fmtDate(dt),hired:iv.reduce((s:number,r:any)=>s+(Number(r.hired)||0),0),warnings:wn.reduce((s:number,r:any)=>s+(r.timecardWarning||0)+(r.employeeError||0),0)};});

  const branchOptions=section==="us"?ALL_US_BRANCHES:ALL_PH_BRANCHES;

  const handleAddCandidate = () => {
    if (newCandidate.name && newCandidate.position && newCandidate.branch && newCandidate.interviewDate && newCandidate.interviewTime) {
      setCandidates([...candidates, {
        id: Date.now().toString(),
        name: newCandidate.name || "",
        position: newCandidate.position || "",
        branch: newCandidate.branch || "",
        interviewDate: newCandidate.interviewDate || "",
        interviewTime: newCandidate.interviewTime || "",
        status: "scheduled",
        notes: newCandidate.notes || "",
      }]);
      setNewCandidate({ name: "", position: "", branch: "", interviewDate: "", interviewTime: "", status: "scheduled", notes: "" });
      setShowAddInterview(false);
    }
  };

  const handleUpdateStatus = (id: string, newStatus: InterviewCandidate["status"]) => {
    setCandidates(candidates.map(c => c.id === id ? { ...c, status: newStatus } : c));
  };

  const handleDeleteCandidate = (id: string) => {
    setCandidates(candidates.filter(c => c.id !== id));
  };

  // Employee handlers
  const handleAddEmployee = () => {
    if (newEmployee.name && newEmployee.email && newEmployee.position && newEmployee.branch && newEmployee.birthday && newEmployee.address && newEmployee.startDate) {
      const employee: Employee = {
        id: Date.now().toString(),
        name: newEmployee.name,
        email: newEmployee.email,
        position: newEmployee.position,
        branch: newEmployee.branch,
        country: newEmployee.country || "US",
        birthday: newEmployee.birthday,
        address: newEmployee.address,
        ssn: newEmployee.country === "US" ? newEmployee.ssn : undefined,
        startDate: newEmployee.startDate,
        status: "active",
        warningCount: 0,
        inTraining: newEmployee.inTraining || false,
      };
      setEmployees([...employees, employee]);
      setNewEmployee({ name: "", email: "", position: "", branch: "", country: "US", birthday: "", address: "", ssn: "", startDate: "", status: "active", warningCount: 0 });
      setShowAddEmployee(false);
    }
  };

  const handleCreateAccountFromInterview = (candidate: InterviewCandidate) => {
    const email = `${candidate.name.toLowerCase().replace(/\s+/g, ".")}.@company.com`;
    const newEmp: Employee = {
      id: Date.now().toString(),
      name: candidate.name,
      email: email,
      position: candidate.position,
      branch: candidate.branch,
      country: "US",
      birthday: "",
      address: "",
      startDate: today,
      status: "active",
      warningCount: 0,
      inTraining: true,
    };
    setEmployees([...employees, newEmp]);
    handleDeleteCandidate(candidate.id);
  };

  const handleUpdateEmployeeStatus = (id: string, newStatus: Employee["status"]) => {
    // Show confirmation for terminated/resigned status changes
    if (newStatus === "terminated" || newStatus === "resigned") {
      const employee = employees.find(e => e.id === id);
      if (employee) {
        setConfirmDialog({ show: true, employeeId: id, employeeName: employee.name, newStatus });
      }
    } else {
      // For other status changes, apply directly
      setEmployees(employees.map(e => e.id === id ? { ...e, status: newStatus } : e));
    }
  };

  const handleConfirmStatusChange = () => {
    if (confirmDialog) {
      setEmployees(employees.map(e => e.id === confirmDialog.employeeId ? { ...e, status: confirmDialog.newStatus } : e));
      setConfirmDialog(null);
    }
  };

  const handleCancelStatusChange = () => {
    setConfirmDialog(null);
  };

  const handleDeleteEmployee = (id: string) => {
    setEmployees(employees.filter(e => e.id !== id));
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "scheduled": return "bg-blue-500/20 text-blue-300";
      case "completed": return "bg-yellow-500/20 text-yellow-300";
      case "hired": return "bg-green-500/20 text-green-300";
      case "rejected": return "bg-red-500/20 text-red-300";
      default: return "bg-gray-500/20 text-gray-300";
    }
  };

  return(
    <div className="min-h-screen flex flex-col"><main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-6">
      <div className="flex items-center gap-3 mb-4"><Link to="/m/$module" params={{module:mod.slug}} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4"/></Link><h1 className="text-2xl font-bold">{sub.title}</h1></div>
      
      {/* Filters */}
      <div className="panel mb-4 p-3"><div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</label>
          <select value={date} onChange={e=>setDate(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md">{ALL_DATES.map(d=><option key={d} value={d}>{fmtDate(d)}</option>)}</select></div>
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Section</label>
          <div className="flex rounded-md overflow-hidden border border-white/15">
            <button onClick={()=>{setSection("us");setBranchFilter("");}} className={`px-3 py-1.5 text-sm font-medium ${section==="us"?"bg-blue-600 text-white":"btn rounded-none"}`}>US</button>
            <button onClick={()=>{setSection("ph");setBranchFilter("");}} className={`px-3 py-1.5 text-sm font-medium ${section==="ph"?"bg-blue-600 text-white":"btn rounded-none"}`}>PH</button>
          </div></div>
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Branch</label>
          <select value={branchFilter} onChange={e=>setBranchFilter(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md"><option value="">All</option>{branchOptions.map(b=><option key={b} value={b}>{b}</option>)}</select></div>
        <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Warning</label>
          <select value={warningFilter} onChange={e=>setWarningFilter(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md"><option value="">All</option><option value="timecard">Timecard</option><option value="employee">Employee</option></select></div>
        {(branchFilter||warningFilter)&&<button onClick={()=>{setBranchFilter("");setWarningFilter("");}} className="btn text-sm px-3 mb-0.5">Clear</button>}
      </div></div>

      {/* Today's Interviews Alert */}
      {todaysInterviews.length > 0 && (
        <div className="panel mb-4 bg-amber-500/10 border border-amber-500/30 p-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-bold text-amber-300 mb-2">📅 Today's Scheduled Interviews</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-1.5">
                {todaysInterviews.map(candidate => (
                  <div key={candidate.id} className="bg-slate-900/50 border border-amber-400/30 rounded p-1.5 text-xs">
                    <div className="flex items-start justify-between gap-1.5 mb-0.5">
                      <div className="min-w-0">
                        <p className="font-semibold text-white truncate">{candidate.name}</p>
                        <p className="text-xs text-slate-400 truncate">{candidate.position}</p>
                      </div>
                      <Clock className="h-3 w-3 text-amber-400 flex-shrink-0 mt-0.5" />
                    </div>
                    <div className="space-y-0 text-xs">
                      <p className="text-slate-300">
                        <span className="text-amber-300 font-semibold">{candidate.interviewTime}</span> @ <span className="text-slate-400">{candidate.branch}</span>
                      </p>
                      {candidate.notes && <p className="text-slate-400 italic line-clamp-1">"{candidate.notes}"</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Key Metrics & Charts Row */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 mb-4">
        {/* Left: Key Metrics (3 columns) */}
        <div className="xl:col-span-3">
          <div className="grid grid-cols-2 gap-2">
            {[["Scheduled",totalScheduled,"text-blue-300"],["Hired",totalHired,"text-green-300"],["TC Warnings",totalTCW,"text-yellow-300"],["Emp Errors",totalEE,"text-red-300"],["Candidates",scheduledCount,"text-blue-400"],["Hired Candidates",hiredCount,"text-green-400"]].map(([l,v,c],idx)=>(
              <div key={`metric-${idx}`} className="panel p-3 text-center"><p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5 truncate">{l}</p><p className={`text-xl font-bold ${c}`}>{v||'—'}</p></div>
            ))}
          </div>
        </div>
        
        {/* Right: Charts (9 columns) */}
        <div className="xl:col-span-9 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Interview bar */}
          <div className="panel p-3">
            <p className="text-xs font-semibold mb-3">Interviews — Scheduled vs Hired</p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={interviewBarData} margin={{left:-10}}>
                <XAxis dataKey="name" tick={{fill:"#94a3b8",fontSize:9}} angle={-30} textAnchor="end" height={45}/>
                <YAxis tick={{fill:"#94a3b8",fontSize:10}}/>
                <Tooltip contentStyle={{background:"#1e293b",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6}}/>
                <Legend wrapperStyle={{fontSize:10,color:"#94a3b8"}}/>
                <Bar dataKey="scheduled" fill="#3b82f6" radius={[4,4,0,0]} name="Scheduled"/>
                <Bar dataKey="hired" fill="#34d399" radius={[4,4,0,0]} name="Hired"/>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {/* Trend line */}
          <div className="panel p-3">
            <p className="text-xs font-semibold mb-3">Trend — Last 10 Days</p>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={trendData} margin={{left:-10}}>
                <XAxis dataKey="date" tick={{fill:"#94a3b8",fontSize:9}}/>
                <YAxis tick={{fill:"#94a3b8",fontSize:10}}/>
                <Tooltip contentStyle={{background:"#1e293b",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6}}/>
                <Legend wrapperStyle={{fontSize:10,color:"#94a3b8"}}/>
                <Line type="monotone" dataKey="hired" stroke="#34d399" strokeWidth={2} dot={{r:3}} name="Hired"/>
                <Line type="monotone" dataKey="warnings" stroke="#f87171" strokeWidth={2} dot={{r:3}} name="Warnings"/>
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Warning bar (full width when data exists) */}
      {warningBarData.length>0&&<div className="panel p-3 mb-4">
        <p className="text-xs font-semibold mb-3">Warnings by Branch</p>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={warningBarData} margin={{left:-10}}>
            <XAxis dataKey="name" tick={{fill:"#94a3b8",fontSize:9}} angle={-20} textAnchor="end" height={35}/>
            <YAxis tick={{fill:"#94a3b8",fontSize:10}}/>
            <Tooltip contentStyle={{background:"#1e293b",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6}}/>
            <Legend wrapperStyle={{fontSize:10,color:"#94a3b8"}}/>
            <Bar dataKey="timecard" fill="#facc15" radius={[4,4,0,0]} name="Timecard"/>
            <Bar dataKey="employee" fill="#f87171" radius={[4,4,0,0]} name="Employee"/>
          </BarChart>
        </ResponsiveContainer>
      </div>}

      {/* Data Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="panel p-0 overflow-hidden">
          <div className="px-3 py-2 border-b border-white/10 font-semibold text-xs flex justify-between"><span>Interview Report</span><span className="text-muted-foreground">{interviews.length} branches</span></div>
          <div className="overflow-y-auto max-h-60"><table className="w-full text-xs"><thead><tr className="border-b border-white/10 bg-white/5">{["Branch/Dept","Scheduled","Staff Need","Hired"].map(h=><th key={h} className="px-3 py-1.5 text-left text-xs text-muted-foreground uppercase">{h}</th>)}</tr></thead>
          <tbody>{interviews.length===0?<tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground text-xs">No data.</td></tr>:interviews.map((r:any,i:number)=><tr key={i} className="border-b border-white/5 hover:bg-white/5"><td className="px-3 py-2 font-medium">{r.branch}</td><td className="px-3 py-2 text-center text-blue-400">{r.scheduled??'—'}</td><td className="px-3 py-2 text-muted-foreground">{r.staffNeed||'—'}</td><td className="px-3 py-2 text-center text-green-400 font-semibold">{r.hired??'—'}</td></tr>)}</tbody></table></div>
        </div>
        <div className="panel p-0 overflow-hidden">
          <div className="px-3 py-2 border-b border-white/10 font-semibold text-xs flex justify-between"><span>Warning Report</span><span className="text-muted-foreground">{warnings.length} branches</span></div>
          <div className="overflow-y-auto max-h-60"><table className="w-full text-xs"><thead><tr className="border-b border-white/10 bg-white/5">{["Branch/Dept","Timecard","Employee"].map(h=><th key={h} className="px-3 py-1.5 text-left text-xs text-muted-foreground uppercase">{h}</th>)}</tr></thead>
          <tbody>{warnings.length===0?<tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground text-xs">No warnings.</td></tr>:warnings.map((r:any,i:number)=><tr key={i} className="border-b border-white/5 hover:bg-white/5"><td className="px-3 py-2 font-medium">{r.branch}</td><td className="px-3 py-2 text-center text-yellow-400 font-semibold">{r.timecardWarning??'—'}</td><td className="px-3 py-2 text-center text-red-400 font-semibold">{r.employeeError??'—'}</td></tr>)}</tbody></table></div>
        </div>
      </div>

      {/* Job Interviews & Hiring Section */}
      <div className="panel p-0 overflow-hidden mb-4">
        <div className="px-4 py-4 border-b border-white/10 flex justify-between items-center">
          <h2 className="font-semibold text-sm">Job Interviews & Hiring</h2>
          <button onClick={() => setShowAddInterview(!showAddInterview)} className="btn text-sm px-3 py-1.5 flex items-center gap-2">
            <Plus className="h-4 w-4" /> Add Interview
          </button>
        </div>

        {/* Add Interview Form */}
        {showAddInterview && (
          <div className="px-4 py-4 border-b border-white/10 bg-white/5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              <input type="text" placeholder="Candidate Name" value={newCandidate.name || ""} onChange={(e) => setNewCandidate({ ...newCandidate, name: e.target.value })} className="glass-input text-sm py-1.5 px-3 rounded-md" />
              <input type="text" placeholder="Position" value={newCandidate.position || ""} onChange={(e) => setNewCandidate({ ...newCandidate, position: e.target.value })} className="glass-input text-sm py-1.5 px-3 rounded-md" />
              <select value={newCandidate.branch || ""} onChange={(e) => setNewCandidate({ ...newCandidate, branch: e.target.value })} className="glass-input text-sm py-1.5 px-3 rounded-md"><option value="">Select Branch</option>{branchOptions.map((b) => <option key={b} value={b}>{b}</option>)}</select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              <input type="date" value={newCandidate.interviewDate || ""} onChange={(e) => setNewCandidate({ ...newCandidate, interviewDate: e.target.value })} className="glass-input text-sm py-1.5 px-3 rounded-md" />
              <input type="time" value={newCandidate.interviewTime || ""} onChange={(e) => setNewCandidate({ ...newCandidate, interviewTime: e.target.value })} className="glass-input text-sm py-1.5 px-3 rounded-md" />
              <input type="text" placeholder="Notes (optional)" value={newCandidate.notes || ""} onChange={(e) => setNewCandidate({ ...newCandidate, notes: e.target.value })} className="glass-input text-sm py-1.5 px-3 rounded-md" />
            </div>
            <div className="flex gap-2">
              <button onClick={handleAddCandidate} className="btn bg-green-600 hover:bg-green-700 text-white text-sm px-4 py-1.5">Save</button>
              <button onClick={() => setShowAddInterview(false)} className="btn text-sm px-4 py-1.5">Cancel</button>
            </div>
          </div>
        )}

        {/* Interview Candidates Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Candidate</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Position</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Branch</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Interview Date</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {candidates.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">No interviews scheduled.</td></tr>
              ) : (
                candidates.map((candidate) => (
                  <tr key={candidate.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-4 py-3 font-medium">{candidate.name}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{candidate.position}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{candidate.branch}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{candidate.interviewDate} @ {candidate.interviewTime}</td>
                    <td className="px-4 py-3">
                      <select value={candidate.status} onChange={(e) => handleUpdateStatus(candidate.id, e.target.value as InterviewCandidate["status"])} className={`text-xs font-semibold px-2 py-1 rounded border-0 ${getStatusColor(candidate.status)}`}>
                        <option value="scheduled">Scheduled</option>
                        <option value="completed">Completed</option>
                        <option value="hired">Hired</option>
                        <option value="rejected">Rejected</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 flex gap-2">
                      {candidate.status === "completed" && (
                        <button onClick={() => handleCreateAccountFromInterview(candidate)} className="btn bg-green-600 hover:bg-green-700 text-white text-xs px-2 py-1">Create Account</button>
                      )}
                      <button onClick={() => handleDeleteCandidate(candidate.id)} className="btn text-red-400 hover:text-red-300 text-sm p-1"><Trash2 className="h-4 w-4" /></button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Employee Directory Section */}
      <div className="panel p-0 overflow-hidden">
        <div className="px-4 py-4 border-b border-white/10 flex justify-between items-center">
          <h2 className="font-semibold text-sm">Employee Directory</h2>
          <button onClick={() => setShowAddEmployee(!showAddEmployee)} className="btn text-sm px-3 py-1.5 flex items-center gap-2">
            <Plus className="h-4 w-4" /> Add Employee
          </button>
        </div>

        {/* Add Employee Form */}
        {showAddEmployee && (
          <div className="px-4 py-4 border-b border-white/10 bg-white/5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              <input type="text" placeholder="Name *" value={newEmployee.name || ""} onChange={(e) => setNewEmployee({ ...newEmployee, name: e.target.value })} className="glass-input text-sm py-1.5 px-3 rounded-md" required />
              <input type="email" placeholder="Email *" value={newEmployee.email || ""} onChange={(e) => setNewEmployee({ ...newEmployee, email: e.target.value })} className="glass-input text-sm py-1.5 px-3 rounded-md" required />
              <input type="text" placeholder="Position *" value={newEmployee.position || ""} onChange={(e) => setNewEmployee({ ...newEmployee, position: e.target.value })} className="glass-input text-sm py-1.5 px-3 rounded-md" required />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              <select value={newEmployee.branch || ""} onChange={(e) => setNewEmployee({ ...newEmployee, branch: e.target.value })} className="glass-input text-sm py-1.5 px-3 rounded-md" required><option value="">Select Branch *</option>{allBranches.map((b) => <option key={b} value={b}>{b}</option>)}</select>
              <select value={newEmployee.country || "US"} onChange={(e) => setNewEmployee({ ...newEmployee, country: e.target.value as "US" | "PH" })} className="glass-input text-sm py-1.5 px-3 rounded-md">
                <option value="US">US Staff</option>
                <option value="PH">PH Staff</option>
              </select>
              <input type="date" placeholder="Birthday *" value={newEmployee.birthday || ""} onChange={(e) => setNewEmployee({ ...newEmployee, birthday: e.target.value })} className="glass-input text-sm py-1.5 px-3 rounded-md" required title="Birthday" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              <input type="date" placeholder="Start Date (Account Creation) *" value={newEmployee.startDate || ""} onChange={(e) => setNewEmployee({ ...newEmployee, startDate: e.target.value })} className="glass-input text-sm py-1.5 px-3 rounded-md" required title="Start Date (Account Creation)" />
              <input type="text" placeholder="Address *" value={newEmployee.address || ""} onChange={(e) => setNewEmployee({ ...newEmployee, address: e.target.value })} className="glass-input text-sm py-1.5 px-3 rounded-md" required />
              {newEmployee.country === "US" && (
                <input type="text" placeholder="SSN (US only)" value={newEmployee.ssn || ""} onChange={(e) => setNewEmployee({ ...newEmployee, ssn: e.target.value })} className="glass-input text-sm py-1.5 px-3 rounded-md" />
              )}
            </div>
            <div className="flex items-center gap-3 mb-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={newEmployee.inTraining || false} onChange={(e) => setNewEmployee({ ...newEmployee, inTraining: e.target.checked })} className="w-4 h-4 rounded border border-white/20 bg-slate-700" />
                <span className="text-sm text-muted-foreground">In Training</span>
              </label>
            </div>
            <div className="flex gap-2">
              <button onClick={handleAddEmployee} className="btn bg-green-600 hover:bg-green-700 text-white text-sm px-4 py-1.5">Save</button>
              <button onClick={() => setShowAddEmployee(false)} className="btn text-sm px-4 py-1.5">Cancel</button>
            </div>
          </div>
        )}

        {/* Employee Filters */}
        <div className="px-4 py-3 border-b border-white/10 bg-white/5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</label>
              <select value={employeeFilters.status} onChange={(e) => setEmployeeFilters({ ...employeeFilters, status: e.target.value as any })} className="glass-input text-sm py-1.5 px-3 rounded-md">
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="terminated">Terminated</option>
                <option value="resigned">Resigned</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Branch</label>
              <select value={employeeFilters.branch} onChange={(e) => setEmployeeFilters({ ...employeeFilters, branch: e.target.value })} className="glass-input text-sm py-1.5 px-3 rounded-md">
                <option value="">All</option>
                {allBranches.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sort By</label>
              <select value={employeeFilters.sortBy} onChange={(e) => setEmployeeFilters({ ...employeeFilters, sortBy: e.target.value as any })} className="glass-input text-sm py-1.5 px-3 rounded-md">
                <option value="name">Name</option>
                <option value="startDate">Start Date</option>
                <option value="warnings">Warnings</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Order</label>
              <select value={employeeFilters.sortOrder} onChange={(e) => setEmployeeFilters({ ...employeeFilters, sortOrder: e.target.value as any })} className="glass-input text-sm py-1.5 px-3 rounded-md">
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </div>
            {(employeeFilters.status || employeeFilters.branch) && (
              <button onClick={() => setEmployeeFilters({ status: "", branch: "", sortBy: "name", sortOrder: "asc" })} className="btn text-sm px-3 mb-0.5">Clear Filters</button>
            )}
          </div>
        </div>

        {/* Employee Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Name</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Email</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Position</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Branch</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Birthday</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Start Date</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Training</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Address</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Warnings</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Termination</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Status</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.length === 0 ? (
                <tr><td colSpan={11} className="px-3 py-6 text-center text-muted-foreground text-xs">No employees found.</td></tr>
              ) : (
                filteredEmployees.map((employee) => (
                  <tr key={employee.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2 font-medium">{employee.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{employee.email}</td>
                    <td className="px-3 py-2 text-muted-foreground">{employee.position}</td>
                    <td className="px-3 py-2 text-muted-foreground">{employee.branch}</td>
                    <td className="px-3 py-2 text-muted-foreground">{employee.birthday}</td>
                    <td className="px-3 py-2 text-muted-foreground">{employee.startDate}</td>
                    <td className="px-3 py-2">
                      {employee.inTraining ? (
                        <span className="bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded text-xs font-semibold">In Training</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground text-xs truncate max-w-xs">{employee.address}</td>
                    <td className="px-3 py-2">
                      {employee.warningCount > 0 ? (
                        <span className="bg-red-500/20 text-red-300 px-2 py-1 rounded text-xs font-semibold">{employee.warningCount}</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">
                      {employee.terminationDate && (
                        <div className="text-yellow-400 text-xs">
                          <div>{employee.terminationDate}</div>
                          <div className="text-xs text-yellow-300">{employee.terminationReason || "N/A"}</div>
                        </div>
                      )}
                      {!employee.terminationDate && <span>—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <select value={employee.status} onChange={(e) => {
                        const newStatus = e.target.value as Employee["status"];
                        if (newStatus === "terminated" || newStatus === "resigned") {
                          handleUpdateEmployeeStatus(employee.id, newStatus);
                        } else {
                          setEmployees(employees.map(emp => emp.id === employee.id ? { ...emp, status: newStatus } : emp));
                        }
                      }} className="text-xs font-semibold px-2 py-1 rounded border-0 bg-slate-700 text-slate-100">
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                        <option value="terminated">Terminated</option>
                        <option value="resigned">Resigned</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <button onClick={() => handleDeleteEmployee(employee.id)} className="btn text-red-400 hover:text-red-300 text-sm p-1"><Trash2 className="h-3 w-3" /></button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirmation Dialog */}
      {confirmDialog?.show && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-lg p-6 max-w-sm">
            <h3 className="text-lg font-bold mb-2">Confirm Status Change</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Are you sure you want to mark <span className="font-semibold text-white">{confirmDialog.employeeName}</span> as <span className="font-semibold text-white capitalize">{confirmDialog.newStatus}</span>? This action cannot be easily undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={handleCancelStatusChange} className="btn text-sm px-4 py-2">Cancel</button>
              <button onClick={handleConfirmStatusChange} className={`btn text-sm px-4 py-2 text-white ${confirmDialog.newStatus === "terminated" ? "bg-red-600 hover:bg-red-700" : "bg-orange-600 hover:bg-orange-700"}`}>
                Confirm {confirmDialog.newStatus === "terminated" ? "Termination" : "Resignation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main></div>
  );
}
