import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { ALL_TECHNICIANS, LOCATIONS } from "@/lib/locations";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

interface ReceiveItem {
  id: string;
  partFrom: string;
  poNumber: string;
  poDate: string;
  orderNo: string;
  partNumber: string;
  partDesc: string;
  eta: string;
  receiveDate: string;
  tracking: string;
  ticketNo: string;
  ticketStatus: string;
  tech: string;
  schedule: string;
  total: number;
  rcvd: number;
  partCost: number;
  coreCost: number;
  received: boolean;
}

const PART_FROM_OPTIONS = [
  "AIG", "Electrolux", "Encompass", "Encompass-Birmingham/Montgomery",
  "GE", "LG", "Marcone-Birmingham/Montgomery", "Marcone-162468",
  "Midea", "Miele", "NSA", "OW", "SB", "Sharp", "SP", "Squaretrade", "SS"
  ,"UPS"
];

const TICKET_STATUS_OPTIONS = ["Open", "In Progress", "Ready", "Completed", "On Hold"];
const TECH_OPTIONS = ALL_TECHNICIANS;

function getTrackingUrl(tracking: string, partFrom: string) {
  const value = tracking.trim();
  const source = partFrom.trim().toLowerCase();
  if (!value) return "#";
  if (source.includes("marcone")) {
    return `https://www.google.com/search?q=${encodeURIComponent(`site:marcone.com ${value} tracking`)}`;
  }
  if (value.startsWith("1Z")) {
    return `https://www.ups.com/track?track=yes&trackNums=${encodeURIComponent(value)}`;
  }
  if (/^\d{12,14}$/.test(value)) {
    return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(value)}`;
  }
  if (/^(94|93|92|95|96)/.test(value)) {
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(value)}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(value + " tracking")}`;
}

const SAMPLE_RECEIVES: ReceiveItem[] = [
  {
    id: "RCV-001",
    partFrom: "UPS",
    poNumber: "PO-7001",
    poDate: "2026-04-28",
    orderNo: "ORD-2301",
    partNumber: "ACQ86576404",
    partDesc: "Compressor Motor",
    eta: "2026-05-30",
    receiveDate: "2026-05-28",
    tracking: "1Z999AA10123456784",
    ticketNo: "TK-001549",
    ticketStatus: "Ready",
    tech: "M. Patel",
    schedule: "2026-05-29",
    total: 5,
    rcvd: 5,
    partCost: 285.00,
    coreCost: 45.00,
    received: true,
  },
  {
    id: "RCV-002",
    partFrom: "Encompass",
    poNumber: "PO-7002",
    poDate: "2026-04-25",
    orderNo: "ORD-2302",
    partNumber: "WPW10217825",
    partDesc: "Wire Harness",
    eta: "2026-06-05",
    receiveDate: "",
    tracking: "1Z999AA10123456785",
    ticketNo: "TK-001548",
    ticketStatus: "In Progress",
    tech: "A. Reyes",
    schedule: "2026-06-01",
    total: 3,
    rcvd: 0,
    partCost: 65.00,
    coreCost: 0.00,
    received: false,
  },
  {
    id: "RCV-003",
    partFrom: "LG",
    poNumber: "PO-7003",
    poDate: "2026-04-20",
    orderNo: "ORD-2303",
    partNumber: "RPS345-78",
    partDesc: "Pump Assembly",
    eta: "2026-05-15",
    receiveDate: "2026-05-15",
    tracking: "1Z999AA10123456786",
    ticketNo: "TK-001547",
    ticketStatus: "Completed",
    tech: "J. Kim",
    schedule: "2026-05-16",
    total: 2,
    rcvd: 2,
    partCost: 195.00,
    coreCost: 25.00,
    received: true,
  },
  {
    id: "RCV-004",
    partFrom: "AIG",
    poNumber: "PO-7004",
    poDate: "2026-05-01",
    orderNo: "ORD-2304",
    partNumber: "EVT456-12",
    partDesc: "Evaporator Coil",
    eta: "2026-06-10",
    receiveDate: "",
    tracking: "1Z999AA10123456787",
    ticketNo: "TK-001546",
    ticketStatus: "Open",
    tech: "S. Brown",
    schedule: "2026-06-11",
    total: 1,
    rcvd: 0,
    partCost: 425.00,
    coreCost: 85.00,
    received: false,
  },
];

