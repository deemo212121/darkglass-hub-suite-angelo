import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

type ReturnRow = {
  raNo: string;
  poNo: string;
  uniqueId: string;
  partNo: string;
  description: string;
  returnType: string;
  returnReason: string;
  status: string;
  returnDate: string;
  returnedBy: string;
  qty: number;
  unitPrice: number;
  coreValue: number;
  returnLabel: string;
  location: string;
  vendor: string;
  account: string;
};

type PartInfoRow = { leftLabel: string; leftValue: string; rightLabel: string; rightValue: string };
type PartInfoAvailability = { id: string; name: string; qty: number };
type PartInfoData = { rows: PartInfoRow[]; availability: PartInfoAvailability[] };

const STORAGE_KEY = "partReturnStatusData";
const TAB_KEY = "partReturnStatusTab";

const REGULAR_DEFAULT: ReturnRow[] = [
  { raNo: "1-66384", poNo: "3846784E1-ATL-1", uniqueId: "1-304196-0526-2", partNo: "WH01X24180", description: "DRIVE BELT", returnType: "RETURN", returnReason: "", status: "NOT RECEIVED", returnDate: "2026-05-08", returnedBy: "Calvin Nguyen", qty: 1, unitPrice: 10.9, coreValue: 0, returnLabel: "", location: "Atlanta", vendor: "Encompass", account: "SB" },
  { raNo: "1-67075", poNo: "SA-3268869-ATL-1", uniqueId: "1-304225-0526-1", partNo: "WR60X10307", description: "MOTOR DC EVAP FAN ASM", returnType: "RETURN", returnReason: "", status: "NOT RECEIVED", returnDate: "2026-05-08", returnedBy: "Calvin Nguyen", qty: 1, unitPrice: 105.95, coreValue: 0, returnLabel: "", location: "Atlanta", vendor: "Encompass", account: "Midea-104268" },
  { raNo: "1-67076", poNo: "SA-3268869-ATL-1", uniqueId: "1-304225-0526-2", partNo: "WR60X30922", description: "EVAPORATOR FAN BLADE", returnType: "RETURN", returnReason: "", status: "NOT RECEIVED", returnDate: "2026-05-08", returnedBy: "Calvin Nguyen", qty: 1, unitPrice: 50.25, coreValue: 0, returnLabel: "", location: "Atlanta", vendor: "Encompass", account: "SB-Miele" },
  { raNo: "1-74783", poNo: "SA-2998427-ATL", uniqueId: "1-219418-0426-1", partNo: "WD22X33499", description: "LOWER SPRAY ARM", returnType: "RETURN", returnReason: "", status: "NOT RECEIVED", returnDate: "2026-05-11", returnedBy: "Calvin Nguyen", qty: 1, unitPrice: 12.28, coreValue: 0, returnLabel: "", location: "Atlanta", vendor: "Encompass", account: "M2-162468" },
  { raNo: "1-74784", poNo: "SA-2998427-ATL", uniqueId: "1-219418-0426-2", partNo: "WD05X35098", description: "HEATING ELEMENT", returnType: "RETURN", returnReason: "", status: "NOT RECEIVED", returnDate: "2026-05-11", returnedBy: "Calvin Nguyen", qty: 1, unitPrice: 19.82, coreValue: 0, returnLabel: "", location: "Atlanta", vendor: "Encompass", account: "MCN-162468" },
  { raNo: "1-75075", poNo: "SA-3213002-ATL", uniqueId: "1-293399-0526-2", partNo: "WR55X46805", description: "MAIN CONTROL BOARD", returnType: "RETURN", returnReason: "", status: "NOT RECEIVED", returnDate: "2026-05-11", returnedBy: "Calvin Nguyen", qty: 1, unitPrice: 179.99, coreValue: 0, returnLabel: "", location: "Atlanta", vendor: "Encompass", account: "LG" },
  { raNo: "1-75076", poNo: "SA-3213002-ATL", uniqueId: "1-293399-0526-3", partNo: "WR02X13684", description: "FILTER MANIFOLD", returnType: "RETURN", returnReason: "", status: "NOT RECEIVED", returnDate: "2026-05-11", returnedBy: "Calvin Nguyen", qty: 1, unitPrice: 30.65, coreValue: 0, returnLabel: "", location: "Atlanta", vendor: "Encompass", account: "SS" },
  { raNo: "1-75251", poNo: "4044292471BL-ATL", uniqueId: "1-279226-0526-1", partNo: "5304530853", description: "MULLION ASSEMBLY,FLIPPER,GRAY", returnType: "RETURN", returnReason: "", status: "NOT RECEIVED", returnDate: "2026-05-11", returnedBy: "Calvin Nguyen", qty: 1, unitPrice: 57.89, coreValue: 0, returnLabel: "", location: "Atlanta", vendor: "Encompass", account: "SP" },
  { raNo: "1-75633", poNo: "SA-3064113-ATL", uniqueId: "27-070576-0526-1", partNo: "WB28X28781", description: "IGNITER GLOWBAR", returnType: "RETURN", returnReason: "", status: "NOT RECEIVED", returnDate: "2026-05-11", returnedBy: "Calvin Nguyen", qty: 1, unitPrice: 54.07, coreValue: 0, returnLabel: "", location: "Atlanta", vendor: "Encompass", account: "NSA GSLEE" },
  { raNo: "1-75643", poNo: "SA-3223622-ATL", uniqueId: "1-288579-0526-4", partNo: "WB26X25118", description: "MOTOR PSC CONV", returnType: "RETURN", returnReason: "", status: "NOT RECEIVED", returnDate: "2026-05-11", returnedBy: "Calvin Nguyen", qty: 1, unitPrice: 86.42, coreValue: 0, returnLabel: "", location: "Atlanta", vendor: "Encompass", account: "NSA MEMPHIS" },
  { raNo: "1-75738", poNo: "SA-3064113-ATL", uniqueId: "1-280669-0526-1", partNo: "WB13X25633", description: "OVEN IGNITOR", returnType: "RETURN", returnReason: "", status: "NOT RECEIVED", returnDate: "2026-05-11", returnedBy: "Calvin Nguyen", qty: 1, unitPrice: 59.74, coreValue: 0, returnLabel: "", location: "Atlanta", vendor: "Encompass", account: "SP1" },
  { raNo: "1-75754", poNo: "SA-3223622-ATL", uniqueId: "1-288579-0526-3", partNo: "WB20T10024", description: "PROBE THERMISTOR", returnType: "RETURN", returnReason: "", status: "NOT RECEIVED", returnDate: "2026-05-11", returnedBy: "Calvin Nguyen", qty: 1, unitPrice: 34.63, coreValue: 0, returnLabel: "", location: "Atlanta", vendor: "Encompass", account: "encompass" },
  { raNo: "1-80720", poNo: "SA-3309888-ATL", uniqueId: "1-304594-0526-1", partNo: "WH08X37859", description: "LID LOCK & HARNESS", returnType: "RETURN", returnReason: "", status: "NOT RECEIVED", returnDate: "2026-05-12", returnedBy: "Calvin Nguyen", qty: 1, unitPrice: 59.99, coreValue: 0, returnLabel: "", location: "Atlanta", vendor: "Encompass", account: "Encompass-Birmingham" },
  { raNo: "1-80723", poNo: "SA-3309888-ATL", uniqueId: "1-304594-0526-2", partNo: "WH01X37858", description: "LID LOCK STRIKER", returnType: "RETURN", returnReason: "", status: "NOT RECEIVED", returnDate: "2026-05-12", returnedBy: "Calvin Nguyen", qty: 1, unitPrice: 11.61, coreValue: 0, returnLabel: "", location: "Atlanta", vendor: "Encompass", account: "SB-1276506820" },
  { raNo: "1-80893", poNo: "SA-3323058-ATL-1", uniqueId: "1-316467-0526-1", partNo: "WR57X26303", description: "VALVE & GUARD ASM", returnType: "RETURN", returnReason: "", status: "NOT RECEIVED", returnDate: "2026-05-12", returnedBy: "Calvin Nguyen", qty: 1, unitPrice: 71.51, coreValue: 0, returnLabel: "", location: "Atlanta", vendor: "Encompass", account: "MCN-162468bp" },
  { raNo: "1-80896", poNo: "SA-3323058-ATL-1", uniqueId: "1-316467-0526-2", partNo: "WR57X25054", description: "WATER VALVE", returnType: "RETURN", returnReason: "", status: "NOT RECEIVED", returnDate: "2026-05-12", returnedBy: "Calvin Nguyen", qty: 1, unitPrice: 94.58, coreValue: 0, returnLabel: "", location: "Atlanta", vendor: "Encompass", account: "SS-6488757" },
  { raNo: "1-80955", poNo: "SA-3178355-ATL", uniqueId: "1-297866-0526-1", partNo: "WH22X37840", description: "MAIN CONTROL BOARD", returnType: "RETURN", returnReason: "", status: "NOT RECEIVED", returnDate: "2026-05-12", returnedBy: "Calvin Nguyen", qty: 1, unitPrice: 123.99, coreValue: 0, returnLabel: "", location: "Atlanta", vendor: "Encompass", account: "SB" },
  { raNo: "1-80979", poNo: "SA-2831637-ATL-3", uniqueId: "1-280670-0526-1", partNo: "WE04X25280", description: "TIMER", returnType: "RETURN", returnReason: "", status: "NOT RECEIVED", returnDate: "2026-05-12", returnedBy: "Calvin Nguyen", qty: 1, unitPrice: 62.47, coreValue: 0, returnLabel: "", location: "Atlanta", vendor: "Encompass", account: "Midea-104268" },
  { raNo: "1-99391", poNo: "26000304417DF-ATL-1", uniqueId: "1-918675-0326-1", partNo: "DC47-00015A", description: "THERMOSTAT", returnType: "RETURN", returnReason: "", status: "NOT RECEIVED", returnDate: "2026-05-15", returnedBy: "Calvin Nguyen", qty: 1, unitPrice: 17.89, coreValue: 0, returnLabel: "", location: "Atlanta", vendor: "Encompass", account: "LG" },
  { raNo: "1-99398", poNo: "26000304417DF-ATL-1", uniqueId: "1-918675-0326-2", partNo: "DC47-00016A", description: "THERMOSTAT", returnType: "RETURN", returnReason: "", status: "NOT RECEIVED", returnDate: "2026-05-15", returnedBy: "Calvin Nguyen", qty: 1, unitPrice: 9.21, coreValue: 0, returnLabel: "", location: "Atlanta", vendor: "Encompass", account: "SS" },
  { raNo: "1-99410", poNo: "26000304417DF-ATL-1", uniqueId: "1-918675-0326-3", partNo: "DC32-00007A", description: "THERMISTOR", returnType: "RETURN", returnReason: "", status: "NOT RECEIVED", returnDate: "2026-05-15", returnedBy: "Calvin Nguyen", qty: 1, unitPrice: 14.06, coreValue: 0, returnLabel: "", location: "Atlanta", vendor: "Encompass", account: "SP" },
  { raNo: "1-99417", poNo: "26000304417DF-ATL-1", uniqueId: "1-918675-0326-4", partNo: "6602-001655", description: "BELT-TIMING GEAR", returnType: "RETURN", returnReason: "", status: "NOT RECEIVED", returnDate: "2026-05-15", returnedBy: "Calvin Nguyen", qty: 1, unitPrice: 27.22, coreValue: 0, returnLabel: "", location: "Atlanta", vendor: "Encompass", account: "encompass" },
  { raNo: "25-04840", poNo: "SA-3064113-ATL", uniqueId: "25-163412-0526-1", partNo: "WB28X37607", description: "KIT LP CONVERSION ASM", returnType: "RETURN", returnReason: "", status: "NOT RECEIVED", returnDate: "2026-05-11", returnedBy: "Calvin Nguyen", qty: 1, unitPrice: 14.02, coreValue: 0, returnLabel: "", location: "Atlanta", vendor: "Encompass", account: "Encompass-Birmingham" },
];

