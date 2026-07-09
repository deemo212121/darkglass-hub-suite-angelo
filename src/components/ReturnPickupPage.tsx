import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

type PickupRow = {
  raNo: string;
  seqNo: string;
  returnDate: string;
  partNo: string;
  shipTo: string;
  uniqueId: string;
  invoiceNo: string;
  itemNo: string;
  returnQty: string;
  scanOutQty: string;
  returnReason: string;
};

type PartInfoRow = { leftLabel: string; leftValue: string; rightLabel: string; rightValue: string };
type PartInfoAvailability = { id: string; name: string; qty: number };
type PartInfoData = { rows: PartInfoRow[]; availability: PartInfoAvailability[] };

const PICKUP_ROWS: PickupRow[] = [
  { raNo: "723490378", seqNo: "10", returnDate: "04/06/2026", partNo: "DA96-00845G", shipTo: "4930403", uniqueId: "7328836016000010", invoiceNo: "7328836016", itemNo: "10", returnQty: "1", scanOutQty: "0", returnReason: "PARTS NOT NEEDED (SUB.CHARGEABLE)" },
  { raNo: "723490378", seqNo: "20", returnDate: "04/06/2026", partNo: "DA97-20114B", shipTo: "4930403", uniqueId: "7328836016000020", invoiceNo: "7328836016", itemNo: "20", returnQty: "1", scanOutQty: "0", returnReason: "PARTS NOT NEEDED (SUB.CHARGEABLE)" },
  { raNo: "723473781", seqNo: "10", returnDate: "04/03/2026", partNo: "DA62-04678B", shipTo: "4930403", uniqueId: "7329777582000010", invoiceNo: "7329777582", itemNo: "10", returnQty: "1", scanOutQty: "0", returnReason: "PARTS NOT NEEDED (SUB.CHARGEABLE)" },
  { raNo: "723472354", seqNo: "10", returnDate: "04/03/2026", partNo: "DA91-06418A", shipTo: "4930403", uniqueId: "7330293693000010", invoiceNo: "7330293693", itemNo: "10", returnQty: "1", scanOutQty: "0", returnReason: "PARTS NOT NEEDED (SUB.CHARGEABLE)" },
  { raNo: "723489905", seqNo: "20", returnDate: "04/06/2026", partNo: "DE94-05151A", shipTo: "4930403", uniqueId: "7331228495000020", invoiceNo: "7331228495", itemNo: "20", returnQty: "1", scanOutQty: "0", returnReason: "PARTS NOT NEEDED (SUB.CHARGEABLE)" },
  { raNo: "723841458", seqNo: "10", returnDate: "05/04/2026", partNo: "DD81-02259A", shipTo: "4930403", uniqueId: "7340272868000010", invoiceNo: "7340272868", itemNo: "10", returnQty: "2", scanOutQty: "0", returnReason: "PARTS NOT NEEDED (SUB.CHARGEABLE)" },
  { raNo: "723840499", seqNo: "10", returnDate: "05/04/2026", partNo: "DC97-22579B", shipTo: "4930403", uniqueId: "7340738529000010", invoiceNo: "7340738529", itemNo: "10", returnQty: "1", scanOutQty: "0", returnReason: "PARTS NOT NEEDED (SUB.CHARGEABLE)" },
  { raNo: "723840612", seqNo: "20", returnDate: "05/04/2026", partNo: "DG44-01009B", shipTo: "4930403", uniqueId: "7341050732000020", invoiceNo: "7341050732", itemNo: "20", returnQty: "1", scanOutQty: "0", returnReason: "PARTS NOT NEEDED (SUB.CHARGEABLE)" },
  { raNo: "723840881", seqNo: "10", returnDate: "05/04/2026", partNo: "DG47-00067A", shipTo: "4930403", uniqueId: "7341050732000010", invoiceNo: "7341050732", itemNo: "10", returnQty: "2", scanOutQty: "0", returnReason: "PARTS NOT NEEDED (SUB.CHARGEABLE)" },
  { raNo: "723840893", seqNo: "20", returnDate: "05/04/2026", partNo: "DA81-06007B", shipTo: "4930403", uniqueId: "7341697196000020", invoiceNo: "7341697196", itemNo: "20", returnQty: "1", scanOutQty: "0", returnReason: "PARTS NOT NEEDED (SUB.CHARGEABLE)" },
  { raNo: "723840002", seqNo: "20", returnDate: "05/04/2026", partNo: "DC31-00080B", shipTo: "4930403", uniqueId: "7341874972000010", invoiceNo: "7341874972", itemNo: "10", returnQty: "1", scanOutQty: "0", returnReason: "PARTS NOT NEEDED (SUB.CHARGEABLE)" },
  { raNo: "723840208", seqNo: "10", returnDate: "05/04/2026", partNo: "DC97-20272F", shipTo: "4930403", uniqueId: "7341871770000010", invoiceNo: "7341871770", itemNo: "10", returnQty: "1", scanOutQty: "0", returnReason: "PARTS NOT NEEDED (SUB.CHARGEABLE)" },
  { raNo: "723841470", seqNo: "10", returnDate: "05/04/2026", partNo: "DE66-00283A", shipTo: "4930403", uniqueId: "7341859966000010", invoiceNo: "7341859966", itemNo: "10", returnQty: "1", scanOutQty: "0", returnReason: "PARTS NOT NEEDED (SUB.CHARGEABLE)" },
  { raNo: "723841470", seqNo: "20", returnDate: "05/04/2026", partNo: "DE94-05824A", shipTo: "4930403", uniqueId: "7341859966000020", invoiceNo: "7341859966", itemNo: "20", returnQty: "1", scanOutQty: "0", returnReason: "PARTS NOT NEEDED (SUB.CHARGEABLE)" },
  { raNo: "723841192", seqNo: "10", returnDate: "05/04/2026", partNo: "DA31-00334C", shipTo: "4930403", uniqueId: "7342037523000010", invoiceNo: "7342037523", itemNo: "10", returnQty: "1", scanOutQty: "0", returnReason: "PARTS NOT NEEDED (SUB.CHARGEABLE)" },
  { raNo: "723841192", seqNo: "20", returnDate: "05/04/2026", partNo: "DA31-00334D", shipTo: "4930403", uniqueId: "7342037523000020", invoiceNo: "7342037523", itemNo: "20", returnQty: "1", scanOutQty: "0", returnReason: "PARTS NOT NEEDED (SUB.CHARGEABLE)" },
  { raNo: "723842031", seqNo: "10", returnDate: "05/04/2026", partNo: "DA96-01581A", shipTo: "4930403", uniqueId: "7342026615000010", invoiceNo: "7342026615", itemNo: "10", returnQty: "1", scanOutQty: "0", returnReason: "PARTS NOT NEEDED (SUB.CHARGEABLE)" },
  { raNo: "723841467", seqNo: "10", returnDate: "05/04/2026", partNo: "DD82-01588A", shipTo: "4930403", uniqueId: "7342036374000010", invoiceNo: "7342036374", itemNo: "10", returnQty: "1", scanOutQty: "0", returnReason: "PARTS NOT NEEDED (SUB.CHARGEABLE)" },
];

