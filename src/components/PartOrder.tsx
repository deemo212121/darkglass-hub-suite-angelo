import { useState, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { ALL_TECHNICIANS, LOCATIONS } from "@/lib/locations";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

interface OrderItem {
  ticketNo: string;
  status: string;
  partDist: string;
  partNo: string;
  description: string;
  requestQty: number;
  availQty: number;
  eta: string;
}

const PART_DIST_OPTIONS = ["LG", "Encompass", "SS", "Marcone-162468", "Encompass-Birmingham/Montgomery"];
const WARRANTY_TYPES = [
  "Concession LP", "Concession L", "Concession P", "In warranty", "Labor only Wty",
  "Out-of-warranty", "Part only Wty", "Special Part 5 year", "Unknown", "Ext Wty",
  "Ext Labor Wty", "Ext Part Wty"
];

const SAMPLE_ORDERS: OrderItem[] = [
  { ticketNo: "TK-001549", status: "Need PO", partDist: "LG", partNo: "ACQ86576404", description: "Compressor Motor", requestQty: 1, availQty: 0, eta: "2026-06-05" },
  { ticketNo: "TK-001548", status: "Need PO", partDist: "Encompass", partNo: "WPW10217825", description: "Wire Harness", requestQty: 2, availQty: 1, eta: "" },
  { ticketNo: "TK-001547", status: "Need PO", partDist: "SS", partNo: "RPS345-78", description: "Pump Assembly", requestQty: 1, availQty: 0, eta: "2026-06-10" },
  { ticketNo: "TK-001546", status: "Need PO", partDist: "Marcone-162468", partNo: "EVT456-12", description: "Evaporator Coil", requestQty: 1, availQty: 0, eta: "" },
  { ticketNo: "TK-001545", status: "Need PO", partDist: "LG", partNo: "LG123-456", description: "Door Seal", requestQty: 1, availQty: 1, eta: "2026-06-08" },
];

export function PartOrder({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [location, setLocation] = useState("");
  const [partDist, setPartDist] = useState("");
  const [technician, setTechnician] = useState("");
  const [scheduleDate, setScheduleDate] = useState("2026-05-15");
  const [warrantyType, setWarrantyType] = useState("");
  const [repairStatus] = useState("Need PO");

  const reservePart = (ticketNo: string) => {
    alert(`Reservation initiated for Ticket: ${ticketNo}`);
  };

  const manualPO = (ticketNo: string) => {
    alert(`Manual P/O initiated for Ticket: ${ticketNo}`);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-6">
            <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
              <ChevronLeft className="h-4 w-4" /> {mod.label}
            </Link>
          </div>
          <h1 className="text-4xl font-display font-bold tracking-tight mb-2">{sub.title}</h1>
          <p className="text-lg text-muted-foreground">{sub.description}</p>
        </div>

        <div className="panel">
          <style>{`
            .form-group { display: flex; flex-direction: column; gap: 0.35rem; }
            .form-group label { font-size: 0.8rem; font-weight: 600; letter-spacing: 0.02em; color: #e5e7eb; }
            .form-group label.required::after { content: " *"; color: #ef4444; }
            .form-section-title { font-size: 0.95rem; font-weight: 600; color: #64b5f6; margin-bottom: 1rem; text-transform: uppercase; letter-spacing: 0.05em; }
          `}</style>
          
          {/* Order Criteria Section */}
          <div>
            <h3 className="form-section-title">Filter Criteria</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="form-group">
                <label className="required">Location</label>
                <select value={location} onChange={(e) => setLocation(e.target.value)} className="glass-input">
                  <option value="">Select Location</option>
                  {LOCATIONS.map(loc => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Part Dist.</label>
                <select value={partDist} onChange={(e) => setPartDist(e.target.value)} className="glass-input">
                  <option value="">Select Distributor</option>
                  {PART_DIST_OPTIONS.map(dist => (
                    <option key={dist} value={dist}>{dist}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Technician</label>
                <select value={technician} onChange={(e) => setTechnician(e.target.value)} className="glass-input">
                  <option value="">Select Technician</option>
                  {ALL_TECHNICIANS.map((tech) => (
                    <option key={tech} value={tech}>{tech}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="required">Schedule Date</label>
                <input type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} className="glass-input" />
              </div>

              <div className="form-group">
                <label className="required">Warranty Type</label>
                <select value={warrantyType} onChange={(e) => setWarrantyType(e.target.value)} className="glass-input">
                  <option value="">Select Warranty Type</option>
                  {WARRANTY_TYPES.map(wt => (
                    <option key={wt} value={wt}>{wt}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Repair Status</label>
                <select disabled value={repairStatus} className="glass-input opacity-75 cursor-not-allowed">
                  <option value="Need PO">Need PO</option>
                </select>
                <small className="text-xs text-slate-400 mt-1">Locked to "Need PO"</small>
              </div>
            </div>
          </div>

          {/* Order Table */}
          <div className="mt-8 overflow-x-auto border border-white/10 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-blue-900/50 border-b border-blue-500/30">
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Ticket #</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Part Dist.</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Part No</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Description</th>
                  <th colSpan={2} className="px-4 py-3 text-center font-semibold text-blue-300">ETA on Inventory</th>
                  <th colSpan={2} className="px-4 py-3 text-center font-semibold text-blue-300">Action</th>
                </tr>
                <tr className="bg-blue-900/30 border-b border-blue-500/20">
                  <th colSpan={5} className="px-4 py-2"></th>
                  <th className="px-4 py-2 text-xs font-semibold text-blue-200 border-l border-blue-500/20">Request</th>
                  <th className="px-4 py-2 text-xs font-semibold text-blue-200 border-l border-blue-500/20">Avail.</th>
                  <th className="px-4 py-2 text-xs font-semibold text-blue-200 border-l border-blue-500/20">Reserve</th>
                  <th className="px-4 py-2 text-xs font-semibold text-blue-200 border-l border-blue-500/20">Manual P/O</th>
                </tr>
              </thead>
              <tbody>
                {SAMPLE_ORDERS.map((order, idx) => {
                  const hasETA = order.eta && order.eta.trim() !== "";
                  return (
                    <tr key={idx} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="px-4 py-3 font-mono text-slate-300">{order.ticketNo}</td>
                      <td className="px-4 py-3 font-semibold text-blue-400">{order.status}</td>
                      <td className="px-4 py-3 text-slate-300">{order.partDist}</td>
                      <td className="px-4 py-3 font-mono text-slate-300">{order.partNo}</td>
                      <td className="px-4 py-3 text-slate-300">{order.description}</td>
                      <td className="px-4 py-3 text-center text-slate-400">{order.requestQty}</td>
                      <td className="px-4 py-3 text-center text-slate-400">{order.availQty}</td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => reservePart(order.ticketNo)} className="px-2 py-1 text-xs font-semibold rounded bg-blue-500/20 text-blue-400 border border-blue-500/40 hover:bg-blue-500/30 transition-colors">
                          Reserve
                        </button>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => manualPO(order.ticketNo)}
                          disabled={!hasETA}
                          className={`px-2 py-1 text-xs font-semibold rounded transition-colors ${
                            hasETA
                              ? "bg-green-500/20 text-green-400 border border-green-500/40 hover:bg-green-500/30 cursor-pointer"
                              : "bg-gray-500/20 text-gray-500 border border-gray-500/40 cursor-not-allowed opacity-50"
                          }`}
                          title={hasETA ? "Create manual purchase order" : "Visible only when ETA is set"}
                        >
                          Manual P/O
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
