import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

type HistoryRow = {
  eventDate: string;
  partNo: string;
  uniqueId: string;
  event: string;
  qty: number;
  qtyChange: string | number;
  currentQty: number;
  ticketNo: string;
  scheduledPast: string;
  repairStatusPast: string;
  scheduledCurrent: string;
  repairStatusCurrent: string;
  branch: string;
  reference: string;
  comment: string;
};

type InventoryRow = {
  index: number;
  location: string;
  partNo: string;
  uniqueId: string;
  lotNo: string;
  invoiceDate: string;
  qty: number;
  status: string;
  aging: number;
  ticketNo: string;
  technician: string;
  retail: string;
  core: string;
  poNo: string;
};

const SAMPLE_HISTORY_ROWS: HistoryRow[] = [
  { eventDate: "03/18/2026", partNo: "140137975102", uniqueId: "BM_TS 140137975102-140137975102", event: "Invoice Created", qty: 1, qtyChange: "", currentQty: 0, ticketNo: "", scheduledPast: "", repairStatusPast: "", scheduledCurrent: "", repairStatusCurrent: "", branch: "", reference: "", comment: "" },
  { eventDate: "03/18/2026", partNo: "140137975102", uniqueId: "BM_TS 140137975102-140137975102", event: "G/R (In stock)", qty: 1, qtyChange: 1, currentQty: 1, ticketNo: "", scheduledPast: "", repairStatusPast: "", scheduledCurrent: "", repairStatusCurrent: "", branch: "", reference: "", comment: "" },
  { eventDate: "03/18/2026", partNo: "140137975102", uniqueId: "BM_TS 140137975102-140137975102", event: "Pickup", qty: 1, qtyChange: "", currentQty: 1, ticketNo: "1006431806-10", scheduledPast: "03/18/2026", repairStatusPast: "OP-Ready for Service", scheduledCurrent: "03/18/2026", repairStatusCurrent: "CL-Cancelled", branch: "", reference: "1006431806-10 (Zonate Grant)", comment: "Electrolux 5304525994" },
  { eventDate: "03/18/2026", partNo: "140137975102", uniqueId: "BM_TS 140137975102-140137975102", event: "Reserved", qty: 1, qtyChange: "", currentQty: 1, ticketNo: "1006431806-10", scheduledPast: "03/18/2026", repairStatusPast: "OP-Ready for Service", scheduledCurrent: "03/18/2026", repairStatusCurrent: "CL-Cancelled", branch: "", reference: "1006431806-10 (Zonate Grant)", comment: "" },
  { eventDate: "03/19/2026", partNo: "140137975102", uniqueId: "BM_TS 140137975102-140137975102", event: "Released", qty: 1, qtyChange: "", currentQty: 1, ticketNo: "1006431806-10", scheduledPast: "03/18/2026", repairStatusPast: "CL-Ready to Complete", scheduledCurrent: "03/18/2026", repairStatusCurrent: "CL-Cancelled", branch: "", reference: "1006431806-10 (Zonate Grant)", comment: "" },
  { eventDate: "03/19/2026", partNo: "140137975102", uniqueId: "BM_TS 140137975102-140137975102", event: "Released", qty: 1, qtyChange: "", currentQty: 1, ticketNo: "1006431806-10", scheduledPast: "03/18/2026", repairStatusPast: "OP-Ready for Service", scheduledCurrent: "03/18/2026", repairStatusCurrent: "CL-Cancelled", branch: "", reference: "1006431806-10 (Zonate Grant)", comment: "" },
  { eventDate: "03/20/2026", partNo: "140137975102", uniqueId: "BM_TS 140137975102-140137975102", event: "Collect: Used", qty: 0, qtyChange: "", currentQty: 1, ticketNo: "1006431806-10", scheduledPast: "03/18/2026", repairStatusPast: "CL-Cancelled", scheduledCurrent: "03/18/2026", repairStatusCurrent: "CL-Cancelled", branch: "", reference: "1006431806-10 (Zonate Grant)", comment: "Electrolux 5304525994" },
];

const SAMPLE_INVENTORY_ROWS: InventoryRow[] = [
  { index: 1, location: "Birmingham", partNo: "140137975102", uniqueId: "BM_TS 140137975102-140137975102", lotNo: "", invoiceDate: "03/18/2026", qty: 1, status: "Stocked", aging: 58, ticketNo: "", technician: "", retail: "$0.00", core: "", poNo: "" },
];

