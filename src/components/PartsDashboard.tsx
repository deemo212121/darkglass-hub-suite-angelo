import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Package, TrendingUp, AlertTriangle, CheckCircle, Truck, RotateCcw, ClipboardList, BarChart2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Legend } from "recharts";
import { partsReportData } from "@/lib/reportData";
import { poMasterData } from "@/lib/poData";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

const ALL_DATES = Object.keys(partsReportData).sort();
const COLORS = ["#3b82f6","#34d399","#a78bfa","#fb923c","#f472b6","#facc15","#22d3ee","#60a5fa"];

const fmtDate = (s: string) => {
  const c = s.replace(/^0/, "");
  return c.length === 3 ? `${c[0]}/${c.slice(1)}/26` : `${c.slice(0, -2)}/${c.slice(-2)}/26`;
};

// Seeded dummy PO data
function seededRand(seed: number) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return Math.abs(s) / 0xffffffff; };
}
const PART_DISTS_FULL = ["Marcone-162468","Marcone-Birmingham / Montgomery","Encompass","Encompass-Birmingham / Montgomery","LG","Electrolux","Midea","Miele","NSA","AIO","GE","Squaretrade","OW","SB","Sharp"];
const WARRANTY_TYPES = ["In warranty","Out-of-warranty","Labor only Wty","Part only Wty","Concession LP","Concession L","Concession P","Ext Wty","Ext Labor Wty","Ext Part Wty","Special Part 5 year","Unknown"];
const PART_DESCRIPTIONS_FULL = [
  "Compressor","Door Seal","Wire Harness","Pump Assembly","Evaporator Coil",
  "Dryer-Filter","Control Board","Ice Maker","Drain Motor","Fan Blade",
  "Thermostat","Door Hinge","Water Valve","Timer Assembly","Defrost Heater",
  "Belt Drive","Shock Absorber","Drum Bearing","Capacitor","Relay Switch",
  "Lid Switch Assembly","Bearing Kit","Thermal Fuse","Start Relay","Door Latch",
  "Bimetal Defrost Thermostat","Burner Assembly","Igniter","Heating Element","Drive Motor",
  "Drain Pump","Dispenser Assembly","Inner Door Panel","Tub Seal Kit","Drive Belt",
  "Suspension Rod Kit","Wash Pump Motor","Spray Arm","Inlet Valve","Agitator Cam Kit",
];
const LOCATIONS_ALL = [
  "Asheville","Cape Girardeau","Nashville","Atlanta","Memphis","Birmingham",
  "Richmond","Knoxville","Jackson MS","Mobile","Montgomery","Huntsville",
  "Little Rock","Lake Charles","New Orleans","Dallas","San Antonio","Columbus",
  "Destin","Savannah","Raleigh","Norfolk","Louisville","Jonesboro","St. Louis",
];
const TECH_NAMES = [
  "Deprece Harris","John Oliver","Mark Rivera","Sam Torres","Kevin Blake",
  "Luis Reyes","David Park","Carlos Ruiz","James Wilson","Robert Chen",
  "Michael Adams","Anthony Brown","Daniel Scott","Matthew Lee","Christopher Hall",
  "Brian Turner","Jason Moore","Ryan White","Eric Johnson","Nathan Davis",
];
const BRANDS_PO = ["GE","GE","GE","ASSURANT","SQT","ELECTROLUX","MIDEA","LG","HISENSE","SAMSUNG","MIELE"];
const WTY_SHORT: Record<string,string> = {
  "In warranty":"IW","Out-of-warranty":"OW","Labor only Wty":"LW",
  "Part only Wty":"PW","Concession LP":"CLP","Concession L":"CL",
  "Concession P":"CP","Ext Wty":"EW","Ext Labor Wty":"ELW",
  "Ext Part Wty":"EPW","Special Part 5 year":"SP5","Unknown":"UNK",
};
const PART_NOTE_TEMPLATES = [
  "Electrolux {partNo}","Verify model before ordering","Core charge applies",
  "Backordered — ETA unknown","Ship direct to customer","Cross-ref: {partNo}",
  "","","","","","","",
];
const TICKET_PREFIXES = ["SA-","HAP","","","",""];

function seededPartNo(rng: ()=>number, dist: string): string {
  if (dist.includes("Marcone")) return `${Math.floor(rng()*900000000+100000000)}`;
  if (dist === "Encompass" || dist.includes("Encompass")) return `${Math.floor(rng()*9000000000+1000000000)}`;
  if (dist === "LG") return `ACQ${Math.floor(rng()*90000000+10000000)}`;
  if (dist === "Electrolux") return `${Math.floor(rng()*900000+100000)}${["A","B","C","D",""][Math.floor(rng()*5)]}`;
  if (dist === "GE") return `WX${Math.floor(rng()*9000000+1000000)}`;
  return `${Math.floor(rng()*900000000+100000000)}`;
}

