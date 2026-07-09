import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

type ReturnRow = {
  account: string;
  uniqueId: string;
  partNo: string;
  description: string;
  lotNo: string;
  inventory: number;
  reservedInv: number;
  ticketNo: string;
  partStatus: string;
  invoiceDate: string;
  modelCode: string;
  aging: number;
  reason: string;
  returnQty: number;
  raNo: string;
  returnRecd: number;
  inReview: number;
  defect: number;
  pnn: number;
  current: number;
  reserved: number;
  provider: string;
  location: string;
};

type CoreReturnRow = {
  id: number;
  ticketNo: string;
  uniqueId: string;
  partNo: string;
  description: string;
  invoiceDate: string;
  returnQty: number;
  coreValue: number;
  partStatus: string;
  scheduleDate: string;
  technician: string;
  coreRaNo: string;
  provider: string;
  location: string;
};

const RECORDS: ReturnRow[] = [
  { account: "272467", uniqueId: "12-587529-0426-1", partNo: "11002012025802", description: "", lotNo: "C4", inventory: 1, reservedInv: 0, ticketNo: "", partStatus: "", invoiceDate: "2026-04-30", modelCode: "MLE45N3BWW", aging: 14, reason: "(No Defect - Good Unused)", returnQty: 1, raNo: "", returnRecd: 0, inReview: 0, defect: 0, pnn: 0, current: 1, reserved: 0, provider: "Encompass", location: "Asheville" },
  { account: "273746", uniqueId: "6-283031-0326-1", partNo: "140173679014", description: "", lotNo: "Defect(1)", inventory: 1, reservedInv: 0, ticketNo: "1006449532-10", partStatus: "Lost", invoiceDate: "2026-03-16", modelCode: "GCRE3060BF", aging: 59, reason: "(No Defect - Good Unused)", returnQty: 1, raNo: "", returnRecd: 0, inReview: 0, defect: 1, pnn: 0, current: 1, reserved: 0, provider: "Encompass", location: "Asheville" },
  { account: "272467", uniqueId: "1-988071-0326-2", partNo: "241734001", description: "", lotNo: "InReview(1) Defect(1)", inventory: 1, reservedInv: 1, ticketNo: "26000383486DF", partStatus: "Defective", invoiceDate: "2026-03-20", modelCode: "LFSS2612TE0", aging: 55, reason: "(No Defect - Good Unused)", returnQty: 1, raNo: "", returnRecd: 0, inReview: 1, defect: 1, pnn: 0, current: 1, reserved: 0, provider: "Encompass", location: "Asheville" },
  { account: "272467", uniqueId: "1-114170-0326-1", partNo: "242095406", description: "", lotNo: "", inventory: 2, reservedInv: 0, ticketNo: "1006541105-10", partStatus: "RA - PNN", invoiceDate: "2026-03-26", modelCode: "GRSS2652AF", aging: 49, reason: "(No Defect - Good Unused)", returnQty: 1, raNo: "1-03253", returnRecd: 0, inReview: 0, defect: 0, pnn: 0, current: 1, reserved: 0, provider: "Encompass", location: "Asheville" },
  { account: "272467", uniqueId: "1-129819-0326-1", partNo: "242095423", description: "", lotNo: "A3", inventory: 3, reservedInv: 0, ticketNo: "26000409390DF", partStatus: "RA - PNN", invoiceDate: "2026-03-30", modelCode: "GRFS28553AF4", aging: 45, reason: "(No Defect - Good Unused)", returnQty: 1, raNo: "1-50442", returnRecd: 0, inReview: 0, defect: 0, pnn: 0, current: 1, reserved: 0, provider: "Encompass", location: "Asheville" },
  { account: "272467", uniqueId: "1-988071-0326-1", partNo: "242221501", description: "", lotNo: "Defect(1)", inventory: 1, reservedInv: 0, ticketNo: "26000383486DF", partStatus: "Defective", invoiceDate: "2026-03-20", modelCode: "LFSS2612TE0", aging: 55, reason: "(No Defect - Good Unused)", returnQty: 1, raNo: "", returnRecd: 0, inReview: 0, defect: 1, pnn: 0, current: 1, reserved: 0, provider: "Encompass", location: "Asheville" },
  { account: "272467", uniqueId: "1-219413-0426-2", partNo: "35535", description: "", lotNo: "PNN(1)", inventory: 1, reservedInv: 0, ticketNo: "2345457", partStatus: "RA - Qty Discrepancy", invoiceDate: "2026-04-17", modelCode: "AWN632SP116TB02", aging: 27, reason: "(No Defect - Good Unused)", returnQty: 1, raNo: "", returnRecd: 0, inReview: 0, defect: 0, pnn: 1, current: 1, reserved: 0, provider: "Encompass", location: "Asheville" },
  { account: "273746", uniqueId: "1-281829-0526-1", partNo: "5304519235", description: "", lotNo: "", inventory: 2, reservedInv: 0, ticketNo: "26000287987DF", partStatus: "RA - PNN", invoiceDate: "2026-05-01", modelCode: "FFBD2420UB0A", aging: 13, reason: "(No Defect - Good Unused)", returnQty: 2, raNo: "", returnRecd: 0, inReview: 0, defect: 0, pnn: 0, current: 2, reserved: 0, provider: "Encompass", location: "Asheville" },
  { account: "273746", uniqueId: "1-201402-0426-2", partNo: "5304519235", description: "", lotNo: "", inventory: 2, reservedInv: 0, ticketNo: "26000287987DF", partStatus: "RA - PNN", invoiceDate: "2026-04-14", modelCode: "FFBD2420UB0A", aging: 30, reason: "(No Defect - Good Unused)", returnQty: 2, raNo: "", returnRecd: 0, inReview: 0, defect: 0, pnn: 0, current: 2, reserved: 0, provider: "Encompass", location: "Asheville" },
  { account: "273746", uniqueId: "1-944656-0326-1", partNo: "5304519271", description: "", lotNo: "", inventory: 1, reservedInv: 0, ticketNo: "", partStatus: "", invoiceDate: "2026-03-11", modelCode: "FFBD2420UB0A", aging: 64, reason: "(No Defect - Good Unused)", returnQty: 1, raNo: "", returnRecd: 0, inReview: 0, defect: 0, pnn: 0, current: 1, reserved: 0, provider: "Encompass", location: "Asheville" },
  { account: "272467", uniqueId: "17-764059-0226-1", partNo: "5304519906", description: "", lotNo: "", inventory: 1, reservedInv: 0, ticketNo: "", partStatus: "", invoiceDate: "2026-02-25", modelCode: "LFID2426TF6A", aging: 78, reason: "(No Defect - Good Unused)", returnQty: 1, raNo: "", returnRecd: 0, inReview: 0, defect: 0, pnn: 0, current: 1, reserved: 0, provider: "Encompass", location: "Asheville" },
];

