import { useState, useMemo, useEffect, useCallback } from "react";
import { lookupZip } from "@/lib/zipCoverage";
import { useAuth } from "@/lib/auth";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Clock, History, X, User } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, mergeLocationOptions } from "@/lib/locations";

interface TicketItem {
  ticketNo: string;
  ticketSource?: string;
  warranty: string;
  manufacturer: string;
  customer: string;
  city: string;
  location: string;
  model: string;
  internalNote: string;
  diagnosed: string;
  technician: string;
  customerPref: string;
  schedule: string;
  status: string;
  phone: string;
  redo: string;
  aging: number;
  calls: number;
  partOrder: string;
  created: string;
  statusChangedAt?: string;  // ISO timestamp of last status change
  statusChangedBy?: string; // who made the last change
}

const TICKET_SOURCES = ["LG", "Midea-104268", "NSA GSLEE", "NSA MEMPHIS", "SB", "SB-1276506820", "SB-Miele", "SP", "SP1", "SS", "SS-6488757", "EarlyRepair"] as const;
const REPAIR_STATUS_OPTIONS = [
  "CL-Need",
  "Cancel",
  "CL-Parts Back Ordered",
  "CL-Ready to Complete",
  "CSR-Acknowledged",
  "CSR-Assigned to ASC",
  "CSR-Left Message for Cx",
  "CSR-Needs Scheduling",
  "OP-Ready for Service",
  "OP-Reschedule Follow up",
  "OP-UPDATE HOLD",
  "OP-Waiting for Part",
  "PT-Need PreAuthorization",
  "TR-Need PO",
  "TR-Need Trage",
] as const;
const LOCATION_STORAGE_KEY = "ahs:location-management:locations";
const STATUS_LOG_KEY = "ahs:ticket:status-log";
const TICKET_VISITS_KEY = "ahs:ticket:visits"; // Track who visited which tickets

interface StatusLogEntry {
  ticketNo: string;
  fromStatus: string;
  toStatus: string;
  changedBy: string;
  changedAt: string; // ISO string
  note?: string;
}

interface TicketVisit {
  ticketNo: string;
  visitedBy: string;
  visitedAt: string; // ISO string
}

function loadStatusLog(): StatusLogEntry[] {
  try { return JSON.parse(localStorage.getItem(STATUS_LOG_KEY) || "[]"); }
  catch { return []; }
}

function saveStatusLog(log: StatusLogEntry[]) {
  try { localStorage.setItem(STATUS_LOG_KEY, JSON.stringify(log)); } catch {}
}

function loadTicketVisits(): TicketVisit[] {
  try { return JSON.parse(localStorage.getItem(TICKET_VISITS_KEY) || "[]"); }
  catch { return []; }
}

function saveTicketVisits(visits: TicketVisit[]) {
  try { localStorage.setItem(TICKET_VISITS_KEY, JSON.stringify(visits)); } catch {}
}

function markTicketAsVisited(ticketNo: string, userName: string): void {
  const visits = loadTicketVisits();
  // Check if this user already visited this ticket
  const existingVisit = visits.find(v => v.ticketNo === ticketNo && v.visitedBy === userName);
  if (!existingVisit) {
    visits.push({ ticketNo, visitedBy: userName, visitedAt: new Date().toISOString() });
    saveTicketVisits(visits);
  }
}

function getTicketVisitors(ticketNo: string): string[] {
  const visits = loadTicketVisits();
  return [...new Set(visits.filter(v => v.ticketNo === ticketNo).map(v => v.visitedBy))];
}

