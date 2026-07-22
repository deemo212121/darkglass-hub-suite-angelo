import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Download } from "lucide-react";
import * as XLSX from "xlsx";
import { LOCATIONS } from "@/lib/locations";
import {
  getPartReturns,
  updatePartReturnRow,
  getDistinctDistributors,
  type PartReturnRow,
} from "@/lib/supabase/partReturnStatus";
import { marconeLookupPart, type MarconePartInfo } from "@/lib/marconeApi";

const TAB_KEY = "partReturnStatusTab";

const REGULAR_STATUS_OPTIONS = ["NOT RECEIVED", "RECEIVED", "PROCESSED", "DISPUTED"];
const CORE_STATUS_OPTIONS = ["NOT RECEIVED", "CORE RETURN", "RECEIVED", "PROCESSED", "DISPUTED"];

function formatUsd(value: number | undefined): string {
  return typeof value === "number" ? `$${value.toFixed(2)}` : "—";
}

function formatMoney(value: number | string) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num.toFixed(2) : "0.00";
}

/** Export the rows currently on screen (whatever filters/search are active) as a real .xlsx workbook. */
function exportReturnsToXlsx(rows: PartReturnRow[], sheetName: string, filenamePrefix: string) {
  const data = rows.map((row) => ({
    "RA No": row.raNo,
    "PO No": row.poNo,
    "Unique ID": row.id,
    "Part No": row.partNo,
    "Description": row.description,
    "Return Type": row.returnType,
    "Return Reason": row.returnReason,
    "Status": row.returnStatus,
    "Return Date": row.raDate,
    "Returned By": row.returnedBy,
    "Qty": row.qty,
    "Unit Price": row.unitPrice,
    "Core Value": row.coreValue,
  }));
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, `${filenamePrefix}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function PartReturnStatusPage() {
  const [activeView, setActiveView] = useState<"regular" | "core">(() => {
    const saved = localStorage.getItem(TAB_KEY);
    return saved === "core" ? "core" : "regular";
  });
  const [allRows, setAllRows] = useState<PartReturnRow[]>([]);
  const [distributors, setDistributors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [locationFilter, setLocationFilter] = useState("");
  const [distributorFilter, setDistributorFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [raFilter, setRaFilter] = useState("");
  const [uniqueIdFilter, setUniqueIdFilter] = useState("");
  const [resultSearch, setResultSearch] = useState("");
  const [coreResultSearch, setCoreResultSearch] = useState("");
  const [modalPartNo, setModalPartNo] = useState("");
  const [modalTab, setModalTab] = useState<"encompass" | "marcone">("marcone");
  const [marconeInfo, setMarconeInfo] = useState<MarconePartInfo | null>(null);
  const [marconeLoading, setMarconeLoading] = useState(false);
  const [marconeNotFound, setMarconeNotFound] = useState(false);
  const [marconeError, setMarconeError] = useState<string | null>(null);

  // Real Marcone part lookup (make/pricing/per-warehouse availability) —
  // no equivalent Encompass part-info API is wired into this app yet, so
  // that tab stays a plain "not available" message rather than fake data.
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

  const regularTableWrapRef = useRef<HTMLDivElement | null>(null);
  const coreTableWrapRef = useRef<HTMLDivElement | null>(null);
  const regularFloatingBarRef = useRef<HTMLDivElement | null>(null);
  const coreFloatingBarRef = useRef<HTMLDivElement | null>(null);
  const regularFloatingInnerRef = useRef<HTMLDivElement | null>(null);
  const coreFloatingInnerRef = useRef<HTMLDivElement | null>(null);

  const loadRows = () => {
    setLoading(true);
    setLoadError(null);
    getPartReturns()
      .then(setAllRows)
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadRows();
    getDistinctDistributors().then(setDistributors).catch((err) => console.error("Failed to load distributors:", err));
  }, []);

  useEffect(() => {
    localStorage.setItem(TAB_KEY, activeView);
  }, [activeView]);

  const regularRows = useMemo(() => allRows.filter((r) => r.returnType === "RETURN"), [allRows]);
  const coreRows = useMemo(() => allRows.filter((r) => r.returnType === "CORE RETURN"), [allRows]);

  const applyCommonFilters = (rows: PartReturnRow[], search: string) =>
    rows.filter((row) => {
      if (locationFilter && row.location !== locationFilter) return false;
      if (distributorFilter && row.distributor !== distributorFilter) return false;
      if (raFilter && !(row.raNo || "").toLowerCase().includes(raFilter.toLowerCase())) return false;
      if (uniqueIdFilter && !row.id.toLowerCase().includes(uniqueIdFilter.toLowerCase())) return false;
      if (fromDate || toDate) {
        if (!row.raDate) return false;
        const rowDate = new Date(row.raDate);
        if (fromDate && rowDate < new Date(fromDate)) return false;
        if (toDate && rowDate > new Date(toDate)) return false;
      }
      if (search) {
        const blob = [row.raNo, row.poNo, row.id, row.partNo, row.description, row.returnStatus, row.returnReason].join(" ").toLowerCase();
        if (!blob.includes(search.toLowerCase())) return false;
      }
      return true;
    });

  const filteredRegular = useMemo(() => applyCommonFilters(regularRows, resultSearch), [regularRows, locationFilter, distributorFilter, raFilter, uniqueIdFilter, fromDate, toDate, resultSearch]);
  const filteredCore = useMemo(() => applyCommonFilters(coreRows, coreResultSearch), [coreRows, locationFilter, distributorFilter, raFilter, uniqueIdFilter, fromDate, toDate, coreResultSearch]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModalPartNo("");
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Local edits apply immediately for responsive typing; persisted to
  // Supabase either right away (status select - a discrete action) or on
  // blur (text/date fields - avoids a network call per keystroke).
  const setLocalField = (id: string, field: "raNo" | "raDate" | "returnStatus" | "returnedBy", value: string) => {
    setAllRows((current) => current.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  };
  const persistField = async (id: string, field: "raNo" | "raDate" | "returnStatus" | "returnedBy", value: string) => {
    try {
      await updatePartReturnRow(id, { [field]: value });
      setSaveError(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save change");
    }
  };

  useEffect(() => {
    const sync = (tableWrap: HTMLDivElement | null, floatingBar: HTMLDivElement | null, floatingInner: HTMLDivElement | null) => {
      if (!tableWrap || !floatingBar || !floatingInner) return;
      const table = tableWrap.querySelector("table");
      if (!table) return;
      floatingInner.style.width = `${(table as HTMLTableElement).scrollWidth}px`;
      const rect = tableWrap.getBoundingClientRect();
      floatingBar.style.width = `${Math.max(0, Math.floor(rect.width))}px`;
      floatingBar.style.left = `${Math.max(0, Math.floor(rect.left))}px`;
      floatingBar.style.bottom = "0px";
    };

    const updateVisibility = (tableWrap: HTMLDivElement | null, floatingBar: HTMLDivElement | null, syncFn: () => void) => {
      if (!tableWrap || !floatingBar) return;
      const hasOverflow = tableWrap.scrollWidth > tableWrap.clientWidth + 1;
      const rect = tableWrap.getBoundingClientRect();
      const viewportBottom = window.innerHeight;
      const scrollbarInViewport = rect.bottom <= viewportBottom && rect.bottom >= 0;
      const tableIntersectsViewport = rect.top < viewportBottom && rect.bottom > 0;
      const shouldShow = hasOverflow && tableIntersectsViewport && !scrollbarInViewport;
      floatingBar.classList.toggle("is-visible", shouldShow);
      if (shouldShow) {
        syncFn();
        floatingBar.scrollLeft = tableWrap.scrollLeft;
      }
    };

    const regularSync = () => sync(regularTableWrapRef.current, regularFloatingBarRef.current, regularFloatingInnerRef.current);
    const coreSync = () => sync(coreTableWrapRef.current, coreFloatingBarRef.current, coreFloatingInnerRef.current);

    const onRegularTableScroll = () => {
      if (regularFloatingBarRef.current) regularFloatingBarRef.current.scrollLeft = regularTableWrapRef.current?.scrollLeft || 0;
      updateVisibility(regularTableWrapRef.current, regularFloatingBarRef.current, regularSync);
    };
    const onRegularFloatingScroll = () => {
      if (regularTableWrapRef.current) regularTableWrapRef.current.scrollLeft = regularFloatingBarRef.current?.scrollLeft || 0;
    };
    const onCoreTableScroll = () => {
      if (coreFloatingBarRef.current) coreFloatingBarRef.current.scrollLeft = coreTableWrapRef.current?.scrollLeft || 0;
      updateVisibility(coreTableWrapRef.current, coreFloatingBarRef.current, coreSync);
    };
    const onCoreFloatingScroll = () => {
      if (coreTableWrapRef.current) coreTableWrapRef.current.scrollLeft = coreFloatingBarRef.current?.scrollLeft || 0;
    };

    regularTableWrapRef.current?.addEventListener("scroll", onRegularTableScroll);
    regularFloatingBarRef.current?.addEventListener("scroll", onRegularFloatingScroll);
    coreTableWrapRef.current?.addEventListener("scroll", onCoreTableScroll);
    coreFloatingBarRef.current?.addEventListener("scroll", onCoreFloatingScroll);

    const onResize = () => {
      regularSync();
      coreSync();
      updateVisibility(regularTableWrapRef.current, regularFloatingBarRef.current, regularSync);
      updateVisibility(coreTableWrapRef.current, coreFloatingBarRef.current, coreSync);
    };
    const onWindowScroll = () => {
      updateVisibility(regularTableWrapRef.current, regularFloatingBarRef.current, regularSync);
      updateVisibility(coreTableWrapRef.current, coreFloatingBarRef.current, coreSync);
    };

    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onWindowScroll, { passive: true });

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        onResize();
      });
    });

    return () => {
      regularTableWrapRef.current?.removeEventListener("scroll", onRegularTableScroll);
      regularFloatingBarRef.current?.removeEventListener("scroll", onRegularFloatingScroll);
      coreTableWrapRef.current?.removeEventListener("scroll", onCoreTableScroll);
      coreFloatingBarRef.current?.removeEventListener("scroll", onCoreFloatingScroll);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onWindowScroll);
    };
  }, [activeView, filteredCore.length, filteredRegular.length]);

  useEffect(() => {
    setTimeout(() => {
      const tableWrap = activeView === "regular" ? regularTableWrapRef.current : coreTableWrapRef.current;
      const floatingBar = activeView === "regular" ? regularFloatingBarRef.current : coreFloatingBarRef.current;
      const floatingInner = activeView === "regular" ? regularFloatingInnerRef.current : coreFloatingInnerRef.current;
      if (!tableWrap || !floatingBar || !floatingInner) return;
      const table = tableWrap.querySelector("table") as HTMLTableElement | null;
      if (!table) return;
      floatingInner.style.width = `${table.scrollWidth}px`;
      const rect = tableWrap.getBoundingClientRect();
      floatingBar.style.width = `${Math.max(0, Math.floor(rect.width))}px`;
      floatingBar.style.left = `${Math.max(0, Math.floor(rect.left))}px`;
      floatingBar.classList.toggle("is-visible", tableWrap.scrollWidth > tableWrap.clientWidth + 1);
    }, 0);
  }, [activeView, filteredCore.length, filteredRegular.length]);

  const renderRows = (rows: PartReturnRow[], statusOptions: string[]) => (
    <>
      {rows.map((row) => (
        <tr key={row.id}>
          <td><input type="text" className="table-input" title="Edit RA #" placeholder="RA #" value={row.raNo} onChange={(e) => setLocalField(row.id, "raNo", e.target.value)} onBlur={(e) => persistField(row.id, "raNo", e.target.value)} /></td>
          <td>{row.poNo}</td>
          <td className="text-[10px]" title={row.id}>{row.id.slice(0, 8)}</td>
          <td><span className="clickable-part-no" onClick={() => { setModalPartNo(row.partNo); setModalTab("marcone"); }}>{row.partNo}</span></td>
          <td>{row.description}</td>
          <td>{row.returnType}</td>
          <td>{row.returnReason}</td>
          <td>
            <select className="table-select" title="Edit status" value={row.returnStatus} onChange={(e) => { setLocalField(row.id, "returnStatus", e.target.value); persistField(row.id, "returnStatus", e.target.value); }}>
              {statusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </td>
          <td><input type="date" className="table-input" title="Edit return date" value={row.raDate} onChange={(e) => setLocalField(row.id, "raDate", e.target.value)} onBlur={(e) => persistField(row.id, "raDate", e.target.value)} /></td>
          <td><input type="text" className="table-input" title="Edit returned by" placeholder="Returned by" value={row.returnedBy} onChange={(e) => setLocalField(row.id, "returnedBy", e.target.value)} onBlur={(e) => persistField(row.id, "returnedBy", e.target.value)} /></td>
          <td className="qty">{row.qty}</td>
          <td className="money">${formatMoney(row.unitPrice)}</td>
          <td className="money">${formatMoney(row.coreValue)}</td>
          <td>-</td>
        </tr>
      ))}
      <tr className="totals-row">
        <td colSpan={11}></td>
        <td className="money">${formatMoney(rows.reduce((sum, row) => sum + Number(row.unitPrice || 0), 0))}</td>
        <td className="money">${formatMoney(rows.reduce((sum, row) => sum + Number(row.coreValue || 0), 0))}</td>
        <td></td>
      </tr>
    </>
  );

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <style>{`
          .panel {
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 10px;
            padding: 1.25rem;
            backdrop-filter: blur(10px);
            color: #fff;
          }
          .controls-grid { display: grid; grid-template-columns: repeat(4, minmax(160px, 1fr)); grid-auto-rows: max-content; gap: 0.75rem; margin-bottom: 1rem; }
          .field { display: flex; flex-direction: column; gap: 0.3rem; }
          .field label { font-size: 0.78rem; font-weight: 700; color: #e5e7eb; }
          .field input, .field select { height: 34px; padding: 0.35rem 0.5rem; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; font-size: 0.8rem; color: #fff; background: rgba(17, 24, 39, 0.95); }
          .date-range { display: flex; align-items: center; gap: 0.45rem; }
          .date-range input { flex: 1; height: 34px; padding: 0.35rem 0.5rem; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; font-size: 0.8rem; color: #fff; background: rgba(17, 24, 39, 0.95); }
          .date-range span { color: #e5e7eb; }
          .btn { height: 34px; padding: 0 0.85rem; border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 6px; background: rgba(17, 24, 39, 0.95); color: #fff; font-size: 0.78rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 0.4rem; }
          .btn.primary, .btn-primary { background: #1d4ed8; border-color: #1d4ed8; }
          .tab-buttons { display: flex; gap: 0.5rem; margin-top: 1.5rem; margin-bottom: 1rem; padding: 0; }
          .tab-btn { padding: 0.6rem 1.2rem; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(255, 255, 255, 0.05); color: #fff; border-radius: 6px; cursor: pointer; font-size: 0.85rem; font-weight: 600; transition: all 0.2s ease; }
          .tab-btn.active { background: #1d4ed8; border-color: #1d4ed8; }
          .tab-content { display: none; }
          .tab-content.active { display: block; }
          .meta-row { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; margin-bottom: 0.7rem; flex-wrap: wrap; }
          .result-info { font-size: 0.8rem; font-weight: 700; color: #bfdbfe; }
          .search-input { width: 260px; height: 34px; padding: 0.35rem 0.5rem; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; font-size: 0.8rem; color: #fff; background: rgba(17, 24, 39, 0.95); }
          .table-wrap { overflow: auto; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 10px; background: #fff; }
          .floating-table-scrollbar { position: fixed; left: 0; bottom: 0; z-index: 1100; overflow-x: auto; overflow-y: hidden; border: 1px solid rgba(148, 163, 184, 0.5); border-radius: 8px; background: rgba(255, 255, 255, 0.92); box-shadow: 0 10px 24px rgba(15, 23, 42, 0.18); display: none; max-width: 100vw; }
          .floating-table-scrollbar.is-visible { display: block; }
          .floating-table-scrollbar-inner { height: 1px; }
          table.return-table { width: 100%; border-collapse: collapse; font-size: 0.74rem; color: #111827; }
          .return-table th, .return-table td { border: 1px solid #d1d5db; padding: 0.4rem; white-space: nowrap; vertical-align: top; }
          .return-table th { background: #1f2937; color: #f8fafc; text-align: left; position: sticky; top: 0; z-index: 1; }
          .return-table tbody tr:nth-child(even) { background: #f9fafb; }
          .return-table tbody tr.totals-row { background: #e5e7eb; font-weight: 700; }
          .return-table tbody tr.no-data td { text-align: center; color: #64748b; }
          .money { text-align: right; }
          .qty { text-align: center; }
          .table-input, .table-select { width: 100%; padding: 0.25rem 0.35rem; border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 4px; background: rgba(255, 255, 255, 0.9); color: #111827; font-size: 0.72rem; }
          .clickable-part-no { color: #1d4ed8; text-decoration: underline; cursor: pointer; font-weight: 500; }
          .clickable-part-no:hover { color: #1e40af; }
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
          .status-footer { padding: 1.5rem 0 0; text-align: center; color: rgba(255, 255, 255, 0.9); }
          .status-footer p { margin: 0; }
          .status-footer .status-footer-note { margin-top: 1rem; opacity: 0.7; }
          #partInfoModalOverlay .part-info-modal, #partInfoModalOverlay .part-info-modal th, #partInfoModalOverlay .part-info-modal td, #partInfoModalOverlay .part-info-title, #partInfoModalOverlay .part-info-close, #partInfoModalOverlay .part-info-section-title, #partInfoModalOverlay .part-info-section-subtitle, #partInfoModalOverlay .part-info-empty, #partInfoModalOverlay .part-info-tab-btn { color: #111827 !important; }
          #partInfoModalOverlay .part-info-tab-btn.active { color: #ffffff !important; }
          .back-btn { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.5rem 0.85rem; border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.16); background: rgba(255, 255, 255, 0.08); color: #fff; font-weight: 700; transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease; }
          .back-btn:hover { transform: translateY(-1px); background: rgba(255, 255, 255, 0.14); border-color: rgba(255, 255, 255, 0.28); box-shadow: 0 8px 18px rgba(15, 23, 42, 0.16); }
          @media (max-width: 1100px) { .controls-grid { grid-template-columns: repeat(2, minmax(160px, 1fr)); } }
          @media (max-width: 700px) { .controls-grid { grid-template-columns: 1fr; } .search-input { width: 100%; } .tab-buttons { padding: 0; } }
        `}</style>

        <div className="mb-4">
          <div className="flex items-center gap-3 mb-4">
            <Link to="/m/$module" params={{ module: "parts" }} className="back-btn">
              <ChevronLeft className="h-4 w-4" /> Parts
            </Link>
          </div>
          <h1 className="text-2xl font-semibold leading-tight">Part Return Status</h1>
          <p className="text-sm text-muted-foreground">Track regular and core part returns separately.</p>
          {saveError && <p className="text-sm text-red-400 mt-1">{saveError}</p>}
        </div>

        <div className="panel">
          <div className="controls-grid">
            <div className="field">
              <label htmlFor="locationFilter">Location</label>
              <select id="locationFilter" value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}>
                <option value="">All</option>
                {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="distributorFilter">Distributor</label>
              <select id="distributorFilter" value={distributorFilter} onChange={(event) => setDistributorFilter(event.target.value)}>
                <option value="">All</option>
                {distributors.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="fromDate">Return Date</label>
              <div className="date-range">
                <input id="fromDate" type="date" title="Return date from" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
                <span>~</span>
                <input id="toDate" type="date" title="Return date to" value={toDate} onChange={(event) => setToDate(event.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="raFilter">RA #</label>
              <input id="raFilter" type="text" placeholder="RA #" value={raFilter} onChange={(event) => setRaFilter(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="uniqueIdFilter">Unique ID</label>
              <input id="uniqueIdFilter" type="text" placeholder="Unique ID" value={uniqueIdFilter} onChange={(event) => setUniqueIdFilter(event.target.value)} />
            </div>
          </div>
        </div>

        <div className="tab-buttons">
          <button type="button" className={`tab-btn ${activeView === "regular" ? "active" : ""}`} onClick={() => setActiveView("regular")}>Part Return</button>
          <button type="button" className={`tab-btn ${activeView === "core" ? "active" : ""}`} onClick={() => setActiveView("core")}>Core Part Return</button>
        </div>

        {loadError ? (
          <p className="text-sm text-red-400 px-2 py-6">Failed to load part returns: {loadError}</p>
        ) : loading ? (
          <p className="text-sm text-muted-foreground px-2 py-6">Loading…</p>
        ) : (
        <>
        <div id="regularTab" className={`tab-content ${activeView === "regular" ? "active" : ""}`}>
          <div className="panel">
            <div className="meta-row">
              <div id="recordInfo" className="result-info">{filteredRegular.length} records found</div>
              <div style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
                <input id="resultSearch" className="search-input" type="text" placeholder="search in result" value={resultSearch} onChange={(event) => setResultSearch(event.target.value)} />
                <button type="button" className="btn" onClick={() => exportReturnsToXlsx(filteredRegular, "Part Return", "part-return-status")}>
                  <Download className="h-3.5 w-3.5" /> Download XLSX
                </button>
              </div>
            </div>

            <div id="regularTableWrap" className="table-wrap" ref={regularTableWrapRef}>
              <table className="return-table">
                <thead>
                  <tr>
                    <th>RA No</th>
                    <th>PO No</th>
                    <th>Unique ID</th>
                    <th>Part No</th>
                    <th>Description</th>
                    <th>Return Type</th>
                    <th>Return Reason</th>
                    <th>Status</th>
                    <th>Return Date</th>
                    <th>Returned by</th>
                    <th>Qty</th>
                    <th>Unit Price</th>
                    <th>Core Value</th>
                    <th>Return Label</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRegular.length === 0 ? (
                    <tr className="no-data"><td colSpan={14}>No records found</td></tr>
                  ) : renderRows(filteredRegular, REGULAR_STATUS_OPTIONS)}
                </tbody>
              </table>
            </div>

            <div id="regularFloatingScrollbar" className="floating-table-scrollbar" aria-hidden="true" ref={regularFloatingBarRef}>
              <div id="regularFloatingScrollbarInner" className="floating-table-scrollbar-inner" ref={regularFloatingInnerRef} />
            </div>
          </div>
        </div>

        <div id="coreTab" className={`tab-content ${activeView === "core" ? "active" : ""}`}>
          <div className="panel">
            <div className="meta-row">
              <div id="coreRecordInfo" className="result-info">{filteredCore.length} records found</div>
              <div style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
                <input id="coreResultSearch" className="search-input" type="text" placeholder="search in result" value={coreResultSearch} onChange={(event) => setCoreResultSearch(event.target.value)} />
                <button type="button" className="btn" onClick={() => exportReturnsToXlsx(filteredCore, "Core Part Return", "core-part-return-status")}>
                  <Download className="h-3.5 w-3.5" /> Download XLSX
                </button>
              </div>
            </div>

            <div id="coreTableWrap" className="table-wrap" ref={coreTableWrapRef}>
              <table className="return-table">
                <thead>
                  <tr>
                    <th>RA No</th>
                    <th>PO No</th>
                    <th>Unique ID</th>
                    <th>Part No</th>
                    <th>Description</th>
                    <th>Return Type</th>
                    <th>Return Reason</th>
                    <th>Status</th>
                    <th>Return Date</th>
                    <th>Returned by</th>
                    <th>Qty</th>
                    <th>Unit Price</th>
                    <th>Core Value</th>
                    <th>Return Label</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCore.length === 0 ? (
                    <tr className="no-data"><td colSpan={14}>No records found</td></tr>
                  ) : renderRows(filteredCore, CORE_STATUS_OPTIONS)}
                </tbody>
              </table>
            </div>

            <div id="coreFloatingScrollbar" className="floating-table-scrollbar" aria-hidden="true" ref={coreFloatingBarRef}>
              <div id="coreFloatingScrollbarInner" className="floating-table-scrollbar-inner" ref={coreFloatingInnerRef} />
            </div>
          </div>
        </div>
        </>
        )}
      </main>

      <div id="partInfoModalOverlay" className={`part-info-modal-overlay ${modalPartNo ? "is-open" : ""}`} onClick={(event) => { if (event.target === event.currentTarget) setModalPartNo(""); }}>
        <div className="part-info-modal" role="dialog" aria-modal="true" aria-labelledby="partInfoTitle">
          <div className="part-info-header">
            <div id="partInfoTitle" className="part-info-title">Part Info. of ({modalPartNo})</div>
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