const CORE_RECORDS: CoreReturnRow[] = [
  { id: 11970, ticketNo: "23001002155DF", uniqueId: "17-235505-1123-1", partNo: "W11419171", description: "CNTRL-ELEC", invoiceDate: "", returnQty: 1, coreValue: 60, partStatus: "Claimed", scheduleDate: "12/16/2023", technician: "Christopher Bowles", coreRaNo: "", provider: "Encompass", location: "Asheville" },
  { id: 35760, ticketNo: "24000316787DF", uniqueId: "1-552626-0324-1", partNo: "W11513246", description: "CNTRL-ELEC", invoiceDate: "", returnQty: 1, coreValue: 60, partStatus: "Claimed", scheduleDate: "04/30/2024", technician: "Christian Newson", coreRaNo: "", provider: "Encompass", location: "Asheville" },
  { id: 41212, ticketNo: "47039494", uniqueId: "1-888503-1123-1", partNo: "W10906422", description: "CNTRL-ELEC", invoiceDate: "", returnQty: 1, coreValue: 60, partStatus: "Claimed", scheduleDate: "", technician: "", coreRaNo: "", provider: "Encompass", location: "Asheville" },
  { id: 48983, ticketNo: "24000537178DF", uniqueId: "17-271478-0124-1", partNo: "W11419171", description: "CNTRL-ELEC", invoiceDate: "", returnQty: 1, coreValue: 60, partStatus: "Claimed", scheduleDate: "07/10/2024", technician: "Jesse Thomason", coreRaNo: "", provider: "Encompass", location: "Asheville" },
  { id: 52580, ticketNo: "24000602438DF", uniqueId: "1-905998-1123-1", partNo: "W11654023", description: "CNTRL-ELEC", invoiceDate: "", returnQty: 1, coreValue: 60, partStatus: "Used", scheduleDate: "", technician: "", coreRaNo: "", provider: "Encompass", location: "Asheville" },
  { id: 59478, ticketNo: "24000786518DF", uniqueId: "1-853047-1023-1", partNo: "W11325569", description: "CNTRL-ELEC", invoiceDate: "", returnQty: 1, coreValue: 60, partStatus: "Claimed", scheduleDate: "09/09/2024", technician: "Carlon Ellis", coreRaNo: "", provider: "Encompass", location: "Asheville" },
  { id: 59998, ticketNo: "24000800384DF", uniqueId: "1-594952-0424-1", partNo: "W11510463", description: "CNTRL-ELEC", invoiceDate: "", returnQty: 1, coreValue: 60, partStatus: "Claimed", scheduleDate: "09/13/2024", technician: "Christian Eckwright", coreRaNo: "", provider: "Encompass", location: "Asheville" },
  { id: 60496, ticketNo: "24000806676DF", uniqueId: "1-421553-0224-2", partNo: "W11621180", description: "CONTROL BOARD", invoiceDate: "", returnQty: 1, coreValue: 60, partStatus: "Claimed", scheduleDate: "09/13/2024", technician: "Tavon Baker", coreRaNo: "", provider: "Encompass", location: "Asheville" },
  { id: 60952, ticketNo: "24000817039DF", uniqueId: "6-358366-0224-3", partNo: "W11543994", description: "CNTRL-ELEC", invoiceDate: "", returnQty: 1, coreValue: 60, partStatus: "Claimed", scheduleDate: "09/17/2024", technician: "Gabriel Mulkey", coreRaNo: "", provider: "Encompass", location: "Asheville" },
  { id: 61917, ticketNo: "24000830365DF", uniqueId: "1-842709-0624-1", partNo: "W11419171", description: "CNTRL-ELEC", invoiceDate: "", returnQty: 1, coreValue: 60, partStatus: "Claimed", scheduleDate: "09/23/2024", technician: "Baolin Henry Zhang", coreRaNo: "", provider: "Encompass", location: "Asheville" },
  { id: 71087, ticketNo: "24001012049DF", uniqueId: "1-330189-0124-1", partNo: "W11419171", description: "CNTRL-ELEC", invoiceDate: "", returnQty: 1, coreValue: 60, partStatus: "Claimed", scheduleDate: "", technician: "", coreRaNo: "", provider: "Encompass", location: "Asheville" },
  { id: 73097, ticketNo: "24001011835DF", uniqueId: "1-458578-0324-2", partNo: "W11542754", description: "PANEL-UI", invoiceDate: "", returnQty: 1, coreValue: 60, partStatus: "Claimed", scheduleDate: "12/04/2024", technician: "Elisha Rhett", coreRaNo: "", provider: "Encompass", location: "Asheville" },
  { id: 76864, ticketNo: "24001125787DF", uniqueId: "1-787396-1023-2", partNo: "W11478524", description: "PANEL-UI", invoiceDate: "", returnQty: 1, coreValue: 60, partStatus: "Claimed", scheduleDate: "12/21/2024", technician: "Nelson Ogutu", coreRaNo: "", provider: "Encompass", location: "Asheville" },
  { id: 78066, ticketNo: "24001161460DF", uniqueId: "1-458578-0324-1", partNo: "W11043763", description: "CNTRL-ELEC", invoiceDate: "", returnQty: 1, coreValue: 60, partStatus: "Claimed", scheduleDate: "01/03/2025", technician: "Nick Villegas", coreRaNo: "", provider: "Encompass", location: "Asheville" },
  { id: 91903, ticketNo: "25000230723DF", uniqueId: "6-521395-0724-2", partNo: "W11556725", description: "CNTRL-ELEC", invoiceDate: "", returnQty: 1, coreValue: 60, partStatus: "Claimed", scheduleDate: "03/12/2025", technician: "Darryel Burdette", coreRaNo: "", provider: "Encompass", location: "Asheville" },
];

