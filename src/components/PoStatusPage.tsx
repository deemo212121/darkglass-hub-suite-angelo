import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

type PoStatusRow = {
  ticketNo: string;
  poNo: string;
  poDate: string;
  orderNo: string;
  accountNo: string;
  partNo: string;
  description: string;
  unitPrice: string;
  orderQty: string;
  itemStatus: string;
  eta: string;
};

const PO_STATUS_ROWS: PoStatusRow[] = [
  { ticketNo: "TCK-10452", poNo: "PO-260507-001", poDate: "2026-05-07", orderNo: "", accountNo: "", partNo: "", description: "", unitPrice: "", orderQty: "", itemStatus: "No-Invoice", eta: "" },
  { ticketNo: "TCK-10491", poNo: "PO-260508-014", poDate: "2026-05-08", orderNo: "", accountNo: "", partNo: "", description: "", unitPrice: "", orderQty: "", itemStatus: "No-Invoice", eta: "" },
  { ticketNo: "TCK-10512", poNo: "PO-260510-022", poDate: "2026-05-10", orderNo: "", accountNo: "", partNo: "", description: "", unitPrice: "", orderQty: "", itemStatus: "No-Invoice", eta: "" },
  { ticketNo: "TCK-10518", poNo: "PO-260511-009", poDate: "2026-05-11", orderNo: "", accountNo: "", partNo: "", description: "", unitPrice: "", orderQty: "", itemStatus: "No-Invoice", eta: "" },
  { ticketNo: "TCK-10536", poNo: "PO-260513-017", poDate: "2026-05-13", orderNo: "", accountNo: "", partNo: "", description: "", unitPrice: "", orderQty: "", itemStatus: "No-Invoice", eta: "" },
  { ticketNo: "TCK-10549", poNo: "PO-260514-031", poDate: "2026-05-14", orderNo: "", accountNo: "", partNo: "", description: "", unitPrice: "", orderQty: "", itemStatus: "No-Invoice", eta: "" },
];

