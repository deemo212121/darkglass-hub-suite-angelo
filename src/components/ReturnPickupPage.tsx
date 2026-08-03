import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { LOCATIONS } from "@/lib/locations";
import {
  getReturnPickupRows,
  updateReturnPickupRow,
  findPartByUniqueId,
  type ReturnPickupRow,
} from "@/lib/supabase/returnPickup";
import { marconeLookupPart, type MarconePartInfo } from "@/lib/marconeApi";

function formatUsd(value: number | undefined): string {
  return typeof value === "number" ? `$${value.toFixed(2)}` : "—";
}

export function ReturnPickupPage() {
  const [allRows, setAllRows] = useState<ReturnPickupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [branch, setBranch] = useState("");
  const [raNoFilter, setRaNoFilter] = useState("");
  const [invoiceNoFilter, setInvoiceNoFilter] = useState("");
  const [uniqueIdFilter, setUniqueIdFilter] = useState("");
  const [resultSearch, setResultSearch] = useState("");
  const [newUniqueId, setNewUniqueId] = useState("");
  const [addPartError, setAddPartError] = useState<string | null>(null);
  const [addingPart, setAddingPart] = useState(false);

  const [selectedPart, setSelectedPart] = useState<ReturnPickupRow | null>(null);
  const [modalTab, setModalTab] = useState<"encompass" | "marcone">("marcone");
  const [marconeInfo, setMarconeInfo] = useState<MarconePartInfo | null>(null);
  const [marconeLoading, setMarconeLoading] = useState(false);
  const [marconeNotFound, setMarconeNotFound] = useState(false);
  const [marconeError, setMarconeError] = useState<string | null>(null);

  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const floatingBarRef = useRef<HTMLDivElement | null>(null);
  const floatingInnerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    getReturnPickupRows()
      .then(setAllRows)
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  const hasBranch = branch.length > 0;

  const filteredRows = useMemo(() => {
    if (!hasBranch) return [] as ReturnPickupRow[];
    return allRows.filter((row) => {
      if (row.location !== branch) return false;
      if (raNoFilter && !row.raNo.toLowerCase().includes(raNoFilter.toLowerCase())) return false;
      if (invoiceNoFilter && !row.invoiceNo.toLowerCase().includes(invoiceNoFilter.toLowerCase())) return false;
      if (uniqueIdFilter && !row.id.toLowerCase().includes(uniqueIdFilter.toLowerCase())) return false;
      if (resultSearch) {
        const blob = [row.raNo, row.raDate, row.partNo, row.id, row.invoiceNo, row.quantity, row.scanOutQty, row.status, row.ticketNo].join(" ").toLowerCase();
        if (!blob.includes(resultSearch.toLowerCase())) return false;
      }
      return true;
    });
  }, [allRows, branch, hasBranch, invoiceNoFilter, raNoFilter, resultSearch, uniqueIdFilter]);

  useEffect(() => {
    if (!selectedPart) {
      setMarconeInfo(null);
      setMarconeError(null);
      setMarconeNotFound(false);
      return;
    }
    let cancelled = false;
    setMarconeLoading(true);
    setMarconeError(null);
    setMarconeNotFound(false);
    marconeLookupPart({ partNumber: selectedPart.partNo })
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
  }, [selectedPart]);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedPart(null);
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, []);

  useEffect(() => {
    const tableWrap = tableWrapRef.current;
    const floatingBar = floatingBarRef.current;
    const floatingInner = floatingInnerRef.current;
    if (!tableWrap || !floatingBar || !floatingInner) return;

    const sync = () => {
      const table = tableWrap.querySelector("table.data-table") as HTMLTableElement | null;
      if (!table) return;
      floatingInner.style.width = `${table.scrollWidth}px`;
      const rect = tableWrap.getBoundingClientRect();
      floatingBar.style.width = `${Math.max(0, Math.floor(rect.width))}px`;
      floatingBar.style.left = `${Math.max(0, Math.floor(rect.left))}px`;
      floatingBar.style.bottom = "0px";
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
  }, [filteredRows.length]);

  const setLocalField = (id: string, field: "raNo" | "raDate" | "scanOutQty", value: string | number) => {
    setAllRows((current) => current.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  };
  const persistField = async (id: string, field: "raNo" | "raDate" | "scanOutQty", value: string | number) => {
    try {
      await updateReturnPickupRow(id, { [field]: value } as any);
      setSaveError(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save change");
    }
  };

  const addPart = async () => {
    const uniqueId = newUniqueId.trim();
    if (!uniqueId) return;
    setAddingPart(true);
    setAddPartError(null);
    try {
      const found = await findPartByUniqueId(uniqueId);
      if (!found) {
        setAddPartError(`No part found matching Unique ID "${uniqueId}".`);
        return;
      }
      setAllRows((current) => (current.some((row) => row.id === found.id) ? current : [found, ...current]));
      if (found.location) setBranch(found.location);
      setNewUniqueId("");
    } catch (err) {
      setAddPartError(err instanceof Error ? err.message : "Failed to look up part");
    } finally {
      setAddingPart(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <style>{`
          .panel {
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 10px;
            padding: 1.25rem;
            margin-bottom: 1.5rem;
            backdrop-filter: blur(10px);
            color: #fff;
          }
          .controls-grid { display: grid; grid-template-columns: repeat(4, minmax(160px, 1fr)); grid-auto-rows: max-content; gap: 0.75rem; margin-bottom: 1rem; }
          .field { display: flex; flex-direction: column; gap: 0.3rem; }
          .field label { font-size: 0.78rem; font-weight: 700; color: #e5e7eb; }
          .field input, .field select { height: 34px; padding: 0.35rem 0.5rem; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; font-size: 0.8rem; color: #fff; background: rgba(17, 24, 39, 0.95); }
          .action-buttons { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 1rem; align-items: flex-end; }
          .btn { height: 34px; padding: 0 1rem; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.25); background: rgba(17, 24, 39, 0.95); color: #fff; font-size: 0.86rem; font-weight: 600; cursor: pointer; transition: all 0.2s ease; display: inline-flex; align-items: center; justify-content: center; }
          .btn:hover { border-color: rgba(96, 165, 250, 0.7); background: rgba(30, 64, 175, 0.35); }
          .btn:disabled { opacity: 0.5; cursor: not-allowed; }
          .btn.primary { background: #1d4ed8; border-color: #1d4ed8; }
          .btn.primary:hover { background: #1e40af; }
          .meta-row { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; margin-bottom: 0.7rem; flex-wrap: wrap; }
          .result-info { font-size: 0.8rem; font-weight: 700; color: #bfdbfe; }
          .search-input { width: 260px; height: 34px; padding: 0.35rem 0.5rem; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; font-size: 0.8rem; color: #fff; background: rgba(17, 24, 39, 0.95); }
          .table-wrap { overflow: auto; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 10px; background: #fff; }
          table.data-table { width: 100%; border-collapse: collapse; background: #fff; color: #1f2937; }
          .data-table th, .data-table td { border: 1px solid #d1d5db; padding: 0.5rem 0.6rem; font-size: 0.82rem; white-space: nowrap; text-align: center; }
          .data-table th { background: #f3f4f6; font-weight: 700; }
          .data-table td:first-child, .data-table td:nth-child(3), .data-table td:nth-child(4) { text-align: left; }
          .cell-input { width: 100%; min-width: 90px; padding: 0.25rem 0.4rem; border: 1px solid #d1d5db; border-radius: 4px; font-size: 0.78rem; color: #111827; }
          .floating-table-scrollbar { position: fixed; left: 0; bottom: 0; z-index: 1100; overflow-x: auto; overflow-y: hidden; border: 1px solid rgba(148, 163, 184, 0.5); border-radius: 8px; background: rgba(255, 255, 255, 0.92); box-shadow: 0 10px 24px rgba(15, 23, 42, 0.18); display: none; max-width: 100vw; }
          .floating-table-scrollbar.is-visible { display: block; }
          .floating-table-scrollbar-inner { height: 1px; }
          .back-btn { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.5rem 0.85rem; border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.16); background: rgba(255, 255, 255, 0.08); color: #fff; font-weight: 700; transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease; }
          .back-btn:hover { transform: translateY(-1px); background: rgba(255, 255, 255, 0.14); border-color: rgba(255, 255, 255, 0.28); box-shadow: 0 8px 18px rgba(15, 23, 42, 0.16); }
          .po-footer { margin-top: 1rem; color: #cbd5e1; font-size: 0.9rem; }
          .po-footer p { margin: 0; }
          .clickable-part-no { color: #1d4ed8; text-decoration: underline; cursor: pointer; font-weight: 600; }
          .clickable-part-no:hover { color: #1e40af; }
          .ticket-link { color: #1d4ed8; text-decoration: none; font-weight: 600; }
          .ticket-link:hover { text-decoration: underline; }
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
          @media (max-width: 1200px) { .controls-grid { grid-template-columns: repeat(2, minmax(160px, 1fr)); } }
          @media (max-width: 768px) { .controls-grid { grid-template-columns: 1fr; } .search-input { width: 100%; } .action-buttons { flex-direction: column; } .btn { width: 100%; } }
        `}</style>

        <div className="mb-4">
          <div className="flex items-center gap-3 mb-4">
            <Link to="/m/$module" params={{ module: "parts" }} className="back-btn">
              <ChevronLeft className="h-4 w-4" /> Parts
            </Link>
          </div>
          <h1 className="text-2xl font-semibold leading-tight text-white">Return &amp; Pickup</h1>
        </div>

        {saveError && <p className="text-sm text-red-400 mb-3">{saveError}</p>}

        <div className="panel">
          <div className="controls-grid">
            <div className="field">
              <label htmlFor="branchFilter">Branch*</label>
              <select id="branchFilter" value={branch} onChange={(event) => setBranch(event.target.value)}>
                <option value="">Select Branch</option>
                {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="raNoFilter">RA No</label>
              <input id="raNoFilter" type="text" placeholder="RA No" value={raNoFilter} onChange={(event) => setRaNoFilter(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="invoiceNoFilter">Invoice No</label>
              <input id="invoiceNoFilter" type="text" placeholder="Invoice No" value={invoiceNoFilter} onChange={(event) => setInvoiceNoFilter(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="uniqueIdFilter">Unique ID</label>
              <input id="uniqueIdFilter" type="text" placeholder="Unique ID" value={uniqueIdFilter} onChange={(event) => setUniqueIdFilter(event.target.value)} />
            </div>
          </div>

          <div className="action-buttons">
            <div className="field" style={{ minWidth: "260px", marginBottom: 0 }}>
              <label htmlFor="newUniqueId">Unique ID</label>
              <input id="newUniqueId" type="text" placeholder="Enter unique ID" value={newUniqueId} onChange={(event) => setNewUniqueId(event.target.value)} />
            </div>
            <button type="button" className="btn primary" onClick={addPart} disabled={addingPart || !newUniqueId.trim()}>
              {addingPart ? "Looking up…" : "Add Part"}
            </button>
          </div>
          {addPartError && <p className="text-sm text-red-400 mb-2">{addPartError}</p>}

          {loadError ? (
            <p className="text-sm text-red-400 px-2 py-6">Failed to load returns: {loadError}</p>
          ) : loading ? (
            <p className="text-sm text-slate-300 px-2 py-6">Loading…</p>
          ) : !hasBranch ? (
            <p className="text-sm text-slate-300 px-2 py-6">Select a branch to load Return &amp; Pickup data.</p>
          ) : (
          <>
          <div className="meta-row">
            <div className="result-info">{filteredRows.length} records found</div>
            <input className="search-input" type="text" placeholder="search in result" value={resultSearch} onChange={(event) => setResultSearch(event.target.value)} />
          </div>

          <div className="table-wrap" ref={tableWrapRef}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>RA #</th>
                  <th>Return Date</th>
                  <th>Part No</th>
                  <th>Unique ID</th>
                  <th>Invoice No</th>
                  <th>Ticket #</th>
                  <th>Return Qty</th>
                  <th>Scan Out Qty</th>
                  <th>Return Reason</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-6 text-slate-500">No records found</td></tr>
                ) : filteredRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <input className="cell-input" type="text" value={row.raNo} onChange={(e) => setLocalField(row.id, "raNo", e.target.value)} onBlur={(e) => persistField(row.id, "raNo", e.target.value)} />
                    </td>
                    <td>
                      <input className="cell-input" type="date" value={row.raDate} onChange={(e) => setLocalField(row.id, "raDate", e.target.value)} onBlur={(e) => persistField(row.id, "raDate", e.target.value)} />
                    </td>
                    <td><span className="clickable-part-no" onClick={() => { setSelectedPart(row); setModalTab("marcone"); }}>{row.partNo}</span></td>
                    <td title={row.id}>{row.id.slice(0, 8)}</td>
                    <td>{row.invoiceNo || "—"}</td>
                    <td>
                      {row.ticketNo ? (
                        <Link className="ticket-link" to="/ticket/$ticketNo" params={{ ticketNo: row.ticketNo }} target="_blank" rel="noreferrer">{row.ticketNo}</Link>
                      ) : "—"}
                    </td>
                    <td>{row.quantity}</td>
                    <td>
                      <input className="cell-input" type="number" min={0} value={row.scanOutQty} onChange={(e) => setLocalField(row.id, "scanOutQty", Number(e.target.value))} onBlur={(e) => persistField(row.id, "scanOutQty", Number(e.target.value))} />
                    </td>
                    <td>{row.status || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="floating-table-scrollbar" aria-hidden="true" ref={floatingBarRef}>
            <div className="floating-table-scrollbar-inner" ref={floatingInnerRef} />
          </div>
          </>
          )}
        </div>

        {hasBranch && !loading && !loadError && (
          <div className="po-footer">Showing {filteredRows.length} return records filtered for pickup processing.</div>
        )}
      </main>

      <div className={`part-info-modal-overlay ${selectedPart ? "is-open" : ""}`} onClick={(event) => { if (event.target === event.currentTarget) setSelectedPart(null); }}>
        <div className="part-info-modal" role="dialog" aria-modal="true" aria-labelledby="partInfoTitle">
          <div className="part-info-header">
            <div id="partInfoTitle" className="part-info-title">Part Info. of ({selectedPart?.partNo ?? ""})</div>
            <button type="button" className="part-info-close" onClick={() => setSelectedPart(null)}>Close</button>
          </div>

          <div className="part-info-tabs">
            <button type="button" className={`part-info-tab-btn ${modalTab === "encompass" ? "active" : ""}`} onClick={() => setModalTab("encompass")}>Encompass</button>
            <button type="button" className={`part-info-tab-btn ${modalTab === "marcone" ? "active" : ""}`} onClick={() => setModalTab("marcone")}>Marcone</button>
          </div>

          <div className="part-info-body">
            <div className={`part-info-pane ${modalTab === "encompass" ? "active" : ""}`}>
              <div className="part-info-empty">No Encompass part-lookup API is wired into this app yet.</div>
            </div>

            <div className={`part-info-pane ${modalTab === "marcone" ? "active" : ""}`}>
              {marconeLoading ? (
                <div className="part-info-empty">Looking up {selectedPart?.partNo} on Marcone…</div>
              ) : marconeError ? (
                <div className="part-info-empty">Marcone lookup failed: {marconeError}</div>
              ) : marconeNotFound ? (
                <div className="part-info-empty">Marcone has no record of part {selectedPart?.partNo}.</div>
              ) : marconeInfo ? (
                <>
                  <table className="part-info-matrix">
                    <thead>
                      <tr><th>Field</th><th>Value</th><th>Field</th><th>Value</th></tr>
                    </thead>
                    <tbody>
                      <tr><td>Make</td><td>{marconeInfo.make || "—"}</td><td>Part #</td><td>{marconeInfo.partNumber || selectedPart?.partNo}</td></tr>
                      <tr><td>Net Price</td><td>{formatUsd(marconeInfo.netPrice)}</td><td>List Price</td><td>{formatUsd(marconeInfo.listPrice)}</td></tr>
                      <tr><td>Core Value</td><td>{formatUsd(marconeInfo.coreValue)}</td><td>Discontinued?</td><td>{marconeInfo.isDiscontinued ? "Yes" : "No"}</td></tr>
                      <tr><td>Description</td><td colSpan={3}>{marconeInfo.description || "—"}</td></tr>
                    </tbody>
                  </table>
                  <div className="part-info-section-title">Availability (Marcone)</div>
                  <div className="part-info-section-subtitle">
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
