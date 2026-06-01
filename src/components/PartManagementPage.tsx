import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

type ManagementRow = {
  ticketNo: string;
  repairStatus: string;
  location: string;
  schedule: string;
  wty: string;
  partId: string;
  partDist: string;
  partNo: string;
  description: string;
  poNo: string;
  poDate: string;
  orderNo: string;
  invoiceNo: string;
  partStatus: string;
  note: string;
  unit: number;
  core: number;
  qty: number;
  lot: string;
  symptom: string;
  action: string;
  receiveDate: string;
};

const STORAGE_KEY = "partManagementRows";

const REQUIRED_REPAIR_STATUSES = [
  "CL-Claimed",
  "CL-Data-Closed",
  "CL-Need Cancel",
  "CL-Parts Back Ordered",
  "CL-Ready to Complete",
  "CSR-Acknowledged",
  "CSR-Assigned to ASC",
  "CSR-Left Message for Cx",
  "CSR-Needs Scheduling",
  "OP-Ready for Service",
  "OP-Reschedule Follow up",
  "OP-UPDATE HOLD",
  "OP-Waiting for Part",
  "3 PT-Need PreAuthorization",
  "TR-Need PO",
  "TR-Need Triage",
];

const REQUIRED_PART_STATUSES = [
  "Back Order",
  "Cancelled",
  "Claimed",
  "CX Home",
  "Cx Received",
  "Defective",
  "Hold for Estimation",
  "Hold for next vist",
  "Lost",
  "Need PO",
  "Not Used & Stocked",
  "PAID",
  "Part Ready",
  "PO Made",
  "RA - Defect",
  "RA - DMG",
  "RA - PNN",
  "RA - Qty Discrepancy",
  "SQT Received",
  "Tech Pickup",
  "Transfered to other ticket",
  "Used",
];

const PART_DIST_OPTIONS = [
  "You, Now",
  "AIG",
  "Electrolux",
  "Encompass",
  "Encompass-Birmingham l Montgomery",
  "GE",
  "LG",
  "Marcone- Birmingham / Montgomery",
  "Marcone-162468",
  "Midea",
  "Miele",
  "NSA",
  "OW",
  "SB",
  "Sharp",
  "SP",
  "Squaretrade",
  "SS",
];

const LOT_OPTIONS = ["A1", "A2", "A3", "A4", "A5", "B1", "B2", "B3", "B4", "B5", "C1", "C2", "C3", "C4", "C5", "D1", "D2", "D3", "D4", "D5", "Return"];