function generatePOOrders(count: number) {
  const rng = seededRand(42);
  return Array.from({ length: count }, (_, i) => {
    const loc  = LOCATIONS_ALL[Math.floor(rng() * LOCATIONS_ALL.length)];
    const dist = PART_DISTS_FULL[Math.floor(rng() * PART_DISTS_FULL.length)];
    const partNo = seededPartNo(rng, dist);
    const desc = PART_DESCRIPTIONS_FULL[Math.floor(rng() * PART_DESCRIPTIONS_FULL.length)];
    const wty  = WARRANTY_TYPES[Math.floor(rng() * WARRANTY_TYPES.length)];
    const reqQty  = Math.floor(rng() * 4) + 1;
    const invQty  = Math.floor(rng() * 3);
    const resQty  = Math.floor(rng() * (invQty + 1));
    const availQty= Math.max(0, invQty - resQty);
    const returnPct = rng() < 0.3 ? Math.floor(rng() * 25) + 1 : 0;
    const dayOff = Math.floor(rng() * 30);
    const d = new Date(2026, 4, 1); d.setDate(d.getDate() + dayOff);
    const date = d.toISOString().slice(0,10);
    const account = `${Math.floor(rng() * 900000 + 100000)}`;
    const pfx = TICKET_PREFIXES[Math.floor(rng() * TICKET_PREFIXES.length)];
    const ticketNum = `${Math.floor(rng()*9000000000+1000000000)}`;
    const ticketSuffix = rng() < 0.35 ? `-${Math.floor(rng()*10)}${Math.floor(rng()<0.5?Math.floor(rng()*100):0)}` : "";
    const ticket = pfx + ticketNum + ticketSuffix;
    const statusRoll = rng();
    const status = statusRoll < 0.65 ? "TR-Need PO" : statusRoll < 0.85 ? "OP-Waiting for Part" : "TR-Need Triage";
    const tech = TECH_NAMES[Math.floor(rng() * TECH_NAMES.length)];
    const brand = BRANDS_PO[Math.floor(rng() * BRANDS_PO.length)];
    const noteTpl = PART_NOTE_TEMPLATES[Math.floor(rng() * PART_NOTE_TEMPLATES.length)];
    const note = noteTpl.replace("{partNo}", partNo);
    const wtyShort = WTY_SHORT[wty] || "IW";
    return { i, loc, dist, partNo, desc, wty, wtyShort, reqQty, invQty, resQty, availQty, returnPct, date, account, ticket, status, tech, brand, note };
  }).sort((a,b) => b.date.localeCompare(a.date));
}

// Real PO lines from 2026 Branch PO list mapped into the order table shape
const _statusRng = seededRand(7);
const ALL_PO_ORDERS = poMasterData.recentLines.map((l, i) => {
  const statusRoll = _statusRng();
  const invQty = Math.floor(_statusRng() * 3);
  const resQty = Math.floor(_statusRng() * (invQty + 1));
  return {
    i,
    loc: l.loc,
    dist: l.vendor,
    partNo: l.partNo,
    desc: l.desc,
    wty: l.wty,
    wtyShort: l.wty.length > 4 ? l.wty.slice(0, 4).toUpperCase() : l.wty.toUpperCase(),
    reqQty: l.qty,
    invQty,
    resQty,
    availQty: Math.max(0, invQty - resQty),
    returnPct: 0,
    date: l.date,
    account: l.po.split("-")[0],
    ticket: l.po,
    status: statusRoll < 0.65 ? "TR-Need PO" : statusRoll < 0.85 ? "OP-Waiting for Part" : "TR-Need Triage",
    tech: "",
    brand: l.wty,
    note: l.note,
    unitPrice: l.unitPrice,
    total: l.total,
  };
});

