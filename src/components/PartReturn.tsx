import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Printer } from "lucide-react";
import { LOCATIONS } from "@/lib/locations";
import { getPartReturns, updatePartReturnEntryRow, getDistinctProviders, getDistinctPartDist, type PartReturnRow } from "@/lib/supabase/partReturn";
import { marconeLookupPart, type MarconePartInfo } from "@/lib/marconeApi";
import { FloatingHorizontalScrollbar } from "@/components/FloatingHorizontalScrollbar";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

const STATUS_COLOR: Record<string, React.CSSProperties> = {
  Claimed: { background: "#d1fae5", color: "#065f46" },
  "PO Made": { background: "#fef3c7", color: "#92400e" },
  "Need PO": { background: "#fee2e2", color: "#991b1b" },
  "Part Ready": { background: "#d1fae5", color: "#065f46" },
  "Tech Pickup": { background: "#e0e7ff", color: "#3730a3" },
  "RA - PNN": { background: "#f3e8ff", color: "#6b21a8" },
  Used: { background: "#e5e7eb", color: "#374151" },
  Cancelled: { background: "#e5e7eb", color: "#6b7280" },
  "Not Used & Stocked": { background: "#e5e7eb", color: "#374151" },
  "Hold for next vist": { background: "#fef3c7", color: "#92400e" },
  "CX Home": { background: "#e5e7eb", color: "#374151" },
};

function formatMoney(value: number) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function formatUsd(value: number | undefined): string {
  return typeof value === "number" ? `$${value.toFixed(2)}` : "—";
}

