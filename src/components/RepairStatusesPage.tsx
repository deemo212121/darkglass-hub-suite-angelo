import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Save, Settings2, Download, Printer, Trash2, X } from "lucide-react";

type RepairStatusRow = {
  code: string;
  description: string;
  overallStatus: string;
  initialStatus: string;
  status: string;
  color: string;
  fontBold: boolean;
  followUp: string;
  csr: boolean;
  partMgr: boolean;
  tech: boolean;
  csrRescheduleStatus: string;
  partPendingStatus: string;
  cxRequestsReschedule: string;
  dispatchCompletedStatus: string;
  mobileSearch: boolean;
  hideInMobile: boolean;
  updateDispatchersStatus: boolean;
  earlySmsTriggerFlow: string;
  actions: string;
};

const STORAGE_KEY = "ahs:repair-statuses:rows";
const SEARCHABLE_FIELDS: Array<keyof RepairStatusRow> = ["code", "description", "overallStatus", "initialStatus", "status", "color", "followUp", "csrRescheduleStatus", "partPendingStatus", "cxRequestsReschedule", "dispatchCompletedStatus", "earlySmsTriggerFlow"];
const OVERALL_STATUS_OPTIONS = ["Pending", "Ready to Repair", "Completed", "Cancelled"];
const SET_STATUS_OPTIONS = ["", "ACCEPTED", "Completed", "Pending", "Show All", "Do not show"];
const STATUS_OPTIONS = ["", "Red", "Black", "Pink", "Purple", "Magenta", "Teal", "Tomato", "Green", "Grey", "Brown", "Lime", "Violet", "Salmon", "Blue", "Orange"];

const blankDraft: RepairStatusRow = {
  code: "",
  description: "",
  overallStatus: "Pending",
  initialStatus: "",
  status: "",
  color: "",
  fontBold: false,
  followUp: "",
  csr: false,
  partMgr: false,
  tech: false,
  csrRescheduleStatus: "",
  partPendingStatus: "",
  cxRequestsReschedule: "",
  dispatchCompletedStatus: "",
  mobileSearch: false,
  hideInMobile: false,
  updateDispatchersStatus: false,
  earlySmsTriggerFlow: "",
  actions: "",
};

