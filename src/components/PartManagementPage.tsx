import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ChevronLeft, Download, Send, Trash2 } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS } from "@/lib/locations";
import { exportToCSV } from "@/lib/csvExport";

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
  "CX Received",
  "Defective",
  "Hold for Estimation",
  "Hold for next visit",
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
  "Used",
];

const BASE_ROWS: ManagementRow[] = [
  { ticketNo: "066098174139", repairStatus: "TR-Need Triage", location: "Asheville", schedule: "05/22", wty: "IW", partId: "P1", partDist: "", partNo: "5221DD1001E", description: "VALVE ASSEMBLY INLET", poNo: "066098174139", poDate: "", orderNo: "", invoiceNo: "", partStatus: "CX Home", note: "If used during repair requires return: No Shipping Provider: FedEx", unit: 0, core: 0, qty: 1, lot: "", symptom: "05/15 - Customer called in stating blinking 1E error code for 2 days.", action: "Part Order", receiveDate: "2026-05-15" },
  { ticketNo: "1006772961-10", repairStatus: "OP-Waiting for Part", location: "Asheville", schedule: "04/22", wty: "IW", partId: "P10", partDist: "Marcone", partNo: "5304485759", description: "TAPE", poNo: "1006772961-10-AV", poDate: "2026-04-27", orderNo: "73538313", invoiceNo: "73586196-2", partStatus: "Part Ready", note: "", unit: 0.39, core: 0, qty: 4, lot: "", symptom: "Need to rediag the unit.", action: "Part Order", receiveDate: "2026-05-14" },
  { ticketNo: "1007098724-10", repairStatus: "TR-Need PO", location: "Asheville", schedule: "", wty: "IW", partId: "P1", partDist: "Marcone", partNo: "5304532919", description: "CONTROL BOARD,ASSEMBLY,LED POW", poNo: "", poDate: "", orderNo: "", invoiceNo: "", partStatus: "Need PO", note: "", unit: 163.66, core: 0, qty: 1, lot: "", symptom: "", action: "Part Order", receiveDate: "2026-05-15" },
];

function formatMoney(value: number) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

function loadRows() {
  const raw = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed as ManagementRow[];
    } catch {
      // fall through to seeded rows
    }
  }
  const rows: ManagementRow[] = [...BASE_ROWS];
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  }
  return rows;
}

function defaultFilterOptions(rows: ManagementRow[]) {
  const repairValues = [...new Set([...REQUIRED_REPAIR_STATUSES, ...rows.map((row) => row.repairStatus).filter(Boolean)])];
  const partValues = [...new Set([...REQUIRED_PART_STATUSES, ...rows.map((row) => row.partStatus).filter(Boolean)])];
  return { repairValues, partValues };
}

// ─── Portal-positioned dropdown helper ───
// Lets us render a search-in-list dropdown next to its trigger without
// the popup getting clipped by overflow:hidden on parent panels. Tracks
// the trigger's bounding rect on open + during scroll/resize so the
// popup follows it.
const DROPDOWN_STYLE: React.CSSProperties = {
  background: "var(--color-card)",
  color: "var(--color-foreground)",
  border: "1px solid var(--color-panel-border)",
  borderRadius: 6,
  boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
  zIndex: 999999,
  position: "fixed",
  maxHeight: 300,
  overflowY: "auto",
};