function escapeHtml(value: string | number) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string));
}

export function PartHistoryPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [uniqueIdFilter, setUniqueIdFilter] = useState("BM_TS 140137975102-140137975102");
  const [historySearch, setHistorySearch] = useState("");
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>(SAMPLE_HISTORY_ROWS);
  const [inventoryRows, setInventoryRows] = useState<InventoryRow[]>(SAMPLE_INVENTORY_ROWS);
  const [historyDataSource, setHistoryDataSource] = useState<"seed" | "database">("seed");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const uniqueId = params.get("uniqueId");
    if (uniqueId) setUniqueIdFilter(uniqueId);
  }, []);

  useEffect(() => {
    const refresh = () => {
      const hasDatabase = Boolean((window as any).AdminHubData);
      const uniqueId = uniqueIdFilter.trim();
      if (!hasDatabase) {
        setHistoryRows(SAMPLE_HISTORY_ROWS);
        setInventoryRows(SAMPLE_INVENTORY_ROWS.filter((row) => !uniqueId || row.uniqueId.toLowerCase().includes(uniqueId.toLowerCase())));
        setHistoryDataSource("seed");
        return;
      }

      const adminHubData = (window as any).AdminHubData;
      Promise.resolve()
        .then(() => adminHubData.fetchPartHistory({ companyCode: localStorage.getItem("userCompanyId"), uniqueId: uniqueId || undefined }))
        .then((history: HistoryRow[]) => {
          if (Array.isArray(history) && history.length) {
            setHistoryRows(history);
            setHistoryDataSource("database");
          } else {
            setHistoryRows(SAMPLE_HISTORY_ROWS);
            setHistoryDataSource("seed");
          }
        })
        .then(() => adminHubData.fetchPartInventoryInfo({ companyCode: localStorage.getItem("userCompanyId"), uniqueId: uniqueId || undefined }))
        .then((inventory: InventoryRow[]) => {
          setInventoryRows(Array.isArray(inventory) && inventory.length ? inventory : SAMPLE_INVENTORY_ROWS);
        })
        .catch(() => {
          setHistoryRows(SAMPLE_HISTORY_ROWS);
          setInventoryRows(SAMPLE_INVENTORY_ROWS);
          setHistoryDataSource("seed");
        });
    };

    refresh();
    const interval = window.setInterval(refresh, 5000);
    return () => window.clearInterval(interval);
  }, [uniqueIdFilter]);

  const filteredHistoryRows = useMemo(() => {
    const uniqueId = uniqueIdFilter.trim().toLowerCase();
    const search = historySearch.trim().toLowerCase();
    return historyRows.filter((row) => {
      if (uniqueId && !String(row.uniqueId || "").toLowerCase().includes(uniqueId)) return false;
      if (search) {
        const blob = [row.eventDate, row.partNo, row.uniqueId, row.event, row.qty, row.qtyChange, row.currentQty, row.ticketNo, row.scheduledPast, row.repairStatusPast, row.scheduledCurrent, row.repairStatusCurrent, row.branch, row.reference, row.comment].join(" ").toLowerCase();
        if (!blob.includes(search)) return false;
      }
      return true;
    });
  }, [historyRows, historySearch, uniqueIdFilter]);

  const filteredInventoryRows = useMemo(() => {
    const uniqueId = uniqueIdFilter.trim().toLowerCase();
    return inventoryRows.filter((row) => !uniqueId || String(row.uniqueId || "").toLowerCase().includes(uniqueId));
  }, [inventoryRows, uniqueIdFilter]);

  const dataSourceSuffix = historyDataSource === "database" ? "" : " (sample)";

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <style>{`
          .history-panel {
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 10px;
            padding: 1rem;
            color: #fff;
            backdrop-filter: blur(10px);
            width: 100%;
          }
          .page-title { font-size: 1.1rem; font-weight: 700; margin: 0 0 0.8rem; color: #dbeafe; }
          .top-controls { display: grid; grid-template-columns: minmax(280px, 420px); gap: 0.6rem; align-items: end; margin-bottom: 0.7rem; }
          .field { display: flex; flex-direction: column; gap: 0.25rem; }
          .field label { font-size: 0.78rem; font-weight: 600; color: #e5e7eb; letter-spacing: 0.02em; }
          .field input { width: 100%; padding: 0.55rem 0.65rem; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(17, 24, 39, 0.95); color: #fff; font-size: 0.85rem; font-family: inherit; }
          .field input:focus { outline: none; border-color: #60a5fa; box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.16); }
          .section-title { margin: 0.6rem 0 0.4rem; font-size: 0.95rem; font-weight: 700; color: #bfdbfe; }
          .meta-row { display: flex; align-items: center; justify-content: space-between; gap: 0.8rem; flex-wrap: wrap; margin-bottom: 0.6rem; }
          .record-count { font-size: 0.88rem; font-weight: 700; color: #bfdbfe; }
          .search-inline { display: flex; align-items: center; gap: 0.45rem; }
          .search-inline input { padding: 0.45rem 0.6rem; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(17, 24, 39, 0.95); color: #fff; font-size: 0.84rem; min-width: 210px; }
          .table-wrap { overflow-x: auto; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 8px; background: #fff; }
          table.history-table { width: 100%; border-collapse: collapse; font-size: 0.74rem; color: #111827; min-width: 1900px; }
          .history-table th, .history-table td { border: 1px solid #d1d5db; padding: 0.4rem; text-align: left; vertical-align: top; white-space: nowrap; }
          .history-table thead th { background: #1f2937; color: #f9fafb; position: sticky; top: 0; z-index: 1; }
          .history-table thead tr.subhead th { background: #374151; font-size: 0.7rem; font-weight: 600; }
          .history-table tbody tr:nth-child(even) { background: #f9fafb; }
          .inventory-history-table { min-width: 1300px; }
          .qty, .qty-change, .current-qty, .aging { text-align: right; }
          .footer-actions { display: flex; gap: 0.6rem; margin-top: 0.8rem; }
          .footer-actions button { padding: 0.5rem 0.9rem; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.22); background: rgba(255, 255, 255, 0.1); color: #fff; cursor: pointer; font-weight: 600; }
          .history-summary-panel { margin-top: 0.8rem; font-size: 0.8rem; color: #94a3b8; line-height: 1.6; }
          .history-summary-panel p { margin: 0 0 0.3rem; }
          .history-summary-panel p:last-child { margin-bottom: 0; }
          .footer-copy { margin-top: 1rem; opacity: 0.7; }
          .floating-table-scrollbar { position: fixed; left: 0; bottom: 14px; z-index: 1100; overflow-x: auto; overflow-y: hidden; border: 1px solid rgba(148, 163, 184, 0.5); border-radius: 8px; background: rgba(255, 255, 255, 0.92); box-shadow: 0 10px 24px rgba(15, 23, 42, 0.18); display: none; max-width: calc(100vw - 28px); }
          .floating-table-scrollbar.is-visible { display: block; }
          .floating-table-scrollbar-inner { height: 1px; }
          .no-records { text-align: center; color: #6b7280; padding: 1rem; }
          @media (max-width: 900px) { .top-controls { grid-template-columns: 1fr; } .search-inline input { min-width: 170px; } }
        `}</style>

        <div className="mb-8">
          <div className="flex items-center gap-3 mb-6">
            <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
              <ChevronLeft className="h-4 w-4" /> Parts
            </Link>
          </div>
          <h1 className="text-4xl font-display font-bold tracking-tight mb-2">{sub.title}</h1>
          <p className="text-lg text-muted-foreground">{sub.description}</p>
        </div>

        <div className="history-panel">
          <h3 className="page-title">Part In/Out History</h3>

          <div className="top-controls">
            <div className="field">
              <label htmlFor="uniqueIdFilter">Unique ID</label>
              <input id="uniqueIdFilter" type="text" value={uniqueIdFilter} onChange={(event) => setUniqueIdFilter(event.target.value)} />
            </div>
          </div>

          <h4 className="section-title">I/O History</h4>
          <div className="meta-row">
            <div className="record-count"><span id="historyRecordCount">{filteredHistoryRows.length}</span>{dataSourceSuffix} records found</div>
            <div className="search-inline">
              <span>search in result</span>
              <input id="historySearch" type="text" placeholder="Search in result" value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} />
            </div>
          </div>

          <div id="historyTableWrap" className="table-wrap table-scroll-wrapper">
            <table className="history-table">
              <thead>
                <tr>
                  <th rowSpan={2}>Event Date</th>
                  <th rowSpan={2}>Part #</th>
                  <th rowSpan={2}>Unique ID</th>
                  <th rowSpan={2}>Event</th>
                  <th rowSpan={2}>Qty</th>
                  <th rowSpan={2}>Qty Change</th>
                  <th rowSpan={2}>Current Qty</th>
                  <th colSpan={6}>Related Ticket Information</th>
                  <th rowSpan={2}>Reference</th>
                  <th rowSpan={2}>Comment</th>
                </tr>
                <tr className="subhead">
                  <th>Ticket #</th>
                  <th>Scheduled (Past)</th>
                  <th>Repair Status (Past)</th>
                  <th>Scheduled (Current)</th>
                  <th>Repair Status (Current)</th>
                  <th>Branch</th>
                </tr>
              </thead>
              <tbody id="historyBody">
                {filteredHistoryRows.length === 0 ? (
                  <tr><td colSpan={15} className="no-records">No records found.</td></tr>
                ) : (
                  filteredHistoryRows.map((row, index) => (
                    <tr key={`${row.uniqueId}-${row.eventDate}-${index}`}>
                      <td>{row.eventDate}</td>
                      <td>{row.partNo}</td>
                      <td>{row.uniqueId}</td>
                      <td>{row.event}</td>
                      <td className="qty">{row.qty}</td>
                      <td className="qty-change">{row.qtyChange}</td>
                      <td className="current-qty">{row.currentQty}</td>
                      <td>{row.ticketNo}</td>
                      <td>{row.scheduledPast}</td>
                      <td>{row.repairStatusPast}</td>
                      <td>{row.scheduledCurrent}</td>
                      <td>{row.repairStatusCurrent}</td>
                      <td>{row.branch}</td>
                      <td>{row.reference}</td>
                      <td>{row.comment}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <h4 className="section-title">Part Inventory Information</h4>
          <div className="table-wrap table-scroll-wrapper">
            <table className="history-table inventory-history-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Location</th>
                  <th>Part #</th>
                  <th>Unique ID</th>
                  <th>Lot #</th>
                  <th>Invoice Date</th>
                  <th>Qty</th>
                  <th>Status</th>
                  <th>Aging</th>
                  <th>TicketNo</th>
                  <th>Technician</th>
                  <th>Retail</th>
                  <th>Core</th>
                  <th>Po #</th>
                </tr>
              </thead>
              <tbody id="inventoryInfoBody">
                {filteredInventoryRows.length === 0 ? (
                  <tr><td colSpan={14} className="no-records">No records found.</td></tr>
                ) : (
                  filteredInventoryRows.map((row) => (
                    <tr key={`${row.index}-${row.uniqueId}`}>
                      <td>{row.index}</td>
                      <td>{row.location}</td>
                      <td>{row.partNo}</td>
                      <td>{row.uniqueId}</td>
                      <td>{row.lotNo}</td>
                      <td>{row.invoiceDate}</td>
                      <td className="qty">{row.qty}</td>
                      <td>{row.status}</td>
                      <td className="aging">{row.aging}</td>
                      <td>{row.ticketNo}</td>
                      <td>{row.technician}</td>
                      <td>{row.retail}</td>
                      <td>{row.core}</td>
                      <td>{row.poNo}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="footer-actions">
            <Link to="/m/$module" params={{ module: mod.slug }} className="btn btn-primary">Return</Link>
          </div>

          <div id="historyFloatingScrollbar" className="floating-table-scrollbar" aria-hidden="true">
            <div id="historyFloatingScrollbarInner" className="floating-table-scrollbar-inner" />
          </div>
        </div>

        <div className="history-panel history-summary-panel">
          <p><strong>*Note 1:</strong> Part history shows the events for a part as it moves through inventory and ticket actions.</p>
          <p><strong>*Note 2:</strong> The inventory information below reflects the current inventory record for the selected unique ID.</p>
        </div>
      </main>

      <footer id="contact">
        <p>For any questions or support, contact us at <a href="mailto:support@adminhubsolutions.com">support@adminhubsolutions.com</a></p>
        <p className="footer-copy">© 2026 Admin Hub Solutions. All rights reserved.</p>
      </footer>
    </div>
  );
}