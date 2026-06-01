import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

type CollectionRow = {
  technician: string;
  pickedUp: string;
  collected: string;
  partNo: string;
  description: string;
  uniqueId: string;
  coreValue: number;
  ticketNo: string;
  repairStatus: string;
  qty: number;
  usedQty: number;
  restockQty: number;
  collectType: string;
  lotNo: string;
  comment: string;
  partStatusDesc: string;
  location?: string;
};

const STORAGE_KEY = "partDailyCollectionRows";
const COLLECTION_DATE = "05/15/2026";

const DEFAULT_ROWS: CollectionRow[] = [
  { technician: "Jordan Koetsier", pickedUp: "05/14/2026", collected: "05/15/2026", partNo: "140173679014", description: "SWITCH", uniqueId: "069749074130-1-140173679014", coreValue: 0, ticketNo: "069749074130", repairStatus: "CL-Claimed", qty: 1, usedQty: 1, restockQty: 0, collectType: "Used", lotNo: "", comment: "If used during repair requires return: No Shipping Provider: FedEx", partStatusDesc: "Used" },
  { technician: "Jordan Koetsier", pickedUp: "05/14/2026", collected: "05/15/2026", partNo: "5304522966", description: "RANGE INFINITE SWITCH", uniqueId: "069749074130-2-5304522966", coreValue: 0, ticketNo: "069749074130", repairStatus: "CL-Claimed", qty: 1, usedQty: 1, restockQty: 0, collectType: "Used", lotNo: "", comment: "If used during repair requires return: No Shipping Provider: FedEx", partStatusDesc: "Used" },
  { technician: "Jordan Koetsier", pickedUp: "05/14/2026", collected: "05/15/2026", partNo: "5304533520", description: "DUAL ELEMENT", uniqueId: "069749074130-3-5304533520", coreValue: 0, ticketNo: "069749074130", repairStatus: "CL-Claimed", qty: 1, usedQty: 1, restockQty: 0, collectType: "Used", lotNo: "", comment: "If used during repair requires return: No Shipping Provider: FedEx", partStatusDesc: "Used" },
  { technician: "Jordan Koetsier", pickedUp: "05/14/2026", collected: "05/15/2026", partNo: "5304537946", description: "CROWN,BURNER,XTRA LARGE", uniqueId: "73766675-1", coreValue: 0, ticketNo: "1007010900-10", repairStatus: "CL-Claimed", qty: 1, usedQty: 1, restockQty: 0, collectType: "Used", lotNo: "", comment: "", partStatusDesc: "Claimed" },
  { technician: "Jordan Koetsier", pickedUp: "05/14/2026", collected: "05/15/2026", partNo: "5304537947", description: "CROWN,BURNER,LARGE", uniqueId: "73766675-3", coreValue: 0, ticketNo: "1007010900-10", repairStatus: "CL-Claimed", qty: 1, usedQty: 1, restockQty: 0, collectType: "Used", lotNo: "", comment: "", partStatusDesc: "Claimed" },
  { technician: "Jordan Koetsier", pickedUp: "05/14/2026", collected: "05/15/2026", partNo: "GRLP5", description: "LP CONVERSION KIT", uniqueId: "73766675-5", coreValue: 0, ticketNo: "1007010900-10", repairStatus: "CL-Claimed", qty: 1, usedQty: 1, restockQty: 0, collectType: "Used", lotNo: "", comment: "", partStatusDesc: "Claimed" },
];

const LOCATION_OPTIONS = ["Asheville", "Birmingham", "Atlanta"];

function formatMoney(value: number) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function rowBlob(row: CollectionRow) {
  return [
    row.technician,
    row.pickedUp,
    row.collected,
    row.partNo,
    row.description,
    row.uniqueId,
    row.ticketNo,
    row.repairStatus,
    row.collectType,
    row.comment,
    row.partStatusDesc,
  ].join(" ").toLowerCase();
}

function loadRows() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_ROWS.map((row) => ({ ...row }));
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_ROWS.map((row) => ({ ...row }));
  } catch {
    return DEFAULT_ROWS.map((row) => ({ ...row }));
  }
}