function daysAgo(isoString: string): number {
  const d = new Date(isoString);
  const now = new Date();
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function fmtTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "2-digit", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function loadSavedLocations(): string[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(LOCATION_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { rows?: Array<{ location?: string }> };
    return Array.isArray(parsed.rows)
      ? parsed.rows.map((row) => row.location?.trim()).filter((value): value is string => Boolean(value))
      : [];
  } catch {
    return [];
  }
}

function parseTicketDate(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (!match) return "";
  const [, month, day, year] = match;
  return `20${year}-${month}-${day}`;
}

function isWithinDateRange(value: string, startDate: string, endDate: string) {
  const normalized = parseTicketDate(value);
  if (!normalized) return false;
  if (startDate && normalized < startDate) return false;
  if (endDate && normalized > endDate) return false;
  return true;
}

const RAW_SAMPLE_TICKETS: TicketItem[] = [
  {
    ticketNo: "SA-3458831",
    warranty: "IW",
    manufacturer: "IH",
    customer: "Neal Market",
    city: "GREENSBORO",
    location: "Atlanta",
    model: "GNE27JYMFFS",
    internalNote: "",
    diagnosed: "N",
    technician: "",
    customerPref: "N",
    schedule: "05/21/26",
    status: "CSR-Assigned to ASC",
    phone: "706.817.2900",
    redo: "N",
    aging: 0,
    calls: 0,
    partOrder: "Not Diagnosed",
    created: "05/18/26",
  },
  {
    ticketNo: "26000679102DF",
    warranty: "IW",
    manufacturer: "IH",
    customer: "Brian Rowe",
    city: "SHADY DALE",
    location: "Atlanta",
    model: "FCRE3083AS",
    internalNote: "",
    diagnosed: "N",
    technician: "",
    customerPref: "N",
    schedule: "05/19/26",
    status: "CSR-Assigned to ASC",
    phone: "706.366.1043",
    redo: "N",
    aging: 1,
    calls: 0,
    partOrder: "Not Diagnosed",
    created: "05/17/26",
  },
  {
    ticketNo: "1007208750-10",
    warranty: "IW",
    manufacturer: "IH",
    customer: "Charles Mcdonald",
    city: "GREENSBORO",
    location: "Atlanta",
    model: "FRUF2020AW",
    internalNote: "",
    diagnosed: "N",
    technician: "",
    customerPref: "N",
    schedule: "05/19/26",
    status: "CSR-Assigned to ASC",
    phone: "404.680.4022",
    redo: "N",
    aging: 1,
    calls: 0,
    partOrder: "Not Diagnosed",
    created: "05/17/26",
  },
  {
    ticketNo: "026000671769DF1",
    warranty: "IW",
    manufacturer: "IH",
    customer: "Rose Phillips",
    city: "ELLENWOOD",
    location: "Atlanta",
    model: "DV45K7600EW",
    internalNote: "",
    diagnosed: "Y",
    technician: "Nathan Napora",
    customerPref: "Y",
    schedule: "05/18/26",
    status: "OP-Waiting for Part",
    phone: "404.640.7141",
    redo: "Y",
    aging: 3,
    calls: 0,
    partOrder: "Part Ordered",
    created: "05/15/26",
  },
  {
    ticketNo: "7039321404BL-13",
    warranty: "IW",
    manufacturer: "IH",
    customer: "Melissa Beaver",
    city: "EATONTON",
    location: "Atlanta",
    model: "GCCE3670AS",
    internalNote: "WF 05/15 waiting for parts tracking",
    diagnosed: "Y",
    technician: "Joshua Silva",
    customerPref: "N",
    schedule: "05/15/26",
    status: "OP-Waiting for Part",
    phone: "703.932.1404",
    redo: "Y",
    aging: 4,
    calls: 0,
    partOrder: "Partially Ordered",
    created: "05/14/26",
  },
  {
    ticketNo: "SA-3433383",
    warranty: "IW",
    manufacturer: "IH",
    customer: "Accent Overlook",
    city: "CANTON",
    location: "Atlanta",
    model: "GDT535PSRSS",
    internalNote: "",
    diagnosed: "N",
    technician: "",
    customerPref: "Y",
    schedule: "05/18/26",
    status: "CSR-Left Message for Cx",
    phone: "770.766.0064",
    redo: "N",
    aging: 4,
    calls: 2,
    partOrder: "Not Diagnosed",
    created: "05/14/26",
  },
  {
    ticketNo: "SA-3431358",
    warranty: "IW",
    manufacturer: "IH",
    customer: "Evelin Tirado",
    city: "EATONTON",
    location: "Atlanta",
    model: "HDF330PGRBB",
    internalNote: "",
    diagnosed: "N",
    technician: "",
    customerPref: "N",
    schedule: "05/19/26",
    status: "CSR-Left Message for Cx",
    phone: "706.816.6545",
    redo: "N",
    aging: 4,
    calls: 2,
    partOrder: "Not Diagnosed",
    created: "05/14/26",
  },
  {
    ticketNo: "3850106E11",
    warranty: "IW",
    manufacturer: "IH",
    customer: "Tricon Propertymanager",
    city: "DALLAS",
    location: "Atlanta",
    model: "GTX22EASK1WW",
    internalNote: "WF 05/16 - Sent message to tech",
    diagnosed: "N",
    technician: "Abel Severino",
    customerPref: "N",
    schedule: "05/15/26",
    status: "OP-UPDATE HOLD",
    phone: "678.508.7857",
    redo: "N",
    aging: 5,
    calls: 0,
    partOrder: "Not Diagnosed",
    created: "05/13/26",
  },
  {
    ticketNo: "26000663669DF1",
    warranty: "IW",
    manufacturer: "IH",
    customer: "Shirley Gentry",
    city: "TAYLORSVILLE",
    location: "Atlanta",
    model: "MVW7232HW",
    internalNote: "",
    diagnosed: "N",
    technician: "Abel Severino",
    customerPref: "N",
    schedule: "05/15/26",
    status: "TR-Need Triage",
    phone: "770.316.3847",
    redo: "N",
    aging: 5,
    calls: 0,
    partOrder: "Not Diagnosed",
    created: "05/13/26",
  },
  {
    ticketNo: "SA-34125461",
    warranty: "IW",
    manufacturer: "IH",
    customer: "Mike Daly",
    city: "ACWORTH",
    location: "Atlanta",
    model: "PDT715SYVFS",
    internalNote: "",
    diagnosed: "N",
    technician: "Gerrell Berg",
    customerPref: "N",
    schedule: "05/15/26",
    status: "TR-Need Triage",
    phone: "262.707.4813",
    redo: "N",
    aging: 5,
    calls: 1,
    partOrder: "Not Diagnosed",
    created: "05/13/26",
  },
];

const SAMPLE_TICKETS: TicketItem[] = RAW_SAMPLE_TICKETS.map((ticket, index) => ({
  ...ticket,
  ticketSource: TICKET_SOURCES[index % TICKET_SOURCES.length],
}));

export function TicketList({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const { email } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [repairStatusFilter, setRepairStatusFilter] = useState("");
  const [startDateFilter, setStartDateFilter] = useState("");
  const [endDateFilter, setEndDateFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [ticketSourceFilter, setTicketSourceFilter] = useState("");
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [statusLog, setStatusLog] = useState<StatusLogEntry[]>([]);
  const [agingModal, setAgingModal] = useState<{ ticketNo: string; status: string } | null>(null);
  const [changeNoteInput, setChangeNoteInput] = useState("");
  const [changeByInput, setChangeByInput] = useState("");
  const [visitedTickets, setVisitedTickets] = useState<Set<string>>(new Set());

  useEffect(() => { setStatusLog(loadStatusLog()); }, []);
  useEffect(() => { 
    // Load visited tickets from localStorage whenever component mounts
    const visits = loadTicketVisits();
    const visited = new Set(visits.map(v => v.ticketNo));
    setVisitedTickets(visited);
    
    // Also listen for storage changes from other tabs/windows
    const handleStorageChange = () => {
      const updatedVisits = loadTicketVisits();
      const updatedVisited = new Set(updatedVisits.map(v => v.ticketNo));
      setVisitedTickets(updatedVisited);
    };
    
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  const logStatusChange = useCallback((ticketNo: string, fromStatus: string, toStatus: string) => {
    const entry: StatusLogEntry = {
      ticketNo,
      fromStatus,
      toStatus,
      changedBy: changeByInput.trim() || "System",
      changedAt: new Date().toISOString(),
      note: changeNoteInput.trim() || undefined,
    };
    const updated = [entry, ...statusLog];
    setStatusLog(updated);
    saveStatusLog(updated);
    setChangeNoteInput("");
  }, [statusLog, changeByInput, changeNoteInput]);

  const ticketAgingDays = useCallback((ticket: { ticketNo: string; aging: number; statusChangedAt?: string }) => {
    // Find most recent status change for this ticket
    const lastChange = statusLog
      .filter(l => l.ticketNo === ticket.ticketNo)
      .sort((a, b) => b.changedAt.localeCompare(a.changedAt))[0];
    if (lastChange) return daysAgo(lastChange.changedAt);
    // If statusChangedAt recorded on the ticket itself
    if (ticket.statusChangedAt) return daysAgo(ticket.statusChangedAt);
    // Fallback to seed data aging
    return ticket.aging;
  }, [statusLog]);

  const ticketStatusLog = useCallback((ticketNo: string) => {
    return statusLog.filter(l => l.ticketNo === ticketNo).sort((a, b) => b.changedAt.localeCompare(a.changedAt));
  }, [statusLog]);

  const locationOptions = useMemo(
    () => mergeLocationOptions(LOCATIONS, loadSavedLocations(), SAMPLE_TICKETS.map((ticket) => ticket.location)),
    [],
  );
  const ticketSourceOptions = useMemo(() => Array.from(new Set(SAMPLE_TICKETS.map((ticket) => ticket.ticketSource || "").filter(Boolean))).sort((a, b) => a.localeCompare(b)), []);

  const filteredItems = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return SAMPLE_TICKETS.filter((ticket) => {
      const matchesSearch = !query || [ticket.ticketNo, ticket.customer, ticket.city, ticket.phone, ticket.model, ticket.location, ticket.status, ticket.ticketSource || ""].some((value) => value.toLowerCase().includes(query));
      const matchesRepairStatus = !repairStatusFilter || ticket.status === repairStatusFilter;
      const matchesDate = (!startDateFilter && !endDateFilter) || isWithinDateRange(ticket.schedule, startDateFilter, endDateFilter);
      const matchesLocation = !locationFilter || ticket.location === locationFilter;
      const matchesSource = !ticketSourceFilter || (ticket.ticketSource || "") === ticketSourceFilter;
      return matchesSearch && matchesRepairStatus && matchesDate && matchesLocation && matchesSource;
    });
  }, [endDateFilter, locationFilter, repairStatusFilter, searchQuery, startDateFilter, ticketSourceFilter]);

  const toggleItemSelection = (ticketNo: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(ticketNo)) {
      newSelected.delete(ticketNo);
    } else {
      newSelected.add(ticketNo);
    }
    setSelectedItems(newSelected);
  };

  const toggleAllItems = () => {
    if (selectedItems.size === filteredItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredItems.map(item => item.ticketNo)));
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1900px] mx-auto w-full px-6 py-8">
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
          <div className="mb-6 space-y-3">
            <div className="grid gap-3 lg:grid-cols-3">
              <input
                type="text"
                placeholder="ticket, zip code, address, name, etc" onKeyDown={(e)=>{if(e.key==="Enter"&&(e.target as HTMLInputElement).value.length===5){const z=lookupZip((e.target as HTMLInputElement).value);if(z)console.log("Zip",e.target,"→",z.location);}}}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="glass-input w-full"
                aria-label="Search tickets"
              />
              <select aria-label="Repair status filter" value={repairStatusFilter} onChange={(e) => setRepairStatusFilter(e.target.value)} className="glass-input w-full">
                <option value="">All Repair Status</option>
                {REPAIR_STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <select aria-label="Location filter" value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="glass-input w-full">
                <option value="">All Locations</option>
                {locationOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <div className="grid gap-3 lg:grid-cols-3">
              <input aria-label="Start date" type="date" value={startDateFilter} onChange={(e) => setStartDateFilter(e.target.value)} className="glass-input w-full" />
              <input aria-label="End date" type="date" value={endDateFilter} onChange={(e) => setEndDateFilter(e.target.value)} className="glass-input w-full" />
              <select aria-label="Ticket source filter" value={ticketSourceFilter} onChange={(e) => setTicketSourceFilter(e.target.value)} className="glass-input w-full">
                <option value="">All Ticket Sources</option>
                {ticketSourceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
          </div>

          {/* Ticket Table */}
          <div className="overflow-x-auto border border-white/10 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-blue-900/50 border-b border-blue-500/30">
                  <th className="px-4 py-3 text-center font-semibold text-blue-300 w-12">✓</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Ticket No</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Wty</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Ticket Source</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Cx Name</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">City</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Loc</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Model</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Internal Note</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Repair</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Technician</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Cx Prefer</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Schedule</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Phone</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Redo</th>
                  <th className="px-4 py-3 text-center font-semibold text-blue-300">Aging</th>
                  <th className="px-4 py-3 text-center font-semibold text-blue-300">Calls</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Part Order</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Posting</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((ticket) => (
                  <tr key={ticket.ticketNo} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3 text-center font-bold text-green-400 w-12" title={visitedTickets.has(ticket.ticketNo) ? `Visited by: ${getTicketVisitors(ticket.ticketNo).join(", ")}` : "Not visited"}>
                      {visitedTickets.has(ticket.ticketNo) ? "✓" : ""}
                    </td>
                    <td className="px-4 py-3 font-mono text-blue-400 font-semibold">
                      <a
                        href={`/ticket/${ticket.ticketNo}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => {
                          console.log("Ticket clicked, email:", email);
                          if (email) {
                            console.log("Marking ticket as visited:", ticket.ticketNo, email);
                            markTicketAsVisited(ticket.ticketNo, email);
                            setVisitedTickets(prev => {
                              const newSet = new Set([...prev, ticket.ticketNo]);
                              console.log("Updated visitedTickets:", newSet);
                              return newSet;
                            });
                          } else {
                            console.warn("No email available");
                          }
                        }}
                        className="hover:text-blue-300 hover:underline transition cursor-pointer"
                      >
                        {ticket.ticketNo}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{ticket.warranty}</td>
                    <td className="px-4 py-3 text-slate-300">{ticket.ticketSource || ticket.manufacturer}</td>
                    <td className="px-4 py-3 text-slate-300">{ticket.customer}</td>
                    <td className="px-4 py-3 text-slate-300">{ticket.city}</td>
                    <td className="px-4 py-3 text-slate-300">{ticket.location}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-300">{ticket.model}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs max-w-xs truncate" title={ticket.internalNote}>
                      {ticket.internalNote || "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{ticket.diagnosed}</td>
                    <td className="px-4 py-3 text-slate-300">{ticket.technician || "—"}</td>
                    <td className="px-4 py-3 text-center text-slate-300">{ticket.customerPref}</td>
                    <td className="px-4 py-3 text-slate-300">{ticket.schedule}</td>
                    <td className="px-4 py-3 text-blue-300 font-semibold text-sm">{ticket.status}</td>
                    <td className="px-4 py-3 text-slate-300">{ticket.phone}</td>
                    <td className="px-4 py-3 text-center text-slate-300">{ticket.redo}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => setAgingModal({ ticketNo: ticket.ticketNo, status: ticket.status })}
                        title="View status change log"
                        className="group flex flex-col items-center gap-0.5 mx-auto hover:opacity-80 transition-opacity"
                      >
                        {(() => {
                          const days = ticketAgingDays(ticket);
                          const color = days <= 3 ? "text-green-400" : days <= 7 ? "text-yellow-400" : days <= 14 ? "text-orange-400" : "text-red-400";
                          return (
                            <>
                              <span className={`font-bold text-sm ${color}`}>{days}d</span>
                              <History className="h-3 w-3 text-white/20 group-hover:text-white/50 transition-colors" />
                            </>
                          );
                        })()}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center text-slate-300">{ticket.calls}</td>
                    <td className="px-4 py-3 text-slate-300">{ticket.partOrder}</td>
                    <td className="px-4 py-3 text-slate-300">{ticket.created}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredItems.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <p>No tickets found matching "{searchQuery}"</p>
            </div>
          )}

          <div className="mt-4 text-sm text-muted-foreground">
            Showing {filteredItems.length} of {SAMPLE_TICKETS.length} tickets ({selectedItems.size} selected)
          </div>
        </div>

        {/* ── Status Change Log Modal ── */}
        {agingModal && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setAgingModal(null)}>
            <div className="bg-slate-900 border border-white/15 rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-slate-950 rounded-t-xl">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-yellow-400" />
                  <span className="font-semibold">Status Change Log</span>
                  <span className="text-xs text-muted-foreground font-mono">{agingModal.ticketNo}</span>
                </div>
                <button onClick={() => setAgingModal(null)} className="text-white/30 hover:text-white/70 transition-colors"><X className="h-5 w-5" /></button>
              </div>

              {/* Current status + aging */}
              <div className="px-5 py-3 border-b border-white/10 bg-white/[0.02] flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Current Status</p>
                  <p className="text-sm font-semibold text-blue-300">{agingModal.status}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Days in Status</p>
                  {(() => {
                    const lastChange = statusLog.filter(l => l.ticketNo === agingModal.ticketNo).sort((a, b) => b.changedAt.localeCompare(a.changedAt))[0];
                    const days = lastChange ? daysAgo(lastChange.changedAt) : null;
                    const color = days === null ? "text-muted-foreground" : days <= 3 ? "text-green-400" : days <= 7 ? "text-yellow-400" : days <= 14 ? "text-orange-400" : "text-red-400";
                    return <p className={`text-2xl font-bold ${color}`}>{days !== null ? `${days}d` : "—"}</p>;
                  })()}
                </div>
              </div>

              {/* Log entries */}
              <div className="flex-1 overflow-y-auto divide-y divide-white/5">
                {ticketStatusLog(agingModal.ticketNo).length === 0
                  ? <div className="px-5 py-8 text-center text-muted-foreground text-sm">No status changes recorded yet.<br /><span className="text-xs opacity-60">Use the form below to log a change.</span></div>
                  : ticketStatusLog(agingModal.ticketNo).map((entry, i) => (
                    <div key={i} className="px-5 py-3 hover:bg-white/[0.02]">
                      <div className="flex items-start justify-between gap-3 mb-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/20 line-through opacity-60">{entry.fromStatus}</span>
                          <span className="text-white/30 text-xs">→</span>
                          <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/20">{entry.toStatus}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">{fmtTimestamp(entry.changedAt)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <User className="h-3 w-3" />{entry.changedBy}
                        {entry.note && <span className="ml-2 text-white/40 italic">"{entry.note}"</span>}
                      </div>
                    </div>
                  ))
                }
              </div>

              {/* Add new entry */}
              <div className="px-5 py-4 border-t border-white/10 bg-white/[0.02] rounded-b-xl">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Log Status Change</p>
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <input value={changeByInput} onChange={e => setChangeByInput(e.target.value)} placeholder="Your name…"
                      className="glass-input text-sm py-1.5 px-3 rounded-md flex-1" />
                    <input value={changeNoteInput} onChange={e => setChangeNoteInput(e.target.value)} placeholder="Note (optional)…"
                      className="glass-input text-sm py-1.5 px-3 rounded-md flex-1" />
                  </div>
                  <button
                    onClick={() => {
                      const prev = ticketStatusLog(agingModal.ticketNo)[0]?.toStatus || agingModal.status;
                      logStatusChange(agingModal.ticketNo, prev, agingModal.status);
                    }}
                    className="w-full py-1.5 rounded-md bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 transition-colors text-sm font-medium flex items-center justify-center gap-2">
                    <Clock className="h-3.5 w-3.5" />Record Status Change Now
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}