const CORE_DEFAULT: ReturnRow[] = [
  { raNo: "10-87898", poNo: "26000611691DF-ATL", uniqueId: "1-300469-0526-2", partNo: "W11629911", description: "ACU FINAL ASSEMBLY - KDTM404K*1 2021 DASH", returnType: "CORE RETURN", returnReason: "", status: "CORE RETURN", returnDate: "2026-05-11", returnedBy: "", qty: 1, unitPrice: 0, coreValue: 60, returnLabel: "", location: "Atlanta", vendor: "Encompass", account: "SB" },
  { raNo: "10-88672", poNo: "26000631296DF-ATL-1", uniqueId: "1-327763-0526-1", partNo: "W11608056", description: "CONTROL BOARD WTW4950HW3 WTW4955HW3", returnType: "CORE RETURN", returnReason: "", status: "CORE RETURN", returnDate: "2026-05-14", returnedBy: "", qty: 1, unitPrice: 0, coreValue: 60, returnLabel: "", location: "Atlanta", vendor: "Encompass", account: "Midea-104268" },
];

const PART_INFO_BY_PART: Record<string, PartInfoData> = {
  DEFAULT: {
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
      { id: "7910", name: "APPLIANCE DENVER", qty: 76 },
      { id: "1010", name: "BYRON CENTER", qty: 73 },
      { id: "601", name: "DENTON", qty: 51 },
      { id: "5300", name: "JACKSONVILLE", qty: 41 },
      { id: "7930", name: "VANCOUVER WA", qty: 39 },
      { id: "401", name: "PEORIA", qty: 36 },
      { id: "201", name: "APPLIANCE LENEXA", qty: 0 },
      { id: "302", name: "LOUISVILLE 2", qty: 0 },
      { id: "1280", name: "GLEN MILLS", qty: 0 },
    ],
  },
  WE04X25194: {
    rows: [
      { leftLabel: "Make", leftValue: "GEH", rightLabel: "Part #", rightValue: "" },
      { leftLabel: "Price", leftValue: "13.18", rightLabel: "Dealer Price", rightValue: "19.46" },
      { leftLabel: "Retail Price", leftValue: "0", rightLabel: "List Price", rightValue: "31.86" },
      { leftLabel: "Core Price", leftValue: "", rightLabel: "Core?", rightValue: "" },
      { leftLabel: "Description", leftValue: "DRYER THERMOSTAT", rightLabel: "Discontinue?", rightValue: "false" },
      { leftLabel: "Drop Shop only?", leftValue: "", rightLabel: "Hazmat?", rightValue: "" },
      { leftLabel: "Refrigerant?", leftValue: "false", rightLabel: "Oversize?", rightValue: "false" },
    ],
    availability: [
      { id: "1230", name: "CHARLOTTE", qty: 39 },
      { id: "7930", name: "VANCOUVER WA", qty: 29 },
      { id: "1010", name: "BYRON CENTER", qty: 20 },
      { id: "1260", name: "ALBANY", qty: 11 },
      { id: "201", name: "APPLIANCE LENEXA", qty: 9 },
      { id: "301", name: "LOUISVILLE", qty: 9 },
      { id: "7200", name: "FRESNO", qty: 9 },
      { id: "7910", name: "APPLIANCE DENVER", qty: 6 },
      { id: "401", name: "PEORIA", qty: 1 },
      { id: "601", name: "DENTON", qty: 1 },
      { id: "302", name: "LOUISVILLE 2", qty: 0 },
      { id: "1280", name: "GLEN MILLS", qty: 0 },
      { id: "5300", name: "JACKSONVILLE", qty: 0 },
    ],
  },
};

