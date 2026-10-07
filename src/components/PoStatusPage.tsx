import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, Filter } from "lucide-react";
import { attachRecordedUsage, getPoStatusRows, type PoStatusRow } from "@/lib/supabase/poStatus";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { getPartsInventoryRows } from "@/lib/supabase/partsInventory";

const statusColors: Record<string, string> = {
  "Completed": "bg-emerald-100 text-emerald-800",
  "In progress": "bg-blue-100 text-blue-800",
  "Pending": "bg-amber-100 text-amber-800",
  "Not recorded": "bg-slate-200 text-slate-700",
};

function accountHue(accountNo: string): number {
  const knownAccounts: Record<string, number> = { "272467": 142, "273746": 210, "4930403": 275 };
  if (knownAccounts[accountNo] !== undefined) return knownAccounts[accountNo];
  // Keep colors stable for additional accounts across filtering and reloads.
  return Array.from(accountNo).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 360, 0);
}

export function PoStatusPage() {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: "parts" } }));
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const floatingBarRef = useRef<HTMLDivElement | null>(null);
  const floatingInnerRef = useRef<HTMLDivElement | null>(null);
  
  const [orders, setOrders] = useState<PoStatusRow[]>([]);
  const [noInvoiceOnly, setNoInvoiceOnly] = useState(false);
  const [account, setAccount] = useState("");
  const [usageWarning, setUsageWarning] = useState("");
  const [loadError, setLoadError] = useState("");
  const [location, setLocation] = useState("");
  const [startDate, setStartDate] = useState("2026-05-07");
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [poNo, setPoNo] = useState("");
  const [ticketNo, setTicketNo] = useState("");
  const [itemStatus, setItemStatus] = useState("");
  const [statusFilterOpen, setStatusFilterOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        // Apply filters (Supabase-backed, company-scoped)
        setLoadError("");
        const filtered = await getPoStatusRows();

        const filteredArray = Array.isArray(filtered) ? filtered : [];

        // PO Status shows orders that have actually been MADE (not still "Need PO").
        const madeOnly = filteredArray.filter(
          (order) => order.status !== "Need PO" && order.status !== "Cancelled"
        );

        if (!cancelled) setOrders(madeOnly);
        try {
          const parts = await getPartsInventoryRows();
          if (!cancelled) setOrders(attachRecordedUsage(madeOnly, parts));
        } catch (error) {
          console.error("Unable to load recorded part usage:", error);
          if (!cancelled) setUsageWarning("Ticket usage could not be loaded. P/O records are still shown.");
        }
      } catch (error) {
        console.error('Error loading part orders:', error);
        if (!cancelled) { setOrders([]); setLoadError("Unable to load P/O records. Check that migration 0351 has been applied, then reload."); }
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const locations = [...new Set(orders.map(o => o.location).filter((v): v is string => !!v))].sort();
  const accounts = [...new Set(orders.filter(o => !location || o.location === location).map(o => o.accountNo).filter((v): v is string => !!v))].sort();
  const statuses = [...new Set([...Object.keys(statusColors), ...orders.map(order => order.progressStatus || "Not recorded")])];
  const filteredOrders = orders.filter(order => {
    if (itemStatus && (order.progressStatus || "Not recorded") !== itemStatus) return false;
    if (location && order.location !== location) return false;
    if (account && order.accountNo !== account) return false;
    if (startDate && order.poDate < startDate) return false;
    if (endDate && order.poDate > endDate) return false;
    if (noInvoiceOnly && order.invoiced !== false) return false;
    if (poNo.trim() && !order.poNo.toLowerCase().includes(poNo.trim().toLowerCase())) return false;
    if (ticketNo.trim() && !order.ticketNo.toLowerCase().includes(ticketNo.trim().toLowerCase())) return false;
    return true;
  });

  useEffect(() => {
    // Setup scroll synchronization for table
    const tableWrap = tableWrapRef.current;
    const floatingBar = floatingBarRef.current;
    const floatingInner = floatingInnerRef.current;
    if (!tableWrap || !floatingBar || !floatingInner) return;

    const sync = () => {
      const table = tableWrap.querySelector("table.status-table") as HTMLTableElement | null;
      if (!table) return;
      floatingInner.style.width = `${table.scrollWidth}px`;
      const rect = tableWrap.getBoundingClientRect();
      floatingBar.style.width = `${Math.max(0, Math.floor(rect.width))}px`;
      floatingBar.style.left = `${Math.max(0, Math.floor(rect.left))}px`;
    };

    const updateVisibility = () => {
      const hasHorizontalOverflow = tableWrap.scrollWidth > tableWrap.clientWidth + 1;
      const rect = tableWrap.getBoundingClientRect();
      const shouldShow = hasHorizontalOverflow && rect.bottom > window.innerHeight;
      floatingBar.classList.toggle("is-visible", shouldShow);
      if (shouldShow) {
        sync();
        floatingBar.scrollLeft = tableWrap.scrollLeft;
      }
    };

    let syncingFromFloating = false;
    let syncingFromTable = false;

    const onFloatingScroll = () => {
      if (syncingFromTable) {
        syncingFromTable = false;
        return;
      }
      syncingFromFloating = true;
      tableWrap.scrollLeft = floatingBar.scrollLeft;
    };

    const onTableScroll = () => {
      if (syncingFromFloating) {
        syncingFromFloating = false;
        return;
      }
      syncingFromTable = true;
      floatingBar.scrollLeft = tableWrap.scrollLeft;
      updateVisibility();
    };

    tableWrap.addEventListener("scroll", onTableScroll);
    floatingBar.addEventListener("scroll", onFloatingScroll);
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", updateVisibility, { passive: true });

    requestAnimationFrame(() => {
      sync();
      updateVisibility();
    });

    return () => {
      tableWrap.removeEventListener("scroll", onTableScroll);
      floatingBar.removeEventListener("scroll", onFloatingScroll);
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", updateVisibility);
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 w-full min-w-0 px-3 lg:px-4 py-4">
        <style>{`
          .status-panel {
            padding: 0.75rem;
          }
          .status-controls {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 0.5rem;
            margin-bottom: 0.75rem;
          }
          .control-group { display: grid; grid-template-columns: 80px minmax(0, 1fr); align-items: center; gap: 0.35rem; }
          @media (max-width: 1000px) { .status-controls { grid-template-columns: 1fr; } }
          .control-group input { min-width: 0; }
          .control-group label { font-size: 0.8rem; font-weight: 600; letter-spacing: 0.02em; color: #e5e7eb; }
          .control-group input, .control-group select {
            width: 100%;
            padding: 0.35rem 0.5rem;
            border-radius: 6px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            background: rgba(17, 24, 39, 0.95);
            color: #fff;
            font-size: 0.75rem;
          }
          .control-group select option { background: #111827; color: #fff; }
          .control-group input:focus, .control-group select:focus {
            outline: none;
            border-color: #60a5fa;
            box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.18);
          }
          .status-meta { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem; color: #cbd5e1; font-size: 0.75rem; }
          .table-wrap { overflow-x: auto; }
          table.status-table { width: 100%; border-collapse: collapse; background: #111827; color: #e5e7eb; border-radius: 8px; overflow: hidden; }
          .status-table th, .status-table td {
            border: 1px solid rgba(255, 255, 255, 0.12);
            padding: 0.2rem 0.35rem;
            font-size: 11px;
            line-height: 1.3;
            white-space: nowrap;
            text-align: center;
          }
          .status-table td:nth-child(6) { min-width: 130px; max-width: 210px; text-align: left; overflow: hidden; text-overflow: ellipsis; }
          .status-table .status-pill, .status-table .account-badge { font-size: 10px; line-height: 1.3; padding: 2px 5px; }
          .status-table .usage-link { display: inline-block; border-radius: 4px; background: #2e1065; color: #ddd6fe; padding: 2px 5px; font-size: 10px; }
          .status-table .usage-link:hover { text-decoration: underline; }
          .status-table th { background: #1f2937; font-weight: 700; color: #f1f5f9; }
          .status-table tbody tr:hover { background: rgba(255, 255, 255, 0.04); }
          .status-table td:first-child, .status-table td:nth-child(2) { text-align: left; }
          .ticket-link { color: #60a5fa; text-decoration: none; font-weight: 600; cursor: pointer; pointer-events: auto; display: inline-block; }
          .ticket-link:hover { text-decoration: underline; color: #93c5fd; }
          .status-pill {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 0.1rem 0.35rem;
            border-radius: 999px;
            font-size: 0.75rem;
            font-weight: 700;
          }
          .account-badge {
            display: inline-flex;
            align-items: center;
            padding: 0.15rem 0.5rem;
            border-radius: 6px;
            font-weight: 600;
            background: hsl(var(--account-hue) 45% 20%);
            color: hsl(var(--account-hue) 85% 85%);
            border: 1px solid hsl(var(--account-hue) 50% 40%);
          }
          .report-footer { margin-top: 1rem; color: #cbd5e1; font-size: 0.75rem; }
          .floating-table-scrollbar {
            position: fixed;
            left: 0;
            bottom: 14px;
            z-index: 1100;
            overflow-x: auto;
            overflow-y: hidden;
            border: 1px solid rgba(148, 163, 184, 0.5);
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.92);
            box-shadow: 0 10px 24px rgba(15, 23, 42, 0.18);
            display: none;
            max-width: calc(100vw - 28px);
          }
          .floating-table-scrollbar.is-visible { display: block; }
          .floating-table-scrollbar-inner { height: 1px; }
          .back-btn {
            display: inline-flex;
            align-items: center;
            gap: 0.4rem;
            padding: 0.5rem 0.85rem;
            border-radius: 10px;
            border: 1px solid rgba(255, 255, 255, 0.16);
            background: rgba(255, 255, 255, 0.08);
            color: #fff;
            font-weight: 700;
            transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
          }
          .back-btn:hover {
            transform: translateY(-1px);
            background: rgba(255, 255, 255, 0.14);
            border-color: rgba(255, 255, 255, 0.28);
            box-shadow: 0 8px 18px rgba(15, 23, 42, 0.16);
          }
          .po-status-footer { padding-top: 1rem; }
          .po-status-footer p { margin: 0; }
          .po-status-footer-note { margin-top: 1rem; opacity: 0.7; }
        `}</style>

        <div className="mb-3 flex items-center gap-3">
          <div className="flex items-center gap-3">
            <button type="button" onClick={goBack} className="back-btn">
              <ChevronLeft className="h-4 w-4" /> Parts
            </button>
          </div>
          <h1 className="text-xl font-display font-bold tracking-tight">P/O Status</h1>
        </div>

        <div className="glass-panel status-panel">
          <div className="status-controls">
            <div className="control-group">
              <label htmlFor="location">Location</label>
              <select id="location" value={location} onChange={e => { setLocation(e.target.value); setAccount(""); }}>
                <option value="">All Locations</option>
                {locations.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </div>
            <div className="control-group">
              <label htmlFor="poDate">P/O Date</label>
              <div className="flex items-center gap-1 min-w-0">
                <input id="poDate" aria-label="P/O start date" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                <span>to</span>
                <input aria-label="P/O end date" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={noInvoiceOnly} onChange={e => setNoInvoiceOnly(e.target.checked)} />
              Delivery not ready parts only (No-Invoice)
            </label>
            <div className="control-group">
              <label htmlFor="poNo">P/O No</label>
              <input id="poNo" value={poNo} onChange={e => setPoNo(e.target.value)} />
            </div>
            <div className="control-group">
              <label htmlFor="account">Account</label>
              <select id="account" value={account} onChange={e => setAccount(e.target.value)} disabled={!accounts.length} title={!accounts.length ? "No account numbers are recorded for this location" : undefined}>
                <option value="">{accounts.length ? "All Accounts" : "No account recorded"}</option>
                {accounts.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </div>
            <div className="control-group">
              <label htmlFor="ticketNo">Ticket No</label>
              <input id="ticketNo" value={ticketNo} onChange={e => setTicketNo(e.target.value)} />
            </div>
          </div>
          {loadError && <p role="alert" className="text-sm text-red-300 mb-2">{loadError}</p>}
          {usageWarning && <p role="status" className="text-sm text-amber-300 mb-2">{usageWarning}</p>}
          <div className="status-meta">
            <div>📋 Showing {filteredOrders.length} part order(s) from Service Tracking and imports</div>
            <div>📅 Date range: {startDate} to {endDate}</div>
          </div>

          <div className="table-wrap" ref={tableWrapRef}>
            <table className="status-table">
              <thead>
                <tr>
                  <th>Ticket No</th>
                  <th>P/O #</th>
                  <th>P/O Date</th>
                  <th>Order #</th>
                  <th>Part No</th>
                  <th>Description</th>
                  <th>Account</th>
                  <th>Unit Price</th>
                  <th>Qty</th>
                  <th>
                    <Popover open={statusFilterOpen} onOpenChange={setStatusFilterOpen}>
                      <PopoverTrigger asChild>
                        <button type="button" className={`inline-flex items-center gap-1 rounded px-1 py-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 ${itemStatus ? "text-blue-300" : ""}`} aria-label={`Filter item status: ${itemStatus || "All statuses"}`} title={itemStatus || "Filter item status"}>
                          Item Status <Filter className="h-3.5 w-3.5" fill={itemStatus ? "currentColor" : "none"} />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-52 p-3">
                        <label htmlFor="item-status-filter" className="mb-2 block text-sm font-medium">Item Status</label>
                        <select id="item-status-filter" className="w-full rounded border border-slate-600 bg-slate-900 p-2 text-sm text-white" value={itemStatus} onChange={event => { setItemStatus(event.target.value); setStatusFilterOpen(false); }}>
                          <option value="">All statuses</option>
                          {statuses.map(status => <option key={status} value={status}>{status}</option>)}
                        </select>
                        {itemStatus && <button type="button" className="mt-2 text-xs text-blue-300 hover:underline" onClick={() => { setItemStatus(""); setStatusFilterOpen(false); }}>Clear status filter</button>}
                      </PopoverContent>
                    </Popover>
                  </th>
                  <th>Part Usage</th>
                  <th>ETA</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.length > 0 ? (
                  filteredOrders.map((order) => (
                    <tr key={order.rowKey}>
                      <td>
                        {order.standalone ? <span title="Imported reference only; not linked to a ticket">{order.ticketNo}</span> : <a
                          href={`/ticket/${order.ticketNo}`}
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="ticket-link"
                          title={`Open ${order.ticketNo} in new tab`}
                        >
                          {order.ticketNo}
                        </a>}
                      </td>
                      <td>{order.poNo}</td>
                      <td>{order.poDate}</td>
                      <td>{order.orderNo || "—"}</td>
                      <td>{order.partNo}</td>
                      <td title={order.partDesc}>{order.partDesc}</td>
                      <td>{order.accountNo ? (
                        <span className="account-badge" style={{ "--account-hue": accountHue(order.accountNo) } as CSSProperties}>
                          {order.accountNo}
                        </span>
                      ) : "Not recorded"}</td>
                      <td>${order.partPrice.toFixed(2)}</td>
                      <td>{order.quantity}</td>
                      <td><span className={`status-pill ${statusColors[order.progressStatus || "Not recorded"] || "bg-slate-200 text-slate-700"}`}>{order.progressStatus || "Not recorded"}</span></td>
                      <td>
                        {order.usedOnTickets?.length ? order.usedOnTickets.map(ticket => (
                          <div key={ticket} className="leading-tight">
                            <a href={`/ticket/${encodeURIComponent(ticket)}`} target="_blank" rel="noopener noreferrer" className="usage-link" title={`Recorded Used part matching this P/O and part number. Ordered for ${order.ticketNo}.${ticket !== order.ticketNo.trim() ? " Used on a different ticket." : ""}`}>
                              Used: {ticket}{ticket !== order.ticketNo.trim() ? " *" : ""}
                            </a>
                          </div>
                        )) : <span className="text-slate-400" title={usageWarning ? "Ticket usage could not be loaded" : "No matching recorded usage found"}>{usageWarning ? "Unavailable" : "Unrecorded"}</span>}
                      </td>
                      <td>{order.eta || "—"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={12} style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>
                      No part orders found. Create part orders from Service Tracking and imports to see them here.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div id="poStatusFloatingScrollbar" className="floating-table-scrollbar" aria-hidden="true" ref={floatingBarRef}>
            <div id="poStatusFloatingScrollbarInner" className="floating-table-scrollbar-inner" ref={floatingInnerRef} />
          </div>

          <p className="text-xs text-slate-400 mt-2">Imports with unknown invoice status appear when the No-Invoice filter is unchecked. Blank source item statuses remain unrecorded.</p>
          <div className="report-footer">Showing {filteredOrders.length} part order(s) auto-populated from Service Tracking and imports.</div>
        </div>
      </main>
    </div>
  );
}