const BASE_ROWS: ManagementRow[] = [
  { ticketNo: "066098174139", repairStatus: "TR-Need Triage", location: "Asheville", schedule: "05/22", wty: "IW", partId: "P1", partDist: "", partNo: "5221DD1001E", description: "VALVE ASSEMBLY INLET", poNo: "066098174139", poDate: "", orderNo: "", invoiceNo: "", partStatus: "CX Home", note: "If used during repair requires return: No Shipping Provider: FedEx", unit: 0, core: 0, qty: 1, lot: "", symptom: "05/15 - Customer called in stating blinking 1E error code for 2 days.", action: "Part Order", receiveDate: "2026-05-15" },
  { ticketNo: "1006772961-10", repairStatus: "OP-Waiting for Part", location: "Asheville", schedule: "04/22", wty: "IW", partId: "P10", partDist: "Marcone-162468", partNo: "5304485759", description: "TAPE", poNo: "1006772961-10-AV", poDate: "2026-04-27", orderNo: "73538313", invoiceNo: "73586196-2", partStatus: "Part Ready", note: "", unit: 0.39, core: 0, qty: 4, lot: "", symptom: "Need to rediag the unit.", action: "Part Order", receiveDate: "2026-05-14" },
  { ticketNo: "1006772961-10", repairStatus: "OP-Waiting for Part", location: "Asheville", schedule: "04/22", wty: "IW", partId: "P11", partDist: "Marcone-162468", partNo: "140134075039", description: "HARNESS", poNo: "1006772961-10-AV-2", poDate: "2026-05-01", orderNo: "73692049", invoiceNo: "73692049-3", partStatus: "Part Ready", note: "", unit: 16.33, core: 0, qty: 1, lot: "", symptom: "", action: "Part Order", receiveDate: "2026-05-14" },
  { ticketNo: "1006772961-10", repairStatus: "OP-Waiting for Part", location: "Asheville", schedule: "04/22", wty: "IW", partId: "P14", partDist: "Marcone-162468", partNo: "5304530680", description: "EVAPORATOR ASSEMBLY", poNo: "1006772961-10-AV-2", poDate: "2026-05-01", orderNo: "73692047", invoiceNo: "", partStatus: "PO Made", note: "05/04 - Sent cancelation email to Marcone.", unit: 75.28, core: 0, qty: 1, lot: "", symptom: "", action: "Part Order", receiveDate: "2026-05-14" },
  { ticketNo: "1007064721-10", repairStatus: "OP-Ready for Service", location: "Asheville", schedule: "05/19", wty: "IW", partId: "P1", partDist: "Marcone-162468", partNo: "140171068053", description: "PC BOARD,OVC RELAY -PUR", poNo: "1007064721-10-AV", poDate: "2026-05-11", orderNo: "73900963", invoiceNo: "73900963-1", partStatus: "Part Ready", note: "", unit: 77.33, core: 0, qty: 1, lot: "", symptom: "Customer reached and scheduled for 5/20.", action: "Part Order", receiveDate: "2026-05-15" },
  { ticketNo: "1007067554-10", repairStatus: "OP-Waiting for Part", location: "Asheville", schedule: "", wty: "IW", partId: "P1", partDist: "Marcone-162468", partNo: "5304539722", description: "COMPRESSOR", poNo: "1007067554-10-AV", poDate: "2026-05-13", orderNo: "73970124", invoiceNo: "", partStatus: "PO Made", note: "Electrolux 5304537774", unit: 102.3, core: 0, qty: 1, lot: "", symptom: "", action: "Part Order", receiveDate: "2026-05-15" },
  { ticketNo: "1007098724-10", repairStatus: "TR-Need PO", location: "Asheville", schedule: "", wty: "IW", partId: "P1", partDist: "Marcone-162468", partNo: "5304532919", description: "CONTROL BOARD,ASSEMBLY,LED POW", poNo: "(PO #)", poDate: "", orderNo: "", invoiceNo: "", partStatus: "Need PO", note: "", unit: 163.66, core: 0, qty: 1, lot: "", symptom: "", action: "Part Order", receiveDate: "2026-05-15" },
  { ticketNo: "1007129133-10", repairStatus: "OP-Waiting for Part", location: "Asheville", schedule: "", wty: "IW", partId: "P1", partDist: "Marcone-162468", partNo: "5304520495", description: "SWITCH,DOOR", poNo: "1007129133-10-AV", poDate: "2026-05-15", orderNo: "74044248", invoiceNo: "", partStatus: "PO Made", note: "", unit: 9.4, core: 0, qty: 1, lot: "", symptom: "", action: "Part Order", receiveDate: "2026-05-15" },
  { ticketNo: "26000609490DF", repairStatus: "OP-Waiting for Part", location: "Asheville", schedule: "", wty: "IW", partId: "P2", partDist: "Encompass", partNo: "EBR43511201", description: "PCB ASSEMBLY,MAIN", poNo: "26000609490DF-AV-2", poDate: "2026-05-15", orderNo: "6-63518", invoiceNo: "", partStatus: "PO Made", note: "", unit: 167.69, core: 0, qty: 1, lot: "", symptom: "", action: "Part Order", receiveDate: "2026-05-15" },
  { ticketNo: "26000611935DF", repairStatus: "OP-Waiting for Part", location: "Asheville", schedule: "", wty: "IW", partId: "P3", partDist: "OW", partNo: "WH22X38697", description: "MAIN CONTROL BOARD FL WASHER", poNo: "26000611935DF-AV", poDate: "2026-05-15", orderNo: "", invoiceNo: "", partStatus: "PO Made", note: "NO_TS ; GE WH22X36858", unit: 108.75, core: 0, qty: 1, lot: "", symptom: "", action: "Part Order", receiveDate: "2026-05-15" },
  { ticketNo: "26000632161DF", repairStatus: "OP-Waiting for Part", location: "Asheville", schedule: "05/20", wty: "IW", partId: "P1", partDist: "Encompass", partNo: "WP3387747", description: "DRYER HEATING ELEMENT", poNo: "26000632161DF-AV", poDate: "2026-05-14", orderNo: "1-93868", invoiceNo: "", partStatus: "PO Made", note: "", unit: 32.57, core: 0, qty: 1, lot: "", symptom: "Unit turns on but not heating.", action: "Part Order", receiveDate: "2026-05-14" },
  { ticketNo: "26000632974DF", repairStatus: "OP-Waiting for Part", location: "Asheville", schedule: "05/08", wty: "IW", partId: "P1", partDist: "OW", partNo: "W11047722", description: "SURFACE ELEMENT", poNo: "26000632974DF-AV", poDate: "2026-05-13", orderNo: "", invoiceNo: "", partStatus: "PO Made", note: "JS TS", unit: 58.22, core: 0, qty: 1, lot: "", symptom: "P2 Tracking Number 381292513024", action: "Part Order", receiveDate: "2026-05-15" },
  { ticketNo: "26000647179DF", repairStatus: "OP-Waiting for Part", location: "Asheville", schedule: "", wty: "IW", partId: "P1", partDist: "Encompass", partNo: "WH01X29528", description: "DOOR LOCK", poNo: "26000647179DF-AV", poDate: "2026-05-15", orderNo: "1-00398", invoiceNo: "", partStatus: "PO Made", note: "", unit: 33.76, core: 0, qty: 1, lot: "", symptom: "", action: "Part Order", receiveDate: "2026-05-15" },
  { ticketNo: "26000648670DF", repairStatus: "OP-Waiting for Part", location: "Asheville", schedule: "05/13", wty: "IW", partId: "P1", partDist: "Encompass", partNo: "WB07X47345", description: "OVERLAY", poNo: "26000648670DF-AV", poDate: "2026-05-15", orderNo: "1-00193", invoiceNo: "", partStatus: "PO Made", note: "", unit: 6.82, core: 0, qty: 1, lot: "", symptom: "Clock shuts off intermittently.", action: "Part Order", receiveDate: "2026-05-15" },
  { ticketNo: "26000650750DF", repairStatus: "PT-Need PreAuthorization", location: "Asheville", schedule: "", wty: "IW", partId: "P1", partDist: "Encompass", partNo: "ADJ74812516", description: "DUCT ASSEMBLY,MULTI", poNo: "(PO #)", poDate: "", orderNo: "", invoiceNo: "", partStatus: "Need PO", note: "", unit: 178.27, core: 0, qty: 1, lot: "", symptom: "", action: "Part Order", receiveDate: "2026-05-15" },
  { ticketNo: "26000652384DF", repairStatus: "CL-Parts Back Ordered", location: "Asheville", schedule: "", wty: "IW", partId: "P1", partDist: "Encompass", partNo: "17431000030843", description: "WIRES, HARNESS", poNo: "26000652384DF-AV", poDate: "2026-05-15", orderNo: "", invoiceNo: "", partStatus: "Cancelled", note: "low in stock, order goes to BO", unit: 13.83, core: 0, qty: 1, lot: "", symptom: "", action: "Part Order", receiveDate: "2026-05-15" },
  { ticketNo: "726901", repairStatus: "PT-Need PreAuthorization", location: "Asheville", schedule: "", wty: "IW", partId: "P1", partDist: "SP", partNo: "6113310100", description: "K76_ICE_MACHINE_ASSY_SILICONE", poNo: "(PO #)", poDate: "", orderNo: "", invoiceNo: "", partStatus: "Need PO", note: "", unit: 77.96, core: 0, qty: 1, lot: "", symptom: "", action: "Part Order", receiveDate: "2026-05-15" },
  { ticketNo: "HSV20260433501379", repairStatus: "PT-Need PreAuthorization", location: "Asheville", schedule: "", wty: "IW", partId: "P1", partDist: "Encompass", partNo: "218976409", description: "TUBE,WATER,60\",NATURAL,DOOR", poNo: "(PO #)", poDate: "", orderNo: "", invoiceNo: "", partStatus: "Need PO", note: "", unit: 29.23, core: 0, qty: 1, lot: "", symptom: "Waiting for cx approval for OOW fees.", action: "Part Order", receiveDate: "2026-05-14" },
  { ticketNo: "HSV20260433579870", repairStatus: "OP-Waiting for Part", location: "Asheville", schedule: "", wty: "IW", partId: "P1", partDist: "Encompass", partNo: "242193212", description: "GASKET-REFR DOOR,BLACK,MAGNETI", poNo: "HSV20260433579870-AV", poDate: "2026-05-06", orderNo: "1-66290", invoiceNo: "1-309600-0526-1", partStatus: "Part Ready", note: "", unit: 87.45, core: 0, qty: 1, lot: "", symptom: "", action: "Part Order", receiveDate: "2026-05-14" },
];

