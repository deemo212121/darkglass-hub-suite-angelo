import { useState, useMemo, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { LOCATIONS } from "@/lib/locations";
import { getCompanyTickets, getTicketParts } from "@/lib/supabase/tickets";
import { useAuth } from "@/lib/auth";
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
  location: string;
}

const PART_DIST_OPTIONS = ["LG", "Encompass", "SS", "Marcone-162468", "Encompass-Birmingham/Montgomery", "PartSelect", "Johnstone", "RepairClinic", "Other"];
const WARRANTY_TYPES = [
  "Concession LP", "Concession L", "Concession P", "In warranty", "Labor only Wty",
  "Out-of-warranty", "Part only Wty", "Special Part 5 year", "Unknown", "Ext Wty",
  "Ext Labor Wty", "Ext Part Wty"
];

export function PartOrder({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const { ready: authReady } = useAuth();
  const [location, setLocation] = useState("");
  const [partDist, setPartDist] = useState("");
  const [scheduleDate, setScheduleDate] = useState("2026-05-15");
  const [warrantyType, setWarrantyType] = useState("");
  const [ordersFromTickets, setOrdersFromTickets] = useState<OrderItem[]>([]);

  // Load all "Need PO" parts across the company's tickets from Supabase.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const tickets = await getCompanyTickets();
        const orders: OrderItem[] = [];
        // Fetch parts per ticket in parallel.
        await Promise.all(
          tickets.map(async (ticket) => {
            const parts = await getTicketParts(ticket.ticketNo);
            parts
              .filter((part) =>
                part.status === "Need PO" ||
                (!part.poNo && part.status !== "PO Made" && part.status !== "Cancelled")
              )
              .forEach((part) => {
                orders.push({
                  ticketNo: ticket.ticketNo,
                  status: part.status || "Need PO",
                  partDist: part.partDist || "—",
                  partNo: part.partNo || "—",
                  description: part.partDesc || "—",
                  requestQty: parseInt(part.quantity) || 1,
                  availQty: 0,
                  eta: part.eta || "",
                  location: ticket.location || "—",
                });
              });
          })
        );
        if (!cancelled) setOrdersFromTickets(orders);
      } catch (err) {
        console.error("PartOrder: failed to load orders:", err);
        if (!cancelled) setOrdersFromTickets([]);
      }
    };
    if (authReady) load();
    return () => { cancelled = true; };
  }, [authReady]);

  // Filter orders based on selected criteria
  const filteredOrders = useMemo(() => {
    return ordersFromTickets.filter(order => {
      if (location && order.location !== location) return false;
      if (partDist && order.partDist !== partDist) return false;
      // Add more filters as needed
      return true;
    });
  }, [ordersFromTickets, location, partDist]);

  const reservePart = (ticketNo: string) => {
    alert(`Reservation initiated for Ticket: ${ticketNo}`);
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
            .info-banner { background: rgba(96, 165, 250, 0.1); border: 1px solid rgba(96, 165, 250, 0.3); border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 1.5rem; color: #93c5fd; font-size: 0.85rem; line-height: 1.5; }
          `}</style>

          {/* Info Banner */}
          <div className="info-banner">
            <strong>📋 How Part Orders Work:</strong> Part orders are created automatically when you add parts to a ticket in Service Tracking. 
            View them here to check status, track ETAs, and manage inventory allocation.
          </div>
          
          {/* Order Criteria Section */}
          <div>
            <h3 className="form-section-title">Filter Criteria</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="form-group">
                <label>Location</label>
                <select value={location} onChange={(e) => setLocation(e.target.value)} className="glass-input">
                  <option value="">All Locations</option>
                  {LOCATIONS.map(loc => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Part Dist.</label>
                <select value={partDist} onChange={(e) => setPartDist(e.target.value)} className="glass-input">
                  <option value="">All Distributors</option>
                  {PART_DIST_OPTIONS.map(dist => (
                    <option key={dist} value={dist}>{dist}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Schedule Date</label>
                <input type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} className="glass-input" />
              </div>

              <div className="form-group">
                <label>Warranty Type</label>
                <select value={warrantyType} onChange={(e) => setWarrantyType(e.target.value)} className="glass-input">
                  <option value="">All Warranty Types</option>
                  {WARRANTY_TYPES.map(wt => (
                    <option key={wt} value={wt}>{wt}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Order Count */}
          <div className="mt-6 mb-4">
            <div className="text-sm font-semibold text-blue-300">
              {filteredOrders.length} part{filteredOrders.length === 1 ? '' : 's'} need{filteredOrders.length === 1 ? 's' : ''} PO
              {location ? ` in ${location}` : ''}
            </div>
          </div>

          {/* Order Table */}
          <div className="mt-4 overflow-x-auto border border-white/10 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-blue-900/50 border-b border-blue-500/30">
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Ticket #</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Location</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Part Dist.</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Part No</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Description</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">ETA</th>
                  <th colSpan={2} className="px-4 py-3 text-center font-semibold text-blue-300">Inventory Qty</th>
                  <th colSpan={2} className="px-4 py-3 text-center font-semibold text-blue-300">Action</th>
                </tr>
                <tr className="bg-blue-900/30 border-b border-blue-500/20">
                  <th colSpan={7} className="px-4 py-2"></th>
                  <th className="px-4 py-2 text-xs font-semibold text-blue-200 border-l border-blue-500/20">Request</th>
                  <th className="px-4 py-2 text-xs font-semibold text-blue-200 border-l border-blue-500/20">Avail.</th>
                  <th className="px-4 py-2 text-xs font-semibold text-blue-200 border-l border-blue-500/20">Reserve</th>
                  <th className="px-4 py-2 text-xs font-semibold text-blue-200 border-l border-blue-500/20">View Order</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-8 text-center text-slate-400">
                      No parts with "Need PO" status found
                    </td>
                  </tr>
                ) : (
                  filteredOrders.map((order, idx) => {
                    const hasETA = order.eta && order.eta.trim() !== "";
                    return (
                      <tr key={idx} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="px-4 py-3 font-mono">
                          <a 
                            href={`/ticket/${order.ticketNo}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 underline font-semibold transition-colors"
                          >
                            {order.ticketNo}
                          </a>
                        </td>
                        <td className="px-4 py-3 text-slate-300">{order.location}</td>
                        <td className="px-4 py-3 font-semibold text-blue-400">{order.status}</td>
                        <td className="px-4 py-3 text-slate-300">{order.partDist}</td>
                        <td className="px-4 py-3 font-mono text-slate-300">{order.partNo}</td>
                        <td className="px-4 py-3 text-slate-300">{order.description}</td>
                        <td className="px-4 py-3 text-slate-300">{hasETA ? order.eta : "—"}</td>
                        <td className="px-4 py-3 text-center text-slate-400">{order.requestQty}</td>
                        <td className="px-4 py-3 text-center text-slate-400">{order.availQty}</td>
                        <td className="px-4 py-3 text-center">
                          <button onClick={() => reservePart(order.ticketNo)} className="px-2 py-1 text-xs font-semibold rounded bg-blue-500/20 text-blue-400 border border-blue-500/40 hover:bg-blue-500/30 transition-colors">
                            Reserve
                          </button>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <a
                            href={`/ticket/${order.ticketNo}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block px-2 py-1 text-xs font-semibold rounded bg-blue-500/20 text-blue-400 border border-blue-500/40 hover:bg-blue-500/30 transition-colors"
                          >
                            View Order
                          </a>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