function useDropdownPosition(open: boolean) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const recalc = useCallback(() => {
    if (!ref.current) return;
    const b = ref.current.getBoundingClientRect();
    setPos({ top: b.bottom + 2, left: b.left, width: b.width });
  }, []);
  useLayoutEffect(() => {
    if (open) recalc();
  }, [open, recalc]);
  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", recalc, true);
    window.addEventListener("resize", recalc);
    return () => {
      window.removeEventListener("scroll", recalc, true);
      window.removeEventListener("resize", recalc);
    };
  }, [open, recalc]);
  return { ref, pos };
}

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export function PartManagementPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [rows, setRows] = useState<ManagementRow[]>([]);

  // Location is multi-select. Empty = treated as no location selected, so
  // the table prompts the user to pick a branch (mirrors the v1 spec).
  const [locations, setLocations] = useState<string[]>([]);
  const [locOpen, setLocOpen] = useState(false);
  const [locSearch, setLocSearch] = useState("");
  const locDrop = useDropdownPosition(locOpen);
  const locListRef = useRef<HTMLDivElement>(null);

  const [repairStatusFilter, setRepairStatusFilter] = useState("");
  const [partStatusFilter, setPartStatusFilter] = useState("");
  const [ticketFilter, setTicketFilter] = useState("");
  const [fromDate, setFromDate] = useState("2026-05-14");
  const [toDate, setToDate] = useState("2026-05-15");
  const [resultSearch, setResultSearch] = useState("");
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);

  useEffect(() => {
    setRows(loadRows());
  }, []);

  // Auto-save whenever rows change
  useEffect(() => {
    if (rows.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
    }
  }, [rows]);

  // Close the location dropdown when clicking outside the trigger or list.
  useEffect(() => {
    if (!locOpen) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!locDrop.ref.current?.contains(t) && !locListRef.current?.contains(t)) {
        setLocOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [locOpen, locDrop]);

  const { repairValues, partValues } = useMemo(() => defaultFilterOptions(rows), [rows]);

  const allLocSelected = locations.length === 0 || locations.length === LOCATIONS.length;
  const toggleLocation = (l: string) =>
    setLocations((prev) => (prev.includes(l) ? prev.filter((x) => x !== l) : [...prev, l]));
  const toggleAllLocations = () => setLocations(allLocSelected ? [] : [...LOCATIONS]);
  const locLabel =
    locations.length === 0
      ? "Select branch…"
      : locations.length === 1
      ? locations[0]
      : `${locations.length} branches`;
  const visibleLocs = useMemo(
    () => LOCATIONS.filter((l) => !locSearch || l.toLowerCase().includes(locSearch.toLowerCase())),
    [locSearch],
  );

  const hasLocation = locations.length > 0;

  const filteredRows = useMemo(() => {
    if (!hasLocation) return [] as Array<{ row: ManagementRow; originalIndex: number }>;
    const repair = repairStatusFilter.trim();
    const part = partStatusFilter.trim();
    const ticket = ticketFilter.trim().toLowerCase();
    const search = resultSearch.trim().toLowerCase();

    return rows
      .map((row, index) => ({ row, originalIndex: index }))
      .filter(({ row }) => {
        if (!locations.includes(row.location)) return false;
        if (repair && row.repairStatus !== repair) return false;
        if (part && row.partStatus !== part) return false;
        if (ticket && !String(row.ticketNo || "").toLowerCase().includes(ticket)) return false;
        if (fromDate && row.receiveDate < fromDate) return false;
        if (toDate && row.receiveDate > toDate) return false;
        if (search) {
          const blob = [row.ticketNo, row.repairStatus, row.location, row.partDist, row.partNo, row.description, row.poNo, row.partStatus, row.note].join(" ").toLowerCase();
          if (!blob.includes(search)) return false;
        }
        return true;
      });
  }, [hasLocation, locations, repairStatusFilter, partStatusFilter, ticketFilter, fromDate, toDate, resultSearch, rows]);

  const handleSave = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
    alert(`Data saved successfully! (${rows.length} total records)`);
  };

  const handleExport = () => {
    if (filteredRows.length === 0) return;
    exportToCSV(
      "parts_po_management",
      [
        "Ticket #",
        "Repair Status",
        "Location",
        "Part No",
        "Description",
        "Dist",
        "Part Status",
        "Unit $",
        "Qty",
        "Total",
        "Receive Date",
      ],
      filteredRows.map(({ row: r }) => [
        r.ticketNo,
        r.repairStatus,
        r.location,
        r.partNo,
        r.description,
        r.partDist,
        r.partStatus,
        r.unit.toFixed(2),
        r.qty,
        (r.unit * r.qty).toFixed(2),
        r.receiveDate,
      ]),
    );
  };

  const toggleRowSelection = (originalIndex: number) => {
    const newSelected = new Set(selectedRows);
    if (newSelected.has(originalIndex)) {
      newSelected.delete(originalIndex);
    } else {
      newSelected.add(originalIndex);
    }
    setSelectedRows(newSelected);
  };

  // Select / deselect every Need-PO row currently visible.
  const needPoRows = filteredRows.filter(({ row }) => row.partStatus === "Need PO");
  const allNeedPoSelected =
    needPoRows.length > 0 && needPoRows.every(({ originalIndex }) => selectedRows.has(originalIndex));
  const toggleAllSelection = () => {
    if (allNeedPoSelected) {
      const next = new Set(selectedRows);
      needPoRows.forEach(({ originalIndex }) => next.delete(originalIndex));
      setSelectedRows(next);
    } else {
      const next = new Set(selectedRows);
      needPoRows.forEach(({ originalIndex }) => next.add(originalIndex));
      setSelectedRows(next);
    }
  };

  const selectedData = Array.from(selectedRows)
    .map((idx) => rows[idx])
    .filter((row) => row && row.partStatus === "Need PO");

  const totalCost = selectedData.reduce((sum, row) => sum + row.unit * row.qty, 0);

  const handleSubmitPO = () => {
    if (selectedData.length === 0) {
      alert("Please select parts with 'Need PO' status");
      return;
    }

    const updatedRows = rows.map((row, idx) =>
      selectedRows.has(idx)
        ? { ...row, partStatus: "PO Made", poDate: new Date().toISOString().split("T")[0] }
        : row,
    );

    setRows(updatedRows);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedRows));

    alert(`PO submitted for ${selectedData.length} part(s)!\nTotal Cost: $${totalCost.toFixed(2)}`);
    setSelectedRows(new Set());
    setShowSubmitConfirm(false);
  };

  const deleteRow = (index: number) => {
    if (!confirm("Delete this part record?")) return;
    const updatedRows = rows.filter((_, idx) => idx !== index);
    setRows(updatedRows);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedRows));
    selectedRows.delete(index);
    setSelectedRows(new Set(selectedRows));
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950">
      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-6">
            <Link
              to="/m/$module"
              params={{ module: mod.slug }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold transition"
            >
              <ChevronLeft className="h-4 w-4" /> Parts
            </Link>
          </div>
          <h1 className="text-4xl font-bold text-white mb-2">{sub.title}</h1>
          <p className="text-lg text-slate-400">{sub.description}</p>
        </div>

        {/* Filters */}
        <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            {/* Location (multi-select, required) */}
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-2">Location*</label>
              <button
                ref={locDrop.ref}
                onClick={() => setLocOpen((o) => !o)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500 flex items-center justify-between gap-2"
              >
                <span className={locations.length ? "" : "text-slate-400"}>{locLabel}</span>
                <ChevronIcon open={locOpen} />
              </button>
              {locOpen && locDrop.pos &&
                createPortal(
                  <div
                    ref={locListRef}
                    style={{
                      ...DROPDOWN_STYLE,
                      top: locDrop.pos.top,
                      left: locDrop.pos.left,
                      width: Math.max(locDrop.pos.width, 220),
                    }}
                  >
                    <div className="p-2 sticky top-0 bg-slate-900 border-b border-white/10">
                      <input
                        value={locSearch}
                        onChange={(e) => setLocSearch(e.target.value)}
                        placeholder="Search branches…"
                        className="w-full px-2 py-1.5 text-xs bg-slate-800 border border-slate-600 rounded text-white focus:outline-none focus:border-blue-500"
                        autoFocus
                      />
                    </div>
                    <label className="flex items-center gap-2 px-3 py-2 text-sm text-white hover:bg-white/5 cursor-pointer border-b border-white/10">
                      <input
                        type="checkbox"
                        checked={locations.length === LOCATIONS.length}
                        onChange={toggleAllLocations}
                        className="accent-blue-500 h-3.5 w-3.5"
                      />
                      <span className="font-semibold">All Branches</span>
                    </label>
                    {visibleLocs.map((l) => (
                      <label
                        key={l}
                        className="flex items-center gap-2 px-3 py-2 text-sm text-white hover:bg-white/5 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={locations.includes(l)}
                          onChange={() => toggleLocation(l)}
                          className="accent-blue-500 h-3.5 w-3.5"
                        />
                        <span>{l}</span>
                      </label>
                    ))}
                    {visibleLocs.length === 0 && (
                      <div className="px-3 py-3 text-xs text-slate-500">No matches</div>
                    )}
                  </div>,
                  document.body,
                )}
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-2">Repair Status</label>
              <select
                value={repairStatusFilter}
                onChange={(e) => setRepairStatusFilter(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
              >
                <option value="">All</option>
                {repairValues.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-2">Part Status</label>
              <select
                value={partStatusFilter}
                onChange={(e) => setPartStatusFilter(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
              >
                <option value="">All</option>
                {partValues.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-2">Ticket #</label>
              <input
                type="text"
                value={ticketFilter}
                onChange={(e) => setTicketFilter(e.target.value)}
                placeholder="Search ticket…"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-300">Receive Date:</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm"
              />
              <span className="text-slate-400">to</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm"
              />
            </div>
            <button
              onClick={handleSave}
              className="ml-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition"
            >
              Save
            </button>
          </div>
        </div>

        {!hasLocation ? (
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-10 text-center text-sm text-slate-400">
            Select at least one location to load PO &amp; Management data.
          </div>
        ) : (
          <>
            {/* Search & Actions Bar */}
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4 mb-6 flex flex-wrap items-center justify-between gap-4">
              <div className="text-sm text-slate-300">
                {filteredRows.length} records found
              </div>
              <input
                type="text"
                value={resultSearch}
                onChange={(e) => setResultSearch(e.target.value)}
                placeholder="Search in results…"
                className="flex-1 max-w-xs px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
              />
              <div className="flex gap-2 ml-auto">
                <button
                  onClick={handleExport}
                  disabled={filteredRows.length === 0}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition"
                  title="Export the visible rows to CSV"
                >
                  <Download className="h-4 w-4" />
                  Export CSV
                </button>
                {selectedRows.size > 0 && (
                  <button
                    onClick={() => setShowSubmitConfirm(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition"
                  >
                    <Send className="h-4 w-4" />
                    Submit PO ({selectedRows.size}) - ${totalCost.toFixed(2)}
                  </button>
                )}
              </div>
            </div>

            {/* Submit PO Confirmation */}
            {showSubmitConfirm && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-slate-900 border border-white/20 rounded-lg max-w-md w-full p-6">
                  <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-yellow-400" />
                    Confirm PO Submission
                  </h2>
                  <div className="mb-6 text-slate-300">
                    <p className="mb-2">
                      <span className="font-semibold text-white">{selectedData.length}</span> part(s) will be submitted for PO
                    </p>
                    <p className="text-sm text-slate-400">
                      Total Cost: <span className="font-bold text-green-400">${totalCost.toFixed(2)}</span>
                    </p>
                  </div>
                  <div className="space-y-2 mb-6 max-h-48 overflow-y-auto">
                    {selectedData.map((row, idx) => (
                      <div key={idx} className="text-xs text-slate-400 border-l-2 border-blue-500/30 pl-3 py-1">
                        <div><span className="text-blue-300">{row.partNo}</span> - {row.description}</div>
                        <div>Qty: {row.qty} × ${row.unit.toFixed(2)} = ${(row.qty * row.unit).toFixed(2)}</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowSubmitConfirm(false)}
                      className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-semibold transition"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSubmitPO}
                      className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition"
                    >
                      Submit
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Table */}
            <div className="bg-slate-900/50 border border-white/10 rounded-lg overflow-x-auto">
              <table className="w-full text-sm text-slate-300">
                <thead>
                  <tr className="border-b border-white/10 bg-slate-900">
                    <th className="px-4 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={allNeedPoSelected}
                        onChange={toggleAllSelection}
                        className="w-4 h-4 cursor-pointer"
                      />
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase">Ticket #</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase">Part No</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase">Description</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase">Dist</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase">Part Status</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase">Unit $</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase">Qty</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase">Total</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                        No records found
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map(({ row, originalIndex }) => (
                      <tr
                        key={originalIndex}
                        className={`border-b border-white/5 hover:bg-white/5 transition ${
                          selectedRows.has(originalIndex) ? "bg-blue-500/10" : ""
                        } ${row.partStatus === "Need PO" ? "opacity-100" : "opacity-75"}`}
                      >
                        <td className="px-4 py-3">
                          {row.partStatus === "Need PO" && (
                            <input
                              type="checkbox"
                              checked={selectedRows.has(originalIndex)}
                              onChange={() => toggleRowSelection(originalIndex)}
                              className="w-4 h-4 cursor-pointer"
                            />
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-blue-400">
                          <a
                            href={`/ticket/${row.ticketNo}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer pointer-events-auto inline-block"
                            title={`Open ${row.ticketNo} in new tab`}
                          >
                            {row.ticketNo}
                          </a>
                        </td>
                        <td className="px-4 py-3 font-mono text-sm">{row.partNo}</td>
                        <td className="px-4 py-3 text-xs max-w-xs truncate">{row.description}</td>
                        <td className="px-4 py-3 text-sm">{row.partDist}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-1 rounded text-xs font-medium ${
                              row.partStatus === "Need PO"
                                ? "bg-red-500/20 text-red-300 border border-red-500/30"
                                : row.partStatus === "PO Made"
                                ? "bg-green-500/20 text-green-300 border border-green-500/30"
                                : "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                            }`}
                          >
                            {row.partStatus}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">${formatMoney(row.unit)}</td>
                        <td className="px-4 py-3 text-right">{row.qty}</td>
                        <td className="px-4 py-3 text-right font-semibold">
                          ${formatMoney(row.unit * row.qty)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => deleteRow(originalIndex)}
                              className="p-1.5 hover:bg-red-500/20 rounded text-red-400 hover:text-red-300 transition"
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-6 text-xs text-slate-500">
              * = Required field. Only parts with "Need PO" status can be selected for PO submission.
            </div>
          </>
        )}
      </main>
    </div>
  );
}
