import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

type InventoryRow = {
  location: string;
  partDist: string;
  poNo: string;
  invoiceNo: string;
  uniqueId: string;
  partNo: string;
  ticketNo: string;
  ticketDate?: string;
  aging: number;
  description: string;
  branch: string;
  price: number;
  retailPrice?: number;
  qty: number;
  lotNo: number;
  adjustReason: string;
  ordered: number;
  received: number;
  reserved: number;
  used: number;
  inReview: number;
  defect: number;
  pnn: number;
  returned: number;
  adjust: number;
  avail: number;
  inStock: number;
};

type PartInfoRecord = {
  description: string;
  unitPrice: number;
  retailPrice: number;
  imageDataUrl: string;
  imageFileName: string;
  updatedAt: number;
};

type LotEntry = { lotNo: number; qty: number };

type RowHistoryEntry = {
  partNo: string;
  logTime: string;
  partDist: string;
  location: string;
  poNo: string;
  poDate: string;
  invDate: string;
  ordered: number;
  received: number;
  reserved: number;
  review: number;
  defect: number;
  pnn: number;
  returned: number;
  used: number;
  adjust: number;
  avail: number;
  inStock: number;
  lotNo: number;
  modifiedBy: string;
};

const INVENTORY_STORAGE_KEY = "partInventoryFilters";
const PART_INFO_STORAGE_KEY = "partInventoryPartInfo";
const PART_LOT_STORAGE_KEY = "partInventoryLotInfo";