const REGULAR_STATUS_OPTIONS = ["NOT RECEIVED", "RECEIVED", "PROCESSED", "DISPUTED"];
const CORE_STATUS_OPTIONS = ["NOT RECEIVED", "CORE RETURN", "RECEIVED", "PROCESSED", "DISPUTED"];

const emptyPartInfo = PART_INFO_BY_PART.DEFAULT;

function formatMoney(value: number | string) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num.toFixed(2) : "0.00";
}

function formatDate(value: string) {
  return value || "";
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    return { regular: REGULAR_DEFAULT, core: CORE_DEFAULT };
  }
  try {
    const parsed = JSON.parse(saved);
    return {
      regular: Array.isArray(parsed?.regular) ? parsed.regular : REGULAR_DEFAULT,
      core: Array.isArray(parsed?.core) ? parsed.core : CORE_DEFAULT,
    };
  } catch {
    return { regular: REGULAR_DEFAULT, core: CORE_DEFAULT };
  }
}

function saveState(regular: ReturnRow[], core: ReturnRow[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ regular, core }));
}

export function PartReturnStatusPage() {
  const initial = loadState();
  const [activeView, setActiveView] = useState<"regular" | "core">(() => {
    const saved = localStorage.getItem(TAB_KEY);
    return saved === "core" ? "core" : "regular";
  });
  const [regularReturnData, setRegularReturnData] = useState<ReturnRow[]>(initial.regular);
  const [coreReturnData, setCoreReturnData] = useState<ReturnRow[]>(initial.core);
  const [locationFilter, setLocationFilter] = useState("");
  const [vendorFilter, setVendorFilter] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [shipToFilter, setShipToFilter] = useState("");
  const [fromDate, setFromDate] = useState("2026-05-08");
  const [toDate, setToDate] = useState("2026-05-15");
  const [raFilter, setRaFilter] = useState("");
  const [uniqueIdFilter, setUniqueIdFilter] = useState("");
  const [resultSearch, setResultSearch] = useState("");
  const [coreResultSearch, setCoreResultSearch] = useState("");
  const [modalPartNo, setModalPartNo] = useState("");
  const [modalTab, setModalTab] = useState<"encompass" | "marcone">("marcone");

  const regularTableWrapRef = useRef<HTMLDivElement | null>(null);
  const coreTableWrapRef = useRef<HTMLDivElement | null>(null);
  const regularFloatingBarRef = useRef<HTMLDivElement | null>(null);
  const coreFloatingBarRef = useRef<HTMLDivElement | null>(null);
  const regularFloatingInnerRef = useRef<HTMLDivElement | null>(null);
  const coreFloatingInnerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    saveState(regularReturnData, coreReturnData);
  }, [coreReturnData, regularReturnData]);

  useEffect(() => {
    localStorage.setItem(TAB_KEY, activeView);
  }, [activeView]);

  const filteredRegular = useMemo(() => {
    return regularReturnData.filter((row) => {
      if (locationFilter && row.location !== locationFilter) return false;
      if (vendorFilter && row.vendor !== vendorFilter) return false;
      if (accountFilter && (row.account || "") !== accountFilter) return false;
      if (shipToFilter && (row.poNo || "").toLowerCase().includes(shipToFilter.toLowerCase()) === false) return false;
      if (raFilter && (row.raNo || "").toLowerCase().includes(raFilter.toLowerCase()) === false) return false;
      if (uniqueIdFilter && (row.uniqueId || "").toLowerCase().includes(uniqueIdFilter.toLowerCase()) === false) return false;
      if (fromDate || toDate) {
        const rowDate = new Date(row.returnDate);
        if (fromDate && rowDate < new Date(fromDate)) return false;
        if (toDate && rowDate > new Date(toDate)) return false;
      }
      if (resultSearch) {
        const blob = [row.raNo, row.poNo, row.uniqueId, row.partNo, row.description, row.status, row.returnReason].join(" ").toLowerCase();
        if (!blob.includes(resultSearch.toLowerCase())) return false;
      }
      return true;
    });
  }, [accountFilter, fromDate, locationFilter, raFilter, resultSearch, regularReturnData, shipToFilter, toDate, uniqueIdFilter, vendorFilter]);

  const filteredCore = useMemo(() => {
    return coreReturnData.filter((row) => {
      if (locationFilter && row.location !== locationFilter) return false;
      if (vendorFilter && row.vendor !== vendorFilter) return false;
      if (accountFilter && (row.account || "") !== accountFilter) return false;
      if (shipToFilter && (row.poNo || "").toLowerCase().includes(shipToFilter.toLowerCase()) === false) return false;
      if (raFilter && (row.raNo || "").toLowerCase().includes(raFilter.toLowerCase()) === false) return false;
      if (uniqueIdFilter && (row.uniqueId || "").toLowerCase().includes(uniqueIdFilter.toLowerCase()) === false) return false;
      if (fromDate || toDate) {
        const rowDate = new Date(row.returnDate);
        if (fromDate && rowDate < new Date(fromDate)) return false;
        if (toDate && rowDate > new Date(toDate)) return false;
      }
      if (coreResultSearch) {
        const blob = [row.raNo, row.poNo, row.uniqueId, row.partNo, row.description, row.status, row.returnReason].join(" ").toLowerCase();
        if (!blob.includes(coreResultSearch.toLowerCase())) return false;
      }
      return true;
    });
  }, [accountFilter, coreReturnData, coreResultSearch, fromDate, locationFilter, raFilter, shipToFilter, toDate, uniqueIdFilter, vendorFilter]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModalPartNo("");
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const updateRegular = (rowIndex: number, field: keyof ReturnRow, value: string) => {
    setRegularReturnData((current) => current.map((row, index) => (index === rowIndex ? { ...row, [field]: field === "qty" || field === "unitPrice" || field === "coreValue" ? Number(value) : value } as ReturnRow : row)));
  };

  const updateCore = (rowIndex: number, field: keyof ReturnRow, value: string) => {
    setCoreReturnData((current) => current.map((row, index) => (index === rowIndex ? { ...row, [field]: field === "qty" || field === "unitPrice" || field === "coreValue" ? Number(value) : value } as ReturnRow : row)));
  };

  const renderPartInfoFields = (partNo: string, tab: "encompass" | "marcone") => {
    const data = PART_INFO_BY_PART[partNo] || emptyPartInfo;
    return data.rows.map((row) => (
      <tr key={`${tab}-${row.leftLabel}-${row.rightLabel}`}>
        <td>{row.leftLabel}</td>
        <td>{row.leftValue}</td>
        <td>{row.rightLabel}</td>
        <td>{row.rightValue}</td>
      </tr>
    ));
  };

  const activePartInfo = PART_INFO_BY_PART[modalPartNo] || emptyPartInfo;

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
          .controls-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap; }
          .left-controls, .right-controls { display: flex; gap: 0.6rem; align-items: flex-end; flex-wrap: wrap; }
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
        </div>

        <div className="panel">
          <div className="controls-grid">
            <div className="field">
              <label htmlFor="locationFilter">Location</label>
              <select id="locationFilter" value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}>
                <option value="">All</option>
                <option value="Atlanta">Atlanta</option>
                <option value="Asheville">Asheville</option>
                <option value="Birmingham">Birmingham</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="vendorFilter">Vendor*</label>
              <select id="vendorFilter" value={vendorFilter} onChange={(event) => setVendorFilter(event.target.value)}>
                <option value="">All</option>
                <option value="Encompass">Encompass</option>
                <option value="Marcone">Marcone</option>
                <option value="OW">OW</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="accountFilter">Account</label>
              <select id="accountFilter" value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}>
                <option value="">All</option>
                <option value="SB">SB</option>
                <option value="Midea-104268">Midea-104268</option>
                <option value="SB-Miele">SB-Miele</option>
                <option value="SB-1276506820">SB-1276506820</option>
                <option value="M2-162468">M2-162468</option>
                <option value="MCN-162468">MCN-162468</option>
                <option value="MCN-162468bp">MCN-162468bp</option>
                <option value="encompass">encompass</option>
                <option value="Encompass-Birmingham">Encompass-Birmingham</option>
                <option value="LG">LG</option>
                <option value="SS">SS</option>
                <option value="SS-6488757">SS-6488757</option>
                <option value="SP">SP</option>
                <option value="NSA GSLEE">NSA GSLEE</option>
                <option value="NSA MEMPHIS">NSA MEMPHIS</option>
                <option value="SP1">SP1</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="shipToFilter">Ship To (SS)</label>
              <input id="shipToFilter" type="text" placeholder="Ship To" value={shipToFilter} onChange={(event) => setShipToFilter(event.target.value)} />
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

        <div id="regularTab" className={`tab-content ${activeView === "regular" ? "active" : ""}`}>
          <div className="panel">
            <div className="meta-row">
              <div id="recordInfo" className="result-info">{filteredRegular.length} records found</div>
              <input id="resultSearch" className="search-input" type="text" placeholder="search in result" value={resultSearch} onChange={(event) => setResultSearch(event.target.value)} />
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
                  ) : (
                    <>
                      {filteredRegular.map((row, rowIndex) => (
                        <tr key={`${row.raNo}-${row.uniqueId}-${row.partNo}`}>
                          <td>{row.raNo}</td>
                          <td>{row.poNo}</td>
                          <td>{row.uniqueId}</td>
                          <td><span className="clickable-part-no" onClick={() => { setModalPartNo(row.partNo); setModalTab("marcone"); }}>{row.partNo}</span></td>
                          <td>{row.description}</td>
                          <td>{row.returnType}</td>
                          <td><input type="text" className="table-input" title="Edit return reason" placeholder="Return reason" value={row.returnReason} onChange={(event) => updateRegular(rowIndex, "returnReason", event.target.value)} /></td>
                          <td>
                            <select className="table-select" title="Edit status" value={row.status} onChange={(event) => updateRegular(rowIndex, "status", event.target.value)}>
                              {REGULAR_STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                            </select>
                          </td>
                          <td>{row.returnDate}</td>
                          <td><input type="text" className="table-input" title="Edit returned by" placeholder="Returned by" value={row.returnedBy} onChange={(event) => updateRegular(rowIndex, "returnedBy", event.target.value)} /></td>
                          <td className="qty">{row.qty}</td>
                          <td className="money">${formatMoney(row.unitPrice)}</td>
                          <td className="money">${formatMoney(row.coreValue)}</td>
                          <td>{row.returnLabel || "-"}</td>
                        </tr>
                      ))}
                      <tr className="totals-row">
                        <td colSpan={11}></td>
                        <td className="money">${formatMoney(filteredRegular.reduce((sum, row) => sum + Number(row.unitPrice || 0), 0))}</td>
                        <td className="money">${formatMoney(filteredRegular.reduce((sum, row) => sum + Number(row.coreValue || 0), 0))}</td>
                        <td></td>
                      </tr>
                    </>
                  )}
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
              <input id="coreResultSearch" className="search-input" type="text" placeholder="search in result" value={coreResultSearch} onChange={(event) => setCoreResultSearch(event.target.value)} />
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
                  ) : (
                    <>
                      {filteredCore.map((row, rowIndex) => (
                        <tr key={`${row.raNo}-${row.uniqueId}-${row.partNo}`}>
                          <td>{row.raNo}</td>
                          <td>{row.poNo}</td>
                          <td>{row.uniqueId}</td>
                          <td><span className="clickable-part-no" onClick={() => { setModalPartNo(row.partNo); setModalTab("marcone"); }}>{row.partNo}</span></td>
                          <td>{row.description}</td>
                          <td>{row.returnType}</td>
                          <td><input type="text" className="table-input" title="Edit return reason" placeholder="Return reason" value={row.returnReason} onChange={(event) => updateCore(rowIndex, "returnReason", event.target.value)} /></td>
                          <td>
                            <select className="table-select" title="Edit status" value={row.status} onChange={(event) => updateCore(rowIndex, "status", event.target.value)}>
                              {CORE_STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                            </select>
                          </td>
                          <td>{row.returnDate}</td>
                          <td><input type="text" className="table-input" title="Edit returned by" placeholder="Returned by" value={row.returnedBy} onChange={(event) => updateCore(rowIndex, "returnedBy", event.target.value)} /></td>
                          <td className="qty">{row.qty}</td>
                          <td className="money">${formatMoney(row.unitPrice)}</td>
                          <td className="money">${formatMoney(row.coreValue)}</td>
                          <td>{row.returnLabel || "-"}</td>
                        </tr>
                      ))}
                      <tr className="totals-row">
                        <td colSpan={11}></td>
                        <td className="money">${formatMoney(filteredCore.reduce((sum, row) => sum + Number(row.unitPrice || 0), 0))}</td>
                        <td className="money">${formatMoney(filteredCore.reduce((sum, row) => sum + Number(row.coreValue || 0), 0))}</td>
                        <td></td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>

            <div id="coreFloatingScrollbar" className="floating-table-scrollbar" aria-hidden="true" ref={coreFloatingBarRef}>
              <div id="coreFloatingScrollbarInner" className="floating-table-scrollbar-inner" ref={coreFloatingInnerRef} />
            </div>
          </div>
        </div>
      </main>

      <footer id="contact" className="status-footer">
        <p>For any questions or support, contact us at <a href="mailto:support@adminhubsolutions.com">support@adminhubsolutions.com</a></p>
        <p className="status-footer-note">© 2026 Admin Hub Solutions. All rights reserved.</p>
      </footer>

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
              <table className="part-info-matrix">
                <thead>
                  <tr><th>Field</th><th>Value</th><th>Field</th><th>Value</th></tr>
                </thead>
                <tbody>{renderPartInfoFields(modalPartNo, "encompass")}</tbody>
              </table>
              <div className="part-info-section-title">Availability (Encompass)</div>
              <div className="part-info-empty">No availability records found.</div>
            </div>

            <div className={`part-info-pane ${modalTab === "marcone" ? "active" : ""}`} data-part-pane="marcone">
              <table className="part-info-matrix">
                <thead>
                  <tr><th>Field</th><th>Value</th><th>Field</th><th>Value</th></tr>
                </thead>
                <tbody>{renderPartInfoFields(modalPartNo, "marcone")}</tbody>
              </table>
              <div className="part-info-section-title">Availability (Marcone)</div>
              <div id="partInfoAvailabilityCount" className="part-info-section-subtitle">{(activePartInfo.availability || []).length} records found</div>
              <table className="part-info-matrix">
                <thead><tr><th>ID</th><th>W/H Name</th><th>Available Qty</th></tr></thead>
                <tbody>
                  {(activePartInfo.availability || []).map((row) => (
                    <tr key={`${row.id}-${row.name}`}><td>{row.id}</td><td>{row.name}</td><td>{row.qty}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