export function PoStatusPage() {
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const floatingBarRef = useRef<HTMLDivElement | null>(null);
  const floatingInnerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
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
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <style>{`
          .status-panel {
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 10px;
            padding: 1.25rem;
            color: #fff;
            backdrop-filter: blur(10px);
          }
          .status-controls {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 1rem;
            margin-bottom: 1.25rem;
          }
          .control-group { display: flex; flex-direction: column; gap: 0.35rem; }
          .control-group label { font-size: 0.8rem; font-weight: 600; letter-spacing: 0.02em; color: #e5e7eb; }
          .control-group input, .control-group select {
            width: 100%;
            padding: 0.65rem 0.75rem;
            border-radius: 6px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            background: rgba(17, 24, 39, 0.95);
            color: #fff;
            font-size: 0.9rem;
          }
          .control-group select option { background: #111827; color: #fff; }
          .control-group input:focus, .control-group select:focus {
            outline: none;
            border-color: #60a5fa;
            box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.18);
          }
          .status-meta { display: flex; flex-wrap: wrap; gap: 1rem; margin-bottom: 1rem; color: #cbd5e1; font-size: 0.88rem; }
          .table-wrap { overflow-x: auto; }
          table.status-table { width: 100%; border-collapse: collapse; background: #fff; color: #1f2937; border-radius: 8px; overflow: hidden; }
          .status-table th, .status-table td {
            border: 1px solid #d1d5db;
            padding: 0.65rem 0.75rem;
            font-size: 0.82rem;
            white-space: nowrap;
            text-align: center;
          }
          .status-table th { background: #f3f4f6; font-weight: 700; }
          .status-table td:first-child, .status-table td:nth-child(2) { text-align: left; }
          .ticket-link { color: inherit; text-decoration: none; font-weight: inherit; cursor: pointer; }
          .ticket-link:hover { text-decoration: underline; }
          .status-pill {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 0.25rem 0.6rem;
            border-radius: 999px;
            font-size: 0.75rem;
            font-weight: 700;
          }
          .status-pending { background: #fef3c7; color: #92400e; }
          .report-footer { margin-top: 1rem; color: #cbd5e1; font-size: 0.9rem; }
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

        <div className="mb-4">
          <div className="flex items-center gap-3 mb-4">
            <Link to="/m/$module" params={{ module: "parts" }} className="back-btn">
              <ChevronLeft className="h-4 w-4" /> Parts
            </Link>
          </div>
          <h1 className="text-2xl font-semibold leading-tight text-white">P/O Status</h1>
        </div>

        <div className="status-panel">
          <div className="status-controls">
            <div className="control-group">
              <label htmlFor="location">Location</label>
              <select id="location" defaultValue="">
                <option value="">All Locations</option>
                <option value="Philippines">Philippines</option>
                <option value="Atlanta">Atlanta</option>
                <option value="Dallas">Dallas</option>
                <option value="Memphis">Memphis</option>
                <option value="Tallahassee">Tallahassee</option>
              </select>
            </div>
            <div className="control-group">
              <label htmlFor="poDate">P/O Date</label>
              <input id="poDate" type="date" defaultValue="2026-05-07" />
            </div>
            <div className="control-group">
              <label htmlFor="poDateEnd">~</label>
              <input id="poDateEnd" type="date" defaultValue="2026-05-14" />
            </div>
            <div className="control-group">
              <label htmlFor="poNo">P/O No</label>
              <input id="poNo" type="text" placeholder="Enter P/O number" />
            </div>
            <div className="control-group">
              <label htmlFor="branch">Branch</label>
              <select id="branch" defaultValue="">
                <option value="">Select branch</option>
                <option value="4930403">4930403</option>
                <option value="6488757">6488757</option>
              </select>
            </div>
          </div>

          <div className="status-meta">
            <div>Summary: Active P/O and part records</div>
            <div>Default range: 05/07/2026 ~ 05/14/2026</div>
            <div>Filter: Open part orders only (No-Invoice)</div>
          </div>

          <div className="table-wrap" ref={tableWrapRef}>
            <table className="status-table">
              <thead>
                <tr>
                  <th>Ticket No</th>
                  <th>P/O #</th>
                  <th>P/O Date</th>
                  <th>Order #</th>
                  <th>Account #</th>
                  <th>Part No</th>
                  <th>Description</th>
                  <th>Unit Price</th>
                  <th>Order Qty</th>
                  <th>Item Status</th>
                  <th>ETA</th>
                </tr>
              </thead>
              <tbody>
                {PO_STATUS_ROWS.map((row) => (
                  <tr key={row.ticketNo}>
                    <td>
                      <Link className="ticket-link" to="/ticket/$ticketNo" params={{ ticketNo: row.ticketNo }} target="_blank" rel="noopener noreferrer">
                        {row.ticketNo}
                      </Link>
                    </td>
                    <td>{row.poNo}</td>
                    <td>{row.poDate}</td>
                    <td>{row.orderNo}</td>
                    <td>{row.accountNo}</td>
                    <td>{row.partNo}</td>
                    <td>{row.description}</td>
                    <td>{row.unitPrice}</td>
                    <td>{row.orderQty}</td>
                    <td><span className="status-pill status-pending">{row.itemStatus}</span></td>
                    <td>{row.eta}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div id="poStatusFloatingScrollbar" className="floating-table-scrollbar" aria-hidden="true" ref={floatingBarRef}>
            <div id="poStatusFloatingScrollbarInner" className="floating-table-scrollbar-inner" ref={floatingInnerRef} />
          </div>

          <div className="report-footer po-status-footer">Showing 6 P/O status records filtered for open part orders only.</div>
        </div>
      </main>

      <footer id="contact" className="po-status-footer">
        <p>For any questions or support, contact us at <a href="mailto:support@adminhubsolutions.com">support@adminhubsolutions.com</a></p>
        <p className="po-status-footer-note">© 2026 Admin Hub Solutions. All rights reserved.</p>
      </footer>
    </div>
  );
}