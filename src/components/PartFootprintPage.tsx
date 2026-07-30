import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { LOCATIONS } from "@/lib/locations";
import { getPartFootprint, type PartFootprintRow } from "@/lib/supabase/partFootprint";
import { marconeLookupPart, type MarconePartInfo } from "@/lib/marconeApi";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

function formatMoney(value: number) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function formatUsd(value: number | undefined): string {
  return typeof value === "number" ? `$${value.toFixed(2)}` : "—";
}

export function PartFootprintPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [rows, setRows] = useState<PartFootprintRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [location, setLocation] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [partNoFilter, setPartNoFilter] = useState("");
  const [uniqueIdFilter, setUniqueIdFilter] = useState("");
  const [invoiceFilter, setInvoiceFilter] = useState("");
  const [resultSearch, setResultSearch] = useState("");
  const [modalPartNo, setModalPartNo] = useState("");
  const [modalTab, setModalTab] = useState<"encompass" | "marcone">("marcone");
  const [marconeInfo, setMarconeInfo] = useState<MarconePartInfo | null>(null);
  const [marconeLoading, setMarconeLoading] = useState(false);
  const [marconeNotFound, setMarconeNotFound] = useState(false);
  const [marconeError, setMarconeError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    getPartFootprint()
      .then(setRows)
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!modalPartNo) {
      setMarconeInfo(null);
      setMarconeError(null);
      setMarconeNotFound(false);
      return;
    }
    let cancelled = false;
    setMarconeLoading(true);
    setMarconeError(null);
    setMarconeNotFound(false);
    marconeLookupPart({ partNumber: modalPartNo })
      .then((result) => {
        if (cancelled) return;
        if (result.notFound) {
          setMarconeNotFound(true);
          setMarconeInfo(null);
          return;
        }
        if (!result.success) {
          setMarconeError(result.error || "Marcone lookup failed");
          return;
        }
        setMarconeInfo(result.data || null);
      })
      .catch((err) => { if (!cancelled) setMarconeError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setMarconeLoading(false); });
    return () => { cancelled = true; };
  }, [modalPartNo]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (location && row.location !== location) return false;
      if (dateFrom || dateTo) {
        if (!row.receiveDate) return false;
        if (dateFrom && row.receiveDate < dateFrom) return false;
        if (dateTo && row.receiveDate > dateTo) return false;
      }
      if (partNoFilter && !row.partNo.toLowerCase().includes(partNoFilter.toLowerCase())) return false;
      if (uniqueIdFilter && !row.id.toLowerCase().includes(uniqueIdFilter.toLowerCase())) return false;
      if (invoiceFilter && ![row.ticketNo, row.id, row.partNo].join(" ").toLowerCase().includes(invoiceFilter.toLowerCase())) return false;
      if (resultSearch) {
        const blob = [row.receiveDate, row.partNo, row.id, row.description, row.status, row.ticketNo, row.brand, row.modelCode].join(" ").toLowerCase();
        if (!blob.includes(resultSearch.toLowerCase())) return false;
      }
      return true;
    });
  }, [dateFrom, dateTo, invoiceFilter, location, partNoFilter, resultSearch, rows, uniqueIdFilter]);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModalPartNo("");
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, []);

  const openPartInfoModal = (partNo: string) => {
    setModalPartNo(partNo);
    setModalTab("marcone");
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <style>{`
          .fp-panel {
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 10px;
            padding: 1rem;
            color: #fff;
            backdrop-filter: blur(10px);
            width: 100%;
            min-width: 0;
          }
          .fp-panel + .fp-panel { margin-top: 0.9rem; }
          .controls-grid { display: grid; grid-template-columns: repeat(4, minmax(160px, 1fr)); gap: 0.75rem; margin-bottom: 0.7rem; }
          .field { display: flex; flex-direction: column; gap: 0.25rem; }
          .field label { font-size: 0.78rem; font-weight: 700; color: #e5e7eb; }
          .field input, .field select { width: 100%; padding: 0.55rem 0.65rem; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(17, 24, 39, 0.95); color: #fff; font-size: 0.85rem; }
          .date-range-row { display: flex; align-items: center; gap: 0.4rem; }
          .date-range-row input { flex: 1; }
          .date-range-row span { color: #dbeafe; font-weight: 700; font-size: 0.9rem; }
          .actions-row { display: flex; align-items: flex-start; gap: 0.6rem; flex-wrap: wrap; margin-bottom: 0.7rem; justify-content: space-between; }
          .result-info { font-size: 0.84rem; font-weight: 600; color: #bfdbfe; }
          .search-input { padding: 0.45rem 0.65rem; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(17, 24, 39, 0.95); color: #fff; font-size: 0.84rem; min-width: 220px; }
          .table-wrap { overflow-x: auto; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 8px; background: #fff; max-width: 100%; min-width: 0; }
          .fp-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; white-space: nowrap; }
          .fp-table thead tr { background: #1e3a5f; color: #fff; }
          .fp-table th { padding: 0.55rem 0.7rem; text-align: left; font-weight: 700; border-bottom: 2px solid #2563eb; white-space: nowrap; }
          .fp-table td { padding: 0.45rem 0.7rem; border-bottom: 1px solid #e5e7eb; color: #111827; vertical-align: middle; }
          .fp-table tbody tr:hover { background: #eff6ff; }
          .fp-table tbody tr:last-child td { border-bottom: none; }
          .ticket-link { color: #2563eb; text-decoration: none; font-weight: 600; }
          .ticket-link:hover { text-decoration: underline; }
          .part-link-btn { border: 0; background: transparent; padding: 0; margin: 0; font: inherit; color: #2563eb; font-weight: 600; text-decoration: none; cursor: pointer; }
          .part-link-btn:hover { text-decoration: underline; }
          .part-info-modal-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); display: none; align-items: center; justify-content: center; z-index: 2200; padding: 1rem; }
          .part-info-modal-overlay.is-open { display: flex; }
          .part-info-modal { width: min(980px, calc(100vw - 2rem)); max-height: calc(100vh - 2rem); overflow: auto; background: #ffffff; border: 1px solid #d1d5db; border-radius: 12px; box-shadow: 0 28px 70px rgba(15, 23, 42, 0.3); }
          .part-info-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.9rem 1rem; border-bottom: 1px solid #e5e7eb; background: #f8fafc; }
          .part-info-title { font-size: 1rem; font-weight: 700; color: #111827; }
          .part-info-close { border: 1px solid #cbd5e1; background: #ffffff; color: #111827; border-radius: 8px; padding: 0.32rem 0.6rem; cursor: pointer; }
          .part-info-tabs { display: flex; gap: 0.45rem; padding: 0.75rem 1rem 0; }
          .part-info-tab-btn { border: 1px solid #cbd5e1; background: #ffffff; color: #1f2937; padding: 0.4rem 0.85rem; border-radius: 999px; cursor: pointer; font-size: 0.82rem; font-weight: 600; }
          .part-info-tab-btn.active { background: #0f172a; color: #ffffff; border-color: #0f172a; }
          .part-info-body { padding: 0.8rem 1rem 1rem; }
          .part-info-pane { display: none; }
          .part-info-pane.active { display: block; }
          .part-info-matrix { width: 100%; border-collapse: collapse; font-size: 0.79rem; margin-bottom: 0.85rem; }
          .part-info-matrix th, .part-info-matrix td { border: 1px solid #d1d5db; padding: 0.45rem; text-align: left; }
          .part-info-matrix thead th { background: #f3f4f6; font-weight: 700; }
          .part-info-section-title { font-size: 0.82rem; font-weight: 700; color: #111827; margin: 0.2rem 0 0.4rem; }
          .part-info-section-subtitle { font-size: 0.76rem; color: #4b5563; margin-bottom: 0.35rem; }
          .part-info-empty { padding: 0.7rem; border: 1px dashed #d1d5db; border-radius: 8px; font-size: 0.78rem; color: #6b7280; }
          #partInfoModalOverlay .part-info-modal, #partInfoModalOverlay .part-info-modal th, #partInfoModalOverlay .part-info-modal td, #partInfoModalOverlay .part-info-title, #partInfoModalOverlay .part-info-close, #partInfoModalOverlay .part-info-section-title, #partInfoModalOverlay .part-info-section-subtitle, #partInfoModalOverlay .part-info-empty, #partInfoModalOverlay .part-info-tab-btn { color: #111827 !important; }
          #partInfoModalOverlay .part-info-tab-btn.active { color: #ffffff !important; }
          .money { text-align: right; }
          @media (max-width: 1100px) { .controls-grid { grid-template-columns: repeat(2, minmax(160px, 1fr)); } }
          @media (max-width: 700px) { .controls-grid { grid-template-columns: 1fr; } }
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

        <div className="fp-panel">
          <div className="controls-grid">
            <div className="field">
              <label htmlFor="locationFilter">Location</label>
              <select id="locationFilter" value={location} onChange={(event) => setLocation(event.target.value)}>
                <option value="">All Locations</option>
                {LOCATIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Receive Date</label>
              <div className="date-range-row">
                <input id="dateFrom" type="date" title="Receive date from" aria-label="Receive date from" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
                <span>~</span>
                <input id="dateTo" type="date" title="Receive date to" aria-label="Receive date to" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="partNoFilter">Part No</label>
              <input id="partNoFilter" type="text" placeholder="Part No" value={partNoFilter} onChange={(event) => setPartNoFilter(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="uniqueIdFilter">Unique ID</label>
              <input id="uniqueIdFilter" type="text" placeholder="Unique ID" value={uniqueIdFilter} onChange={(event) => setUniqueIdFilter(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="invoiceFilter">Ticket / Unique ID / Part No search</label>
              <input id="invoiceFilter" type="text" placeholder="Search" value={invoiceFilter} onChange={(event) => setInvoiceFilter(event.target.value)} />
            </div>
          </div>
        </div>

        <div id="fpResultsPanel" className="fp-panel">
          <div className="actions-row">
            <div id="resultInfo" className="result-info">{filteredRows.length} record{filteredRows.length !== 1 ? "s" : ""} found</div>
            <input id="resultSearch" className="search-input" type="text" placeholder="search in result" value={resultSearch} onChange={(event) => setResultSearch(event.target.value)} />
          </div>

          {loadError ? (
            <p className="text-sm text-red-400 px-2 py-6">Failed to load part footprint: {loadError}</p>
          ) : loading ? (
            <p className="text-sm text-muted-foreground px-2 py-6">Loading…</p>
          ) : (
          <div id="fpTableWrap" className="table-wrap">
            <table className="fp-table">
              <thead>
                <tr>
                  <th>Receive Date</th>
                  <th>Part #</th>
                  <th>Unique ID</th>
                  <th>Description</th>
                  <th>Received</th>
                  <th>Price</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Ticket #</th>
                  <th>Aging</th>
                  <th>Brand</th>
                  <th>ModelCode</th>
                  <th>RA #</th>
                </tr>
              </thead>
              <tbody id="fpBody">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="no-records">No records found.</td>
                  </tr>
                ) : (
                  filteredRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.receiveDate || "—"}</td>
                      <td>
                        <button type="button" className="part-link-btn" onClick={() => openPartInfoModal(row.partNo)}>
                          {row.partNo}
                        </button>
                      </td>
                      <td title={row.id}>{row.id.slice(0, 8)}</td>
                      <td>{row.description || "—"}</td>
                      <td className="money">{row.received}</td>
                      <td className="money">{formatMoney(row.price)}</td>
                      <td className="money">{formatMoney(row.total)}</td>
                      <td>{row.status}</td>
                      <td>
                        {row.ticketNo ? (
                          <Link className="ticket-link" to="/ticket/$ticketNo" params={{ ticketNo: row.ticketNo }} target="_blank" rel="noreferrer">
                            {row.ticketNo}
                          </Link>
                        ) : "—"}
                      </td>
                      <td className="money">{row.aging}</td>
                      <td>{row.brand || "—"}</td>
                      <td>{row.modelCode || "—"}</td>
                      <td>{row.raNo || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          )}
        </div>

        <div className="fp-panel footnote-panel">
          <p className="footnote-copy"><strong>Note:</strong> Shows parts that have actually been received (Quantity Received &gt; 0 on Part Receive). Used/Returned/Adjusted quantity tracking isn't wired up yet — there's no real data source for it in the app today.</p>
        </div>
      </main>

      <div id="partInfoModalOverlay" className={`part-info-modal-overlay ${modalPartNo ? "is-open" : ""}`} onClick={(event) => {
        if (event.target === event.currentTarget) setModalPartNo("");
      }}>
        <div className="part-info-modal" role="dialog" aria-modal="true" aria-labelledby="partInfoTitle">
          <div className="part-info-header">
            <div id="partInfoTitle" className="part-info-title">{modalPartNo ? `Part Info. of (${modalPartNo})` : "Part Info. of ()"}</div>
            <button id="partInfoCloseBtn" type="button" className="part-info-close" onClick={() => setModalPartNo("")}>Close</button>
          </div>

          <div className="part-info-tabs">
            <button type="button" className={`part-info-tab-btn ${modalTab === "encompass" ? "active" : ""}`} data-part-tab="encompass" onClick={() => setModalTab("encompass")}>Encompass</button>
            <button type="button" className={`part-info-tab-btn ${modalTab === "marcone" ? "active" : ""}`} data-part-tab="marcone" onClick={() => setModalTab("marcone")}>Marcone</button>
          </div>

          <div className="part-info-body">
            <div className={`part-info-pane ${modalTab === "encompass" ? "active" : ""}`} data-part-pane="encompass">
              <div className="part-info-empty">No Encompass part-lookup API is wired into this app yet.</div>
            </div>

            <div className={`part-info-pane ${modalTab === "marcone" ? "active" : ""}`} data-part-pane="marcone">
              {marconeLoading ? (
                <div className="part-info-empty">Looking up {modalPartNo} on Marcone…</div>
              ) : marconeError ? (
                <div className="part-info-empty">Marcone lookup failed: {marconeError}</div>
              ) : marconeNotFound ? (
                <div className="part-info-empty">Marcone has no record of part {modalPartNo}.</div>
              ) : marconeInfo ? (
                <>
                  <table className="part-info-matrix">
                    <thead>
                      <tr><th>Field</th><th>Value</th><th>Field</th><th>Value</th></tr>
                    </thead>
                    <tbody>
                      <tr><td>Make</td><td>{marconeInfo.make || "—"}</td><td>Part #</td><td>{marconeInfo.partNumber || modalPartNo}</td></tr>
                      <tr><td>Net Price</td><td>{formatUsd(marconeInfo.netPrice)}</td><td>List Price</td><td>{formatUsd(marconeInfo.listPrice)}</td></tr>
                      <tr><td>Core Value</td><td>{formatUsd(marconeInfo.coreValue)}</td><td>Discontinued?</td><td>{marconeInfo.isDiscontinued ? "Yes" : "No"}</td></tr>
                      <tr><td>Description</td><td colSpan={3}>{marconeInfo.description || "—"}</td></tr>
                    </tbody>
                  </table>
                  <div className="part-info-section-title">Availability (Marcone)</div>
                  <div id="partInfoAvailabilityCount" className="part-info-section-subtitle">
                    {marconeInfo.totalAvailable ?? 0} available across {(marconeInfo.inventory || []).length} warehouse(s)
                  </div>
                  {(marconeInfo.inventory || []).length === 0 ? (
                    <div className="part-info-empty">No stock currently available.</div>
                  ) : (
                    <table className="part-info-matrix">
                      <thead><tr><th>Warehouse</th><th>Available Qty</th></tr></thead>
                      <tbody>
                        {marconeInfo.inventory!.map((inv, i) => (
                          <tr key={i}><td>{inv.warehouseName || "—"}</td><td>{inv.quantityAvailable ?? 0}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              ) : (
                <div className="part-info-empty">No lookup performed yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