export function PartCollectionPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [rows, setRows] = useState<CollectionRow[]>([]);
  const [location, setLocation] = useState("");
  const [technician, setTechnician] = useState("");
  const [pickupDateFrom, setPickupDateFrom] = useState("2026-05-14");
  const [pickupDateTo, setPickupDateTo] = useState("2026-05-14");
  const [showNotCollected, setShowNotCollected] = useState(true);
  const [showCollected, setShowCollected] = useState(true);
  const [ticketSearch, setTicketSearch] = useState("");
  const [collectType, setCollectType] = useState("");
  const [resultSearch, setResultSearch] = useState("");
  const [scanUniqueId, setScanUniqueId] = useState("");

  useEffect(() => {
    setRows(loadRows());
  }, []);

  const hasRealLocationData = useMemo(() => rows.some((row) => String(row.location || "").trim().length > 0), [rows]);

  const filteredRows = useMemo(() => {
    if (!location) return [];

    return rows.filter((row) => {
      if (hasRealLocationData) {
        const rowLocation = String(row.location || "").trim();
        if (rowLocation !== location) return false;
      }

      const isCollected = String(row.collected || "").trim() !== "";
      if (!showCollected && isCollected) return false;
      if (!showNotCollected && !isCollected) return false;
      if (technician && !String(row.technician || "").toLowerCase().includes(technician.toLowerCase())) return false;
      if (ticketSearch && !String(row.ticketNo || "").toLowerCase().includes(ticketSearch.toLowerCase())) return false;
      if (collectType && String(row.collectType || "").toLowerCase() !== collectType.toLowerCase()) return false;
      if (pickupDateFrom && String(row.pickedUp || "") < pickupDateFrom.replace(/-/g, "/")) return false;
      if (pickupDateTo && String(row.pickedUp || "") > pickupDateTo.replace(/-/g, "/")) return false;
      if (resultSearch && !rowBlob(row).includes(resultSearch.toLowerCase())) return false;
      return true;
    });
  }, [collectType, hasRealLocationData, location, pickupDateFrom, pickupDateTo, resultSearch, rows, showCollected, showNotCollected, technician, ticketSearch]);

  const ticketCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!location) return counts;

    rows.forEach((row) => {
      if (hasRealLocationData) {
        const rowLocation = String(row.location || "").trim();
        if (rowLocation !== location) return;
      }
      const ticketNo = String(row.ticketNo || "").trim();
      if (!ticketNo) return;
      counts[ticketNo] = (counts[ticketNo] || 0) + 1;
    });

    return counts;
  }, [hasRealLocationData, location, rows]);

  const persistRows = (nextRows: CollectionRow[]) => {
    setRows(nextRows);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextRows));
  };

  const handleSave = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  };

  const handleCollect = () => {
    const uniqueId = scanUniqueId.trim();
    if (!uniqueId) return;

    const nextRows = rows.map((row) => {
      if (String(row.uniqueId || "").toLowerCase() !== uniqueId.toLowerCase()) return row;
      return {
        ...row,
        collected: COLLECTION_DATE,
        collectType: row.collectType || "Used",
      };
    });

    persistRows(nextRows);
    setScanUniqueId("");
  };

  const handleRevert = (uniqueId: string) => {
    const nextRows = rows.map((row) => {
      if (row.uniqueId !== uniqueId) return row;
      return {
        ...row,
        collected: "",
        collectType: "",
      };
    });

    persistRows(nextRows);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <style>{`
          .collection-panel {
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 10px;
            padding: 1rem;
            color: #fff;
            backdrop-filter: blur(10px);
            width: 100%;
            min-width: 0;
          }
          .collection-panel + .collection-panel { margin-top: 0.9rem; }
          .collection-panel.is-hidden { display: none; }
          .controls-grid { display: grid; grid-template-columns: repeat(3, minmax(180px, 1fr)); gap: 0.75rem; margin-bottom: 0.75rem; }
          .field { display: flex; flex-direction: column; gap: 0.25rem; }
          .field.narrow { max-width: 180px; }
          .field label { font-size: 0.78rem; font-weight: 700; color: #e5e7eb; }
          .field input, .field select { width: 100%; padding: 0.55rem 0.65rem; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(17, 24, 39, 0.95); color: #fff; font-size: 0.85rem; }
          .date-range { display: grid; grid-template-columns: 1fr auto 1fr; gap: 0.35rem; align-items: center; }
          .date-range span { text-align: center; font-weight: 700; }
          .collection-status-row, .collection-search-row { display: flex; align-items: center; justify-content: space-between; gap: 0.8rem; flex-wrap: wrap; margin-bottom: 0.7rem; }
          .status-left, .status-right, .search-left, .search-right, .search-left-top { display: inline-flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
          .status-left label, .status-right label { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.84rem; font-weight: 600; color: #dbeafe; white-space: nowrap; }
          .action-row { display: inline-flex; align-items: center; gap: 0.6rem; }
          .action-row button, .action-btn { padding: 0.45rem 0.75rem; border-radius: 6px; border: 1px solid rgba(147, 197, 253, 0.7); background: rgba(37, 99, 235, 0.88); color: #fff; font-weight: 700; cursor: pointer; }
          .collect-btn { padding: 0.5rem 0.9rem; border-radius: 8px; border: 1px solid rgba(147, 197, 253, 0.8); background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: #fff; font-weight: 800; letter-spacing: 0.02em; cursor: pointer; box-shadow: 0 8px 18px rgba(37, 99, 235, 0.28); }
          .search-input { padding: 0.45rem 0.6rem; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(17, 24, 39, 0.95); color: #fff; font-size: 0.84rem; min-width: 220px; }
          .scan-input { min-width: 260px; }
          .record-count { font-size: 0.9rem; font-weight: 700; color: #bfdbfe; }
          .ticket-link { color: #111827; font-weight: 700; text-decoration: none; }
          .ticket-link:hover { color: #111827; text-decoration: underline; }
          .ticket-count { color: #0b3b8f; background: #bfdbfe; border: 1px solid #60a5fa; border-radius: 999px; padding: 0.05rem 0.4rem; font-weight: 700; font-size: 0.78rem; margin-left: 0.35rem; cursor: help; }
          .table-wrap { overflow-x: auto; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 8px; background: #fff; max-width: 100%; min-width: 0; }
          table.collection-table { width: 100%; min-width: 2300px; border-collapse: collapse; font-size: 0.75rem; color: #111827; }
          .collection-table th, .collection-table td { border: 1px solid #d1d5db; padding: 0.42rem; vertical-align: top; white-space: nowrap; }
          .collection-table th { background: #1f2937; color: #f9fafb; text-align: left; position: sticky; top: 0; z-index: 1; }
          .collection-table tbody tr:nth-child(even) { background: #f9fafb; }
          .money, .num { text-align: right; }
          .comment-cell { max-width: 270px; white-space: normal; line-height: 1.25; }
          .floating-table-scrollbar { position: fixed; left: 0; bottom: 0; z-index: 1100; overflow-x: auto; overflow-y: hidden; border: 1px solid rgba(148, 163, 184, 0.5); border-radius: 8px; background: rgba(255, 255, 255, 0.92); box-shadow: 0 10px 24px rgba(15, 23, 42, 0.18); display: none; max-width: 100vw; }
          .floating-table-scrollbar.is-visible { display: block; }
          .floating-table-scrollbar-inner { height: 1px; }
          @media (max-width: 1000px) { .controls-grid { grid-template-columns: 1fr; } }
        `}</style>

        <div className="mb-8">
          <div className="flex items-center gap-3 mb-6">
            <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
              <ChevronLeft className="h-4 w-4" /> {mod.label}
            </Link>
          </div>
          <h1 className="text-4xl font-display font-bold tracking-tight mb-2">{sub.title}</h1>
          <p className="text-lg text-muted-foreground">{sub.description}</p>
        </div>

        <div className="collection-panel">
          <div className="controls-grid">
            <div className="field">
              <label htmlFor="locationFilter">Location*</label>
              <select id="locationFilter" value={location} onChange={(event) => setLocation(event.target.value)}>
                <option value="">Select Location</option>
                {LOCATION_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="technicianFilter">Technician</label>
              <input id="technicianFilter" type="text" placeholder="Technician" value={technician} onChange={(event) => setTechnician(event.target.value)} />
            </div>
            <div className="field">
              <label>Pickup Date</label>
              <div className="date-range">
                <input type="date" title="Pickup date from" aria-label="Pickup date from" value={pickupDateFrom} onChange={(event) => setPickupDateFrom(event.target.value)} />
                <span>~</span>
                <input type="date" title="Pickup date to" aria-label="Pickup date to" value={pickupDateTo} onChange={(event) => setPickupDateTo(event.target.value)} />
              </div>
            </div>
          </div>

          <div className="collection-status-row">
            <div className="status-left">
              <label><input id="showNotCollected" type="checkbox" checked={showNotCollected} onChange={(event) => setShowNotCollected(event.target.checked)} /> Not-Collected</label>
              <label><input id="showCollected" type="checkbox" checked={showCollected} onChange={(event) => setShowCollected(event.target.checked)} /> Collected</label>
            </div>
            <div className="status-right">
              <div className="action-row">
                <button type="button" id="saveBtn" onClick={handleSave}>Save</button>
                <button type="button" id="printBtn" onClick={() => window.print()}>Print</button>
              </div>
            </div>
          </div>
        </div>

        <div id="collectionResultsPanel" className={`collection-panel ${location ? "" : "is-hidden"}`}>
          <div className="collection-search-row">
            <div className="search-left">
              <div className="search-left-top">
                <div className="field narrow">
                  <label htmlFor="ticketSearch">Ticket No</label>
                  <input id="ticketSearch" type="text" placeholder="Ticket No" value={ticketSearch} onChange={(event) => setTicketSearch(event.target.value)} />
                </div>
                <div className="field narrow">
                  <label htmlFor="collectTypeFilter">Collect Type</label>
                  <select id="collectTypeFilter" value={collectType} onChange={(event) => setCollectType(event.target.value)}>
                    <option value="">All</option>
                    <option value="Used">Used</option>
                    <option value="Restock">Restock</option>
                  </select>
                </div>
              </div>
              <div className="record-count"><span id="recordCount">{filteredRows.length}</span> records found</div>
            </div>
            <div className="search-right">
              <input id="resultSearch" className="search-input" type="text" placeholder="search in result" value={resultSearch} onChange={(event) => setResultSearch(event.target.value)} />
              <input id="scanUniqueId" className="search-input scan-input" type="text" placeholder="Scan Parts Here (Unique ID)" value={scanUniqueId} onChange={(event) => setScanUniqueId(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); handleCollect(); } }} />
              <button type="button" id="collectBtn" className="collect-btn" onClick={handleCollect}>Collect</button>
            </div>
          </div>

          <div id="collectionTableWrap" className="table-wrap">
            <table className="collection-table">
              <thead>
                <tr>
                  <th>Technician</th>
                  <th>Picked up</th>
                  <th>Collected</th>
                  <th>PartNo</th>
                  <th>Description</th>
                  <th>Unique ID</th>
                  <th>Core Value</th>
                  <th>Ticket #</th>
                  <th>Repair Status</th>
                  <th>Qty</th>
                  <th>Used Qty</th>
                  <th>Restock Qty</th>
                  <th>Collect Type</th>
                  <th>Lot #</th>
                  <th>Comment</th>
                  <th>Actions</th>
                  <th>PartStatusDesc</th>
                </tr>
              </thead>
              <tbody id="collectionBody">
                {filteredRows.map((row) => {
                  const ticketNo = String(row.ticketNo || "");
                  const ticketCount = ticketCounts[ticketNo] || 0;
                  return (
                    <tr key={row.uniqueId}>
                      <td>{row.technician || ""}</td>
                      <td>{row.pickedUp || ""}</td>
                      <td>{row.collected || ""}</td>
                      <td>{row.partNo || ""}</td>
                      <td>{row.description || ""}</td>
                      <td>{row.uniqueId || ""}</td>
                      <td className="money">{formatMoney(row.coreValue)}</td>
                      <td>
                        {ticketNo ? (
                          <>
                            <Link className="ticket-link" to="/ticket/$ticketNo" params={{ ticketNo }} target="_blank" rel="noreferrer">
                              {ticketNo}
                            </Link>
                            <span className="ticket-count" title="Number of repair transactions for this ticket" aria-label="Number of repair transactions for this ticket">
                              ({ticketCount})
                            </span>
                          </>
                        ) : null}
                      </td>
                      <td>{row.repairStatus || ""}</td>
                      <td className="num">{row.qty || 0}</td>
                      <td className="num">{row.usedQty || 0}</td>
                      <td className="num">{row.restockQty || 0}</td>
                      <td>{row.collectType || ""}</td>
                      <td>{row.lotNo || ""}</td>
                      <td className="comment-cell">{row.comment || ""}</td>
                      <td>
                        <button type="button" className="action-btn" onClick={() => handleRevert(row.uniqueId)}>
                          Revert
                        </button>
                      </td>
                      <td>{row.partStatusDesc || ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div id="collectionFloatingScrollbar" className="floating-table-scrollbar" aria-hidden="true">
            <div id="collectionFloatingScrollbarInner" className="floating-table-scrollbar-inner" />
          </div>
        </div>
      </main>
    </div>
  );
}