function formatMoney(value: number) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

function loadRows() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed as ManagementRow[];
    } catch {
      // fall through to seeded rows
    }
  }

  const rows: ManagementRow[] = [];
  for (let index = 0; rows.length < 84; index += 1) {
    const seed = BASE_ROWS[index % BASE_ROWS.length];
    rows.push({ ...seed });
  }
  return rows;
}

function defaultFilterOptions(rows: ManagementRow[]) {
  const repairValues = [...new Set([...REQUIRED_REPAIR_STATUSES, ...rows.map((row) => row.repairStatus).filter(Boolean)])];
  const partValues = [...new Set([...REQUIRED_PART_STATUSES, ...rows.map((row) => row.partStatus).filter(Boolean)])];
  return { repairValues, partValues };
}

export function PartManagementPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [rows, setRows] = useState<ManagementRow[]>([]);
  const [locationFilter, setLocationFilter] = useState("Asheville");
  const [repairStatusFilter, setRepairStatusFilter] = useState("");
  const [partStatusFilter, setPartStatusFilter] = useState("");
  const [ticketFilter, setTicketFilter] = useState("");
  const [fromDate, setFromDate] = useState("2026-05-14");
  const [toDate, setToDate] = useState("2026-05-15");
  const [resultSearch, setResultSearch] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);

  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const floatingBarRef = useRef<HTMLDivElement | null>(null);
  const floatingInnerRef = useRef<HTMLDivElement | null>(null);
  const syncFromFloatingRef = useRef(false);
  const syncFromTableRef = useRef(false);

  useEffect(() => {
    setRows(loadRows());
  }, []);

  const { repairValues, partValues } = useMemo(() => defaultFilterOptions(rows), [rows]);

  const filteredRows = useMemo(() => {
    const location = locationFilter.trim();
    const repair = repairStatusFilter.trim();
    const part = partStatusFilter.trim();
    const ticket = ticketFilter.trim().toLowerCase();
    const search = resultSearch.trim().toLowerCase();

    return rows.filter((row) => {
      if (location && row.location !== location) return false;
      if (repair && row.repairStatus !== repair) return false;
      if (part && row.partStatus !== part) return false;
      if (ticket && !String(row.ticketNo || "").toLowerCase().includes(ticket)) return false;
      if (fromDate && row.receiveDate < fromDate) return false;
      if (toDate && row.receiveDate > toDate) return false;
      if (search) {
        const blob = [row.ticketNo, row.repairStatus, row.location, row.schedule, row.wty, row.partId, row.partDist, row.partNo, row.description, row.poNo, row.poDate, row.orderNo, row.invoiceNo, row.partStatus, row.note, row.symptom].join(" ").toLowerCase();
        if (!blob.includes(search)) return false;
      }
      return true;
    });
  }, [fromDate, locationFilter, partStatusFilter, repairStatusFilter, resultSearch, rows, ticketFilter, toDate]);

  const recordCount = filteredRows.length;

  const updateRowField = (rowIndex: number, field: keyof ManagementRow, nextValue: string) => {
    setRows((current) => {
      if (rowIndex < 0 || rowIndex >= current.length) return current;
      const nextRows = current.map((row, index) => {
        if (index !== rowIndex) return row;
        if (field === "unit") return { ...row, unit: Number.parseFloat(nextValue) || 0 };
        if (field === "core" || field === "qty") return { ...row, [field]: Number.parseInt(nextValue, 10) || 0 } as ManagementRow;
        return { ...row, [field]: nextValue } as ManagementRow;
      });
      return nextRows;
    });
  };

  const handleSave = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  };

  const handleRefresh = () => {
    setRefreshTick((value) => value + 1);
  };

  const syncScrollbar = () => {
    const tableWrap = tableWrapRef.current;
    const floatingBar = floatingBarRef.current;
    const floatingInner = floatingInnerRef.current;
    if (!tableWrap || !floatingBar || !floatingInner) return;
    const table = tableWrap.querySelector(".po-table") as HTMLTableElement | null;
    if (!table) return;
    floatingInner.style.width = `${table.scrollWidth}px`;
    const rect = tableWrap.getBoundingClientRect();
    floatingBar.style.width = `${Math.max(0, Math.floor(rect.width))}px`;
    floatingBar.style.left = `${Math.max(0, Math.floor(rect.left))}px`;
    floatingBar.style.bottom = "0px";
  };

  const updateScrollbarVisibility = () => {
    const tableWrap = tableWrapRef.current;
    const floatingBar = floatingBarRef.current;
    if (!tableWrap || !floatingBar) return;
    const hasHorizontalOverflow = tableWrap.scrollWidth > tableWrap.clientWidth + 1;
    const rect = tableWrap.getBoundingClientRect();
    const viewportBottom = window.innerHeight;
    const scrollbarInViewport = rect.bottom <= viewportBottom && rect.bottom >= 0;
    const tableIntersectsViewport = rect.top < viewportBottom && rect.bottom > 0;
    const shouldShow = hasHorizontalOverflow && tableIntersectsViewport && !scrollbarInViewport;
    floatingBar.classList.toggle("is-visible", shouldShow);
    if (shouldShow) {
      syncScrollbar();
      floatingBar.scrollLeft = tableWrap.scrollLeft;
    }
  };

  useEffect(() => {
    const tableWrap = tableWrapRef.current;
    const floatingBar = floatingBarRef.current;
    if (!tableWrap || !floatingBar) return;

    if (floatingBar.parentElement !== document.body) {
      document.body.appendChild(floatingBar);
    }

    const onFloatingScroll = () => {
      if (syncFromTableRef.current) {
        syncFromTableRef.current = false;
        return;
      }
      syncFromFloatingRef.current = true;
      tableWrap.scrollLeft = floatingBar.scrollLeft;
    };

    const onTableScroll = () => {
      if (syncFromFloatingRef.current) {
        syncFromFloatingRef.current = false;
        return;
      }
      syncFromTableRef.current = true;
      floatingBar.scrollLeft = tableWrap.scrollLeft;
      updateScrollbarVisibility();
    };

    const onResize = () => {
      syncScrollbar();
      updateScrollbarVisibility();
    };

    const onWindowScroll = () => updateScrollbarVisibility();

    floatingBar.addEventListener("scroll", onFloatingScroll);
    tableWrap.addEventListener("scroll", onTableScroll);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onWindowScroll, { passive: true });

    const rafA = window.requestAnimationFrame(() => {
      const rafB = window.requestAnimationFrame(() => {
        syncScrollbar();
        updateScrollbarVisibility();
      });
      return () => window.cancelAnimationFrame(rafB);
    });

    return () => {
      window.cancelAnimationFrame(rafA);
      floatingBar.removeEventListener("scroll", onFloatingScroll);
      tableWrap.removeEventListener("scroll", onTableScroll);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onWindowScroll);
    };
  }, [refreshTick, rows]);

  useEffect(() => {
    syncScrollbar();
    updateScrollbarVisibility();
  }, [filteredRows.length, rows.length, refreshTick]);

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <style>{`
          .management-panel {
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 12px;
            padding: 1.25rem;
            margin-bottom: 1.5rem;
            backdrop-filter: blur(10px);
            color: #fff;
          }
          .controls-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(160px, 1fr));
            gap: 0.75rem;
            margin-bottom: 0.75rem;
          }
          .field {
            display: flex;
            flex-direction: column;
            gap: 0.3rem;
          }
          .field label {
            font-size: 0.78rem;
            font-weight: 700;
            color: #e5e7eb;
          }
          .field input,
          .field select {
            height: 34px;
            padding: 0.35rem 0.5rem;
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 6px;
            font-size: 0.8rem;
            color: #fff;
            background: rgba(17, 24, 39, 0.95);
          }
          .controls-row {
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            gap: 0.75rem;
            flex-wrap: wrap;
          }
          .left-controls,
          .right-controls {
            display: flex;
            gap: 0.6rem;
            align-items: flex-end;
            flex-wrap: wrap;
          }
          .date-range {
            display: flex;
            align-items: center;
            gap: 0.45rem;
          }
          .btn {
            height: 34px;
            padding: 0 0.85rem;
            border: 1px solid rgba(255, 255, 255, 0.25);
            border-radius: 6px;
            background: rgba(17, 24, 39, 0.95);
            color: #fff;
            font-size: 0.78rem;
            font-weight: 600;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 0.35rem;
            text-decoration: none;
          }
          .btn.primary {
            background: #1d4ed8;
            border-color: #1d4ed8;
            color: #fff;
          }
          .meta-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 0.75rem;
            margin-bottom: 0.7rem;
            flex-wrap: wrap;
          }
          .result-info {
            font-size: 0.8rem;
            font-weight: 700;
            color: #bfdbfe;
          }
          .search-input {
            width: 260px;
            height: 34px;
            padding: 0.35rem 0.5rem;
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 6px;
            font-size: 0.8rem;
            color: #fff;
            background: rgba(17, 24, 39, 0.95);
          }
          .table-wrap {
            overflow: auto;
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 10px;
            background: #fff;
          }
          .floating-table-scrollbar {
            position: fixed;
            left: 0;
            bottom: 0;
            z-index: 1100;
            overflow-x: auto;
            overflow-y: hidden;
            border: 1px solid rgba(148, 163, 184, 0.5);
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.92);
            box-shadow: 0 10px 24px rgba(15, 23, 42, 0.18);
            display: none;
            max-width: 100vw;
          }
          .floating-table-scrollbar.is-visible { display: block; }
          .floating-table-scrollbar-inner { height: 1px; }
          table.po-table {
            width: 100%;
            min-width: 2650px;
            border-collapse: collapse;
            font-size: 0.74rem;
            color: #111827;
          }
          .po-table th,
          .po-table td {
            border: 1px solid #d1d5db;
            padding: 0.4rem;
            white-space: nowrap;
            vertical-align: top;
          }
          .po-table th {
            background: #1f2937;
            color: #f8fafc;
            text-align: left;
            position: sticky;
            top: 0;
            z-index: 1;
          }
          .po-table tbody tr:nth-child(even) {
            background: #f9fafb;
          }
          .money,
          .qty {
            text-align: right;
          }
          .ticket-link {
            color: #1e3a8a;
            text-decoration: none;
            font-weight: 700;
          }
          .ticket-link:hover {
            text-decoration: underline;
          }
          .action-btn {
            height: 28px;
            padding: 0 0.55rem;
            border: 1px solid #1d4ed8;
            background: #eff6ff;
            color: #1d4ed8;
            border-radius: 5px;
            font-size: 0.72rem;
            font-weight: 700;
            cursor: pointer;
          }
          .table-input,
          .table-select {
            width: 100%;
            padding: 0.25rem 0.35rem;
            border: 1px solid #cbd5e1;
            border-radius: 4px;
            font-size: 0.74rem;
            box-sizing: border-box;
          }
          .table-input {
            color: #111827;
            background: #fff;
          }
          .table-input.money {
            text-align: right;
          }
          .table-select {
            color: #111827;
            background: #fff;
          }
          .footer-copy {
            margin-top: 1rem;
            opacity: 0.7;
          }
          .no-records {
            text-align: center;
            color: #64748b;
            padding: 1rem;
          }
          @media (max-width: 1100px) {
            .controls-grid {
              grid-template-columns: repeat(2, minmax(160px, 1fr));
            }
          }
          @media (max-width: 700px) {
            .controls-grid {
              grid-template-columns: 1fr;
            }

            .search-input {
              width: 100%;
            }
          }
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

        <div className="management-panel">
          <div className="controls-grid">
            <div className="field">
              <label htmlFor="locationFilter">Location*</label>
              <select id="locationFilter" value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}>
                <option value="Asheville">Asheville</option>
                <option value="Birmingham">Birmingham</option>
                <option value="Atlanta">Atlanta</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="repairStatusFilter">Repair Status</label>
              <select id="repairStatusFilter" value={repairStatusFilter} onChange={(event) => setRepairStatusFilter(event.target.value)}>
                <option value="">All</option>
                {repairValues.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="partStatusFilter">Part Status</label>
              <select id="partStatusFilter" value={partStatusFilter} onChange={(event) => setPartStatusFilter(event.target.value)}>
                <option value="">All</option>
                {partValues.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ticketFilter">Ticket #</label>
              <input id="ticketFilter" type="text" placeholder="Ticket #" value={ticketFilter} onChange={(event) => setTicketFilter(event.target.value)} />
            </div>
          </div>

          <div className="controls-row">
            <div className="left-controls">
              <div className="field">
                <label htmlFor="fromDate">Receive Date</label>
                <div className="date-range">
                  <input id="fromDate" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
                  <span>~</span>
                  <input id="toDate" type="date" title="Receive date to" aria-label="Receive date to" value={toDate} onChange={(event) => setToDate(event.target.value)} />
                </div>
              </div>
            </div>
            <div className="right-controls">
              <button id="refreshBtn" type="button" className="btn" onClick={handleRefresh}>Refresh</button>
              <button id="saveBtn" type="button" className="btn primary" onClick={handleSave}>Save</button>
            </div>
          </div>
        </div>

        <div className="management-panel">
          <div className="meta-row">
            <div id="recordInfo" className="result-info">{recordCount} records found</div>
            <input id="resultSearch" className="search-input" type="text" placeholder="search in result" value={resultSearch} onChange={(event) => setResultSearch(event.target.value)} />
          </div>

          <div id="partManagementTableWrap" className="table-wrap" ref={tableWrapRef}>
            <table className="po-table">
              <thead>
                <tr>
                  <th>Ticket #</th>
                  <th>Repair Status</th>
                  <th>Location</th>
                  <th>Schedule</th>
                  <th>Wty</th>
                  <th>P. ID</th>
                  <th>Part Dist.*</th>
                  <th>Part No*</th>
                  <th>Description</th>
                  <th>PO #</th>
                  <th>P/O Date</th>
                  <th>Order#</th>
                  <th>Invoice#</th>
                  <th>Part Status</th>
                  <th>Note</th>
                  <th>Unit $*</th>
                  <th>Core $</th>
                  <th>Qty</th>
                  <th>Lot</th>
                  <th>Symptom</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="poBody">
                {filteredRows.length === 0 ? (
                  <tr><td colSpan={21} className="no-records">No records found.</td></tr>
                ) : (
                  filteredRows.map((row, filteredIndex) => {
                    const rowIndex = rows.findIndex((candidate) => candidate.ticketNo === row.ticketNo && candidate.partNo === row.partNo && candidate.poNo === row.poNo && candidate.receiveDate === row.receiveDate && candidate.partId === row.partId && candidate.description === row.description);
                    const resolvedIndex = rowIndex >= 0 ? rowIndex : filteredIndex;
                    return (
                      <tr key={`${row.ticketNo}-${row.partNo}-${resolvedIndex}`}>
                        <td><Link className="ticket-link" to="/ticket/$ticketNo" params={{ ticketNo: row.ticketNo }} target="_blank" rel="noreferrer">{row.ticketNo || ""}</Link></td>
                        <td>
                          <select className="table-select" title="Repair status" aria-label="Repair status" value={row.repairStatus} onChange={(event) => updateRowField(resolvedIndex, "repairStatus", event.target.value)}>
                            {repairValues.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        </td>
                        <td>{row.location || ""}</td>
                        <td>{row.schedule || ""}</td>
                        <td>{row.wty || ""}</td>
                        <td>{row.partId || ""}</td>
                        <td>
                          <select className="table-select" title="Part distributor" aria-label="Part distributor" value={row.partDist} onChange={(event) => updateRowField(resolvedIndex, "partDist", event.target.value)}>
                            <option value=""></option>
                            {PART_DIST_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        </td>
                        <td><input type="text" className="table-input" title="Part number" aria-label="Part number" value={row.partNo || ""} onChange={(event) => updateRowField(resolvedIndex, "partNo", event.target.value)} /></td>
                        <td>{row.description || ""}</td>
                        <td><input type="text" className="table-input" title="Purchase order number" aria-label="Purchase order number" value={row.poNo || ""} onChange={(event) => updateRowField(resolvedIndex, "poNo", event.target.value)} /></td>
                        <td><input type="date" className="table-input" title="P/O date" aria-label="P/O date" value={row.poDate && /^\d{4}-\d{2}-\d{2}$/.test(row.poDate) ? row.poDate : ""} onChange={(event) => updateRowField(resolvedIndex, "poDate", event.target.value)} /></td>
                        <td><input type="text" className="table-input" title="Order number" aria-label="Order number" value={row.orderNo || ""} onChange={(event) => updateRowField(resolvedIndex, "orderNo", event.target.value)} /></td>
                        <td><input type="text" className="table-input" title="Invoice number" aria-label="Invoice number" value={row.invoiceNo || ""} onChange={(event) => updateRowField(resolvedIndex, "invoiceNo", event.target.value)} /></td>
                        <td>
                          <select className="table-select" title="Part status" aria-label="Part status" value={row.partStatus} onChange={(event) => updateRowField(resolvedIndex, "partStatus", event.target.value)}>
                            {partValues.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        </td>
                        <td><input type="text" className="table-input" title="Note" aria-label="Note" value={row.note || ""} onChange={(event) => updateRowField(resolvedIndex, "note", event.target.value)} /></td>
                        <td><input type="number" className="table-input money" title="Unit price" aria-label="Unit price" value={row.unit || 0} step="0.01" onChange={(event) => updateRowField(resolvedIndex, "unit", event.target.value)} /></td>
                        <td className="money">{formatMoney(row.core)}</td>
                        <td className="qty">{row.qty || 0}</td>
                        <td>
                          <select className="table-select" title="Lot" aria-label="Lot" value={row.lot || ""} onChange={(event) => updateRowField(resolvedIndex, "lot", event.target.value)}>
                            <option value=""></option>
                            {LOT_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        </td>
                        <td>{row.symptom || ""}</td>
                        <td><button type="button" className="action-btn">{row.action || "Part Order"}</button></td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div id="partManagementFloatingScrollbar" className="floating-table-scrollbar" aria-hidden="true" ref={floatingBarRef}>
            <div id="partManagementFloatingScrollbarInner" className="floating-table-scrollbar-inner" ref={floatingInnerRef} />
          </div>
        </div>
      </main>

      <footer id="contact" className="px-6 pb-8 text-sm text-slate-300">
        <p>For any questions or support, contact us at <a href="mailto:support@adminhubsolutions.com" className="underline">support@adminhubsolutions.com</a></p>
        <p className="footer-copy">&copy; 2026 Admin Hub Solutions. All rights reserved.</p>
      </footer>
    </div>
  );
}