const STORAGE_KEY = "ahs:return-pickup:rows";

const PART_INFO_DEFAULT: PartInfoData = {
  rows: [
    { leftLabel: "Make", leftValue: "GEH", rightLabel: "Part #", rightValue: "" },
    { leftLabel: "Price", leftValue: "31.56", rightLabel: "Dealer Price", rightValue: "42.83" },
    { leftLabel: "Retail Price", leftValue: "0", rightLabel: "List Price", rightValue: "66.84" },
    { leftLabel: "Core Price", leftValue: "", rightLabel: "Core?", rightValue: "" },
    { leftLabel: "Description", leftValue: "DOOR LOCK", rightLabel: "Discontinue?", rightValue: "false" },
    { leftLabel: "Drop Shop only?", leftValue: "", rightLabel: "Hazmat?", rightValue: "" },
    { leftLabel: "Refrigerant?", leftValue: "false", rightLabel: "Oversize?", rightValue: "false" },
  ],
  availability: [
    { id: "301", name: "LOUISVILLE", qty: 100 },
    { id: "1230", name: "CHARLOTTE", qty: 100 },
    { id: "1260", name: "ALBANY", qty: 100 },
    { id: "7200", name: "FRESNO", qty: 89 },
  ],
};

const PART_INFO_BY_PART: Record<string, PartInfoData> = {
  DEFAULT: PART_INFO_DEFAULT,
  "DA96-00845G": PART_INFO_DEFAULT,
  "DA97-20114B": PART_INFO_DEFAULT,
  "DA62-04678B": PART_INFO_DEFAULT,
  "DA91-06418A": PART_INFO_DEFAULT,
  "DE94-05151A": PART_INFO_DEFAULT,
  "DD81-02259A": PART_INFO_DEFAULT,
  "DC97-22579B": PART_INFO_DEFAULT,
  "DG44-01009B": PART_INFO_DEFAULT,
  "DG47-00067A": PART_INFO_DEFAULT,
  "DA81-06007B": PART_INFO_DEFAULT,
  "DC31-00080B": PART_INFO_DEFAULT,
  "DC97-20272F": PART_INFO_DEFAULT,
  "DE66-00283A": PART_INFO_DEFAULT,
  "DE94-05824A": PART_INFO_DEFAULT,
  "DA31-00334C": PART_INFO_DEFAULT,
  "DA31-00334D": PART_INFO_DEFAULT,
  "DA96-01581A": PART_INFO_DEFAULT,
  "DD82-01588A": PART_INFO_DEFAULT,
};