export function PartsDashboard({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const latestDate = ALL_DATES[ALL_DATES.length - 1];
  const agents: any[] = useMemo(() => (partsReportData as any)[latestDate]?.agents || [], [latestDate]);

  const totals = useMemo(() => ({
    collections: agents.reduce((s, a) => s + (a.collections || 0), 0),
    pendingRA:   agents.reduce((s, a) => s + (a.pendingRA   || 0), 0),
    raCreated:   agents.reduce((s, a) => s + (a.raCreated   || 0), 0),
    receives:    agents.reduce((s, a) => s + (a.receives    || 0), 0),
    warnings:    agents.reduce((s, a) => s + (a.warnings    || 0), 0),
    agents:      agents.length,
  }), [agents]);

  const pendingPO    = ALL_PO_ORDERS.filter(o => o.status === "TR-Need PO").length;
  const waitingPart  = ALL_PO_ORDERS.filter(o => o.status === "OP-Waiting for Part").length;
  const noInventory  = ALL_PO_ORDERS.filter(o => o.availQty === 0).length;
  const reserved     = ALL_PO_ORDERS.filter(o => o.resQty > 0).length;
  const poTotals     = poMasterData.overview;

  const distBreakdown = useMemo(() =>
    poMasterData.byVendor.slice(0, 8).map(v => ({ name: v.name, value: v.lines })), []);

  const trend10 = useMemo(() => ALL_DATES.slice(-10).map(dt => {
    const da = (partsReportData as any)[dt]?.agents || [];
    return {
      date: fmtDate(dt),
      collections: da.reduce((s: number, a: any) => s + (a.collections || 0), 0),
      receives:    da.reduce((s: number, a: any) => s + (a.receives    || 0), 0),
      pendingRA:   da.reduce((s: number, a: any) => s + (a.pendingRA   || 0), 0),
    };
  }), []);

  // Real monthly PO trend from masterlist (Jan-Jun 2026)
  const monthlyPO = useMemo(() => poMasterData.monthly.map(m => ({
    month: new Date(m.month + "-02").toLocaleString("en-US", { month: "short" }),
    lines: m.lines,
    spend: Math.round(m.spend),
    pos: m.pos,
  })), []);

  // Real branch PO volume from masterlist
  const branchData = useMemo(() =>
    poMasterData.byLocation.slice(0, 12).map(l => ({
      name: l.name, lines: l.lines, spend: Math.round(l.spend), pos: l.pos,
    })), []);

  const topAgents = useMemo(() => [...agents].sort((a, b) => (b.collections || 0) - (a.collections || 0)).slice(0, 8), [agents]);

  // Status breakdown for bar chart
  const statusBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    ALL_PO_ORDERS.forEach(o => { map[o.status] = (map[o.status] || 0) + 1; });
    const colorMap: Record<string, string> = {
      "TR-Need PO": "#ef4444", "OP-Waiting for Part": "#f59e0b", "TR-Need Triage": "#a78bfa",
    };
    return Object.entries(map).map(([name, value]) => ({ name, value, color: colorMap[name] || "#3b82f6" })).sort((a, b) => b.value - a.value);
  }, []);

  // Brand breakdown — real warranty company data
  const brandBreakdown = useMemo(() =>
    poMasterData.byWarranty.slice(0, 7).map(w => ({ name: w.name, value: w.lines })), []);

  // Availability stats
  const availabilityStats = useMemo(() => {
    const total = ALL_PO_ORDERS.length;
    const inStock = ALL_PO_ORDERS.filter(o => o.availQty > 0).length;
    const reserved = ALL_PO_ORDERS.filter(o => o.resQty > 0).length;
    const noStock = ALL_PO_ORDERS.filter(o => o.availQty === 0 && o.invQty === 0).length;
    return [
      { label: "Available now", count: inStock, pct: Math.round(inStock / total * 100), color: "text-green-300", bar: "bg-green-400" },
      { label: "Reserved", count: reserved, pct: Math.round(reserved / total * 100), color: "text-blue-300", bar: "bg-blue-400" },
      { label: "Need to order", count: noStock, pct: Math.round(noStock / total * 100), color: "text-red-300", bar: "bg-red-400" },
    ];
  }, []);

  const uniqueTickets = useMemo(() => new Set(ALL_PO_ORDERS.map(o => o.ticket)).size, []);

  // Distributor table — real vendor lines + spend
  const distTableData = useMemo(() => {
    const totalLines = poMasterData.overview.totalLines;
    return poMasterData.byVendor.slice(0, 10).map(v => ({
      name: v.name, orders: v.lines, spend: v.spend,
      share: Math.round(v.lines / totalLines * 1000) / 10,
    }));
  }, []);

  // Quick nav pages
  const QUICK_NAV = [
    { slug: "part-order",        label: "Part Order",         icon: <ClipboardList className="h-4 w-4" /> },
    { slug: "part-inventory",    label: "Part Inventory",     icon: <Package       className="h-4 w-4" /> },
    { slug: "part-collection",   label: "Part Collection",    icon: <CheckCircle   className="h-4 w-4" /> },
    { slug: "part-pickup",       label: "Part Pickup",        icon: <Truck         className="h-4 w-4" /> },
    { slug: "part-receive",      label: "Part Receive",       icon: <Package       className="h-4 w-4" /> },
    { slug: "part-return",       label: "Part Return",        icon: <RotateCcw     className="h-4 w-4" /> },
    { slug: "part-return-status",label: "Return Status",      icon: <TrendingUp    className="h-4 w-4" /> },
    { slug: "po-status",         label: "PO Status",          icon: <BarChart2     className="h-4 w-4" /> },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">

        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <Link to="/m/$module" params={{ module: "parts" }} className="btn hover:bg-white/15">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Parts Dashboard</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Latest: {fmtDate(latestDate)} · {totals.agents} staff active</p>
          </div>
        </div>

        {/* Quick nav */}
        <div className="flex flex-wrap gap-2 mb-6 mt-4">
          {QUICK_NAV.map(item => (
            <Link key={item.slug} to="/m/$module/$submodule" params={{ module: "parts", submodule: item.slug }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-sm font-medium transition-colors">
              {item.icon}{item.label}
            </Link>
          ))}
        </div>

        {/* KPI cards - two rows */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-4">
          {[
            { label: "PO Lines YTD",   value: poTotals.totalLines.toLocaleString(), color: "text-blue-300" },
            { label: "Spend YTD",      value: `$${(poTotals.totalSpend/1000000).toFixed(2)}M`, color: "text-green-300" },
            { label: "Unique POs",     value: poTotals.uniquePOs.toLocaleString(), color: "text-purple-300" },
            { label: "Avg Line",       value: `$${poTotals.avgLineAmount.toFixed(0)}`, color: "text-cyan-300" },
            { label: "Collections",    value: totals.collections, color: "text-blue-300" },
            { label: "Pending RA",     value: totals.pendingRA,  color: "text-yellow-300" },
            { label: "Pending PO",     value: pendingPO,         color: "text-orange-300" },
            { label: "No Inventory",   value: noInventory,       color: noInventory > 0 ? "text-red-300" : "text-muted-foreground" },
          ].map(k => (
            <div key={k.label} className="panel p-3 text-center">
              <p className={`text-xl font-bold ${k.color}`}>{k.value || "—"}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{k.label}</p>
            </div>
          ))}
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          {/* Real monthly PO trend */}
          <div className="panel p-4 lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold">2026 PO Volume by Month</p>
              <span className="text-[10px] px-2 py-0.5 rounded bg-green-500/15 text-green-300 border border-green-500/25">Live from Branch PO list</span>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthlyPO} margin={{ left: -10 }}>
                <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis yAxisId="l" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis yAxisId="r" orientation="right" tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={(v: number) => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6 }}
                  formatter={(v: number, n: string) => n === "Spend ($)" ? [`$${v.toLocaleString()}`, n] : [v.toLocaleString(), n]} />
                <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                <Bar yAxisId="l" dataKey="lines" fill="#3b82f6" radius={[4, 4, 0, 0]} name="PO Lines" />
                <Bar yAxisId="r" dataKey="spend" fill="#34d399" radius={[4, 4, 0, 0]} name="Spend ($)" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Distributor breakdown */}
          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">PO by Distributor</p>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={distBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`} labelLine={false}>
                  {distBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Branch performance + top agents */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Branch PO Volume — 2026 YTD (top 12)</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={branchData} margin={{ left: -10 }}>
                <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 9 }} angle={-25} textAnchor="end" height={52} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6 }}
                  formatter={(v: number, n: string) => n === "Spend ($)" ? [`$${v.toLocaleString()}`, n] : [v.toLocaleString(), n]} />
                <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                <Bar dataKey="lines" fill="#3b82f6" radius={[4, 4, 0, 0]} name="PO Lines" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Top agents */}
          <div className="panel p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-blue-400" />Top Staff — {fmtDate(latestDate)}
            </div>
            <table className="w-full text-sm">
              <thead><tr className="border-b border-white/10 bg-white/5">
                {["Agent","Branch","Collections","Receives","Pending RA","Warnings"].map(h =>
                  <th key={h} className="px-3 py-2 text-left text-xs text-muted-foreground uppercase">{h}</th>
                )}
              </tr></thead>
              <tbody>
                {topAgents.length === 0
                  ? <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No data.</td></tr>
                  : topAgents.map((a, i) => (
                    <tr key={i} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                      <td className="px-3 py-2 font-medium whitespace-nowrap">{a.name}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{a.branch}</td>
                      <td className="px-3 py-2 text-right text-blue-300 font-semibold">{a.collections || "—"}</td>
                      <td className="px-3 py-2 text-right text-green-300">{a.receives || "—"}</td>
                      <td className="px-3 py-2 text-right text-yellow-300">{a.pendingRA || "—"}</td>
                      <td className="px-3 py-2 text-right">
                        {a.warnings && a.warnings > 0
                          ? <span className="px-1.5 py-0.5 rounded text-xs bg-red-500/20 text-red-300 border border-red-500/30">{a.warnings}</span>
                          : <span className="text-white/20">—</span>}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Additional analytics row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          {/* Status breakdown */}
          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">PO Queue by Status</p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={statusBreakdown} layout="vertical" margin={{ left: 20 }}>
                <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} width={110} />
                <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6 }} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {statusBreakdown.map((s, i) => <Cell key={i} fill={s.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Parts by brand */}
          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Orders by Brand</p>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={brandBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={42} outerRadius={72} paddingAngle={2}>
                  {brandBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6 }} />
                <Legend wrapperStyle={{ fontSize: 10, color: "#94a3b8" }} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Inventory availability gauge */}
          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Inventory Availability</p>
            <div className="space-y-3 mt-2">
              {availabilityStats.map(a => (
                <div key={a.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">{a.label}</span>
                    <span className={a.color}>{a.count} ({a.pct}%)</span>
                  </div>
                  <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                    <div className={`h-full rounded-full ${a.bar}`} style={{ width: `${a.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 pt-4 border-t border-white/10 grid grid-cols-2 gap-3 text-center">
              <div>
                <p className="text-2xl font-bold text-blue-300">{ALL_PO_ORDERS.length}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Total Lines</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-purple-300">{uniqueTickets}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Unique Tickets</p>
              </div>
            </div>
          </div>
        </div>

        {/* Top distributors table */}
        <div className="panel p-0 overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex items-center gap-2">
            <Truck className="h-4 w-4 text-blue-400" />Distributor Breakdown — 2026 YTD ($1.95M total)
          </div>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-white/10 bg-white/5">
              {["Distributor","PO Lines","Total Spend","Share"].map(h =>
                <th key={h} className="px-4 py-2 text-left text-xs text-muted-foreground uppercase">{h}</th>
              )}
            </tr></thead>
            <tbody>
              {distTableData.map((d, i) => (
                <tr key={d.name} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                  <td className="px-4 py-2 font-medium">{d.name}</td>
                  <td className="px-4 py-2 text-blue-300">{d.orders.toLocaleString()}</td>
                  <td className="px-4 py-2 text-green-300">${d.spend.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full rounded-full bg-blue-400" style={{ width: `${Math.min(100, d.share * 1.4)}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground">{d.share}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Top Parts table */}
        <div className="panel p-0 overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm flex items-center gap-2">
            <Package className="h-4 w-4 text-purple-400" />Most Ordered Parts — 2026 YTD
          </div>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-white/10 bg-white/5">
              {["Part No","Description","Times Ordered","Total Spend"].map(h =>
                <th key={h} className="px-4 py-2 text-left text-xs text-muted-foreground uppercase">{h}</th>
              )}
            </tr></thead>
            <tbody>
              {poMasterData.topParts.slice(0, 10).map((p, i) => (
                <tr key={p.partNo + i} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                  <td className="px-4 py-2 font-mono text-xs text-blue-300">{p.partNo}</td>
                  <td className="px-4 py-2 text-xs">{p.desc}</td>
                  <td className="px-4 py-2 text-blue-300">{p.count}</td>
                  <td className="px-4 py-2 text-green-300">${p.spend.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Part Order section - full PartOrder functionality inline */}
        <PartOrderSection modSlug="parts" />

      </main>
    </div>
  );
}

/* ─── Embedded Part Order (live-filtered, no Refresh button) ─── */
import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Save } from "lucide-react";
import { ALL_TECHNICIANS, LOCATIONS } from "@/lib/locations";

const FULL_PART_DISTS = ["(Part Dist.)","Amazon","Dey Distributing","Electrolux","Encompass","GE","LG","Marcone","Midea","Miele","Parts Select","Samsung","ServiceBench","Servicepower"];
const REPAIR_STATUSES = ["CL-Need Cancel","CL-Parts Back Ordered","CL-Ready to Complete","CSR-Acknowledged","CSR-Assigned to ASC","CSR-Left Message for Cx","CSR-Needs Scheduling","OP-Ready for Service","OP-Reschedule Follow up","OP-Update Hold","OP-Waiting for Part","PT-Need PreAuthorization","TR-Need PO","TR-Need Triage"];
const WARRANTY_TYPES_LIST = ["Concession LP","Concession L","Concession P","In warranty","Labor only Wty","Out-of-warranty","Part only Wty","Special Part 5 year","Unknown","Ext Wty","Ext Labor Wty","Ext Part Wty"];
const SHIP_OPTIONS = ["(Ship Method)","FedEx Ground","FedEx Priority","FedEx Standard Overnight","FedEx Second Day","FedEx Ground Residential","FedEx SmartPost","FedEx Next Day Early AM","FedEx Next Day Air Saturday","UPS Ground","UPS Ground Residential","UPS Next Day Air","UPS 2nd Day","UPS Saver","UPS Early A.M.","UPS SurePost","LTL","Will Call"];
const TODAY = new Date().toISOString().slice(0, 10);
const DROP_STYLE: React.CSSProperties = { background: "rgb(15,20,40)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, boxShadow: "0 8px 32px rgba(0,0,0,0.6)", zIndex: 999999, position: "fixed", maxHeight: 280, overflowY: "auto" };

function useDropdown(open: boolean) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const reposition = useCallback(() => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 2, left: r.left, width: r.width });
  }, []);
  useLayoutEffect(() => { if (open) reposition(); }, [open, reposition]);
  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => { window.removeEventListener("scroll", reposition, true); window.removeEventListener("resize", reposition); };
  }, [open, reposition]);
  return { triggerRef, pos };
}

const Chevron = ({ open }: { open: boolean }) => (
  <svg className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
);

function PartOrderSection({ modSlug }: { modSlug: string }) {
  const [location, setLocation]   = useState("");
  const [locOpen, setLocOpen]     = useState(false);
  const [partDist, setPartDist]   = useState("");
  const [distOpen, setDistOpen]   = useState(false);
  const [technician, setTechnician] = useState("");
  const [techOpen, setTechOpen]   = useState(false);
  const [repairStatus, setRepairStatus] = useState("TR-Need PO");
  const [statusOpen, setStatusOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(TODAY);
  const [dateMode, setDateMode]   = useState<"past"|"noSchedule"|"allNeedPO">("allNeedPO");
  const [includeUnapproved, setIncludeUnapproved] = useState(false);
  const [warrantyTypes, setWarrantyTypes] = useState<string[]>([...WARRANTY_TYPES_LIST]);
  const [wtOpen, setWtOpen]       = useState(false);
  const [shipMethods, setShipMethods] = useState<Record<number, string>>({});
  const [search, setSearch]       = useState("");

  const locDrop    = useDropdown(locOpen);
  const distDrop   = useDropdown(distOpen);
  const techDrop   = useDropdown(techOpen);
  const statusDrop = useDropdown(statusOpen);
  const wtDrop     = useDropdown(wtOpen);

  const locRef = useRef<HTMLDivElement>(null);
  const distRef = useRef<HTMLDivElement>(null);
  const techRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const wtRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      const t = e.target as Node;
      if (locOpen    && !locDrop.triggerRef.current?.contains(t)    && !locRef.current?.contains(t))    setLocOpen(false);
      if (distOpen   && !distDrop.triggerRef.current?.contains(t)   && !distRef.current?.contains(t))   setDistOpen(false);
      if (techOpen   && !techDrop.triggerRef.current?.contains(t)   && !techRef.current?.contains(t))   setTechOpen(false);
      if (statusOpen && !statusDrop.triggerRef.current?.contains(t) && !statusRef.current?.contains(t)) setStatusOpen(false);
      if (wtOpen     && !wtDrop.triggerRef.current?.contains(t)     && !wtRef.current?.contains(t))     setWtOpen(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [locOpen, distOpen, techOpen, statusOpen, wtOpen]);

  // Live-filtered orders (no Refresh button — reactive)
  const filtered = useMemo(() => {
    return ALL_PO_ORDERS.filter(o => {
      if (location   && o.loc    !== location)   return false;
      if (partDist   && o.dist   !== partDist)   return false;
      if (technician && o.tech && o.tech !== technician) return false;
      if (repairStatus && o.status !== repairStatus) return false;
      if (dateMode === "allNeedPO" && o.status !== "TR-Need PO" && o.status !== "OP-Waiting for Part") return false;
      if (!warrantyTypes.includes(o.wty)) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!o.ticket.toLowerCase().includes(q) && !o.partNo.includes(q) && !o.desc.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [location, partDist, technician, repairStatus, dateMode, warrantyTypes, search]);

  const allWt = warrantyTypes.length === WARRANTY_TYPES_LIST.length;
  const toggleWt = (w: string) => setWarrantyTypes(p => p.includes(w) ? p.filter(x => x !== w) : [...p, w]);
  const wtDisplay = allWt ? "All warranty types" : warrantyTypes.length === 0 ? "None selected" : warrantyTypes.length <= 2 ? warrantyTypes.join(", ") : `${warrantyTypes.length} selected`;

  // Encompass PO# format from the real system
  const encompassPO = (ticket: string, date: string) => `${ticket}-${date.replace(/-/g, "").slice(4, 8)}`;

  return (
    <div className="panel p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
        <ClipboardList className="h-4 w-4 text-purple-400" />
        <span className="font-semibold text-sm">Part Order</span>
        <Link to="/m/$module/$submodule" params={{ module: "parts", submodule: "part-order" }}
          className="ml-auto text-xs text-blue-400 hover:text-blue-300 transition-colors">Open full page →</Link>
      </div>

      {/* Filters */}
      <div className="p-4 border-b border-white/10 bg-white/[0.01]">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">

          {/* Location */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Location*</label>
            <button ref={locDrop.triggerRef} onClick={() => setLocOpen(o => !o)}
              className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
              <span className={location ? "" : "text-muted-foreground"}>{location || "Select Location"}</span><Chevron open={locOpen} />
            </button>
            {locOpen && locDrop.pos && createPortal(
              <div ref={locRef} style={{ ...DROP_STYLE, top: locDrop.pos.top, left: locDrop.pos.left, width: locDrop.pos.width }}>
                <button onClick={() => { setLocation(""); setLocOpen(false); }} className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 text-slate-400">— Select Location —</button>
                {LOCATIONS.map((l, i) => <button key={i} onClick={() => { setLocation(l); setLocOpen(false); }} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${location === l ? "bg-blue-600/40 text-white" : ""}`}>{l}</button>)}
              </div>, document.body
            )}
          </div>

          {/* Part Dist */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Part Dist.</label>
            <button ref={distDrop.triggerRef} onClick={() => setDistOpen(o => !o)}
              className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
              <span className={partDist ? "" : "text-muted-foreground"}>{partDist || "(Part Dist.)"}</span><Chevron open={distOpen} />
            </button>
            {distOpen && distDrop.pos && createPortal(
              <div ref={distRef} style={{ ...DROP_STYLE, top: distDrop.pos.top, left: distDrop.pos.left, width: distDrop.pos.width }}>
                {FULL_PART_DISTS.map((d, i) => <button key={i} onClick={() => { setPartDist(d === "(Part Dist.)" ? "" : d); setDistOpen(false); }} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${(partDist === d || (!partDist && d === "(Part Dist.)")) ? "bg-blue-600/40 text-white" : d === "(Part Dist.)" ? "text-slate-400" : ""}`}>{d}</button>)}
              </div>, document.body
            )}
          </div>

          {/* Technician */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Technician</label>
            <button ref={techDrop.triggerRef} onClick={() => setTechOpen(o => !o)}
              className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
              <span className={technician ? "" : "text-muted-foreground truncate"}>{technician || "All Technicians"}</span><Chevron open={techOpen} />
            </button>
            {techOpen && techDrop.pos && createPortal(
              <div ref={techRef} style={{ ...DROP_STYLE, top: techDrop.pos.top, left: techDrop.pos.left, width: techDrop.pos.width }}>
                <button onClick={() => { setTechnician(""); setTechOpen(false); }} className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 text-slate-400">— All Technicians —</button>
                {ALL_TECHNICIANS.map((t, i) => <button key={i} onClick={() => { setTechnician(t); setTechOpen(false); }} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${technician === t ? "bg-blue-600/40 text-white" : ""}`}>{t}</button>)}
              </div>, document.body
            )}
          </div>

          {/* Repair Status */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Repair Status</label>
            <button ref={statusDrop.triggerRef} onClick={() => setStatusOpen(o => !o)}
              className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
              <span className="truncate">{repairStatus || "All Statuses"}</span><Chevron open={statusOpen} />
            </button>
            {statusOpen && statusDrop.pos && createPortal(
              <div ref={statusRef} style={{ ...DROP_STYLE, top: statusDrop.pos.top, left: statusDrop.pos.left, width: Math.max(statusDrop.pos.width, 240) }}>
                <button onClick={() => { setRepairStatus(""); setStatusOpen(false); }} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${!repairStatus ? "bg-blue-600/40 text-white" : "text-slate-400"}`}>All Statuses</button>
                {REPAIR_STATUSES.map(s => <button key={s} onClick={() => { setRepairStatus(s); setStatusOpen(false); }} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${repairStatus === s ? "bg-blue-600/40 text-white" : ""}`}>{s}</button>)}
              </div>, document.body
            )}
          </div>
        </div>

        {/* Row 2: date + mode + warranty + search */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Schedule Date*</label>
            <input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)}
              className="glass-input text-sm py-1.5 px-2 rounded-md w-36" style={{ colorScheme: "dark" }} />
          </div>
          <div className="flex items-center gap-4 self-end pb-0.5">
            {([["past","Past Schedule Date"],["noSchedule","No Schedule Date"],["allNeedPO","All Need PO"]] as const).map(([v, l]) => (
              <label key={v} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="radio" name="po-date-mode" checked={dateMode === v} onChange={() => setDateMode(v)} className="accent-blue-500" />{l}
              </label>
            ))}
            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input type="checkbox" checked={includeUnapproved} onChange={e => setIncludeUnapproved(e.target.checked)} className="accent-blue-500" />Include Unapproved Parts
            </label>
          </div>

          {/* Warranty Type multiselect */}
          <div className="flex flex-col gap-1 flex-1 min-w-[220px]">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Warranty Type*</label>
            <button ref={wtDrop.triggerRef} onClick={() => setWtOpen(o => !o)}
              className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
              <span className="truncate text-sm">{wtDisplay}</span><Chevron open={wtOpen} />
            </button>
            {wtOpen && wtDrop.pos && createPortal(
              <div ref={wtRef} style={{ ...DROP_STYLE, top: wtDrop.pos.top, left: wtDrop.pos.left, width: Math.max(wtDrop.pos.width, 240) }}>
                <label className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-white/5 cursor-pointer border-b border-white/10 font-medium">
                  <input type="checkbox" checked={allWt} onChange={() => setWarrantyTypes(allWt ? [] : [...WARRANTY_TYPES_LIST])} className="accent-blue-500" />[Select All]
                </label>
                {WARRANTY_TYPES_LIST.map(w => (
                  <label key={w} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-white/5 cursor-pointer">
                    <input type="checkbox" checked={warrantyTypes.includes(w)} onChange={() => toggleWt(w)} className="accent-blue-500" />{w}
                  </label>
                ))}
              </div>, document.body
            )}
          </div>
        </div>
      </div>

      {/* Results header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 bg-white/[0.01]">
        <span className="text-sm text-muted-foreground">{filtered.length} records found</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">* Encompass PO #: [Ticket #]-[ScheduleDate(MMdd)]</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="search in result"
            className="glass-input text-xs py-1 px-2.5 rounded-md w-36" />
          <button className="btn bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 px-3 py-1.5 text-sm">
            <Save className="h-3.5 w-3.5" />Save & PO
          </button>
        </div>
      </div>

      {/* Table — full width, no horizontal scroll */}
      <table className="w-full text-sm table-fixed">
        <colgroup>
          <col style={{ width: "13%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "18%" }} />
          <col style={{ width: "16%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "9%" }} />
        </colgroup>
        <thead>
          <tr className="border-b border-white/10 bg-white/5">
            <th className="px-3 py-2.5 text-left text-xs text-muted-foreground uppercase">Ticket / Account</th>
            <th className="px-3 py-2.5 text-left text-xs text-muted-foreground uppercase">Status / Wty</th>
            <th className="px-3 py-2.5 text-left text-xs text-muted-foreground uppercase">Price</th>
            <th className="px-3 py-2.5 text-left text-xs text-muted-foreground uppercase">Part / Distributor</th>
            <th className="px-3 py-2.5 text-left text-xs text-muted-foreground uppercase">Ship / Note</th>
            <th className="px-3 py-2.5 text-center text-xs text-muted-foreground uppercase">Req / Inv / Res / Avail</th>
            <th className="px-3 py-2.5 text-center text-xs text-muted-foreground uppercase">Reserve / Reject</th>
            <th className="px-3 py-2.5 text-center text-xs text-muted-foreground uppercase">P/O</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0
            ? <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">No records match current filters.</td></tr>
            : filtered.map((o, i) => (
              <tr key={o.i} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                {/* Ticket / Account */}
                <td className="px-3 py-3 align-top">
                  <p className="font-mono text-xs text-blue-400 break-all">{o.ticket}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Acct: {o.account}</p>
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">{o.loc}</p>
                </td>
                {/* Status / Wty */}
                <td className="px-3 py-3 align-top">
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] border ${o.status === "TR-Need PO" ? "bg-red-500/15 text-red-300 border-red-500/25" : o.status === "OP-Waiting for Part" ? "bg-yellow-500/15 text-yellow-300 border-yellow-500/25" : "bg-white/10 text-muted-foreground border-white/10"}`}>
                    {o.status}
                  </span>
                  <p className="text-[11px] text-muted-foreground mt-1">Wty: {o.wtyShort}</p>
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">{o.brand}</p>
                </td>
                {/* Price */}
                <td className="px-3 py-3 align-top">
                  <p className="text-xs text-green-300 font-medium">${(o as any).total?.toFixed?.(2) ?? "0.00"}</p>
                  {(o as any).unitPrice > 0 && o.reqQty > 1 && <p className="text-[10px] text-muted-foreground mt-0.5">${(o as any).unitPrice.toFixed(2)} × {o.reqQty}</p>}
                </td>
                {/* Part / Distributor */}
                <td className="px-3 py-3 align-top">
                  <p className="text-xs font-medium">{o.desc}</p>
                  <p className="font-mono text-[11px] text-blue-300 mt-0.5 break-all">{o.partNo}</p>
                  <p className="text-[10px] text-muted-foreground/70 mt-0.5">{o.dist}</p>
                  <p className="text-[10px] text-muted-foreground/50 mt-0.5">ETA: N/A</p>
                </td>
                {/* Ship / Note */}
                <td className="px-3 py-3 align-top">
                  <select value={shipMethods[o.i] || ""} onChange={e => setShipMethods(p => ({ ...p, [o.i]: e.target.value }))}
                    className="glass-input text-[10px] py-1 px-1.5 rounded w-full mb-1">
                    {SHIP_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {o.note && <p className="text-[10px] text-blue-200/60 leading-tight">{o.note}</p>}
                </td>
                {/* Quantities */}
                <td className="px-3 py-3 align-top">
                  <div className="grid grid-cols-4 gap-1 text-center">
                    <div><p className="text-[9px] text-muted-foreground/60 uppercase">Req</p><p className="text-sm font-medium">{o.reqQty}</p></div>
                    <div><p className="text-[9px] text-muted-foreground/60 uppercase">Inv</p><p className={`text-sm font-semibold ${o.invQty > 0 ? "text-blue-300" : "text-muted-foreground"}`}>{o.invQty}</p></div>
                    <div><p className="text-[9px] text-muted-foreground/60 uppercase">Res</p><p className={`text-sm ${o.resQty > 0 ? "text-blue-300" : "text-muted-foreground"}`}>{o.resQty}</p></div>
                    <div><p className="text-[9px] text-muted-foreground/60 uppercase">Avail</p><p className={`text-sm font-bold ${o.availQty > 0 ? "text-green-300" : "text-red-300"}`}>{o.availQty}</p></div>
                  </div>
                  {o.returnPct > 0 && <p className="text-[10px] text-yellow-300 text-center mt-1">Return: {o.returnPct}%</p>}
                </td>
                {/* Reserve / Reject */}
                <td className="px-3 py-3 align-top">
                  <div className="flex items-center justify-center gap-3">
                    <label className="flex flex-col items-center gap-0.5 cursor-pointer"><span className="text-[9px] text-muted-foreground/60 uppercase">Res</span><input type="checkbox" className="accent-blue-500" /></label>
                    <label className="flex flex-col items-center gap-0.5 cursor-pointer"><span className="text-[9px] text-muted-foreground/60 uppercase">Rej</span><input type="checkbox" className="accent-red-500" /></label>
                  </div>
                </td>
                {/* P/O */}
                <td className="px-3 py-3 align-top">
                  <select className="glass-input text-[10px] py-1 px-1.5 rounded w-full mb-1">
                    <option>Auto P/O</option>
                    {FULL_PART_DISTS.filter(d => d !== "(Part Dist.)").map(d => <option key={d}>{d}</option>)}
                  </select>
                  <a href="https://earlyrepair.com/Part/PartOrder" target="_blank" rel="noopener noreferrer"
                    className="block text-center text-[10px] text-blue-400 hover:underline px-1.5 py-0.5 rounded border border-blue-500/30 bg-blue-500/10">
                    {o.dist.includes("Marcone") ? "▶ Marcone" : o.dist.includes("Encompass") ? "▶ Encompass" : "▶ Order"}
                  </a>
                </td>
              </tr>
            ))}
        </tbody>
      </table>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-white/10">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {[10,20,50,100,500].map(n => (
            <button key={n} className={`px-2 py-0.5 rounded ${n === 100 ? "bg-blue-600 text-white" : "hover:bg-white/10"}`}>{n}</button>
          ))}
        </div>
        <button className="btn bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-2 px-4 py-1.5 text-sm">
          <Save className="h-3.5 w-3.5" />Save & PO
        </button>
      </div>
    </div>
  );
}
