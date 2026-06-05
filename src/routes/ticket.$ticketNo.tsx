import { createFileRoute, useNavigate } from "@tanstack/react-router";
import React, { useState, useEffect, useMemo } from "react";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ALL_TECHNICIANS } from "@/lib/locations";
import { Copy } from "lucide-react";
import { useAuth } from "@/lib/auth";

interface TicketData {
  ticketNo: string;
  account: string;
  warranty: string;
  product: string;
  tat: string;
  status: string;
  schedule: string;
  contact: string;
  location: string;
  firstName: string;
  lastName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  homePhone: string;
  cellPhone: string;
  email: string;
  brand: string;
  model: string;
  serialNo: string;
  productCategory: string;
  purchaseDate: string;
  warrantyType: string;
  claimCompany: string;
  accountNo: string;
  callNo: string;
  callType: string;
  callStatus: string;
  postingDate: string;
  problemDescription: string;
  scheduleDate: string;
  schedulePeriod: string;
  technician: string;
  customerNotes: Array<{ date: string; notes: string; by: string }>;
  servicerNotes: Array<{ notes: string; by: string }>;
}

interface CompensationRow {
  id: string;
  item: string;
  beneficiary: string;
  amount: string;
  rate: string;
  activityDate: string;
  requiresClaimOrCxPayment: string;
  comment: string;
  createdBy: string;
  lastModifiedBy: string;
}

interface PartTransactionRow {
  id: string;
  partNo: string;
  partDist: string;
  partDesc: string;
  poNo: string;
  poDate: string;
  invoiceNo: string;
  invoiceDate: string;
  quantity: string;
  partPrice: string;
  coreValue: string;
  shipCost: string;
  markup: string;
  totalMarkup: string;
  claimTo: string;
  status: string;
  note: string;
  visitId: string;
  orderNo: string;
  eta: string;
  inTracking: string;
  raDate: string;
  raNo: string;
  outTracking: string;
  creditNo: string;
  hold: string;
  cxPaid: string;
  createdBy: string;
  lastModifiedBy: string;
}

type PartTransactionDraft = Omit<PartTransactionRow, "id" | "createdBy" | "lastModifiedBy">;

interface AuditLogEntry {
  id: string;
  timestamp: string;
  by: string;
  action: string;
  field: string;
  before: string;
  after: string;
}

interface VisitLogEntry {
  id: string;
  visitNo: string;
  timestamp: string;
  updatedAt?: string;
  by: string;
  scheduleDate: string;
  technician: string;
  timeSlot: string;
  activity: string;
  actionType: string;
  repairStatus: string;
  repairType: string;
  reclaim: string;
  visited: string;
  notCompleted: string;
  symptomCx: string;
  diagnosis: string;
  symptomTech: string;
  resolution: string;
  nonCompletionReason: string;
  triageNote: string;
  status: string;
  note: string;
}

type TicketCopyPayload = {
  ticketNo: string;
  source: string;
  customerName: string;
  primaryPhone: string;
  secondaryPhone: string;
  email1: string;
  address: string;
  city: string;
  zipCode: string;
  state: string;
  addressNote: string;
  model: string;
  serialNo: string;
  modelVersion: string;
  brand: string;
  productCategory: string;
  purchaseDate: string;
  warrantyType: string;
  cxPreferredDate: string;
  callTakenDate: string;
  problemDescription: string;
};

const TICKET_COPY_KEY_PREFIX = "ahs:ticket-copy:";
const TICKET_AUDIT_KEY_PREFIX = "ahs:ticket-audit:";
const TICKET_VISIT_LOG_KEY_PREFIX = "ahs:ticket-visit-log:";
const TICKET_PART_LOG_KEY_PREFIX = "ahs:ticket-part-log:";

function formatAuditValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function getAuditKey(ticketNo: string) {
  return `${TICKET_AUDIT_KEY_PREFIX}${ticketNo}`;
}

function loadAuditEntries(ticketNo: string) {
  if (typeof window === "undefined") return [] as AuditLogEntry[];

  const raw = window.localStorage.getItem(getAuditKey(ticketNo));
  if (!raw) return [] as AuditLogEntry[];

  try {
    const parsed = JSON.parse(raw) as AuditLogEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [] as AuditLogEntry[];
  }
}

function saveAuditEntries(ticketNo: string, entries: AuditLogEntry[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getAuditKey(ticketNo), JSON.stringify(entries));
}

function getVisitLogKey(ticketNo: string) {
  return `${TICKET_VISIT_LOG_KEY_PREFIX}${ticketNo}`;
}

function getPartLogKey(ticketNo: string) {
  return `${TICKET_PART_LOG_KEY_PREFIX}${ticketNo}`;
}

function createEmptyPartDraft(): PartTransactionDraft {
  return {
    partNo: "",
    partDist: "",
    partDesc: "",
    poNo: "",
    poDate: "",
    invoiceNo: "",
    invoiceDate: "",
    quantity: "1",
    partPrice: "",
    coreValue: "",
    shipCost: "",
    markup: "",
    totalMarkup: "",
    claimTo: "",
    status: "",
    note: "",
    visitId: "",
    orderNo: "",
    eta: "",
    inTracking: "",
    raDate: "",
    raNo: "",
    outTracking: "",
    creditNo: "",
    hold: "No",
    cxPaid: "No",
  };
}

function loadVisitLogEntries(ticketNo: string) {
  if (typeof window === "undefined") return [] as VisitLogEntry[];

  const raw = window.localStorage.getItem(getVisitLogKey(ticketNo));
  if (!raw) return [] as VisitLogEntry[];

  try {
    const parsed = JSON.parse(raw) as VisitLogEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [] as VisitLogEntry[];
  }
}

function saveVisitLogEntries(ticketNo: string, entries: VisitLogEntry[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getVisitLogKey(ticketNo), JSON.stringify(entries));
}

function loadPartRows(ticketNo: string) {
  if (typeof window === "undefined") return [] as PartTransactionRow[];

  const raw = window.localStorage.getItem(getPartLogKey(ticketNo));
  if (!raw) return [] as PartTransactionRow[];

  try {
    const parsed = JSON.parse(raw) as PartTransactionRow[];
    return Array.isArray(parsed) ? parsed.map((row) => normalizePartRow(row)) : [];
  } catch {
    return [] as PartTransactionRow[];
  }
}

function savePartRows(ticketNo: string, rows: PartTransactionRow[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getPartLogKey(ticketNo), JSON.stringify(rows));
}

function normalizePartRow(row: Partial<PartTransactionRow> & { id: string }): PartTransactionRow {
  return {
    id: row.id,
    partNo: row.partNo || "",
    partDist: row.partDist || "",
    partDesc: row.partDesc || "",
    poNo: row.poNo || "",
    poDate: row.poDate || "",
    invoiceNo: row.invoiceNo || "",
    invoiceDate: row.invoiceDate || "",
    quantity: row.quantity || "",
    partPrice: row.partPrice || "",
    coreValue: row.coreValue || "",
    shipCost: row.shipCost || "",
    markup: row.markup || "",
    totalMarkup: row.totalMarkup || "",
    claimTo: row.claimTo || "",
    status: row.status || "",
    note: row.note || "",
    visitId: row.visitId || "",
    orderNo: row.orderNo || "",
    eta: row.eta || "",
    inTracking: row.inTracking || "",
    raDate: row.raDate || "",
    raNo: row.raNo || "",
    outTracking: row.outTracking || "",
    creditNo: row.creditNo || "",
    hold: row.hold || "No",
    cxPaid: row.cxPaid || "No",
    createdBy: row.createdBy || "Current User",
    lastModifiedBy: row.lastModifiedBy || row.createdBy || "Current User",
  };
}