function loadSavedRows() {
  if (typeof window === "undefined") return PICKUP_ROWS;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return PICKUP_ROWS;
    const parsed = JSON.parse(raw) as PickupRow[];
    return Array.isArray(parsed) ? parsed : PICKUP_ROWS;
  } catch {
    return PICKUP_ROWS;
  }
}

export function ReturnPickupPage() {
  const [savedRows, setSavedRows] = useState<PickupRow[]>(() => loadSavedRows());
  const [pickupRows, setPickupRows] = useState<PickupRow[]>(() => loadSavedRows());
  const [newUniqueId, setNewUniqueId] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [raNoFilter, setRaNoFilter] = useState("");
  const [invoiceNoFilter, setInvoiceNoFilter] = useState("");
  const [uniqueIdFilter, setUniqueIdFilter] = useState("");
  const [resultSearch, setResultSearch] = useState("");
  const [selectedPart, setSelectedPart] = useState<PickupRow | null>(null);
  const [modalTab, setModalTab] = useState<"encompass" | "marcone">("marcone");
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const floatingBarRef = useRef<HTMLDivElement | null>(null);
  const floatingInnerRef = useRef<HTMLDivElement | null>(null);

  const recordCount = useMemo(() => pickupRows.length, [pickupRows]);
  const hasUnsavedChanges = useMemo(() => {
    return JSON.stringify(pickupRows) !== JSON.stringify(savedRows) || newUniqueId.trim().length > 0;
  }, [newUniqueId, pickupRows, savedRows]);
  const filteredRows = useMemo(() => {
    return pickupRows.filter((row) => {
      if (branchFilter && row.shipTo !== branchFilter) return false;
      if (raNoFilter && !row.raNo.toLowerCase().includes(raNoFilter.toLowerCase())) return false;
      if (invoiceNoFilter && !row.invoiceNo.toLowerCase().includes(invoiceNoFilter.toLowerCase())) return false;
      if (uniqueIdFilter && !row.uniqueId.toLowerCase().includes(uniqueIdFilter.toLowerCase())) return false;
      if (resultSearch) {
        const blob = [
          row.raNo,
          row.seqNo,
          row.returnDate,
          row.partNo,
          row.shipTo,
          row.uniqueId,
          row.invoiceNo,
          row.itemNo,
          row.returnQty,
          row.scanOutQty,
          row.returnReason,
        ].join(" ").toLowerCase();
        if (!blob.includes(resultSearch.toLowerCase())) return false;
      }
      return true;
    });
  }, [branchFilter, invoiceNoFilter, pickupRows, raNoFilter, resultSearch, uniqueIdFilter]);

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
  }, []);

  useEffect(() => {
    const tableWrap = tableWrapRef.current;
    const floatingBar = floatingBarRef.current;
    const floatingInner = floatingInnerRef.current;
    if (!tableWrap || !floatingBar || !floatingInner) return;

    const table = tableWrap.querySelector("table.data-table") as HTMLTableElement | null;
    if (!table) return;

    requestAnimationFrame(() => {
      const hasHorizontalOverflow = tableWrap.scrollWidth > tableWrap.clientWidth + 1;
      const rect = tableWrap.getBoundingClientRect();
      const shouldShow = hasHorizontalOverflow && rect.bottom > window.innerHeight;
      floatingInner.style.width = `${table.scrollWidth}px`;
      floatingBar.style.width = `${Math.max(0, Math.floor(rect.width))}px`;
      floatingBar.style.left = `${Math.max(0, Math.floor(rect.left))}px`;
      floatingBar.style.bottom = "0px";
      floatingBar.classList.toggle("is-visible", shouldShow);
      if (shouldShow) {
        floatingBar.scrollLeft = tableWrap.scrollLeft;
      }
    });
  }, [filteredRows.length, pickupRows.length, branchFilter, raNoFilter, invoiceNoFilter, uniqueIdFilter, resultSearch]);

  const addPart = () => {
    const uniqueId = newUniqueId.trim();
    if (!uniqueId) return;

    setPickupRows((current) => [
      {
        raNo: "",
        seqNo: "",
        returnDate: "",
        partNo: "",
        shipTo: "4930403",
        uniqueId,
        invoiceNo: "",
        itemNo: "",
        returnQty: "1",
        scanOutQty: "0",
        returnReason: "",
      },
      ...current,
    ]);
    setNewUniqueId("");
  };

  const saveRows = () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pickupRows));
    setSavedRows(pickupRows);
  };

  const activePartInfo = PART_INFO_BY_PART[selectedPart?.partNo ?? "DEFAULT"] || PART_INFO_DEFAULT;

  const renderPartInfoFields = (partNo: string, tab: "encompass" | "marcone") => {
    const data = PART_INFO_BY_PART[partNo] || PART_INFO_DEFAULT;
    return data.rows.map((row) => (
      <tr key={`${tab}-${row.leftLabel}-${row.rightLabel}`}>
        <td>{row.leftLabel}</td>
        <td>{row.leftValue}</td>
        <td>{row.rightLabel}</td>
        <td>{row.rightValue}</td>
      </tr>
    ));
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
          .btn.primary { background: #1d4ed8; border-color: #1d4ed8; }
          .btn.primary:hover { background: #1e40af; }
          .meta-row { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; margin-bottom: 0.7rem; flex-wrap: wrap; }
          .result-info { font-size: 0.8rem; font-weight: 700; color: #bfdbfe; }
          .search-input { width: 260px; height: 34px; padding: 0.35rem 0.5rem; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; font-size: 0.8rem; color: #fff; background: rgba(17, 24, 39, 0.95); }
          .table-wrap { overflow: auto; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 10px; background: #fff; }
          table.data-table { width: 100%; border-collapse: collapse; background: #fff; color: #1f2937; }
          .data-table th, .data-table td { border: 1px solid #d1d5db; padding: 0.65rem 0.75rem; font-size: 0.82rem; white-space: nowrap; text-align: center; }
          .data-table th { background: #f3f4f6; font-weight: 700; }
          .data-table td:first-child, .data-table td:nth-child(2), .data-table td:nth-child(4), .data-table td:nth-child(5) { text-align: left; }
          .floating-table-scrollbar { position: fixed; left: 0; bottom: 0; z-index: 1100; overflow-x: auto; overflow-y: hidden; border: 1px solid rgba(148, 163, 184, 0.5); border-radius: 8px; background: rgba(255, 255, 255, 0.92); box-shadow: 0 10px 24px rgba(15, 23, 42, 0.18); display: none; max-width: 100vw; }
          .floating-table-scrollbar.is-visible { display: block; }
          .floating-table-scrollbar-inner { height: 1px; }
          .back-btn { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.5rem 0.85rem; border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.16); background: rgba(255, 255, 255, 0.08); color: #fff; font-weight: 700; transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease; }
          .back-btn:hover { transform: translateY(-1px); background: rgba(255, 255, 255, 0.14); border-color: rgba(255, 255, 255, 0.28); box-shadow: 0 8px 18px rgba(15, 23, 42, 0.16); }
          .po-footer { margin-top: 1rem; color: #cbd5e1; font-size: 0.9rem; }
          .po-footer p { margin: 0; }
          .po-footer-note { margin-top: 1rem; opacity: 0.7; }
          .clickable-part-no { color: #1d4ed8; text-decoration: underline; cursor: pointer; font-weight: 600; }
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

        <div className="panel">
          <div className="controls-grid">
            <div className="field">
              <label htmlFor="branchFilter">Branch*</label>
              <select id="branchFilter" value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}>
                <option value="">Select Branch</option>
                <option value="4930403">4930403</option>
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
            <button type="button" className="btn primary" onClick={addPart}>Add Part</button>
            <button type="button" className="btn" onClick={saveRows} disabled={!hasUnsavedChanges} aria-disabled={!hasUnsavedChanges} style={{ opacity: hasUnsavedChanges ? 1 : 0.5, cursor: hasUnsavedChanges ? "pointer" : "not-allowed" }}>Save</button>
          </div>

          <div className="meta-row">
            <div id="recordInfo" className="result-info">{filteredRows.length} records found</div>
            <input id="resultSearch" className="search-input" type="text" placeholder="search in result" value={resultSearch} onChange={(event) => setResultSearch(event.target.value)} />
          </div>

          <div className="table-wrap" ref={tableWrapRef}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>RA #</th>
                  <th>Seq #</th>
                  <th>Return Date</th>
                  <th>Part No</th>
                  <th>Ship To</th>
                  <th>UniqueId</th>
                  <th>Invoice No</th>
                  <th>Item No</th>
                  <th>Return Qty</th>
                  <th>Scan Out Qty</th>
                  <th>Return Reason</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={`${row.raNo}-${row.seqNo}-${row.partNo}`}>
                    <td>{row.raNo}</td>
                    <td>{row.seqNo}</td>
                    <td>{row.returnDate}</td>
                    <td><span className="clickable-part-no" onClick={() => { setSelectedPart(row); setModalTab("marcone"); }}>{row.partNo}</span></td>
                    <td>{row.shipTo}</td>
                    <td>{row.uniqueId}</td>
                    <td>{row.invoiceNo}</td>
                    <td>{row.itemNo}</td>
                    <td>{row.returnQty}</td>
                    <td>{row.scanOutQty}</td>
                    <td>{row.returnReason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div id="returnPickupFloatingScrollbar" className="floating-table-scrollbar" aria-hidden="true" ref={floatingBarRef}>
            <div id="returnPickupFloatingScrollbarInner" className="floating-table-scrollbar-inner" ref={floatingInnerRef} />
          </div>
        </div>

          <div className="po-footer">Showing {filteredRows.length} return records filtered for pickup processing.</div>
      </main>

      <div id="partInfoModalOverlay" className={`part-info-modal-overlay ${selectedPart ? "is-open" : ""}`} onClick={(event) => { if (event.target === event.currentTarget) setSelectedPart(null); }}>
        <div className="part-info-modal" role="dialog" aria-modal="true" aria-labelledby="partInfoTitle">
          <div className="part-info-header">
            <div id="partInfoTitle" className="part-info-title">Part Info. of ({selectedPart?.partNo ?? ""})</div>
            <button id="partInfoCloseBtn" type="button" className="part-info-close" onClick={() => setSelectedPart(null)}>Close</button>
          </div>

          <div className="part-info-tabs">
            <button type="button" className={`part-info-tab-btn ${modalTab === "encompass" ? "active" : ""}`} onClick={() => setModalTab("encompass")}>Encompass</button>
            <button type="button" className={`part-info-tab-btn ${modalTab === "marcone" ? "active" : ""}`} onClick={() => setModalTab("marcone")}>Marcone</button>
          </div>

          <div className="part-info-body">
            <div className={`part-info-pane ${modalTab === "encompass" ? "active" : ""}`}>
              <table className="part-info-matrix">
                <thead>
                  <tr><th>Field</th><th>Value</th><th>Field</th><th>Value</th></tr>
                </thead>
                <tbody>{renderPartInfoFields(selectedPart?.partNo ?? "DEFAULT", "encompass")}</tbody>
              </table>
              <div className="part-info-section-title">Availability (Encompass)</div>
              <div className="part-info-empty">No availability records found.</div>
            </div>

            <div className={`part-info-pane ${modalTab === "marcone" ? "active" : ""}`}>
              <table className="part-info-matrix">
                <thead>
                  <tr><th>Field</th><th>Value</th><th>Field</th><th>Value</th></tr>
                </thead>
                <tbody>{renderPartInfoFields(selectedPart?.partNo ?? "DEFAULT", "marcone")}</tbody>
              </table>
              <div className="part-info-section-title">Availability (Marcone)</div>
              <div id="partInfoAvailabilityCount" className="part-info-section-subtitle">{activePartInfo.availability.length} records found</div>
              <table className="part-info-matrix">
                <thead><tr><th>ID</th><th>W/H Name</th><th>Available Qty</th></tr></thead>
                <tbody>
                  {activePartInfo.availability.map((row) => (
                    <tr key={`${row.id}-${row.name}`}><td>{row.id}</td><td>{row.name}</td><td>{row.qty}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <footer id="contact" className="po-footer">
        <p>For any questions or support, contact us at <a href="mailto:support@adminhubsolutions.com">support@adminhubsolutions.com</a></p>
        <p className="po-footer-note">© 2026 Admin Hub Solutions. All rights reserved.</p>
      </footer>
    </div>
  );
}