export function PartReturn({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [tab, setTab] = useState<"return" | "core">("return");
  const [allRows, setAllRows] = useState<PartReturnRow[]>([]);
  const [providers, setProviders] = useState<string[]>([]);
  const [partDists, setPartDists] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);

  const [provider, setProvider] = useState("");
  const [partDist, setPartDist] = useState("");
  const [location, setLocation] = useState("");
  const [agingMin, setAgingMin] = useState(0);
  const [agingMax, setAgingMax] = useState(90);
  const [uniqueIdSearch, setUniqueIdSearch] = useState("");
  const [includeReturned, setIncludeReturned] = useState(false);
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
    getPartReturns()
      .then(setAllRows)
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
    getDistinctProviders().then(setProviders).catch((err) => console.error("Failed to load providers:", err));
    getDistinctPartDist().then(setPartDists).catch((err) => console.error("Failed to load part distributors:", err));
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

  const setLocalField = (id: string, field: "raNo" | "raDate", value: string) => {
    setAllRows((current) => current.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  };
  const persistField = async (id: string, field: "raNo" | "raDate", value: string) => {
    try {
      await updatePartReturnEntryRow(id, { [field]: value });
      setSaveError(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save change");
    }
  };

  const byTab = useMemo(() => allRows.filter((r) => (tab === "core" ? r.coreValue > 0 : r.coreValue <= 0)), [allRows, tab]);

  const rows = useMemo(() => byTab.filter((r) => {
    if (provider && r.claimTo !== provider) return false;
    if (partDist && r.partDist !== partDist) return false;
    if (location && r.location !== location) return false;
    if (r.aging !== null && (r.aging < agingMin || r.aging > agingMax)) return false;
    if (!includeReturned && r.returnStatus !== "NOT RECEIVED") return false;
    if (uniqueIdSearch && !r.id.toLowerCase().includes(uniqueIdSearch.toLowerCase()) && !r.invoiceNo.toLowerCase().includes(uniqueIdSearch.toLowerCase())) return false;
    if (resultSearch) {
      const blob = [r.ticketNo, r.partNo, r.description, r.status, r.claimTo, r.raNo].join(" ").toLowerCase();
      if (!blob.includes(resultSearch.toLowerCase())) return false;
    }
    return true;
  }), [byTab, provider, partDist, location, agingMin, agingMax, includeReturned, uniqueIdSearch, resultSearch]);

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <style>{`
          .pr-panel { background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 10px; padding: 1rem; color: #fff; backdrop-filter: blur(10px); width: 100%; min-width: 0; }
          .pr-panel + .pr-panel { margin-top: 0.9rem; }
          .controls-grid { display: grid; grid-template-columns: repeat(4, minmax(160px, 1fr)); gap: 0.75rem; margin-bottom: 0.7rem; }
          .field { display: flex; flex-direction: column; gap: 0.25rem; }
          .field label { font-size: 0.78rem; font-weight: 700; color: #e5e7eb; }
          .field input, .field select { width: 100%; padding: 0.55rem 0.65rem; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(17, 24, 39, 0.95); color: #fff; font-size: 0.85rem; }
          .aging-range { display: flex; align-items: center; gap: 0.4rem; }
          .aging-range input { width: 70px; text-align: center; }
          .aging-range span { color: #dbeafe; font-weight: 700; font-size: 0.9rem; }
          .checkbox-row { display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; color: #e5e7eb; cursor: pointer; }
          .actions-row { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; margin-bottom: 0.7rem; justify-content: space-between; }
          .result-info { font-size: 0.84rem; font-weight: 600; color: #bfdbfe; }
          .search-input { padding: 0.45rem 0.65rem; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(17, 24, 39, 0.95); color: #fff; font-size: 0.84rem; min-width: 220px; }
          .tab-buttons { display: flex; gap: 0.75rem; margin-top: 1.1rem; margin-bottom: 1.1rem; }
          .tab-btn { padding: 0.75rem 1.75rem; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(255, 255, 255, 0.05); color: #fff; border-radius: 8px; cursor: pointer; font-size: 0.9rem; font-weight: 600; transition: background 0.15s ease, border-color 0.15s ease; }
          .tab-btn:hover { background: rgba(255, 255, 255, 0.1); }
          .tab-btn.active { background: #1d4ed8; border-color: #1d4ed8; }
          .tab-btn.active:hover { background: #1e40af; }
          .table-wrap { overflow-x: auto; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 8px; background: #fff; max-width: 100%; min-width: 0; }
          .pr-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; white-space: nowrap; }
          .pr-table thead tr { background: #1e3a5f; color: #fff; }
          .pr-table th { padding: 0.55rem 0.7rem; text-align: left; font-weight: 700; border-bottom: 2px solid #2563eb; white-space: nowrap; }
          .pr-table td { padding: 0.45rem 0.7rem; border-bottom: 1px solid #e5e7eb; color: #111827; vertical-align: middle; }
          .pr-table tbody tr:hover { background: #eff6ff; }
          .pr-table tbody tr:last-child td { border-bottom: none; }
          .ticket-link { color: #2563eb; text-decoration: none; font-weight: 600; }
          .ticket-link:hover { text-decoration: underline; }
          .part-link-btn { border: 0; background: transparent; padding: 0; margin: 0; font: inherit; color: #2563eb; font-weight: 600; text-decoration: none; cursor: pointer; }
          .part-link-btn:hover { text-decoration: underline; }
          .status-pill { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 999px; font-size: 0.72rem; font-weight: 700; white-space: nowrap; }
          .cell-input { width: 100%; min-width: 90px; padding: 0.25rem 0.4rem; border: 1px solid #d1d5db; border-radius: 4px; font-size: 0.78rem; color: #111827; }
          .money { text-align: right; }
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
          @media (max-width: 1100px) { .controls-grid { grid-template-columns: repeat(2, minmax(160px, 1fr)); } }
          @media (max-width: 700px) { .controls-grid { grid-template-columns: 1fr; } }
          @media print { .no-print { display: none !important; } }
        `}</style>

        <div className="flex items-center gap-3 mb-6 no-print">
          <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4" /></Link>
          <h1 className="text-2xl font-bold">{sub.title}</h1>
        </div>
        {saveError && <p className="text-sm text-red-400 mb-3 no-print">{saveError}</p>}

        <div className="pr-panel no-print">
          <div className="controls-grid">
            <div className="field">
              <label htmlFor="providerFilter">Part Provider</label>
              <select id="providerFilter" value={provider} onChange={(e) => setProvider(e.target.value)}>
                <option value="">All Providers</option>
                {providers.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="partDistFilter">Part Dist.</label>
              <select id="partDistFilter" value={partDist} onChange={(e) => setPartDist(e.target.value)}>
                <option value="">All Distributors</option>
                {partDists.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="locationFilter">Location</label>
              <select id="locationFilter" value={location} onChange={(e) => setLocation(e.target.value)}>
                <option value="">All Locations</option>
                {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Aging</label>
              <div className="aging-range">
                <input type="number" value={agingMin} onChange={(e) => setAgingMin(+e.target.value)} />
                <span>~</span>
                <input type="number" value={agingMax} onChange={(e) => setAgingMax(+e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="uniqueIdSearch">Unique ID / Invoice No</label>
              <input id="uniqueIdSearch" type="text" value={uniqueIdSearch} onChange={(e) => setUniqueIdSearch(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-4 mt-1">
            <label className="checkbox-row">
              <input type="checkbox" checked={includeReturned} onChange={(e) => setIncludeReturned(e.target.checked)} className="accent-blue-500" />
              Include Returned
            </label>
            <button type="button" className="btn flex items-center gap-2 px-4" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" /> Print
            </button>
          </div>
        </div>

        <div className="tab-buttons no-print">
          <button type="button" className={`tab-btn ${tab === "return" ? "active" : ""}`} onClick={() => setTab("return")}>Part Return</button>
          <button type="button" className={`tab-btn ${tab === "core" ? "active" : ""}`} onClick={() => setTab("core")}>Core Part Return</button>
        </div>

        <div className="pr-panel">
          <div className="actions-row no-print">
            <div className="result-info">{rows.length} record{rows.length !== 1 ? "s" : ""} found</div>
            <input className="search-input" type="text" placeholder="search in result" value={resultSearch} onChange={(e) => setResultSearch(e.target.value)} />
          </div>

          {loadError ? (
            <p className="text-sm text-red-400 px-2 py-6">Failed to load part returns: {loadError}</p>
          ) : loading ? (
            <p className="text-sm text-muted-foreground px-2 py-6">Loading…</p>
          ) : (
          <>
          <div ref={tableScrollRef} className="table-wrap">
            <table className="pr-table min-w-max">
              <thead>
                <tr>
                  <th>Ticket No.</th>
                  <th>Branch</th>
                  <th>Unique ID</th>
                  <th>Part #</th>
                  <th>Dist.</th>
                  <th>Description</th>
                  <th>Invoice Date</th>
                  <th>Return Qty</th>
                  <th>Core Value</th>
                  <th>Part Status</th>
                  <th>Aging</th>
                  <th>Schedule Date</th>
                  <th>Technician</th>
                  <th>Core RA #</th>
                  <th>RA Date</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={15} className="text-center py-8 text-muted-foreground">No records found.</td></tr>
                ) : rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.ticketNo ? (
                        <Link className="ticket-link" to="/ticket/$ticketNo" params={{ ticketNo: r.ticketNo }} target="_blank" rel="noreferrer">{r.ticketNo}</Link>
                      ) : "—"}
                    </td>
                    <td>{r.location || "—"}</td>
                    <td title={r.id}>{r.id.slice(0, 8)}</td>
                    <td>
                      <button type="button" className="part-link-btn" onClick={() => openPartInfoModal(r.partNo)}>{r.partNo}</button>
                    </td>
                    <td>{r.partDist || "—"}</td>
                    <td>{r.description || "—"}</td>
                    <td>{r.invoiceDate || "—"}</td>
                    <td className="money">{r.quantity}</td>
                    <td className="money">{r.coreValue > 0 ? formatMoney(r.coreValue) : "—"}</td>
                    <td><span className="status-pill" style={STATUS_COLOR[r.status] || {}}>{r.status || "—"}</span></td>
                    <td className="money">{r.aging === null ? "—" : r.aging}</td>
                    <td>{r.scheduleDate || "—"}</td>
                    <td>{r.technician || "—"}</td>
                    <td>
                      <input
                        className="cell-input"
                        type="text"
                        placeholder="RA #"
                        value={r.raNo}
                        onChange={(e) => setLocalField(r.id, "raNo", e.target.value)}
                        onBlur={(e) => persistField(r.id, "raNo", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className="cell-input"
                        type="date"
                        value={r.raDate}
                        onChange={(e) => setLocalField(r.id, "raDate", e.target.value)}
                        onBlur={(e) => persistField(r.id, "raDate", e.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <FloatingHorizontalScrollbar targetRef={tableScrollRef} />
          </>
          )}
        </div>
      </main>

      <div id="partInfoModalOverlay" className={`part-info-modal-overlay ${modalPartNo ? "is-open" : ""}`} onClick={(event) => {
        if (event.target === event.currentTarget) setModalPartNo("");
      }}>
        <div className="part-info-modal" role="dialog" aria-modal="true" aria-labelledby="partInfoTitle">
          <div className="part-info-header">
            <div id="partInfoTitle" className="part-info-title">{modalPartNo ? `Part Info. of (${modalPartNo})` : "Part Info. of ()"}</div>
            <button type="button" className="part-info-close" onClick={() => setModalPartNo("")}>Close</button>
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