const INITIAL_ROWS: RepairStatusRow[] = [
  { code: "ARC", description: "Archived", overallStatus: "Cancelled", initialStatus: "Archived", status: "Red", color: "Red", fontBold: false, followUp: "Do not show", csr: false, partMgr: false, tech: false, csrRescheduleStatus: "", partPendingStatus: "", cxRequestsReschedule: "", dispatchCompletedStatus: "", mobileSearch: false, hideInMobile: true, updateDispatchersStatus: false, earlySmsTriggerFlow: "", actions: "Delete" },
  { code: "BO", description: "CL-Parts Back Ordered", overallStatus: "Pending", initialStatus: "Parts Back Ordered", status: "Black", color: "Black", fontBold: false, followUp: "Show All", csr: true, partMgr: true, tech: true, csrRescheduleStatus: "ACCEPTED", partPendingStatus: "PARTS ON BACKORDER", cxRequestsReschedule: "ST030-Parts Back Ordered / Not Available", dispatchCompletedStatus: "", mobileSearch: false, hideInMobile: false, updateDispatchersStatus: false, earlySmsTriggerFlow: "", actions: "Delete" },
  { code: "CFU", description: "CL-Data-Closed", overallStatus: "Claimed", initialStatus: "Claimed", status: "Pink", color: "Pink", fontBold: true, followUp: "Do not show", csr: true, partMgr: true, tech: true, csrRescheduleStatus: "", partPendingStatus: "", cxRequestsReschedule: "", dispatchCompletedStatus: "", mobileSearch: false, hideInMobile: true, updateDispatchersStatus: false, earlySmsTriggerFlow: "", actions: "Delete" },
  { code: "CL", description: "CL-Claimed", overallStatus: "Claimed", initialStatus: "Claimed", status: "Purple", color: "Purple", fontBold: true, followUp: "Show All", csr: true, partMgr: true, tech: true, csrRescheduleStatus: "", partPendingStatus: "", cxRequestsReschedule: "", dispatchCompletedStatus: "ST040-Goods Delivered", mobileSearch: true, hideInMobile: false, updateDispatchersStatus: false, earlySmsTriggerFlow: "", actions: "Delete" },
  { code: "CN", description: "CL-Cancelled", overallStatus: "Cancelled", initialStatus: "Cancelled", status: "Magenta", color: "Magenta", fontBold: false, followUp: "Do not show", csr: true, partMgr: true, tech: true, csrRescheduleStatus: "", partPendingStatus: "", cxRequestsReschedule: "ST052-Cancel by ASC", dispatchCompletedStatus: "", mobileSearch: false, hideInMobile: true, updateDispatchersStatus: false, earlySmsTriggerFlow: "", actions: "Delete" },
  { code: "LM", description: "CSR-Left Message for Cx", overallStatus: "Pending", initialStatus: "Accepted", status: "Teal", color: "Teal", fontBold: false, followUp: "Do not show", csr: true, partMgr: false, tech: false, csrRescheduleStatus: "ACCEPTED", partPendingStatus: "CUSTOMER CONTACTED", cxRequestsReschedule: "", dispatchCompletedStatus: "", mobileSearch: false, hideInMobile: true, updateDispatchersStatus: false, earlySmsTriggerFlow: "", actions: "Delete" },
  { code: "NA", description: "PT-Need PreAuthorization", overallStatus: "Pending", initialStatus: "Accepted", status: "Red", color: "Red", fontBold: false, followUp: "Show All", csr: true, partMgr: true, tech: false, csrRescheduleStatus: "ACCEPTED", partPendingStatus: "AUTHORIZATION REQ. SUBMIT", cxRequestsReschedule: "", dispatchCompletedStatus: "", mobileSearch: false, hideInMobile: false, updateDispatchersStatus: false, earlySmsTriggerFlow: "", actions: "Delete" },
  { code: "NAC", description: "Needs Auto Claim", overallStatus: "Completed", initialStatus: "Confirmed", status: "Red", color: "Red", fontBold: false, followUp: "Do not show", csr: true, partMgr: true, tech: true, csrRescheduleStatus: "", partPendingStatus: "", cxRequestsReschedule: "", dispatchCompletedStatus: "ST025-Confirmed", mobileSearch: false, hideInMobile: true, updateDispatchersStatus: false, earlySmsTriggerFlow: "", actions: "Delete" },
  { code: "NC", description: "CL-Need Cancel", overallStatus: "Pending", initialStatus: "Need Cancel", status: "Tomato", color: "Tomato", fontBold: false, followUp: "Do not show", csr: true, partMgr: true, tech: true, csrRescheduleStatus: "", partPendingStatus: "", cxRequestsReschedule: "", dispatchCompletedStatus: "", mobileSearch: false, hideInMobile: true, updateDispatchersStatus: false, earlySmsTriggerFlow: "", actions: "Delete" },
  { code: "NP", description: "TR-Need PO", overallStatus: "Pending", initialStatus: "Accepted", status: "Green", color: "Green", fontBold: true, followUp: "Show All", csr: true, partMgr: true, tech: true, csrRescheduleStatus: "ACCEPTED", partPendingStatus: "WAITING ON PARTS", cxRequestsReschedule: "", dispatchCompletedStatus: "", mobileSearch: false, hideInMobile: false, updateDispatchersStatus: false, earlySmsTriggerFlow: "", actions: "Delete" },
  { code: "NS", description: "CSR-Needs Scheduling", overallStatus: "Pending", initialStatus: "Accepted", status: "Teal", color: "Teal", fontBold: false, followUp: "Do not show", csr: true, partMgr: true, tech: true, csrRescheduleStatus: "ACCEPTED", partPendingStatus: "ACCEPTED", cxRequestsReschedule: "", dispatchCompletedStatus: "", mobileSearch: false, hideInMobile: true, updateDispatchersStatus: false, earlySmsTriggerFlow: "", actions: "Delete" },
  { code: "NT", description: "TR-Need Triage", overallStatus: "Pending", initialStatus: "Accepted", status: "Grey", color: "Grey", fontBold: false, followUp: "Show All", csr: true, partMgr: true, tech: true, csrRescheduleStatus: "ACCEPTED", partPendingStatus: "TRIAGE", cxRequestsReschedule: "", dispatchCompletedStatus: "", mobileSearch: false, hideInMobile: false, updateDispatchersStatus: false, earlySmsTriggerFlow: "", actions: "Delete" },
  { code: "RC", description: "CL-Ready to Complete", overallStatus: "Ready to Repair", initialStatus: "Confirmed", status: "Brown", color: "Brown", fontBold: true, followUp: "Show All", csr: true, partMgr: true, tech: true, csrRescheduleStatus: "", partPendingStatus: "", cxRequestsReschedule: "", dispatchCompletedStatus: "ST025-Confirmed", mobileSearch: false, hideInMobile: false, updateDispatchersStatus: false, earlySmsTriggerFlow: "", actions: "Delete" },
  { code: "RDCN", description: "Redo Cancelled", overallStatus: "Cancelled", initialStatus: "Cancelled", status: "Lime", color: "Lime", fontBold: false, followUp: "Do not show", csr: true, partMgr: true, tech: true, csrRescheduleStatus: "", partPendingStatus: "", cxRequestsReschedule: "ST052-Cancel by ASC", dispatchCompletedStatus: "", mobileSearch: false, hideInMobile: true, updateDispatchersStatus: false, earlySmsTriggerFlow: "", actions: "Delete" },
  { code: "RF", description: "OP-Reschedule Follow up", overallStatus: "Pending", initialStatus: "Accepted", status: "Violet", color: "Violet", fontBold: false, followUp: "Show All", csr: true, partMgr: true, tech: true, csrRescheduleStatus: "ACCEPTED", partPendingStatus: "RESCHEDULED", cxRequestsReschedule: "", dispatchCompletedStatus: "", mobileSearch: false, hideInMobile: false, updateDispatchersStatus: false, earlySmsTriggerFlow: "", actions: "Delete" },
  { code: "ST010", description: "CSR-Assigned to ASC", overallStatus: "Pending", initialStatus: "Accepted", status: "Black", color: "Black", fontBold: false, followUp: "Do not show", csr: true, partMgr: false, tech: false, csrRescheduleStatus: "ACCEPTED", partPendingStatus: "ACCEPTED", cxRequestsReschedule: "", dispatchCompletedStatus: "", mobileSearch: false, hideInMobile: true, updateDispatchersStatus: false, earlySmsTriggerFlow: "", actions: "Delete" },
  { code: "ST015", description: "CSR-Acknowledged", overallStatus: "Pending", initialStatus: "Accepted", status: "Salmon", color: "Salmon", fontBold: false, followUp: "Do not show", csr: true, partMgr: false, tech: false, csrRescheduleStatus: "ACCEPTED", partPendingStatus: "ACCEPTED", cxRequestsReschedule: "", dispatchCompletedStatus: "", mobileSearch: false, hideInMobile: true, updateDispatchersStatus: false, earlySmsTriggerFlow: "", actions: "Delete" },
  { code: "ST025", description: "OP-Ready for Service", overallStatus: "Ready to Repair", initialStatus: "Appointment Confirmed", status: "Blue", color: "Blue", fontBold: true, followUp: "Do not show", csr: true, partMgr: true, tech: true, csrRescheduleStatus: "", partPendingStatus: "", cxRequestsReschedule: "", dispatchCompletedStatus: "ST025-Confirmed", mobileSearch: false, hideInMobile: false, updateDispatchersStatus: false, earlySmsTriggerFlow: "", actions: "" },
  { code: "ST035", description: "CL-Completed", overallStatus: "Completed", initialStatus: "Completed", status: "Green", color: "Green", fontBold: true, followUp: "Show All", csr: true, partMgr: true, tech: true, csrRescheduleStatus: "", partPendingStatus: "", cxRequestsReschedule: "", dispatchCompletedStatus: "ST035-Completed", mobileSearch: false, hideInMobile: false, updateDispatchersStatus: false, earlySmsTriggerFlow: "", actions: "" },
  { code: "UH", description: "OP-UPDATE HOLD", overallStatus: "Ready to Repair", initialStatus: "Appointment Confirmed", status: "Lime", color: "Lime", fontBold: false, followUp: "Do not show", csr: true, partMgr: true, tech: true, csrRescheduleStatus: "ACCEPTED", partPendingStatus: "APPOINTMENT CONFIRMED", cxRequestsReschedule: "", dispatchCompletedStatus: "", mobileSearch: false, hideInMobile: true, updateDispatchersStatus: true, earlySmsTriggerFlow: "", actions: "Delete" },
  { code: "WP", description: "OP-Waiting for Part", overallStatus: "Pending", initialStatus: "Accepted", status: "Orange", color: "Orange", fontBold: false, followUp: "Do not show", csr: true, partMgr: true, tech: true, csrRescheduleStatus: "ACCEPTED", partPendingStatus: "WAITING ON PARTS", cxRequestsReschedule: "ST030-Parts In Transit (Samsung)", dispatchCompletedStatus: "", mobileSearch: false, hideInMobile: false, updateDispatchersStatus: false, earlySmsTriggerFlow: "", actions: "Delete" },
];