export function PartReceive({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [location, setLocation] = useState("Asheville");
  const [partFrom, setPartFrom] = useState("");
  const [dateFrom, setDateFrom] = useState("2026-04-28");
  const [dateTo, setDateTo] = useState("2026-05-28");
  const [showNotReceived, setShowNotReceived] = useState(true);
  const [showReceived, setShowReceived] = useState(true);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [receiveItems, setReceiveItems] = useState<ReceiveItem[]>(SAMPLE_RECEIVES);

  const toggleItemSelection = (id: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedItems(newSelected);
  };

  const toggleAllItems = () => {
    if (selectedItems.size === filteredItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredItems.map(item => item.id)));
    }
  };

  const updateReceivedQuantity = (id: string, value: string) => {
    const nextValue = Number.parseInt(value, 10);
    setReceiveItems((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              rcvd: Number.isNaN(nextValue) ? 0 : Math.min(item.total, Math.max(0, nextValue)),
              received: Number.isNaN(nextValue) ? false : nextValue > 0,
            }
          : item,
      ),
    );
  };

  const filteredItems = receiveItems.filter(item => {
    if (partFrom && item.partFrom !== partFrom) {
      return false;
    }
    const receivedFilter = item.received ? showReceived : showNotReceived;
    return receivedFilter;
  });

  const totals = {
    total: filteredItems.reduce((sum, item) => sum + item.total, 0),
    rcvd: filteredItems.reduce((sum, item) => sum + item.rcvd, 0),
    partCost: filteredItems.reduce((sum, item) => sum + item.partCost, 0),
    coreCost: filteredItems.reduce((sum, item) => sum + item.coreCost, 0),
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">
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
            .date-range { display: flex; align-items: center; gap: 0.5rem; }
            .date-range input { flex: 1; }
            .date-range-sep { color: #64748b; font-weight: 600; }
            .checkbox-group { display: flex; align-items: center; gap: 1rem; }
            .checkbox-item { display: flex; align-items: center; gap: 0.5rem; }
            .checkbox-item input[type="checkbox"] { width: 18px; height: 18px; cursor: pointer; }
            .checkbox-item label { margin: 0; cursor: pointer; font-size: 0.9rem; }
          `}</style>

          {/* Filter Section */}
          <div>
            <h3 className="form-section-title">Filters</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="form-group">
                <label className="required" htmlFor="part-receive-location">Location</label>
                <select id="part-receive-location" value={location} onChange={(e) => setLocation(e.target.value)} className="glass-input">
                  {LOCATIONS.map(loc => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="part-receive-part-from">Part From</label>
                <select id="part-receive-part-from" value={partFrom} onChange={(e) => setPartFrom(e.target.value)} className="glass-input">
                  <option value="">Select Source</option>
                  {PART_FROM_OPTIONS.map(src => (
                    <option key={src} value={src}>{src}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="required">Date Range</label>
                <div className="date-range">
                  <label htmlFor="part-receive-date-from" className="sr-only">Date from</label>
                  <input id="part-receive-date-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="glass-input" />
                  <span className="date-range-sep">~</span>
                  <label htmlFor="part-receive-date-to" className="sr-only">Date to</label>
                  <input id="part-receive-date-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="glass-input" />
                </div>
              </div>

              <div className="form-group">
                <label>Receive Status</label>
                <div className="checkbox-group">
                  <div className="checkbox-item">
                    <input
                      type="checkbox"
                      id="notReceived"
                      checked={showNotReceived}
                      onChange={(e) => setShowNotReceived(e.target.checked)}
                    />
                    <label htmlFor="notReceived">Not Received</label>
                  </div>
                  <div className="checkbox-item">
                    <input
                      type="checkbox"
                      id="received"
                      checked={showReceived}
                      onChange={(e) => setShowReceived(e.target.checked)}
                    />
                    <label htmlFor="received">Received</label>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Receive Table */}
          <div className="mt-8 overflow-x-auto border border-white/10 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-blue-900/50 border-b border-blue-500/30">
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">
                    <input
                      type="checkbox"
                      aria-label="Select all rows"
                      checked={selectedItems.size === filteredItems.length && filteredItems.length > 0}
                      onChange={toggleAllItems}
                      className="cursor-pointer"
                    />
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Comp*</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Unique ID*</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">PO Number</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Part From</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">P/O Date</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Order No</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Part Number*</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Part Desc*</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">ETA</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Receive Date</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Tracking</th>
                  <th colSpan={4} className="px-4 py-3 text-center font-semibold text-blue-300">Ticket</th>
                  <th className="px-4 py-3 text-center font-semibold text-blue-300">Quantity Ordered</th>
                  <th className="px-4 py-3 text-center font-semibold text-blue-300">Quantity Received</th>
                  <th className="px-4 py-3 text-center font-semibold text-blue-300">$ Part</th>
                  <th className="px-4 py-3 text-center font-semibold text-blue-300">$ Core</th>
                </tr>
                <tr className="bg-blue-900/30 border-b border-blue-500/20">
                  <th colSpan={12} className="px-4 py-2"></th>
                  <th className="px-4 py-2 text-xs font-semibold text-blue-200 border-l border-blue-500/20">Ticket No</th>
                  <th className="px-4 py-2 text-xs font-semibold text-blue-200 border-l border-blue-500/20">Status</th>
                  <th className="px-4 py-2 text-xs font-semibold text-blue-200 border-l border-blue-500/20">Tech</th>
                  <th className="px-4 py-2 text-xs font-semibold text-blue-200 border-l border-blue-500/20">Schedule</th>
                  <th colSpan={4} className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item, idx) => (
                  <tr key={item.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        aria-label={`Select row ${item.id}`}
                        checked={selectedItems.has(item.id)}
                        onChange={() => toggleItemSelection(item.id)}
                        className="cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <input type="checkbox" checked={item.received} readOnly aria-label={`Received status for ${item.id}`} className="cursor-not-allowed" />
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-300">{item.id}</td>
                    <td className="px-4 py-3 text-slate-300">{item.poNumber}</td>
                    <td className="px-4 py-3 text-slate-300">{item.partFrom}</td>
                    <td className="px-4 py-3 text-slate-300">{item.poDate}</td>
                    <td className="px-4 py-3 text-slate-300">{item.orderNo}</td>
                    <td className="px-4 py-3 font-mono text-slate-300">{item.partNumber}</td>
                    <td className="px-4 py-3 text-slate-300">{item.partDesc}</td>
                    <td className="px-4 py-3 text-slate-300">{item.eta}</td>
                    <td className="px-4 py-3 text-slate-300">{item.receiveDate || "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-300">
                      <a href={getTrackingUrl(item.tracking, item.partFrom)} target="_blank" rel="noreferrer" className="text-blue-300 underline decoration-dotted underline-offset-4 hover:text-blue-200">
                        {item.tracking}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{item.ticketNo}</td>
                    <td className="px-4 py-3 text-blue-400 font-semibold">{item.ticketStatus}</td>
                    <td className="px-4 py-3 text-slate-300">{item.tech}</td>
                    <td className="px-4 py-3 text-slate-300">{item.schedule}</td>
                    <td className="px-4 py-3 text-center font-semibold text-slate-300">{item.total}</td>
                    <td className="px-4 py-3 text-center font-semibold text-green-400">
                      <label className="sr-only" htmlFor={`received-qty-${item.id}`}>Quantity received for {item.id}</label>
                      <input
                        id={`received-qty-${item.id}`}
                        type="number"
                        min={0}
                        max={item.total}
                        value={item.rcvd}
                        onChange={(event) => updateReceivedQuantity(item.id, event.target.value)}
                        className="w-20 rounded border border-white/10 bg-slate-950/70 px-2 py-1 text-center text-sm font-semibold text-green-400 outline-none transition focus:border-green-400"
                      />
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">${item.partCost.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right text-slate-300">${item.coreCost.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-blue-900/50 border-t-2 border-blue-500/30 font-semibold text-blue-300">
                  <td colSpan={16} className="px-4 py-3 text-right">Totals:</td>
                  <td className="px-4 py-3 text-center">{totals.total}</td>
                  <td className="px-4 py-3 text-center text-green-400">{totals.rcvd}</td>
                  <td className="px-4 py-3 text-right">${totals.partCost.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right">${totals.coreCost.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
