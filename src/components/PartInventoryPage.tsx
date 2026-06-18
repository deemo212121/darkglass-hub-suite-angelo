import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

export type PartInventoryRow = {
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

type InventoryRow = PartInventoryRow;

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

// Real Asheville (branch 52) part inventory imported from datagrid export.
// Columns mapped from the CSV: PdName→partDist, PO No→poNo, Invoice No→invoiceNo,
// Unique ID→uniqueId, Part No→partNo, Description→description, Aging→aging,
// Price→price, RetailPrice→retailPrice, OrderQty→ordered, ReceiveQty→received,
// ReserveQty→reserved, UsedQty→used, ReviewQty→inReview, DefectQty→defect,
// PnnQty→pnn, ReturnQty→returned, AdjustQty→adjust, AvailQty→avail,
// CurrentQty→inStock (and qty), Ticket No→ticketNo/ticketDate.
const SAMPLE_ROWS: InventoryRow[] = [
  { location: "Asheville", partDist: "Squaretrade", poNo: "066098174139-1", invoiceNo: "066098174139-1", uniqueId: "066098174139-1-5221DD1001E", partNo: "5221DD1001E", ticketNo: "", aging: 32, description: "VALVE ASSEMBLY INLET", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Marcone-162468", poNo: "1007476334-10-AV", invoiceNo: "74718191", uniqueId: "74718191-1", partNo: "5303918776", ticketNo: "1007476334-10", ticketDate: "06/17", aging: 5, description: "THERMISTOR", branch: "", price: 10.99, retailPrice: 14.99, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Marcone-162468", poNo: "1007476334-10-AV", invoiceNo: "74718191", uniqueId: "74718191-3", partNo: "5304510308", ticketNo: "1007476334-10", ticketDate: "06/17", aging: 5, description: "BOARD ASSEMBLY", branch: "", price: 165.81, retailPrice: 224.44, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Marcone-162468", poNo: "1007476334-10-AV", invoiceNo: "74718191", uniqueId: "74718191-5", partNo: "5304513303", ticketNo: "1007476334-10", ticketDate: "06/17", aging: 5, description: "CONTROL ASSEMBLY", branch: "", price: 146.19, retailPrice: 208.05, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Marcone-162468", poNo: "1005656092-10-GVL-2", invoiceNo: "70930142", uniqueId: "70930142-1", partNo: "5304513459", ticketNo: "", aging: 152, description: "DIODE", branch: "", price: 16.08, retailPrice: 20.99, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Marcone-162468", poNo: "26000778483DF-AV", invoiceNo: "74718456", uniqueId: "74718456-1", partNo: "5304520660", ticketNo: "26000778483DF", aging: 5, description: "SUMP", branch: "", price: 48.64, retailPrice: 68.68, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Marcone-162468", poNo: "1006004792-10-GVL", invoiceNo: "71533990", uniqueId: "71533990-1", partNo: "5304529531", ticketNo: "", aging: 128, description: "STEP VALVE", branch: "", price: 90.85, retailPrice: 132.86, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 1, returned: 0, adjust: -1, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Marcone-162468", poNo: "26000778483DF-AV", invoiceNo: "74718456", uniqueId: "74718456-3", partNo: "A10281701", ticketNo: "26000778483DF", aging: 5, description: "PUMP ASSEMBLY", branch: "", price: 162.56, retailPrice: 220.04, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Marcone-162468", poNo: "1007202534-10-AV", invoiceNo: "74223292", uniqueId: "74223292-2", partNo: "A13805506", ticketNo: "1007439954-10", ticketDate: "06/22", aging: 26, description: "MOTOR", branch: "", price: 57.58, retailPrice: 81.25, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Squaretrade", poNo: "019508664133", invoiceNo: "019508664133-1", uniqueId: "019508664133-1-ADJ75472620", partNo: "ADJ75472620", ticketNo: "", aging: 153, description: "DUCT ASSEMBLY MULTI", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 1, returned: 0, adjust: -1, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Encompass", poNo: "26000780006DF-AV", invoiceNo: "1-471946-0626", uniqueId: "1-471946-0626-1", partNo: "ADX75550519", ticketNo: "26000780006DF", aging: 1, description: "DOOR GASKET", branch: "", price: 71.47, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Squaretrade", poNo: "087466274138-1", invoiceNo: "087466274138-1", uniqueId: "087466274138-1-AEQ73110210", partNo: "AEQ73110210", ticketNo: "", aging: 13, description: "ICE MAKER ASSEMBLY KIT", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 0, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 1, inStock: 1 },
  { location: "Asheville", partDist: "Squaretrade", poNo: "001513454137-2", invoiceNo: "001513454137-2", uniqueId: "001513454137-2-AJU75152602", partNo: "AJU75152602", ticketNo: "", aging: 168, description: "INLET VALVE ASSEMBLY", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 0, used: 0, inReview: 0, defect: 1, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Squaretrade", poNo: "029294764139", invoiceNo: "029294764139", uniqueId: "029294764139-BN59-01341B", partNo: "BN59-01341B", ticketNo: "", aging: 128, description: "NETWORK-WLAN CLIENT", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 1, returned: 0, adjust: -1, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Squaretrade", poNo: "025481354138", invoiceNo: "025481354138", uniqueId: "025481354138-EAU65058502", partNo: "EAU65058502", ticketNo: "", aging: 182, description: "MOTOR ASSEMBLY DC", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 1, returned: 0, adjust: -1, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Encompass", poNo: "25000560068DF-CB", invoiceNo: "6-870521-0625", uniqueId: "6-870521-0625-1", partNo: "EBF62174907", ticketNo: "", aging: 369, description: "SWITCH,ROTARY", branch: "", price: 52.74, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 0, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 1, inStock: 1 },
  { location: "Asheville", partDist: "Squaretrade", poNo: "019508664133", invoiceNo: "019508664133-2", uniqueId: "019508664133-2-EBG63205845", partNo: "EBG63205845", ticketNo: "", aging: 153, description: "THERMISTOR ASSEMBLY PTC", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 1, returned: 0, adjust: -1, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "NSA", poNo: "HAP20260635422460_1", invoiceNo: "0083535607", uniqueId: "0083535607-K1980380", partNo: "K1980380", ticketNo: "HAP20260635422460", ticketDate: "06/22", aging: 0, description: "compressor parts", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "NSA", poNo: "HAP20260534580625_1", invoiceNo: "0083498230", uniqueId: "0083498230-K2272720", partNo: "K2272720", ticketNo: "", aging: 0, description: "AUTOMATIC ICE MAKER COMPONENT", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "NSA", poNo: "HAP20260635422460_1", invoiceNo: "0083535607", uniqueId: "0083535607-K2482786", partNo: "K2482786", ticketNo: "HAP20260635422460", ticketDate: "06/22", aging: 0, description: "DRY FILTER", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 2, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: -1, inStock: 1 },
  { location: "Asheville", partDist: "NSA", poNo: "HAP20260635422460_1", invoiceNo: "0083535607", uniqueId: "0083535607-K2483014", partNo: "K2483014", ticketNo: "HAP20260635422460", ticketDate: "06/22", aging: 0, description: "COPPER COMPOSITE RING 7#", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 2, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: -1, inStock: 1 },
  { location: "Asheville", partDist: "NSA", poNo: "HAP20260635422460_1", invoiceNo: "0083535607", uniqueId: "0083535607-K2483024", partNo: "K2483024", ticketNo: "HAP20260635422460", ticketDate: "06/22", aging: 0, description: "COPPER COMPOSITE RING 6#", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "NSA", poNo: "HAP20260635422460_1", invoiceNo: "0083535607", uniqueId: "0083535607-K2505601", partNo: "K2505601", ticketNo: "HAP20260635422460", ticketDate: "06/22", aging: 0, description: "LOKRING 1,8 NK Ms 00 Straight brass conn", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "NSA", poNo: "HAP20260635422460_1", invoiceNo: "0083535607", uniqueId: "0083535607-K2505608", partNo: "K2505608", ticketNo: "HAP20260635422460", ticketDate: "06/22", aging: 0, description: "LOKRING 5/4 NR Ms 00 Straight brass redu", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "SB", poNo: "9550972-2", invoiceNo: "SNWTC4C53A78-2", uniqueId: "SNWTC4C53A78-2-MJX41869202", partNo: "MJX41869202", ticketNo: "", aging: 125, description: "VALVE,WATER", branch: "", price: 83.2, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 0, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 1, inStock: 1 },
  { location: "Asheville", partDist: "SB", poNo: "9535910-1", invoiceNo: "SNWTC4C53A78-2-1", uniqueId: "SNWTC4C53A78-2-1-MJX61892901", partNo: "MJX61892901", ticketNo: "", aging: 125, description: "VALVE,WATER", branch: "", price: 54.49, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 0, used: 0, inReview: 0, defect: 1, pnn: 0, returned: 0, adjust: 0, avail: 1, inStock: 1 },
  { location: "Asheville", partDist: "NSA", poNo: "HIS20260332692862_1", invoiceNo: "0083510918", uniqueId: "0083510918-T327316", partNo: "T327316", ticketNo: "", aging: 0, description: "TCON BOARD RSAG2.908.12804TP ROH", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "NSA", poNo: "HIS20260332692862_1", invoiceNo: "0083510918", uniqueId: "0083510918-T336431", partNo: "T336431", ticketNo: "", aging: 0, description: "Main Board Assembly 55A53FUA(0018)", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "NSA", poNo: "HIS20260332692862_1", invoiceNo: "0083510918", uniqueId: "0083510918-T342388", partNo: "T342388", ticketNo: "", aging: 0, description: "LVDS Cable Assembly 55A53FUA(0018)", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "NSA", poNo: "HIS20260534427521_1", invoiceNo: "0083510913", uniqueId: "0083510913-T448205", partNo: "T448205", ticketNo: "", aging: 0, description: "Main Board Large component 50A60QUA(01)", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Encompass", poNo: "26000755815DF-AV-2", invoiceNo: "1-456876-0626", uniqueId: "1-456876-0626-3", partNo: "W10721967", ticketNo: "26000755815DF", ticketDate: "06/18", aging: 5, description: "WASHING MACHINE DRIVE PULLEY CLUTCH", branch: "", price: 16.18, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Encompass", poNo: "26000789954DF-AV", invoiceNo: "1-452486-0626", uniqueId: "1-452486-0626-2", partNo: "W10734521", ticketNo: "26000789954DF", ticketDate: "06/19", aging: 6, description: "SLIDER", branch: "", price: 23.64, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Encompass", poNo: "26000789954DF-AV", invoiceNo: "1-452486-0626", uniqueId: "1-452486-0626-1", partNo: "W10754448", ticketNo: "26000789954DF", ticketDate: "06/19", aging: 6, description: "CLUTCH", branch: "", price: 63.32, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Squaretrade", poNo: "010194764138-2", invoiceNo: "010194764138-2", uniqueId: "010194764138-2-W11396717", partNo: "W11396717", ticketNo: "", aging: 138, description: "PUMP-WATER", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 1, returned: 0, adjust: -1, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Encompass", poNo: "26000783620DF-AV", invoiceNo: "1-465358-0626", uniqueId: "1-465358-0626-1", partNo: "W11400156", ticketNo: "26000783620DF", ticketDate: "06/18", aging: 2, description: "DAMPER ASM - VERT SUSP", branch: "", price: 53.47, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Squaretrade", poNo: "074157174136-1", invoiceNo: "074157174136-1", uniqueId: "074157174136-1-W11412291", partNo: "W11412291", ticketNo: "", aging: 22, description: "MOTOR PUMP", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Encompass", poNo: "26000755815DF-AV-2", invoiceNo: "1-456876-0626", uniqueId: "1-456876-0626-2", partNo: "W11481722", ticketNo: "26000755815DF", ticketDate: "06/18", aging: 5, description: "ACTUATOR - SHIFT (120V/60HZ)", branch: "", price: 45.03, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Squaretrade", poNo: "010194764138-1", invoiceNo: "010194764138-1", uniqueId: "010194764138-1-W11543996", partNo: "W11543996", ticketNo: "", aging: 138, description: "CNTRL-ELEC", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 1, returned: 0, adjust: -1, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Squaretrade", poNo: "062166764134-1", invoiceNo: "062166764134-1", uniqueId: "062166764134-1-W11557935", partNo: "W11557935", ticketNo: "", aging: 140, description: "ACU PRGM ASSEMBLY GL WTW5100 D2 VMAX2", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 1, returned: 0, adjust: -1, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Encompass", poNo: "26000789954DF-AV", invoiceNo: "1-452486-0626", uniqueId: "1-452486-0626-3", partNo: "W11568984", ticketNo: "26000789954DF", ticketDate: "06/19", aging: 6, description: "WIRE HARNESS", branch: "", price: 38.35, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Encompass", poNo: "26000769594DFB-AV", invoiceNo: "12-641121-0626", uniqueId: "12-641121-0626-1", partNo: "W11580057", ticketNo: "26000769594DFB", ticketDate: "06/23", aging: 2, description: "COMPRESSOR ASSEMBLY TB1114HY 120V/60HZ", branch: "", price: 201.18, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Encompass", poNo: "26000755670DF-AV", invoiceNo: "1-458682-0626", uniqueId: "1-458682-0626-1", partNo: "W11626074", ticketNo: "26000755670DF", ticketDate: "06/18", aging: 5, description: "PRGM ACU ASM, BM(DK), MVW4505, MTG2022 3", branch: "", price: 131.63, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Encompass", poNo: "26000755815DF-AV-2", invoiceNo: "1-456876-0626", uniqueId: "1-456876-0626-1", partNo: "W11643701", ticketNo: "26000755815DF", ticketDate: "06/18", aging: 5, description: "HARN LOWER 4.7/4.8", branch: "", price: 40.25, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Encompass", poNo: "26000755670DF-AV", invoiceNo: "1-458682-0626", uniqueId: "1-458682-0626-2", partNo: "W11670519", ticketNo: "26000755670DF", ticketDate: "06/18", aging: 5, description: "LID LOCK 120V UL JOURNEY", branch: "", price: 26.98, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "GE", poNo: "", invoiceNo: "19996781", uniqueId: "19996781-WB27X50469", partNo: "WB27X50469", ticketNo: "", aging: 137, description: "INDUCTION CONTROL TRAY", branch: "", price: 381.3, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Squaretrade", poNo: "051727764133-1", invoiceNo: "051727764133-1", uniqueId: "051727764133-1-WD21X25468", partNo: "WD21X25468", ticketNo: "", aging: 140, description: "PRESSURE SENSOR ASM", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 1, returned: 0, adjust: -1, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Squaretrade", poNo: "048143864134", invoiceNo: "048143864134-1", uniqueId: "048143864134-1-WE03X27417", partNo: "WE03X27417", ticketNo: "", aging: 129, description: "IDLER ARM ASM", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 1, returned: 0, adjust: -1, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Squaretrade", poNo: "048143864134", invoiceNo: "048143864134-2", uniqueId: "048143864134-2-WE03X29897", partNo: "WE03X29897", ticketNo: "", aging: 129, description: "BELT DRIVE", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 1, returned: 0, adjust: -1, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Squaretrade", poNo: "065804764138-1", invoiceNo: "065804764138-1", uniqueId: "065804764138-1-WE21X23869", partNo: "WE21X23869", ticketNo: "", aging: 142, description: "DRUM ASM", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 1, returned: 0, adjust: -1, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Squaretrade", poNo: "045327874132", invoiceNo: "045327874132", uniqueId: "045327874132-WH01X29615", partNo: "WH01X29615", ticketNo: "", aging: 36, description: "INNER GASKET CLAMP", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Squaretrade", poNo: "045327874132", invoiceNo: "045327874132", uniqueId: "045327874132-WH05X29620", partNo: "WH05X29620", ticketNo: "", aging: 36, description: "TUB SEAL", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Squaretrade", poNo: "045327874132", invoiceNo: "045327874132", uniqueId: "045327874132-WH05X35706", partNo: "WH05X35706", ticketNo: "", aging: 36, description: "TUB GASKET (COMBO)", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Encompass", poNo: "BX39951RHD41-AV", invoiceNo: "1-456874-0626", uniqueId: "1-456874-0626-1", partNo: "WH11X39237", ticketNo: "BX39951RHD41", ticketDate: "06/17", aging: 5, description: "DRAIN PUMP & FILTER", branch: "", price: 55.89, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Squaretrade", poNo: "045327874132", invoiceNo: "045327874132", uniqueId: "045327874132-WH21X35696", partNo: "WH21X35696", ticketNo: "", aging: 36, description: "REAR TUB ASSEMBLY", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Encompass-Birmingham / Montgomery", poNo: "NOSCHEDULE-24000044235DF", invoiceNo: "1-308077-0124", uniqueId: "1-308077-0124-1", partNo: "WH22X35837", ticketNo: "", aging: 874, description: "INVERTER BOARD", branch: "", price: 90.39, qty: 2, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 0, used: 0, inReview: 1, defect: 0, pnn: 0, returned: 1, adjust: 1, avail: 1, inStock: 2 },
  { location: "Asheville", partDist: "Encompass", poNo: "BX39951RHD41-AV", invoiceNo: "1-456874-0626", uniqueId: "1-456874-0626-2", partNo: "WH41X38919", ticketNo: "BX39951RHD41", ticketDate: "06/17", aging: 5, description: "EXTERNAL DRAIN HOSE COMBO", branch: "", price: 14.14, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "Encompass", poNo: "26000789634DF-AV", invoiceNo: "1-451724-0626", uniqueId: "1-451724-0626-1", partNo: "WR30X39345", ticketNo: "26000789634DF", ticketDate: "06/18", aging: 6, description: "SMALL CUBE ICEMAKER", branch: "", price: 89.75, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "GE", poNo: "SA-3277155-AV-2", invoiceNo: "1067608508", uniqueId: "1067608508-WR55X31998", partNo: "WR55X31998", ticketNo: "", aging: 15, description: "CEILING LED", branch: "", price: 12.33, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 0, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 1, inStock: 1 },
  { location: "Asheville", partDist: "GE", poNo: "SA-3277155-AV-2", invoiceNo: "1067608508", uniqueId: "1067608508-WR55X48170", partNo: "WR55X48170", ticketNo: "", aging: 15, description: "TOP CENTER HINGE COVER W/HARNESS AND SW", branch: "", price: 33.2, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 0, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 1, inStock: 1 },
  { location: "Asheville", partDist: "Squaretrade", poNo: "046838664137-2", invoiceNo: "046838664137-2", uniqueId: "046838664137-2-WR60X10307", partNo: "WR60X10307", ticketNo: "", aging: 159, description: "REFRIGERATOR EVAPORATOR FAN MOTOR", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 0, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 1, inStock: 1 },
  { location: "Asheville", partDist: "Squaretrade", poNo: "046838664137-1", invoiceNo: "046838664137-1", uniqueId: "046838664137-1-WR60X30922", partNo: "WR60X30922", ticketNo: "", aging: 159, description: "BLADE FAN", branch: "", price: 0, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 0, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 1, inStock: 1 },
  { location: "Asheville", partDist: "GE", poNo: "SA-3702828-AV", invoiceNo: "1068038744", uniqueId: "1068038744-WR87X46051", partNo: "WR87X46051", ticketNo: "SA-3702828", ticketDate: "06/24", aging: 0, description: "COMPRESSOR", branch: "", price: 123.45, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
  { location: "Asheville", partDist: "GE", poNo: "075675965-GVL", invoiceNo: "182368216", uniqueId: "182368216-WR87X47505", partNo: "WR87X47505", ticketNo: "", aging: 137, description: "EVAP AND TUBE ASM", branch: "", price: 73.81, qty: 1, lotNo: 1, adjustReason: "", ordered: 1, received: 1, reserved: 1, used: 0, inReview: 0, defect: 0, pnn: 0, returned: 0, adjust: 0, avail: 0, inStock: 1 },
];

// Shared accessor so other pages (e.g. Part In/Out History) can search the
// same inventory records. Returns a shallow copy of the seed inventory rows.
export function getPartInventoryRows(): PartInventoryRow[] {
  return SAMPLE_ROWS.map((row) => ({ ...row }));
}

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