function loadRows() {
  if (typeof window === "undefined") return INITIAL_ROWS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return INITIAL_ROWS;
    const parsed = JSON.parse(raw) as RepairStatusRow[];
    return Array.isArray(parsed) ? parsed : INITIAL_ROWS;
  } catch {
    return INITIAL_ROWS;
  }
}

function isBlankDraft(row: RepairStatusRow) {
  return JSON.stringify(row) === JSON.stringify(blankDraft);
}

function ToggleCell({ checked, onToggle, label }: { checked: boolean; onToggle: (value: boolean) => void; label?: string }) {
  return (
    <label className="repair-checkbox-wrap">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onToggle(event.target.checked)}
        aria-label={label ?? (checked ? "Enabled" : "Disabled")}
      />
    </label>
  );
}

export function RepairStatusesPage() {
  const [rows, setRows] = useState<RepairStatusRow[]>(() => loadRows());
  const [savedRows, setSavedRows] = useState<RepairStatusRow[]>(() => loadRows());
  const [draft, setDraft] = useState<RepairStatusRow>(blankDraft);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSearch("");
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, []);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (!search) return true;
      const haystack = SEARCHABLE_FIELDS.map((field) => String(row[field] ?? "")).join(" ").toLowerCase();
      return haystack.includes(search.toLowerCase());
    });
  }, [rows, search]);

  const hasChanges = useMemo(() => {
    return JSON.stringify(rows) !== JSON.stringify(savedRows) || !isBlankDraft(draft);
  }, [draft, rows, savedRows]);

  const updateRow = (index: number, key: keyof RepairStatusRow, value: string | boolean) => {
    setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row)));
  };

  const updateDraft = (key: keyof RepairStatusRow, value: string | boolean) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const removeRow = (index: number) => {
    setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
  };

  const saveChanges = () => {
    const nextRows = rows.slice();
    if (draft.code.trim() && draft.description.trim()) {
      nextRows.unshift({ ...draft, code: draft.code.trim(), description: draft.description.trim() });
    }
    setRows(nextRows);
    setSavedRows(nextRows);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextRows));
    setDraft(blankDraft);
  };

  const saveDisabled = !hasChanges;

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1700px] mx-auto w-full px-6 py-8">
        <style>{`
          .panel {
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 10px;
            padding: 1.25rem;
            color: #fff;
            backdrop-filter: blur(10px);
          }
          .repair-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.9rem; }
          .repair-title-wrap { display: flex; align-items: center; gap: 0.85rem; }
          .repair-title { font-size: 1.9rem; font-weight: 700; color: #fff; line-height: 1.1; }
          .repair-subtitle { color: #cbd5e1; font-size: 0.9rem; }
          .back-btn {
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
          .back-btn:hover { transform: translateY(-1px); background: rgba(255, 255, 255, 0.14); border-color: rgba(255, 255, 255, 0.28); box-shadow: 0 8px 18px rgba(15, 23, 42, 0.16); }
          .top-actions { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
          .btn {
            height: 34px;
            padding: 0 1rem;
            border-radius: 6px;
            border: 1px solid rgba(255, 255, 255, 0.25);
            background: rgba(17, 24, 39, 0.95);
            color: #fff;
            font-size: 0.86rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            display: inline-flex;
            align-items: center;
            justify-content: center;
          }
          .btn:hover { border-color: rgba(96, 165, 250, 0.7); background: rgba(30, 64, 175, 0.35); }
          .btn.primary { background: #1d4ed8; border-color: #1d4ed8; }
          .btn.primary:hover { background: #1e40af; }
          .btn:disabled { opacity: 0.5; cursor: not-allowed; }
          .status-card { margin-top: 0.75rem; }
          .search-row { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 0.65rem; }
          .result-info { font-size: 0.8rem; font-weight: 700; color: #bfdbfe; }
          .search-input { width: 260px; height: 34px; padding: 0.35rem 0.5rem; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; font-size: 0.8rem; color: #fff; background: rgba(17, 24, 39, 0.95); }
          .table-wrap { overflow: auto; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 10px; background: #fff; }
          table.status-table { width: 100%; border-collapse: collapse; background: #fff; color: #1f2937; font-size: 0.76rem; }
          .status-table th, .status-table td { border: 1px solid #d1d5db; padding: 0.38rem 0.45rem; white-space: nowrap; text-align: center; vertical-align: middle; }
          .status-table th { background: #4b5563; color: #ffffff; font-weight: 700; position: sticky; top: 0; z-index: 1; }
          .status-table td:first-child, .status-table td:nth-child(2), .status-table td:nth-child(4), .status-table td:nth-child(5), .status-table td:nth-child(6), .status-table td:nth-child(8), .status-table td:nth-child(9), .status-table td:nth-child(18) { text-align: left; }
          .status-table input, .status-table select {
            width: 100%;
            min-width: 0;
            height: 28px;
            padding: 0.18rem 0.3rem;
            border: 1px solid #cbd5e1;
            border-radius: 4px;
            background: #fff;
            color: #111827;
            font-size: 0.7rem;
          }
          .status-table input[type="checkbox"] { width: 18px; height: 18px; min-width: 18px; }
          .draft-row { background: #fffdf2; }
          .draft-row td { background: #fffdf2; }
          .repair-toggle {
            min-width: 52px;
            height: 28px;
            border: 1px solid #cbd5e1;
            border-radius: 4px;
            background: #f8fafc;
            color: #334155;
            font-size: 0.7rem;
            font-weight: 700;
            cursor: pointer;
          }
          .repair-toggle.is-on { background: #b08d00; color: #fff; border-color: #977300; }
          .group-head { background: #4b5563; font-weight: 700; }
          .group-head th { color: #ffffff; text-align: center; }
          .column-head { background: #4b5563; }
          .column-head th { color: #ffffff; background: #4b5563; text-align: center; }
          .notes { margin-top: 0.9rem; color: #cbd5e1; font-size: 0.82rem; line-height: 1.4; }
          .action-cell { display: flex; gap: 0.45rem; justify-content: center; }
          .delete-btn { border: 0; background: transparent; color: #1d4ed8; font-weight: 700; cursor: pointer; padding: 0; }
          .delete-btn:hover { text-decoration: underline; }
          .link-btn { border: 0; background: transparent; color: #1d4ed8; font-weight: 700; cursor: pointer; padding: 0; }
          .link-btn:hover { text-decoration: underline; }
          .toolbar-icon { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; color: #14a6e2; border: 0; background: transparent; cursor: pointer; }
          .toolbar-icon:hover { color: #0ea5e9; }
          .toolbar-search { display: inline-flex; align-items: center; gap: 0.35rem; border: 2px solid #4f46e5; border-radius: 999px; padding: 0.15rem 0.55rem; background: #fff; }
          .toolbar-search input { border: 0; outline: none; width: 170px; font-size: 0.72rem; }
          .top-right-tools { display: flex; align-items: center; gap: 0.25rem; }
          .sticky-table-head thead tr:first-child th { position: sticky; top: 0; z-index: 3; }
          .sticky-table-head thead tr:nth-child(2) th { position: sticky; top: 26px; z-index: 3; }
          @media (max-width: 1100px) { .search-input { width: 100%; } }
        `}</style>

        <div className="repair-toolbar">
          <div className="repair-title-wrap">
            <Link to="/m/$module" params={{ module: "admin" }} className="back-btn">
              <ChevronLeft className="h-4 w-4" /> Repair Status
            </Link>
            <div>
              <div className="repair-title">Repair Statuses</div>
              <div className="repair-subtitle">{filteredRows.length} records found</div>
            </div>
          </div>

          <div className="top-actions">
            <div className="top-right-tools">
              <button type="button" className="toolbar-icon" aria-label="Print"><Printer className="h-4 w-4" /></button>
              <button type="button" className="toolbar-icon" aria-label="Download"><Download className="h-4 w-4" /></button>
              <button type="button" className="toolbar-icon" aria-label="Settings"><Settings2 className="h-4 w-4" /></button>
            </div>
            <div className="toolbar-search">
              <input type="text" placeholder="search in result" value={search} onChange={(event) => setSearch(event.target.value)} />
              <button type="button" className="toolbar-icon" aria-label="Clear search" onClick={() => setSearch("")}> <X className="h-4 w-4" /> </button>
            </div>
            <button type="button" className="btn primary" onClick={saveChanges} disabled={saveDisabled}>
              <Save className="h-4 w-4" /> Save
            </button>
          </div>
        </div>

        <div className="panel status-card">
          <div className="search-row">
            <div className="result-info">21 records found</div>
          </div>

          <div className="table-wrap">
            <table className="status-table sticky-table-head">
              <thead>
                <tr className="group-head">
                  <th rowSpan={2}>Code</th>
                  <th rowSpan={2}>Description</th>
                  <th rowSpan={2}>Overall Status</th>
                  <th rowSpan={2}>Initial Status</th>
                  <th rowSpan={2}>Status</th>
                  <th rowSpan={2}>Color</th>
                  <th rowSpan={2}>Font Bold</th>
                  <th rowSpan={2}>Follow-up Dashboard</th>
                  <th colSpan={3}>Ability to Set Status</th>
                  <th rowSpan={2}>CSR Reschedule Status</th>
                  <th rowSpan={2}>Part Pending Status</th>
                  <th rowSpan={2}>When Cx Requests Reschedule</th>
                  <th rowSpan={2}>Dispatch Completed Status</th>
                  <th rowSpan={2}>Mobile Search</th>
                  <th rowSpan={2}>Hide in Mobile</th>
                  <th rowSpan={2}>Update Dispatcher's Status</th>
                  <th rowSpan={2}>EarlySMS Trigger Flow</th>
                  <th rowSpan={2}>Actions</th>
                </tr>
                <tr className="column-head">
                  <th>CSR</th>
                  <th>Part Mgr.</th>
                  <th>Tech</th>
                </tr>
              </thead>
              <tbody>
                <tr className="draft-row">
                  <td><input value={draft.code} onChange={(event) => updateDraft("code", event.target.value)} placeholder="Code" /></td>
                  <td><input value={draft.description} onChange={(event) => updateDraft("description", event.target.value)} placeholder="Description" /></td>
                  <td>
                    <select value={draft.overallStatus} onChange={(event) => updateDraft("overallStatus", event.target.value)}>
                      {OVERALL_STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </td>
                  <td><input value={draft.initialStatus} onChange={(event) => updateDraft("initialStatus", event.target.value)} placeholder="Initial status" /></td>
                  <td><input value={draft.status} onChange={(event) => updateDraft("status", event.target.value)} placeholder="Status" /></td>
                  <td><input value={draft.color} onChange={(event) => updateDraft("color", event.target.value)} placeholder="Color" /></td>
                  <td><ToggleCell checked={draft.fontBold} onToggle={(value) => updateDraft("fontBold", value)} /></td>
                  <td><input value={draft.followUp} onChange={(event) => updateDraft("followUp", event.target.value)} placeholder="Follow-up dashboard" /></td>
                  <td><ToggleCell checked={draft.csr} onToggle={(value) => updateDraft("csr", value)} label="CSR" /></td>
                  <td><ToggleCell checked={draft.partMgr} onToggle={(value) => updateDraft("partMgr", value)} /></td>
                  <td><ToggleCell checked={draft.tech} onToggle={(value) => updateDraft("tech", value)} /></td>
                  <td><input value={draft.csrRescheduleStatus} onChange={(event) => updateDraft("csrRescheduleStatus", event.target.value)} placeholder="CSR reschedule" /></td>
                  <td><input value={draft.partPendingStatus} onChange={(event) => updateDraft("partPendingStatus", event.target.value)} placeholder="Part pending" /></td>
                  <td><input value={draft.cxRequestsReschedule} onChange={(event) => updateDraft("cxRequestsReschedule", event.target.value)} placeholder="When Cx requests reschedule" /></td>
                  <td><input value={draft.dispatchCompletedStatus} onChange={(event) => updateDraft("dispatchCompletedStatus", event.target.value)} placeholder="Dispatch completed" /></td>
                  <td><ToggleCell checked={draft.mobileSearch} onToggle={(value) => updateDraft("mobileSearch", value)} /></td>
                  <td><ToggleCell checked={draft.hideInMobile} onToggle={(value) => updateDraft("hideInMobile", value)} /></td>
                  <td><ToggleCell checked={draft.updateDispatchersStatus} onToggle={(value) => updateDraft("updateDispatchersStatus", value)} /></td>
                  <td><input value={draft.earlySmsTriggerFlow} onChange={(event) => updateDraft("earlySmsTriggerFlow", event.target.value)} placeholder="Trigger flow" /></td>
                  <td className="action-cell"><span className="link-btn">Add</span></td>
                </tr>

                {filteredRows.map((row, index) => (
                  <tr key={`${row.code}-${row.description}-${index}`}>
                    <td><input value={row.code} onChange={(event) => updateRow(index, "code", event.target.value)} /></td>
                    <td><input value={row.description} onChange={(event) => updateRow(index, "description", event.target.value)} /></td>
                    <td>
                      <select value={row.overallStatus} onChange={(event) => updateRow(index, "overallStatus", event.target.value)}>
                        {OVERALL_STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </td>
                    <td><input value={row.initialStatus} onChange={(event) => updateRow(index, "initialStatus", event.target.value)} /></td>
                    <td><input value={row.status} onChange={(event) => updateRow(index, "status", event.target.value)} /></td>
                    <td><input value={row.color} onChange={(event) => updateRow(index, "color", event.target.value)} /></td>
                    <td><ToggleCell checked={row.fontBold} onToggle={(value) => updateRow(index, "fontBold", value)} /></td>
                    <td><input value={row.followUp} onChange={(event) => updateRow(index, "followUp", event.target.value)} /></td>
                    <td><ToggleCell checked={row.csr} onToggle={(value) => updateRow(index, "csr", value)} label="CSR" /></td>
                    <td><ToggleCell checked={row.partMgr} onToggle={(value) => updateRow(index, "partMgr", value)} /></td>
                    <td><ToggleCell checked={row.tech} onToggle={(value) => updateRow(index, "tech", value)} /></td>
                    <td><input value={row.csrRescheduleStatus} onChange={(event) => updateRow(index, "csrRescheduleStatus", event.target.value)} /></td>
                    <td><input value={row.partPendingStatus} onChange={(event) => updateRow(index, "partPendingStatus", event.target.value)} /></td>
                    <td><input value={row.cxRequestsReschedule} onChange={(event) => updateRow(index, "cxRequestsReschedule", event.target.value)} /></td>
                    <td><input value={row.dispatchCompletedStatus} onChange={(event) => updateRow(index, "dispatchCompletedStatus", event.target.value)} /></td>
                    <td><ToggleCell checked={row.mobileSearch} onToggle={(value) => updateRow(index, "mobileSearch", value)} /></td>
                    <td><ToggleCell checked={row.hideInMobile} onToggle={(value) => updateRow(index, "hideInMobile", value)} /></td>
                    <td><ToggleCell checked={row.updateDispatchersStatus} onToggle={(value) => updateRow(index, "updateDispatchersStatus", value)} /></td>
                    <td><input value={row.earlySmsTriggerFlow} onChange={(event) => updateRow(index, "earlySmsTriggerFlow", event.target.value)} /></td>
                    <td className="action-cell">
                      <span className="link-btn" onClick={() => removeRow(index)}>Delete</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="notes">
            <p>* CSS color for repair status will be applied in To-do list, Ticket list, Work Planner, Work Calendar (Monthly), and similar screens.</p>
            <p>* RDCN (Redo Cancel): use this when reporting cancelled to manufacturer but counting it as completed by technician.</p>
          </div>
        </div>
      </main>
    </div>
  );
}