function getNextVisitNumber(entries: VisitLogEntry[]) {
  const nextIndex = entries.reduce((max, entry) => {
    const numeric = Number.parseInt(entry.visitNo.replace(/\D/g, ""), 10);
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, 0) + 1;

  return `V${nextIndex}`;
}

function createVisitLogEntry(params: Omit<VisitLogEntry, "id" | "timestamp">): VisitLogEntry {
  return {
    id: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
    timestamp: new Date().toISOString(),
    ...params,
  };
}

function createPartRow(params: Omit<PartTransactionRow, "id" | "createdBy" | "lastModifiedBy"> & { createdBy: string; lastModifiedBy: string }): PartTransactionRow {
  return {
    id: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
    ...params,
  };
}

function summarizeVisitEntry(entry: VisitLogEntry) {
  return [
    ["Visit No", entry.visitNo],
    ["Schedule Date", entry.scheduleDate],
    ["Technician", entry.technician],
    ["Time Slot", entry.timeSlot],
    ["Activity", entry.activity],
    ["Action Type", entry.actionType],
    ["Repair Status", entry.repairStatus],
    ["Repair Type", entry.repairType],
    ["Reclaim", entry.reclaim],
    ["Visited", entry.visited],
    ["Not Completed", entry.notCompleted],
    ["Symptom (Cx)", entry.symptomCx],
    ["Diagnosis", entry.diagnosis],
    ["Symptom (Tech)", entry.symptomTech],
    ["Resolution", entry.resolution],
    ["Non-Completion Reason", entry.nonCompletionReason],
    ["Triage Note", entry.triageNote],
    ["Internal Note", entry.note],
  ]
    .map(([label, value]) => `${label}: ${formatAuditValue(value)}`)
    .join(" | ");
}

function renderVisitSummary(summary: string, comparedSummary?: string) {
  const summaryParts = summary.split(" | ");
  const comparedParts = comparedSummary?.split(" | ") ?? [];

  return summaryParts.map((part, index) => {
    const isChanged = comparedSummary ? comparedParts[index] !== part : false;

    return (
      <span
        key={`${part}-${index}`}
        className={isChanged
          ? "mt-1 block rounded-md bg-amber-500/10 px-1.5 py-0.5 font-semibold text-amber-200"
          : "block whitespace-pre-wrap text-slate-200"}
      >
        {isChanged ? part : part}
      </span>
    );
  });
}

function summarizePartRow(row: PartTransactionRow) {
  return [
    ["Part No", row.partNo],
    ["Part Dist", row.partDist],
    ["Part Desc", row.partDesc],
    ["PO No", row.poNo],
    ["P/O Date", row.poDate],
    ["Invoice No", row.invoiceNo],
    ["Invoice Date", row.invoiceDate],
    ["Qty", row.quantity],
    ["Part Price", row.partPrice],
    ["Core Value", row.coreValue],
    ["Ship Cost", row.shipCost],
    ["Markup", row.markup],
    ["Total (Markup)", row.totalMarkup],
    ["Claim To", row.claimTo],
    ["Status", row.status],
    ["Note", row.note],
    ["Visit ID", row.visitId],
    ["Order #", row.orderNo],
    ["ETA", row.eta],
    ["In Tracking #", row.inTracking],
    ["RA Date", row.raDate],
    ["RA #", row.raNo],
    ["Out Tracking #", row.outTracking],
    ["Credit #", row.creditNo],
    ["Hold", row.hold],
    ["Cx Paid", row.cxPaid],
  ]
    .map(([label, value]) => `${label}: ${formatAuditValue(value)}`)
    .join(" | ");
}

function createAuditEntry(params: Omit<AuditLogEntry, "id" | "timestamp">): AuditLogEntry {
  return {
    id: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
    timestamp: new Date().toISOString(),
    ...params,
  };
}

const COMPENSATION_FIELD_LABELS: Record<keyof Omit<CompensationRow, "id" | "createdBy" | "lastModifiedBy">, string> = {
  item: "Compensation Item",
  beneficiary: "Beneficiary",
  amount: "Amount",
  rate: "Rate",
  activityDate: "Activity Date",
  requiresClaimOrCxPayment: "Requires Approved Claim / Requires Cx Payment",
  comment: "Comment",
};

const PART_FIELD_LABELS: Record<keyof Omit<PartTransactionRow, "id" | "createdBy" | "lastModifiedBy">, string> = {
  partNo: "Part No",
  partDist: "Part Dist.",
  partDesc: "Part Desc",
  poNo: "PO No",
  poDate: "P/O Date",
  invoiceNo: "Invoice No",
  invoiceDate: "Invoice Date",
  quantity: "Qty",
  partPrice: "Part Price",
  coreValue: "Core Value",
  shipCost: "Ship Cost",
  markup: "Markup",
  totalMarkup: "Total (Markup)",
  claimTo: "Claim To",
  status: "Status",
  note: "Note",
  visitId: "Visit ID",
  orderNo: "Order #",
  eta: "ETA",
  inTracking: "In Tracking #",
  raDate: "RA Date",
  raNo: "RA #",
  outTracking: "Out Tracking #",
  creditNo: "Credit #",
  hold: "Hold",
  cxPaid: "Cx Paid",
};

const DEFAULT_TICKET: TicketData = {
  ticketNo: "017151274136",
  account: "SQUARE TRADE",
  warranty: "IW",
  product: "Dryer",
  tat: "0d",
  status: "CSR-Assigned to ASC",
  schedule: "N/A",
  contact: "Sched.",
  location: "Lake Charles",
  firstName: "ROBERT",
  lastName: "CHANCE",
  address: "119 COUNTY RD. 4156",
  city: "DEWEYVILLE",
  state: "Texas",
  zip: "77614",
  homePhone: "409-221-5089",
  cellPhone: "409-221-5089",
  email: "robert0278@yahoo.com",
  brand: "GENERAL ELECTRIC",
  model: "GTX33EASKWW",
  serialNo: "",
  productCategory: "Dryer",
  purchaseDate: "04/11/2025",
  warrantyType: "In warranty",
  claimCompany: "SQUARE TRADE",
  accountNo: "GSL00002",
  callNo: "017151274136",
  callType: "In warranty",
  callStatus: "ACCEPTED / ACCEPTED",
  postingDate: "2026-05-29",
  problemDescription: "THE START BUTTON IS NOT WORKING IT GETS STUCK WHEN IT S PUSHED DOWN.",
  scheduleDate: "2026-06-05",
  schedulePeriod: "12:00 - 17:00 AFTERNOON",
  technician: "",
  customerNotes: [
    {
      date: "05/29/2026 04:36:35",
      notes: "Allstate call created: model & issue details. Repair date: 2026-06-05. Time Slot: 12-17. Parts have been sent. Tracking numbers will be updated once available.",
      by: "SQTRADE1",
    },
  ],
  servicerNotes: [],
};

const TICKET_DATA: Record<string, TicketData> = {
  "017151274136": DEFAULT_TICKET,
  "039873174136": {
    ...DEFAULT_TICKET,
    ticketNo: "039873174136",
    account: "SQUARE TRADE",
    product: "Dryer",
    status: "CL-Claimed",
    schedule: "2026-05-28 09:30 AM",
    firstName: "ROBERT",
    lastName: "CHANCE",
    city: "DEWEYVILLE",
    problemDescription: "CLAIMED TICKET FOR THE SAME CUSTOMER EMAIL.",
    callNo: "039873174136",
    customerNotes: [
      {
        date: "05/20/2026 09:12:02",
        notes: "Related claim created and linked to the same customer profile.",
        by: "SQTRADE1",
      },
    ],
  },
  "026000671769DF1": {
    ...DEFAULT_TICKET,
    ticketNo: "026000671769DF1",
    account: "GSL00002",
    warranty: "IW",
    product: "Washer",
    tat: "3d",
    status: "OP-Waiting for Part",
    schedule: "05/18/26",
    contact: "Y",
    location: "Atlanta",
    firstName: "ROSE",
    lastName: "PHILLIPS",
    city: "ELLENWOOD",
    zip: "30294",
    homePhone: "404.640.7141",
    cellPhone: "404.640.7141",
    email: "rose.phillips@example.com",
    brand: "IH",
    model: "DV45K7600EW",
    productCategory: "Washer",
    warrantyType: "In warranty",
    claimCompany: "GSL00002",
    accountNo: "GSL00002",
    callNo: "026000671769DF1",
    callType: "In warranty",
    callStatus: "ACCEPTED / ACCEPTED",
    postingDate: "2026-05-15",
    scheduleDate: "2026-05-18",
    schedulePeriod: "08:00 - 12:00 MORNING",
    technician: "Nathan Napora",
    problemDescription: "WASHER IS NOT SPINNING.",
  },
  "1007208750-10": {
    ...DEFAULT_TICKET,
    ticketNo: "1007208750-10",
    account: "GSL00002",
    warranty: "IW",
    product: "Dryer",
    tat: "1d",
    status: "CSR-Assigned to ASC",
    schedule: "05/19/26",
    contact: "N",
    location: "Atlanta",
    firstName: "CHARLES",
    lastName: "MCDONALD",
    city: "GREENSBORO",
    state: "GA",
    homePhone: "404.680.4022",
    cellPhone: "404.680.4022",
    email: "charles.mcdonald@example.com",
    brand: "IH",
    model: "FRUF2020AW",
    productCategory: "Dryer",
    warrantyType: "In warranty",
    claimCompany: "GSL00002",
    accountNo: "GSL00002",
    callNo: "1007208750-10",
    callType: "SMS",
    callStatus: "CSR-Assigned to ASC",
    postingDate: "2026-05-17",
    scheduleDate: "2026-05-19",
    schedulePeriod: "N/A",
    technician: "",
    problemDescription: "DRYER ISSUE FROM THE TICKET LIST. DETAILS SHOULD MATCH THE LIST ENTRY.",
    customerNotes: [
      {
        date: "05/17/2026 10:05:44",
        notes: "Imported from the ticket list record for Charles Mcdonald.",
        by: "SYSTEM",
      },
    ],
  },
  "SA-3458831": {
    ...DEFAULT_TICKET,
    ticketNo: "SA-3458831",
    account: "GSL00002",
    warranty: "IW",
    product: "Dryer",
    tat: "0d",
    status: "CSR-Assigned to ASC",
    schedule: "05/21/26",
    contact: "N",
    location: "Atlanta",
    firstName: "NEAL",
    lastName: "MARKET",
    city: "GREENSBORO",
    state: "GA",
    homePhone: "706.817.2900",
    cellPhone: "706.817.2900",
    email: "neal.market@example.com",
    brand: "IH",
    model: "GNE27JYMFFS",
    productCategory: "Dryer",
    warrantyType: "In warranty",
    claimCompany: "GSL00002",
    accountNo: "GSL00002",
    callNo: "SA-3458831",
    callType: "SMS",
    callStatus: "CSR-Assigned to ASC",
    postingDate: "2026-05-18",
    scheduleDate: "2026-05-21",
    schedulePeriod: "N/A",
    technician: "",
    problemDescription: "TICKET FROM THE LIST VIEW: NEEDS FULL DETAILS TO OPEN HERE.",
    customerNotes: [
      {
        date: "05/18/2026 08:14:11",
        notes: "Ticket entered from list view and opened from the ticket number field.",
        by: "SYSTEM",
      },
    ],
  },
  "26000679102DF": {
    ...DEFAULT_TICKET,
    ticketNo: "26000679102DF",
    account: "GSL00002",
    warranty: "IW",
    product: "Cooktop",
    tat: "1d",
    status: "CSR-Assigned to ASC",
    schedule: "05/19/26",
    contact: "N",
    location: "Atlanta",
    firstName: "BRIAN",
    lastName: "ROWE",
    city: "SHADY DALE",
    state: "GA",
    zip: "30071",
    homePhone: "706.366.1043",
    cellPhone: "706.366.1043",
    email: "brian.rowe@example.com",
    brand: "IH",
    model: "FCRE3083AS",
    productCategory: "Cooktop",
    warrantyType: "In warranty",
    claimCompany: "GSL00002",
    accountNo: "GSL00002",
    callNo: "26000679102DF",
    callType: "SMS",
    callStatus: "CSR-Assigned to ASC",
    postingDate: "2026-05-17",
    scheduleDate: "2026-05-19",
    schedulePeriod: "N/A",
    technician: "",
    problemDescription: "COOKTOP IS NOT HEATING CORRECTLY.",
  },
};

function buildTicketCopyPayload(ticket: TicketData): TicketCopyPayload {
  const customerName = `${ticket.firstName} ${ticket.lastName}`.trim();
  return {
    ticketNo: `a-${ticket.ticketNo}`,
    source: "Redo",
    customerName,
    primaryPhone: ticket.homePhone || ticket.cellPhone,
    secondaryPhone: ticket.cellPhone === ticket.homePhone ? "" : ticket.cellPhone,
    email1: ticket.email,
    address: ticket.address,
    city: ticket.city,
    zipCode: ticket.zip,
    state: ticket.state,
    addressNote: `Copied from ticket ${ticket.ticketNo}`,
    model: ticket.model,
    serialNo: ticket.serialNo,
    modelVersion: "",
    brand: ticket.brand,
    productCategory: ticket.productCategory,
    purchaseDate: ticket.purchaseDate,
    warrantyType: ticket.warrantyType,
    cxPreferredDate: ticket.scheduleDate || "",
    callTakenDate: ticket.postingDate,
    problemDescription: ticket.problemDescription,
  };
}

export const Route = createFileRoute("/ticket/$ticketNo")({
  ssr: false,
  head: () => ({
    meta: [{
      title: `Ticket Details — Admin Hub Solutions`,
    }],
  }),
  component: TicketDetailsPage,
});

function TicketDetailsPage() {
  const { ticketNo } = Route.useParams();
  const navigate = useNavigate();
  const { email: currentUserEmail } = useAuth();
  const [activeTab, setActiveTab] = useState<"general" | "tracking" | "compensation" | "billing">("general");
  const [newServicerNote, setNewServicerNote] = useState("");
  const [newVisitStatus, setNewVisitStatus] = useState("Visited");
  const [newVisitNote, setNewVisitNote] = useState("");
  const [newVisitScheduleDate, setNewVisitScheduleDate] = useState("");
  const [newVisitTechnician, setNewVisitTechnician] = useState("");
  const [newVisitTimeSlot, setNewVisitTimeSlot] = useState("");
  const [newVisitActivity, setNewVisitActivity] = useState("");
  const [newVisitActionType, setNewVisitActionType] = useState("Visited");
  const [newVisitRepairStatus, setNewVisitRepairStatus] = useState("");
  const [newVisitRepairType, setNewVisitRepairType] = useState("");
  const [newVisitReclaim, setNewVisitReclaim] = useState("");
  const [newVisitVisited, setNewVisitVisited] = useState("Visited");
  const [newVisitNotCompleted, setNewVisitNotCompleted] = useState("No");
  const [newVisitSymptomCx, setNewVisitSymptomCx] = useState("");
  const [newVisitDiagnosis, setNewVisitDiagnosis] = useState("");
  const [newVisitSymptomTech, setNewVisitSymptomTech] = useState("");
  const [newVisitResolution, setNewVisitResolution] = useState("");
  const [newVisitNonCompletionReason, setNewVisitNonCompletionReason] = useState("");
  const [newVisitTriageNote, setNewVisitTriageNote] = useState("");
  const [selectedTicket, setSelectedTicket] = useState(ticketNo);
  const [editingVisitId, setEditingVisitId] = useState<string | null>(null);
  const [visitFormMode, setVisitFormMode] = useState<"edit" | "view">("edit");
  const [isVisitModalOpen, setIsVisitModalOpen] = useState(false);
  const [viewingVisitEntry, setViewingVisitEntry] = useState<VisitLogEntry | null>(null);
  const currentEditor = currentUserEmail ?? "Current User";
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
  const [visitLogEntries, setVisitLogEntries] = useState<VisitLogEntry[]>([]);
  const [partRows, setPartRows] = useState<PartTransactionRow[]>([]);
  const [partRowsLoaded, setPartRowsLoaded] = useState(false);
  const [editingPartId, setEditingPartId] = useState<string | null>(null);
  const [partDraft, setPartDraft] = useState<PartTransactionDraft>(createEmptyPartDraft());
  const [compensationRows, setCompensationRows] = useState<CompensationRow[]>([
    {
      id: "comp-1",
      item: "Extra Labor",
      beneficiary: "Anna Seo",
      amount: "1",
      rate: "",
      activityDate: "05/29/2026",
      requiresClaimOrCxPayment: "",
      comment: "",
      createdBy: currentEditor,
      lastModifiedBy: currentEditor,
    },
  ]);

  useEffect(() => {
    setAuditEntries(loadAuditEntries(ticketNo));
    setVisitLogEntries(loadVisitLogEntries(ticketNo));
    setPartRowsLoaded(false);
    setPartRows(loadPartRows(ticketNo));
    setEditingPartId(null);
    setPartDraft(createEmptyPartDraft());
  }, [ticketNo]);

  useEffect(() => {
    saveAuditEntries(ticketNo, auditEntries);
  }, [auditEntries, ticketNo]);

  useEffect(() => {
    saveVisitLogEntries(ticketNo, visitLogEntries);
  }, [ticketNo, visitLogEntries]);

  useEffect(() => {
    if (!partRowsLoaded) {
      setPartRowsLoaded(true);
      return;
    }

    savePartRows(ticketNo, partRows);
  }, [partRows, partRowsLoaded, ticketNo]);

  const appendAuditEntry = (entry: Omit<AuditLogEntry, "id" | "timestamp">) => {
    setAuditEntries((entries) => [createAuditEntry(entry), ...entries]);
  };

  const auditCountLabel = useMemo(() => `${auditEntries.length} change${auditEntries.length === 1 ? "" : "s"} logged`, [auditEntries.length]);
  const partAuditEntries = useMemo(
    () => auditEntries.filter((entry) => entry.field === "Part Transaction"),
    [auditEntries],
  );
  const partCountLabel = useMemo(
    () => `${partRows.length} distinct record${partRows.length === 1 ? "" : "s"} found`,
    [partRows.length],
  );

  const handleTicketChange = (newTicketNo: string) => {
    if (newTicketNo.trim()) {
      setSelectedTicket(newTicketNo);
      navigate({ to: `/ticket/${newTicketNo}` });
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedTicket(e.target.value);
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleTicketChange(selectedTicket);
    }
  };

  // Sync selected ticket with URL parameter
  useEffect(() => {
    setSelectedTicket(ticketNo);
  }, [ticketNo]);

  const ticket = TICKET_DATA[ticketNo];

  const addServicerNote = () => {
    if (newServicerNote.trim()) {
      ticket.servicerNotes.push({
        notes: newServicerNote,
        by: "Current User",
      });
      appendAuditEntry({
        by: currentEditor,
        action: "Added servicer note",
        field: "Servicer Notes",
        before: "—",
        after: newServicerNote.trim(),
      });
      setNewServicerNote("");
    }
  };

  const addVisitLogEntry = () => {
    if (visitFormMode === "view") {
      return;
    }

    const trimmedNote = newVisitNote.trim();
    if (!newVisitScheduleDate || !newVisitTechnician) return;

    const existingVisit = editingVisitId ? visitLogEntries.find((entry) => entry.id === editingVisitId) ?? null : null;

    const visitEntry: VisitLogEntry = {
      ...(existingVisit ?? createVisitLogEntry({
        visitNo: getNextVisitNumber(visitLogEntries),
        by: currentEditor,
        scheduleDate: newVisitScheduleDate,
        technician: newVisitTechnician,
        timeSlot: newVisitTimeSlot,
        activity: newVisitActivity,
        actionType: newVisitActionType,
        repairStatus: newVisitRepairStatus,
        repairType: newVisitRepairType,
        reclaim: newVisitReclaim,
        visited: newVisitVisited,
        notCompleted: newVisitNotCompleted,
        symptomCx: newVisitSymptomCx,
        diagnosis: newVisitDiagnosis,
        symptomTech: newVisitSymptomTech,
        resolution: newVisitResolution,
        nonCompletionReason: newVisitNonCompletionReason,
        triageNote: newVisitTriageNote,
        status: newVisitStatus,
        note: trimmedNote,
      })),
      by: currentEditor,
      scheduleDate: newVisitScheduleDate,
      technician: newVisitTechnician,
      timeSlot: newVisitTimeSlot,
      activity: newVisitActivity,
      actionType: newVisitActionType,
      repairStatus: newVisitRepairStatus,
      repairType: newVisitRepairType,
      reclaim: newVisitReclaim,
      visited: newVisitVisited,
      notCompleted: newVisitNotCompleted,
      symptomCx: newVisitSymptomCx,
      diagnosis: newVisitDiagnosis,
      symptomTech: newVisitSymptomTech,
      resolution: newVisitResolution,
      nonCompletionReason: newVisitNonCompletionReason,
      triageNote: newVisitTriageNote,
      status: newVisitStatus,
      note: trimmedNote,
    };

    visitEntry.updatedAt = editingVisitId ? new Date().toISOString() : undefined;

    setVisitLogEntries((entries) => {
      if (editingVisitId) {
        return entries.map((entry) => (entry.id === editingVisitId ? visitEntry : entry));
      }

      return [visitEntry, ...entries];
    });
    appendAuditEntry({
      by: currentEditor,
      action: editingVisitId ? "Updated visit log" : "Added visit log",
      field: "Visit Log",
      before: existingVisit ? summarizeVisitEntry(existingVisit) : "—",
      after: summarizeVisitEntry(visitEntry),
    });
    clearVisitForm();
    setIsVisitModalOpen(false);
  };

  const clearVisitForm = () => {
    setEditingVisitId(null);
    setVisitFormMode("edit");
    setNewVisitNote("");
    setNewVisitStatus("Visited");
    setNewVisitScheduleDate("");
    setNewVisitTechnician("");
    setNewVisitTimeSlot("");
    setNewVisitActivity("");
    setNewVisitActionType("Visited");
    setNewVisitRepairStatus("");
    setNewVisitRepairType("");
    setNewVisitReclaim("");
    setNewVisitVisited("Visited");
    setNewVisitNotCompleted("No");
    setNewVisitSymptomCx("");
    setNewVisitDiagnosis("");
    setNewVisitSymptomTech("");
    setNewVisitResolution("");
    setNewVisitNonCompletionReason("");
    setNewVisitTriageNote("");
  };

  const openVisitCreateModal = () => {
    clearVisitForm();
    setIsVisitModalOpen(true);
  };

  const openVisitEditModal = (entry: VisitLogEntry) => {
    loadVisitForEdit(entry);
    setIsVisitModalOpen(true);
  };

  const loadVisitForEdit = (entry: VisitLogEntry) => {
    setVisitFormMode("edit");
    setEditingVisitId(entry.id);
    setNewVisitStatus(entry.status || "Visited");
    setNewVisitNote(entry.note || "");
    setNewVisitScheduleDate(entry.scheduleDate || "");
    setNewVisitTechnician(entry.technician || "");
    setNewVisitTimeSlot(entry.timeSlot || "");
    setNewVisitActivity(entry.activity || "");
    setNewVisitActionType(entry.actionType || "Visited");
    setNewVisitRepairStatus(entry.repairStatus || "");
    setNewVisitRepairType(entry.repairType || "");
    setNewVisitReclaim(entry.reclaim || "");
    setNewVisitVisited(entry.visited || "Visited");
    setNewVisitNotCompleted(entry.notCompleted || "No");
    setNewVisitSymptomCx(entry.symptomCx || "");
    setNewVisitDiagnosis(entry.diagnosis || "");
    setNewVisitSymptomTech(entry.symptomTech || "");
    setNewVisitResolution(entry.resolution || "");
    setNewVisitNonCompletionReason(entry.nonCompletionReason || "");
    setNewVisitTriageNote(entry.triageNote || "");
  };

  const loadVisitForView = (entry: VisitLogEntry) => {
    setVisitFormMode("view");
    setEditingVisitId(null);
    setViewingVisitEntry(entry);
  };

  const deleteVisitLogEntry = (visitId: string) => {
    if (!confirm("Remove this visit log entry?")) return;

    const entryToDelete = visitLogEntries.find((entry) => entry.id === visitId) ?? null;
    setVisitLogEntries((entries) => entries.filter((entry) => entry.id !== visitId));
    appendAuditEntry({
      by: currentEditor,
      action: "Deleted visit log",
      field: "Visit Log",
      before: entryToDelete ? summarizeVisitEntry(entryToDelete) : "—",
      after: "Removed",
    });

    if (editingVisitId === visitId) {
      clearVisitForm();
    }
  };

  const closeVisitView = () => {
    setViewingVisitEntry(null);
    setVisitFormMode("edit");
  };

  const closeVisitModal = () => {
    setIsVisitModalOpen(false);
    clearVisitForm();
  };

  const clearPartForm = () => {
    setEditingPartId(null);
    setPartDraft(createEmptyPartDraft());
  };

  const loadPartForEdit = (row: PartTransactionRow) => {
    setEditingPartId(row.id);
    setPartDraft({
      partNo: row.partNo || "",
      partDist: row.partDist || "",
      partDesc: row.partDesc || "",
      poNo: row.poNo || "",
      poDate: row.poDate || "",
      invoiceNo: row.invoiceNo || "",
      invoiceDate: row.invoiceDate || "",
      quantity: row.quantity || "1",
      partPrice: row.partPrice || "",
      coreValue: row.coreValue || "",
      shipCost: row.shipCost || "",
      markup: row.markup || "",
      totalMarkup: row.totalMarkup || "",
      claimTo: row.claimTo || "",
      status: row.status || "",
      note: row.note || "",
      visitId: row.visitId || "",
      orderNo: row.orderNo || "",
      eta: row.eta || "",
      inTracking: row.inTracking || "",
      raDate: row.raDate || "",
      raNo: row.raNo || "",
      outTracking: row.outTracking || "",
      creditNo: row.creditNo || "",
      hold: row.hold || "No",
      cxPaid: row.cxPaid || "No",
    });
  };

  const savePartRow = () => {
    if (!partDraft.partNo.trim() || !partDraft.partDist.trim() || !partDraft.quantity.trim() || !partDraft.status.trim() || !partDraft.visitId.trim()) return;

    const rowId = editingPartId ?? (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`);

    const totalMarkup = partDraft.totalMarkup.trim() || [partDraft.partPrice, partDraft.markup]
      .filter((value) => value.trim())
      .join(" + ");

    const nextRow: PartTransactionRow = {
      id: rowId,
      partNo: partDraft.partNo.trim(),
      partDist: partDraft.partDist.trim(),
      partDesc: partDraft.partDesc.trim(),
      poNo: partDraft.poNo.trim(),
      poDate: partDraft.poDate.trim(),
      invoiceNo: partDraft.invoiceNo.trim(),
      invoiceDate: partDraft.invoiceDate.trim(),
      quantity: partDraft.quantity.trim(),
      partPrice: partDraft.partPrice.trim(),
      coreValue: partDraft.coreValue.trim(),
      shipCost: partDraft.shipCost.trim(),
      markup: partDraft.markup.trim(),
      totalMarkup,
      claimTo: partDraft.claimTo.trim(),
      status: partDraft.status.trim(),
      note: partDraft.note.trim(),
      visitId: partDraft.visitId.trim(),
      orderNo: partDraft.orderNo.trim(),
      eta: partDraft.eta.trim(),
      inTracking: partDraft.inTracking.trim(),
      raDate: partDraft.raDate.trim(),
      raNo: partDraft.raNo.trim(),
      outTracking: partDraft.outTracking.trim(),
      creditNo: partDraft.creditNo.trim(),
      hold: partDraft.hold.trim() || "No",
      cxPaid: partDraft.cxPaid.trim() || "No",
      createdBy: editingPartId ? (partRows.find((row) => row.id === editingPartId)?.createdBy || currentEditor) : currentEditor,
      lastModifiedBy: currentEditor,
    };

    setPartRows((rows) => {
      if (editingPartId) {
        const existingRow = rows.find((row) => row.id === editingPartId) ?? null;
        appendAuditEntry({
          by: currentEditor,
          action: "Updated part transaction",
          field: "Part Transaction",
          before: existingRow ? summarizePartRow(existingRow) : "—",
          after: summarizePartRow(nextRow),
        });
        return rows.map((row) => (row.id === editingPartId ? nextRow : row));
      }

      appendAuditEntry({
        by: currentEditor,
        action: "Added part transaction",
        field: "Part Transaction",
        before: "—",
        after: summarizePartRow(nextRow),
      });
      return [nextRow, ...rows];
    });

    clearPartForm();
  };

  const deletePartRow = (rowId: string) => {
    if (!confirm("Remove this part transaction?")) return;

    const rowToDelete = partRows.find((row) => row.id === rowId) ?? null;
    setPartRows((rows) => rows.filter((row) => row.id !== rowId));
    appendAuditEntry({
      by: currentEditor,
      action: "Deleted part transaction",
      field: "Part Transaction",
      before: rowToDelete ? summarizePartRow(rowToDelete) : "—",
      after: "Removed",
    });

    if (editingPartId === rowId) {
      clearPartForm();
    }
  };

  const addCompensationRow = () => {
    appendAuditEntry({
      by: currentEditor,
      action: "Added compensation row",
      field: "Compensation Grid",
      before: "—",
      after: "Blank row created",
    });
    setCompensationRows((rows) => [
      ...rows,
      {
        id: `comp-${Date.now()}`,
        item: "",
        beneficiary: "",
        amount: "",
        rate: "",
        activityDate: "05/29/2026",
        requiresClaimOrCxPayment: "",
        comment: "",
        createdBy: currentEditor,
        lastModifiedBy: currentEditor,
      },
    ]);
  };

  const copyToNewTicket = () => {
    if (!ticket) return;

    const token = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const payload: TicketCopyPayload = buildTicketCopyPayload(ticket);
    window.localStorage.setItem(`${TICKET_COPY_KEY_PREFIX}${token}`, JSON.stringify(payload));
    window.open(`/m/tickets/new-ticket?copyToken=${encodeURIComponent(token)}`, "_blank", "noopener,noreferrer");
  };

  const updateCompensationRow = (rowId: string, field: keyof Omit<CompensationRow, "id" | "createdBy" | "lastModifiedBy">, value: string) => {
    setCompensationRows((rows) =>
      rows.map((row) =>
        row.id === rowId ? (() => {
          const previousValue = row[field];
          if (previousValue !== value) {
            appendAuditEntry({
              by: currentEditor,
              action: "Updated compensation row",
              field: COMPENSATION_FIELD_LABELS[field],
              before: formatAuditValue(previousValue),
              after: formatAuditValue(value),
            });
          }

          return {
            ...row,
            [field]: value,
            lastModifiedBy: currentEditor,
          };
        })() : row,
      ),
    );
  };

  return (
    <>
      <AppHeader />
      <main className="flex-1 bg-slate-950 py-6">
        <div className="max-w-6xl mx-auto px-6">
          <div className="bg-white/8 border border-white/15 rounded-xl p-5 text-white backdrop-blur-md">
            <div className="mb-4 flex flex-wrap items-center gap-4">
              <label htmlFor="ticket-selector" className="text-slate-400 font-semibold">Select Ticket:</label>
              <input
                id="ticket-selector"
                type="text"
                value={selectedTicket}
                onChange={handleInputChange}
                onKeyPress={handleKeyPress}
                placeholder="Enter ticket number... (Press Enter)"
                className="bg-slate-900 border border-white/20 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 placeholder-slate-500"
              />
              <button
                type="button"
                onClick={copyToNewTicket}
                disabled={!ticket}
                title="Copy to new ticket"
                aria-label="Copy to new ticket"
                className="inline-flex items-center justify-center rounded border border-blue-400/40 bg-blue-500/15 p-2 text-blue-200 transition hover:bg-blue-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">Ticket #{ticketNo}</h1>
              {ticket ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-white/10 bg-slate-900/90 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.04em] text-slate-400">Account</div>
                    <div className="text-sm font-semibold text-white">{ticket.account}</div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-slate-900/90 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.04em] text-slate-400">Warranty</div>
                    <div className="text-sm font-semibold text-white">{ticket.warranty}</div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-slate-900/90 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.04em] text-slate-400">Status</div>
                    <div className="text-sm font-semibold text-blue-300">{ticket.status}</div>
                  </div>
                </div>
              ) : (
                <div className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                  No ticket data is available for this number yet.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-6xl mx-auto px-6 mt-3">
          <div className="flex flex-wrap gap-2.5">
            {["general", "tracking", "compensation", "billing"].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as any)}
                className={`rounded-full border px-4 py-2 text-sm font-semibold transition-all ${
                  activeTab === tab
                    ? "border-blue-400/60 bg-blue-500/25 text-white"
                    : "border-white/20 bg-slate-900/90 text-slate-300 hover:border-slate-200/30 hover:text-white"
                }`}
              >
                {tab === "tracking" ? "Service Tracking" : tab.charAt(0).toUpperCase() + tab.slice(1).replace(/([A-Z])/g, " $1")}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="max-w-6xl mx-auto px-6 py-6">
        {!ticket ? (
          <div className="rounded-lg border border-white/10 bg-slate-900/50 p-6 text-slate-300">
            <p className="text-lg font-semibold text-white">Ticket not found</p>
            <p className="mt-2 text-sm text-slate-400">
              The ticket number {ticketNo} does not have a matching record in the current sample data.
            </p>
          </div>
        ) : activeTab === "general" && (
          <div className="space-y-8">
            {/* Quick Info Grid */}
            <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-6">
              <div className="grid grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-slate-400 font-semibold">Product</div>
                  <div className="text-white">{ticket.product}</div>
                </div>
                <div>
                  <div className="text-slate-400 font-semibold">TAT</div>
                  <div className="text-white">{ticket.tat}</div>
                </div>
                <div>
                  <div className="text-slate-400 font-semibold">Schedule</div>
                  <div className="text-white">{ticket.schedule}</div>
                </div>
                <div>
                  <div className="text-slate-400 font-semibold">Contact</div>
                  <div className="text-white">{ticket.contact}</div>
                </div>
              </div>
            </div>

            {/* General Information */}
            <div>
              <h3 className="text-lg font-semibold text-blue-400 mb-4">General Information</h3>

              {/* Customer Information */}
              <div className="space-y-4 mb-8">
                <h4 className="font-semibold text-slate-300">Customer Information</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <label className="text-slate-500 font-semibold">Location</label>
                    <div className="text-white mt-1">{ticket.location}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Tier Code</label>
                    <div className="text-white mt-1">N/A</div>
                  </div>
                  <div className="col-span-2">
                    <label className="text-slate-500 font-semibold">First/Last Name</label>
                    <div className="text-white mt-1">{ticket.firstName} {ticket.lastName}</div>
                  </div>
                  <div className="col-span-2">
                    <label className="text-slate-500 font-semibold">Address</label>
                    <div className="text-white mt-1">{ticket.address}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">City</label>
                    <div className="text-white mt-1">{ticket.city}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">State/Zip</label>
                    <div className="text-white mt-1">{ticket.state} {ticket.zip}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Home Phone</label>
                    <div className="text-white mt-1">{ticket.homePhone}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Cell Phone</label>
                    <div className="text-white mt-1">{ticket.cellPhone}</div>
                  </div>
                  <div className="col-span-2">
                    <label className="text-slate-500 font-semibold">Email</label>
                    <div className="text-white mt-1">{ticket.email}</div>
                  </div>
                </div>
              </div>

              {/* Product Information */}
              <div className="space-y-4 mb-8">
                <h4 className="font-semibold text-slate-300">Product Information</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <label className="text-slate-500 font-semibold">Brand</label>
                    <div className="text-white mt-1">{ticket.brand}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Model Code</label>
                    <div className="text-white mt-1">{ticket.model}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Serial No</label>
                    <div className="text-white mt-1">{ticket.serialNo || "—"}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Product Category</label>
                    <div className="text-white mt-1">{ticket.productCategory}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Purchase Date</label>
                    <div className="text-white mt-1">{ticket.purchaseDate}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Warranty Type</label>
                    <div className="text-white mt-1">{ticket.warrantyType}</div>
                  </div>
                  <div className="col-span-2">
                    <label className="text-slate-500 font-semibold">Claim Company</label>
                    <div className="text-white mt-1">{ticket.claimCompany}</div>
                  </div>
                </div>
              </div>

              {/* Call Service Information */}
              <div className="space-y-4 mb-8">
                <h4 className="font-semibold text-slate-300">Call Service Information</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <label className="text-slate-500 font-semibold">Account No</label>
                    <div className="text-white mt-1">{ticket.accountNo}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Call No</label>
                    <div className="text-white mt-1">{ticket.callNo}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Call Type</label>
                    <div className="text-white mt-1">{ticket.callType}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Call Status</label>
                    <div className="text-blue-300 mt-1 font-semibold">{ticket.callStatus}</div>
                  </div>
                  <div className="col-span-2">
                    <label className="text-slate-500 font-semibold">Posting Date</label>
                    <div className="text-white mt-1">{ticket.postingDate}</div>
                  </div>
                </div>
              </div>

              {/* Schedule Information */}
              <div className="space-y-4 mb-8">
                <h4 className="font-semibold text-slate-300">Schedule Information</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <label className="text-slate-500 font-semibold">Schedule Date</label>
                    <div className="text-white mt-1">{ticket.scheduleDate}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Schedule Period</label>
                    <div className="text-white mt-1">{ticket.schedulePeriod}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Technician</label>
                    <div className="text-white mt-1">{ticket.technician || "Not assigned"}</div>
                  </div>
                </div>
              </div>

              {/* Problem Description */}
              <div className="space-y-4 mb-8">
                <h4 className="font-semibold text-slate-300">Problem Description</h4>
                <div className="bg-slate-900/50 border border-white/10 rounded p-4 text-sm text-slate-300">
                  {ticket.problemDescription}
                </div>
              </div>

              {/* Customer Notes */}
              <div className="space-y-4 mb-8">
                <h4 className="font-semibold text-slate-300">Customer Notes</h4>
                <div className="space-y-3">
                  {ticket.customerNotes.map((note, idx) => (
                    <div key={idx} className="bg-slate-900/50 border border-white/10 rounded p-4 text-sm">
                      <div className="flex justify-between items-start mb-2">
                        <div className="text-slate-400">{note.date}</div>
                        <div className="text-blue-400">By: {note.by}</div>
                      </div>
                      <p className="text-slate-300">{note.notes}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Servicer Notes */}
              <div className="space-y-4 pb-12">
                <h4 className="font-semibold text-slate-300">Servicer Notes</h4>
                <div className="space-y-3 mb-4">
                  {ticket.servicerNotes.map((note, idx) => (
                    <div key={idx} className="bg-slate-900/50 border border-blue-500/30 rounded p-4 text-sm">
                      <div className="text-blue-400 text-xs mb-1">By: {note.by}</div>
                      <p className="text-slate-300">{note.notes}</p>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <textarea
                    value={newServicerNote}
                    onChange={(e) => setNewServicerNote(e.target.value)}
                    placeholder="Add a new comment..."
                    className="flex-1 bg-slate-900 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    rows={3}
                  />
                  <button
                    onClick={addServicerNote}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded text-sm transition"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "tracking" && (
          <div className="space-y-8">
            {/* Related Tickets */}
            <div>
              <h4 className="font-semibold text-slate-300 mb-4">Related Tickets</h4>
              <div className="bg-blue-900/20 border border-blue-500/30 rounded p-3 mb-3 text-sm text-slate-400">
                1 distinct record found
              </div>
              <div className="overflow-x-auto border border-white/10 rounded-lg">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-blue-900/50 border-b border-blue-500/30">
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Ticket No</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Matched</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Src/Acct</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Cx Name</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Zip</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Phone</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Type</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Schedule</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Status</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Brands</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Model</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Tech Name</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-4 py-3 font-mono text-blue-400">039873174136</td>
                      <td className="px-4 py-3 text-slate-300">Same Email</td>
                      <td className="px-4 py-3 text-slate-300">SQUARE TRADE</td>
                      <td className="px-4 py-3 text-slate-300">Robert Chance</td>
                      <td className="px-4 py-3 text-slate-300">77614</td>
                      <td className="px-4 py-3 text-slate-300">409.221.5089</td>
                      <td className="px-4 py-3 text-slate-300">IH</td>
                      <td className="px-4 py-3 text-slate-300">2026-05-28 09:30 AM</td>
                      <td className="px-4 py-3 text-slate-300">CL-Claimed</td>
                      <td className="px-4 py-3 text-slate-300">GENERAL ELECTRIC</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-300">GTX33EASK1WW</td>
                      <td className="px-4 py-3 text-slate-300">Danny Thornton</td>
                      <td className="px-4 py-3 text-slate-300">05/20/26</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Attachments */}
            <div>
              <h4 className="font-semibold text-slate-300 mb-4">Attachments</h4>
              <div className="bg-slate-900/50 border border-white/10 rounded p-4 space-y-4">
                <div className="text-sm text-slate-400">No file chosen</div>
                <button className="text-blue-400 hover:text-blue-300 text-sm font-semibold">+ Add</button>
              </div>
            </div>

            {/* Visit Log */}
            <div>
              <h4 className="font-semibold text-slate-300 mb-4">Visit Log</h4>
              <div className="space-y-4 text-sm">
                <div>
                  <label className="text-slate-500 font-semibold">Phone</label>
                  <div className="text-white mt-1">409-221-5089</div>
                </div>
                <div>
                  <label className="text-slate-500 font-semibold">Chat</label>
                  <button className="text-blue-400 hover:text-blue-300 font-semibold">Open Chat</button>
                </div>
                <div>
                  <label className="text-slate-500 font-semibold">Redo Ticket #</label>
                  <div className="text-white mt-1">NONE</div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={openVisitCreateModal} className="rounded-md border border-blue-400/40 bg-blue-500/20 px-4 py-2 text-sm font-semibold text-blue-200 transition hover:bg-blue-500/30">
                  Add Visit
                </button>
              </div>
              <div className="mt-4 rounded-lg border border-white/10 bg-slate-900/50 p-4">
                {visitFormMode === "view" ? (
                  <div className="mb-3 rounded-md border border-blue-400/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-200">
                    Viewing a saved visit. Use Edit on the row to make changes.
                  </div>
                ) : null}
                

                <div className="mt-4 border-t border-white/10 pt-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                      Visit History
                    </div>
                    <div className="text-xs text-slate-400">
                      {visitLogEntries.length} record{visitLogEntries.length === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div className="space-y-3">
                    {visitLogEntries.length === 0 ? (
                      <div className="rounded-md border border-dashed border-white/10 px-4 py-6 text-center text-sm text-slate-400">
                        No visit logs yet.
                      </div>
                    ) : (
                      visitLogEntries.map((entry) => (
                        <div key={entry.id} className="rounded-md border border-white/10 bg-slate-950/70 p-4 text-sm">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <div className="font-semibold text-blue-300">{entry.actionType} / {entry.repairStatus || "No status"}</div>
                              <div className="text-xs text-slate-400">{new Date(entry.timestamp).toLocaleString()}</div>
                            </div>
                            <div className="text-xs font-semibold text-slate-300">{entry.by}</div>
                          </div>
                          {entry.updatedAt ? (
                            <div className="mt-1 text-xs text-amber-200">Edited: {new Date(entry.updatedAt).toLocaleString()}</div>
                          ) : null}
                          <div className="mt-3 grid gap-2 text-xs text-slate-300 md:grid-cols-2 xl:grid-cols-3">
                            <div><span className="font-semibold text-slate-400">Schedule:</span> {entry.scheduleDate || "—"}</div>
                            <div><span className="font-semibold text-slate-400">Technician:</span> {entry.technician || "—"}</div>
                            <div><span className="font-semibold text-slate-400">Time Slot:</span> {entry.timeSlot || "—"}</div>
                            <div><span className="font-semibold text-slate-400">Activity:</span> {entry.activity || "—"}</div>
                            <div><span className="font-semibold text-slate-400">Visited:</span> {entry.visited || "—"}</div>
                            <div><span className="font-semibold text-slate-400">Not Completed?:</span> {entry.notCompleted || "—"}</div>
                          </div>
                          <div className="mt-3 grid gap-2 text-sm text-slate-200 md:grid-cols-2">
                            <p><span className="font-semibold text-slate-400">Symptom (Cx):</span> {entry.symptomCx || "—"}</p>
                            <p><span className="font-semibold text-slate-400">Diagnosis:</span> {entry.diagnosis || "—"}</p>
                            <p><span className="font-semibold text-slate-400">Symptom (Tech):</span> {entry.symptomTech || "—"}</p>
                            <p><span className="font-semibold text-slate-400">Resolution:</span> {entry.resolution || "—"}</p>
                            <p><span className="font-semibold text-slate-400">Repair Type:</span> {entry.repairType || "—"}</p>
                            <p><span className="font-semibold text-slate-400">Reclaim:</span> {entry.reclaim || "—"}</p>
                          </div>
                          <p className="mt-3 whitespace-pre-wrap text-slate-200"><span className="font-semibold text-slate-400">Note:</span> {entry.note || "—"}</p>
                          <p className="mt-2 whitespace-pre-wrap text-slate-200"><span className="font-semibold text-slate-400">Non-Completion Reason:</span> {entry.nonCompletionReason || "—"}</p>
                          <p className="mt-2 whitespace-pre-wrap text-slate-200"><span className="font-semibold text-slate-400">Triage Note:</span> {entry.triageNote || "—"}</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button type="button" onClick={() => loadVisitForView(entry)} className="rounded-md border border-white/15 bg-slate-900/90 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-slate-200/40">
                              View
                            </button>
                            <button type="button" onClick={() => openVisitEditModal(entry)} className="rounded-md border border-blue-400/40 bg-blue-500/15 px-3 py-1.5 text-xs font-semibold text-blue-200 transition hover:bg-blue-500/25">
                              Edit
                            </button>
                            <button type="button" onClick={() => deleteVisitLogEntry(entry.id)} className="rounded-md border border-rose-400/40 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/25">
                              Delete
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
              {isVisitModalOpen ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6 backdrop-blur-sm">
                  <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-white/15 bg-slate-900 p-5 text-white shadow-2xl">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                          {editingVisitId ? "Edit Visit" : "Add Visit"}
                        </p>
                        <h3 className="text-xl font-bold text-white">
                          {editingVisitId ? `Visit ${visitLogEntries.find((entry) => entry.id === editingVisitId)?.visitNo || ""}` : getNextVisitNumber(visitLogEntries)}
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={closeVisitModal}
                        className="rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-200/40"
                      >
                        Close
                      </button>
                    </div>

                    <div className="mt-4 rounded-lg border border-white/10 bg-slate-900/50 p-4">
                      {visitFormMode === "view" ? (
                        <div className="mb-3 rounded-md border border-blue-400/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-200">
                          Viewing a saved visit. Use Edit on the row to make changes.
                        </div>
                      ) : null}
                      <fieldset disabled={visitFormMode === "view"} className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <div className="space-y-1.5">
                          <label htmlFor="visit-schedule-date-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Schedule Date *</label>
                          <input id="visit-schedule-date-modal" type="date" value={newVisitScheduleDate} onChange={(event) => setNewVisitScheduleDate(event.target.value)} className="w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                        </div>
                        <div className="space-y-1.5">
                          <label htmlFor="visit-technician-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Technician *</label>
                          <select id="visit-technician-modal" value={newVisitTechnician} onChange={(event) => setNewVisitTechnician(event.target.value)} className="w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                            <option value="">— select —</option>
                            {ALL_TECHNICIANS.map((technician) => (
                              <option key={technician} value={technician}>{technician}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label htmlFor="visit-time-slot-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Time Slot</label>
                          <select id="visit-time-slot-modal" value={newVisitTimeSlot} onChange={(event) => setNewVisitTimeSlot(event.target.value)} className="w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                            <option value="">— select —</option>
                            <option>AM</option>
                            <option>PM</option>
                            <option>ALL DAY</option>
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label htmlFor="visit-activity-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Activity</label>
                          <input id="visit-activity-modal" type="text" value={newVisitActivity} onChange={(event) => setNewVisitActivity(event.target.value)} placeholder="e.g. 1.0 hr" className="w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500" />
                        </div>
                        <div className="space-y-1.5">
                          <label htmlFor="visit-action-type-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Action Type *</label>
                          <select id="visit-action-type-modal" value={newVisitActionType} onChange={(event) => setNewVisitActionType(event.target.value)} className="w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                            <option value="">— select —</option>
                            <option>Visited</option>
                            <option>Cx Conf.</option>
                            <option>Not Completed</option>
                            <option>Cancelled</option>
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label htmlFor="visit-repair-status-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Repair Status *</label>
                          <select id="visit-repair-status-modal" value={newVisitRepairStatus} onChange={(event) => setNewVisitRepairStatus(event.target.value)} className="w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                            <option value="">— select —</option>
                            <option>CL-Need Cancel</option>
                            <option>CL-Parts Back Ordered</option>
                            <option>CL-Ready to Complete</option>
                            <option>CSR-Acknowledged</option>
                            <option>CSR-Assigned to ASC</option>
                            <option>CSR-Left Message for Cx</option>
                            <option>CSR-Needs Scheduling</option>
                            <option>OP-Ready for Service</option>
                            <option>OP-Reschedule Follow up</option>
                            <option>OP-UPDATE HOLD</option>
                            <option>OP-Waiting for Part</option>
                            <option>PT-Need PreAuthorization</option>
                            <option>TR-Need PO</option>
                            <option>TR-Need Triage</option>
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label htmlFor="visit-repair-type-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Repair Type (2nd Tech)</label>
                          <input id="visit-repair-type-modal" type="text" value={newVisitRepairType} onChange={(event) => setNewVisitRepairType(event.target.value)} className="w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                        </div>
                        <div className="space-y-1.5">
                          <label htmlFor="visit-reclaim-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Reclaim</label>
                          <input id="visit-reclaim-modal" type="text" value={newVisitReclaim} onChange={(event) => setNewVisitReclaim(event.target.value)} className="w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                        </div>
                        <div className="space-y-1.5">
                          <label htmlFor="visit-visited-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Visited</label>
                          <select id="visit-visited-modal" value={newVisitVisited} onChange={(event) => setNewVisitVisited(event.target.value)} className="w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                            <option value="">— select —</option>
                            <option>Visited</option>
                            <option>Not Visited</option>
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label htmlFor="visit-not-completed-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Not Completed?</label>
                          <input id="visit-not-completed-modal" type="text" value={newVisitNotCompleted} onChange={(event) => setNewVisitNotCompleted(event.target.value)} className="w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                        </div>
                        <div className="space-y-1.5 xl:col-span-3">
                          <label htmlFor="visit-symptom-cx-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Symptom (Cx)</label>
                          <textarea id="visit-symptom-cx-modal" value={newVisitSymptomCx} onChange={(event) => setNewVisitSymptomCx(event.target.value)} className="min-h-18 w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                        </div>
                        <div className="space-y-1.5 xl:col-span-3">
                          <label htmlFor="visit-diagnosis-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Diagnosis</label>
                          <textarea id="visit-diagnosis-modal" value={newVisitDiagnosis} onChange={(event) => setNewVisitDiagnosis(event.target.value)} className="min-h-18 w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                        </div>
                        <div className="space-y-1.5 xl:col-span-3">
                          <label htmlFor="visit-symptom-tech-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Symptom (Tech)</label>
                          <textarea id="visit-symptom-tech-modal" value={newVisitSymptomTech} onChange={(event) => setNewVisitSymptomTech(event.target.value)} className="min-h-18 w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                        </div>
                        <div className="space-y-1.5 xl:col-span-3">
                          <label htmlFor="visit-resolution-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Resolution</label>
                          <textarea id="visit-resolution-modal" value={newVisitResolution} onChange={(event) => setNewVisitResolution(event.target.value)} className="min-h-18 w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                        </div>
                        <div className="space-y-1.5 xl:col-span-3">
                          <label htmlFor="visit-non-completion-reason-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Non-Completion Reason</label>
                          <textarea id="visit-non-completion-reason-modal" value={newVisitNonCompletionReason} onChange={(event) => setNewVisitNonCompletionReason(event.target.value)} className="min-h-18 w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                        </div>
                        <div className="space-y-1.5 xl:col-span-3">
                          <label htmlFor="visit-triage-note-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Triage Note</label>
                          <textarea id="visit-triage-note-modal" value={newVisitTriageNote} onChange={(event) => setNewVisitTriageNote(event.target.value)} className="min-h-18 w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                        </div>
                        <div className="space-y-1.5 xl:col-span-3">
                          <label htmlFor="visit-note-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Internal Note</label>
                          <textarea id="visit-note-modal" value={newVisitNote} onChange={(event) => setNewVisitNote(event.target.value)} placeholder="Record what happened during the visit" className="min-h-24 w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500" />
                        </div>
                      </fieldset>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {visitFormMode === "view" ? (
                          <button type="button" onClick={closeVisitModal} className="rounded-md border border-white/15 bg-slate-900/90 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-200/40">
                            Close View
                          </button>
                        ) : (
                          <button type="button" onClick={addVisitLogEntry} className="rounded-md border border-blue-400/40 bg-blue-500/20 px-4 py-2 text-sm font-semibold text-blue-200 transition hover:bg-blue-500/30">
                            {editingVisitId ? "Update Visit" : "Save Visit"}
                          </button>
                        )}
                        {editingVisitId && visitFormMode !== "view" ? (
                          <button type="button" onClick={clearVisitForm} className="rounded-md border border-white/15 bg-slate-900/90 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-200/40">
                            Cancel Edit
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

            </div>

            {viewingVisitEntry ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6 backdrop-blur-sm">
                <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-white/15 bg-slate-900 p-5 text-white shadow-2xl">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Visit Details</p>
                      <h3 className="text-xl font-bold text-white">{viewingVisitEntry.actionType} / {viewingVisitEntry.repairStatus || "No status"}</h3>
                      <p className="mt-1 text-sm text-slate-400">{new Date(viewingVisitEntry.timestamp).toLocaleString()} by {viewingVisitEntry.by}</p>
                    </div>
                    <button
                      type="button"
                      onClick={closeVisitView}
                      className="rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-200/40"
                    >
                      Close
                    </button>
                  </div>

                  {viewingVisitEntry.updatedAt ? (
                    <div className="mt-3 rounded-md border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                      Edited: {new Date(viewingVisitEntry.updatedAt).toLocaleString()}
                    </div>
                  ) : null}

                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3 text-sm text-slate-200">
                    <div className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"><span className="font-semibold text-slate-400">Schedule Date:</span> {viewingVisitEntry.scheduleDate || "—"}</div>
                    <div className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"><span className="font-semibold text-slate-400">Technician:</span> {viewingVisitEntry.technician || "—"}</div>
                    <div className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"><span className="font-semibold text-slate-400">Time Slot:</span> {viewingVisitEntry.timeSlot || "—"}</div>
                    <div className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"><span className="font-semibold text-slate-400">Activity:</span> {viewingVisitEntry.activity || "—"}</div>
                    <div className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"><span className="font-semibold text-slate-400">Visited:</span> {viewingVisitEntry.visited || "—"}</div>
                    <div className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"><span className="font-semibold text-slate-400">Not Completed?:</span> {viewingVisitEntry.notCompleted || "—"}</div>
                    <div className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 md:col-span-2 xl:col-span-3"><span className="font-semibold text-slate-400">Symptom (Cx):</span> {viewingVisitEntry.symptomCx || "—"}</div>
                    <div className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 md:col-span-2 xl:col-span-3"><span className="font-semibold text-slate-400">Diagnosis:</span> {viewingVisitEntry.diagnosis || "—"}</div>
                    <div className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 md:col-span-2 xl:col-span-3"><span className="font-semibold text-slate-400">Symptom (Tech):</span> {viewingVisitEntry.symptomTech || "—"}</div>
                    <div className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 md:col-span-2 xl:col-span-3"><span className="font-semibold text-slate-400">Resolution:</span> {viewingVisitEntry.resolution || "—"}</div>
                    <div className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 md:col-span-2 xl:col-span-3"><span className="font-semibold text-slate-400">Repair Type:</span> {viewingVisitEntry.repairType || "—"}</div>
                    <div className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 md:col-span-2 xl:col-span-3"><span className="font-semibold text-slate-400">Reclaim:</span> {viewingVisitEntry.reclaim || "—"}</div>
                    <div className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 md:col-span-2 xl:col-span-3"><span className="font-semibold text-slate-400">Note:</span> {viewingVisitEntry.note || "—"}</div>
                    <div className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 md:col-span-2 xl:col-span-3"><span className="font-semibold text-slate-400">Non-Completion Reason:</span> {viewingVisitEntry.nonCompletionReason || "—"}</div>
                    <div className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 md:col-span-2 xl:col-span-3"><span className="font-semibold text-slate-400">Triage Note:</span> {viewingVisitEntry.triageNote || "—"}</div>
                  </div>

                  <div className="mt-6 rounded-lg border border-white/10 bg-slate-900/50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Change Log</div>
                        <div className="text-sm text-slate-300">Every tracked edit on this ticket</div>
                      </div>
                      <div className="text-xs font-semibold text-blue-300">{auditCountLabel}</div>
                    </div>
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-blue-900/50 border-b border-blue-500/30">
                            <th className="px-4 py-3 text-left font-semibold text-blue-300">Time</th>
                            <th className="px-4 py-3 text-left font-semibold text-blue-300">Changed By</th>
                            <th className="px-4 py-3 text-left font-semibold text-blue-300">Action</th>
                            <th className="px-4 py-3 text-left font-semibold text-blue-300">Field</th>
                            <th className="px-4 py-3 text-left font-semibold text-blue-300">Before</th>
                            <th className="px-4 py-3 text-left font-semibold text-blue-300">After</th>
                          </tr>
                        </thead>
                        <tbody>
                          {auditEntries.length === 0 ? (
                            <tr className="border-b border-white/5">
                              <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                                No tracked changes yet.
                              </td>
                            </tr>
                          ) : (
                            auditEntries.map((entry) => (
                              <tr key={entry.id} className="border-b border-white/5 hover:bg-white/5 align-top">
                                <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{new Date(entry.timestamp).toLocaleString()}</td>
                                <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{entry.by}</td>
                                <td className="px-4 py-3 text-slate-300">{entry.action}</td>
                                <td className="px-4 py-3 text-slate-300">{entry.field}</td>
                                <td className="px-4 py-3 text-slate-400">{renderVisitSummary(entry.before)}</td>
                                <td className="px-4 py-3 text-slate-200">{renderVisitSummary(entry.after, entry.before)}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Visit Details Table */}
            <div>
              <h4 className="font-semibold text-slate-300 mb-4">Visit Details</h4>
              <div className="overflow-x-auto border border-white/10 rounded-lg">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-blue-900/50 border-b border-blue-500/30">
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">ID</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Schedule Date</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Technician*</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Symptom (Cx)</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Diagnosis</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Repair Type</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Status*</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-4 py-3 text-slate-300">V1</td>
                      <td className="px-4 py-3 text-slate-300">05/28/2026</td>
                      <td className="px-4 py-3 text-slate-300">Danny Thornton</td>
                      <td className="px-4 py-3 text-slate-300">THE START BUTTON IS NOT WORKING</td>
                      <td className="px-4 py-3 text-slate-300">Faulty control board</td>
                      <td className="px-4 py-3 text-slate-300">Board Replacement</td>
                      <td className="px-4 py-3 text-blue-300 font-semibold">Completed</td>
                      <td className="px-4 py-3">
                        <button className="text-blue-400 hover:text-blue-300 text-sm">View</button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Part Transaction */}
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <h4 className="font-semibold text-slate-300">Part Transaction</h4>
                <div className="text-xs font-semibold text-blue-300">{partCountLabel}</div>
              </div>

              <div className="overflow-x-auto border border-white/10 rounded-lg">
                <table className="w-full text-xs" style={{ minWidth: "1700px" }}>
                  {/* Two-row header */}
                  <thead>
                    <tr className="bg-slate-800 border-b border-white/10 text-slate-300">
                      <th className="px-2 py-2 text-left font-semibold w-10" rowSpan={2}>ID</th>
                      <th className="px-2 py-2 text-left font-semibold">Part No*</th>
                      <th className="px-2 py-2 text-left font-semibold">Part Dist.*</th>
                      <th className="px-2 py-2 text-left font-semibold">Part Description</th>
                      <th className="px-2 py-2 text-left font-semibold">PO No</th>
                      <th className="px-2 py-2 text-left font-semibold">P/O Date</th>
                      <th className="px-2 py-2 text-left font-semibold">Invoice No</th>
                      <th className="px-2 py-2 text-left font-semibold">Invoice Date</th>
                      <th className="px-2 py-2 text-left font-semibold">Qty*</th>
                      <th className="px-2 py-2 text-left font-semibold">Part Price</th>
                      <th className="px-2 py-2 text-left font-semibold">Core Value</th>
                      <th className="px-2 py-2 text-left font-semibold">Ship Cost</th>
                      <th className="px-2 py-2 text-left font-semibold">Markup</th>
                      <th className="px-2 py-2 text-left font-semibold">Claim To</th>
                    </tr>
                    <tr className="bg-slate-800/70 border-b border-white/10 text-slate-400">
                      <th className="px-2 py-2 text-left font-semibold">Part Status*</th>
                      <th className="px-2 py-2 text-left font-semibold">Note</th>
                      <th className="px-2 py-2 text-left font-semibold">Visit ID*</th>
                      <th className="px-2 py-2 text-left font-semibold">Order #</th>
                      <th className="px-2 py-2 text-left font-semibold">ETA</th>
                      <th className="px-2 py-2 text-left font-semibold">In Tracking #</th>
                      <th className="px-2 py-2 text-left font-semibold">RA Date</th>
                      <th className="px-2 py-2 text-left font-semibold">RA #</th>
                      <th className="px-2 py-2 text-left font-semibold">Out Tracking #</th>
                      <th className="px-2 py-2 text-left font-semibold">Credit #</th>
                      <th className="px-2 py-2 text-left font-semibold">Total (Markup)</th>
                      <th className="px-2 py-2 text-left font-semibold">Hold</th>
                      <th className="px-2 py-2 text-left font-semibold">Cx Paid</th>
                      <th className="px-2 py-2 text-left font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {/* ── Add / Edit inline row ── */}
                    <tr className="bg-slate-900/60 align-top">
                      <td className="px-2 py-1.5 text-slate-500 w-10" rowSpan={2}></td>
                      <td className="px-1 py-1.5">
                        <input value={partDraft.partNo} onChange={(e) => setPartDraft((d) => ({ ...d, partNo: e.target.value }))} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="Part No*" />
                      </td>
                      <td className="px-1 py-1.5">
                        <select value={partDraft.partDist} onChange={(e) => setPartDraft((d) => ({ ...d, partDist: e.target.value }))} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500">
                          <option value="">Dist.*</option>
                          <option>Encompass</option>
                          <option>RepairClinic</option>
                          <option>PartSelect</option>
                          <option>Marcone</option>
                          <option>Johnstone</option>
                          <option>Other</option>
                        </select>
                      </td>
                      <td className="px-1 py-1.5">
                        <input value={partDraft.partDesc} onChange={(e) => setPartDraft((d) => ({ ...d, partDesc: e.target.value }))} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="Description" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input value={partDraft.poNo} onChange={(e) => setPartDraft((d) => ({ ...d, poNo: e.target.value }))} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="PO No" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input type="date" value={partDraft.poDate} onChange={(e) => setPartDraft((d) => ({ ...d, poDate: e.target.value }))} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input value={partDraft.invoiceNo} onChange={(e) => setPartDraft((d) => ({ ...d, invoiceNo: e.target.value }))} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="Invoice No" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input type="date" value={partDraft.invoiceDate} onChange={(e) => setPartDraft((d) => ({ ...d, invoiceDate: e.target.value }))} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input value={partDraft.quantity} onChange={(e) => setPartDraft((d) => ({ ...d, quantity: e.target.value }))} className="w-20 rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="Qty*" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input value={partDraft.partPrice} onChange={(e) => setPartDraft((d) => ({ ...d, partPrice: e.target.value }))} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="$0.00" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input value={partDraft.coreValue} onChange={(e) => setPartDraft((d) => ({ ...d, coreValue: e.target.value }))} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="$0.00" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input value={partDraft.shipCost} onChange={(e) => setPartDraft((d) => ({ ...d, shipCost: e.target.value }))} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="$0.00" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input value={partDraft.markup} onChange={(e) => setPartDraft((d) => ({ ...d, markup: e.target.value }))} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="0%" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input value={partDraft.claimTo} onChange={(e) => setPartDraft((d) => ({ ...d, claimTo: e.target.value }))} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="Claim To" />
                      </td>
                    </tr>
                    <tr className="bg-slate-900/40 align-top border-b border-white/10">
                      <td className="px-1 py-1.5">
                        <select value={partDraft.status} onChange={(e) => setPartDraft((d) => ({ ...d, status: e.target.value }))} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500">
                          <option value="">Status*</option>
                          <option>Back Order</option>
                          <option>Cancelled</option>
                          <option>Claimed</option>
                          <option>CX Home</option>
                          <option>Cx Received</option>
                          <option>Defective</option>
                          <option>Hold for Estimation</option>
                          <option>Hold for next vist</option>
                          <option>Lost</option>
                          <option>Need PO</option>
                          <option>Not Used &amp; Stocked</option>
                          <option>PAID</option>
                          <option>Part Ready</option>
                          <option>PO Made</option>
                          <option>RA - Defect</option>
                          <option>RA- DMG</option>
                          <option>RA - PNN</option>
                          <option>RA - Qty Discrepancy</option>
                          <option>SQT Received</option>
                          <option>Tech Pickup</option>
                          <option>Used</option>
                        </select>
                      </td>
                      <td className="px-1 py-1.5">
                        <input value={partDraft.note} onChange={(e) => setPartDraft((d) => ({ ...d, note: e.target.value }))} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="Note" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input value={partDraft.visitId} onChange={(e) => setPartDraft((d) => ({ ...d, visitId: e.target.value }))} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="Visit ID*" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input value={partDraft.orderNo} onChange={(e) => setPartDraft((d) => ({ ...d, orderNo: e.target.value }))} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="Order #" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input type="date" value={partDraft.eta} onChange={(e) => setPartDraft((d) => ({ ...d, eta: e.target.value }))} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input value={partDraft.inTracking} onChange={(e) => setPartDraft((d) => ({ ...d, inTracking: e.target.value }))} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="In Track #" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input type="date" value={partDraft.raDate} onChange={(e) => setPartDraft((d) => ({ ...d, raDate: e.target.value }))} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input value={partDraft.raNo} onChange={(e) => setPartDraft((d) => ({ ...d, raNo: e.target.value }))} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="RA #" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input value={partDraft.outTracking} onChange={(e) => setPartDraft((d) => ({ ...d, outTracking: e.target.value }))} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="Out Track #" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input value={partDraft.creditNo} onChange={(e) => setPartDraft((d) => ({ ...d, creditNo: e.target.value }))} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="Credit #" />
                      </td>
                      <td className="px-2 py-1.5 text-slate-400 text-xs whitespace-nowrap">
                        {partDraft.totalMarkup ? `$${partDraft.totalMarkup}` : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <input type="checkbox" checked={partDraft.hold === "Hold"} onChange={(e) => setPartDraft((d) => ({ ...d, hold: e.target.checked ? "Hold" : "No" }))} className="accent-blue-500" />
                        <div className="text-slate-500 text-[10px]">Hold</div>
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <input type="checkbox" checked={partDraft.cxPaid === "Paid"} onChange={(e) => setPartDraft((d) => ({ ...d, cxPaid: e.target.checked ? "Paid" : "No" }))} className="accent-blue-500" />
                        <div className="text-slate-500 text-[10px]">Paid</div>
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        <button type="button" onClick={savePartRow} className="rounded border border-blue-400/40 bg-blue-600/30 px-3 py-1 text-xs font-semibold text-blue-200 hover:bg-blue-600/50 transition">
                          {editingPartId ? "Update" : "Add"}
                        </button>
                        {editingPartId ? (
                          <button type="button" onClick={clearPartForm} className="ml-1 rounded border border-white/15 bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition">
                            Cancel
                          </button>
                        ) : null}
                      </td>
                    </tr>

                    {/* ── Saved rows (2 sub-rows each) ── */}
                    {partRows.length === 0 ? (
                      <tr>
                        <td colSpan={15} className="px-4 py-6 text-center text-slate-500">No parts recorded yet</td>
                      </tr>
                    ) : (
                      partRows.map((row, index) => (
                        <React.Fragment key={row.id}>
                          <tr className="bg-slate-900/30 align-top">
                            <td className="px-2 py-1.5 text-slate-400 font-semibold w-10" rowSpan={2}>P{index + 1}</td>
                            <td className="px-2 py-1.5 text-blue-300 font-semibold">{row.partNo}</td>
                            <td className="px-2 py-1.5 text-slate-300">{row.partDist || "—"}</td>
                            <td className="px-2 py-1.5 text-slate-300">{row.partDesc || "—"}</td>
                            <td className="px-2 py-1.5 text-slate-300">{row.poNo || "—"}</td>
                            <td className="px-2 py-1.5 text-slate-300">{row.poDate || "—"}</td>
                            <td className="px-2 py-1.5 text-slate-300">{row.invoiceNo || "—"}</td>
                            <td className="px-2 py-1.5 text-slate-300">{row.invoiceDate || "—"}</td>
                            <td className="px-2 py-1.5 text-slate-300">{row.quantity || "—"}</td>
                            <td className="px-2 py-1.5 text-slate-300">{row.partPrice ? `$${row.partPrice}` : "—"}</td>
                            <td className="px-2 py-1.5 text-slate-300">{row.coreValue ? `$${row.coreValue}` : "—"}</td>
                            <td className="px-2 py-1.5 text-slate-300">{row.shipCost ? `$${row.shipCost}` : "—"}</td>
                            <td className="px-2 py-1.5 text-slate-300">{row.markup ? `${row.markup}%` : "—"}</td>
                            <td className="px-2 py-1.5 text-slate-300">{row.claimTo || "—"}</td>
                          </tr>
                          <tr className="bg-slate-900/20 align-top border-b border-white/5">
                            <td className="px-2 py-1.5 text-blue-300 font-semibold">{row.status || "—"}</td>
                            <td className="px-2 py-1.5 text-slate-400 italic">{row.note || ""}</td>
                            <td className="px-2 py-1.5 text-slate-300">{row.visitId || "—"}</td>
                            <td className="px-2 py-1.5 text-slate-300">{row.orderNo || "—"}</td>
                            <td className="px-2 py-1.5 text-slate-300">{row.eta || "—"}</td>
                            <td className="px-2 py-1.5 text-slate-300">{row.inTracking || "—"}</td>
                            <td className="px-2 py-1.5 text-slate-300">{row.raDate || "—"}</td>
                            <td className="px-2 py-1.5 text-slate-300">{row.raNo || "—"}</td>
                            <td className="px-2 py-1.5 text-slate-300">{row.outTracking || "—"}</td>
                            <td className="px-2 py-1.5 text-slate-300">{row.creditNo || "—"}</td>
                            <td className="px-2 py-1.5 text-slate-300">{row.totalMarkup ? `Markup: $${row.totalMarkup}` : "—"}</td>
                            <td className="px-2 py-1.5 text-center text-slate-400">{row.hold === "Hold" ? <span className="rounded bg-amber-500/20 px-1 text-amber-300">Hold</span> : "—"}</td>
                            <td className="px-2 py-1.5 text-center text-slate-400">{row.cxPaid === "Paid" ? <span className="rounded bg-green-500/20 px-1 text-green-300">Paid</span> : "—"}</td>
                            <td className="px-2 py-1.5 whitespace-nowrap">
                              <button type="button" onClick={() => loadPartForEdit(row)} className="rounded border border-white/15 bg-slate-800 px-2 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition mr-1">
                                Edit
                              </button>
                              <button type="button" onClick={() => deletePartRow(row.id)} className="rounded border border-rose-400/30 bg-rose-500/10 px-2 py-1 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 transition">
                                Delete
                              </button>
                            </td>
                          </tr>
                        </React.Fragment>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-6 rounded-lg border border-white/10 bg-slate-900/50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Part Change Log</div>
                    <div className="text-sm text-slate-300">Every tracked edit on this part transaction list</div>
                  </div>
                  <div className="text-xs font-semibold text-blue-300">{partAuditEntries.length} change{partAuditEntries.length === 1 ? "" : "s"} logged</div>
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-blue-900/50 border-b border-blue-500/30">
                        <th className="px-4 py-3 text-left font-semibold text-blue-300">Time</th>
                        <th className="px-4 py-3 text-left font-semibold text-blue-300">Changed By</th>
                        <th className="px-4 py-3 text-left font-semibold text-blue-300">Action</th>
                        <th className="px-4 py-3 text-left font-semibold text-blue-300">Field</th>
                        <th className="px-4 py-3 text-left font-semibold text-blue-300">Before</th>
                        <th className="px-4 py-3 text-left font-semibold text-blue-300">After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {partAuditEntries.length === 0 ? (
                        <tr className="border-b border-white/5">
                          <td colSpan={6} className="px-4 py-8 text-center text-slate-400">No part changes tracked yet.</td>
                        </tr>
                      ) : (
                        partAuditEntries.map((entry) => (
                          <tr key={entry.id} className="border-b border-white/5 hover:bg-white/5 align-top">
                            <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{new Date(entry.timestamp).toLocaleString()}</td>
                            <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{entry.by}</td>
                            <td className="px-4 py-3 text-slate-300">{entry.action}</td>
                            <td className="px-4 py-3 text-slate-300">{entry.field}</td>
                            <td className="px-4 py-3 text-slate-400">{renderVisitSummary(entry.before)}</td>
                            <td className="px-4 py-3 text-slate-200">{renderVisitSummary(entry.after, entry.before)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Comments */}
            <div>
              <h4 className="font-semibold text-slate-300 mb-4">Comments</h4>
              <div className="space-y-3 mb-4">
                <div className="bg-slate-900/50 border border-white/10 rounded p-4 text-sm">
                  <div className="text-slate-400 mb-2">No comments yet</div>
                </div>
              </div>
              <div className="flex gap-2">
                <textarea
                  placeholder="Add a comment..."
                  className="flex-1 bg-slate-900 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  rows={3}
                />
                <button className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded text-sm transition">
                  Add
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === "compensation" && (
          <div className="space-y-6">
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <label className="block text-slate-500 font-semibold mb-2">Default Date:</label>
                  <div className="text-white bg-slate-950/70 border border-white/10 rounded px-3 py-2">05/29/2026</div>
                </div>
                <div>
                  <label className="block text-slate-500 font-semibold mb-2">Schedule Date</label>
                  <div className="text-white bg-slate-950/70 border border-white/10 rounded px-3 py-2">Today</div>
                </div>
                <div className="flex items-end">
                  <button
                    onClick={addCompensationRow}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded text-sm transition"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto border border-white/10 rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-blue-900/50 border-b border-blue-500/30">
                    <th className="px-4 py-3 text-left font-semibold text-blue-300">Compensation Item</th>
                    <th className="px-4 py-3 text-left font-semibold text-blue-300">Beneficiary</th>
                    <th className="px-4 py-3 text-left font-semibold text-blue-300">Amount</th>
                    <th className="px-4 py-3 text-left font-semibold text-blue-300">Rate</th>
                    <th className="px-4 py-3 text-left font-semibold text-blue-300">Activity Date</th>
                    <th className="px-4 py-3 text-left font-semibold text-blue-300">Requires Approved Claim / Requires Cx Payment</th>
                    <th className="px-4 py-3 text-left font-semibold text-blue-300">Comment</th>
                    <th className="px-4 py-3 text-left font-semibold text-blue-300">Created by</th>
                    <th className="px-4 py-3 text-left font-semibold text-blue-300">Last Modified by</th>
                    <th className="px-4 py-3 text-left font-semibold text-blue-300">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {compensationRows.map((row) => (
                    <tr key={row.id} className="border-b border-white/5 align-top hover:bg-white/5">
                      <td className="px-4 py-3">
                        <input
                          value={row.item}
                          onChange={(e) => updateCompensationRow(row.id, "item", e.target.value)}
                          className="w-full bg-slate-900 border border-white/10 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                          placeholder="Compensation item"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={row.beneficiary}
                          onChange={(e) => updateCompensationRow(row.id, "beneficiary", e.target.value)}
                          title="Select technician"
                          className="w-full bg-slate-900 border border-white/10 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                        >
                          <option value="">Select technician</option>
                          {ALL_TECHNICIANS.map((technician) => (
                            <option key={technician} value={technician}>
                              {technician}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <input
                          value={row.amount}
                          onChange={(e) => updateCompensationRow(row.id, "amount", e.target.value)}
                          className="w-full bg-slate-900 border border-white/10 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                          placeholder="Amount"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          value={row.rate}
                          onChange={(e) => updateCompensationRow(row.id, "rate", e.target.value)}
                          className="w-full bg-slate-900 border border-white/10 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                          placeholder="Rate"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          value={row.activityDate}
                          onChange={(e) => updateCompensationRow(row.id, "activityDate", e.target.value)}
                          className="w-full bg-slate-900 border border-white/10 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                          placeholder="Activity date"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          value={row.requiresClaimOrCxPayment}
                          onChange={(e) => updateCompensationRow(row.id, "requiresClaimOrCxPayment", e.target.value)}
                          className="w-full bg-slate-900 border border-white/10 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                          placeholder="Yes / No"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          value={row.comment}
                          onChange={(e) => updateCompensationRow(row.id, "comment", e.target.value)}
                          className="w-full bg-slate-900 border border-white/10 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                          placeholder="Comment"
                        />
                      </td>
                      <td className="px-4 py-3 text-slate-300">{row.createdBy}</td>
                      <td className="px-4 py-3 text-slate-300">{row.lastModifiedBy}</td>
                      <td className="px-4 py-3 text-slate-300">
                        <button className="text-blue-400 hover:text-blue-300 font-semibold">Edit</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "billing" && (
          <div className="space-y-6">
            <div className="rounded-xl border border-white/15 bg-white/8 p-5 text-white backdrop-blur-md">
              <div className="text-lg font-semibold text-blue-200">Billing Information</div>
              <div className="mt-3 rounded-md border border-white/10 bg-slate-900/90 px-3 py-2 text-sm font-semibold text-white">Paid in full</div>
              <div className="mt-2 text-sm font-semibold text-blue-200/90">0 distinct record found</div>
              <div className="mt-4 max-w-sm">
                <label htmlFor="billing-search" className="block text-xs font-semibold uppercase tracking-[0.04em] text-slate-400">search in result</label>
                <input
                  id="billing-search"
                  type="text"
                  readOnly
                  value=""
                  className="mt-2 w-full rounded-md border border-white/15 bg-slate-900/90 px-3 py-2 text-sm text-white focus:outline-none"
                />
              </div>
              <div className="mt-4 overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full min-w-[1400px] text-left text-sm">
                  <thead>
                    <tr className="bg-blue-900/50 text-blue-200">
                      <th className="px-4 py-3">ID</th>
                      <th className="px-4 py-3">Visit ID*</th>
                      <th className="px-4 py-3">Cx Email</th>
                      <th className="px-4 py-3">Cx Name*</th>
                      <th className="px-4 py-3">Labor Fee*</th>
                      <th className="px-4 py-3">Part Fee*</th>
                      <th className="px-4 py-3">Diag(Trip) Fee*</th>
                      <th className="px-4 py-3">Others Fee*</th>
                      <th className="px-4 py-3">Tax Rate*</th>
                      <th className="px-4 py-3">Tax</th>
                      <th className="px-4 py-3">Deduction</th>
                      <th className="px-4 py-3">Total</th>
                      <th className="px-4 py-3">Payment*</th>
                      <th className="px-4 py-3">C. Card #</th>
                      <th className="px-4 py-3">App. Code</th>
                      <th className="px-4 py-3">Sign</th>
                      <th className="px-4 py-3">Comment</th>
                      <th className="px-4 py-3">Tx Date</th>
                      <th className="px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    <tr className="bg-slate-900/70 text-slate-200">
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3">V1</td>
                      <td className="px-4 py-3">jonshaw@lakesidechurch.ws</td>
                      <td className="px-4 py-3">Jon Shaw</td>
                      <td className="px-4 py-3">Tax</td>
                      <td className="px-4 py-3">Tax</td>
                      <td className="px-4 py-3">Tax</td>
                      <td className="px-4 py-3">Tax</td>
                      <td className="px-4 py-3">%</td>
                      <td className="px-4 py-3">$0.00</td>
                      <td className="px-4 py-3">0.00</td>
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3">05/14/2026</td>
                      <td className="px-4 py-3 text-blue-300 font-semibold">Add</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-xl border border-white/15 bg-white/8 p-5 text-white backdrop-blur-md">
              <div className="text-lg font-semibold text-blue-200">Estimations</div>
              <div className="mt-4 overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full min-w-[1100px] text-left text-sm">
                  <thead>
                    <tr className="bg-blue-900/50 text-blue-200">
                      <th className="px-4 py-3">ID</th>
                      <th className="px-4 py-3">Estimated</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Labor Fee</th>
                      <th className="px-4 py-3">Part Fee</th>
                      <th className="px-4 py-3">Diagnose Fee</th>
                      <th className="px-4 py-3">Others Fee</th>
                      <th className="px-4 py-3">Tax Rate (%)</th>
                      <th className="px-4 py-3">Tax Fee</th>
                      <th className="px-4 py-3">Deduction</th>
                      <th className="px-4 py-3">Refund</th>
                      <th className="px-4 py-3">Total</th>
                      <th className="px-4 py-3">Confirmed</th>
                      <th className="px-4 py-3">Created by</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    <tr className="bg-slate-900/70 text-slate-200">
                      <td className="px-4 py-3" colSpan={14}></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="rounded-md border border-white/15 bg-slate-900/90 px-4 py-2 text-sm font-semibold text-white transition hover:border-slate-200/40">
                  Close
                </button>
                <button className="rounded-md border border-white/15 bg-slate-900/90 px-4 py-2 text-sm font-semibold text-white transition hover:border-slate-200/40">
                  List
                </button>
              </div>
            </div>
          </div>
        )}
        </div>
      </main>

      <Footer />
    </>
  );
}