const SAMPLE_ROWS: InventoryRow[] = [
  { location: "Asheville", partDist: "Miele", poNo: "SMLTA4AA0DB4-1-JB", invoiceNo: "2366429269", uniqueId: "2366429269-05795681", partNo: "05795681", ticketNo: "", aging: 207, description: "Control Board", branch: "", price: 603.9, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 0, used: 0, inReview: 0, defect: 0, pnn: 1, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Marcone-162468", poNo: "8773753001-CH", invoiceNo: "60548229", uniqueId: "60548229-2", partNo: "117518780", ticketNo: "", aging: 539, description: "CONTROL ASSEMBLY", branch: "", price: 134.17, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 0, used: 0, inReview: 1, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Midea", poNo: "400491410", invoiceNo: "12-586686-042", uniqueId: "12-586686-042-12131000043360", partNo: "12131000043360", ticketNo: "", aging: 10, description: "FREEZER ICE MAKER", branch: "", price: 48.25, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 0, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 1, inStock: 1 },
  { location: "Asheville", partDist: "Midea", poNo: "400432874", invoiceNo: "400432874", uniqueId: "400432874-12131000093262", partNo: "12131000093262", ticketNo: "", aging: 246, description: "AIR DUCT ASSEMBLY OF FREEZER", branch: "", price: 36.47, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 0, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 1, inStock: 1 },
  { location: "Asheville", partDist: "OW", poNo: "35209", invoiceNo: "35209", uniqueId: "35209-12131000093839", partNo: "12131000093839", ticketNo: "", aging: 274, description: "ICE MAKER", branch: "", price: 33.07, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Midea", poNo: "400491410", invoiceNo: "12-586686-0426", uniqueId: "12-586686-0426-12131000096331", partNo: "12131000096331", ticketNo: "", aging: 10, description: "FILTER ASSEMBLY", branch: "", price: 77.9, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 0, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 1, inStock: 1 },
  { location: "Asheville", partDist: "Encompass-Birmingham / Montgomery", poNo: "8803875101-BM", invoiceNo: "12-983005-0425", uniqueId: "12-983005-0425-1", partNo: "131205100", ticketNo: "", aging: 403, description: "SCREW,#8 PAN HEAD,10-10B X 0.5", branch: "", price: 8.42, qty: 4, lotNo: 4, adjustReason: "", ordered: 4, received: 4, reserved: 0, used: 0, inReview: 0, defect: 0, pnn: 4, returned: 0, adjust: 0, avail: 0, inStock: 4 },
  { location: "Asheville", partDist: "Encompass-Birmingham / Montgomery", poNo: "8803875101-BM", invoiceNo: "1-283606-0425", uniqueId: "1-283606-0425-5", partNo: "137087000", ticketNo: "", aging: 400, description: "SCREW,10--16X.75", branch: "", price: 6.72, qty: 4, lotNo: 4, adjustReason: "", ordered: 4, received: 4, reserved: 0, used: 0, inReview: 0, defect: 0, pnn: 4, returned: 0, adjust: 0, avail: 0, inStock: 4 },
  { location: "Asheville", partDist: "Encompass-Birmingham / Montgomery", poNo: "8803875101-BM", invoiceNo: "1-283606-0425", uniqueId: "1-283606-0425-4", partNo: "137285100", ticketNo: "", aging: 400, description: "SCREW,PAN HEAD,#8-18X.750", branch: "", price: 9.3, qty: 2, lotNo: 2, adjustReason: "", ordered: 2, received: 2, reserved: 0, used: 0, inReview: 0, defect: 0, pnn: 2, returned: 0, adjust: 0, avail: 0, inStock: 2 },
  { location: "Asheville", partDist: "OW", poNo: "BM_TS 140137975102", invoiceNo: "BM_TS 140137975102", uniqueId: "BM_TS 140137975102-140137975102", partNo: "140137975102", ticketNo: "", aging: 58, description: "SOLENOID, ASSEMBLY", branch: "", price: 39.16, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 0, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 1, inStock: 1 },
  { location: "Asheville", partDist: "Marcone- Birmingham / Montgomery", poNo: "1006118053-10-BM", invoiceNo: "71736896", uniqueId: "71736896-2", partNo: "140153004290", ticketNo: "", aging: 87, description: "USER INTERFACE BOAR", branch: "", price: 69.82, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 0, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 1, inStock: 1 },
  { location: "Asheville", partDist: "Marcone-162468", poNo: "1005583863-10-BM", invoiceNo: "70993005", uniqueId: "70993005-2", partNo: "140171068061", ticketNo: "", aging: 115, description: "MAIN BOARD ASSEMBLY", branch: "", price: 68.38, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 0, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 1, inStock: 1 },
  { location: "Asheville", partDist: "Encompass-Birmingham / Montgomery", poNo: "1006802374-10-BM", invoiceNo: "1-211985-0426", uniqueId: "1-211985-0426-2", partNo: "140172164018", ticketNo: "1006802374-10", ticketDate: "05/14", aging: 29, description: "VALVE", branch: "", price: 39.21, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Encompass-Birmingham / Montgomery", poNo: "1006449532-10-BM", invoiceNo: "6-283031-0326", uniqueId: "6-283031-0326-1", partNo: "140173679014", ticketNo: "", aging: 60, description: "SWITCH", branch: "", price: 14.99, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 0, used: 0, inReview: 0, defect: 1, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Marcone- Birmingham / Montgomery", poNo: "1006685919-10-BM", invoiceNo: "72974125", uniqueId: "72974125-1", partNo: "140249706031", ticketNo: "", aging: 42, description: "ELEMENT HEATING-PUR", branch: "", price: 43.69, qty: 0, lotNo: 2, adjustReason: "", ordered: 0, received: 1, reserved: 0, used: 1, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 1, inStock: 1 },
  { location: "Asheville", partDist: "Encompass-Birmingham / Montgomery", poNo: "1006836710-10-BM", invoiceNo: "1-300254-0526", uniqueId: "1-300254-0526-1", partNo: "140282033103", ticketNo: "1006836710-10", ticketDate: "05/15", aging: 9, description: "MOTOR,EVAPORATOR FAN,W/HARNESS", branch: "", price: 26.48, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Encompass", poNo: "23978789DF-NOSCHEDULE", invoiceNo: "1-397104-0224", uniqueId: "1-397104-0224-2", partNo: "154825001", ticketNo: "", aging: 820, description: "HEATER,ROUND", branch: "", price: 42.28, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 0, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 1, inStock: 1 },
  { location: "Asheville", partDist: "Midea", poNo: "400493767", invoiceNo: "12-594899-0526", uniqueId: "12-594899-0526-17170000038345", partNo: "17170000038345", ticketNo: "400493767", ticketDate: "05/15", aging: 1, description: "SENSOR ASSEMBLY", branch: "", price: 24.28, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Midea", poNo: "400459555", invoiceNo: "12-329955-1025-2", uniqueId: "12-329955-1025-2-17171100003504", partNo: "17171100003504", ticketNo: "", aging: 210, description: "UI CONTROL ASM (DISPLAY BOARD ASSEMBLY)", branch: "", price: 87.84, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 0, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 1, inStock: 1 },
  { location: "Asheville", partDist: "Midea", poNo: "400427080", invoiceNo: "400427080", uniqueId: "400427080-17171100005463", partNo: "17171100005463", ticketNo: "", aging: 241, description: "POWER BOARD", branch: "", price: 32.49, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 0, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 1, inStock: 1 },
  { location: "Asheville", partDist: "Midea", poNo: "400427080", invoiceNo: "400427080", uniqueId: "400427080-17171100006485", partNo: "17171100006485", ticketNo: "", aging: 241, description: "KEY PRESS BOARD", branch: "", price: 47.52, qty: 2, lotNo: 2, adjustReason: "", ordered: 2, received: 2, reserved: 0, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 2, inStock: 2 },
  { location: "Asheville", partDist: "Squaretrade", poNo: "007124354132-2", invoiceNo: "007124354132-2", uniqueId: "007124354132-2-341241", partNo: "341241", ticketNo: "", aging: 154, description: "DRYER DRUM BELT", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "SB", poNo: "9457316", invoiceNo: "SNWT949FF79E-1", uniqueId: "SNWT949FF79E-1-216730700", partNo: "216730700", ticketNo: "", aging: 238, description: "HEATER-DEFROST", branch: "", price: 55.95, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 0, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 1, inStock: 1 },
  { location: "Asheville", partDist: "Encompass-Birmingham / Montgomery", poNo: "1007120936-10-BM", invoiceNo: "1-317570-0526", uniqueId: "1-317570-0526-3", partNo: "242095423", ticketNo: "1007120936-10", ticketDate: "05/15", aging: 4, description: "GASKET", branch: "", price: 11.3, qty: 3, lotNo: 3, adjustReason: "", ordered: 3, received: 3, reserved: 3, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 3 },
  { location: "Asheville", partDist: "Encompass-Birmingham / Montgomery", poNo: "1006836710-10-BM", invoiceNo: "1-256846-0426", uniqueId: "1-256846-0426-2", partNo: "5303305677", ticketNo: "1006836710-10", ticketDate: "05/15", aging: 18, description: "DRYER-FILTER,R12 & R134A", branch: "", price: 12.39, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Marcone-162468", poNo: "8803875101-BM-2", invoiceNo: "63537992", uniqueId: "63537992-1", partNo: "5304504999", ticketNo: "", aging: 416, description: "GLASS", branch: "", price: 65.42, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 0, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 1, inStock: 1 },
  { location: "Asheville", partDist: "Marcone-162468", poNo: "8803875101-BM", invoiceNo: "63537872", uniqueId: "63537872-1", partNo: "5304505012", ticketNo: "", aging: 416, description: "CLAMP", branch: "", price: 8.37, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 0, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 1, inStock: 1 },
  { location: "Asheville", partDist: "SB", poNo: "01EJ7304", invoiceNo: "01EJ7304", uniqueId: "01EJ7304-5304507200", partNo: "5304507200", ticketNo: "", aging: 266, description: "GASKET-DOOR", branch: "", price: 79.36, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 0, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 1, inStock: 1 },
];

const LOCATION_OPTIONS = ["Asheville", "Birmingham", "Atlanta", "Dallas", "Nashville", "St. Louis"];

function formatCurrency(value: number) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function parseTicketNoDisplay(ticketNo: string, ticketDate = "") {
  const raw = (ticketNo || "").trim();
  const cleanedDate = (ticketDate || "").trim();
  const match = raw.match(/^(.*?)(\s*\(\d{2}\/\d{2}\))$/);
  if (match) {
    return { ticketNo: match[1].trim(), suffix: match[2].trim() };
  }
  return { ticketNo: raw, suffix: cleanedDate ? `(${cleanedDate})` : "" };
}

function dedupeRows(rows: InventoryRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = (row.uniqueId || "").trim().toUpperCase();
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildDefaultLotEntries(row: InventoryRow): LotEntry[] {
  const lotCount = Math.max(1, Number(row.lotNo || 1));
  const totalQty = Math.max(0, Number(row.qty || 0));
  return Array.from({ length: lotCount }, (_, index) => ({ lotNo: index + 1, qty: totalQty > index ? 1 : 0 }));
}

function sumLotQty(entries: LotEntry[]) {
  return entries.reduce((total, entry) => total + Math.max(0, Number(entry.qty || 0)), 0);
}

function getRowHistoryEntries(row: InventoryRow): RowHistoryEntry[] {
  const poDate = "04/04/2025";
  const invDate = "04/07/2025";
  const lot = row.lotNo || 0;
  return [
    { partNo: row.partNo, logTime: "05/30/2025 18:23:31", partDist: row.partDist, location: row.location, poNo: row.poNo, poDate, invDate, ordered: row.ordered, received: row.received, reserved: 0, review: row.inReview, defect: 0, pnn: 0, returned: 0, used: 0, adjust: 0, avail: 0, inStock: row.inStock, lotNo: lot, modifiedBy: "Nashville Admin" },
    { partNo: row.partNo, logTime: "06/25/2025 14:29:52", partDist: row.partDist, location: row.location, poNo: row.poNo, poDate, invDate, ordered: row.ordered, received: row.received, reserved: 0, review: 0, defect: row.defect, pnn: 0, returned: 0, used: 0, adjust: 0, avail: 0, inStock: row.inStock, lotNo: lot, modifiedBy: "Brittney Sims" },
    { partNo: row.partNo, logTime: "05/30/2025 18:18:53", partDist: row.partDist, location: row.location, poNo: row.poNo, poDate, invDate, ordered: row.ordered, received: row.received, reserved: 0, review: row.inReview, defect: 0, pnn: 0, returned: row.returned, used: row.used, adjust: 0, avail: -row.avail, inStock: 0, lotNo: lot, modifiedBy: "Nashville Admin" },
    { partNo: row.partNo, logTime: "04/21/2025 17:35:01", partDist: row.partDist, location: row.location, poNo: row.poNo, poDate, invDate, ordered: row.ordered, received: row.received, reserved: 0, review: 0, defect: 0, pnn: 0, returned: 0, used: row.used, adjust: 0, avail: 0, inStock: 0, lotNo: lot, modifiedBy: "" },
    { partNo: row.partNo, logTime: "04/14/2025 14:22:01", partDist: row.partDist, location: row.location, poNo: row.poNo, poDate, invDate, ordered: row.ordered, received: row.received, reserved: row.reserved, review: 0, defect: 0, pnn: 0, returned: 0, used: 0, adjust: 0, avail: 0, inStock: row.inStock, lotNo: lot, modifiedBy: "Brittney Sims" },
    { partNo: row.partNo, logTime: "04/14/2025 14:22:00", partDist: row.partDist, location: row.location, poNo: row.poNo, poDate, invDate, ordered: row.ordered, received: row.received, reserved: 0, review: 0, defect: 0, pnn: 0, returned: 0, used: 0, adjust: 0, avail: row.avail, inStock: row.inStock, lotNo: lot, modifiedBy: "Brittney Sims" },
    { partNo: row.partNo, logTime: "04/07/2025 16:36:34", partDist: row.partDist, location: row.location, poNo: row.poNo, poDate, invDate, ordered: row.ordered, received: 0, reserved: 0, review: 0, defect: 0, pnn: 0, returned: 0, used: 0, adjust: 0, avail: 0, inStock: 0, lotNo: lot, modifiedBy: "" },
    { partNo: row.partNo, logTime: "04/07/2025 14:36:41", partDist: row.partDist, location: row.location, poNo: row.poNo, poDate, invDate, ordered: row.ordered, received: 0, reserved: 0, review: 0, defect: 0, pnn: 0, returned: 0, used: 0, adjust: 0, avail: 0, inStock: 0, lotNo: lot, modifiedBy: "" },
  ];
}

function escapeHtml(value: string | number) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string));
}

export function PartInventoryPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [rows, setRows] = useState<InventoryRow[]>(() => SAMPLE_ROWS.map((row) => ({ ...row })));
  const [filters, setFilters] = useState({ locationFilter: "Asheville", vendorFilter: "", branchFilter: "", slowSearch: "", uniqueIdSearch: "", resultSearch: "" });
  const [autoSave, setAutoSave] = useState(true);
  const [partInfoStore, setPartInfoStore] = useState<Record<string, PartInfoRecord>>({});
  const [lotInfoStore, setLotInfoStore] = useState<Record<string, { lots: LotEntry[]; updatedAt: number }>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [partInfoOpen, setPartInfoOpen] = useState(false);
  const [lotInfoOpen, setLotInfoOpen] = useState(false);
  const [rowHistoryOpen, setRowHistoryOpen] = useState(false);
  const [activePartInfoUniqueId, setActivePartInfoUniqueId] = useState("");
  const [activeLotUniqueId, setActiveLotUniqueId] = useState("");
  const [activeLotEntries, setActiveLotEntries] = useState<LotEntry[]>([]);
  const [activeRowHistory, setActiveRowHistory] = useState<RowHistoryEntry[]>([]);
  const [partInfoImageDataUrl, setPartInfoImageDataUrl] = useState("");
  const [partInfoImageFileName, setPartInfoImageFileName] = useState("");
  const [partInfoDescription, setPartInfoDescription] = useState("");
  const [partInfoUnitPrice, setPartInfoUnitPrice] = useState("0");
  const [partInfoRetailPrice, setPartInfoRetailPrice] = useState("0");
  const [partInfoHeader, setPartInfoHeader] = useState("Register your part information");
  const [partInfoDescriptionLabel, setPartInfoDescriptionLabel] = useState("Description");
  const [partInfoPartNo, setPartInfoPartNo] = useState("05795681");
  const [partInfoSavedName, setPartInfoSavedName] = useState("No image saved");
  const [lotInfoPartNo, setLotInfoPartNo] = useState("");
  const [lotInfoDescription, setLotInfoDescription] = useState("");
  const [lotInfoUniqueId, setLotInfoUniqueId] = useState("");
  const [newInvoiceNo, setNewInvoiceNo] = useState("1");
  const [newPartDist, setNewPartDist] = useState("");
  const [newPartNo, setNewPartNo] = useState("");
  const [newLotNo, setNewLotNo] = useState("1");
  const [newDescription, setNewDescription] = useState("");
  const [newPrice, setNewPrice] = useState("0");
  const [newQty, setNewQty] = useState("1");

  useEffect(() => {
    const rawFilters = localStorage.getItem(INVENTORY_STORAGE_KEY);
    if (rawFilters) {
      try {
        const parsed = JSON.parse(rawFilters);
        setFilters((current) => ({ ...current, ...parsed, locationFilter: "Asheville" }));
      } catch {
        setFilters((current) => ({ ...current, locationFilter: "Asheville" }));
      }
    }

    const rawPartInfo = localStorage.getItem(PART_INFO_STORAGE_KEY);
    if (rawPartInfo) {
      try {
        setPartInfoStore(JSON.parse(rawPartInfo) || {});
      } catch {
        setPartInfoStore({});
      }
    }

    const rawLotInfo = localStorage.getItem(PART_LOT_STORAGE_KEY);
    if (rawLotInfo) {
      try {
        setLotInfoStore(JSON.parse(rawLotInfo) || {});
      } catch {
        setLotInfoStore({});
      }
    }
  }, []);

  useEffect(() => {
    if (!autoSave) return;
    localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(filters));
  }, [autoSave, filters]);

  const filteredRows = useMemo(() => {
    const location = filters.locationFilter.trim().toLowerCase();
    const vendor = filters.vendorFilter.trim().toLowerCase();
    const branch = filters.branchFilter.trim().toLowerCase();
    const slow = filters.slowSearch.trim().toLowerCase();
    const uniqueIdSearch = filters.uniqueIdSearch.trim().toLowerCase();
    const resultSearch = filters.resultSearch.trim().toLowerCase();

    return rows.filter((row) => {
      if (location && row.location.toLowerCase() !== location) return false;
      if (vendor && !row.partDist.toLowerCase().includes(vendor)) return false;
      if (branch && !row.branch.toLowerCase().includes(branch)) return false;
      if (uniqueIdSearch && !row.uniqueId.toLowerCase().includes(uniqueIdSearch)) return false;
      const blob = [row.location, row.partDist, row.poNo, row.invoiceNo, row.uniqueId, row.partNo, row.ticketNo, row.description, row.branch, row.adjustReason].join(" ").toLowerCase();
      if (slow && !blob.includes(slow)) return false;
      if (resultSearch && !blob.includes(resultSearch)) return false;
      return true;
    });
  }, [filters, rows]);

  const totals = useMemo(() => {
    return filteredRows.reduce(
      (accumulator, row) => ({
        lotNo: accumulator.lotNo + row.lotNo,
        ordered: accumulator.ordered + row.ordered,
        received: accumulator.received + row.received,
        reserved: accumulator.reserved + row.reserved,
        used: accumulator.used + row.used,
        inReview: accumulator.inReview + row.inReview,
        defect: accumulator.defect + row.defect,
        pnn: accumulator.pnn + row.pnn,
        returned: accumulator.returned + row.returned,
        adjust: accumulator.adjust + row.adjust,
        avail: accumulator.avail + row.avail,
        inStock: accumulator.inStock + row.inStock,
      }),
      { lotNo: 0, ordered: 0, received: 0, reserved: 0, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 0 },
    );
  }, [filteredRows]);

  const savePartInfoStore = (nextStore: Record<string, PartInfoRecord>) => {
    setPartInfoStore(nextStore);
    localStorage.setItem(PART_INFO_STORAGE_KEY, JSON.stringify(nextStore));
  };

  const saveLotInfoStore = (nextStore: Record<string, { lots: LotEntry[]; updatedAt: number }>) => {
    setLotInfoStore(nextStore);
    localStorage.setItem(PART_LOT_STORAGE_KEY, JSON.stringify(nextStore));
  };

  const updateRows = (nextRows: InventoryRow[]) => {
    setRows(dedupeRows(nextRows));
  };

  const getSavedPartInfo = (uniqueId: string) => partInfoStore[uniqueId] || null;
  const getRetailPriceForRow = (row: InventoryRow) => Number(row.retailPrice || 0);
  const isSavedPartInfo = (savedInfo: PartInfoRecord | null) => Boolean(savedInfo && savedInfo.updatedAt);
  const isBaseRegisteredPart = (row: InventoryRow) => Boolean(String(row.description || "").trim().length || Number(row.price || 0) > 0 || Number(getRetailPriceForRow(row) || 0) > 0);

  const applySavedPartInfoToRow = (uniqueId: string, data: PartInfoRecord) => {
    updateRows(rows.map((row) => (row.uniqueId === uniqueId ? { ...row, description: data.description, price: data.unitPrice, retailPrice: data.retailPrice } : row)));
  };

  const openAddPartModal = () => {
    setNewPartDist(filters.vendorFilter.trim());
    setNewInvoiceNo("1");
    setNewPartNo("");
    setNewDescription("");
    setNewPrice("0");
    setNewQty("1");
    setNewLotNo("1");
    setAddOpen(true);
  };

  const closeAddPartModal = () => setAddOpen(false);

  const addInvoiceRow = () => {
    const invoiceNo = newInvoiceNo.trim();
    const partDist = newPartDist.trim();
    const partNo = newPartNo.trim();
    const description = newDescription.trim();
    const price = Math.max(0, Number(newPrice || 0));
    const qty = Math.max(1, Number(newQty || 1));
    const lotNo = Math.max(1, Number(newLotNo || qty));
    if (!invoiceNo || !partNo || !description || !partDist) return;

    let generatedUniqueId = `${invoiceNo}-${partNo}`;
    const usedIds = new Set(rows.map((row) => row.uniqueId.toUpperCase()));
    let counter = 1;
    while (usedIds.has(generatedUniqueId.toUpperCase())) {
      generatedUniqueId = `${invoiceNo}-${partNo}-${counter}`;
      counter += 1;
    }

    const newRow: InventoryRow = {
      location: filters.locationFilter || "Asheville",
      partDist,
      poNo: `NEW-${Date.now().toString().slice(-6)}`,
      invoiceNo,
      uniqueId: generatedUniqueId,
      partNo,
      ticketNo: "",
      aging: 0,
      description,
      branch: filters.branchFilter,
      price,
      qty,
      lotNo,
      adjustReason: "",
      ordered: qty,
      received: qty,
      reserved: 0,
      used: 0,
      inReview: 0,
      defect: 0,
      pnn: 0,
      returned: 0,
      adjust: 0,
      avail: 1,
      inStock: 1,
    };

    updateRows([newRow, ...rows]);
    closeAddPartModal();
  };

  const openPartInfoByUniqueId = (uniqueId: string) => {
    const row = rows.find((item) => item.uniqueId === uniqueId);
    if (!row) return;
    const savedInfo = getSavedPartInfo(uniqueId);
    const hasSavedInfo = isSavedPartInfo(savedInfo);
    const isRegistered = hasSavedInfo || isBaseRegisteredPart(row);
    const description = hasSavedInfo ? (savedInfo?.description || "") : (isRegistered ? (row.description || "") : "");
    const unitPrice = hasSavedInfo ? Number(savedInfo?.unitPrice || 0) : (isRegistered ? Number(row.price || 0) : 0);
    const retailPrice = hasSavedInfo ? Number(savedInfo?.retailPrice || 0) : (isRegistered ? Number(getRetailPriceForRow(row) || 0) : 0);

    setPartInfoHeader(isRegistered ? "Part Information (ENC)" : "Register your part information");
    setPartInfoDescriptionLabel(isRegistered ? "PartDesc" : "Description");
    setPartInfoPartNo(row.partNo || "05795681");
    setPartInfoDescription(description);
    setPartInfoUnitPrice(String(unitPrice));
    setPartInfoRetailPrice(String(retailPrice));
    setPartInfoImageDataUrl(savedInfo?.imageDataUrl || "");
    setPartInfoImageFileName(savedInfo?.imageFileName || "");
    setPartInfoSavedName(savedInfo?.imageFileName || (savedInfo?.imageDataUrl ? "Saved image" : "No image saved"));
    setActivePartInfoUniqueId(uniqueId);
    setPartInfoOpen(true);
  };

  const closePartInfoModal = () => setPartInfoOpen(false);

  const searchPartInfoFromInput = () => {
    const row = rows.find((item) => item.partNo.trim().toLowerCase() === partInfoPartNo.trim().toLowerCase());
    if (!row) return;
    openPartInfoByUniqueId(row.uniqueId);
  };

  const saveCurrentPartInfo = (selectedFile?: File | null) => {
    if (!activePartInfoUniqueId) return;
    const description = partInfoDescription.trim();
    const unitPrice = Math.max(0, Number(partInfoUnitPrice || 0));
    const retailPrice = Math.max(0, Number(partInfoRetailPrice || 0));
    const existingInfo = getSavedPartInfo(activePartInfoUniqueId) || null;
    const baseData: PartInfoRecord = {
      description,
      unitPrice,
      retailPrice,
      imageDataUrl: existingInfo?.imageDataUrl || "",
      imageFileName: existingInfo?.imageFileName || "",
      updatedAt: Date.now(),
    };

    const finalize = (finalData: PartInfoRecord) => {
      savePartInfoStore({ ...partInfoStore, [activePartInfoUniqueId]: finalData });
      applySavedPartInfoToRow(activePartInfoUniqueId, finalData);
      setPartInfoHeader("Part Information (ENC)");
      setPartInfoDescriptionLabel("PartDesc");
      setPartInfoSavedName(finalData.imageFileName || (finalData.imageDataUrl ? "Saved image" : "No image saved"));
      setPartInfoImageDataUrl(finalData.imageDataUrl || "");
      setPartInfoImageFileName(finalData.imageFileName || "");
      setPartInfoOpen(false);
    };

    if (!selectedFile) {
      finalize(baseData);
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => finalize({ ...baseData, imageDataUrl: event.target && event.target.result ? String(event.target.result) : "", imageFileName: selectedFile.name });
    reader.onerror = () => finalize(baseData);
    reader.readAsDataURL(selectedFile);
  };

  const openLotInfoByUniqueId = (uniqueId: string) => {
    const row = rows.find((item) => item.uniqueId === uniqueId);
    if (!row) return;
    const saved = lotInfoStore[uniqueId];
    const entries = saved?.lots?.length ? saved.lots : buildDefaultLotEntries(row);
    setActiveLotUniqueId(uniqueId);
    setActiveLotEntries(entries.map((entry, index) => ({ lotNo: Number(entry.lotNo || index + 1), qty: Math.max(0, Number(entry.qty || 0)) })));
    setLotInfoPartNo(row.partNo || "");
    setLotInfoDescription(row.description || "");
    setLotInfoUniqueId(row.uniqueId || "");
    setLotInfoOpen(true);
  };

  const closeLotInfoModal = () => setLotInfoOpen(false);

  const removeLotRow = (index: number) => {
    const nextEntries = activeLotEntries.filter((_entry, entryIndex) => entryIndex !== index);
    setActiveLotEntries(nextEntries.length ? nextEntries : [{ lotNo: 1, qty: 0 }]);
  };

  const setLotInfo = () => {
    if (!activeLotUniqueId) return;
    const nextStore = { ...lotInfoStore, [activeLotUniqueId]: { lots: activeLotEntries, updatedAt: Date.now() } };
    saveLotInfoStore(nextStore);
    updateRows(rows.map((row) => (row.uniqueId === activeLotUniqueId ? { ...row, lotNo: activeLotEntries.length, qty: sumLotQty(activeLotEntries) } : row)));
    setLotInfoOpen(false);
  };

  const openRowHistory = (uniqueId: string) => {
    const row = rows.find((item) => item.uniqueId === uniqueId);
    if (!row) return;
    setActiveRowHistory(getRowHistoryEntries(row));
    setRowHistoryOpen(true);
  };

  const closeRowHistoryModal = () => setRowHistoryOpen(false);

  const deleteRow = (uniqueId: string) => updateRows(rows.filter((row) => row.uniqueId !== uniqueId));

  const getPartHistoryHref = (uniqueId: string) => `/m/${mod.slug}/part-history?uniqueId=${encodeURIComponent(uniqueId)}`;
  const getTicketDetailsHref = (ticketNo: string) => `/ticket/${encodeURIComponent(ticketNo)}`;
  const openPartReturn = (uniqueId: string) => window.open(`/m/${mod.slug}/part-return?uniqueId=${encodeURIComponent(uniqueId)}`, "_blank", "noopener,noreferrer");

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <style>{`
          .inventory-panel { background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 10px; padding: 1rem; color: #fff; backdrop-filter: blur(10px); width: 100%; }
          .filter-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.9rem; margin-bottom: 0.9rem; }
          .field { display: flex; flex-direction: column; gap: 0.25rem; }
          .field label { font-size: 0.78rem; font-weight: 600; color: #e5e7eb; letter-spacing: 0.02em; }
          .field input, .field select { width: 100%; padding: 0.55rem 0.65rem; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(17, 24, 39, 0.95); color: #fff; font-size: 0.85rem; font-family: inherit; }
          .field select option { background: #111827; color: #fff; }
          .field input:focus, .field select:focus { outline: none; border-color: #60a5fa; box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.16); }
          .panel-actions { display: flex; justify-content: flex-start; margin-bottom: 0.8rem; }
          .open-add-btn, .add-part-btn, .part-info-save-btn, .lot-add-btn, .lot-set-btn, .footer-actions button { border: 1px solid rgba(96, 165, 250, 0.55); background: rgba(37, 99, 235, 0.85); color: #fff; font-weight: 700; cursor: pointer; }
          .open-add-btn { padding: 0.5rem 0.9rem; border-radius: 6px; }
          .meta-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
          .record-count { font-size: 0.9rem; font-weight: 700; color: #bfdbfe; }
          .tools-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 0.7rem; flex-wrap: wrap; }
          .tools-row label { display: inline-flex; align-items: center; gap: 0.45rem; font-size: 0.85rem; font-weight: 600; }
          .search-inline { display: flex; align-items: center; gap: 0.45rem; }
          .search-inline input { padding: 0.45rem 0.6rem; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(17, 24, 39, 0.95); color: #fff; font-size: 0.84rem; min-width: 220px; }
          .table-wrap { overflow-x: auto; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 8px; background: #fff; }
          .floating-table-scrollbar { position: fixed; left: 0; bottom: 14px; z-index: 1100; overflow-x: auto; overflow-y: hidden; border: 1px solid rgba(148, 163, 184, 0.5); border-radius: 8px; background: rgba(255, 255, 255, 0.92); box-shadow: 0 10px 24px rgba(15, 23, 42, 0.18); display: none; max-width: calc(100vw - 28px); }
          .floating-table-scrollbar.is-visible { display: block; }
          .floating-table-scrollbar-inner { height: 1px; }
          table.inventory-table { width: 100%; border-collapse: collapse; font-size: 0.75rem; color: #111827; min-width: 1900px; }
          .inventory-table th, .inventory-table td { border: 1px solid #d1d5db; padding: 0.42rem; text-align: left; vertical-align: top; white-space: nowrap; }
          .inventory-table thead th { background: #1f2937; color: #f9fafb; position: sticky; top: 0; z-index: 1; }
          .inventory-table thead .subhead th { background: #374151; font-weight: 600; font-size: 0.7rem; }
          .inventory-table tbody tr:nth-child(even) { background: #f9fafb; }
          .qty, .status-num, .aging, .price { text-align: right; }
          .unique-id-link, .ticket-no-link, .part-no-link, .description-link, .lot-link { color: #111827; text-decoration: none; font-weight: 400; background: none; border: none; padding: 0; cursor: pointer; font: inherit; }
          .unique-id-link:hover, .ticket-no-link:hover, .part-no-link:hover, .description-link:hover, .lot-link:hover { text-decoration: underline; }
          .action-btn { padding: 0.22rem 0.5rem; font-size: 0.72rem; border-radius: 4px; border: 1px solid #ef4444; background: #fee2e2; color: #991b1b; cursor: pointer; }
          .return-btn { padding: 0.22rem 0.5rem; font-size: 0.72rem; border-radius: 4px; border: 1px solid #2563eb; background: #dbeafe; color: #1e40af; cursor: pointer; }
          .history-btn { padding: 0.22rem 0.5rem; font-size: 0.72rem; border-radius: 4px; border: 1px solid #6b7280; background: #f3f4f6; color: #374151; cursor: pointer; }
          .total-row td { background: #e5e7eb; font-weight: 700; }
          .footer-actions { display: flex; gap: 0.6rem; margin-top: 0.8rem; }
          .footer-actions button, .footer-actions a { padding: 0.5rem 0.9rem; border-radius: 6px; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; }
          .notes { margin-top: 0.9rem; font-size: 0.78rem; line-height: 1.45; color: #d1d5db; }
          .notes p { margin: 0.2rem 0; }
          .modal-overlay { display: none; position: fixed; inset: 0; z-index: 1250; background: rgba(0, 0, 0, 0.55); backdrop-filter: blur(4px); align-items: center; justify-content: center; padding: 1rem; }
          .modal-overlay.is-open { display: flex; }
          .modal-dialog { width: min(760px, 100%); background: rgba(17, 24, 39, 0.98); border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 10px; padding: 1rem; color: #fff; }
          .part-info-dialog { width: min(580px, 100%); }
          .row-history-dialog { width: min(1100px, 100%); max-height: 85vh; display: flex; flex-direction: column; }
          .lot-dialog { width: min(760px, 100%); }
          .modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.8rem; gap: 1rem; }
          .modal-header h3 { margin: 0; font-size: 1rem; color: #bfdbfe; }
          .close-btn { border: 1px solid rgba(255, 255, 255, 0.25); background: rgba(255, 255, 255, 0.08); color: #fff; border-radius: 6px; padding: 0.35rem 0.55rem; cursor: pointer; }
          .quick-add { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.6rem; }
          .quick-add-actions, .part-info-actions, .lot-modal-actions { display: flex; justify-content: flex-end; margin-top: 0.8rem; gap: 0.8rem; }
          .quick-add .field label, .part-info-dialog .field label, .lot-dialog .field label { font-size: 0.74rem; font-weight: 700; color: #c7d2fe; letter-spacing: 0.04em; text-transform: uppercase; }
          .part-info-dialog .field input, .part-info-dialog .field select, .lot-dialog .field input { height: 40px; padding: 0.55rem 0.75rem; border-radius: 8px; border: 1px solid rgba(148, 163, 184, 0.4); background: rgba(15, 23, 42, 0.92); color: #f8fafc; font-size: 0.86rem; }
          .part-info-grid { display: grid; grid-template-columns: 1fr; gap: 0.7rem; }
          .part-image-row { display: grid; grid-template-columns: 1fr; gap: 0.5rem; }
          .part-image-note { margin: 0; font-size: 0.76rem; color: #cbd5e1; }
          .part-image-preview { max-width: 180px; max-height: 120px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(15, 23, 42, 0.85); display: none; }
          .part-image-preview.is-visible { display: block; }
          .lot-summary-grid { display: grid; grid-template-columns: repeat(2, minmax(220px, 1fr)); gap: 0.75rem; margin-bottom: 0.9rem; }
          .lot-table { width: 100%; border-collapse: collapse; background: #fff; color: #111827; border-radius: 8px; overflow: hidden; }
          .lot-table th, .lot-table td { border: 1px solid #d1d5db; padding: 0.5rem; text-align: left; }
          .lot-table th { background: #1f2937; color: #f9fafb; }
          .lot-qty-input { width: 100%; max-width: 110px; padding: 0.4rem 0.5rem; border: 1px solid #cbd5e1; border-radius: 6px; }
          .row-history-table-wrap { overflow: auto; flex: 1; margin-top: 0.75rem; border-radius: 8px; }
          .row-history-table { width: 100%; border-collapse: collapse; font-size: 0.73rem; color: #111827; background: #fff; min-width: 1200px; }
          .row-history-table th, .row-history-table td { border: 1px solid #d1d5db; padding: 0.4rem 0.5rem; white-space: nowrap; text-align: left; vertical-align: middle; }
          .row-history-table thead th { background: #1f2937; color: #f9fafb; position: sticky; top: 0; z-index: 1; }
          .row-history-table thead .history-subhead th { background: #374151; font-size: 0.68rem; }
          .qty-header { text-align: center; }
          .new-description-field { grid-column: span 2; }
          .row-history-table .history-qty-header { text-align: center; }
          .no-records { text-align: center; color: #6b7280; padding: 1rem; }
          .footer-copy { margin-top: 1rem; opacity: 0.7; }
          @media (max-width: 768px) { .inventory-panel { padding: 0.75rem; } .search-inline input { min-width: 170px; } .lot-summary-grid { grid-template-columns: 1fr; } }
        `}</style>

        <div className="mb-8">
          <div className="flex items-center gap-3 mb-6">
            <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
              <ChevronLeft className="h-4 w-4" /> Back to Dashboard
            </Link>
          </div>
          <h1 className="text-4xl font-display font-bold tracking-tight mb-2">{sub.title}</h1>
          <p className="text-lg text-muted-foreground">{sub.description}</p>
        </div>

        <div className="inventory-panel">
          <div className="filter-grid">
            <div className="field">
              <label htmlFor="locationFilter">Location</label>
              <select id="locationFilter" value={filters.locationFilter} onChange={(event) => setFilters({ ...filters, locationFilter: event.target.value })}>
                {LOCATION_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="vendorFilter">Vendor</label>
              <input id="vendorFilter" type="text" placeholder="Vendor" value={filters.vendorFilter} onChange={(event) => setFilters({ ...filters, vendorFilter: event.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="branchFilter">Branch</label>
              <input id="branchFilter" type="text" placeholder="Branch" value={filters.branchFilter} onChange={(event) => setFilters({ ...filters, branchFilter: event.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="slowSearch">Search (slow)</label>
              <input id="slowSearch" type="text" placeholder="(id, part #, po #, ticket #)" value={filters.slowSearch} onChange={(event) => setFilters({ ...filters, slowSearch: event.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="uniqueIdSearch">Unique ID</label>
              <input id="uniqueIdSearch" type="text" placeholder="(unique id)" value={filters.uniqueIdSearch} onChange={(event) => setFilters({ ...filters, uniqueIdSearch: event.target.value })} />
            </div>
          </div>

          <div className="panel-actions">
            <button type="button" id="openAddPartModal" className="open-add-btn" onClick={openAddPartModal}>Add New Part</button>
          </div>

          <div className="meta-row">
            <div className="record-count"><span id="recordCount">{filteredRows.length}</span>{filteredRows.length === rows.length ? "" : " (offline sample)"} records found</div>
          </div>

          <div className="tools-row">
            <label><input id="autoSaveToggle" type="checkbox" checked={autoSave} onChange={(event) => setAutoSave(event.target.checked)} /> Auto Save</label>
            <div className="search-inline">
              <span>search in result</span>
              <input id="resultSearch" type="text" placeholder="Search in result" value={filters.resultSearch} onChange={(event) => setFilters({ ...filters, resultSearch: event.target.value })} />
            </div>
          </div>

          <div id="inventoryTableWrap" className="table-wrap table-scroll-wrapper">
            <table className="inventory-table">
              <thead>
                <tr>
                  <th rowSpan={2}>Location</th>
                  <th rowSpan={2}>Part Dist.</th>
                  <th rowSpan={2}>PO No</th>
                  <th rowSpan={2}>Invoice No</th>
                  <th rowSpan={2}>Unique ID</th>
                  <th rowSpan={2}>Part No</th>
                  <th rowSpan={2}>Ticket No</th>
                  <th rowSpan={2}>Aging</th>
                  <th rowSpan={2}>Description</th>
                  <th rowSpan={2}>Branch</th>
                  <th rowSpan={2}>Price</th>
                  <th rowSpan={2}>Lot No</th>
                  <th rowSpan={2}>Adjust Reason</th>
                  <th colSpan={11} className="qty-header">Qty</th>
                  <th rowSpan={2}>Actions</th>
                </tr>
                <tr className="subhead">
                  <th>Ordered</th><th>Received</th><th>Reserved</th><th>Used</th><th>In Review</th><th>Defect</th><th>PNN</th><th>Returned</th><th>Adjust</th><th>Avail</th><th>In Stock</th>
                </tr>
              </thead>
              <tbody id="inventoryBody">
                {filteredRows.length === 0 ? (
                  <tr><td colSpan={24} className="no-records">No records found.</td></tr>
                ) : (
                  filteredRows.map((row) => (
                    <tr key={row.uniqueId}>
                      <td>{row.location}</td>
                      <td>{row.partDist}</td>
                      <td>{row.poNo}</td>
                      <td>{row.invoiceNo}</td>
                      <td><a className="unique-id-link" href={getPartHistoryHref(row.uniqueId)} target="_blank" rel="noreferrer">{row.uniqueId}</a></td>
                      <td><button className="part-no-link" type="button" onClick={() => openPartInfoByUniqueId(row.uniqueId)}>{row.partNo}</button></td>
                      <td>{row.ticketNo ? <a className="ticket-no-link" href={getTicketDetailsHref(parseTicketNoDisplay(row.ticketNo, row.ticketDate).ticketNo)} target="_blank" rel="noreferrer">{parseTicketNoDisplay(row.ticketNo, row.ticketDate).ticketNo}{parseTicketNoDisplay(row.ticketNo, row.ticketDate).suffix ? ` ${parseTicketNoDisplay(row.ticketNo, row.ticketDate).suffix}` : ""}</a> : ""}</td>
                      <td className="aging">{row.aging}</td>
                      <td><button className="description-link" type="button" onClick={() => openPartInfoByUniqueId(row.uniqueId)}>{row.description || ""}</button></td>
                      <td>{row.branch}</td>
                      <td className="price">{formatCurrency(row.price)}</td>
                      <td><button className="lot-link" type="button" onClick={() => openLotInfoByUniqueId(row.uniqueId)}>{row.lotNo}</button></td>
                      <td>{row.adjustReason}</td>
                      <td className="status-num">{row.ordered}</td>
                      <td className="status-num">{row.received}</td>
                      <td className="status-num">{row.reserved}</td>
                      <td className="status-num">{row.used}</td>
                      <td className="status-num">{row.inReview}</td>
                      <td className="status-num">{row.defect}</td>
                      <td className="status-num">{row.pnn}</td>
                      <td className="status-num">{row.returned}</td>
                      <td className="status-num">{row.adjust}</td>
                      <td className="status-num">{row.avail}</td>
                      <td className="status-num">{row.inStock}</td>
                      <td className="action-cell">
                        <button className="action-btn" type="button" onClick={() => deleteRow(row.uniqueId)}>Delete</button>
                        <button className="return-btn" type="button" onClick={() => openPartReturn(row.uniqueId)}>Return</button>
                        <button className="history-btn" type="button" onClick={() => openRowHistory(row.uniqueId)}>History</button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="total-row" id="totalRow">
                  <td colSpan={11}>TOTAL</td>
                  <td className="qty">{totals.lotNo}</td>
                  <td></td>
                  <td className="status-num">{totals.ordered}</td>
                  <td className="status-num">{totals.received}</td>
                  <td className="status-num">{totals.reserved}</td>
                  <td className="status-num">{totals.used}</td>
                  <td className="status-num">{totals.inReview}</td>
                  <td className="status-num">{totals.defect}</td>
                  <td className="status-num">{totals.pnn}</td>
                  <td className="status-num">{totals.returned}</td>
                  <td className="status-num">{totals.adjust}</td>
                  <td className="status-num">{totals.avail}</td>
                  <td className="status-num">{totals.inStock}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="footer-actions">
            <Link to="/m/$module" params={{ module: mod.slug }} className="btn">Return</Link>
            <Link to="/m/$module/$submodule" params={{ module: mod.slug, submodule: "part-history" }} className="btn">History</Link>
          </div>

          <div className="notes">
            <p>102050100100012345678910</p>
            <p>*Note 1: Do you want import Encompass parts that is ordered at Encompass web site? Refresh your inventory and press [Add Encompass P/O #] button.</p>
            <p>*Note 2: Do you want import LG parts that is ordered at GSFS system? Refresh your inventory and press [Add LG P/O #] button.</p>
            <p>*Note 3: Do you want import Marcone parts that is ordered at Marcone web site? Refresh your inventory and press [Add Marcone P/O #] button.</p>
            <p>*Note 4: Do you want import Samsung parts that is ordered at GSPN system? Refresh your inventory and press [Add Samsung P/O #] button.</p>
          </div>

          <div id="inventoryFloatingScrollbar" className="floating-table-scrollbar" aria-hidden="true">
            <div id="inventoryFloatingScrollbarInner" className="floating-table-scrollbar-inner" />
          </div>
        </div>
      </main>

      <div id="addPartModal" className={`modal-overlay ${addOpen ? "is-open" : ""}`}>
        <div className="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="addPartModalTitle">
          <div className="modal-header"><h3 id="addPartModalTitle">Add New Part</h3><button type="button" className="close-btn" onClick={closeAddPartModal}>Close</button></div>
          <div className="quick-add">
            <div className="field"><label htmlFor="newInvoiceNo">(new invoice #)</label><input id="newInvoiceNo" type="text" value={newInvoiceNo} onChange={(event) => setNewInvoiceNo(event.target.value)} /></div>
            <div className="field"><label htmlFor="newPartDist">Part Dist.</label><input id="newPartDist" type="text" placeholder="Distributor/vendor" value={newPartDist} onChange={(event) => setNewPartDist(event.target.value)} /></div>
            <div className="field"><label htmlFor="newPartNo">Part No</label><input id="newPartNo" type="text" placeholder="Part no" value={newPartNo} onChange={(event) => setNewPartNo(event.target.value)} /></div>
            <div className="field"><label htmlFor="newLotNo">Lot No</label><input id="newLotNo" type="number" min="1" step="1" value={newLotNo} onChange={(event) => setNewLotNo(event.target.value)} /></div>
            <div className="field new-description-field"><label htmlFor="newDescription">Description</label><input id="newDescription" type="text" placeholder="Part description" value={newDescription} onChange={(event) => setNewDescription(event.target.value)} /></div>
            <div className="field"><label htmlFor="newPrice">Price</label><input id="newPrice" type="number" step="0.01" min="0" value={newPrice} onChange={(event) => setNewPrice(event.target.value)} /></div>
            <div className="field"><label htmlFor="newQty">Qty</label><input id="newQty" type="number" min="1" step="1" value={newQty} onChange={(event) => setNewQty(event.target.value)} /></div>
          </div>
          <div className="quick-add-actions"><button type="button" className="add-part-btn" onClick={addInvoiceRow}>Add Part</button></div>
        </div>
      </div>

      <div id="partInfoModal" className={`modal-overlay ${partInfoOpen ? "is-open" : ""}`}>
        <div className="modal-dialog part-info-dialog" role="dialog" aria-modal="true" aria-labelledby="partInfoTitle">
          <div className="modal-header"><h3 id="partInfoTitle">{partInfoHeader}</h3><button type="button" className="close-btn" onClick={closePartInfoModal}>Close</button></div>
          <div className="part-info-grid">
            <div className="field"><label htmlFor="partInfoPartNo">Part No</label><input id="partInfoPartNo" type="text" value={partInfoPartNo} onChange={(event) => setPartInfoPartNo(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); searchPartInfoFromInput(); } }} /></div>
            <div className="part-image-row"><div className="field"><label htmlFor="partInfoImage">Part Image</label><input id="partInfoImage" type="file" accept="image/*" onChange={(event) => { const file = event.target.files && event.target.files[0] ? event.target.files[0] : null; if (!file) return; const reader = new FileReader(); reader.onload = (loadEvent) => { const dataUrl = loadEvent.target && loadEvent.target.result ? String(loadEvent.target.result) : ""; setPartInfoImageDataUrl(dataUrl); setPartInfoSavedName(file.name); setPartInfoImageFileName(file.name); }; reader.readAsDataURL(file); }} /><p className="part-image-note">{partInfoSavedName}</p><img className={`part-image-preview ${partInfoImageDataUrl ? "is-visible" : ""}`} src={partInfoImageDataUrl} alt="Part image preview" /></div></div>
            <div className="field"><label id="partInfoDescriptionLabel" htmlFor="partInfoDescription">{partInfoDescriptionLabel}</label><input id="partInfoDescription" type="text" value={partInfoDescription} onChange={(event) => setPartInfoDescription(event.target.value)} /></div>
            <div className="field"><label htmlFor="partInfoUnitPrice">Unit Price (Tax is not included)</label><input id="partInfoUnitPrice" type="number" step="0.01" min="0" value={partInfoUnitPrice} onChange={(event) => setPartInfoUnitPrice(event.target.value)} /></div>
            <div className="field"><label htmlFor="partInfoRetailPrice">Retail Price</label><input id="partInfoRetailPrice" type="number" step="0.01" min="0" value={partInfoRetailPrice} onChange={(event) => setPartInfoRetailPrice(event.target.value)} /></div>
          </div>
          <div className="part-info-actions"><button type="button" className="part-info-save-btn" onClick={() => saveCurrentPartInfo(partInfoImageFileName ? undefined : null)}>Save</button></div>
        </div>
      </div>

      <div id="lotInfoModal" className={`modal-overlay ${lotInfoOpen ? "is-open" : ""}`}>
        <div className="modal-dialog lot-dialog" role="dialog" aria-modal="true" aria-labelledby="lotInfoTitle">
          <div className="modal-header"><h3 id="lotInfoTitle">Part Inventory by Lot</h3><button type="button" className="close-btn" onClick={closeLotInfoModal}>Close</button></div>
          <div className="lot-summary-grid">
            <div className="field"><label htmlFor="lotInfoPartNo">Part No</label><input id="lotInfoPartNo" type="text" readOnly value={lotInfoPartNo} /></div>
            <div className="field"><label htmlFor="lotInfoDescription">Description</label><input id="lotInfoDescription" type="text" readOnly value={lotInfoDescription} /></div>
            <div className="field"><label htmlFor="lotInfoUniqueId">Unique ID</label><input id="lotInfoUniqueId" type="text" readOnly value={lotInfoUniqueId} /></div>
            <div className="field"><label htmlFor="lotInfoQty">Qty</label><input id="lotInfoQty" type="number" readOnly value={sumLotQty(activeLotEntries)} /></div>
          </div>
          <div className="table-wrap">
            <table className="lot-table">
              <thead><tr><th>Lot No</th><th>Qty</th><th>Actions</th></tr></thead>
              <tbody>
                {activeLotEntries.map((entry, index) => (
                  <tr key={`${entry.lotNo}-${index}`}>
                    <td>{entry.lotNo}</td>
                    <td><input className="lot-qty-input" type="number" min="0" step="1" aria-label={`Lot ${entry.lotNo} quantity`} title={`Lot ${entry.lotNo} quantity`} value={entry.qty} onChange={(event) => setActiveLotEntries(activeLotEntries.map((row, rowIndex) => (rowIndex === index ? { ...row, qty: Math.max(0, Number(event.target.value || 0)) } : row)))} /></td>
                    <td><button className="action-btn" type="button" onClick={() => removeLotRow(index)}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="lot-modal-actions"><button type="button" className="lot-set-btn" onClick={setLotInfo}>Set</button></div>
        </div>
      </div>

      <div id="rowHistoryModal" className={`modal-overlay ${rowHistoryOpen ? "is-open" : ""}`}>
        <div className="modal-dialog row-history-dialog" role="dialog" aria-modal="true" aria-labelledby="rowHistoryTitle">
          <div className="modal-header"><h3 id="rowHistoryTitle">Change Log</h3><button type="button" className="close-btn" onClick={closeRowHistoryModal}>Close</button></div>
          <div className="row-history-table-wrap">
            <table className="row-history-table">
              <thead>
                <tr><th rowSpan={2}>Part No</th><th rowSpan={2}>Log Time</th><th rowSpan={2}>Part Dist.</th><th rowSpan={2}>Location</th><th rowSpan={2}>P/O No</th><th rowSpan={2}>P/O Date</th><th rowSpan={2}>Invoice Date</th><th colSpan={11} className="history-qty-header">Qty</th><th rowSpan={2}>Lot No</th><th rowSpan={2}>Modified by</th></tr>
                <tr className="history-subhead"><th>Ordered</th><th>Received</th><th>Reserved</th><th>Review</th><th>Defect</th><th>PNN</th><th>Returned</th><th>Used</th><th>Adjust</th><th>Avail</th><th>In Stock</th></tr>
              </thead>
              <tbody>
                {activeRowHistory.map((entry, index) => (
                  <tr key={`${entry.partNo}-${entry.logTime}-${index}`}>
                    <td>{entry.partNo}</td><td>{entry.logTime}</td><td>{entry.partDist}</td><td>{entry.location}</td><td>{entry.poNo}</td><td>{entry.poDate}</td><td>{entry.invDate}</td><td className="status-num">{entry.ordered}</td><td className="status-num">{entry.received}</td><td className="status-num">{entry.reserved}</td><td className="status-num">{entry.review}</td><td className="status-num">{entry.defect}</td><td className="status-num">{entry.pnn}</td><td className="status-num">{entry.returned}</td><td className="status-num">{entry.used}</td><td className="status-num">{entry.adjust}</td><td className="status-num">{entry.avail}</td><td className="status-num">{entry.inStock}</td><td className="status-num">{entry.lotNo}</td><td>{entry.modifiedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}