const PROVIDERS = ["Encompass", "Marcone", "GE", "LG", "Other"];
const LOCATIONS = ["Asheville", "Birmingham", "Atlanta", "Dallas"];
const REASONS = ["(No Defect - Good Unused)", "Defective", "Wrong Part", "Damaged in Shipping", "Customer Cancel"];

function formatDate(value: string) {
  if (!value) return "";
  return value;
}

export function PartReturnPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [activeView, setActiveView] = useState<"part" | "core">("part");
  const [provider, setProvider] = useState("Encompass");
  const [location, setLocation] = useState("Asheville");
  const [agingFrom, setAgingFrom] = useState("0");
  const [agingTo, setAgingTo] = useState("90");
  const [uniqueSearch, setUniqueSearch] = useState("");
  const [searchInResult, setSearchInResult] = useState("");
  const [includeReturned, setIncludeReturned] = useState(false);
  const [includeReserved, setIncludeReserved] = useState(false);

  const filtered = useMemo(() => {
    const from = Number(agingFrom || 0);
    const to = Number(agingTo || 9999);
    const uniqueTerm = uniqueSearch.trim().toLowerCase();
    const resultTerm = searchInResult.trim().toLowerCase();

    return RECORDS.filter((row) => {
      if (provider && row.provider !== provider) return false;
      if (location && row.location !== location) return false;
      if (row.aging < from || row.aging > to) return false;
      if (!includeReturned && row.returnRecd > 0) return false;
      if (!includeReserved && row.reserved > 0) return false;

      if (uniqueTerm) {
        const uniqueBag = `${row.uniqueId} ${row.raNo}`.toLowerCase();
        if (!uniqueBag.includes(uniqueTerm)) return false;
      }

      if (resultTerm) {
        const resultBag = [
          row.uniqueId,
          row.partNo,
          row.description,
          row.lotNo,
          row.ticketNo,
          row.partStatus,
          row.invoiceDate,
          row.aging,
          row.returnQty,
          row.raNo,
          row.returnRecd,
          row.inReview,
          row.defect,
          row.pnn,
          row.current,
          row.reserved,
        ].join(" ").toLowerCase();
        if (!resultBag.includes(resultTerm)) return false;
      }

      return true;
    });
  }, [agingFrom, agingTo, includeReturned, includeReserved, location, provider, searchInResult, uniqueSearch]);

  const coreFiltered = useMemo(() => {
    const uniqueTerm = uniqueSearch.trim().toLowerCase();
    const resultTerm = searchInResult.trim().toLowerCase();

    return CORE_RECORDS.filter((row) => {
      if (provider && row.provider !== provider) return false;
      if (location && row.location !== location) return false;

      if (uniqueTerm) {
        const uniqueBag = `${row.uniqueId} ${row.coreRaNo}`.toLowerCase();
        if (!uniqueBag.includes(uniqueTerm)) return false;
      }

      if (resultTerm) {
        const resultBag = [row.id, row.ticketNo, row.uniqueId, row.partNo, row.description, row.partStatus, row.technician, row.coreRaNo].join(" ").toLowerCase();
        if (!resultBag.includes(resultTerm)) return false;
      }

      return true;
    });
  }, [location, provider, searchInResult, uniqueSearch]);

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <style>{`
          .return-panel {
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 10px;
            padding: 1.2rem;
            color: #fff;
            backdrop-filter: blur(10px);
          }
          .controls-grid { display: grid; grid-template-columns: minmax(190px, 220px) minmax(160px, 180px) minmax(280px, 340px) minmax(260px, 1fr); gap: 0.9rem; align-items: end; }
          .control-group { display: flex; flex-direction: column; gap: 0.35rem; }
          .control-group label { font-size: 0.8rem; font-weight: 600; color: #e5e7eb; white-space: nowrap; }
          .required::after { content: " *"; color: #ef4444; }
          .control-group input, .control-group select { width: 100%; padding: 0.62rem 0.72rem; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(17, 24, 39, 0.95); color: #fff; font-size: 0.88rem; }
          .aging-control { flex-direction: row; align-items: center; gap: 0.55rem; }
          .aging-control .aging-label { flex: 0 0 auto; margin-bottom: 0; }
          .aging-range { display: flex; align-items: center; gap: 0.35rem; min-width: 0; flex: 1; }
          .aging-range input { min-width: 0; }
          .aging-range input:first-child, .aging-range input:last-child { width: 100%; }
          .aging-range span { color: #94a3b8; font-weight: 700; font-size: 0.92rem; flex: 0 0 auto; }
          .option-row { display: flex; align-items: center; justify-content: space-between; gap: 0.8rem; margin-top: 0.7rem; flex-wrap: wrap; }
          .option-group { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; font-size: 0.84rem; }
          .option-group label { display: inline-flex; align-items: center; gap: 0.35rem; color: #dbeafe; cursor: pointer; }
          .view-switch-section {
            margin-top: 1.15rem;
            padding: 0.95rem 1rem;
            border-radius: 10px;
            border: 1px solid rgba(255, 255, 255, 0.12);
            background: rgba(15, 23, 42, 0.55);
          }
          .section-label {
            font-size: 0.82rem;
            font-weight: 700;
            color: #cbd5e1;
            margin-bottom: 0.7rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          .view-switch { display: flex; gap: 0.55rem; flex-wrap: wrap; }
          .view-btn {
            padding: 0.48rem 0.95rem;
            border-radius: 999px;
            border: 1px solid rgba(255, 255, 255, 0.22);
            background: rgba(17, 24, 39, 0.95);
            color: #cbd5e1;
            font-size: 0.82rem;
            font-weight: 700;
            cursor: pointer;
            transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
          }
          .view-btn:hover {
            transform: translateY(-1px);
            border-color: rgba(96, 165, 250, 0.42);
            background: rgba(20, 28, 46, 0.98);
            color: #fff;
            box-shadow: 0 8px 18px rgba(15, 23, 42, 0.18);
          }
          .view-btn.active {
            background: linear-gradient(135deg, rgba(30, 64, 175, 0.95) 0%, rgba(37, 99, 235, 0.9) 100%);
            border-color: rgba(96, 165, 250, 0.72);
            color: #fff;
            box-shadow: 0 10px 22px rgba(37, 99, 235, 0.28);
          }
          .return-title { margin-top: 0.9rem; font-size: 1rem; font-weight: 700; color: #fff; }
          .meta-row { display: flex; justify-content: space-between; align-items: center; gap: 0.8rem; margin: 0.65rem 0 0.9rem; flex-wrap: wrap; }
          .record-count { font-size: 0.88rem; font-weight: 600; color: #bfdbfe; }
          .meta-row input { min-width: 220px; padding: 0.56rem 0.68rem; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(17, 24, 39, 0.95); color: #fff; font-size: 0.84rem; }
          .table-wrap { overflow-x: auto; }
          table.return-table { width: 100%; border-collapse: collapse; background: #fff; color: #1f2937; border-radius: 8px; overflow: hidden; }
          .return-table th, .return-table td { border: 1px solid #d1d5db; padding: 0.42rem 0.52rem; font-size: 0.74rem; white-space: nowrap; vertical-align: top; }
          .return-table th { background: #f3f4f6; font-weight: 700; text-align: center; }
          .inventory-subhead th { background: #e5e7eb; font-size: 0.7rem; }
          .reason-select { padding: 0.26rem 0.34rem; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 0.72rem; }
          .return-btn {
            padding: 0.34rem 0.7rem;
            font-size: 0.72rem;
            font-weight: 800;
            border-radius: 6px;
            border: 1px solid rgba(147, 197, 253, 0.72);
            background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
            color: #fff;
            cursor: pointer;
            box-shadow: 0 6px 14px rgba(37, 99, 235, 0.18);
            transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
          }
          .return-btn:hover:not(:disabled) {
            transform: translateY(-1px);
            box-shadow: 0 8px 18px rgba(37, 99, 235, 0.28);
            background: linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%);
          }
          .return-btn:disabled { opacity: 0.55; cursor: not-allowed; box-shadow: none; }
          .back-link {
            display: inline-flex;
            align-items: center;
            gap: 0.4rem;
            padding: 0.5rem 0.85rem;
            border-radius: 10px;
            border: 1px solid rgba(255, 255, 255, 0.16);
            background: rgba(255, 255, 255, 0.08);
            color: #fff;
            font-weight: 700;
            transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
          }
          .back-link:hover {
            transform: translateY(-1px);
            background: rgba(255, 255, 255, 0.14);
            border-color: rgba(255, 255, 255, 0.28);
            box-shadow: 0 8px 18px rgba(15, 23, 42, 0.16);
          }
          @media (max-width: 1200px) { .controls-grid { grid-template-columns: 1fr 1fr; } .controls-grid .control-group:last-child { grid-column: 1 / -1; } .aging-control { grid-column: 1 / -1; } }
          @media (max-width: 768px) { .controls-grid { grid-template-columns: 1fr; } table.return-table { min-width: 2400px; } }
        `}</style>

        <div className="mb-8">
          <div className="flex items-center gap-3 mb-6">
            <Link to="/m/$module" params={{ module: mod.slug }} className="back-link">
              <ChevronLeft className="h-4 w-4" /> Parts
            </Link>
          </div>
          <h1 className="text-4xl font-display font-bold tracking-tight mb-2">{sub.title}</h1>
          <p className="text-lg text-muted-foreground">{sub.description}</p>
        </div>

        <div className="return-panel">
          <div className="controls-grid">
            <div className="control-group">
              <label className="required" htmlFor="providerFilter">Part Provider</label>
              <select id="providerFilter" value={provider} onChange={(event) => setProvider(event.target.value)}>
                {PROVIDERS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <div className="control-group">
              <label htmlFor="locationFilter">Location</label>
              <select id="locationFilter" value={location} onChange={(event) => setLocation(event.target.value)}>
                <option value="">All</option>
                {LOCATIONS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <div className="control-group aging-control">
              <label className="aging-label" htmlFor="agingFrom">Aging</label>
              <div className="aging-range">
                <input id="agingFrom" type="number" min="0" value={agingFrom} onChange={(event) => setAgingFrom(event.target.value)} />
                <span>~</span>
                <input id="agingTo" type="number" min="0" title="Aging to" aria-label="Aging to" value={agingTo} onChange={(event) => setAgingTo(event.target.value)} />
              </div>
            </div>
            <div className="control-group">
              <label htmlFor="uniqueSearch">Unique ID / Invoice No</label>
              <input id="uniqueSearch" type="text" placeholder="Search unique ID or invoice #" value={uniqueSearch} onChange={(event) => setUniqueSearch(event.target.value)} />
            </div>
          </div>

          <div className="option-row">
            <div className="option-group">
              <label><input id="includeReturned" type="checkbox" checked={includeReturned} onChange={(event) => setIncludeReturned(event.target.checked)} /> Include Returned</label>
              <label><input id="includeReserved" type="checkbox" checked={includeReserved} onChange={(event) => setIncludeReserved(event.target.checked)} /> Include Reserved</label>
            </div>
          </div>

          <div className="view-switch-section">
            <div className="section-label">Select Return Type</div>
            <div className="view-switch">
              <button type="button" className={`view-btn ${activeView === "part" ? "active" : ""}`} onClick={() => setActiveView("part")}>Part Return</button>
              <button type="button" className={`view-btn ${activeView === "core" ? "active" : ""}`} onClick={() => setActiveView("core")}>Core Part Return</button>
            </div>
          </div>

          <div id="returnTitle" className="return-title">{activeView === "part" ? "Part Return" : "Core Part Return"}</div>

          <div className="meta-row">
            <div id="recordCount" className="record-count">{activeView === "part" ? `${filtered.length} records found` : `${coreFiltered.length} records found`}</div>
            <input id="searchInResult" type="text" placeholder="search in result" value={searchInResult} onChange={(event) => setSearchInResult(event.target.value)} />
          </div>

          <div id="partTableWrap" className={`table-wrap ${activeView === "part" ? "" : "hidden"}`}>
            <table className="return-table">
              <thead>
                <tr>
                  <th rowSpan={2}>Unique ID</th>
                  <th rowSpan={2}>Part #</th>
                  <th rowSpan={2}>Lot #</th>
                  <th colSpan={5}>Inventory</th>
                  <th rowSpan={2}>Reserved Ticket #</th>
                  <th rowSpan={2}>Part Status</th>
                  <th rowSpan={2}>Aging</th>
                  <th rowSpan={2}>Return Qty</th>
                  <th rowSpan={2}>RA #</th>
                  <th rowSpan={2}>Return</th>
                </tr>
                <tr className="inventory-subhead">
                  <th>In-Review</th>
                  <th>Defect</th>
                  <th>PNN</th>
                  <th>Current</th>
                  <th>Reserved</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.uniqueId}>
                    <td>{row.uniqueId}</td>
                    <td>{row.partNo}</td>
                    <td>{row.lotNo || ""}</td>
                    <td>{row.inReview}</td>
                    <td>{row.defect}</td>
                    <td>{row.pnn}</td>
                    <td>{row.current}</td>
                    <td>{row.reserved}</td>
                    <td>{row.ticketNo || ""}</td>
                    <td>{row.partStatus || ""}</td>
                    <td>{row.aging}</td>
                    <td>{row.returnQty}</td>
                    <td>{row.raNo || ""}</td>
                    <td>
                      <button className="return-btn" type="button" disabled={row.returnQty <= 0}>
                        Create Encompass RMA
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="py-8 text-center text-slate-500">No records</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div id="coreTableWrap" className={`table-wrap ${activeView === "core" ? "" : "hidden"}`}>
            <table className="return-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Ticket No.</th>
                  <th>Unique ID</th>
                  <th>Part #</th>
                  <th>Description</th>
                  <th>Invoice Date</th>
                  <th>Return Qty</th>
                  <th>Core Value</th>
                  <th>Part Status</th>
                  <th>Schedule Date</th>
                  <th>Technician</th>
                  <th>Core RA #</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {coreFiltered.map((row) => (
                  <tr key={row.id}>
                    <td>{row.id}</td>
                    <td>{row.ticketNo || ""}</td>
                    <td>{row.uniqueId || ""}</td>
                    <td>{row.partNo || ""}</td>
                    <td>{row.description || ""}</td>
                    <td>{formatDate(row.invoiceDate)}</td>
                    <td>{row.returnQty}</td>
                    <td>{row.coreValue}</td>
                    <td>{row.partStatus || ""}</td>
                    <td>{row.scheduleDate || ""}</td>
                    <td>{row.technician || ""}</td>
                    <td>{row.coreRaNo || ""}</td>
                    <td>
                      <button className="return-btn" type="button">Core Return Encompass</button>
                    </td>
                  </tr>
                ))}
                {coreFiltered.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="py-8 text-center text-slate-500">No records</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}