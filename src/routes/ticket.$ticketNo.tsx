import { createFileRoute, useNavigate } from "@tanstack/react-router";
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ALL_TECHNICIANS } from "@/lib/locations";
import { savePartOrder, createPartOrderFromTicket, placeMarconeOrder, isMarconeDist, type MarconeOrderPayload, type ShipToAddress } from "@/lib/supabase/partOrders";
import { getPartAddresses, getLocations } from "@/lib/supabase/locationManagement";
import { Copy, Map as MapIcon, CalendarDays, Send, ExternalLink, Pencil } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { isFirebaseReady } from "@/lib/firebase/config";
import { useIsPhone } from "@/lib/device";
import { TicketPhotos } from "@/components/TicketPhotos";
import { MarconePartsOrderModal, type AddressBookEntry, type MarconePartLine } from "@/components/MarconePartsOrderModal";
import { TruckStockBatchModal, type TruckStockBatchSelection } from "@/components/TruckStockBatchModal";
import { TicketSidebar } from "@/components/TicketSidebar";
import { TIME_FRAMES } from "@/lib/timeframes";
import { CLAIM_STATUSES, CLAIM_TOS, PAYMENT_METHODS } from "@/lib/claimDropdowns";
import { LOCATIONS_DATA } from "@/lib/zipCoverage";
import { resolveTierCode } from "@/lib/tierCodes";
import { getLocationManagementCoordinates } from "@/components/LocationManagementPage";
import {
  buildSquaretradeUrlFromToken,
  extractSquaretradeUrl,
  getSquaretradeUrl,
  resolveSquaretradeUrl,
  setSquaretradeUrl,
} from "@/lib/squaretradeUrl";
import { 
  loadTickets, 
  updateTicket, 
  getTicketByNumber, 
  updateTicketVisits, 
  updateTicketParts, 
  type Ticket 
} from "@/lib/ticketData";
import {
  getTicketByNumber as sbGetTicketByNumber,
  getCompanyTickets as sbGetCompanyTickets,
  getTicketVisits as sbGetTicketVisits,
  addTicketVisit as sbAddTicketVisit,
  updateTicketVisit as sbUpdateTicketVisit,
  updateTicketStatus as sbUpdateTicketStatus,
  updateTicketAssignment as sbUpdateTicketAssignment,
  updateTicketCustomer as sbUpdateTicketCustomer,
  updateTicketFields as sbUpdateTicketFields,
  getTicketParts as sbGetTicketParts,
  addTicketPart as sbAddTicketPart,
  updateTicketPart as sbUpdateTicketPart,
  deleteTicketPart as sbDeleteTicketPart,
} from "@/lib/supabase/tickets";
import { getTicketComments, addTicketComment } from "@/lib/supabase/comments";
import { getModelResources, saveModelResources } from "@/lib/supabase/modelResources";
// Product category options for the ticket Product Information dropdown.
const PRODUCT_CATEGORY_OPTIONS = [
  "Air Conditioner", "Bed", "Coffee Machines", "Compactor", "Cooktop", "Dehumidifier",
  "Dishwasher", "Disposer", "Drawer", "Dresser", "Dryer", "Duct", "Electric Cooktop",
  "Electric Oven range", "Electrical System", "Evaporator", "Fan", "Food Center", "Furnace",
  "Heater", "Home Theather", "Hood", "Ice Maker", "Laundry", "LCD TV", "LED TV", "Matress",
  "Microwave", "Mobile", "Monitor", "OLED TV", "Oven", "PDP TV", "Plasma TV", "Projection TV",
  "Range", "Refrigerator", "Trash Compactor", "TV", "Vacuum Cleaner", "Vent", "Washer",
  "Washer Dryer", "Window", "Wine Cellar",
];

// Warranty type options.
const WARRANTY_TYPE_OPTIONS = [
  "Concession L", "Concession LP", "Concession P", "Ext Labor Wty", "Ext Part Wty", "Ext Wty",
  "In warranty", "Labor only Wty", "Out-of-warranty", "Part only Wty", "Special Part 5 year",
  "Unknown", "SERVICE CONTRACT",
];

// Claim company options.
const CLAIM_COMPANY_OPTIONS = [
  "AIG WARRANTY", "ASSURANT SOLUTIONS", "assurion", "Centricity", "Fidelity Home Insurance",
  "Frigidaire", "GE CUSTOMER CARE", "Hisense", "LG", "Midea", "MIELE", "NEW", "Nsa",
  "ONPOINT WARRANTY", "SAFEWARE", "SERVICE POWER", "Speed Queen", "SQUARE TRADE", "SS",
  "SS 4930403", "SS 6488757",
];

// Map a ServicePower "Warranty Info" value to our AHS Warranty Type dropdown.
//  - Sales fulfillment  -> In warranty
//  - Concessions        -> Concession LP
//  - Service Contract   -> In warranty
//  - Out of warranty    -> Out-of-warranty
//  - In warranty        -> In warranty
function mapServicePowerWarranty(spWarranty: string | undefined | null): string {
  const v = (spWarranty || "").trim().toLowerCase();
  if (!v) return "";
  if (v.includes("sales fulfillment")) return "In warranty";
  if (v.includes("concession")) return "Concession LP";
  if (v.includes("service contract")) return "In warranty";
  if (v.includes("out of warranty") || v.includes("out-of-warranty")) return "Out-of-warranty";
  if (v.includes("in warranty")) return "In warranty";
  return spWarranty || "";
}

// Short acronym for the header ribbon based on the warranty type.
function warrantyAcronym(warrantyType: string | undefined | null): string {
  const v = (warrantyType || "").trim().toLowerCase();
  if (!v) return "—";
  if (v === "in warranty") return "IW";
  if (v.includes("out-of-warranty") || v.includes("out of warranty")) return "OOW";
  if (v === "concession l") return "CL";
  if (v === "concession lp") return "CLP";
  if (v === "concession p") return "CP";
  if (v.includes("ext labor")) return "ELW";
  if (v.includes("ext part")) return "EPW";
  if (v.includes("ext wty")) return "EW";
  if (v.includes("labor only")) return "LOW";
  if (v.includes("part only")) return "POW";
  if (v.includes("special part")) return "SP5";
  if (v.includes("service contract")) return "SC";
  if (v === "unknown") return "UNK";
  return (warrantyType || "").toUpperCase();
}

// Format a ServicePower date string to YYYY-MM-DD for display in call info.
function formatSpDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  try {
    const clean = String(dateStr).replace(/[-+]\d{2}:\d{2}$/, "");
    const d = new Date(clean);
    if (isNaN(d.getTime())) return String(dateStr);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mm}-${dd}`;
  } catch {
    return String(dateStr);
  }
}

// Format a ServicePower running-note date as "MM/DD/YYYY HH:MM:SS" so it
// matches the layout the Customer Notes section uses for the legacy dummy
// rows. ServicePower returns ISO 8601 strings (e.g. "2026-06-29T05:39:26Z");
// if parsing fails we return the raw value rather than dropping the note.
function formatSpNoteDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  try {
    const clean = String(dateStr).replace(/[-+]\d{2}:\d{2}$/, "");
    const d = new Date(clean);
    if (isNaN(d.getTime())) return String(dateStr);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${mm}/${dd}/${yyyy} ${hh}:${mi}:${ss}`;
  } catch {
    return String(dateStr);
  }
}


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
  address2: string;
  city: string;
  state: string;
  zip: string;
  homePhone: string;
  cellPhone: string;
  altPhone?: string;
  email: string;
  brand: string;
  model: string;
  serialNo: string;
  modelVersion: string;
  redoTicketNo: string;
  productCategory: string;
  purchaseDate: string;
  warrantyType: string;
  claimCompany: string;
  serviceContract: string;
  accountNo: string;
  manufactureId: string;
  callNo: string;
  ticketSource: string;
  callType: string;
  serviceType: string;
  callStatus: string;
  postingDate: string;
  repeatCall: string;
  contractNo: string;
  copay: string;
  poNumber: string;
  poAmount: string;
  emergency: string;
  authNo: string;
  observationNotes: string;
  problemDescription: string;
  scheduleDate: string;
  schedulePeriod: string;
  technician: string;
  customerNotes: Array<{ date: string; notes: string; by: string }>;
  servicerNotes: Array<{ notes: string; by: string }>;
  // NSA-specific fields (only populated when ticketSource === "NSA")
  nsaStatus?: string;
  nsaRouteName?: string;
  nsaGroupName?: string;
  nsaDeductible?: string;
  nsaScheduleAck?: string;
  nsaSpecialInstructions?: string;
  nsaValidCoverage?: string;
  nsaRequiredCoverage?: string;
  nsaRequiredPart?: string;
  nsaPreAuth?: string;
  nsaCaseNumber?: string;
  nsaMasterCode?: string;
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
  updatedBy?: string;
  updateReason?: string;
  by: string;
  scheduleDate: string;
  technician: string;
  timeSlot: string;
  activity: string;
  actionType: string;
  repairStatus: string;
  repairType: string;
  schedNotes: string;
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
const TICKET_ALERT_KEY_PREFIX = "ahs:ticket-alert:";

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

function getAlertKey(ticketNo: string) {
  return `${TICKET_ALERT_KEY_PREFIX}${ticketNo}`;
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
    status: "Need PO",
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

function loadAlertMessages(ticketNo: string) {
  if (typeof window === "undefined") return [] as Array<{id: string, text: string, by: string, timestamp: string}>;

  const raw = window.localStorage.getItem(getAlertKey(ticketNo));
  if (!raw) return [] as Array<{id: string, text: string, by: string, timestamp: string}>;

  try {
    const parsed = JSON.parse(raw) as Array<{id: string, text: string, by: string, timestamp: string}>;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [] as Array<{id: string, text: string, by: string, timestamp: string}>;
  }
}

function saveAlertMessages(ticketNo: string, messages: Array<{id: string, text: string, by: string, timestamp: string}>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getAlertKey(ticketNo), JSON.stringify(messages));
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
  const maxStored = entries.reduce((max, entry) => {
    const numeric = Number.parseInt((entry.visitNo ?? "").replace(/\D/g, ""), 10);
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, 0);

  // Use whichever is larger: the highest stored number, or the total count.
  // This guarantees a unique, sequential label even when stored visit_no
  // values are missing or duplicated in the database.
  const nextIndex = Math.max(maxStored, entries.length) + 1;

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
    ["Repair Type (2nd Tech)", entry.repairType],
    ["Sched Notes (CSR)", entry.schedNotes],
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

  return (
    <div className="space-y-1">
      {summaryParts.map((part, index) => {
        const isChanged = comparedSummary ? comparedParts[index] !== part : false;

        return (
          <div
            key={`${part}-${index}`}
            className={isChanged
              ? "rounded-md bg-amber-500/10 px-2 py-1 font-semibold text-amber-200 border border-amber-500/20"
              : "px-2 py-1 text-slate-200"}
            style={{ minHeight: '1.75rem', display: 'flex', alignItems: 'center' }}
          >
            {part}
          </div>
        );
      })}
    </div>
  );
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

// Compute Turnaround Time (TAT): days elapsed since the ticket was created.
// Accepts common date formats (ISO, MM/DD/YY, MM/DD/YYYY). Returns e.g. "3d".
function computeTAT(created: string | undefined): string {
  if (!created) return "0d";
  let createdDate: Date | null = null;
  const raw = String(created).trim();
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const mm = parseInt(slash[1], 10) - 1;
    const dd = parseInt(slash[2], 10);
    let yy = parseInt(slash[3], 10);
    if (yy < 100) yy += 2000;
    createdDate = new Date(yy, mm, dd);
  } else {
    const parsed = new Date(raw);
    if (!isNaN(parsed.getTime())) createdDate = parsed;
  }
  if (!createdDate || isNaN(createdDate.getTime())) return "0d";
  const ms = Date.now() - createdDate.getTime();
  const days = Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
  return `${days}d`;
}

// Haversine straight-line distance in miles between two lat/lng points.
function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Resolve the office coordinates for a location: prefer Location Management
// coordinates, fall back to the static LOCATIONS_DATA lat/lng.
function getOfficeCoordinates(location: string): { lat: number; lng: number } | null {
  const fromMgmt = getLocationManagementCoordinates(location);
  if (fromMgmt) return fromMgmt;
  const normalized = String(location || "").trim().toLowerCase();
  const match = LOCATIONS_DATA.find((l) => l.location.trim().toLowerCase() === normalized);
  if (match && match.lat && match.lng) {
    const lat = parseFloat(match.lat);
    const lng = parseFloat(match.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  return null;
}

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
  address2: "",
  city: "DEWEYVILLE",
  state: "Texas",
  zip: "77614",
  homePhone: "409-221-5089",
  cellPhone: "409-221-5089",
  email: "robert0278@yahoo.com",
  brand: "GENERAL ELECTRIC",
  model: "GTX33EASKWW",
  serialNo: "",
  modelVersion: "",
  redoTicketNo: "",
  productCategory: "Dryer",
  purchaseDate: "04/11/2025",
  warrantyType: "In warranty",
  claimCompany: "SQUARE TRADE",
  serviceContract: "SQUARE TRADE",
  accountNo: "GSL00002",
  manufactureId: "",
  callNo: "017151274136",
  ticketSource: "",
  callType: "In warranty",
  serviceType: "",
  callStatus: "ACCEPTED / ACCEPTED",
  postingDate: "2026-05-29",
  repeatCall: "",
  contractNo: "",
  copay: "",
  poNumber: "",
  poAmount: "",
  emergency: "",
  authNo: "",
  observationNotes: "",
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

function ModelResourceButton(props: {
  label: string;
  url: string;
  onEdit: () => void;
}) {
  const { label, url, onEdit } = props;
  const hasLink = Boolean(url && url.trim());
  return (
    <div className="inline-flex items-center rounded-lg border border-slate-600/60 bg-slate-800/70 text-xs overflow-hidden">
      {hasLink ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-1 flex items-center gap-1.5 text-blue-300 hover:bg-blue-600/20 transition-colors"
          title={url}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          <span className="font-semibold">{label}</span>
        </a>
      ) : (
        <button
          type="button"
          onClick={onEdit}
          className="px-3 py-1 flex items-center gap-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-700/60 transition-colors"
          title={`Add ${label} link`}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          <span className="font-semibold">{label}</span>
          <span className="text-[10px] uppercase tracking-wide text-slate-500">Add</span>
        </button>
      )}
      {hasLink && (
        <button
          type="button"
          onClick={onEdit}
          className="px-2 py-1 border-l border-slate-600/60 text-slate-400 hover:text-slate-200 hover:bg-slate-700/60 transition-colors"
          title={`Edit ${label} link`}
          aria-label={`Edit ${label} link`}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function buildTicketCopyPayload(ticket: TicketData): TicketCopyPayload {
  const customerName = `${ticket.firstName} ${ticket.lastName}`.trim();
  return {
    ticketNo: ticket.ticketNo,
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
  const { email: currentUserEmail, ready: authReady, displayName: currentUserName, role: currentUserRole, companyId: currentCompanyId, uid } = useAuth();
  // Tech-only required-field gating: technicians (and anyone using the mobile
  // tech app) must fill Cause of Failure + Repair Notes before saving a
  // visit. On desktop / web for other roles these stay optional.
  const isPhone = useIsPhone();
  const isTechRole = useMemo(() => {
    const r = String(currentUserRole || "").toUpperCase();
    return r === "TECHNICIAN";
  }, [currentUserRole]);
  const requireTechVisitFields = isPhone || isTechRole;
  const [activeTab, setActiveTab] = useState<"general" | "tracking" | "compensation" | "billing">("general");
  const [newServicerNote, setNewServicerNote] = useState("");
  const [servicerComments, setServicerComments] = useState<Array<{ id: string; body: string; authorName: string; authorRole: string; createdAt: string }>>([]);
  const [newVisitStatus, setNewVisitStatus] = useState("Visited");
  const [newVisitNote, setNewVisitNote] = useState("");
  const [newVisitScheduleDate, setNewVisitScheduleDate] = useState("");
  const [newVisitTechnician, setNewVisitTechnician] = useState("Memphis Admin");
  const [newVisitTimeSlot, setNewVisitTimeSlot] = useState("");
  const [newVisitActivity, setNewVisitActivity] = useState("");
  const [newVisitActionType, setNewVisitActionType] = useState("SCHEDULE");
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
  const [newVisitSchedNotes, setNewVisitSchedNotes] = useState("");
  const [selectedTicket, setSelectedTicket] = useState(ticketNo);
  
  // Alert message system
  const [alertMessages, setAlertMessages] = useState<Array<{id: string, text: string, by: string, timestamp: string}>>([]);
  const [newAlertMessage, setNewAlertMessage] = useState("");
  const [alertsLoaded, setAlertsLoaded] = useState(false);
  const [editingVisitId, setEditingVisitId] = useState<string | null>(null);
  const [visitFormMode, setVisitFormMode] = useState<"edit" | "view">("edit");
  const [isVisitModalOpen, setIsVisitModalOpen] = useState(false);
  // ServicePower Running Notes modal (next to Add Visit).
  const [isRunningNotesOpen, setIsRunningNotesOpen] = useState(false);
  const [runningNotes, setRunningNotes] = useState<Array<{
    date: string; body: string; addedBy: string; isInternal: boolean;
  }>>([]);
  const [runningNotesLoading, setRunningNotesLoading] = useState(false);
  const [runningNotesError, setRunningNotesError] = useState<string | null>(null);
  const [newRunningNote, setNewRunningNote] = useState("");
  const [newRunningNoteVisibility, setNewRunningNoteVisibility] = useState<"internal" | "external">("internal");
  const [postingRunningNote, setPostingRunningNote] = useState(false);
  const [runningNotePostError, setRunningNotePostError] = useState<string | null>(null);
  const [viewingVisitEntry, setViewingVisitEntry] = useState<VisitLogEntry | null>(null);
  const [isPartModalOpen, setIsPartModalOpen] = useState(false);
  const [viewingPartEntry, setViewingPartEntry] = useState<PartTransactionRow | null>(null);
  const [isPartListModalOpen, setIsPartListModalOpen] = useState(false);
  const currentEditor = currentUserEmail ?? "Current User";
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
  const [auditEntriesLoaded, setAuditEntriesLoaded] = useState(false);
  const [visitLogEntries, setVisitLogEntries] = useState<VisitLogEntry[]>([]);
  const [visitsLoaded, setVisitsLoaded] = useState(false);
  const [partRows, setPartRows] = useState<PartTransactionRow[]>([]);
  const [partRowsLoaded, setPartRowsLoaded] = useState(false);
  // Marcone Parts Order modal state — pre-filtered Marcone parts and the
  // pre-fetched address book. The modal owns its own form state; this only
  // gates open/closed + which parts to seed it with.
  const [marconeModal, setMarconeModal] = useState<{ open: boolean; parts: PartTransactionRow[] }>({ open: false, parts: [] });
  // Truck Stock batch modal — opens from the new Truck Stock button next
  // to Submit POs. Lets the user fulfill Need PO parts from an in-house
  // branch with one confirmation, instead of placing distributor POs.
  const [truckStockModal, setTruckStockModal] = useState<{ open: boolean; parts: PartTransactionRow[] }>({ open: false, parts: [] });
  const [partAddressBook, setPartAddressBook] = useState<AddressBookEntry[]>([]);
  const [defaultShipTo, setDefaultShipTo] = useState<ShipToAddress>({
    name: "", street1: "", street2: "", city: "", state: "", zip: "", phone: "", email: "",
  });
  // Claim Transaction rows — lives in component state for now; persistence
  // can land later. One row per claim submission (Visit Log linkage,
  // claim # + status, fee columns, payment, etc).
  interface ClaimTransactionRow {
    id: string;
    claimTo: string;
    visitLogId: string;
    claimNo: string;
    claimDate: string;
    claimStatus: string;
    laborFee: string;
    partFee: string;
    diagnoseFee: string;
    shippingFee: string;
    extraMileFee: string;
    otherFee: string;
    taxFee: string;
    totalFee: string;
    paymentMethod: string;
    mileage: string;
    ccLast4: string;
    note: string;
  }
  const [claimRows, setClaimRows] = useState<ClaimTransactionRow[]>([]);
  const [claimNote, setClaimNote] = useState("");
  // Inline draft for adding a NEW claim transaction (mirrors partDraft pattern).
  // Filled by the editable two-row block at the top of the Claim table; on
  // Save the draft is appended to claimRows and reset.
  const createEmptyClaimDraft = (): Omit<ClaimTransactionRow, "id"> => ({
    claimTo: "",
    visitLogId: "",
    claimNo: "",
    claimDate: "",
    claimStatus: "",
    laborFee: "",
    partFee: "",
    diagnoseFee: "",
    shippingFee: "",
    extraMileFee: "",
    otherFee: "",
    taxFee: "",
    totalFee: "",
    paymentMethod: "",
    mileage: "",
    ccLast4: "",
    note: "",
  });
  const [claimDraft, setClaimDraft] = useState<Omit<ClaimTransactionRow, "id">>(createEmptyClaimDraft);
  const [editingClaimId, setEditingClaimId] = useState<string | null>(null);
  // All company tickets (for the Related Tickets matcher on the tracking tab).
  const [allCompanyTickets, setAllCompanyTickets] = useState<any[]>([]);

  // Load all company tickets once so we can find related ones.
  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    sbGetCompanyTickets()
      .then((rows) => { if (!cancelled) setAllCompanyTickets(rows as any[]); })
      .catch((err) => { console.error("Failed to load company tickets:", err); });
    return () => { cancelled = true; };
  }, [authReady]);
  const [editingPartId, setEditingPartId] = useState<string | null>(null);
  // Per-row edits that haven't been saved yet. Keyed by part row id. The
  // saved rows are always rendered as input cells (no separate "edit"
  // mode); changes the user types go into rowEdits[row.id] and stay
  // pending until they click the global Update button (next to Submit
  // POs). Empty patches are cleaned up so we never persist a no-op.
  const [rowEdits, setRowEdits] = useState<Record<string, Partial<PartTransactionRow>>>({});
  const [rowEditsSaving, setRowEditsSaving] = useState(false);
  const [partDraft, setPartDraft] = useState<PartTransactionDraft>(createEmptyPartDraft());
  // Marcone /parts/lookup state for the inline Add row's "Lookup" button.
  const [marconeLookupBusy, setMarconeLookupBusy] = useState(false);
  const [marconeLookupMsg, setMarconeLookupMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
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

  // ServicePower status sending
  const [spStatus, setSpStatus] = useState("");
  const [spStatusSending, setSpStatusSending] = useState(false);

  // ServicePower call-info sync (pull Call Service Information by call/ticket number)
  const [spCallSyncing, setSpCallSyncing] = useState(false);
  const [spCallSyncMsg, setSpCallSyncMsg] = useState<string | null>(null);
  const autoSyncedRef = React.useRef<string | null>(null);

  // Distance (miles) from the office location to this ticket's address.
  const [officeDistanceMiles, setOfficeDistanceMiles] = useState<number | null>(null);

  // Edit mode state for customer information
  const [isEditingCustomerInfo, setIsEditingCustomerInfo] = useState(false);
  const [editedCustomerInfo, setEditedCustomerInfo] = useState<Partial<TicketData>>({});
  // Edit mode state for problem description
  const [isEditingProblem, setIsEditingProblem] = useState(false);
  const [editedProblem, setEditedProblem] = useState("");

  // Edit mode state for product information
  const [isEditingProductInfo, setIsEditingProductInfo] = useState(false);
  const [editedProductInfo, setEditedProductInfo] = useState<Partial<TicketData>>({});

  // Per-model reference links (Exploded View / Service Bulletin). Shared
  // across every ticket carrying the same model number. Loaded from Supabase
  // whenever the ticket's model changes.
  const [modelResources, setModelResources] = useState<{
    explodedViewUrl: string;
    serviceBulletinUrl: string;
  }>({ explodedViewUrl: "", serviceBulletinUrl: "" });
  const [modelResourceModal, setModelResourceModal] = useState<
    | null
    | { kind: "exploded" | "bulletin"; value: string }
  >(null);
  const [modelResourceSaving, setModelResourceSaving] = useState(false);

  // Edit mode state for schedule information
  const [isEditingScheduleInfo, setIsEditingScheduleInfo] = useState(false);
  const [editedScheduleInfo, setEditedScheduleInfo] = useState<Partial<TicketData>>({});

  // Inline edit state for the Redo Ticket # input on the Visit Log
  // sidebar. Persists to tickets.original_ticket_no via the same
  // updateTicketFields path used by the Product Info edit form. Stored
  // separately from the Product Info draft so a quick redo-number edit
  // doesn't force the user into the full product-info modal.
  const [editingRedoTicket, setEditingRedoTicket] = useState(false);
  const [redoTicketDraft, setRedoTicketDraft] = useState("");
  const [savingRedoTicket, setSavingRedoTicket] = useState(false);

  useEffect(() => {
    // Load audit entries from localStorage
    setAuditEntries(loadAuditEntries(ticketNo));
    setAuditEntriesLoaded(true);
    
    // Reset loaded flags when ticket changes
    setVisitsLoaded(false);
    setPartRowsLoaded(false);
    setAlertsLoaded(false);
    
    // Load visits from Supabase (falls back to empty if none)
    sbGetTicketVisits(ticketNo)
      .then((visits) => {
        setVisitLogEntries(visits as any);
        setVisitsLoaded(true);
      })
      .catch((err) => {
        console.error("Failed to load visits:", err);
        setVisitLogEntries([]);
        setVisitsLoaded(true);
      });
    
    // Load parts from Supabase
    sbGetTicketParts(ticketNo)
      .then((parts) => {
        setPartRows(parts as any);
        setPartRowsLoaded(true);
      })
      .catch((err) => {
        console.error("Failed to load parts:", err);
        setPartRows([]);
        setPartRowsLoaded(true);
      });

    // Load saved Part Pickup Addresses + branch locations so the Marcone
    // Parts Order modal's Address dropdown is populated without an extra
    // round-trip when the user clicks Submit POs. Best-effort — if either
    // call fails we just open the modal with a minimal address book.
    Promise.all([
      getPartAddresses().catch(() => []),
      getLocations().catch(() => []),
    ]).then(([addrs, locs]) => {
      const book: AddressBookEntry[] = [];
      for (const loc of locs) {
        book.push({
          id: `branch:${loc.id}`,
          label: `${loc.location} — ${[loc.address1, loc.city, loc.state].filter(Boolean).join(", ")}`,
          shipTo: {
            name: loc.location,
            street1: loc.address1 || "",
            street2: loc.address2 || "",
            city: loc.city || "",
            state: loc.state || "",
            zip: loc.zipCode || "",
            phone: loc.phoneNo || "",
            email: loc.email || "",
          },
        });
      }
      for (const a of addrs) {
        book.push({
          id: `part:${a.id}`,
          label: `${a.name} — ${[a.address1, a.city, a.state].filter(Boolean).join(", ")}`,
          shipTo: {
            name: a.name,
            street1: a.address1 || "",
            street2: a.address2 || "",
            city: a.city || "",
            state: a.state || "",
            zip: a.zipCode || "",
            phone: "",
            email: "",
          },
        });
      }
      setPartAddressBook(book);
    });
    
    // Load alert messages from localStorage
    setAlertMessages(loadAlertMessages(ticketNo));
    setAlertsLoaded(true);
    
    setEditingPartId(null);
    setPartDraft(createEmptyPartDraft());
    setIsEditingCustomerInfo(false);
    setEditedCustomerInfo({});
    setIsEditingProductInfo(false);
    setEditedProductInfo({});
  }, [ticketNo, authReady]);

  useEffect(() => {
    // Only save audit entries after they've been loaded
    if (!auditEntriesLoaded) return;
    saveAuditEntries(ticketNo, auditEntries);
  }, [auditEntries, ticketNo, auditEntriesLoaded]);

  useEffect(() => {
    // Visits are persisted directly to Supabase in addVisitLogEntry now.
    // This effect intentionally does nothing (kept to preserve hook order).
    if (!visitsLoaded) return;
  }, [ticketNo, visitLogEntries, visitsLoaded]);

  useEffect(() => {
    // Parts are persisted directly to Supabase in savePartRow/deletePart now.
    // This effect intentionally does nothing (kept to preserve hook order).
    if (!partRowsLoaded) return;
  }, [partRows, partRowsLoaded, ticketNo]);

  useEffect(() => {
    // Save alert messages to localStorage whenever they change
    if (!alertsLoaded) return;
    saveAlertMessages(ticketNo, alertMessages);
  }, [alertMessages, ticketNo, alertsLoaded]);

  useEffect(() => {
    // Listen for ticket data changes from Work Planner or other sources
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "ahs:tickets:data" || e.key === null) {
        // Reload visits and parts from centralized ticket when data changes (cross-tab)
        const ticket = getTicketByNumber(ticketNo);
        if (ticket) {
          // Don't update loaded flags - just update the data
          // The save useEffect will skip because loaded flags are already true
          setVisitLogEntries(ticket?.visits || []);
          setPartRows(ticket?.parts || []);
        }
      }
    };
    
    // Listen for custom event from same-page updates (like Work Planner drag/drop)
    const handleCustomUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<{ ticketNo: string }>;
      if (customEvent.detail.ticketNo === ticketNo) {
        // Reload visits and parts from centralized ticket  
        const ticket = getTicketByNumber(ticketNo);
        if (ticket) {
          // Don't update loaded flags - just update the data
          setVisitLogEntries(ticket?.visits || []);
          setPartRows(ticket?.parts || []);
          
          // Also reload audit entries
          setAuditEntries(loadAuditEntries(ticketNo));
        }
      }
    };
    
    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("ticket-data-updated", handleCustomUpdate);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("ticket-data-updated", handleCustomUpdate);
    };
  }, [ticketNo]);

  const appendAuditEntry = (entry: Omit<AuditLogEntry, "id" | "timestamp">) => {
    setAuditEntries((entries) => [createAuditEntry(entry), ...entries]);
  };

  const handleSendSpStatus = async () => {
    if (!spStatus) {
      alert("Please select a status to send to ServicePower.");
      return;
    }

    setSpStatusSending(true);
    try {
      // Record the status change to the ticket's audit trail.
      appendAuditEntry({
        by: currentEditor,
        action: "Sent SP Status",
        field: "ServicePower Status",
        before: ticket?.callStatus || "—",
        after: spStatus,
      });

      // Reflect the sent status on the ticket's call status locally / in Supabase.
      await sbUpdateTicketStatus(ticketNo, spStatus).catch((e) =>
        console.warn("SP status sync skipped:", e)
      );

      alert(`ServicePower status "${spStatus}" sent.`);
      setSpStatus("");
    } catch (err) {
      console.error("Failed to send SP status:", err);
      alert(`Failed to send SP status: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSpStatusSending(false);
    }
  };

  // Pull Call Service Information from ServicePower using the ticket number as
  // the call number. Maps the returned CallInfo block into the displayed fields.
  const handleSyncCallInfo = async (silent = false) => {
    setSpCallSyncing(true);
    if (!silent) setSpCallSyncMsg(null);
    // eslint-disable-next-line no-console
    console.log("[SP auto-sync] starting for ticket:", ticketNo);
    try {
      const { fetchServicePowerCalls } = await import("@/lib/servicePowerSync");
      const result = await fetchServicePowerCalls({ callNo: ticketNo });
      // eslint-disable-next-line no-console
      console.log("[SP auto-sync] response:", {
        success: result.success,
        callsCount: (result.calls || []).length,
        error: result.error,
        rawXmlSnippet: String(result.rawXml || "").slice(0, 600),
      });
      if (!result.success) {
        const msg = typeof result.error === "string"
          ? result.error
          : result.error?.description || result.error?.message || "Lookup failed";
        if (!silent) setSpCallSyncMsg(`ServicePower lookup failed: ${msg}`);
        return;
      }
      const call = (result.calls || []).find(
        (c: any) => String(c?.callNumber ?? "").trim() === ticketNo.trim()
      ) || (result.calls || [])[0];
      if (!call) {
        if (!silent) setSpCallSyncMsg("No matching call found in ServicePower for this ticket number.");
        return;
      }

      const product = call.product || {};
      const mfgSourceMap: Record<string, string> = {
        I565: "SQUARE TRADE", I455: "ASSURANT SOLUTIONS", B100: "CENTRICITY",
        I404: "GE", I406: "GE", I402: "GE",
      };
      const mfgCode = String(call.mfgId ?? "").trim().toUpperCase();
      const mfgName = String(call.mfgName ?? "").trim();
      // Prefer the friendly source name SP returned; fall back to our code map;
      // last resort is the raw MfgId code.
      const source = (mfgName || mfgSourceMap[mfgCode] || mfgCode || "").toUpperCase();

      // Raw warranty as ServicePower sent it (could be a code like "SC"/"IW"
      // or a full text label like "Service Contract").
      const rawWarrantyValue = String(call.warrantyType ?? "").trim();
      const rawWarrantyUpper = rawWarrantyValue.toUpperCase();
      const wtypeMap: Record<string, string> = {
        SC: "Service Contract", IW: "In warranty", OW: "Out of warranty", OOW: "Out of warranty",
      };
      const rawWarranty = wtypeMap[rawWarrantyUpper] || rawWarrantyValue || "";

      // ServicePower exposes a "Warranty Info" label at the product level too.
      // The parser tries several tag names; fall back to grepping the raw XML.
      const productWarrantyInfo = String((product as any).warrantyInfo ?? "").trim();
      const productXmlBlob = String((product as any).rawXml ?? "");
      const xmlHasServiceContract = /service\s*contract/i.test(productXmlBlob);

      // The badge next to "Warranty Type" mirrors ServicePower's Product
      // Details > Warranty Info verbatim. Detect "Service Contract" from any
      // signal SP exposes:
      const hasServiceContract =
        rawWarrantyUpper === "SC" ||
        /service\s*contract/i.test(rawWarrantyValue) ||
        /service\s*contract/i.test(String(rawWarranty)) ||
        /service\s*contract/i.test(productWarrantyInfo) ||
        Boolean(String(product.serviceContractNumber ?? "").trim()) ||
        Boolean(String(product.serviceContractExpireDate ?? "").trim()) ||
        xmlHasServiceContract;

      const warrantyInfoBadge = hasServiceContract
        ? "SERVICE CONTRACT"
        : (productWarrantyInfo || rawWarranty || "").toUpperCase();

      // Diagnostic: surface the raw SP fields so we can see why the badge
      // resolves the way it does. Safe to keep — only logs in the user's own
      // browser console.
      console.log("[SP auto-sync]", {
        callNumber: call.callNumber,
        mfgId: call.mfgId,
        mfgName: call.mfgName,
        resolvedSource: source,
        warrantyTypeRaw: call.warrantyType,
        warrantyTypeMapped: rawWarranty,
        productWarrantyInfo,
        serviceContractNumber: product.serviceContractNumber,
        serviceContractExpireDate: product.serviceContractExpireDate,
        xmlHasServiceContract,
        hasServiceContract,
        warrantyInfoBadge,
        productXmlSnippet: productXmlBlob.slice(0, 500),
        callXmlSnippet: String(call.callRawXml || "").slice(0, 800),
      });

      // Account No for any ServicePower-sourced ticket is the servicer
      // account we authenticated as (the credential used to call the SOAP
      // API), NOT the manufacturer-supplied source label. Pull it from the
      // configured env var first; fall back to whatever SP echoed back.
      const configuredAcct =
        (import.meta as any).env?.VITE_SERVICEPOWER_SERVICER_ACCOUNT ||
        (import.meta as any).env?.VITE_SERVICEPOWER_USER_ID ||
        "";
      const accountNo = configuredAcct || call.servicerAccount || "";

      // Customer phone refresh: pull straight from the SP consumer block so
      // General Information and Service Tracking always show what SP has on
      // file right now. SP returns "0" / blank for missing numbers — strip
      // those. Phone1 is home, Phone2/CellPhone is the secondary number.
      const cleanSpPhone = (v: any) => {
        const s = String(v ?? "").trim();
        return s === "0" || s === "" ? "" : s;
      };
      const consumer = call.consumer || {};
      const spHomePhone = cleanSpPhone(consumer.phone1);
      const spCellPhone = cleanSpPhone(consumer.phone2) || cleanSpPhone(consumer.cellPhone);

      // If a user previously edited the customer info via "Edit Customer
      // Info" form, lock the entire customer record from auto-sync overwrite.
      // The flag protects name, address, phones, email, etc. — anything they
      // changed stays.
      let customerLocked = false;
      try {
        const { supabase } = await import("@/lib/supabase/client");
        const { data: ticketRow } = await supabase
          .from("tickets")
          .select("customer_id")
          .eq("ticket_no", ticketNo)
          .maybeSingle();
        if (ticketRow?.customer_id) {
          const { data: customerRow } = await supabase
            .from("customers")
            .select("edited_by_user")
            .eq("id", ticketRow.customer_id)
            .maybeSingle();
          customerLocked = Boolean((customerRow as any)?.edited_by_user);
        }
      } catch (e) {
        console.warn("[SP auto-sync] customer lock check skipped:", e);
      }
      const phoneEditedByUser = customerLocked;

      setTicketData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          accountNo: accountNo || prev.accountNo,
          manufactureId: mfgCode || prev.manufactureId,
          callNo: call.callNumber || ticketNo,
          ticketSource: source || prev.ticketSource,
          callType: rawWarranty || prev.callType,
          serviceType: call.serviceType || prev.serviceType,
          callStatus: call.callStatus || prev.callStatus,
          postingDate: formatSpDate(call.callCreatedOn) || prev.postingDate,
          repeatCall: /^y/i.test(String(call.repeatCall || "")) ? "YES" : "NO",
          contractNo: product.serviceContractNumber || prev.contractNo,
          copay: product.copayAmount ?? prev.copay,
          poNumber: product.poNumber || prev.poNumber,
          poAmount: product.poAmount ?? prev.poAmount,
          authNo: call.authNo || prev.authNo,
          observationNotes: call.problemDesc || prev.observationNotes,
          serviceContract: warrantyInfoBadge || prev.serviceContract,
          // Trust SP for phone numbers UNLESS a user already edited them.
          // Their saved value wins; otherwise we sync from the live call so
          // General Info and Service Tracking match what SP currently has.
          homePhone: phoneEditedByUser ? prev.homePhone : (spHomePhone || prev.homePhone),
          cellPhone: phoneEditedByUser ? prev.cellPhone : (spCellPhone || prev.cellPhone),
        };
      });

      // Persist the refreshed phones to Supabase so the next page load doesn't
      // revert to a stale number. Skip when a user has manually edited.
      if (!phoneEditedByUser && (spHomePhone || spCellPhone)) {
        try {
          const { updateTicketCustomer } = await import("@/lib/supabase/tickets");
          await updateTicketCustomer(
            ticketNo,
            {
              phone: spHomePhone || undefined,
              secondPhone: spCellPhone || undefined,
            },
            { markEdited: false },
          );
        } catch (e) {
          console.warn("[SP auto-sync] customer phone save skipped:", e);
        }
      }
      setSpCallSyncMsg("Call Service Information synced from ServicePower.");
    } catch (err) {
      if (!silent) setSpCallSyncMsg(
        `Failed to sync: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setSpCallSyncing(false);
    }
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

  // Load ticket from centralized system
  const [ticketData, setTicketData] = useState<TicketData | null>(null);
  
  useEffect(() => {
    // Load ticket from Supabase first; fall back to centralized/hardcoded.
    const loadTicketData = async () => {
      let centralTicket: Ticket | null = null;
      try {
        centralTicket = await sbGetTicketByNumber(ticketNo);
      } catch (err) {
        console.error("Supabase ticket load failed, falling back:", err);
      }
      if (!centralTicket) {
        centralTicket = getTicketByNumber(ticketNo) ?? null;
      }
      if (centralTicket) {
        // Map centralized Ticket to TicketData format
        const mapped: TicketData = {
          ticketNo: centralTicket.ticketNo,
          account: centralTicket.account || "",
          warranty: warrantyAcronym(mapServicePowerWarranty(centralTicket.warranty)),
          product: centralTicket.model,
          tat: computeTAT(centralTicket.created),
          status: centralTicket.status,
          schedule: centralTicket.schedule,
          contact: centralTicket.contact || "",
          location: centralTicket.location,
          firstName: centralTicket.firstName || "",
          lastName: centralTicket.lastName || "",
          address: centralTicket.address || "",
          address2: (centralTicket as any).address2 || "",
          city: centralTicket.city,
          state: centralTicket.state || "",
          zip: centralTicket.zip || "",
          homePhone: centralTicket.phone,
          cellPhone: centralTicket.secondPhone || "",
          altPhone: (centralTicket as any).altPhone || "",
          email: centralTicket.email || "",
          brand: centralTicket.manufacturer,
          model: centralTicket.model,
          serialNo: centralTicket.serial || "",
          modelVersion: (centralTicket as any).modelVersion || "",
          redoTicketNo: (centralTicket as any).originalTicketNo || "",
          productCategory: centralTicket.productType || "",
          purchaseDate: centralTicket.purchaseDate || "",
          warrantyType: mapServicePowerWarranty(centralTicket.warranty) || centralTicket.warranty,
          claimCompany: (centralTicket as any).claimCompany || "",
          // Service Contract badge shows the RAW ServicePower warranty info
          // (e.g. "Service Contract", "In Warranty"). Auto-sync fills it from
          // the live ServicePower call. Leave blank until the sync resolves so
          // we never duplicate the AHS-mapped Warranty Type next to it.
          serviceContract: "",
          accountNo: (centralTicket as any).accountNo || "",
          manufactureId: (centralTicket as any).manufactureId || "",
          callNo: centralTicket.ticketNo || "",
          ticketSource: centralTicket.ticketSource || centralTicket.account || "",
          callType: centralTicket.type || "",
          serviceType: (centralTicket as any).serviceType || "",
          callStatus: centralTicket.status,
          postingDate: centralTicket.created,
          repeatCall: centralTicket.redo ? "YES" : "NO",
          contractNo: (centralTicket as any).contractNo || "",
          copay: (centralTicket as any).copay || "",
          poNumber: (centralTicket as any).poNumber || "",
          poAmount: (centralTicket as any).poAmount || "",
          emergency: (centralTicket as any).emergency || "",
          authNo: (centralTicket as any).authNo || "",
          observationNotes: (centralTicket as any).observationNotes || "",
          problemDescription: centralTicket.problemDescription || centralTicket.internalNote || "",
          scheduleDate: centralTicket.schedule,
          // ServicePower's appointment window string, lives on
          // tickets.time_slot and surfaces as Ticket.schedulePeriod.
          schedulePeriod: (centralTicket as any).schedulePeriod || "",
          technician: centralTicket.technician,
          customerNotes: [],
          servicerNotes: [],
          // NSA-specific — fetched live from NSA API when ticketSource === "NSA"
          nsaStatus: (centralTicket as any).nsaStatus || "",
          nsaRouteName: (centralTicket as any).nsaRouteName || "",
          nsaGroupName: (centralTicket as any).nsaGroupName || "",
          nsaDeductible: (centralTicket as any).nsaDeductible || "",
          nsaScheduleAck: (centralTicket as any).nsaScheduleAck || "",
          nsaSpecialInstructions: (centralTicket as any).nsaSpecialInstructions || "",
          nsaValidCoverage: (centralTicket as any).nsaValidCoverage || "",
          nsaRequiredCoverage: (centralTicket as any).nsaRequiredCoverage || "",
          nsaRequiredPart: (centralTicket as any).nsaRequiredPart || "",
          nsaPreAuth: (centralTicket as any).nsaPreAuth || "",
          nsaCaseNumber: (centralTicket as any).nsaCaseNumber || (centralTicket as any).originalTicketNo || "",
          nsaMasterCode: (centralTicket as any).nsaMasterCode || "",
        };
        setTicketData(mapped);
      } else {
        // Fallback to hardcoded data if not in centralized system
        setTicketData(TICKET_DATA[ticketNo] || null);
      }
    };
    
    loadTicketData();
    
    // Listen for ticket updates
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "ahs:tickets:data" || e.key === null) {
        loadTicketData();
      }
    };
    
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [ticketNo, authReady]);

  const ticket = ticketData;

  // Squaretrade tickets need a per-ticket appointment-completion URL so the
  // claims team can finish the repair. We persist whatever the user pastes
  // (full URL or just the token) keyed by ticket number; the modal below
  // lets them update it inline.
  const [squaretradeUrl, setSquaretradeUrlState] = useState<string>("");
  const [squaretradeEditOpen, setSquaretradeEditOpen] = useState(false);
  const [squaretradeDraft, setSquaretradeDraft] = useState("");

  useEffect(() => {
    setSquaretradeUrlState(getSquaretradeUrl(ticketNo));
  }, [ticketNo]);

  // Load per-model reference links (Exploded View / Service Bulletin) when
  // the ticket's model changes. Shared across every ticket with the same
  // model number — saving here updates the resource for all of them.
  useEffect(() => {
    const model = String(ticket?.model || "").trim();
    if (!model) {
      setModelResources({ explodedViewUrl: "", serviceBulletinUrl: "" });
      return;
    }
    let cancelled = false;
    getModelResources(model)
      .then((res) => {
        if (cancelled) return;
        setModelResources({
          explodedViewUrl: res.explodedViewUrl || "",
          serviceBulletinUrl: res.serviceBulletinUrl || "",
        });
      })
      .catch((err) => console.error("getModelResources error:", err));
    return () => { cancelled = true; };
  }, [ticket?.model]);

  const handleSaveModelResource = async () => {
    if (!modelResourceModal) return;
    const model = String(ticket?.model || "").trim();
    if (!model) {
      alert("This ticket has no model number. Set a model first before linking resources.");
      return;
    }
    const url = modelResourceModal.value.trim();
    setModelResourceSaving(true);
    try {
      const updated = await saveModelResources(model, {
        explodedViewUrl: modelResourceModal.kind === "exploded" ? url : modelResources.explodedViewUrl,
        serviceBulletinUrl: modelResourceModal.kind === "bulletin" ? url : modelResources.serviceBulletinUrl,
      });
      setModelResources({
        explodedViewUrl: updated.explodedViewUrl,
        serviceBulletinUrl: updated.serviceBulletinUrl,
      });
      setModelResourceModal(null);
    } catch (err) {
      console.error("saveModelResources error:", err);
      alert(`Failed to save link: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setModelResourceSaving(false);
    }
  };

  // Auto-pull Call Service Information from ServicePower once the ticket has
  // loaded. Runs once per ticket number. Reads handleSyncCallInfo lazily via
  // a ref so the effect doesn't need it in its dep list (the function closes
  // over `ticketNo` already).
  useEffect(() => {
    if (!ticketData) return;
    if (autoSyncedRef.current === ticketNo) return;
    autoSyncedRef.current = ticketNo;
    // eslint-disable-next-line no-console
    console.log("[SP auto-sync] effect firing for ticket:", ticketNo);
    handleSyncCallInfo(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketData, ticketNo]);

  // Auto-fetch live NSA dispatch details when the ticket source is NSA.
  // Populates the NSA Dispatch Information section without requiring a manual sync.
  useEffect(() => {
    if (!ticketData) return;
    const src = String(ticketData.ticketSource || "").toUpperCase();
    if (!src.includes("NSA")) return;
    let cancelled = false;
    (async () => {
      try {
        const { getNsaDispatch } = await import("@/lib/nsaApi");
        const dispatch = await getNsaDispatch(ticketNo);
        if (cancelled || !dispatch) return;
        setTicketData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            nsaStatus: dispatch.status ?? prev.nsaStatus,
            nsaRouteName: dispatch.routeName ?? dispatch.route ?? prev.nsaRouteName,
            nsaGroupName: dispatch.groupName ?? dispatch.group ?? prev.nsaGroupName,
            nsaDeductible: dispatch.deductible != null ? String(dispatch.deductible) : prev.nsaDeductible,
            nsaScheduleAck: dispatch.scheduleAck ?? dispatch.scheduleACK ?? prev.nsaScheduleAck,
            nsaSpecialInstructions: dispatch.specialInstructions ?? prev.nsaSpecialInstructions,
            nsaValidCoverage: dispatch.validCoverage ?? prev.nsaValidCoverage,
            nsaRequiredCoverage: dispatch.requiredCoverage ?? prev.nsaRequiredCoverage,
            nsaRequiredPart: dispatch.requiredPart != null ? String(dispatch.requiredPart) : prev.nsaRequiredPart,
            nsaPreAuth: dispatch.preAuth ?? prev.nsaPreAuth,
            nsaCaseNumber: dispatch.caseNumber ?? prev.nsaCaseNumber,
            nsaMasterCode: dispatch.masterCode ?? prev.nsaMasterCode,
          };
        });
      } catch (err) {
        // Non-fatal — NSA data is supplemental; ticket still works without it
        console.warn("[NSA auto-fetch] failed:", err);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketData?.ticketSource, ticketNo]);

  // Pick a default Ship-To for the Marcone Parts Order modal: the ticket's
  // branch row in the address book if we have it; fall back to the
  // currently-signed-in user's email as the recipient. Recomputes any time
  // the ticket's branch or the address book reloads.
  useEffect(() => {
    if (partAddressBook.length === 0) return;
    const branchKey = (ticket?.location || "").trim().toLowerCase();
    const branchEntry = partAddressBook.find((a) =>
      a.id.startsWith("branch:") && a.shipTo.name.trim().toLowerCase() === branchKey,
    );
    const next = branchEntry?.shipTo ?? null;
    setDefaultShipTo({
      name: next?.name || ticket?.location || "",
      street1: next?.street1 || "",
      street2: next?.street2 || "",
      city: next?.city || "",
      state: next?.state || "",
      zip: next?.zip || "",
      phone: next?.phone || "",
      email: next?.email || currentUserEmail || "",
    });
  }, [partAddressBook, ticket?.location, currentUserEmail]);


  // Compute DRIVING miles from the office to this ticket's address using the
  // Google Distance Matrix API (matches what Google Maps shows). Falls back
  // through progressively looser destination strings so a slightly-off address
  // still resolves instead of showing "— mi".
  useEffect(() => {
    if (!ticket) { setOfficeDistanceMiles(null); return; }
    const office = getOfficeCoordinates(ticket.location || ticket.city || "");
    if (!office) { setOfficeDistanceMiles(null); return; }

    // Candidate destination strings, most specific first.
    const destinationCandidates = [
      [ticket.address, ticket.city, ticket.state, ticket.zip, "USA"].filter(Boolean).join(", "),
      [ticket.city, ticket.state, ticket.zip, "USA"].filter(Boolean).join(", "),
      [ticket.zip, "USA"].filter(Boolean).join(", "),
      [ticket.city, ticket.state, "USA"].filter(Boolean).join(", "),
    ]
      .map((s) => s.trim())
      .filter((s) => s && s !== "USA");

    if (destinationCandidates.length === 0) { setOfficeDistanceMiles(null); return; }

    let cancelled = false;
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;

    const computeDistance = () => {
      const maps = (window as Window & { google?: any }).google?.maps;
      if (!maps) return;
      const service = new maps.DistanceMatrixService();
      const originLatLng = new maps.LatLng(office.lat, office.lng);

      const tryCandidate = (idx: number) => {
        if (cancelled) return;
        if (idx >= destinationCandidates.length) {
          // Last resort: straight-line distance via geocoding the best string.
          const geocoder = new maps.Geocoder();
          geocoder.geocode({ address: destinationCandidates[0] }, (results: any, status: string) => {
            if (cancelled) return;
            if (status === "OK" && results?.[0]) {
              const pos = results[0].geometry.location;
              setOfficeDistanceMiles(milesBetween(office, { lat: pos.lat(), lng: pos.lng() }));
            } else {
              setOfficeDistanceMiles(null);
            }
          });
          return;
        }

        service.getDistanceMatrix(
          {
            origins: [originLatLng],
            destinations: [destinationCandidates[idx]],
            travelMode: maps.TravelMode.DRIVING,
            unitSystem: maps.UnitSystem.IMPERIAL,
          },
          (response: any, status: string) => {
            if (cancelled) return;
            const element = response?.rows?.[0]?.elements?.[0];
            if (status === "OK" && element?.status === "OK" && element.distance?.value != null) {
              // distance.value is in meters; convert to miles.
              setOfficeDistanceMiles(element.distance.value / 1609.344);
            } else {
              tryCandidate(idx + 1);
            }
          },
        );
      };

      tryCandidate(0);
    };

    if ((window as Window & { google?: any }).google?.maps) {
      computeDistance();
    } else if (apiKey) {
      const existing = document.querySelector<HTMLScriptElement>('script[data-google-maps="ticket-distance"]');
      if (existing) {
        existing.addEventListener("load", computeDistance, { once: true });
      } else {
        const script = document.createElement("script");
        script.dataset.googleMaps = "ticket-distance";
        script.async = true;
        script.defer = true;
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=3.52`;
        script.onload = computeDistance;
        document.head.appendChild(script);
      }
    }

    return () => { cancelled = true; };
  }, [ticket?.location, ticket?.address, ticket?.city, ticket?.state, ticket?.zip]);

  // Compute related tickets: any OTHER company ticket sharing a key field with
  // this one (email, phone, zip, customer name, address, model, or serial).
  // The "Matched" column lists which fields matched.
  const relatedTickets = useMemo(() => {
    if (!ticket) return [] as Array<any & { _matched: string[] }>;
    const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
    const cur = {
      email: norm(ticket.email),
      phone: norm(ticket.homePhone || (ticket as any).phone),
      cell: norm(ticket.cellPhone),
      zip: norm(ticket.zip),
      name: norm([ticket.firstName, ticket.lastName].filter(Boolean).join(" ") || (ticket as any).customer),
      address: norm(ticket.address),
      model: norm(ticket.model),
      serial: norm((ticket as any).serial),
    };
    const out: Array<any> = [];
    for (const t of allCompanyTickets) {
      if (!t || t.ticketNo === ticket.ticketNo) continue;
      const matched: string[] = [];
      const tName = norm([t.firstName, t.lastName].filter(Boolean).join(" ") || t.customer);
      const tPhone = norm(t.phone || t.homePhone);
      const tCell = norm(t.secondPhone || t.cellPhone);
      if (cur.email && norm(t.email) === cur.email) matched.push("Same Email");
      if (cur.phone && (tPhone === cur.phone || tCell === cur.phone)) matched.push("Same Phone");
      if (cur.cell && cur.cell !== cur.phone && (tPhone === cur.cell || tCell === cur.cell)) matched.push("Same Phone");
      if (cur.name && tName === cur.name) matched.push("Same Name");
      if (cur.address && norm(t.address) === cur.address) matched.push("Same Address");
      if (cur.zip && norm(t.zip) === cur.zip && cur.name && tName === cur.name) matched.push("Same Zip+Name");
      if (cur.model && norm(t.model) === cur.model && cur.name && tName === cur.name) matched.push("Same Model");
      if (cur.serial && norm(t.serial) === cur.serial) matched.push("Same Serial");
      if (matched.length) out.push({ ...t, _matched: Array.from(new Set(matched)) });
    }
    return out;
  }, [ticket, allCompanyTickets]);

  const addServicerNote = async () => {
    const body = newServicerNote.trim();
    if (!body) return;
    try {
      const added = await addTicketComment(
        ticketNo,
        body,
        currentUserName || currentUserEmail || "User",
        currentUserRole || ""
      );
      setServicerComments((prev) => [...prev, added]);
      appendAuditEntry({
        by: currentEditor,
        action: "Added servicer note",
        field: "Servicer Notes",
        before: "—",
        after: body,
      });
      setNewServicerNote("");
    } catch (e) {
      console.error("addServicerNote failed", e);
    }
  };

  // Load the shared servicer-notes thread (same table the mobile app writes to).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await getTicketComments(ticketNo);
        if (!cancelled) setServicerComments(rows);
      } catch (e) {
        console.error("load servicer comments failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ticketNo]);

  const startEditingCustomerInfo = () => {
    if (ticket) {
      // Only fields the user can actually edit are pre-loaded into the form
      // (address fields + phone numbers). Name and email are intentionally
      // omitted — they're shown as read-only labels in the form.
      setEditedCustomerInfo({
        address: ticket.address,
        address2: ticket.address2,
        city: ticket.city,
        state: ticket.state,
        zip: ticket.zip,
        homePhone: ticket.homePhone,
        cellPhone: ticket.cellPhone,
        altPhone: ticket.altPhone,
      });
      setIsEditingCustomerInfo(true);
    }
  };

  const saveCustomerInfo = () => {
    if (!ticket) return;

    // Only address fields + phone numbers are auditable from this form.
    // Name and email are read-only.
    const fieldsToCheck: (keyof TicketData)[] = ["address", "address2", "city", "state", "zip", "homePhone", "cellPhone", "altPhone"];

    fieldsToCheck.forEach((field) => {
      const oldValue = formatAuditValue(ticket[field]);
      const newValue = formatAuditValue(editedCustomerInfo[field]);

      if (oldValue !== newValue) {
        appendAuditEntry({
          by: currentEditor,
          action: "Updated customer information",
          field: field.charAt(0).toUpperCase() + field.slice(1).replace(/([A-Z])/g, " $1"),
          before: oldValue,
          after: newValue,
        });

        (ticket[field] as any) = editedCustomerInfo[field];
      }
    });

    // Update centralized ticket system. Name + email are read-only on this
    // form so we always pass the existing values through unchanged.
    updateTicket(ticketNo, {
      firstName: ticket.firstName,
      lastName: ticket.lastName,
      address: editedCustomerInfo.address ?? ticket.address,
      city: editedCustomerInfo.city ?? ticket.city,
      zip: editedCustomerInfo.zip ?? ticket.zip,
      phone: editedCustomerInfo.homePhone ?? ticket.homePhone,
      email: ticket.email,
    });

    // Persist to Supabase (source of truth). Customer details live in the
    // linked `customers` row. Name + email are intentionally NOT written —
    // they're read-only in the UI so we leave whatever's in the row alone.
    sbUpdateTicketCustomer(ticketNo, {
      address: editedCustomerInfo.address ?? ticket.address,
      address2: editedCustomerInfo.address2 ?? ticket.address2,
      city: editedCustomerInfo.city ?? ticket.city,
      state: editedCustomerInfo.state ?? ticket.state,
      zip: editedCustomerInfo.zip ?? ticket.zip,
      phone: editedCustomerInfo.homePhone ?? ticket.homePhone,
      secondPhone: editedCustomerInfo.cellPhone ?? ticket.cellPhone,
      altPhone: editedCustomerInfo.altPhone ?? ticket.altPhone,
    }).catch((err) => {
      console.error("Failed to save customer info to Supabase:", err);
      alert(`Failed to save customer info: ${err instanceof Error ? err.message : "Unknown error"}`);
    });

    setIsEditingCustomerInfo(false);
    setEditedCustomerInfo({});
  };

  const cancelEditingCustomerInfo = () => {
    setIsEditingCustomerInfo(false);
    setEditedCustomerInfo({});
  };

  const startEditingProblem = () => {
    if (ticket) {
      setEditedProblem(ticket.problemDescription || "");
      setIsEditingProblem(true);
    }
  };

  const saveProblemDescription = () => {
    if (!ticket) return;
    const newValue = editedProblem.trim();
    const oldValue = ticket.problemDescription || "";
    if (newValue !== oldValue) {
      appendAuditEntry({
        by: currentEditor,
        action: "Updated problem description",
        field: "Problem Description",
        before: oldValue,
        after: newValue,
      });
      (ticket as any).problemDescription = newValue;
      updateTicket(ticketNo, { problemDescription: newValue } as any);
      sbUpdateTicketFields(ticketNo, { problemDescription: newValue }).catch((err) => {
        console.error("Failed to save problem description:", err);
        alert(`Failed to save problem description: ${err instanceof Error ? err.message : "Unknown error"}`);
      });
    }
    setIsEditingProblem(false);
  };

  const cancelEditingProblem = () => {
    setIsEditingProblem(false);
    setEditedProblem("");
  };

  const startEditingProductInfo = () => {
    if (ticket) {
      setEditedProductInfo({
        brand: ticket.brand,
        model: ticket.model,
        serialNo: ticket.serialNo,
        modelVersion: ticket.modelVersion,
        redoTicketNo: ticket.redoTicketNo,
        productCategory: ticket.productCategory,
        purchaseDate: ticket.purchaseDate,
        warrantyType: ticket.warrantyType,
        claimCompany: ticket.claimCompany,
      });
      setIsEditingProductInfo(true);
    }
  };

  const saveProductInfo = async () => {
    if (!ticket) return;

    const fieldsToCheck: Array<keyof TicketData> = ["brand", "model", "serialNo", "modelVersion", "redoTicketNo", "productCategory", "purchaseDate", "warrantyType", "claimCompany"];
    fieldsToCheck.forEach((field) => {
      const oldValue = formatAuditValue(ticket[field]);
      const newValue = formatAuditValue(editedProductInfo[field]);

      if (oldValue !== newValue) {
        appendAuditEntry({
          by: currentUserEmail || "Unknown",
          action: "Updated",
          field: String(field),
          before: oldValue,
          after: newValue,
        });

        (ticket[field] as any) = editedProductInfo[field];
      }
    });

    // Update centralized ticket system (in-memory + localStorage cache)
    updateTicket(ticketNo, {
      manufacturer: editedProductInfo.brand || ticket.brand,
      model: editedProductInfo.model || ticket.model,
      serial: editedProductInfo.serialNo || ticket.serialNo,
      modelVersion: editedProductInfo.modelVersion ?? ticket.modelVersion,
      originalTicketNo: editedProductInfo.redoTicketNo ?? ticket.redoTicketNo,
      productType: editedProductInfo.productCategory || ticket.productCategory,
      purchaseDate: editedProductInfo.purchaseDate || ticket.purchaseDate,
      warranty: editedProductInfo.warrantyType || ticket.warrantyType,
      claimCompany: editedProductInfo.claimCompany ?? ticket.claimCompany,
    });

    // Persist to Supabase (source of truth). The `tickets` row is updated
    // and `product_edited_by_user` is flipped to true so the ServicePower
    // sync stops overwriting these columns on future runs.
    try {
      await sbUpdateTicketFields(ticketNo, {
        manufacturer: editedProductInfo.brand ?? ticket.brand,
        model: editedProductInfo.model ?? ticket.model,
        serial: editedProductInfo.serialNo ?? ticket.serialNo,
        modelVersion: editedProductInfo.modelVersion ?? ticket.modelVersion,
        productType: editedProductInfo.productCategory ?? ticket.productCategory,
        purchaseDate: editedProductInfo.purchaseDate ?? ticket.purchaseDate,
        warranty: editedProductInfo.warrantyType ?? ticket.warrantyType,
        claimCompany: editedProductInfo.claimCompany ?? ticket.claimCompany,
        originalTicketNo: editedProductInfo.redoTicketNo ?? ticket.redoTicketNo,
      });
    } catch (err) {
      console.error("Failed to persist product info:", err);
      alert(`Could not save Product Info to the database: ${err instanceof Error ? err.message : "Unknown error"}\n\nYour changes are still applied locally; please retry the save.`);
      // Keep edit mode open so the user can retry without losing input.
      return;
    }

    setIsEditingProductInfo(false);
    setEditedProductInfo({});
  };

  const cancelEditingProductInfo = () => {
    setIsEditingProductInfo(false);
    setEditedProductInfo({});
  };

  const startEditingScheduleInfo = () => {
    if (ticket) {
      setEditedScheduleInfo({
        scheduleDate: ticket.scheduleDate,
        schedulePeriod: ticket.schedulePeriod,
        technician: ticket.technician,
      });
      setIsEditingScheduleInfo(true);
    }
  };

  const saveScheduleInfo = async () => {
    if (!ticket) return;

    const fieldsToCheck: (keyof TicketData)[] = ["scheduleDate", "schedulePeriod", "technician"];

    fieldsToCheck.forEach((field) => {
      const oldValue = formatAuditValue(ticket[field]);
      const newValue = formatAuditValue(editedScheduleInfo[field]);

      if (oldValue !== newValue) {
        appendAuditEntry({
          by: currentEditor,
          action: "Updated schedule information",
          field: field.charAt(0).toUpperCase() + field.slice(1).replace(/([A-Z])/g, " $1"),
          before: oldValue,
          after: newValue,
        });

        (ticket[field] as any) = editedScheduleInfo[field];
      }
    });

    // Update centralized in-memory ticket map for any consumers reading
    // through getTicketByNumber (legacy code paths).
    updateTicket(ticketNo, {
      schedule: editedScheduleInfo.scheduleDate || ticket.scheduleDate,
      technician: editedScheduleInfo.technician || ticket.technician,
    });

    // Persist the change to Supabase so the value survives reloads and
    // also feeds the Work Map / Work Planner (both read schedule_date and
    // time_slot from the tickets table). Falls back silently if the
    // ticket isn't in Supabase yet (e.g. local-only fake tickets).
    try {
      await sbUpdateTicketAssignment(ticketNo, {
        technician: editedScheduleInfo.technician ?? ticket.technician,
        scheduleDate: editedScheduleInfo.scheduleDate ?? ticket.scheduleDate,
        timeSlot: editedScheduleInfo.schedulePeriod ?? ticket.schedulePeriod ?? "",
      });
    } catch (err) {
      console.warn("saveScheduleInfo: Supabase update skipped", err);
    }

    setIsEditingScheduleInfo(false);
    setEditedScheduleInfo({});
  };

  const cancelEditingScheduleInfo = () => {
    setIsEditingScheduleInfo(false);
    setEditedScheduleInfo({});
  };

  // Start editing the Redo Ticket # inline. Seeds the draft with the
  // value currently on the ticket so the user can append/replace.
  const startEditingRedoTicket = () => {
    setRedoTicketDraft(String(ticket?.redoTicketNo ?? ""));
    setEditingRedoTicket(true);
  };

  const cancelEditingRedoTicket = () => {
    setEditingRedoTicket(false);
    setRedoTicketDraft("");
  };

  // Persist the Redo Ticket # to Supabase (tickets.original_ticket_no
  // via updateTicketFields), update the in-memory ticket so the UI
  // reflects the change without a reload, append an audit entry.
  const saveRedoTicket = async () => {
    if (!ticket) return;
    const next = redoTicketDraft.trim();
    const prev = String(ticket.redoTicketNo ?? "");
    if (next === prev) {
      setEditingRedoTicket(false);
      return;
    }
    setSavingRedoTicket(true);
    try {
      await sbUpdateTicketFields(ticketNo, { originalTicketNo: next });
      // Reflect change locally so the field re-renders immediately.
      (ticket as any).redoTicketNo = next;
      appendAuditEntry({
        by: currentEditor,
        action: "Updated Redo Ticket #",
        field: "Redo Ticket #",
        before: prev || "NONE",
        after: next || "NONE",
      });
      setEditingRedoTicket(false);
      setRedoTicketDraft("");
    } catch (err) {
      console.error("Failed to save Redo Ticket #", err);
      alert(
        `Failed to save Redo Ticket #: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    } finally {
      setSavingRedoTicket(false);
    }
  };

  const addVisitLogEntry = async () => {
    if (visitFormMode === "view") {
      return;
    }

    const trimmedNote = newVisitNote.trim();
    // Required fields:
    //  - Action Type
    //  - Repair Status (drives the ticket's status; must always be set)
    if (!newVisitActionType) {
      alert("Please select an Action Type.");
      return;
    }
    if (!newVisitRepairStatus.trim()) {
      alert("Repair Status is required before a visit log can be submitted.");
      // Pop the field into view and focus it.
      const el = document.getElementById("visit-repair-status-modal") as HTMLSelectElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => el.focus(), 80);
      }
      return;
    }
    // Cause of Failure (diagnosis) + Repair Notes (resolution) are required
    // before a technician can submit / complete a visit. Office roles on the
    // web aren't blocked — only technicians and anyone using the mobile tech
    // app must fill them in.
    if (requireTechVisitFields) {
      if (!newVisitDiagnosis.trim()) {
        alert("Cause of Failure (Tech) is required before a visit can be completed.");
        const el = document.getElementById("visit-diagnosis-modal") as HTMLTextAreaElement | null;
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          setTimeout(() => el.focus(), 80);
        }
        return;
      }
      if (!newVisitResolution.trim()) {
        alert("Repair Notes (Tech) is required before a visit can be completed.");
        const el = document.getElementById("visit-resolution-modal") as HTMLTextAreaElement | null;
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          setTimeout(() => el.focus(), 80);
        }
        return;
      }
    }

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
        schedNotes: newVisitSchedNotes,
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
      schedNotes: newVisitSchedNotes,
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

    // Persist the visit to Supabase
    try {
      if (editingVisitId) {
        await sbUpdateTicketVisit(editingVisitId, visitEntry as any);
      } else {
        const saved = await sbAddTicketVisit(ticketNo, visitEntry as any);
        // adopt the DB-generated id so future edits target the right row
        visitEntry.id = saved.id;
      }
      // Sync the ticket itself with this visit: schedule date, technician, slot.
      await sbUpdateTicketAssignment(ticketNo, {
        technician: newVisitTechnician,
        scheduleDate: newVisitScheduleDate,
        timeSlot: newVisitTimeSlot,
      }).catch((e) => console.warn("assignment sync skipped:", e));
      // Set the ticket's status from the visit's REPAIR STATUS (not the visit status).
      if (newVisitRepairStatus) {
        await sbUpdateTicketStatus(ticketNo, newVisitRepairStatus).catch((e) =>
          console.warn("status update skipped:", e)
        );
      }
    } catch (err) {
      console.error("Failed to save visit:", err);
      alert(`Failed to save visit: ${err instanceof Error ? err.message : "Unknown error"}`);
      return;
    }

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
    setNewVisitTechnician("Memphis Admin");
    setNewVisitTimeSlot("");
    setNewVisitActivity("");
    setNewVisitActionType("SCHEDULE");
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
    setNewVisitSchedNotes("");
  };

  const openVisitCreateModal = () => {
    clearVisitForm();
    setIsVisitModalOpen(true);
  };

  // Raw XML from the last running-notes fetch (both getCallNotes and
  // getCallInfo). The Squaretrade URL extractor scans this so we can
  // catch the Appointment Completion URL even when it lives inside a
  // SP field we don't have a dedicated parser for (SpecialInstructions,
  // ProblemDesc, etc).
  const [runningNotesRawXml, setRunningNotesRawXml] = useState<string>("");

  // ---- ServicePower Running Notes ----------------------------------------
  const loadRunningNotes = useCallback(async () => {
    if (!ticketNo) return;
    setRunningNotesLoading(true);
    setRunningNotesError(null);
    try {
      const { fetchServicePowerNotes } = await import("@/lib/servicePowerNotes");
      const result = await fetchServicePowerNotes(ticketNo);
      // Stash both XML payloads concatenated so the URL extractor can
      // search anywhere in them (notes thread + work-order details).
      setRunningNotesRawXml(`${result.rawXml ?? ""}\n${result.rawCallInfoXml ?? ""}`);
      if (!result.success) {
        setRunningNotesError(result.error || "Failed to load running notes.");
        setRunningNotes([]);
      } else {
        setRunningNotes(result.notes.map((n) => ({
          date: n.date,
          body: n.body,
          addedBy: n.addedBy,
          isInternal: n.isInternal,
        })));
      }
    } catch (err) {
      setRunningNotesError(err instanceof Error ? err.message : String(err));
      setRunningNotes([]);
      setRunningNotesRawXml("");
    } finally {
      setRunningNotesLoading(false);
    }
  }, [ticketNo]);

  const openRunningNotesModal = () => {
    setIsRunningNotesOpen(true);
    setNewRunningNote("");
    setRunningNotePostError(null);
    void loadRunningNotes();
  };

  // Auto-fetch ServicePower Running Notes when a ticket loads so the
  // "Customer Notes" section on the General tab mirrors what the warranty
  // company (Allstate / Squaretrade / etc.) wrote on SP — without the user
  // having to open the Running Notes modal first.
  useEffect(() => {
    if (!ticketNo) return;
    void loadRunningNotes();
  }, [ticketNo, loadRunningNotes]);

  // Auto-sync the per-ticket Squaretrade Appointment Completion URL from
  // ServicePower whenever notes refresh. Squaretrade typically embeds
  // the ticket-specific confirmappointment URL inside the running-notes
  // thread, but on some tickets it only appears in the call-info
  // payload (special instructions / problem description / a SP field
  // we don't have a dedicated parser for). To catch both cases we scan
  // the parsed note bodies first, and fall back to the raw XML from
  // both getCallNotes and getCallInfo — any URL anywhere in those
  // payloads gets picked up.
  useEffect(() => {
    if (!ticketNo) return;
    const accountName = String(ticket?.account || "").toLowerCase().replace(/\s+/g, "");
    if (!accountName.includes("squaretrade")) return;
    const notesBlob = runningNotes.map((n) => n.body || "").join("\n");
    const fullBlob = [notesBlob, runningNotesRawXml].filter(Boolean).join("\n");
    if (!fullBlob) return;
    const found = extractSquaretradeUrl(fullBlob);
    if (!found) return;
    const current = getSquaretradeUrl(ticketNo);
    if (current === found) return;
    const saved = setSquaretradeUrl(ticketNo, found);
    setSquaretradeUrlState(saved);
  }, [ticketNo, ticket?.account, runningNotes, runningNotesRawXml]);

  // Compose the Customer Notes list shown on the General tab. We always
  // prefer the live SP running notes when available (so the customer-facing
  // thread stays in sync with what the warranty company posted). The
  // legacy ticket.customerNotes array is only used as a fallback when SP
  // returned nothing — otherwise dummy seeds would inflate the count.
  const displayedCustomerNotes = useMemo(() => {
    const fromSp = runningNotes.map((n) => ({
      // Render SP's ISO date in the same "MM/DD/YYYY HH:MM:SS" style the
      // existing Customer Notes block uses, so the design stays consistent.
      date: formatSpNoteDate(n.date),
      notes: n.body,
      by: n.addedBy || "ServicePower",
    }));
    const fromTicket = (ticket?.customerNotes ?? []) as Array<{ date: string; notes: string; by: string }>;
    // SP is the source of truth. If it returned at least one note, show
    // only those (de-duped by date+body). Only fall back to the
    // ticket-stored notes when SP came back empty.
    const source = fromSp.length > 0 ? fromSp : fromTicket;
    const seen = new Set<string>();
    const merged: Array<{ date: string; notes: string; by: string }> = [];
    for (const note of source) {
      const key = `${(note.date || "").trim()}::${(note.notes || "").trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(note);
    }
    // Chronological: first note at the top, most recent at the bottom so
    // dispatchers read the thread the way it was written on SP.
    merged.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    return merged;
  }, [runningNotes, ticket?.customerNotes]);

  const closeRunningNotesModal = () => {
    setIsRunningNotesOpen(false);
    setRunningNotePostError(null);
    setNewRunningNote("");
  };

  const submitRunningNote = async () => {
    const noteBody = newRunningNote.trim();
    if (!noteBody) return;
    setPostingRunningNote(true);
    setRunningNotePostError(null);
    try {
      const { addServicePowerNote } = await import("@/lib/servicePowerNotes");
      const isInternal = newRunningNoteVisibility === "internal";
      // SP threads notes by AddedBy. Use our servicer account so the warranty
      // company sees the note as coming from us, not the logged-in agent's
      // email (which leaks employee identities).
      const servicerAccount =
        (import.meta as any).env?.VITE_SERVICEPOWER_SERVICER_ACCOUNT || "GSL00002";
      const result = await addServicePowerNote({
        callNo: ticketNo,
        note: noteBody,
        addedBy: servicerAccount,
        isInternal,
      });
      if (!result.success) {
        setRunningNotePostError(result.error || "Failed to post note to ServicePower.");
        return;
      }
      // Optimistically append to the local thread; the next refresh will sync.
      setRunningNotes((prev) => [
        ...prev,
        {
          date: new Date().toISOString(),
          body: noteBody,
          addedBy: servicerAccount,
          isInternal,
        },
      ]);
      setNewRunningNote("");
      // Trigger a fresh fetch so SP-formatted timestamps land in place.
      void loadRunningNotes();
    } catch (err) {
      setRunningNotePostError(err instanceof Error ? err.message : String(err));
    } finally {
      setPostingRunningNote(false);
    }
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
    setNewVisitSchedNotes(entry.schedNotes || "");
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

  // Part viewing functions
  const loadPartForView = (part: PartTransactionRow) => {
    setViewingPartEntry(part);
    setIsPartModalOpen(true);
  };

  const closePartView = () => {
    setViewingPartEntry(null);
    setIsPartModalOpen(false);
  };

  // Submit PO for a part
  const submitPartPO = async (part: PartTransactionRow) => {
    // Check if part already has a PO
    if (part.poNo) {
      alert(`This part already has PO #${part.poNo}. Cannot create duplicate PO.`);
      return;
    }

    // Check if status is already "PO Made"
    if (part.status === 'PO Made') {
      alert('This part already has status "PO Made". Cannot create duplicate PO.');
      return;
    }

    if (!confirm(`Submit PO for part ${part.partNo}?`)) return;

    // Create PO from part
    const partOrder = createPartOrderFromTicket(ticketNo, part);
    await savePartOrder(partOrder);

    // Persist the part's status/PO change to Supabase
    const updatedPart = {
      ...part,
      status: 'PO Made',
      poNo: partOrder.poNo,
      poDate: partOrder.poDate,
    };
    try {
      await sbUpdateTicketPart(part.id, updatedPart as any);
    } catch (err) {
      console.error("Failed to update part PO:", err);
      alert(`Failed to save PO on part: ${err instanceof Error ? err.message : "Unknown error"}`);
      return;
    }

    // Update part status to "PO Made" and add PO number (local state)
    const updatedParts = partRows.map(p => (p.id === part.id ? updatedPart : p));
    setPartRows(updatedParts);

    // Add audit entry
    appendAuditEntry({
      by: currentEditor,
      action: "Submitted PO",
      field: "Part Transaction",
      before: `${part.partNo} - Status: ${part.status || 'No status'}`,
      after: `${part.partNo} - Status: PO Made - PO #: ${partOrder.poNo}`,
    });

    alert(`PO ${partOrder.poNo} created successfully! View it in Part Order page.`);
  };

  // Helper: silent batch submission for non-Marcone parts (existing legacy
  // path). Creates one PO per part, stamps PO Made + PO#, persists to
  // Supabase, and appends audit entries. Returns the list of PO numbers
  // created so the caller can surface them in the success toast.
  const submitSilentPOs = async (parts: PartTransactionRow[]): Promise<string[]> => {
    if (parts.length === 0) return [];
    const poNumbers: string[] = [];
    const updatedRows: PartTransactionRow[] = [];
    const ordersToSave: ReturnType<typeof createPartOrderFromTicket>[] = [];
    const updatedParts = partRows.map(part => {
      const needsPO = parts.some(p => p.id === part.id);
      if (needsPO) {
        const partOrder = createPartOrderFromTicket(ticketNo, part);
        ordersToSave.push(partOrder);
        poNumbers.push(partOrder.poNo);

        appendAuditEntry({
          by: currentEditor,
          action: "Submitted PO (Batch)",
          field: "Part Transaction",
          before: `${part.partNo} - Status: ${part.status || 'No status'}`,
          after: `${part.partNo} - Status: PO Made - PO #: ${partOrder.poNo}`,
        });

        const updated = {
          ...part,
          status: 'PO Made',
          poNo: partOrder.poNo,
          poDate: partOrder.poDate,
        };
        updatedRows.push(updated);
        return updated;
      }
      return part;
    });

    try {
      await Promise.all(ordersToSave.map((o) => savePartOrder(o)));
    } catch (err) {
      console.error("Failed to save some POs:", err);
    }
    try {
      await Promise.all(updatedRows.map((p) => sbUpdateTicketPart(p.id, p as any)));
    } catch (err) {
      console.error("Failed to persist batch POs:", err);
      alert(`Some PO updates failed to save: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
    setPartRows(updatedParts);
    return poNumbers;
  };

  // Submit POs for all parts that need them. Splits Marcone parts (which
  // open the Marcone Parts Order modal for CSR review) from non-Marcone
  // parts (which go through the existing silent batch flow).
  const submitAllPOs = async () => {
    // First, fix any parts that have PO numbers but incorrect status
    const partsToFix = partRows.filter(part => part.poNo && part.status !== 'PO Made');
    if (partsToFix.length > 0) {
      const fixedParts = partRows.map(part => {
        if (part.poNo && part.status !== 'PO Made') {
          appendAuditEntry({
            by: currentEditor,
            action: "Auto-corrected status",
            field: "Part Transaction",
            before: `${part.partNo} - Status: ${part.status || 'No status'} - PO #: ${part.poNo}`,
            after: `${part.partNo} - Status: PO Made - PO #: ${part.poNo}`,
          });
          return { ...part, status: 'PO Made' };
        }
        return part;
      });
      setPartRows(fixedParts);
      // Persist the status fixes
      await Promise.all(
        partsToFix.map((part) =>
          sbUpdateTicketPart(part.id, { ...part, status: 'PO Made' } as any).catch((e) =>
            console.warn("status fix persist skipped:", e)
          )
        )
      );
    }

    // Filter parts that need PO
    const partsNeedingPO = partRows.filter(part =>
      !part.poNo &&
      part.status !== 'PO Made' &&
      part.status !== 'Cancelled' &&
      (part.status === 'Need PO' || part.status === 'Tech Pickup' || part.status === 'Part Ready' || !part.status)
    );

    if (partsNeedingPO.length === 0) {
      if (partsToFix.length === 0) {
        alert('No parts need PO submission. All parts either already have POs or are cancelled.');
      }
      return;
    }

    // Split: Marcone goes through the review modal; everything else takes
    // the silent batch path so the user isn't blocked on confirming each
    // distributor separately.
    const marconeParts = partsNeedingPO.filter((p) => isMarconeDist(p.partDist));
    const otherParts = partsNeedingPO.filter((p) => !isMarconeDist(p.partDist));

    // Kick off non-Marcone silent submission immediately; the modal opening
    // doesn't need to wait on it. If both sets are non-empty we surface a
    // combined success message after the modal closes.
    let silentPoNumbers: string[] = [];
    if (otherParts.length > 0) {
      silentPoNumbers = await submitSilentPOs(otherParts);
    }

    if (marconeParts.length > 0) {
      setMarconeModal({ open: true, parts: marconeParts });
      return;
    }

    // No Marcone parts — show the silent-only result.
    if (silentPoNumbers.length > 0) {
      alert(`${silentPoNumbers.length} PO(s) created successfully:\n${silentPoNumbers.join('\n')}\n\nView them in Part Order page.`);
    }
  };

  // Handler the Marcone Parts Order modal calls when the user clicks Place
  // Order. Routes to placeMarconeOrder, reloads parts from Supabase so the
  // grid reflects the canonical state, then closes the modal.
  const handleMarconePlaceOrder = async (payload: MarconeOrderPayload) => {
    const result = await placeMarconeOrder(payload);
    const { poNo, marconeOrderNo } = result;
    // Audit log every line so reviewers can see who did what.
    for (const line of payload.lineItems) {
      const after = [
        `${line.partNumber}`,
        `Status: PO Made`,
        `PO #: ${poNo}`,
        `Ship: ${payload.shipMethod}`,
        marconeOrderNo ? `Marcone Order: ${marconeOrderNo}` : null,
      ].filter(Boolean).join(" - ");
      appendAuditEntry({
        by: currentEditor,
        action: "Submitted PO (Marcone Modal)",
        field: "Part Transaction",
        before: `${line.partNumber}`,
        after,
      });
    }
    // Reload parts so the grid picks up the new statuses + PO numbers
    // + Marcone Order # the order returned. ETA / tracking / invoice
    // come from /orders/orderstatus once Marcone has shipped.
    try {
      const parts = await sbGetTicketParts(ticketNo);
      setPartRows(parts as any);
    } catch (err) {
      console.warn("Failed to refresh parts after Marcone order:", err);
    }
    setMarconeModal({ open: false, parts: [] });
    const summary = [
      `Marcone PO ${poNo} placed — ${payload.lineItems.length} part${payload.lineItems.length === 1 ? "" : "s"}.`,
      marconeOrderNo ? `Marcone Order #: ${marconeOrderNo}` : null,
      "ETA, tracking, and invoice # will populate once Marcone ships.",
    ].filter(Boolean).join("\n");
    alert(summary);
  };

  // ── Truck Stock batch flow ──
  // Open the Truck Stock modal with every part on the ticket that
  // currently needs a PO. The modal itself fetches the matching
  // truck_stock rows and lets the user pick a source branch per part.
  const openTruckStockBatch = () => {
    if (partsEditDisabled) {
      alert(`Parts are locked because this ticket is "${ticket?.status}". Only Parts / Claims / Admin / Manager / Branch Manager roles can edit them.`);
      return;
    }
    const candidates = partRows.filter((part) =>
      !part.poNo &&
      part.status !== "PO Made" &&
      part.status !== "Cancelled" &&
      (part.status === "Need PO" || part.status === "Tech Pickup" || part.status === "Part Ready" || !part.status),
    );
    if (candidates.length === 0) {
      alert("No parts currently need PO. Nothing to source from Truck Stock.");
      return;
    }
    setTruckStockModal({ open: true, parts: candidates });
  };

  // Pull the requested parts from truck_stock and stamp PO Made + auto
  // PO No on each affected row. Quantities are decremented atomically
  // inside decrementTruckStock so two open tabs can't oversell.
  const handleTruckStockBatchConfirm = async (selections: TruckStockBatchSelection[]) => {
    const { decrementTruckStock } = await import("@/lib/supabase/truckStock");
    const today = new Date().toISOString().slice(0, 10);
    const updates: Array<{ partId: string; nextRow: PartTransactionRow; branch: string; pulled: number; storage: string }> = [];

    // Step 1: decrement stock for each selection. If any one fails we
    // stop and surface the error — earlier successful decrements stay
    // applied (Supabase doesn't have a multi-row transactional client
    // here, and the source rows are independent).
    for (const sel of selections) {
      const part = truckStockModal.parts.find((p) => p.id === sel.partId);
      if (!part) continue;
      try {
        await decrementTruckStock({
          branch: sel.branch,
          partNo: part.partNo,
          qty: sel.quantity,
        });
      } catch (err) {
        throw new Error(`${part.partNo}: ${err instanceof Error ? err.message : String(err)}`);
      }

      const autoPo = `INH-${sel.branch.replace(/\s+/g, "").slice(0, 4).toUpperCase()}-${Date.now().toString().slice(-6)}-${updates.length}`;
      const noteAdd = `Pulled ${sel.quantity} from ${sel.branch}${sel.storageLocation ? ` @ ${sel.storageLocation}` : ""} on ${today}.`;
      const nextRow: PartTransactionRow = {
        ...part,
        partDist: `In-House (${sel.branch})`,
        status: "PO Made",
        poNo: part.poNo || autoPo,
        poDate: part.poDate || today,
        quantity: String(sel.quantity),
        note: part.note ? `${part.note}\n${noteAdd}` : noteAdd,
        lastModifiedBy: currentEditor,
      };
      updates.push({ partId: sel.partId, nextRow, branch: sel.branch, pulled: sel.quantity, storage: sel.storageLocation });
    }

    // Step 2: persist each updated part row to Supabase.
    for (const u of updates) {
      try {
        await sbUpdateTicketPart(u.partId, u.nextRow as any);
      } catch (err) {
        console.warn(`Failed to persist truck-stock update for ${u.nextRow.partNo}:`, err);
      }
      appendAuditEntry({
        by: currentEditor,
        action: "Pulled from Truck Stock",
        field: PART_FIELD_LABELS.status,
        before: "Need PO",
        after: `${u.nextRow.partNo} - Status: PO Made - PO #: ${u.nextRow.poNo} - From: ${u.branch}${u.storage ? ` @ ${u.storage}` : ""}`,
      });
    }

    // Step 3: apply updates locally so the grid refreshes immediately.
    setPartRows((prev) =>
      prev.map((row) => {
        const u = updates.find((x) => x.partId === row.id);
        return u ? u.nextRow : row;
      }),
    );
    setTruckStockModal({ open: false, parts: [] });

    // Step 4: notify the Parts Manager when the actor is Triage or a
    // non-manager Parts user. Privileged roles (Parts Manager, Admin,
    // etc.) don't trigger the alert since they're the audience. Fire
    // one notification per unique source branch in this batch so the
    // message is specific enough to act on.
    try {
      const { shouldNotifyOnTruckStockUse, notifyPartsManagerOfTruckStockUse } =
        await import("@/lib/truckStockNotify");
      if (
        shouldNotifyOnTruckStockUse(currentUserRole, currentUserExtraRoles) &&
        currentCompanyId &&
        updates.length > 0
      ) {
        const byBranch = new Map<string, typeof updates>();
        for (const u of updates) {
          const arr = byBranch.get(u.branch) ?? [];
          arr.push(u);
          byBranch.set(u.branch, arr);
        }
        for (const [branch, group] of byBranch) {
          void notifyPartsManagerOfTruckStockUse({
            actorName: currentUserName ?? "",
            actorEmail: currentUserEmail ?? "",
            actorRole: String(currentUserRole ?? ""),
            ticketNo,
            branch,
            items: group.map((g) => ({
              partNo: g.nextRow.partNo,
              qty: g.pulled,
              branch: g.branch,
              storageLocation: g.storage,
            })),
            companyId: currentCompanyId,
          });
        }
      }
    } catch (notifyErr) {
      console.warn("Truck Stock parts-manager notify skipped:", notifyErr);
    }

    alert(`Pulled ${updates.length} part${updates.length === 1 ? "" : "s"} from Truck Stock. Each is now PO Made with an INH-… PO number.`);
  };

  // ── Sync parts from ServicePower running notes ──
  // The warranty company (Squaretrade / Allstate) posts structured
  // part-order and tracking notes onto the SP work order. This handler
  // parses those notes, creates a Need-PO part row for each new part the
  // claims team announced, and overlays tracking number + carrier onto
  // existing rows when a "tracking details" note arrives.
  const [syncingNotesParts, setSyncingNotesParts] = useState(false);

  const syncPartsFromNotes = useCallback(async () => {
    if (!ticketNo) return;
    if (runningNotes.length === 0) {
      alert("No ServicePower running notes loaded yet. Hit Refresh on Customer Notes first.");
      return;
    }
    const { aggregateSquaretradeParts } = await import("@/lib/squaretradeNotesParser");
    const parsed = aggregateSquaretradeParts(runningNotes);
    if (parsed.size === 0) {
      alert("No part-order or tracking notes found in this ticket's ServicePower thread.");
      return;
    }

    setSyncingNotesParts(true);
    try {
      // Snapshot current rows so duplicate part numbers update in place.
      const byPartNo = new Map<string, PartTransactionRow>();
      for (const row of partRows) {
        const key = String(row.partNo || "").trim().toUpperCase();
        if (key && !byPartNo.has(key)) byPartNo.set(key, row);
      }

      const insertions: PartTransactionRow[] = [];
      const updates: Array<{ id: string; next: PartTransactionRow }> = [];

      // Squaretrade tickets carry SQTRADE-style claim-to. Fall back to
      // whatever the user typically uses (Squaretrade dist).
      const claimTo = "Squaretrade";
      const partDist = "Squaretrade";

      for (const p of parsed.values()) {
        const key = p.partNo.toUpperCase();
        const existing = byPartNo.get(key);
        if (existing) {
          // Merge tracking / description / quantity onto the existing
          // row, but only when SP actually has something new to give us.
          // Manual edits on our side always win — we never overwrite a
          // tracking number, description, or quantity the dispatcher
          // already typed.
          const next: PartTransactionRow = {
            ...existing,
            partDesc: existing.partDesc || p.partDesc,
            quantity: existing.quantity || p.quantity || "1",
            inTracking: existing.inTracking || p.trackingNumber,
            note: existing.note ||
              [p.shippingProvider && `Carrier: ${p.shippingProvider}`, p.requiresReturn && `Requires return: ${p.requiresReturn}`]
                .filter(Boolean)
                .join(" | "),
            lastModifiedBy: currentEditor,
          };
          // Skip the round-trip if nothing actually changed — keeps
          // already-tracked parts (e.g. WE04X24719 already has its
          // tracking number) from being touched and from inflating the
          // "N rows updated" alert.
          const sameAsExisting =
            next.partDesc === existing.partDesc &&
            next.quantity === existing.quantity &&
            next.inTracking === existing.inTracking &&
            next.note === existing.note;
          if (sameAsExisting) continue;
          updates.push({ id: existing.id, next });
          continue;
        }

        const newId =
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

        const nextRow: PartTransactionRow = {
          id: newId,
          partNo: p.partNo,
          partDist,
          partDesc: p.partDesc,
          poNo: "",
          poDate: "",
          invoiceNo: "",
          invoiceDate: "",
          quantity: p.quantity || "1",
          partPrice: "",
          coreValue: "",
          shipCost: "",
          markup: "",
          totalMarkup: "",
          claimTo,
          status: "Need PO",
          note: [
            "Imported from SP customer notes",
            p.shippingProvider && `Carrier: ${p.shippingProvider}`,
            p.requiresReturn && `Requires return: ${p.requiresReturn}`,
          ].filter(Boolean).join(" | "),
          visitId: "",
          orderNo: "",
          eta: "",
          inTracking: p.trackingNumber,
          raDate: "",
          raNo: "",
          outTracking: "",
          creditNo: "",
          hold: "No",
          cxPaid: "No",
          createdBy: currentEditor,
          lastModifiedBy: currentEditor,
        };
        insertions.push(nextRow);
      }

      // Persist updates first (cheaper roundtrips) then new rows.
      for (const u of updates) {
        try {
          await sbUpdateTicketPart(u.id, u.next as any);
        } catch (err) {
          console.error("Failed to update part from notes:", err);
        }
      }
      const insertedWithIds: PartTransactionRow[] = [];
      for (const row of insertions) {
        try {
          const saved = await sbAddTicketPart(ticketNo, row as any);
          insertedWithIds.push({ ...row, id: saved.id });
        } catch (err) {
          console.error("Failed to insert part from notes:", err);
        }
      }

      // Reflect changes in the grid immediately.
      setPartRows((prev) => {
        const next = prev.map((row) => {
          const u = updates.find((x) => x.id === row.id);
          return u ? u.next : row;
        });
        return [...insertedWithIds, ...next];
      });

      // Audit log entries so the timeline shows who imported what.
      for (const row of insertedWithIds) {
        appendAuditEntry({
          by: currentEditor,
          action: "Imported part from SP customer notes",
          field: "Part Transaction",
          before: "—",
          after: `${row.partNo} - ${row.partDesc || "(no description)"} - Qty ${row.quantity} - Need PO`,
        });
      }
      for (const u of updates) {
        appendAuditEntry({
          by: currentEditor,
          action: "Updated part tracking from SP notes",
          field: "Part Transaction",
          before: u.id,
          after: `${u.next.partNo} - Tracking: ${u.next.inTracking || "(none)"}`,
        });
      }

      alert(
        `Sync complete: added ${insertedWithIds.length} new part${insertedWithIds.length === 1 ? "" : "s"}, updated ${updates.length} existing row${updates.length === 1 ? "" : "s"}.`,
      );
    } finally {
      setSyncingNotesParts(false);
    }
  }, [ticketNo, runningNotes, partRows, currentEditor]);

  // ── Sync from Assurant Claim ──
  // When the ticket is an Assurant-flagged claim that's already been
  // claimed on ServicePower's claims portal, the API exposes payment
  // breakdown (paidLaborAmount, paidPartsAmount, etc.) plus the claim
  // number + status. This handler pulls that data and stamps it onto
  // the part transactions so the Claims team doesn't have to retype
  // anything. Only enabled for tickets whose account looks like
  // Assurant and whose status mentions "claim".
  const [syncingClaim, setSyncingClaim] = useState(false);

  const isAssurantClaimedTicket = useMemo(() => {
    const account = String(ticket?.account || "").toLowerCase();
    const status = String(ticket?.status || "").toLowerCase();
    const brand = String(ticket?.brand || "").toLowerCase();
    const claimCompany = String(ticket?.claimCompany || "").toLowerCase();
    // Direct-service manufacturers run their own claim portals — they should
    // never go through Assurant's retrieveClaim even when the Work Order
    // Source string happens to contain "assurant" (e.g. legacy data, or a
    // typo in SP). If the manufacturer or claim company is Electrolux /
    // Frigidaire / GE, treat as direct-service and hide the Assurant Sync
    // from Claim button.
    const DIRECT_SERVICE_BRANDS = [
      "electrolux", "frigidaire", "ge appliance", "general electric",
    ];
    if (
      DIRECT_SERVICE_BRANDS.some((b) => brand.includes(b)) ||
      DIRECT_SERVICE_BRANDS.some((b) => claimCompany.includes(b))
    ) {
      return false;
    }
    if (!account.includes("assurant") && !claimCompany.includes("assurant")) return false;
    return status.includes("claim");
  }, [ticket?.account, ticket?.status, ticket?.brand, ticket?.claimCompany]);

  const syncFromClaim = useCallback(async () => {
    if (!ticketNo) return;
    if (!isAssurantClaimedTicket) {
      alert(
        "Sync from Claim is only available on Assurant tickets whose status indicates the claim has been filed.",
      );
      return;
    }
    setSyncingClaim(true);
    try {
      const { retrieveClaim } = await import("@/lib/servicePowerApiClient");
      // ServicePower's claim retrieval API needs:
      //   - manufacturerName (Assurant variants)
      //   - serviceCenterNumber (our servicer ID that Assurant issued us)
      //   - one of: callNumber / claimNumber / claimIdentifier
      // We try every reasonable combination so we land on whichever
      // permutation SP's tenant happens to accept.
      const manufacturerNames = ["ASSURANT", "ASSURANT SOLUTIONS", "Assurant"];
      // Service-center numbers to try in order. Empty string means
      // "let the server pick its default" (env-driven). Concrete numeric
      // values pulled from the ticket's stored servicer credentials.
      const serviceCenterCandidates = [
        "",
        ticket?.accountNo || "",
        "GSL00002",
      ].filter((v, i, arr) => arr.indexOf(v) === i); // de-dupe
      const queries: Array<{ label: string; params: Record<string, string> }> = [];
      for (const m of manufacturerNames) {
        for (const sc of serviceCenterCandidates) {
          const scLabel = sc ? ` / sc=${sc}` : "";
          queries.push({ label: `${m}${scLabel} / callNumber`, params: { callNumber: ticketNo, manufacturerName: m, ...(sc ? { serviceCenterNumber: sc } : {}) } });
          queries.push({ label: `${m}${scLabel} / claimNumber`, params: { claimNumber: ticketNo, manufacturerName: m, ...(sc ? { serviceCenterNumber: sc } : {}) } });
          queries.push({ label: `${m}${scLabel} / claimIdentifier`, params: { claimIdentifier: ticketNo, manufacturerName: m, ...(sc ? { serviceCenterNumber: sc } : {}) } });
        }
      }

      const attempts: Array<{ label: string; responseCode?: string; claimCount: number; messages?: string }> = [];
      let result: Awaited<ReturnType<typeof retrieveClaim>> | null = null;
      let usedQuery = "";

      for (const q of queries) {
        try {
          const r = await retrieveClaim(q.params as any);
          attempts.push({
            label: q.label,
            responseCode: r.responseCode,
            claimCount: r.claims?.length ?? 0,
            messages: r.messages?.map((m) => m.message).join("; "),
          });
          if (r.responseCode === "OK" && r.claims && r.claims.length > 0) {
            result = r;
            usedQuery = q.label;
            break;
          }
        } catch (err) {
          attempts.push({
            label: q.label,
            responseCode: "ERR",
            claimCount: 0,
            messages: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (!result) {
        // Log every attempt so we can see exactly what SP returned for
        // each query shape (the SP responseCode / messages help diagnose
        // whether we hit the wrong field or the wrong environment).
        console.error("[syncFromClaim] All retrieveClaim attempts failed", attempts);
        const summary = attempts
          .map((a) => `${a.label}: ${a.responseCode || "?"} (${a.claimCount} claims)${a.messages ? ` — ${a.messages}` : ""}`)
          .join("\n");
        alert(
          `No claim found on ServicePower for ticket #${ticketNo}.\n\n` +
          `Tried:\n${summary}\n\n` +
          `If the claim exists in SP HUB, the API may need a different query field or a different environment. ` +
          `Open DevTools Console for the raw responses.`,
        );
        return;
      }

      console.info(`[syncFromClaim] Matched via ${usedQuery}:`, result.claims);

      // Use the most-recent claim entry (claims for the same call get
      // batched / re-submitted; the last one carries the latest payment
      // breakdown).
      const claim = [...(result.claims ?? [])].sort((a, b) =>
        String(b.editedDate || b.receivedDate || "").localeCompare(
          String(a.editedDate || a.receivedDate || ""),
        ),
      )[0];
      if (!claim) {
        alert("ServicePower returned an empty claim list. Nothing to sync.");
        return;
      }

      // Pretty money formatter shared with the audit log entries.
      const money = (n: number) =>
        Number.isFinite(n) ? `$${n.toFixed(2)}` : "$0.00";
      const fmtDate = (yyyymmdd: string) => {
        if (!yyyymmdd || yyyymmdd.length !== 8) return yyyymmdd || "";
        return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
      };

      // Build a single audit-friendly summary line we can reuse on every
      // part-row note and the audit entry.
      const summary =
        `Claim #${claim.claimNumber} — ${claim.claimStatusDescription || claim.claimStatusCode}. ` +
        `Paid: ${money(claim.paymentAmount)} (Labor ${money(claim.paidLaborAmount)} · Parts ${money(claim.paidPartsAmount)} · Travel ${money(claim.paidTravelAmount)}). ` +
        `Payment date ${fmtDate(claim.paymentDate)}.`;

      // Update every existing part row. If there are no rows yet, just
      // record a single audit entry — there's nothing to stamp parts on.
      const updates: Array<{ id: string; next: PartTransactionRow }> = [];
      for (const row of partRows) {
        const next: PartTransactionRow = {
          ...row,
          status: "Claimed",
          claimTo: row.claimTo || claim.brandName || "Assurant",
          creditNo: row.creditNo || claim.claimNumber,
          cxPaid: claim.paymentAmount > 0 ? "Yes" : row.cxPaid,
          note: row.note ? `${row.note}\n${summary}` : summary,
          lastModifiedBy: currentEditor,
        };
        // Skip if nothing actually changed.
        const same =
          next.status === row.status &&
          next.claimTo === row.claimTo &&
          next.creditNo === row.creditNo &&
          next.cxPaid === row.cxPaid &&
          next.note === row.note;
        if (!same) updates.push({ id: row.id, next });
      }

      for (const u of updates) {
        try {
          await sbUpdateTicketPart(u.id, u.next as any);
        } catch (err) {
          console.error("Failed to update part from claim:", err);
        }
      }

      setPartRows((prev) =>
        prev.map((row) => {
          const u = updates.find((x) => x.id === row.id);
          return u ? u.next : row;
        }),
      );

      appendAuditEntry({
        by: currentEditor,
        action: "Synced from Assurant Claim",
        field: "Part Transaction",
        before: `${partRows.length} part rows`,
        after: summary,
      });

      alert(
        `Synced from claim:\n\n${summary}\n\n` +
        `${updates.length} part row${updates.length === 1 ? "" : "s"} updated.`,
      );
    } catch (err) {
      console.error("[syncFromClaim] failed:", err);
      alert(
        `Failed to retrieve claim from ServicePower: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSyncingClaim(false);
    }
  }, [ticketNo, isAssurantClaimedTicket, partRows, currentEditor]);

  // Alert message system
  const addAlertMessage = () => {
    if (newAlertMessage.trim()) {
      const alertEntry = {
        id: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
        text: newAlertMessage.trim(),
        by: currentEditor,
        timestamp: new Date().toLocaleString(),
      };
      setAlertMessages((messages) => [alertEntry, ...messages]);
      appendAuditEntry({
        by: currentEditor,
        action: "Added alert message",
        field: "Alert Messages",
        before: "—",
        after: newAlertMessage.trim(),
      });
      setNewAlertMessage("");
    }
  };

  const removeAlertMessage = (alertId: string) => {
    const alertToRemove = alertMessages.find((msg) => msg.id === alertId);
    if (alertToRemove && confirm("Remove this alert message?")) {
      setAlertMessages((messages) => messages.filter((msg) => msg.id !== alertId));
      appendAuditEntry({
        by: currentEditor,
        action: "Removed alert message",
        field: "Alert Messages",
        before: alertToRemove.text,
        after: "Removed",
      });
    }
  };

  const closeVisitModal = () => {
    setIsVisitModalOpen(false);
    clearVisitForm();
  };

  // Part Transaction lock: once the ticket has been Claimed or Data Closed,
  // only the Claims department (or Naveen) is allowed to change a part
  // status. Anyone else who tries triggers a notification to Naveen / Ian /
  // Tina and the change is rejected. UI elements are also disabled for
  // non-Claims users so it's clear up front.
  const PART_LOCK_STATUSES = useMemo(
    () => new Set([
      "cl-claimed",
      "claimed",
      "cl-data closed",
      "data closed",
    ]),
    [],
  );
  const isTicketPartLocked = useMemo(() => {
    const s = String(ticket?.status || "").trim().toLowerCase();
    return PART_LOCK_STATUSES.has(s);
  }, [ticket?.status, PART_LOCK_STATUSES]);
  // Roles allowed to edit Part Transactions on a locked (Claimed /
  // Data Closed) ticket. Parts + Claims teams and their managers are
  // the day-to-day editors; Admins, Managers and Branch Managers can
  // override. CSR Manager and below (CSR agents, technicians, triage)
  // stay locked out.
  const PART_LOCK_BYPASS_ROLES = useMemo(
    () => new Set([
      "CLAIMS",
      "CLAIMS_MANAGER",
      "PARTS",
      "PARTS_MANAGER",
      "MANAGER",
      "ADMIN",
      "BRANCH_MANAGER",
      "SENIOR_BRANCH_MANAGER",
      "BIZOPS_MANAGER",
      "BIZOPS_SENIOR_MANAGER",
    ]),
    [],
  );
  // Track the caller's extra_roles separately so we can do multi-role
  // checks without coupling to the auth provider shape. Loaded once on
  // mount.
  const [currentUserExtraRoles, setCurrentUserExtraRoles] = useState<string[]>([]);
  useEffect(() => {
    if (!authReady || !uid) return;
    let cancelled = false;
    (async () => {
      try {
        const { supabase } = await import("@/lib/supabase/client");
        const { data } = await supabase
          .from("profiles")
          .select("extra_roles")
          .eq("firebase_uid", uid)
          .maybeSingle();
        if (cancelled) return;
        const extras = (data?.extra_roles as string[] | null) ?? [];
        setCurrentUserExtraRoles(Array.isArray(extras) ? extras : []);
      } catch {
        if (!cancelled) setCurrentUserExtraRoles([]);
      }
    })();
    return () => { cancelled = true; };
  }, [authReady, uid]);

  // Merged technician list for the Add Visit / Edit Schedule
  // dropdowns. Combines the canonical ALL_TECHNICIANS constant with
  // every Supabase profile that has TECHNICIAN as primary role OR in
  // extra_roles — so multi-role users like Daven Hodge (BizOps + Tech)
  // show up in the technician picker. De-duplicated, sorted
  // alphabetically. Falls back to the static list when the fetch
  // hasn't completed yet.
  const [companyTechUsers, setCompanyTechUsers] = useState<string[]>([]);
  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    (async () => {
      try {
        const { getCompanyUsers } = await import("@/lib/supabase/users");
        const rows = await getCompanyUsers();
        if (cancelled) return;
        const names = new Set<string>();
        for (const u of rows as any[]) {
          const primary = String(u?.role ?? "").toUpperCase();
          const extras = ((u?.extra_roles as string[] | null | undefined) ?? []).map((r) =>
            String(r ?? "").toUpperCase(),
          );
          if (primary === "TECHNICIAN" || extras.includes("TECHNICIAN")) {
            const name = String(u?.display_name || u?.username || u?.email || "").trim();
            if (name) names.add(name);
          }
        }
        setCompanyTechUsers(Array.from(names));
      } catch (err) {
        console.warn("technician user list load failed:", err);
        if (!cancelled) setCompanyTechUsers([]);
      }
    })();
    return () => { cancelled = true; };
  }, [authReady]);
  const technicianOptions = useMemo(() => {
    // De-duplicate across the canonical roster + Supabase-driven names.
    // The key is aggressive enough to collapse common variants of the
    // same person (case, whitespace, middle initials, email local part,
    // trailing "(Tech)" markers) so a user listed in both sources — or
    // as "Daven Hodge" and "Daven J Hodge" — renders once. We keep the
    // longer/more-formal string (usually the display_name) as the
    // canonical label.
    const canonicalKey = (n: string) =>
      String(n || "")
        .toLowerCase()
        .replace(/@.*$/g, "") // drop email domain
        .replace(/\(.*?\)/g, "") // drop parenthetical tags
        .replace(/[^a-z\s]/g, " ") // strip punctuation
        .replace(/\b[a-z]\b/g, "") // strip single-letter middle initials
        .replace(/\s+/g, " ")
        .trim();

    const chosen = new Map<string, string>();
    const add = (raw: string) => {
      const t = String(raw || "").trim();
      if (!t) return;
      const key = canonicalKey(t);
      if (!key) return;
      const existing = chosen.get(key);
      if (!existing || t.length > existing.length) {
        chosen.set(key, t);
      }
    };
    for (const n of ALL_TECHNICIANS) add(n);
    for (const n of companyTechUsers) add(n);
    return Array.from(chosen.values()).sort((a, b) => a.localeCompare(b));
  }, [companyTechUsers]);

  const isClaimsRole = useMemo(() => {
    const primary = String(currentUserRole || "").toUpperCase();
    if (PART_LOCK_BYPASS_ROLES.has(primary)) return true;
    return currentUserExtraRoles.some((r) =>
      PART_LOCK_BYPASS_ROLES.has(String(r).toUpperCase()),
    );
  }, [currentUserRole, currentUserExtraRoles, PART_LOCK_BYPASS_ROLES]);
  const isNaveen = useMemo(() => {
    const n = String(currentUserName || "").trim().toLowerCase();
    return n === "naveen" || n.startsWith("naveen ");
  }, [currentUserName]);
  // Disable edits to existing rows for non-Claims users once the ticket is
  // locked. Adding brand-new rows is also blocked when the lock is on.
  const partsEditDisabled = isTicketPartLocked && !isClaimsRole && !isNaveen;

  // Claim Transaction section visibility. Only the Claims department and
  // Admin / Manager / Branch-level roles can see (or interact with) the
  // claim transaction grid. Everyone else — CSR, technician, parts, triage
  // — never sees the section. Naveen also retained as an explicit allow
  // by name (matches the Part-lock allow-list semantics so the two
  // surfaces stay symmetrical).
  const CLAIM_VIEW_ROLES = useMemo(
    () => new Set([
      "CLAIMS",
      "CLAIMS_MANAGER",
      "MANAGER",
      "ADMIN",
      "SUPERADMIN",
      "BRANCH_MANAGER",
      "SENIOR_BRANCH_MANAGER",
      "BIZOPS_MANAGER",
      "BIZOPS_SENIOR_MANAGER",
    ]),
    [],
  );
  const canSeeClaimTransaction = useMemo(() => {
    // OFFLINE DEMO MODE: no role backend, so surface the Claim Transaction
    // section for every demo account (matches the collaborator's layout where
    // it sits right below Part Transaction).
    if (!isFirebaseReady()) return true;
    if (isNaveen) return true;
    const primary = String(currentUserRole || "").toUpperCase();
    if (CLAIM_VIEW_ROLES.has(primary)) return true;
    return currentUserExtraRoles.some((r) =>
      CLAIM_VIEW_ROLES.has(String(r).toUpperCase()),
    );
  }, [currentUserRole, currentUserExtraRoles, CLAIM_VIEW_ROLES, isNaveen]);

  // CSR-only accounts (agents, team leaders, CSR managers) should see
  // the Part Transaction table but not the write-side toolbar (View
  // Log / Sync Parts from Notes / Truck Stock / Submit POs / Update).
  // Anyone with a Parts / Claims / Manager / Admin / Branch role — or
  // a mixed CSR + one of those in extra_roles — still sees the buttons.
  const CSR_ONLY_ROLES = useMemo(
    () => new Set([
      "CSR",
      "CSR_AGENT",
      "CSR_TEAM_LEADER",
      "CSR_MANAGER",
    ]),
    [],
  );
  const canUsePartToolbar = useMemo(() => {
    if (isNaveen) return true;
    const primary = String(currentUserRole || "").toUpperCase();
    const allRoles = [primary, ...currentUserExtraRoles.map((r) => String(r).toUpperCase())];
    // If they hold ANY non-CSR role we consider valid for parts, allow it.
    if (allRoles.some((r) => PART_LOCK_BYPASS_ROLES.has(r))) return true;
    // If the user is *only* a CSR-family role, hide the toolbar.
    if (allRoles.every((r) => CSR_ONLY_ROLES.has(r) || !r)) return false;
    // Everyone else (Technician, Triage, Dispatcher, etc.) also loses
    // the toolbar per current business rule.
    return false;
  }, [currentUserRole, currentUserExtraRoles, isNaveen, PART_LOCK_BYPASS_ROLES, CSR_ONLY_ROLES]);

  const notifyUnauthorizedPartEdit = useCallback(async (attemptedRow: PartTransactionRow | null) => {
    if (!currentCompanyId) return;
    try {
      const { sendNotificationToUsers } = await import("@/lib/firebase/notifications");
      await sendNotificationToUsers(
        ["Naveen", "Ian", "Tina"],
        currentCompanyId,
        {
          title: "Locked ticket: unauthorized part edit attempt",
          body:
            `${currentUserName || currentUserEmail || "A user"} (${currentUserRole || "no role"}) tried to change a part on ticket ${ticketNo} ` +
            `while it was in status "${ticket?.status || "?"}". ` +
            (attemptedRow ? `Part: ${attemptedRow.partNo || "(new)"} → ${partDraft.status || "(no status)"}.` : ""),
          kind: "part_lock_violation",
          ticketNo,
        } as any,
      );
    } catch (err) {
      console.warn("notifyUnauthorizedPartEdit failed:", err);
    }
  }, [currentCompanyId, currentUserName, currentUserEmail, currentUserRole, ticketNo, ticket?.status, partDraft.status]);

  const clearPartForm = () => {
    setEditingPartId(null);
    setPartDraft(createEmptyPartDraft());
  };

  // ── Marcone /parts/lookup — autofill Description / List Price / Core / Stock ──
  const handleMarconeLookup = async () => {
    const partNumber = partDraft.partNo.trim();
    const partDist = partDraft.partDist.trim();
    if (!partDist) {
      setMarconeLookupMsg({ kind: "err", text: "Pick Part Dist. first." });
      return;
    }
    // Marcone is the only distributor we have an API for right now. Other
    // distributors (GE, AIG, Encompass, ...) need their own integrations.
    const distLower = partDist.toLowerCase();
    const isMarconeDist = distLower.startsWith("marcone");
    if (!isMarconeDist) {
      setMarconeLookupMsg({
        kind: "err",
        text: `Lookup not available for ${partDist}. Currently wired for Marcone only.`,
      });
      return;
    }
    if (!partNumber) {
      setMarconeLookupMsg({ kind: "err", text: "Enter a Part No first." });
      return;
    }
    setMarconeLookupBusy(true);
    setMarconeLookupMsg(null);
    try {
      const { marconeLookupPart } = await import("@/lib/marconeApi");
      // The inline Lookup is for vendor (Marcone) info only now — in-house
      // truck-stock fulfilment is handled by the dedicated Truck Stock
      // button next to Submit POs. That separation keeps the Lookup
      // banner short and focused on what the distributor can supply.
      const result = await marconeLookupPart({
        partNumber,
        quantity: Number(partDraft.quantity) || 1,
      });

      if (result.notFound) {
        setMarconeLookupMsg({
          kind: "err",
          text: `Marcone: ${partNumber} not found.`,
        });
        return;
      }
      if (!result.success || !result.data) {
        setMarconeLookupMsg({
          kind: "err",
          text: `Marcone error: ${result.error || "request failed"}`,
        });
        return;
      }
      const d = result.data;
      // Patch the draft only for fields the user hasn't typed yet; never
      // overwrite Part No, Visit ID, or the Part Dist. they picked.
      setPartDraft((prev) => ({
        ...prev,
        partDesc: prev.partDesc || d.description || "",
        partPrice: prev.partPrice || (d.netPrice ?? d.listPrice ?? "").toString(),
        coreValue: prev.coreValue || (d.coreValue ?? "").toString(),
      }));
      const stockLine = d.inStock ? "in stock" : "out of stock";
      const discLine = d.isDiscontinued ? " · discontinued" : "";
      setMarconeLookupMsg({
        kind: "ok",
        text: `Found ${d.make || ""} ${d.partNumber || partNumber} · Marcone: ${stockLine}${discLine}.`,
      });
    } catch (err) {
      setMarconeLookupMsg({
        kind: "err",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setMarconeLookupBusy(false);
    }
  };

  // ── Refresh a single part row's status from Marcone /orders/orderstatus ──
  // Pulls live ETA / invoice / tracking back to the Part Transaction row.
  // Only meaningful when the row has an `orderNo` we got from Marcone's
  // /orders/purchaseorder response. Other distributors keep using the
  // legacy manual ETA / invoice fields.
  //
  // Manual click only — there is no background auto-poll for now. The
  // user explicitly removed it; if needed later, restore the useEffect
  // that called syncMarconeOrderStatus({ silent: true }) on an interval.
  const [marconeRefreshingId, setMarconeRefreshingId] = useState<string | null>(null);

  // Core sync routine. `silent` controls UI feedback. Currently only the
  // manual button calls it (silent: false). Returns true when the row
  // picked up at least one new field.
  const syncMarconeOrderStatus = async (
    row: PartTransactionRow,
    options: { silent: boolean },
  ): Promise<boolean> => {
    if (!row.orderNo?.trim() || !isMarconeDist(row.partDist)) return false;

    const { marconeOrderStatus } = await import("@/lib/marconeApi");
    const result = await marconeOrderStatus({ orderNumber: row.orderNo.trim() });
    if (!result.success || !result.data) {
      if (!options.silent) {
        alert(`Marcone order status failed: ${result.error || "no data returned"}`);
      } else {
        console.warn(
          `[marcone auto-sync] ${row.partNo} (${row.orderNo}) failed:`,
          result.error || "no data",
        );
      }
      return false;
    }

    const info = result.data;
    const patch: Record<string, unknown> = {};
    if (info.eta && info.eta !== row.eta) patch.eta = info.eta;
    if (info.invoiceNumber && info.invoiceNumber !== row.invoiceNo) patch.invoice_no = info.invoiceNumber;
    if (info.invoiceDate && info.invoiceDate !== row.invoiceDate) patch.invoice_date = info.invoiceDate;
    if (info.trackingNumbers && info.trackingNumbers !== row.inTracking) patch.in_tracking = info.trackingNumbers;

    // Status promotion rules after a Marcone status refresh:
    //   - "PO Made" stays "PO Made" while the part is in transit, even
    //     when Marcone hands back an invoice # or a tracking #. The
    //     part isn't physically with us yet, so promoting to
    //     "Part Ready" is misleading.
    //   - Back-order from Marcone bubbles up to "Back Order".
    //   - Tech Pickup / Used / Part Ready / Cx Home / etc. stay where
    //     they are; the dispatcher set those manually for a reason.
    // The grid still picks up the tracking #, invoice #, and ETA so
    // the row reflects the carrier's progress — we just don't promote
    // the part status on the strength of an in-flight shipment.
    const ms = (info.status || "").toLowerCase();
    let nextStatus = row.status;
    if (ms.includes("back") && row.status === "PO Made") nextStatus = "Back Order";
    if (nextStatus !== row.status) patch.status = nextStatus;

    if (Object.keys(patch).length === 0) {
      if (!options.silent) {
        alert(
          `Marcone order ${info.orderNumber || row.orderNo} — status: ${info.status || "pending"}. ` +
          "No new ETA, invoice, or tracking yet.",
        );
      }
      return false;
    }

    const nextRow: PartTransactionRow = {
      ...row,
      ...(info.eta ? { eta: info.eta } : {}),
      ...(info.invoiceNumber ? { invoiceNo: info.invoiceNumber } : {}),
      ...(info.invoiceDate ? { invoiceDate: info.invoiceDate } : {}),
      ...(info.trackingNumbers ? { inTracking: info.trackingNumbers } : {}),
      ...(nextStatus !== row.status ? { status: nextStatus } : {}),
      lastModifiedBy: currentEditor,
    };
    await sbUpdateTicketPart(row.id, nextRow as any);
    setPartRows((prev) => prev.map((r) => (r.id === row.id ? nextRow : r)));

    appendAuditEntry({
      by: options.silent ? "Auto-sync (Marcone)" : currentEditor,
      action: options.silent ? "Auto-synced from Marcone" : "Refreshed from Marcone",
      field: "Part Transaction",
      before: `${row.partNo} - Status: ${row.status} - ETA: ${row.eta || "—"} - Tracking: ${row.inTracking || "—"} - Invoice: ${row.invoiceNo || "—"}`,
      after: `${row.partNo} - Status: ${nextStatus} - ETA: ${info.eta || row.eta || "—"} - Tracking: ${info.trackingNumbers || row.inTracking || "—"} - Invoice: ${info.invoiceNumber || row.invoiceNo || "—"}`,
    });

    if (!options.silent) {
      const updates: string[] = [];
      if (info.eta) updates.push(`ETA: ${info.eta}`);
      if (info.invoiceNumber) updates.push(`Invoice #: ${info.invoiceNumber}`);
      if (info.trackingNumbers) updates.push(`Tracking: ${info.trackingNumbers}`);
      if (nextStatus !== row.status) updates.push(`Status: ${nextStatus}`);
      alert(`Refreshed from Marcone order ${info.orderNumber || row.orderNo}:\n${updates.join("\n")}`);
    }
    return true;
  };

  const refreshMarconeOrderStatus = async (row: PartTransactionRow) => {
    if (!row.orderNo?.trim()) {
      alert("This part has no Marcone Order # to refresh.");
      return;
    }
    if (!isMarconeDist(row.partDist)) {
      alert("Refresh from Marcone is only available for Marcone parts.");
      return;
    }
    setMarconeRefreshingId(row.id);
    try {
      await syncMarconeOrderStatus(row, { silent: false });
    } catch (err) {
      alert(`Failed to refresh from Marcone: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setMarconeRefreshingId(null);
    }
  };

  // ── Inline row edit helpers ──
  // Each saved part row renders as inputs/selects driven by the row + any
  // pending edits in rowEdits[rowId]. updateRowField() buffers a change;
  // saveAllRowEdits() flushes everything to Supabase + state + audit log
  // when the user clicks Update.
  const getRowValue = <K extends keyof PartTransactionRow>(row: PartTransactionRow, field: K): PartTransactionRow[K] => {
    const patch = rowEdits[row.id];
    if (patch && field in patch) return patch[field] as PartTransactionRow[K];
    return row[field];
  };
  const updateRowField = <K extends keyof PartTransactionRow>(rowId: string, field: K, value: PartTransactionRow[K]) => {
    if (partsEditDisabled) {
      const row = partRows.find((r) => r.id === rowId) ?? null;
      void notifyUnauthorizedPartEdit(row);
      return;
    }
    setRowEdits((prev) => {
      const existingPatch = prev[rowId] ?? {};
      const original = partRows.find((r) => r.id === rowId);
      // If the user types back the original value, drop the patch entry
      // so the Update button reflects "nothing to save".
      if (original && original[field] === value) {
        const { [field]: _omit, ...rest } = existingPatch;
        if (Object.keys(rest).length === 0) {
          const { [rowId]: _omitRow, ...remaining } = prev;
          return remaining;
        }
        return { ...prev, [rowId]: rest };
      }
      return { ...prev, [rowId]: { ...existingPatch, [field]: value } };
    });
  };
  const dirtyRowCount = Object.keys(rowEdits).length;

  const saveAllRowEdits = async () => {
    if (partsEditDisabled) {
      alert(`Parts are locked because this ticket is "${ticket?.status}". Only Parts / Claims / Admin / Manager / Branch Manager roles can edit them.`);
      return;
    }
    if (dirtyRowCount === 0) {
      alert("Nothing to update. Type a change in any cell first.");
      return;
    }
    setRowEditsSaving(true);
    try {
      const merged: Array<{ before: PartTransactionRow; after: PartTransactionRow }> = [];
      for (const [rowId, patch] of Object.entries(rowEdits)) {
        const before = partRows.find((r) => r.id === rowId);
        if (!before) continue;
        const after: PartTransactionRow = {
          ...before,
          ...patch,
          lastModifiedBy: currentEditor,
        };
        await sbUpdateTicketPart(rowId, after as any);
        merged.push({ before, after });
      }

      // Apply locally + audit each row's changes field-by-field.
      setPartRows((prev) =>
        prev.map((r) => merged.find((m) => m.after.id === r.id)?.after ?? r),
      );
      for (const { before, after } of merged) {
        for (const key of Object.keys(rowEdits[after.id] ?? {})) {
          const fieldKey = key as keyof PartTransactionRow;
          // PART_FIELD_LABELS doesn't index id / createdBy / lastModifiedBy
          // but row edits never touch those; safe to cast for the lookup.
          const label = (PART_FIELD_LABELS as Record<string, string>)[String(key)] ?? String(key);
          appendAuditEntry({
            by: currentEditor,
            action: "Updated part transaction",
            field: label,
            before: formatAuditValue(before[fieldKey]),
            after: formatAuditValue(after[fieldKey]),
          });
        }
      }
      setRowEdits({});
    } catch (err) {
      alert(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRowEditsSaving(false);
    }
  };

  // ── Auto-poll Marcone every 15 minutes ────────────────────────────────
  // Iterates over the ticket's parts and silently syncs each Marcone
  // order that's still in flight (PO Made / Back Order). Rows that are
  // already Used / Tech Pickup / Cancelled don't get polled — Marcone
  // status no longer drives them. Errors stay in the console; the user
  // is never interrupted.
  //
  // (Auto-poll removed by user request. Refresh is manual-only.)

  const loadPartForEdit = (row: PartTransactionRow) => {
    if (partsEditDisabled) {
      alert(`Parts are locked because this ticket is "${ticket?.status}". Only Parts / Claims / Admin / Manager / Branch Manager roles can edit them.`);
      void notifyUnauthorizedPartEdit(row);
      return;
    }
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

  const savePartRow = async () => {
    // Friendly validation — alert which required fields are missing so the
    // user knows what to fill instead of getting a silent no-op. Part
    // Status used to require Visit ID too, but that blocks brand-new
    // tickets that have no visit yet; we now treat Visit ID as optional.
    const missing: string[] = [];
    if (!partDraft.partNo.trim()) missing.push("Part No");
    if (!partDraft.partDist.trim()) missing.push("Part Dist.");
    if (!partDraft.quantity.trim()) missing.push("Qty");
    if (!partDraft.status.trim()) missing.push("Part Status");
    if (missing.length > 0) {
      alert(`Please fill: ${missing.join(", ")}.`);
      return;
    }

    // Lock gate — only Claims (or Naveen) can touch parts once the ticket is
    // Claimed / Data Closed. Anyone else gets blocked + a notification fires.
    if (partsEditDisabled) {
      const existing = editingPartId ? partRows.find((r) => r.id === editingPartId) ?? null : null;
      alert(`Parts are locked because this ticket is "${ticket?.status}". Only Parts / Claims / Admin / Manager / Branch Manager roles can edit them.`);
      void notifyUnauthorizedPartEdit(existing);
      return;
    }

    const rowId = editingPartId ?? (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`);

    const totalMarkup = partDraft.totalMarkup.trim() || [partDraft.partPrice, partDraft.markup]
      .filter((value) => value.trim())
      .join(" + ");

    // Auto-set status to "PO Made" if PO number is provided and status is not already set or is "Need PO"
    let finalStatus = partDraft.status.trim();
    if (partDraft.poNo.trim() && (!finalStatus || finalStatus === 'Need PO')) {
      finalStatus = 'PO Made';
    }

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
      status: finalStatus,
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

    // Persist to Supabase
    try {
      if (editingPartId) {
        await sbUpdateTicketPart(editingPartId, nextRow as any);
      } else {
        const saved = await sbAddTicketPart(ticketNo, nextRow as any);
        nextRow.id = saved.id; // adopt DB-generated id
      }
    } catch (err) {
      console.error("Failed to save part:", err);
      alert(`Failed to save part: ${err instanceof Error ? err.message : "Unknown error"}`);
      return;
    }

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

    // Auto-create/update PO in PO Management when part has "Need PO" status or becomes ordered
    if (nextRow.status === "Need PO" || nextRow.status === "PO Made" || nextRow.poNo.trim()) {
      const partOrder = createPartOrderFromTicket(ticketNo, nextRow);
      await savePartOrder(partOrder);
    }

    clearPartForm();
  };

  const deletePartRow = async (rowId: string) => {
    if (partsEditDisabled) {
      const row = partRows.find((r) => r.id === rowId) ?? null;
      alert(`Parts are locked because this ticket is "${ticket?.status}". Only the Claims department can delete them.`);
      void notifyUnauthorizedPartEdit(row);
      return;
    }
    if (!confirm("Remove this part transaction?")) return;

    const rowToDelete = partRows.find((row) => row.id === rowId) ?? null;
    try {
      await sbDeleteTicketPart(rowId);
    } catch (err) {
      console.error("Failed to delete part:", err);
      alert(`Failed to delete part: ${err instanceof Error ? err.message : "Unknown error"}`);
      return;
    }
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

  // ---- Claim Transaction helpers -----------------------------------------
  const newClaimId = () =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

  const addClaimTransactionRow = () => {
    setClaimRows((rows) => [
      ...rows,
      {
        id: newClaimId(),
        claimTo: "",
        visitLogId: "",
        claimNo: "",
        claimDate: new Date().toISOString().slice(0, 10),
        claimStatus: "",
        laborFee: "",
        partFee: "",
        diagnoseFee: "",
        shippingFee: "",
        extraMileFee: "",
        otherFee: "",
        taxFee: "",
        totalFee: "",
        paymentMethod: "",
        mileage: "",
        ccLast4: "",
        note: "",
      },
    ]);
    appendAuditEntry({
      by: currentEditor,
      action: "Added claim transaction",
      field: "Claim Transaction",
      before: "—",
      after: "Blank claim row created",
    });
  };

  const updateClaimRow = (
    id: string,
    field: keyof Omit<ClaimTransactionRow, "id">,
    value: string,
  ) => {
    setClaimRows((rows) =>
      rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    );
  };

  const deleteClaimRow = (id: string) => {
    if (!confirm("Remove this claim transaction row?")) return;
    setClaimRows((rows) => rows.filter((row) => row.id !== id));
    appendAuditEntry({
      by: currentEditor,
      action: "Deleted claim transaction",
      field: "Claim Transaction",
      before: "Row removed",
      after: "—",
    });
  };

  // ── Inline Claim draft (mirror of partDraft pattern) ─────────────────────
  const updateClaimDraftField = (
    field: keyof Omit<ClaimTransactionRow, "id">,
    value: string,
  ) => {
    setClaimDraft((d) => ({ ...d, [field]: value }));
  };

  const clearClaimDraft = () => {
    setEditingClaimId(null);
    setClaimDraft(createEmptyClaimDraft());
  };

  const saveClaimDraft = () => {
    if (!claimDraft.claimTo.trim() || !claimDraft.claimNo.trim()) {
      alert("Claim To and Claim # are required.");
      return;
    }
    if (editingClaimId) {
      const before = claimRows.find((r) => r.id === editingClaimId);
      setClaimRows((rows) =>
        rows.map((r) => (r.id === editingClaimId ? { ...claimDraft, id: editingClaimId } : r)),
      );
      appendAuditEntry({
        by: currentEditor,
        action: "Updated claim transaction",
        field: "Claim Transaction",
        before: before ? `${before.claimTo} #${before.claimNo}` : "—",
        after: `${claimDraft.claimTo} #${claimDraft.claimNo}`,
      });
    } else {
      const id = newClaimId();
      setClaimRows((rows) => [...rows, { ...claimDraft, id }]);
      appendAuditEntry({
        by: currentEditor,
        action: "Added claim transaction",
        field: "Claim Transaction",
        before: "—",
        after: `${claimDraft.claimTo} #${claimDraft.claimNo}`,
      });
    }
    clearClaimDraft();
  };

  const loadClaimForEdit = (row: ClaimTransactionRow) => {
    setEditingClaimId(row.id);
    const { id: _id, ...rest } = row;
    setClaimDraft(rest);
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

  // ── Share ticket via Internal Messenger ────────────────────────────────────
  // Open a small modal, type a teammate's name (or pick from suggestions),
  // and DM them the ticket number.
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareQuery, setShareQuery] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [shareContacts, setShareContacts] = useState<Array<{ id: string; display_name: string | null; email: string | null; role: string | null }>>([]);
  const [shareSending, setShareSending] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  // Lazy-load colleagues once the modal opens.
  useEffect(() => {
    if (!isShareModalOpen || shareContacts.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const { getCompanyUsers } = await import("@/lib/supabase/users");
        const rows = await getCompanyUsers();
        if (!cancelled) setShareContacts(rows as any);
      } catch (err) {
        if (!cancelled) setShareError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [isShareModalOpen, shareContacts.length]);

  // Resolve the typed name to a contact. Exact match first, then a single
  // case-insensitive prefix match. Returns null if nothing or ambiguous.
  const resolveShareContact = (raw: string) => {
    const q = raw.trim().toLowerCase();
    if (!q) return null;
    const exact = shareContacts.find(
      (c) => (c.display_name ?? "").trim().toLowerCase() === q ||
             (c.email ?? "").trim().toLowerCase() === q,
    );
    if (exact) return exact;
    const matches = shareContacts.filter(
      (c) => `${c.display_name ?? ""} ${c.email ?? ""}`.toLowerCase().includes(q),
    );
    return matches.length === 1 ? matches[0] : null;
  };

  const filteredShareContacts = useMemo(() => {
    const q = shareQuery.trim().toLowerCase();
    if (!q) return [];
    return shareContacts.filter(
      (c) => `${c.display_name ?? ""} ${c.email ?? ""}`.toLowerCase().includes(q),
    ).slice(0, 6);
  }, [shareContacts, shareQuery]);

  const sendTicketToContact = async (contact: { id: string; display_name: string | null; email: string | null }) => {
    if (!ticket || !uid) return;
    setShareSending(true);
    setShareError(null);
    try {
      const { getMyProfileId } = await import("@/lib/supabase/users");
      const { getOrCreateDmThread, sendMessage } = await import("@/lib/supabase/messaging");
      const myProfileId = await getMyProfileId(uid);
      if (!myProfileId) throw new Error("Your profile isn't linked yet — open Team Messenger once and try again.");
      const thread = await getOrCreateDmThread(myProfileId, contact.id);
      // Compose: optional note + the ticket reference. MessageBody linkifies
      // `#TICKET` to a clickable link on the recipient's side. The note (if
      // present) goes first so it reads like "Please check on this: #XYZ".
      const note = shareMessage.trim();
      const body = note ? `${note}\n\n#${ticket.ticketNo}` : `#${ticket.ticketNo}`;
      await sendMessage({
        channelId: null,
        dmThreadId: thread.id,
        senderId: myProfileId,
        senderName: currentUserName || currentUserEmail || "User",
        body,
      });
      appendAuditEntry({
        by: currentEditor,
        action: "Shared ticket via messenger",
        field: "Ticket",
        before: "—",
        after: `Sent to ${contact.display_name || contact.email || contact.id}${note ? " with note" : ""}`,
      });
      setIsShareModalOpen(false);
      setShareQuery("");
      setShareMessage("");
      alert(`Ticket sent to ${contact.display_name || contact.email}.`);
    } catch (err) {
      console.error("sendTicketToContact failed:", err);
      setShareError(err instanceof Error ? err.message : String(err));
    } finally {
      setShareSending(false);
    }
  };

  const handleShareSubmit = () => {
    const target = resolveShareContact(shareQuery);
    if (!target) {
      setShareError(
        shareContacts.length === 0
          ? "Teammate list still loading…"
          : "No teammate matches that name. Pick a suggestion or type the exact name."
      );
      return;
    }
    void sendTicketToContact(target);
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

  // Editable Part Transaction rows used both at the top of the table (Add
  // mode) and inline in place of a saved row (Edit mode). Keeping it as one
  // chunk lets us reuse the same inputs without duplication; rendering it in
  // place keeps the user's scroll position when they click Edit on a row
  // far down the page.
  const renderPartDraftRows = () => (
    <>
      <tr className="bg-slate-900/60 align-top">
        <td className="px-2 py-1.5 text-slate-500 w-10" rowSpan={2}></td>
        <td className="px-1 py-1.5">
          <div className="flex gap-1">
            <input value={partDraft.partNo} onChange={(e) => setPartDraft((d) => ({ ...d, partNo: e.target.value }))} className="flex-1 min-w-0 rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="Part No*" />
            <button
              type="button"
              onClick={handleMarconeLookup}
              disabled={marconeLookupBusy || partsEditDisabled || !partDraft.partNo.trim() || !partDraft.partDist.trim()}
              title={
                !partDraft.partDist.trim()
                  ? "Pick Part Dist. first"
                  : !partDraft.partNo.trim()
                  ? "Enter a Part No first"
                  : "Look up part on Marcone (autofill description, price, stock)"
              }
              className="shrink-0 rounded border border-amber-400/40 bg-amber-500/15 px-2 py-1 text-[10px] font-semibold text-amber-200 hover:bg-amber-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {marconeLookupBusy ? "…" : "Lookup"}
            </button>
          </div>
          {marconeLookupMsg ? (
            <div className={`mt-1 text-[10px] ${marconeLookupMsg.kind === "ok" ? "text-emerald-300" : "text-rose-300"}`}>
              {marconeLookupMsg.text}
            </div>
          ) : null}
        </td>
        <td className="px-1 py-1.5">
          <select value={partDraft.partDist} onChange={(e) => setPartDraft((d) => ({ ...d, partDist: e.target.value }))} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500">
            <option value="">Dist.*</option>
            {/* In-house transfer values like "In-House (Asheville)" are
                stamped by the Use in-house button on the Marcone Lookup
                result — render the current draft value as an option so
                the select doesn't fall back to blank. */}
            {partDraft.partDist.startsWith("In-House (") ? (
              <option value={partDraft.partDist}>{partDraft.partDist}</option>
            ) : null}
            <option>AIG</option>
            <option>Electrolux</option>
            <option>Encompass</option>
            <option>Encompass-Birmingham / Montgomery</option>
            <option>GE</option>
            <option>LG</option>
            <option>Marcone- Birmingham / Montgomery</option>
            <option>Marcone-162468</option>
            <option>Midea</option>
            <option>Miele</option>
            <option>NSA</option>
            <option>OW</option>
            <option>SB</option>
            <option>Sharp</option>
            <option>SP</option>
            <option>Squaretrade</option>
            <option>SS</option>
          </select>
        </td>
        <td className="px-1 py-1.5">
          <input value={partDraft.partDesc} onChange={(e) => setPartDraft((d) => ({ ...d, partDesc: e.target.value }))} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="Description" />
        </td>
        <td className="px-1 py-1.5">
          <input value={partDraft.poNo} onChange={(e) => setPartDraft((d) => ({ ...d, poNo: e.target.value }))} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="PO No (Auto-gen)" />
        </td>
        <td className="px-1 py-1.5">
          <input type="date" value={partDraft.poDate} onChange={(e) => setPartDraft((d) => ({ ...d, poDate: e.target.value }))} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" title="Auto-populated on PO creation" />
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
          <select value={partDraft.markup || "0"} onChange={(e) => setPartDraft((d) => ({ ...d, markup: e.target.value }))} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500">
            {Array.from({ length: 21 }, (_, i) => i * 5).map((v) => (
              <option key={v} value={String(v)}>{v}%</option>
            ))}
          </select>
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
          <button
            type="button"
            onClick={savePartRow}
            disabled={partsEditDisabled}
            className={`rounded border px-3 py-1 text-xs font-semibold transition ${
              partsEditDisabled
                ? "border-white/10 bg-slate-800 text-slate-500 cursor-not-allowed"
                : "border-blue-400/40 bg-blue-600/30 text-blue-200 hover:bg-blue-600/50"
            }`}
            title={partsEditDisabled ? "Locked: Parts / Claims / Manager roles only" : (editingPartId ? "Update part" : "Add part")}
          >
            {editingPartId ? "Update" : "Add"}
          </button>
          {editingPartId ? (
            <button type="button" onClick={clearPartForm} className="ml-1 rounded border border-white/15 bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition">
              Cancel
            </button>
          ) : null}
        </td>
      </tr>
    </>
  );

  return (
    <>
      <AppHeader />
      {/* Quick-nav rail (hidden under xl). Switches the active tab + scrolls
          tracking sub-section anchors into view. */}
      <TicketSidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <main className="flex-1 bg-slate-950 py-6">
        <div className="max-w-[1600px] mx-auto px-6">
          <div className="bg-white/8 border border-white/15 rounded-xl p-5 text-white backdrop-blur-md">
            <div className="mb-4 flex items-center gap-4">
              <label htmlFor="ticket-selector" className="text-slate-400 font-semibold whitespace-nowrap">Select Ticket:</label>
              <input
                id="ticket-selector"
                type="text"
                value={selectedTicket}
                onChange={handleInputChange}
                onKeyPress={handleKeyPress}
                placeholder="Enter ticket number... (Press Enter)"
                className="bg-slate-900 border border-white/20 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 placeholder-slate-500 w-64"
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
              <button
                type="button"
                onClick={() => setIsShareModalOpen(true)}
                disabled={!ticket}
                title="Send ticket via Internal Messenger"
                aria-label="Send ticket via Internal Messenger"
                className="inline-flex items-center justify-center rounded border border-emerald-400/40 bg-emerald-500/15 p-2 text-emerald-200 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
              </button>
              
              {/* Alert Messages Display - Inline beside controls */}
              {alertMessages.length > 0 && (
                <div className="flex items-center gap-2 flex-1">
                  {alertMessages.slice(0, 1).map((alert) => (
                    <div 
                      key={alert.id} 
                      className="bg-amber-500/30 border-2 border-amber-400/60 rounded px-4 py-2.5 flex items-center gap-3 flex-1 min-w-0 shadow-lg"
                      title={`By ${alert.by} • ${alert.timestamp}`}
                    >
                      <span className="text-amber-200 font-bold text-sm whitespace-nowrap">⚠️ ALERT:</span>
                      <span className="text-white font-semibold text-sm truncate flex-1">{alert.text}</span>
                      <span className="text-amber-200/80 text-xs whitespace-nowrap hidden lg:inline font-medium">
                        {alert.by.split('@')[0]} • {alert.timestamp.split(',')[0]}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeAlertMessage(alert.id)}
                        className="text-amber-200 hover:text-white transition text-sm font-bold whitespace-nowrap ml-2 hover:scale-110"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {alertMessages.length > 1 && (
                    <span className="text-amber-300 text-sm font-semibold whitespace-nowrap">+{alertMessages.length - 1} more</span>
                  )}
                </div>
              )}
            </div>
            <div>
              <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold text-white">Ticket #{ticketNo}</h1>
                
                {ticket ? (
                  <div className="text-sm text-slate-300 leading-relaxed">
                    <span className="text-slate-400">Account</span>{" "}
                    {(() => {
                      // Squaretrade tickets jump to the appointment-completion
                      // form so the claims team can close out the repair
                      // without leaving the hub. Every other account still
                      // opens the ServicePower workorders dashboard. Each
                      // Squaretrade ticket carries its own token, so we
                      // resolve the URL per-ticket via squaretradeUrl
                      // (falls back to the Squaretrade landing form when
                      // no token has been saved yet).
                      const accountName = String(ticket.account || "").toLowerCase().replace(/\s+/g, "");
                      const isSquaretrade = accountName.includes("squaretrade");
                      const hasSaved = isSquaretrade && Boolean(squaretradeUrl);
                      // Squaretrade tickets jump straight to that ticket's
                      // Appointment Completion form when we have it. When
                      // we don't, we deep-link to the same work order in
                      // ServicePower HUB — SP's SOAP API doesn't expose
                      // the HUB-only conversation thread that contains
                      // the URL, so landing on the right work order lets
                      // claims read it off HUB and paste it via the
                      // pencil icon.
                      const href = isSquaretrade
                        ? resolveSquaretradeUrl(ticketNo)
                        : `https://hub.servicepower.com/dashboard/workorders/${encodeURIComponent(ticketNo)}`;
                      const title = isSquaretrade
                        ? hasSaved
                          ? "Open this ticket's Squaretrade appointment completion form in a new tab"
                          : "Opens this work order in ServicePower HUB so you can read the Appointment Completion URL and paste it back here via the pencil icon."
                        : "Open this work order in ServicePower HUB";
                      return (
                        <>
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={title}
                            className="font-semibold text-white underline-offset-2 hover:underline hover:text-blue-300 transition-colors"
                          >
                            {ticket.account}
                          </a>
                          {isSquaretrade && (
                            <button
                              type="button"
                              onClick={() => {
                                setSquaretradeDraft(squaretradeUrl);
                                setSquaretradeEditOpen(true);
                              }}
                              title={hasSaved ? "Edit appointment completion URL (auto-synced from ServicePower running notes)" : "Set appointment completion URL for this ticket — usually auto-extracted from ServicePower running notes"}
                              className={`ml-1.5 inline-flex h-5 w-5 items-center justify-center rounded border align-middle transition-colors ${hasSaved ? "border-emerald-400/40 text-emerald-300 hover:bg-emerald-400/10" : "border-amber-400/40 text-amber-300 hover:bg-amber-400/10"}`}
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          )}
                        </>
                      );
                    })()}
                    <span className="mx-3 text-slate-600">•</span>
                    <span className="text-slate-400">Warranty</span> <span className="font-semibold text-white">{warrantyAcronym(ticket.warrantyType) }</span>
                    <span className="mx-3 text-slate-600">•</span>
                    <span className="text-slate-400">Status</span> <span className="font-semibold text-blue-300">{ticket.status}</span>
                    <span className="mx-3 text-slate-600">•</span>
                    <span className="text-slate-400">Product</span> <span className="font-semibold text-white">{ticket.productCategory || ticket.product}</span>
                    <span className="mx-3 text-slate-600">•</span>
                    <span className="text-slate-400">TAT</span> <span className="font-semibold text-white">{ticket.tat}</span>
                    <span className="mx-3 text-slate-600">•</span>
                    <span className="text-slate-400">Schedule</span> <span className="font-semibold text-white">{ticket.scheduleDate}</span>
                    <span className="mx-3 text-slate-600">•</span>
                    {/* Tier (Assurant / GE / Miele only) — derived from the
                        customer ZIP + warranty company. Shows the tier
                        code by itself (no dollar amount); "Base" / no
                        match renders as N/A so the ribbon stays clean. */}
                    {(() => {
                      const tier = resolveTierCode(ticket.account, ticket.zip, ticket.accountNo);
                      const display = tier && tier.code && tier.code.toLowerCase() !== "base"
                        ? tier.code
                        : "N/A";
                      return (
                        <>
                          <span className="text-slate-400">Tier</span>{" "}
                          <span className="font-semibold text-white">{display}</span>
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                    No ticket data is available for this number yet.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Tabs replaced by the floating TicketSidebar — kept here as a
            comment marker so it's clear the navigation lives on the rail.

            But the rail is hidden under md (<768px) where it would overlap
            the body. So phone users get a horizontal tab strip in its
            place that switches the same four sections. */}
        <div className="md:hidden sticky top-[64px] z-10 -mx-1 px-1 pb-2">
          <div className="overflow-x-auto">
            <div className="flex gap-1 rounded-lg border border-white/10 bg-slate-900/85 backdrop-blur-md p-1 shadow-sm shadow-blue-900/20 w-max">
              {([
                { tab: "general", label: "General" },
                { tab: "tracking", label: "Tracking" },
                { tab: "compensation", label: "Compensation" },
                { tab: "billing", label: "Billing" },
              ] as const).map(({ tab, label }) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    activeTab === tab
                      ? "bg-blue-500/25 text-white border border-blue-400/40"
                      : "text-slate-300 hover:bg-white/8 hover:text-white border border-transparent"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="max-w-[1600px] mx-auto px-6 py-6">
        {!ticket ? (
          <div className="rounded-lg border border-white/10 bg-slate-900/50 p-6 text-slate-300">
            <p className="text-lg font-semibold text-white">Ticket not found</p>
            <p className="mt-2 text-sm text-slate-400">
              The ticket number {ticketNo} does not have a matching record in the current sample data.
            </p>
          </div>
        ) : activeTab === "general" && (
          <div className="space-y-8">
            {/* General Information */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-semibold text-blue-400">General Information</h3>
                  <div className="flex items-center gap-2">
                    <a
                      href="/m/tickets/work-map"
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open Work Map"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/15 bg-slate-800 text-slate-200 transition hover:border-blue-400/50 hover:text-blue-300"
                    >
                      <MapIcon className="h-4 w-4" />
                    </a>
                    <a
                      href="/m/tickets/work-planner"
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open Daily Schedule"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/15 bg-slate-800 text-slate-200 transition hover:border-blue-400/50 hover:text-blue-300"
                    >
                      <CalendarDays className="h-4 w-4" />
                    </a>
                    <span
                      className="text-xs font-semibold text-slate-300"
                      title="Driving distance from office to customer"
                    >
                      {officeDistanceMiles != null ? `${officeDistanceMiles.toFixed(1)} mi` : "— mi"}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  {!isEditingCustomerInfo ? (
                    <button
                      onClick={startEditingCustomerInfo}
                      className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
                    >
                      Edit Customer Info
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={saveCustomerInfo}
                        className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold transition-colors"
                      >
                        Save
                      </button>
                      <button
                        onClick={cancelEditingCustomerInfo}
                        className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold transition-colors"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Customer Information - Prominent Display */}
              <div className="space-y-4 mb-8 rounded-lg border border-blue-500/30 bg-blue-900/20 p-4">
                <h4 className="font-semibold text-slate-300 text-sm">Customer</h4>
                {!isEditingCustomerInfo ? (
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <div className="text-slate-500 font-semibold text-xs">Name</div>
                      <div className="text-white font-semibold mt-1">{ticket.firstName} {ticket.lastName}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 font-semibold text-xs">Phone</div>
                      <div className="text-white font-semibold mt-1">{ticket.homePhone || ticket.cellPhone || "—"}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 font-semibold text-xs">Location</div>
                      <div className="text-white font-semibold mt-1">{ticket.location || ticket.city || "—"}</div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    {/* Name is intentionally read-only — only address fields
                        and phone numbers may be edited from the ticket page. */}
                    <div className="col-span-2">
                      <label className="text-slate-500 font-semibold text-xs block mb-1">Name <span className="ml-1 text-[10px] uppercase tracking-wide text-slate-600">read-only</span></label>
                      <div className="px-3 py-2 rounded bg-slate-900/60 border border-slate-700 text-slate-300 text-sm">
                        {ticket.firstName} {ticket.lastName}
                      </div>
                    </div>
                    <div>
                      <label className="text-slate-500 font-semibold text-xs block mb-1">City</label>
                      <input
                        type="text"
                        value={editedCustomerInfo.city || ""}
                        onChange={(e) => setEditedCustomerInfo({ ...editedCustomerInfo, city: e.target.value })}
                        className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-400"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Remaining Customer Details */}
              <div className="space-y-4 mb-8">
                <h4 className="font-semibold text-slate-300">Contact Details</h4>
                {!isEditingCustomerInfo ? (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <label className="text-slate-500 font-semibold">Address</label>
                      <div className="text-white mt-1">{ticket.address}</div>
                    </div>
                    <div>
                      <label className="text-slate-500 font-semibold">Address 2</label>
                      <div className="text-white mt-1">{ticket.address2 || "—"}</div>
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
                    <div>
                      <label className="text-slate-500 font-semibold">Alternate Phone</label>
                      <div className="text-white mt-1">{ticket.altPhone || "—"}</div>
                    </div>
                    <div>
                      <label className="text-slate-500 font-semibold">Email</label>
                      <div className="text-white mt-1">{ticket.email}</div>
                    </div>
                    {/* Tier Code — derived from warranty company + customer
                        ZIP. Shows the tier code only (no dollar amount);
                        "Base" / no match renders as N/A. */}
                    {(() => {
                      const tier = resolveTierCode(ticket.account, ticket.zip, ticket.accountNo);
                      const display = tier && tier.code && tier.code.toLowerCase() !== "base"
                        ? tier.code
                        : "N/A";
                      const showCompany = tier && display !== "N/A";
                      return (
                        <div>
                          <label className="text-slate-500 font-semibold">Tier Code</label>
                          <div className="text-white mt-1">
                            {display}
                            {showCompany ? (
                              <span className="ml-2 text-xs font-normal text-slate-400">({tier.company})</span>
                            ) : null}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <label className="text-slate-500 font-semibold block mb-1">Address</label>
                      <input
                        type="text"
                        value={editedCustomerInfo.address || ""}
                        onChange={(e) => setEditedCustomerInfo({ ...editedCustomerInfo, address: e.target.value })}
                        className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-400"
                      />
                    </div>
                    <div>
                      <label className="text-slate-500 font-semibold block mb-1">Address 2</label>
                      <input
                        type="text"
                        value={editedCustomerInfo.address2 || ""}
                        onChange={(e) => setEditedCustomerInfo({ ...editedCustomerInfo, address2: e.target.value })}
                        className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-400"
                      />
                    </div>
                    <div>
                      <label className="text-slate-500 font-semibold block mb-1">State</label>
                      <input
                        type="text"
                        value={editedCustomerInfo.state || ""}
                        onChange={(e) => setEditedCustomerInfo({ ...editedCustomerInfo, state: e.target.value })}
                        className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-400"
                      />
                    </div>
                    <div>
                      <label className="text-slate-500 font-semibold block mb-1">Zip Code</label>
                      <input
                        type="text"
                        value={editedCustomerInfo.zip || ""}
                        onChange={(e) => setEditedCustomerInfo({ ...editedCustomerInfo, zip: e.target.value })}
                        className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-400"
                      />
                    </div>
                    <div>
                      <label className="text-slate-500 font-semibold block mb-1">Home Phone</label>
                      <input
                        type="tel"
                        value={editedCustomerInfo.homePhone || ""}
                        onChange={(e) => setEditedCustomerInfo({ ...editedCustomerInfo, homePhone: e.target.value })}
                        className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-400"
                      />
                    </div>
                    <div>
                      <label className="text-slate-500 font-semibold block mb-1">Cell Phone</label>
                      <input
                        type="tel"
                        value={editedCustomerInfo.cellPhone || ""}
                        onChange={(e) => setEditedCustomerInfo({ ...editedCustomerInfo, cellPhone: e.target.value })}
                        className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-400"
                      />
                    </div>
                    <div>
                      <label className="text-slate-500 font-semibold block mb-1">Alternate Phone</label>
                      <input
                        type="tel"
                        value={editedCustomerInfo.altPhone || ""}
                        onChange={(e) => setEditedCustomerInfo({ ...editedCustomerInfo, altPhone: e.target.value })}
                        placeholder="Optional"
                        className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-400"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="text-slate-500 font-semibold block mb-1">Email <span className="ml-1 text-[10px] uppercase tracking-wide text-slate-600">read-only</span></label>
                      <div className="px-3 py-2 rounded bg-slate-900/60 border border-slate-700 text-slate-300 text-sm">
                        {ticket.email || "—"}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Product Information */}
              <div className="space-y-4 mb-8">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h4 className="font-semibold text-slate-300">Product Information</h4>
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Per-model reference links — synced across every ticket
                        sharing this model number. Saving here updates them
                        for all matching tickets at once. */}
                    <ModelResourceButton
                      label="Exploded View"
                      url={modelResources.explodedViewUrl}
                      onEdit={() => setModelResourceModal({ kind: "exploded", value: modelResources.explodedViewUrl })}
                    />
                    <ModelResourceButton
                      label="Service Bulletin"
                      url={modelResources.serviceBulletinUrl}
                      onEdit={() => setModelResourceModal({ kind: "bulletin", value: modelResources.serviceBulletinUrl })}
                    />
                    {!isEditingProductInfo ? (
                      <button
                        onClick={startEditingProductInfo}
                        className="px-3 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 text-xs font-semibold transition-colors border border-blue-500/30"
                      >
                        Edit Product Info
                      </button>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          onClick={saveProductInfo}
                          className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold transition-colors"
                        >
                          Save
                        </button>
                        <button
                          onClick={cancelEditingProductInfo}
                          className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {!isEditingProductInfo ? (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <label className="text-slate-500 font-semibold">Brand</label>
                      <div className="text-white mt-1">{ticket.brand || "—"}</div>
                    </div>
                    <div>
                      <label className="text-slate-500 font-semibold">Model Code</label>
                      <div className="text-white mt-1">{ticket.model || "—"}</div>
                    </div>
                    <div>
                      <label className="text-slate-500 font-semibold">Serial No</label>
                      <div className="text-white mt-1">{ticket.serialNo || "—"}</div>
                    </div>
                    <div>
                      <label className="text-slate-500 font-semibold">Model Version</label>
                      <div className="text-white mt-1">{ticket.modelVersion || "—"}</div>
                    </div>
                    <div>
                      <label className="text-slate-500 font-semibold">Redo Ticket #</label>
                      <div className="text-white mt-1">{ticket.redoTicketNo || "NONE"}</div>
                    </div>
                    <div>
                      <label className="text-slate-500 font-semibold">Product Category</label>
                      <div className="text-white mt-1">{ticket.productCategory || "—"}</div>
                    </div>
                    <div>
                      <label className="text-slate-500 font-semibold">Purchase Date</label>
                      <div className="text-white mt-1">{ticket.purchaseDate || "—"}</div>
                    </div>
                    <div>
                      <label className="text-slate-500 font-semibold">Warranty Type</label>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-white">{ticket.warrantyType || "—"}</span>
                        {ticket.serviceContract ? (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30" title="Synced from ServicePower">
                            {ticket.serviceContract}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="col-span-2">
                      <label className="text-slate-500 font-semibold">Claim Company</label>
                      <div className="text-white mt-1">{ticket.claimCompany || "—"}</div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <label className="text-slate-400 font-semibold text-xs mb-1 block">Brand</label>
                      <input
                        type="text"
                        value={editedProductInfo.brand || ""}
                        onChange={(e) => setEditedProductInfo({ ...editedProductInfo, brand: e.target.value })}
                        className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-400"
                      />
                    </div>
                    <div>
                      <label className="text-slate-400 font-semibold text-xs mb-1 block">Model Code</label>
                      <input
                        type="text"
                        value={editedProductInfo.model || ""}
                        onChange={(e) => setEditedProductInfo({ ...editedProductInfo, model: e.target.value })}
                        className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-400"
                      />
                    </div>
                    <div>
                      <label className="text-slate-400 font-semibold text-xs mb-1 block">Serial No</label>
                      <input
                        type="text"
                        value={editedProductInfo.serialNo || ""}
                        onChange={(e) => setEditedProductInfo({ ...editedProductInfo, serialNo: e.target.value })}
                        className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-400"
                      />
                    </div>
                    <div>
                      <label className="text-slate-400 font-semibold text-xs mb-1 block">Model Version</label>
                      <input
                        type="text"
                        value={editedProductInfo.modelVersion ?? ""}
                        onChange={(e) => setEditedProductInfo({ ...editedProductInfo, modelVersion: e.target.value })}
                        className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-400"
                      />
                    </div>
                    <div>
                      <label className="text-slate-400 font-semibold text-xs mb-1 block">Redo Ticket #</label>
                      <input
                        type="text"
                        value={editedProductInfo.redoTicketNo ?? ""}
                        onChange={(e) => setEditedProductInfo({ ...editedProductInfo, redoTicketNo: e.target.value })}
                        className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-400"
                      />
                    </div>
                    <div>
                      <label className="text-slate-400 font-semibold text-xs mb-1 block">Product Category</label>
                      <select
                        value={editedProductInfo.productCategory || ""}
                        onChange={(e) => setEditedProductInfo({ ...editedProductInfo, productCategory: e.target.value })}
                        className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-400"
                      >
                        <option value="">(product category)</option>
                        {PRODUCT_CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-slate-400 font-semibold text-xs mb-1 block">Purchase Date</label>
                      <input
                        type="text"
                        value={editedProductInfo.purchaseDate || ""}
                        onChange={(e) => setEditedProductInfo({ ...editedProductInfo, purchaseDate: e.target.value })}
                        className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-400"
                      />
                    </div>
                    <div>
                      <label className="text-slate-400 font-semibold text-xs mb-1 block">Warranty Type</label>
                      <div className="flex items-center gap-2">
                        <select
                          value={editedProductInfo.warrantyType || ""}
                          onChange={(e) => setEditedProductInfo({ ...editedProductInfo, warrantyType: e.target.value })}
                          className="flex-1 px-3 py-2 rounded bg-slate-800 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-400"
                        >
                          <option value="">(warranty type)</option>
                          {WARRANTY_TYPE_OPTIONS.map((w) => <option key={w} value={w}>{w}</option>)}
                        </select>
                        {ticket.serviceContract ? (
                          <span className="shrink-0 text-xs font-semibold px-2 py-1 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30" title="Service Contract — synced from ServicePower (read-only)">
                            {ticket.serviceContract}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="col-span-2">
                      <label className="text-slate-400 font-semibold text-xs mb-1 block">Claim Company</label>
                      <select
                        value={editedProductInfo.claimCompany || ""}
                        onChange={(e) => setEditedProductInfo({ ...editedProductInfo, claimCompany: e.target.value })}
                        className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-400"
                      >
                        <option value="">(claim company)</option>
                        {CLAIM_COMPANY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* Call Service Information */}
              <div className="space-y-4 mb-8">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h4 className="font-semibold text-slate-300">Call Service Information</h4>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSendSpStatus}
                      disabled={spStatusSending || !spStatus}
                      className="px-3 py-2 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 disabled:opacity-50 disabled:cursor-not-allowed text-blue-300 text-xs font-semibold transition-colors border border-blue-500/30 whitespace-nowrap"
                    >
                      {spStatusSending ? "Sending…" : "Update Status"}
                    </button>
                    <select
                      value={spStatus}
                      onChange={(e) => setSpStatus(e.target.value)}
                      className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white text-xs focus:outline-none focus:border-blue-400"
                    >
                      <option value="">Send SP status…</option>
                      <option value="ACCEPTED">ACCEPTED</option>
                      <option value="APPOINTMENT SCHEDULED">APPOINTMENT SCHEDULED</option>
                      <option value="COMPLETED">COMPLETED</option>
                      <option value="CONTACTED">CONTACTED</option>
                      <option value="DIAGNOSED">DIAGNOSED</option>
                      <option value="JOB COMPLETED">JOB COMPLETED</option>
                      <option value="RECEIVED">RECEIVED</option>
                      <option value="REJECT">REJECT</option>
                      <option value="SECOND TRUCK ROLL">SECOND TRUCK ROLL</option>
                      <option value="SHIPPED">SHIPPED</option>
                      <option value="WAITING ON APPROVAL">WAITING ON APPROVAL</option>
                      <option value="WAITING ON CUSTOMER">WAITING ON CUSTOMER</option>
                      <option value="WAITING ON PARTS">WAITING ON PARTS</option>
                      <option value="WAITING ON TECH ASSISTANCE">WAITING ON TECH ASSISTANCE</option>
                      <option value="WORK IN PROCESS">WORK IN PROCESS</option>
                    </select>
                  </div>
                </div>
                {spCallSyncMsg && (
                  <div className="text-xs px-3 py-2 rounded-lg bg-slate-800/70 border border-slate-600 text-slate-300">
                    {spCallSyncMsg}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <label className="text-slate-500 font-semibold">Account No</label>
                    <div className="text-white mt-1">{ticket.accountNo || "—"}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Manufacture ID</label>
                    <div className="text-white mt-1">{ticket.manufactureId || "—"}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Call No</label>
                    <div className="text-white mt-1">{ticket.callNo || "—"}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Ticket Source</label>
                    <div className="text-white mt-1">{ticket.ticketSource || "—"}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Call Type</label>
                    <div className="text-white mt-1">{ticket.callType || "—"}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Service Type</label>
                    <div className="text-white mt-1">{ticket.serviceType || "—"}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Call Status</label>
                    <div className="text-blue-300 mt-1 font-semibold">{ticket.callStatus || "—"}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Posting Date</label>
                    <div className="text-white mt-1">{ticket.postingDate || "—"}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Repeat Call</label>
                    <div className="text-white mt-1">{ticket.repeatCall || "—"}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Contract #</label>
                    <div className="text-white mt-1">{ticket.contractNo || "—"}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Co-Pay</label>
                    <div className="text-white mt-1">{ticket.copay || "—"}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">PO #</label>
                    <div className="text-white mt-1">{ticket.poNumber || "—"}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">PO Amount</label>
                    <div className="text-white mt-1">{ticket.poAmount || "—"}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Emergency</label>
                    <div className="text-white mt-1">{ticket.emergency || "—"}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Auth No</label>
                    <div className="text-white mt-1">{ticket.authNo || "—"}</div>
                  </div>
                </div>
              </div>

              {/* NSA Dispatch Information — only shown for NSA-sourced tickets */}
              {String(ticket.ticketSource || "").toUpperCase().includes("NSA") && (
                <div className="space-y-4 mb-8">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-slate-300">NSA Dispatch Information</h4>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-500/20 text-orange-300 border border-orange-500/30 uppercase tracking-wider">NSA</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <label className="text-slate-500 font-semibold">Case Number</label>
                      <div className="text-white mt-1">{ticket.nsaCaseNumber || ticket.redoTicketNo || "—"}</div>
                    </div>
                    <div>
                      <label className="text-slate-500 font-semibold">Master Code</label>
                      <div className="text-white mt-1">{ticket.nsaMasterCode || "—"}</div>
                    </div>
                    <div>
                      <label className="text-slate-500 font-semibold">NSA Status</label>
                      <div className="text-orange-300 mt-1 font-semibold capitalize">{ticket.nsaStatus || "—"}</div>
                    </div>
                    <div>
                      <label className="text-slate-500 font-semibold">Route Name</label>
                      <div className="text-white mt-1">{ticket.nsaRouteName || "—"}</div>
                    </div>
                    <div>
                      <label className="text-slate-500 font-semibold">Group Name</label>
                      <div className="text-white mt-1">{ticket.nsaGroupName || "—"}</div>
                    </div>
                    <div>
                      <label className="text-slate-500 font-semibold">Deductible</label>
                      <div className="text-white mt-1">{ticket.nsaDeductible || "—"}</div>
                    </div>
                    <div>
                      <label className="text-slate-500 font-semibold">Schedule ACK</label>
                      <div className="text-white mt-1">{ticket.nsaScheduleAck ? new Date(ticket.nsaScheduleAck).toLocaleString() : "—"}</div>
                    </div>
                    <div>
                      <label className="text-slate-500 font-semibold">Required Part</label>
                      <div className="text-white mt-1">{ticket.nsaRequiredPart === "Y" ? "Yes" : ticket.nsaRequiredPart === "N" ? "No" : ticket.nsaRequiredPart || "—"}</div>
                    </div>
                  </div>
                  {/* Coverage + Pre-Auth full-width rows */}
                  <div className="grid grid-cols-1 gap-3 text-sm">
                    {ticket.nsaValidCoverage && (
                      <div>
                        <label className="text-slate-500 font-semibold">Valid Coverage</label>
                        <div className="text-white mt-1">{ticket.nsaValidCoverage}</div>
                      </div>
                    )}
                    {ticket.nsaRequiredCoverage && (
                      <div>
                        <label className="text-slate-500 font-semibold">Required Coverage</label>
                        <div className="text-white mt-1">{ticket.nsaRequiredCoverage}</div>
                      </div>
                    )}
                    {ticket.nsaPreAuth && (
                      <div>
                        <label className="text-slate-500 font-semibold">Pre-Auth</label>
                        <div className="text-white mt-1 font-mono text-xs bg-slate-800/60 rounded px-2 py-1.5 border border-slate-700">{ticket.nsaPreAuth}</div>
                      </div>
                    )}
                    {ticket.nsaSpecialInstructions && (
                      <div>
                        <label className="text-slate-500 font-semibold">Special Instructions</label>
                        <div className="text-amber-200 mt-1 text-xs bg-amber-950/30 rounded px-2 py-1.5 border border-amber-500/20">{ticket.nsaSpecialInstructions}</div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Schedule Information */}
              <div className="space-y-4 mb-8">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-slate-300">Schedule Information</h4>
                  {!isEditingScheduleInfo ? (
                    <button
                      onClick={() => setIsEditingScheduleInfo(true)}
                      className="px-3 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 text-xs font-semibold transition-colors border border-blue-500/30"
                    >
                      Edit Schedule
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={saveScheduleInfo}
                        className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold transition-colors"
                      >
                        Save
                      </button>
                      <button
                        onClick={cancelEditingScheduleInfo}
                        className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <label className="text-slate-500 font-semibold">Schedule Date (SP)</label>
                    {isEditingScheduleInfo ? (
                      <input
                        type="date"
                        value={editedScheduleInfo.scheduleDate || ticket.scheduleDate}
                        onChange={(e) => setEditedScheduleInfo({ ...editedScheduleInfo, scheduleDate: e.target.value })}
                        className="glass-input w-full mt-1"
                      />
                    ) : (
                      <div className="text-white mt-1">{ticket.scheduleDate || "—"}</div>
                    )}
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Schedule Period</label>
                    {isEditingScheduleInfo ? (
                      <input
                        type="text"
                        value={editedScheduleInfo.schedulePeriod || ticket.schedulePeriod}
                        onChange={(e) => setEditedScheduleInfo({ ...editedScheduleInfo, schedulePeriod: e.target.value })}
                        className="glass-input w-full mt-1"
                        placeholder="AM/PM/Eve"
                      />
                    ) : (
                      <div className="text-white mt-1">{ticket.schedulePeriod}</div>
                    )}
                  </div>
                  <div>
                    {/* Cx Preferred Date mirrors Schedule Date (SP) — they
                        both come from ServicePower's scheduled date. We
                        show them as separate labels because the customer-
                        preferred and SP-assigned date can legitimately
                        differ on rescheduling tickets, but until that
                        diverges they stay in sync read-only. */}
                    <label className="text-slate-500 font-semibold">Cx Preferred Date</label>
                    <div className="text-white mt-1">{ticket.scheduleDate || "—"}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Technician</label>
                    {isEditingScheduleInfo ? (
                      <select
                        value={editedScheduleInfo.technician || ticket.technician}
                        onChange={(e) => setEditedScheduleInfo({ ...editedScheduleInfo, technician: e.target.value })}
                        className="glass-input w-full mt-1"
                      >
                        <option value="">Not assigned</option>
                        {technicianOptions.map((tech) => (
                          <option key={tech} value={tech}>
                            {tech}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="text-white mt-1">{ticket.technician || "Not assigned"}</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Problem Description (read-only — synced from ServicePower) */}
              <div className="space-y-4 mb-8">
                <h4 className="font-semibold text-slate-300">Problem Description</h4>
                <div className="bg-slate-900/50 border border-white/10 rounded p-4 text-sm text-slate-300">
                  {ticket.problemDescription || "—"}
                </div>
              </div>

              {/* Customer Notes — mirrors ServicePower Running Notes so
                  whatever the warranty company (Allstate / Squaretrade /
                  etc.) types on the SP work order shows up here for the
                  technician. Notes auto-load when the ticket opens; the
                  refresh button forces a fresh pull from SP. */}
              <div className="space-y-4 mb-8">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-semibold text-slate-300">Customer Notes</h4>
                  <div className="flex items-center gap-2">
                    {runningNotesLoading && (
                      <span className="text-xs text-slate-400">Syncing from ServicePower…</span>
                    )}
                    <button
                      type="button"
                      onClick={() => void loadRunningNotes()}
                      disabled={runningNotesLoading}
                      className="rounded border border-white/15 px-2 py-1 text-[11px] font-semibold text-slate-200 transition hover:border-white/30 hover:bg-white/5 disabled:opacity-60"
                      title="Re-fetch the Running Notes thread from ServicePower"
                    >
                      Refresh
                    </button>
                  </div>
                </div>
                {runningNotesError && (
                  <div className="rounded border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                    Couldn't sync from ServicePower: {runningNotesError}
                  </div>
                )}
                <div className="space-y-3">
                  {displayedCustomerNotes.length === 0 && !runningNotesLoading && (
                    <p className="text-slate-500 text-sm">No customer notes yet for this work order.</p>
                  )}
                  {displayedCustomerNotes.map((note, idx) => (
                    <div key={idx} className="bg-slate-900/50 border border-white/10 rounded p-4 text-sm">
                      <div className="flex justify-between items-start mb-2">
                        <div className="text-slate-400">{note.date}</div>
                        <div className="text-blue-400">By: {note.by}</div>
                      </div>
                      <p className="text-slate-300 whitespace-pre-wrap">{note.notes}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Servicer Notes */}
              <div className="space-y-4 pb-12">
                <h4 className="font-semibold text-slate-300">Servicer Notes</h4>
                <div className="space-y-3 mb-4">
                  {servicerComments.length === 0 && (
                    <p className="text-slate-500 text-sm">No servicer notes yet.</p>
                  )}
                  {servicerComments.map((note) => (
                    <div key={note.id} className="bg-slate-900/50 border border-blue-500/30 rounded p-4 text-sm">
                      <div className="text-blue-400 text-xs mb-1">
                        By: {note.authorName || "User"}
                        {note.authorRole ? ` · ${note.authorRole}` : ""}
                        {note.createdAt ? ` · ${new Date(note.createdAt).toLocaleString("en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}
                      </div>
                      <p className="text-slate-300">{note.body}</p>
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
            <div id="section-related-tickets" className="scroll-mt-28">
              <h4 className="font-semibold text-slate-300 mb-4">Related Tickets</h4>
              <div className="bg-blue-900/20 border border-blue-500/30 rounded p-3 mb-3 text-sm text-slate-400">
                {relatedTickets.length} distinct record{relatedTickets.length === 1 ? "" : "s"} found
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
                    {relatedTickets.length === 0 ? (
                      <tr>
                        <td colSpan={13} className="px-4 py-6 text-center text-slate-500">
                          No related tickets found.
                        </td>
                      </tr>
                    ) : (
                      relatedTickets.map((t) => (
                        <tr key={t.ticketNo} className="border-b border-white/5 hover:bg-white/5">
                          <td className="px-4 py-3 font-mono text-blue-400">
                            <a href={`/ticket/${t.ticketNo}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
                              {t.ticketNo}
                            </a>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {(t._matched as string[]).map((m) => (
                                <span key={m} className="rounded-full bg-green-500/15 text-green-300 text-xs px-2 py-0.5 whitespace-nowrap">{m}</span>
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-300">{t.ticketSource || t.manufacturer || "—"}</td>
                          <td className="px-4 py-3 text-slate-300">{t.customer || [t.firstName, t.lastName].filter(Boolean).join(" ") || "—"}</td>
                          <td className="px-4 py-3 text-slate-300">{t.zip || "—"}</td>
                          <td className="px-4 py-3 text-slate-300">{t.phone || t.homePhone || "—"}</td>
                          <td className="px-4 py-3 text-slate-300">{t.warranty || t.type || "—"}</td>
                          <td className="px-4 py-3 text-slate-300">{t.schedule || "—"}</td>
                          <td className="px-4 py-3 text-slate-300">{t.status || "—"}</td>
                          <td className="px-4 py-3 text-slate-300">{t.manufacturer || "—"}</td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-300">{t.model || "—"}</td>
                          <td className="px-4 py-3 text-slate-300">{t.technician || "—"}</td>
                          <td className="px-4 py-3 text-slate-300">{t.created || "—"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Attachments / Photos */}
            <div id="section-attachments" className="scroll-mt-28">
              <div className="bg-slate-900/50 border border-white/10 rounded p-4">
                <TicketPhotos
                  ticketNo={ticketNo}
                  category="service"
                  title="Attachments"
                  uploadedBy={currentEditor}
                  visitOptions={Array.from(new Set(visitLogEntries.map((v: any) => String(v.visitNo || "")).filter(Boolean)))}
                />
              </div>
            </div>

            {/* Visit Log */}
            <div id="section-visit-log" className="scroll-mt-28">
              <h4 className="font-semibold text-slate-300 mb-4">Visit Log</h4>
              <div className="space-y-4 text-sm">
                <div>
                  <label className="text-slate-500 font-semibold">Phone</label>
                  <div className="text-white mt-1">{ticket?.homePhone || ticket?.cellPhone || "—"}</div>
                </div>
                <div>
                  <label className="text-slate-500 font-semibold">Chat</label>
                  <button className="text-blue-400 hover:text-blue-300 font-semibold">Open Chat</button>
                </div>
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-slate-500 font-semibold">Redo Ticket #</label>
                    {!editingRedoTicket && (
                      <button
                        type="button"
                        onClick={startEditingRedoTicket}
                        className="rounded-md border border-blue-400/40 bg-blue-500/20 px-2 py-0.5 text-[11px] font-semibold text-blue-200 transition hover:bg-blue-500/30"
                        title="Update the linked redo ticket number"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                  {editingRedoTicket ? (
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        type="text"
                        value={redoTicketDraft}
                        onChange={(e) => setRedoTicketDraft(e.target.value)}
                        placeholder="e.g. 015789584139"
                        className="flex-1 rounded-md border border-white/15 bg-slate-950 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => void saveRedoTicket()}
                        disabled={savingRedoTicket}
                        className="rounded-md border border-emerald-400/40 bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/30 disabled:opacity-50"
                      >
                        {savingRedoTicket ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditingRedoTicket}
                        disabled={savingRedoTicket}
                        className="rounded-md border border-white/15 bg-slate-950/90 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-200/40 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="text-white mt-1">{ticket?.redoTicketNo?.trim() || "NONE"}</div>
                  )}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={openVisitCreateModal} className="rounded-md border border-blue-400/40 bg-blue-500/20 px-4 py-2 text-sm font-semibold text-blue-200 transition hover:bg-blue-500/30">
                  Add Visit
                </button>
                <button
                  type="button"
                  onClick={openRunningNotesModal}
                  className="rounded-md border border-emerald-400/40 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/30"
                  title="View / post ServicePower Running Notes for this work order"
                >
                  Running Notes
                </button>
              </div>
              <div className="mt-4 rounded-lg border border-amber-400/20 bg-amber-500/5 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-300">
                  Problem Description
                </div>
                <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
                  {ticket?.problemDescription?.trim() ||
                    "No problem description on file for this work order."}
                </div>
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
                      (() => {
                        // Assign sequential, unique visit numbers by chronological order
                        // (oldest = V1). This avoids duplicate labels when the stored
                        // visit_no field is missing or repeated in the database.
                        const orderedIds = [...visitLogEntries]
                          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
                          .map((e) => e.id);
                        const visitLabelById = new Map(
                          orderedIds.map((id, i) => [id, `V${i + 1}`])
                        );

                        return [...visitLogEntries].reverse().map((entry) => (
                        <div key={entry.id} className="rounded-md border border-white/10 bg-slate-950/70 p-4 text-sm">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="flex items-center gap-3">
                              <div className="flex h-8 w-12 items-center justify-center rounded-md bg-blue-500/20 text-xs font-bold text-blue-300 border border-blue-400/30">
                                {visitLabelById.get(entry.id) ?? entry.visitNo}
                              </div>
                              <div>
                                <div className="font-semibold text-blue-300">{entry.actionType} / {entry.repairStatus || "No status"}</div>
                                <div className="text-xs text-slate-400">{new Date(entry.timestamp).toLocaleString()}</div>
                              </div>
                            </div>
                            <div className="text-xs font-semibold text-slate-300">{entry.by}</div>
                          </div>
                          {entry.updatedAt ? (
                            <div className="mt-2 rounded-md border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs">
                              <div className="font-semibold text-amber-200">
                                Edited: {new Date(entry.updatedAt).toLocaleString()}
                                {entry.updatedBy ? ` by ${entry.updatedBy}` : ""}
                              </div>
                              {entry.updateReason ? (
                                <div className="mt-1 text-amber-100/90">{entry.updateReason}</div>
                              ) : null}
                            </div>
                          ) : null}
                          
                          {/* Schedule Information */}
                          <div className="mt-3 grid gap-2 text-xs text-slate-300 md:grid-cols-3">
                            <div><span className="font-semibold text-slate-400">Schedule:</span> {entry.scheduleDate || "—"}</div>
                            <div><span className="font-semibold text-slate-400">Technician:</span> {entry.technician || "—"}</div>
                            <div><span className="font-semibold text-slate-400">Time Slot:</span> {entry.timeSlot || "—"}</div>
                          </div>

                          {/* CSR Notes - Only show if has content */}
                          {(entry.schedNotes || entry.symptomCx) ? (
                            <div className="mt-3 rounded-md border border-blue-500/20 bg-blue-500/5 p-3 space-y-2">
                              <div className="text-xs font-semibold uppercase tracking-wider text-blue-300">CSR Information</div>
                              {entry.schedNotes ? (
                                <p className="text-sm text-slate-200"><span className="font-semibold text-slate-400">Sched Notes:</span> {entry.schedNotes}</p>
                              ) : null}
                              {entry.symptomCx ? (
                                <p className="text-sm text-slate-200"><span className="font-semibold text-slate-400">Symptom:</span> {entry.symptomCx}</p>
                              ) : null}
                            </div>
                          ) : null}

                          {/* Tech Notes - Only show if has content */}
                          {(entry.diagnosis || entry.resolution || entry.repairType) ? (
                            <div className="mt-3 rounded-md border border-green-500/20 bg-green-500/5 p-3 space-y-2">
                              <div className="text-xs font-semibold uppercase tracking-wider text-green-300">Technician Information</div>
                              {entry.repairType ? (
                                <p className="text-sm text-slate-200"><span className="font-semibold text-slate-400">Repair Type (2nd Tech):</span> {entry.repairType}</p>
                              ) : null}
                              {entry.diagnosis ? (
                                <p className="text-sm text-slate-200"><span className="font-semibold text-slate-400">Cause of Failure:</span> {entry.diagnosis}</p>
                              ) : null}
                              {entry.resolution ? (
                                <p className="text-sm text-slate-200"><span className="font-semibold text-slate-400">Repair Notes:</span> {entry.resolution}</p>
                              ) : null}
                            </div>
                          ) : null}

                          {/* Additional Notes - Only show if has content */}
                          {(entry.nonCompletionReason || entry.triageNote || entry.note) ? (
                            <div className="mt-3 space-y-2 text-sm text-slate-200">
                              {entry.nonCompletionReason ? (
                                <p><span className="font-semibold text-slate-400">Non-Completion Reason:</span> {entry.nonCompletionReason}</p>
                              ) : null}
                              {entry.triageNote ? (
                                <p><span className="font-semibold text-slate-400">Triage Note:</span> {entry.triageNote}</p>
                              ) : null}
                              {entry.note ? (
                                <p><span className="font-semibold text-slate-400">Internal Note:</span> {entry.note}</p>
                              ) : null}
                            </div>
                          ) : null}
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
                      ));
                      })()
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
                          <label htmlFor="visit-schedule-date-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Schedule Date</label>
                          <input id="visit-schedule-date-modal" type="date" value={newVisitScheduleDate} onChange={(event) => setNewVisitScheduleDate(event.target.value)} className="w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                        </div>
                        <div className="space-y-1.5">
                          <label htmlFor="visit-technician-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Technician</label>
                          <select id="visit-technician-modal" value={newVisitTechnician} onChange={(event) => setNewVisitTechnician(event.target.value)} className="w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                            <option value="">— select —</option>
                            {technicianOptions.map((technician) => (
                              <option key={technician} value={technician}>{technician}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label htmlFor="visit-time-slot-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Time Slot</label>
                          <select id="visit-time-slot-modal" value={newVisitTimeSlot} onChange={(event) => setNewVisitTimeSlot(event.target.value)} className="w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                            <option value="">— select —</option>
                            {TIME_FRAMES.map((f) => <option key={f} value={f}>{f}</option>)}
                            <option value="ANYTIME">ANYTIME</option>
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label htmlFor="visit-action-type-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Action Type *</label>
                          <select id="visit-action-type-modal" value={newVisitActionType} onChange={(event) => setNewVisitActionType(event.target.value)} className="w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                            <option value="">— select —</option>
                            <option>SCHEDULE</option>
                            <option>ACKNOWLEDGE</option>
                            <option>CALL ATTEMPT</option>
                            <option>CANCEL</option>
                            <option>CLAIM REQUESTED</option>
                            <option>COMPLETED</option>
                            <option>OSR</option>
                            <option>UPDATE INFO.</option>
                            <option>UPDATE</option>
                            <option>RESCHEDULE</option>
                            <option>TRIAGE</option>
                            <option>SUPPORT</option>
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label htmlFor="visit-repair-status-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                            Repair Status <span className="text-rose-400">*</span>
                          </label>
                          <select
                            id="visit-repair-status-modal"
                            value={newVisitRepairStatus}
                            onChange={(event) => setNewVisitRepairStatus(event.target.value)}
                            className={`w-full rounded-md border bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 ${
                              newVisitRepairStatus.trim() ? "border-white/15" : "border-rose-400/40"
                            }`}
                          >
                            <option value="">— select —</option>
                            <option>CL-Cancelled</option>
                            <option>CL-Claimed</option>
                            <option>CL-Data-Closed</option>
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
                          <select id="visit-repair-type-modal" value={newVisitRepairType} onChange={(event) => setNewVisitRepairType(event.target.value)} className="w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                            <option value="">— select —</option>
                            <option>2 Man Job</option>
                            <option>Back Tub</option>
                            <option>Major Repair</option>
                            <option>Panel 60 Over</option>
                            <option>Panel 80 Over</option>
                            <option>Seal with Trainee</option>
                            <option>Sealed System</option>
                            <option>Sealed System Follow Up</option>
                            <option>Sealed System(R600)</option>
                            <option>Stacked Unit(Washer Only)</option>
                            <option>Wall Oven</option>
                          </select>
                        </div>
                        <div className="space-y-1.5 xl:col-span-3">
                          <label htmlFor="visit-sched-notes-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Sched Notes (CSR)</label>
                          <textarea id="visit-sched-notes-modal" value={newVisitSchedNotes} onChange={(event) => setNewVisitSchedNotes(event.target.value)} className="min-h-18 w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                        </div>
                        <div className="space-y-1.5 xl:col-span-3">
                          <label htmlFor="visit-symptom-cx-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Symptom (CSR)</label>
                          <textarea id="visit-symptom-cx-modal" value={newVisitSymptomCx} onChange={(event) => setNewVisitSymptomCx(event.target.value)} className="min-h-18 w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                        </div>
                        <div className="space-y-1.5 xl:col-span-3">
                          <label htmlFor="visit-diagnosis-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Cause of Failure (Tech){requireTechVisitFields ? <span className="text-rose-400"> *</span> : null}</label>
                          <textarea id="visit-diagnosis-modal" value={newVisitDiagnosis} onChange={(event) => setNewVisitDiagnosis(event.target.value)} className={`min-h-18 w-full rounded-md border bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 ${requireTechVisitFields && !newVisitDiagnosis.trim() ? "border-rose-500/50" : "border-white/15"}`} />
                        </div>
                        <div className="space-y-1.5 xl:col-span-3">
                          <label htmlFor="visit-resolution-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Repair Notes (Tech){requireTechVisitFields ? <span className="text-rose-400"> *</span> : null}</label>
                          <textarea id="visit-resolution-modal" value={newVisitResolution} onChange={(event) => setNewVisitResolution(event.target.value)} className={`min-h-18 w-full rounded-md border bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 ${requireTechVisitFields && !newVisitResolution.trim() ? "border-rose-500/50" : "border-white/15"}`} />
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

              {isRunningNotesOpen ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6 backdrop-blur-sm">
                  <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-emerald-400/30 bg-slate-900 p-5 text-white shadow-2xl">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">
                          ServicePower
                        </p>
                        <h3 className="text-xl font-bold text-white">Running Notes</h3>
                        <p className="mt-1 text-sm text-slate-400">
                          Work Order #{ticketNo}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={closeRunningNotesModal}
                        className="rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-200/40"
                      >
                        Close
                      </button>
                    </div>

                    <div className="mt-3 rounded-md border border-amber-400/20 bg-amber-900/10 px-3 py-2 text-[11px] text-amber-200/90">
                      ServicePower's Servicer Web Service only returns notes pushed through their public API. Status auto-events
                      and notes typed by staff in SP HUB live in SP's internal application and aren't accessible from our integration.
                    </div>

                    <div className="mt-4 space-y-3 max-h-[40vh] overflow-y-auto rounded-lg border border-white/10 bg-slate-950/40 p-3">
                      {runningNotesLoading ? (
                        <div className="text-sm text-slate-400">Loading notes from ServicePower…</div>
                      ) : runningNotesError ? (
                        <div className="rounded-md border border-red-500/30 bg-red-900/20 px-3 py-2 text-sm text-red-200">
                          {runningNotesError}
                        </div>
                      ) : runningNotes.length === 0 ? (
                        <div className="text-sm text-slate-400">No running notes recorded yet for this work order.</div>
                      ) : (
                        runningNotes.map((n, idx) => (
                          <div
                            key={idx}
                            className={`rounded-md border p-3 ${
                              n.isInternal
                                ? "border-amber-400/30 bg-amber-900/10"
                                : "border-emerald-400/30 bg-emerald-900/10"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                              <div className="font-semibold text-slate-300">
                                {n.addedBy || "—"}
                                <span className="ml-2 text-slate-500">
                                  {n.date
                                    ? new Date(n.date).toLocaleString("en-US", {
                                        month: "2-digit",
                                        day: "2-digit",
                                        year: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      })
                                    : ""}
                                </span>
                              </div>
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                  n.isInternal
                                    ? "bg-amber-400/20 text-amber-200"
                                    : "bg-emerald-400/20 text-emerald-200"
                                }`}
                              >
                                {n.isInternal ? "Internal" : "External"}
                              </span>
                            </div>
                            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200">{n.body}</p>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="mt-4 border-t border-white/10 pt-4">
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <p className="text-sm font-semibold text-slate-200">Add a note</p>
                        <div className="inline-flex rounded-md border border-white/15 bg-slate-950/80 p-0.5 text-xs">
                          <button
                            type="button"
                            onClick={() => setNewRunningNoteVisibility("internal")}
                            className={`rounded px-2 py-1 font-semibold ${
                              newRunningNoteVisibility === "internal"
                                ? "bg-amber-500/30 text-amber-200"
                                : "text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            Internal
                          </button>
                          <button
                            type="button"
                            onClick={() => setNewRunningNoteVisibility("external")}
                            className={`rounded px-2 py-1 font-semibold ${
                              newRunningNoteVisibility === "external"
                                ? "bg-emerald-500/30 text-emerald-200"
                                : "text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            External
                          </button>
                        </div>
                      </div>
                      <textarea
                        value={newRunningNote}
                        onChange={(e) => setNewRunningNote(e.target.value)}
                        placeholder="Type your running note. Internal notes are only visible to AHS staff; external notes are sent to the warranty company."
                        className="w-full min-h-[100px] rounded-md border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400/50 focus:outline-none"
                        disabled={postingRunningNote}
                      />
                      {runningNotePostError ? (
                        <div className="mt-2 rounded-md border border-red-500/30 bg-red-900/20 px-3 py-2 text-xs text-red-200">
                          {runningNotePostError}
                        </div>
                      ) : null}
                      <div className="mt-3 flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => void loadRunningNotes()}
                          disabled={runningNotesLoading || postingRunningNote}
                          className="rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-200/40 disabled:opacity-60"
                        >
                          Refresh
                        </button>
                        <button
                          type="button"
                          onClick={() => void submitRunningNote()}
                          disabled={postingRunningNote || !newRunningNote.trim()}
                          className="rounded-md border border-emerald-400/40 bg-emerald-500/30 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500/40 disabled:opacity-60"
                        >
                          {postingRunningNote ? "Sending…" : "Send to ServicePower"}
                        </button>
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
                    <div className="mt-3 rounded-md border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm">
                      <div className="font-semibold text-amber-200">
                        Edited: {new Date(viewingVisitEntry.updatedAt).toLocaleString()}
                        {viewingVisitEntry.updatedBy ? ` by ${viewingVisitEntry.updatedBy}` : ""}
                      </div>
                      {viewingVisitEntry.updateReason ? (
                        <div className="mt-1 text-amber-100/90">{viewingVisitEntry.updateReason}</div>
                      ) : null}
                    </div>
                  ) : null}

                  {/* Schedule Information */}
                  <div className="mt-4">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Schedule Information</div>
                    <div className="grid gap-3 md:grid-cols-3 text-sm text-slate-200">
                      <div className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"><span className="font-semibold text-slate-400">Date:</span> {viewingVisitEntry.scheduleDate || "—"}</div>
                      <div className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"><span className="font-semibold text-slate-400">Technician:</span> {viewingVisitEntry.technician || "—"}</div>
                      <div className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"><span className="font-semibold text-slate-400">Time Slot:</span> {viewingVisitEntry.timeSlot || "—"}</div>
                    </div>
                  </div>

                  {/* CSR Information */}
                  {(viewingVisitEntry.schedNotes || viewingVisitEntry.symptomCx) ? (
                    <div className="mt-4">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-blue-300">CSR Information</div>
                      <div className="space-y-3 text-sm text-slate-200">
                        {viewingVisitEntry.schedNotes ? (
                          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2"><span className="font-semibold text-slate-400">Sched Notes:</span> {viewingVisitEntry.schedNotes}</div>
                        ) : null}
                        {viewingVisitEntry.symptomCx ? (
                          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2"><span className="font-semibold text-slate-400">Symptom:</span> {viewingVisitEntry.symptomCx}</div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {/* Technician Information */}
                  {(viewingVisitEntry.repairType || viewingVisitEntry.diagnosis || viewingVisitEntry.resolution) ? (
                    <div className="mt-4">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-green-300">Technician Information</div>
                      <div className="space-y-3 text-sm text-slate-200">
                        {viewingVisitEntry.repairType ? (
                          <div className="rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2"><span className="font-semibold text-slate-400">Repair Type (2nd Tech):</span> {viewingVisitEntry.repairType}</div>
                        ) : null}
                        {viewingVisitEntry.diagnosis ? (
                          <div className="rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2"><span className="font-semibold text-slate-400">Cause of Failure:</span> {viewingVisitEntry.diagnosis}</div>
                        ) : null}
                        {viewingVisitEntry.resolution ? (
                          <div className="rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2"><span className="font-semibold text-slate-400">Repair Notes:</span> {viewingVisitEntry.resolution}</div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {/* Additional Notes */}
                  {(viewingVisitEntry.nonCompletionReason || viewingVisitEntry.triageNote || viewingVisitEntry.note) ? (
                    <div className="mt-4">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Additional Notes</div>
                      <div className="space-y-3 text-sm text-slate-200">
                        {viewingVisitEntry.nonCompletionReason ? (
                          <div className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"><span className="font-semibold text-slate-400">Non-Completion Reason:</span> {viewingVisitEntry.nonCompletionReason}</div>
                        ) : null}
                        {viewingVisitEntry.triageNote ? (
                          <div className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"><span className="font-semibold text-slate-400">Triage Note:</span> {viewingVisitEntry.triageNote}</div>
                        ) : null}
                        {viewingVisitEntry.note ? (
                          <div className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"><span className="font-semibold text-slate-400">Internal Note:</span> {viewingVisitEntry.note}</div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-6 rounded-lg border border-white/10 bg-slate-900/50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Change Log</div>
                        <div className="text-sm text-slate-300">Every tracked edit on this ticket</div>
                      </div>
                      <div className="text-xs font-semibold text-blue-300">{auditCountLabel}</div>
                    </div>
                    <div className="mt-4 space-y-3">
                      {auditEntries.length === 0 ? (
                        <div className="px-4 py-8 text-center text-slate-400">
                          No tracked changes yet.
                        </div>
                      ) : (
                        auditEntries.map((entry) => (
                          <div key={entry.id} className="border border-white/10 rounded-lg bg-slate-900/30 hover:bg-slate-900/50 transition">
                            {/* Header Row */}
                            <div className="grid grid-cols-4 gap-3 px-4 py-3 border-b border-white/10 bg-blue-900/20">
                              <div>
                                <div className="text-xs text-blue-300 font-semibold mb-1">Time</div>
                                <div className="text-sm text-slate-300">{new Date(entry.timestamp).toLocaleString()}</div>
                              </div>
                              <div>
                                <div className="text-xs text-blue-300 font-semibold mb-1">Changed By</div>
                                <div className="text-sm text-slate-300 break-words">{entry.by}</div>
                              </div>
                              <div>
                                <div className="text-xs text-blue-300 font-semibold mb-1">Action</div>
                                <div className="text-sm text-slate-300">{entry.action}</div>
                              </div>
                              <div>
                                <div className="text-xs text-blue-300 font-semibold mb-1">Field</div>
                                <div className="text-sm text-slate-300">{entry.field}</div>
                              </div>
                            </div>
                            
                            {/* Before/After Row */}
                            <div className="grid grid-cols-2 gap-0">
                              <div className="px-4 py-3 border-r border-white/10">
                                <div className="text-xs text-slate-400 font-semibold mb-2">BEFORE</div>
                                <div className="text-sm text-slate-400">{renderVisitSummary(entry.before)}</div>
                              </div>
                              <div className="px-4 py-3">
                                <div className="text-xs text-green-400 font-semibold mb-2">AFTER</div>
                                <div className="text-sm text-slate-200">{renderVisitSummary(entry.after, entry.before)}</div>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Part Transaction */}
            <div id="section-part-transaction" className="scroll-mt-28">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <h4 className="font-semibold text-slate-300">Part Transaction</h4>
                  <div className="text-xs font-semibold text-blue-300">{partCountLabel}</div>
                  {isTicketPartLocked ? (
                    <span
                      className={`ml-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                        partsEditDisabled
                          ? "border-amber-400/40 bg-amber-500/15 text-amber-200"
                          : "border-emerald-400/40 bg-emerald-500/15 text-emerald-200"
                      }`}
                      title={
                        partsEditDisabled
                          ? `Ticket is "${ticket?.status}". Only Claims can change parts.`
                          : `Ticket is "${ticket?.status}". Claims-only edit window.`
                      }
                    >
                      🔒 Locked — Claims only
                    </span>
                  ) : null}
                </div>
                {canUsePartToolbar && (
                <div className="flex items-center gap-2">
                  <button 
                    type="button"
                    onClick={() => {
                      if (partRows.length === 0) {
                        alert('No parts to view');
                        return;
                      }
                      setIsPartListModalOpen(true);
                    }}
                    className="rounded border border-blue-400/40 bg-blue-600/20 px-3 py-1.5 text-xs font-semibold text-blue-200 transition hover:bg-blue-600/30"
                    title="View all parts"
                  >
                    View Log
                  </button>
                  <button 
                    type="button"
                    onClick={() => void syncPartsFromNotes()}
                    disabled={partsEditDisabled || syncingNotesParts}
                    className={`rounded border px-3 py-1.5 text-xs font-semibold transition ${
                      partsEditDisabled || syncingNotesParts
                        ? "border-white/10 bg-slate-800 text-slate-500 cursor-not-allowed"
                        : "border-purple-400/40 bg-purple-600/20 text-purple-200 hover:bg-purple-600/30"
                    }`}
                    title={
                      partsEditDisabled
                        ? "Locked: Parts / Claims / Manager roles only"
                        : "Import parts the warranty company announced in SP customer notes (Squaretrade / Allstate). Adds Need-PO rows for new parts and overlays tracking numbers onto existing ones."
                    }
                  >
                    {syncingNotesParts ? "Syncing…" : "Sync Parts from Notes"}
                  </button>
                  <button 
                    type="button"
                    onClick={openTruckStockBatch}
                    disabled={partsEditDisabled}
                    className={`rounded border px-3 py-1.5 text-xs font-semibold transition ${
                      partsEditDisabled
                        ? "border-white/10 bg-slate-800 text-slate-500 cursor-not-allowed"
                        : "border-emerald-400/40 bg-emerald-600/20 text-emerald-200 hover:bg-emerald-600/30"
                    }`}
                    title={partsEditDisabled ? "Locked: Parts / Claims / Manager roles only" : "Fulfill Need PO parts from in-house Truck Stock"}
                  >
                    Truck Stock
                  </button>
                  <button 
                    type="button"
                    onClick={submitAllPOs}
                    disabled={partsEditDisabled}
                    className={`rounded border px-3 py-1.5 text-xs font-semibold transition ${
                      partsEditDisabled
                        ? "border-white/10 bg-slate-800 text-slate-500 cursor-not-allowed"
                        : "border-green-400/40 bg-green-600/20 text-green-200 hover:bg-green-600/30"
                    }`}
                    title={partsEditDisabled ? "Locked: Parts / Claims / Manager roles only" : "Submit POs for parts that need ordering"}
                  >
                    Submit POs
                  </button>
                  <button
                    type="button"
                    onClick={saveAllRowEdits}
                    disabled={partsEditDisabled || rowEditsSaving || dirtyRowCount === 0}
                    className={`rounded border px-3 py-1.5 text-xs font-semibold transition ${
                      partsEditDisabled || dirtyRowCount === 0
                        ? "border-white/10 bg-slate-800 text-slate-500 cursor-not-allowed"
                        : "border-blue-400/40 bg-blue-600/30 text-blue-200 hover:bg-blue-600/50"
                    }`}
                    title={
                      partsEditDisabled
                        ? "Locked: Parts / Claims / Manager roles only"
                        : dirtyRowCount === 0
                        ? "Edit any cell in a part row, then click Update to save"
                        : `Save changes to ${dirtyRowCount} part row${dirtyRowCount === 1 ? "" : "s"}`
                    }
                  >
                    {rowEditsSaving
                      ? "Saving…"
                      : dirtyRowCount > 0
                      ? `Update (${dirtyRowCount})`
                      : "Update"}
                  </button>
                  {/* Auto-sync indicator removed — Marcone order status
                      is now manual-refresh only via the per-row Refresh
                      button. */}
                </div>
                )}
              </div>
              {partsEditDisabled ? (
                <div className="mb-3 rounded-md border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  This ticket is <span className="font-semibold">{ticket?.status}</span>. Part Transactions are locked.
                  Only Parts / Claims / Admin / Manager / Branch Manager roles can edit them. Any attempt will alert Naveen, Ian, and Tina.
                </div>
              ) : null}

              <div className="overflow-x-auto border border-white/10 rounded-lg">
                <table className="w-full text-xs pt-compact" style={{ minWidth: "1180px" }}>
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
                    {/* ── Add inline row (hidden while editing — the editor
                          appears in-place at the row being edited so the
                          page does not jump to the top) ── */}
                    {editingPartId ? null : renderPartDraftRows()}

                    {/* ── Saved rows — every cell is an editable input. The
                          user types changes that buffer into rowEdits; the
                          global Update button (next to Submit POs) flushes
                          them to Supabase. There is no separate "edit
                          mode" or Edit button anymore. ── */}
                    {partRows.length === 0 ? (
                      <tr>
                        <td colSpan={15} className="px-4 py-6 text-center text-slate-500">No parts recorded yet</td>
                      </tr>
                    ) : (
                      partRows.map((row, index) => {
                        const isDirty = !!rowEdits[row.id];
                        const cellWrap = "px-1 py-1";
                        const inputCls = "w-full rounded border border-white/10 bg-slate-950/80 px-2 py-1 text-white focus:outline-none focus:border-blue-500 disabled:opacity-50";
                        const selectCls = inputCls;
                        const val = <K extends keyof PartTransactionRow>(field: K) => getRowValue(row, field);
                        const set = <K extends keyof PartTransactionRow>(field: K, v: PartTransactionRow[K]) =>
                            updateRowField(row.id, field, v);
                        return (
                        <React.Fragment key={row.id}>
                          <tr className={`align-top transition-colors ${isDirty ? "bg-blue-500/10" : "bg-slate-900/30"}`}>
                            <td className="px-2 py-1.5 text-slate-400 font-semibold w-10" rowSpan={2}>
                              P{index + 1}
                              {isDirty ? (
                                <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-blue-400" title="Unsaved changes — click Update to save" />
                              ) : null}
                            </td>
                            <td className={cellWrap}><input value={String(val("partNo") ?? "")} onChange={(e) => set("partNo", e.target.value)} disabled={partsEditDisabled} className={`${inputCls} text-blue-300 font-semibold`} placeholder="Part No*" /></td>
                            <td className={cellWrap}>
                              <select value={String(val("partDist") ?? "")} onChange={(e) => set("partDist", e.target.value)} disabled={partsEditDisabled} className={selectCls}>
                                <option value="">Dist.*</option>
                                {String(val("partDist") ?? "").startsWith("In-House (") ? <option value={String(val("partDist"))}>{String(val("partDist"))}</option> : null}
                                <option>AIG</option>
                                <option>Electrolux</option>
                                <option>Encompass</option>
                                <option>Encompass-Birmingham / Montgomery</option>
                                <option>GE</option>
                                <option>LG</option>
                                <option>Marcone- Birmingham / Montgomery</option>
                                <option>Marcone-162468</option>
                                <option>Midea</option>
                                <option>Miele</option>
                                <option>NSA</option>
                                <option>OW</option>
                                <option>SB</option>
                                <option>Sharp</option>
                                <option>SP</option>
                                <option>Squaretrade</option>
                                <option>SS</option>
                              </select>
                            </td>
                            <td className={cellWrap}><input value={String(val("partDesc") ?? "")} onChange={(e) => set("partDesc", e.target.value)} disabled={partsEditDisabled} className={inputCls} placeholder="Description" /></td>
                            <td className={cellWrap}><input value={String(val("poNo") ?? "")} onChange={(e) => set("poNo", e.target.value)} disabled={partsEditDisabled} className={inputCls} placeholder="PO No" /></td>
                            <td className={cellWrap}><input type="date" value={String(val("poDate") ?? "")} onChange={(e) => set("poDate", e.target.value)} disabled={partsEditDisabled} className={inputCls} /></td>
                            <td className={cellWrap}><input value={String(val("invoiceNo") ?? "")} onChange={(e) => set("invoiceNo", e.target.value)} disabled={partsEditDisabled} className={inputCls} placeholder="Invoice No" /></td>
                            <td className={cellWrap}><input type="date" value={String(val("invoiceDate") ?? "")} onChange={(e) => set("invoiceDate", e.target.value)} disabled={partsEditDisabled} className={inputCls} /></td>
                            <td className={cellWrap}><input value={String(val("quantity") ?? "")} onChange={(e) => set("quantity", e.target.value)} disabled={partsEditDisabled} className={`${inputCls} w-16`} placeholder="Qty*" /></td>
                            <td className={cellWrap}><input value={String(val("partPrice") ?? "")} onChange={(e) => set("partPrice", e.target.value)} disabled={partsEditDisabled} className={inputCls} placeholder="$0.00" /></td>
                            <td className={cellWrap}><input value={String(val("coreValue") ?? "")} onChange={(e) => set("coreValue", e.target.value)} disabled={partsEditDisabled} className={inputCls} placeholder="$0.00" /></td>
                            <td className={cellWrap}><input value={String(val("shipCost") ?? "")} onChange={(e) => set("shipCost", e.target.value)} disabled={partsEditDisabled} className={inputCls} placeholder="$0.00" /></td>
                            <td className={cellWrap}>
                              <select value={String(val("markup") ?? "0")} onChange={(e) => set("markup", e.target.value)} disabled={partsEditDisabled} className={selectCls}>
                                {Array.from({ length: 21 }, (_, i) => i * 5).map((v) => (
                                  <option key={v} value={String(v)}>{v}%</option>
                                ))}
                              </select>
                            </td>
                            <td className={cellWrap}><input value={String(val("claimTo") ?? "")} onChange={(e) => set("claimTo", e.target.value)} disabled={partsEditDisabled} className={inputCls} placeholder="Claim To" /></td>
                          </tr>
                          <tr className={`align-top border-b border-white/5 ${isDirty ? "bg-blue-500/5" : "bg-slate-900/20"}`}>
                            <td className={cellWrap}>
                              <select value={String(val("status") ?? "")} onChange={(e) => set("status", e.target.value)} disabled={partsEditDisabled} className={`${selectCls} text-blue-300 font-semibold`}>
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
                            <td className={cellWrap}><input value={String(val("note") ?? "")} onChange={(e) => set("note", e.target.value)} disabled={partsEditDisabled} className={inputCls} placeholder="Note" /></td>
                            <td className={cellWrap}><input value={String(val("visitId") ?? "")} onChange={(e) => set("visitId", e.target.value)} disabled={partsEditDisabled} className={inputCls} placeholder="Visit ID*" /></td>
                            <td className={cellWrap}><input value={String(val("orderNo") ?? "")} onChange={(e) => set("orderNo", e.target.value)} disabled={partsEditDisabled} className={inputCls} placeholder="Order #" /></td>
                            <td className={cellWrap}><input type="date" value={String(val("eta") ?? "")} onChange={(e) => set("eta", e.target.value)} disabled={partsEditDisabled} className={inputCls} /></td>
                            <td className={cellWrap}><input value={String(val("inTracking") ?? "")} onChange={(e) => set("inTracking", e.target.value)} disabled={partsEditDisabled} className={inputCls} placeholder="In Track #" /></td>
                            <td className={cellWrap}><input type="date" value={String(val("raDate") ?? "")} onChange={(e) => set("raDate", e.target.value)} disabled={partsEditDisabled} className={inputCls} /></td>
                            <td className={cellWrap}><input value={String(val("raNo") ?? "")} onChange={(e) => set("raNo", e.target.value)} disabled={partsEditDisabled} className={inputCls} placeholder="RA #" /></td>
                            <td className={cellWrap}><input value={String(val("outTracking") ?? "")} onChange={(e) => set("outTracking", e.target.value)} disabled={partsEditDisabled} className={inputCls} placeholder="Out Track #" /></td>
                            <td className={cellWrap}><input value={String(val("creditNo") ?? "")} onChange={(e) => set("creditNo", e.target.value)} disabled={partsEditDisabled} className={inputCls} placeholder="Credit #" /></td>
                            <td className="px-2 py-1.5 text-slate-300">{val("totalMarkup") ? `$${val("totalMarkup")}` : "—"}</td>
                            <td className={cellWrap}>
                              <input type="checkbox" checked={val("hold") === "Hold"} onChange={(e) => set("hold", e.target.checked ? "Hold" : "No")} disabled={partsEditDisabled} className="accent-blue-500" />
                            </td>
                            <td className={cellWrap}>
                              <input type="checkbox" checked={val("cxPaid") === "Paid"} onChange={(e) => set("cxPaid", e.target.checked ? "Paid" : "No")} disabled={partsEditDisabled} className="accent-blue-500" />
                            </td>
                            <td className="px-2 py-1.5 whitespace-nowrap">
                              {row.orderNo && isMarconeDist(row.partDist) ? (
                                <button
                                  type="button"
                                  onClick={() => refreshMarconeOrderStatus(row)}
                                  disabled={marconeRefreshingId === row.id}
                                  className="rounded border border-amber-400/40 bg-amber-500/15 px-2 py-1 text-xs font-semibold text-amber-200 hover:bg-amber-500/25 mr-1 disabled:opacity-40"
                                  title={`Pull ETA / invoice / tracking from Marcone for order ${row.orderNo}`}
                                >
                                  {marconeRefreshingId === row.id ? "…" : "Refresh"}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => deletePartRow(row.id)}
                                disabled={partsEditDisabled}
                                className={`rounded border px-2 py-1 text-xs font-semibold transition ${
                                  partsEditDisabled
                                    ? "border-white/10 bg-slate-900 text-slate-500 cursor-not-allowed"
                                    : "border-rose-400/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                                }`}
                                title={partsEditDisabled ? "Locked: Parts / Claims / Manager roles only" : "Delete part"}
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        </React.Fragment>
                        );
                      })
                    )}
                  </tbody>
                  {partRows.length > 0 && (() => {
                    const totals = partRows.reduce((acc, r) => {
                      const qty = parseFloat(r.quantity) || 0;
                      acc.qty += qty;
                      acc.partPrice += (parseFloat(r.partPrice) || 0) * (qty || 1);
                      acc.coreValue += parseFloat(r.coreValue) || 0;
                      acc.shipCost += parseFloat(r.shipCost) || 0;
                      acc.markup += parseFloat(r.markup) || 0;
                      return acc;
                    }, { qty: 0, partPrice: 0, coreValue: 0, shipCost: 0, markup: 0 });
                    const grand = totals.partPrice + totals.coreValue + totals.shipCost + totals.markup;
                    const money = (n: number) => `$${n.toFixed(2)}`;
                    return (
                      <tfoot>
                        <tr className="bg-yellow-200 text-slate-900 font-semibold text-[11px]">
                          <td className="px-2 py-1.5 uppercase tracking-wide" colSpan={8}>Total</td>
                          <td className="px-2 py-1.5">{totals.qty}</td>
                          <td className="px-2 py-1.5">{money(totals.partPrice)}</td>
                          <td className="px-2 py-1.5">{money(totals.coreValue)}</td>
                          <td className="px-2 py-1.5">{money(totals.shipCost)}</td>
                          <td className="px-2 py-1.5">{money(totals.markup)}</td>
                          <td className="px-2 py-1.5 text-right" colSpan={20}>
                            <span className="mr-2 text-slate-700">Grand Total:</span>
                            <span className="text-slate-900">{money(grand)}</span>
                          </td>
                        </tr>
                      </tfoot>
                    );
                  })()}
                </table>
              </div>
            </div>
            {canSeeClaimTransaction && (
            <div id="section-claim-transaction" className="scroll-mt-28">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="font-semibold text-slate-300">Claim Transaction</h4>
                  <span className="text-xs font-semibold text-slate-400">Ticket #:</span>
                  <span className="font-mono text-xs text-blue-300">{ticketNo}</span>
                  {ticket?.ticketSource ? (
                    <span className="rounded-full bg-blue-700/30 border border-blue-500/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-200">
                      {ticket.ticketSource}
                    </span>
                  ) : null}
                  {officeDistanceMiles != null ? (
                    <span className="rounded-md bg-emerald-700/30 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">
                      {officeDistanceMiles.toFixed(1)} mi
                    </span>
                  ) : null}
                  <span className="text-xs font-semibold text-blue-300 ml-2">
                    {claimRows.length} distinct record{claimRows.length === 1 ? "" : "s"} found
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {isAssurantClaimedTicket && (
                    <button
                      type="button"
                      onClick={() => void syncFromClaim()}
                      disabled={syncingClaim}
                      className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
                        syncingClaim
                          ? "border-white/10 bg-slate-800 text-slate-500 cursor-not-allowed"
                          : "border-teal-400/40 bg-teal-500/20 text-teal-200 hover:bg-teal-500/30"
                      }`}
                      title="Pull the filed Assurant claim from ServicePower and stamp claim #, payment amounts, and status onto every part row."
                    >
                      {syncingClaim ? "Syncing…" : "Sync from Claim"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => alert("Request Authorization — feature pending. Will post an RFA to ServicePower for this claim.")}
                    className="rounded-md border border-blue-400/40 bg-blue-500/20 px-3 py-1.5 text-xs font-semibold text-blue-200 transition hover:bg-blue-500/30"
                  >
                    Request Authorization
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      appendAuditEntry({
                        by: currentEditor,
                        action: "Updated claim transactions",
                        field: "Claim Transaction",
                        before: "—",
                        after: `${claimRows.length} row(s) saved`,
                      });
                      alert("Claim transactions saved.");
                    }}
                    className="rounded-md border border-emerald-400/40 bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/30"
                  >
                    Update
                  </button>
                </div>
              </div>
              <textarea
                value={claimNote}
                onChange={(e) => setClaimNote(e.target.value)}
                placeholder="(CLAIM NOTE HERE)"
                className="w-full mb-3 rounded-md border border-yellow-400/30 bg-yellow-100/5 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-yellow-300/60"
                rows={2}
              />
              <div className="overflow-x-auto border border-white/10 rounded-lg">
                <table className="w-full text-xs pt-compact" style={{ minWidth: "1400px" }}>
                  {/* Two-row header — mirrors Part Transaction layout */}
                  <thead>
                    <tr className="bg-slate-800 border-b border-white/10 text-slate-300">
                      <th className="px-2 py-2 text-left font-semibold w-10" rowSpan={2}>ID</th>
                      <th className="px-2 py-2 text-left font-semibold">Claim To*</th>
                      <th className="px-2 py-2 text-left font-semibold">Visit Log ID*</th>
                      <th className="px-2 py-2 text-left font-semibold">Claim #*</th>
                      <th className="px-2 py-2 text-left font-semibold">Labor Fee</th>
                      <th className="px-2 py-2 text-left font-semibold">Part Fee</th>
                      <th className="px-2 py-2 text-left font-semibold">Diagnose Fee</th>
                      <th className="px-2 py-2 text-left font-semibold">Shipping Fee</th>
                      <th className="px-2 py-2 text-left font-semibold">Extra Mile Fee</th>
                      <th className="px-2 py-2 text-left font-semibold">Other Fee</th>
                      <th className="px-2 py-2 text-left font-semibold">Tax Fee</th>
                      <th className="px-2 py-2 text-left font-semibold">Total Fee</th>
                      <th className="px-2 py-2 text-left font-semibold">Payment Method</th>
                      <th className="px-2 py-2 text-left font-semibold">Mileage</th>
                      <th className="px-2 py-2 text-left font-semibold" rowSpan={2}>Actions</th>
                    </tr>
                    <tr className="bg-slate-800/70 border-b border-white/10 text-slate-400">
                      <th className="px-2 py-2 text-left font-semibold">Claim Date*</th>
                      <th className="px-2 py-2 text-left font-semibold">Claim Status*</th>
                      <th className="px-2 py-2 text-left font-semibold">CC # (Last 4)</th>
                      <th className="px-2 py-2 text-left font-semibold">App. Labor Fee</th>
                      <th className="px-2 py-2 text-left font-semibold">App. Part Fee</th>
                      <th className="px-2 py-2 text-left font-semibold">App. Diagnose Fee</th>
                      <th className="px-2 py-2 text-left font-semibold">App. Shipping Fee</th>
                      <th className="px-2 py-2 text-left font-semibold">App. Extra Mile Fee</th>
                      <th className="px-2 py-2 text-left font-semibold">App. Other Fee</th>
                      <th className="px-2 py-2 text-left font-semibold">App. Tax Fee</th>
                      <th className="px-2 py-2 text-left font-semibold">App. Total Fee</th>
                      <th className="px-2 py-2 text-left font-semibold">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {/* ── Inline Add / Edit draft row (always visible, like Part Transaction) ── */}
                    <tr className="bg-slate-900/60 align-top">
                      <td className="px-2 py-1.5 text-slate-500 w-10" rowSpan={2}></td>
                      <td className="px-1 py-1.5">
                        <select
                          value={claimDraft.claimTo}
                          onChange={(e) => updateClaimDraftField("claimTo", e.target.value)}
                          className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                        >
                          <option value="">— Claim To* —</option>
                          {CLAIM_TOS.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1 py-1.5">
                        <select
                          value={claimDraft.visitLogId}
                          onChange={(e) => updateClaimDraftField("visitLogId", e.target.value)}
                          className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                        >
                          <option value="">Visit Log ID*</option>
                          {visitLogEntries.map((v) => (
                            <option key={v.id} value={v.visitNo}>{v.visitNo}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1 py-1.5">
                        <input
                          value={claimDraft.claimNo}
                          onChange={(e) => updateClaimDraftField("claimNo", e.target.value)}
                          className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                          placeholder="Claim #*"
                        />
                      </td>
                      <td className="px-1 py-1.5">
                        <input value={claimDraft.laborFee} onChange={(e) => updateClaimDraftField("laborFee", e.target.value)} inputMode="decimal" className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="$" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input value={claimDraft.partFee} onChange={(e) => updateClaimDraftField("partFee", e.target.value)} inputMode="decimal" className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="$" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input value={claimDraft.diagnoseFee} onChange={(e) => updateClaimDraftField("diagnoseFee", e.target.value)} inputMode="decimal" className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="$" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input value={claimDraft.shippingFee} onChange={(e) => updateClaimDraftField("shippingFee", e.target.value)} inputMode="decimal" className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="$" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input value={claimDraft.extraMileFee} onChange={(e) => updateClaimDraftField("extraMileFee", e.target.value)} inputMode="decimal" className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="$" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input value={claimDraft.otherFee} onChange={(e) => updateClaimDraftField("otherFee", e.target.value)} inputMode="decimal" className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="$" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input value={claimDraft.taxFee} onChange={(e) => updateClaimDraftField("taxFee", e.target.value)} inputMode="decimal" className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="$" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input value={claimDraft.totalFee} onChange={(e) => updateClaimDraftField("totalFee", e.target.value)} inputMode="decimal" className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="$" />
                      </td>
                      <td className="px-1 py-1.5">
                        <select
                          value={claimDraft.paymentMethod}
                          onChange={(e) => updateClaimDraftField("paymentMethod", e.target.value)}
                          className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                        >
                          <option value="">Payment Method</option>
                          {PAYMENT_METHODS.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1 py-1.5">
                        <input value={claimDraft.mileage} onChange={(e) => updateClaimDraftField("mileage", e.target.value)} inputMode="decimal" className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="Mileage" />
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap align-middle" rowSpan={2}>
                        <button
                          type="button"
                          onClick={saveClaimDraft}
                          className="rounded border border-blue-400/40 bg-blue-600/30 px-3 py-1 text-xs font-semibold text-blue-200 hover:bg-blue-600/50 transition"
                        >
                          {editingClaimId ? "Update" : "Add"}
                        </button>
                        {editingClaimId ? (
                          <button type="button" onClick={clearClaimDraft} className="ml-1 rounded border border-white/15 bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition">
                            Cancel
                          </button>
                        ) : null}
                      </td>
                    </tr>
                    <tr className="bg-slate-900/40 align-top border-b border-white/10">
                      <td className="px-1 py-1.5">
                        <input type="date" value={claimDraft.claimDate} onChange={(e) => updateClaimDraftField("claimDate", e.target.value)} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" />
                      </td>
                      <td className="px-1 py-1.5">
                        <select
                          value={claimDraft.claimStatus}
                          onChange={(e) => updateClaimDraftField("claimStatus", e.target.value)}
                          className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                        >
                          <option value="">Claim Status</option>
                          {CLAIM_STATUSES.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1 py-1.5">
                        <input value={claimDraft.ccLast4} onChange={(e) => updateClaimDraftField("ccLast4", e.target.value)} maxLength={4} inputMode="numeric" className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="CC # (Last 4)" />
                      </td>
                      {/* Approved (App.) fees — duplicated bindings until distinct fields land. */}
                      {([
                        "laborFee","partFee","diagnoseFee","shippingFee",
                        "extraMileFee","otherFee","taxFee","totalFee",
                      ] as const).map((key) => (
                        <td key={key} className="px-1 py-1.5">
                          <input value={claimDraft[key]} onChange={(e) => updateClaimDraftField(key, e.target.value)} inputMode="decimal" className="w-full rounded border border-white/10 bg-slate-950/60 px-2 py-1 text-slate-300 focus:outline-none focus:border-blue-500" placeholder="App." />
                        </td>
                      ))}
                      <td className="px-1 py-1.5">
                        <input value={claimDraft.note} onChange={(e) => updateClaimDraftField("note", e.target.value)} className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500" placeholder="Note" />
                      </td>
                    </tr>

                    {claimRows.length === 0 ? (
                      <tr>
                        <td colSpan={15} className="px-3 py-6 text-center text-slate-500">
                          No claim transactions yet. Fill the row above and click Add.
                        </td>
                      </tr>
                    ) : (
                      claimRows.map((row, idx) => (
                        <React.Fragment key={row.id}>
                          {/* Row A — Submitted: Claim To, Visit Log, Claim #, fees, Payment, Mileage */}
                          <tr className="bg-slate-900/60 align-top">
                            <td className="px-2 py-1.5 text-slate-400 font-semibold w-10" rowSpan={2}>C{idx + 1}</td>
                            <td className="px-1 py-1.5">
                              <select
                                value={row.claimTo}
                                onChange={(e) => updateClaimRow(row.id, "claimTo", e.target.value)}
                                className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                              >
                                <option value="">— Claim To —</option>
                                {CLAIM_TOS.map((c) => (
                                  <option key={c} value={c}>{c}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-1 py-1.5">
                              <select
                                value={row.visitLogId}
                                onChange={(e) => updateClaimRow(row.id, "visitLogId", e.target.value)}
                                className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                              >
                                <option value="">Visit Log ID</option>
                                {visitLogEntries.map((v) => (
                                  <option key={v.id} value={v.visitNo}>{v.visitNo}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-1 py-1.5">
                              <input
                                value={row.claimNo}
                                onChange={(e) => updateClaimRow(row.id, "claimNo", e.target.value)}
                                className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                                placeholder="Claim #"
                              />
                            </td>
                            <td className="px-1 py-1.5">
                              <input
                                value={row.laborFee}
                                onChange={(e) => updateClaimRow(row.id, "laborFee", e.target.value)}
                                inputMode="decimal"
                                className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                                placeholder="$"
                              />
                            </td>
                            <td className="px-1 py-1.5">
                              <input
                                value={row.partFee}
                                onChange={(e) => updateClaimRow(row.id, "partFee", e.target.value)}
                                inputMode="decimal"
                                className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                                placeholder="$"
                              />
                            </td>
                            <td className="px-1 py-1.5">
                              <input
                                value={row.diagnoseFee}
                                onChange={(e) => updateClaimRow(row.id, "diagnoseFee", e.target.value)}
                                inputMode="decimal"
                                className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                                placeholder="$"
                              />
                            </td>
                            <td className="px-1 py-1.5">
                              <input
                                value={row.shippingFee}
                                onChange={(e) => updateClaimRow(row.id, "shippingFee", e.target.value)}
                                inputMode="decimal"
                                className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                                placeholder="$"
                              />
                            </td>
                            <td className="px-1 py-1.5">
                              <input
                                value={row.extraMileFee}
                                onChange={(e) => updateClaimRow(row.id, "extraMileFee", e.target.value)}
                                inputMode="decimal"
                                className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                                placeholder="$"
                              />
                            </td>
                            <td className="px-1 py-1.5">
                              <input
                                value={row.otherFee}
                                onChange={(e) => updateClaimRow(row.id, "otherFee", e.target.value)}
                                inputMode="decimal"
                                className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                                placeholder="$"
                              />
                            </td>
                            <td className="px-1 py-1.5">
                              <input
                                value={row.taxFee}
                                onChange={(e) => updateClaimRow(row.id, "taxFee", e.target.value)}
                                inputMode="decimal"
                                className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                                placeholder="$"
                              />
                            </td>
                            <td className="px-1 py-1.5">
                              <input
                                value={row.totalFee}
                                onChange={(e) => updateClaimRow(row.id, "totalFee", e.target.value)}
                                inputMode="decimal"
                                className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                                placeholder="$"
                              />
                            </td>
                            <td className="px-1 py-1.5">
                              <select
                                value={row.paymentMethod}
                                onChange={(e) => updateClaimRow(row.id, "paymentMethod", e.target.value)}
                                className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                              >
                                <option value="">Payment Method</option>
                                {PAYMENT_METHODS.map((m) => (
                                  <option key={m} value={m}>{m}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-1 py-1.5">
                              <input
                                value={row.mileage}
                                onChange={(e) => updateClaimRow(row.id, "mileage", e.target.value)}
                                inputMode="decimal"
                                className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                                placeholder="Mileage"
                              />
                            </td>
                            <td className="px-2 py-1.5 whitespace-nowrap align-middle" rowSpan={2}>
                              <div className="flex flex-col gap-1">
                                <button
                                  type="button"
                                  onClick={() => loadClaimForEdit(row)}
                                  className="rounded border border-white/15 bg-slate-800 px-2 py-1 text-[10px] font-semibold text-slate-200 hover:bg-slate-700 transition"
                                  title="Edit this claim row"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteClaimRow(row.id)}
                                  className="rounded border border-rose-400/30 bg-rose-500/10 px-2 py-1 text-[10px] font-semibold text-rose-300 hover:bg-rose-500/20 transition"
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                          {/* Row B — Approved: Claim Date, Claim Status, CC#, App fees, Note */}
                          <tr className="bg-slate-900/40 align-top border-b border-white/10">
                            <td className="px-1 py-1.5">
                              <input
                                type="date"
                                value={row.claimDate}
                                onChange={(e) => updateClaimRow(row.id, "claimDate", e.target.value)}
                                className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                              />
                            </td>
                            <td className="px-1 py-1.5">
                              <select
                                value={row.claimStatus}
                                onChange={(e) => updateClaimRow(row.id, "claimStatus", e.target.value)}
                                className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                              >
                                <option value="">Claim Status</option>
                                {CLAIM_STATUSES.map((s) => (
                                  <option key={s} value={s}>{s}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-1 py-1.5">
                              <input
                                value={row.ccLast4}
                                onChange={(e) => updateClaimRow(row.id, "ccLast4", e.target.value)}
                                maxLength={4}
                                inputMode="numeric"
                                className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                                placeholder="CC # (Last 4)"
                              />
                            </td>
                            {/* Approved fees — visually de-emphasized (lighter bg) since they
                                shadow the submitted fees above. Distinct keys land later. */}
                            {([
                              "laborFee","partFee","diagnoseFee","shippingFee",
                              "extraMileFee","otherFee","taxFee","totalFee",
                            ] as const).map((key) => (
                              <td key={key} className="px-1 py-1.5">
                                <input
                                  value={row[key]}
                                  onChange={(e) => updateClaimRow(row.id, key, e.target.value)}
                                  inputMode="decimal"
                                  className="w-full rounded border border-white/10 bg-slate-950/60 px-2 py-1 text-slate-300 focus:outline-none focus:border-blue-500"
                                  placeholder="App."
                                />
                              </td>
                            ))}
                            <td className="px-1 py-1.5">
                              <input
                                value={row.note}
                                onChange={(e) => updateClaimRow(row.id, "note", e.target.value)}
                                className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                                placeholder="Note"
                              />
                            </td>
                          </tr>
                        </React.Fragment>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            )}

            {/* Part List Modal */}
            {isPartListModalOpen ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6 backdrop-blur-sm">
                <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/15 bg-slate-900 p-5 text-white shadow-2xl">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Part Transaction Log</p>
                      <h3 className="text-xl font-bold text-white">Select a part to view details</h3>
                      <p className="text-sm text-slate-400 mt-1">{partRows.length} part{partRows.length === 1 ? '' : 's'} recorded</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsPartListModalOpen(false)}
                      className="rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-200/40"
                    >
                      Close
                    </button>
                  </div>

                  {/* Part List */}
                  <div className="mt-4 space-y-3">
                    {partRows.length === 0 ? (
                      <div className="px-4 py-8 text-center text-slate-400">
                        No parts recorded yet.
                      </div>
                    ) : (
                      partRows.map((part) => (
                        <div 
                          key={part.id} 
                          className="border border-white/10 rounded-lg bg-slate-900/50 hover:bg-slate-900/70 transition cursor-pointer"
                          onClick={() => {
                            setIsPartListModalOpen(false);
                            loadPartForView(part);
                          }}
                        >
                          <div className="px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2">
                                  <h4 className="text-base font-semibold text-white">{part.partNo}</h4>
                                  {part.status ? (
                                    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${
                                      part.status === 'PO Made' ? 'bg-green-500/20 text-green-300' :
                                      part.status === 'Need PO' ? 'bg-amber-500/20 text-amber-300' :
                                      part.status === 'Tech Pickup' ? 'bg-blue-500/20 text-blue-300' :
                                      'bg-slate-500/20 text-slate-300'
                                    }`}>
                                      {part.status}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-300">
                                  <div><span className="text-slate-400">Distributor:</span> {part.partDist || '—'}</div>
                                  <div><span className="text-slate-400">Description:</span> {part.partDesc || '—'}</div>
                                  <div><span className="text-slate-400">Visit ID:</span> {part.visitId || '—'}</div>
                                  <div><span className="text-slate-400">Quantity:</span> {part.quantity || '—'}</div>
                                  {part.poNo ? (
                                    <div><span className="text-slate-400">PO No:</span> {part.poNo}</div>
                                  ) : null}
                                  {part.orderNo ? (
                                    <div><span className="text-slate-400">Order #:</span> {part.orderNo}</div>
                                  ) : null}
                                </div>
                              </div>
                              <button
                                type="button"
                                className="rounded border border-blue-400/40 bg-blue-600/20 px-3 py-1.5 text-xs font-semibold text-blue-200 transition hover:bg-blue-600/30"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setIsPartListModalOpen(false);
                                  loadPartForView(part);
                                }}
                              >
                                View Details
                              </button>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {/* Part Details Modal */}
            {viewingPartEntry ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6 backdrop-blur-sm">
                <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-white/15 bg-slate-900 p-5 text-white shadow-2xl">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Part Details</p>
                      <h3 className="text-xl font-bold text-white">{viewingPartEntry.partNo} — {viewingPartEntry.status || "No status"}</h3>
                      <p className="text-sm text-slate-400 mt-1">Added {new Date(viewingPartEntry.id).toLocaleString()} by {viewingPartEntry.createdBy}</p>
                    </div>
                    <button
                      type="button"
                      onClick={closePartView}
                      className="rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-200/40"
                    >
                      Close
                    </button>
                  </div>

                  {/* Part Information */}
                  <div className="mt-4">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Part Information</div>
                    <div className="grid gap-3 md:grid-cols-3 text-sm text-slate-200">
                      <div className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"><span className="font-semibold text-slate-400">Part No:</span> {viewingPartEntry.partNo || "—"}</div>
                      <div className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"><span className="font-semibold text-slate-400">Distributor:</span> {viewingPartEntry.partDist || "—"}</div>
                      <div className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"><span className="font-semibold text-slate-400">Description:</span> {viewingPartEntry.partDesc || "—"}</div>
                      <div className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"><span className="font-semibold text-slate-400">Status:</span> {viewingPartEntry.status || "—"}</div>
                      <div className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"><span className="font-semibold text-slate-400">Visit ID:</span> {viewingPartEntry.visitId || "—"}</div>
                      <div className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"><span className="font-semibold text-slate-400">Quantity:</span> {viewingPartEntry.quantity || "—"}</div>
                    </div>
                  </div>

                  {/* Pricing Information */}
                  {(viewingPartEntry.partPrice || viewingPartEntry.coreValue || viewingPartEntry.shipCost || viewingPartEntry.markup) ? (
                    <div className="mt-4">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-green-300">Pricing Information</div>
                      <div className="grid gap-3 md:grid-cols-4 text-sm text-slate-200">
                        {viewingPartEntry.partPrice ? (
                          <div className="rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2"><span className="font-semibold text-slate-400">Part Price:</span> ${viewingPartEntry.partPrice}</div>
                        ) : null}
                        {viewingPartEntry.coreValue ? (
                          <div className="rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2"><span className="font-semibold text-slate-400">Core Value:</span> ${viewingPartEntry.coreValue}</div>
                        ) : null}
                        {viewingPartEntry.shipCost ? (
                          <div className="rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2"><span className="font-semibold text-slate-400">Ship Cost:</span> ${viewingPartEntry.shipCost}</div>
                        ) : null}
                        {viewingPartEntry.markup ? (
                          <div className="rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2"><span className="font-semibold text-slate-400">Markup:</span> {viewingPartEntry.markup}%</div>
                        ) : null}
                        {viewingPartEntry.totalMarkup ? (
                          <div className="rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2"><span className="font-semibold text-slate-400">Total:</span> ${viewingPartEntry.totalMarkup}</div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {/* Order & Tracking Information */}
                  {(viewingPartEntry.poNo || viewingPartEntry.orderNo || viewingPartEntry.invoiceNo || viewingPartEntry.inTracking) ? (
                    <div className="mt-4">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-blue-300">Order & Tracking</div>
                      <div className="grid gap-3 md:grid-cols-3 text-sm text-slate-200">
                        {viewingPartEntry.poNo ? (
                          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2"><span className="font-semibold text-slate-400">PO No:</span> {viewingPartEntry.poNo}</div>
                        ) : null}
                        {viewingPartEntry.poDate ? (
                          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2"><span className="font-semibold text-slate-400">PO Date:</span> {viewingPartEntry.poDate}</div>
                        ) : null}
                        {viewingPartEntry.orderNo ? (
                          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2"><span className="font-semibold text-slate-400">Order #:</span> {viewingPartEntry.orderNo}</div>
                        ) : null}
                        {viewingPartEntry.invoiceNo ? (
                          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2"><span className="font-semibold text-slate-400">Invoice No:</span> {viewingPartEntry.invoiceNo}</div>
                        ) : null}
                        {viewingPartEntry.invoiceDate ? (
                          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2"><span className="font-semibold text-slate-400">Invoice Date:</span> {viewingPartEntry.invoiceDate}</div>
                        ) : null}
                        {viewingPartEntry.eta ? (
                          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2"><span className="font-semibold text-slate-400">ETA:</span> {viewingPartEntry.eta}</div>
                        ) : null}
                        {viewingPartEntry.inTracking ? (
                          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2"><span className="font-semibold text-slate-400">In Tracking:</span> {viewingPartEntry.inTracking}</div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {/* Return & Credit Information */}
                  {(viewingPartEntry.raNo || viewingPartEntry.outTracking || viewingPartEntry.creditNo) ? (
                    <div className="mt-4">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-300">Return & Credit</div>
                      <div className="grid gap-3 md:grid-cols-3 text-sm text-slate-200">
                        {viewingPartEntry.raNo ? (
                          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2"><span className="font-semibold text-slate-400">RA #:</span> {viewingPartEntry.raNo}</div>
                        ) : null}
                        {viewingPartEntry.raDate ? (
                          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2"><span className="font-semibold text-slate-400">RA Date:</span> {viewingPartEntry.raDate}</div>
                        ) : null}
                        {viewingPartEntry.outTracking ? (
                          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2"><span className="font-semibold text-slate-400">Out Tracking:</span> {viewingPartEntry.outTracking}</div>
                        ) : null}
                        {viewingPartEntry.creditNo ? (
                          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2"><span className="font-semibold text-slate-400">Credit #:</span> {viewingPartEntry.creditNo}</div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {/* Additional Notes */}
                  {(viewingPartEntry.note || viewingPartEntry.claimTo) ? (
                    <div className="mt-4">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Additional Information</div>
                      <div className="space-y-3 text-sm text-slate-200">
                        {viewingPartEntry.note ? (
                          <div className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"><span className="font-semibold text-slate-400">Note:</span> {viewingPartEntry.note}</div>
                        ) : null}
                        {viewingPartEntry.claimTo ? (
                          <div className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"><span className="font-semibold text-slate-400">Claim To:</span> {viewingPartEntry.claimTo}</div>
                        ) : null}
                        <div className="grid grid-cols-2 gap-3">
                          <div className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2">
                            <span className="font-semibold text-slate-400">Hold:</span> {viewingPartEntry.hold === "Hold" ? <span className="ml-2 rounded bg-amber-500/20 px-2 py-0.5 text-amber-300">Hold</span> : "No"}
                          </div>
                          <div className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2">
                            <span className="font-semibold text-slate-400">Cx Paid:</span> {viewingPartEntry.cxPaid === "Paid" ? <span className="ml-2 rounded bg-green-500/20 px-2 py-0.5 text-green-300">Paid</span> : "No"}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {/* Change Log for this specific part */}
                  <div className="mt-6 rounded-lg border border-white/10 bg-slate-900/50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Change Log</div>
                        <div className="text-sm text-slate-300">Changes for this part only</div>
                      </div>
                      <div className="text-xs font-semibold text-blue-300">
                        {partAuditEntries.filter(e => e.after.includes(viewingPartEntry.partNo)).length} change{partAuditEntries.filter(e => e.after.includes(viewingPartEntry.partNo)).length === 1 ? "" : "s"} logged
                      </div>
                    </div>
                    <div className="mt-4 space-y-3">
                      {partAuditEntries.filter(e => e.after.includes(viewingPartEntry.partNo) || e.before.includes(viewingPartEntry.partNo)).length === 0 ? (
                        <div className="px-4 py-8 text-center text-slate-400">
                          No tracked changes yet.
                        </div>
                      ) : (
                        partAuditEntries.filter(e => e.after.includes(viewingPartEntry.partNo) || e.before.includes(viewingPartEntry.partNo)).map((entry) => (
                          <div key={entry.id} className="border border-white/10 rounded-lg bg-slate-900/30 hover:bg-slate-900/50 transition">
                            <div className="grid grid-cols-4 gap-3 px-4 py-3 border-b border-white/10 bg-blue-900/20">
                              <div>
                                <div className="text-xs text-blue-300 font-semibold mb-1">Time</div>
                                <div className="text-sm text-slate-300">{new Date(entry.timestamp).toLocaleString()}</div>
                              </div>
                              <div>
                                <div className="text-xs text-blue-300 font-semibold mb-1">Changed By</div>
                                <div className="text-sm text-slate-300 break-words">{entry.by}</div>
                              </div>
                              <div>
                                <div className="text-xs text-blue-300 font-semibold mb-1">Action</div>
                                <div className="text-sm text-slate-300">{entry.action}</div>
                              </div>
                              <div>
                                <div className="text-xs text-blue-300 font-semibold mb-1">Field</div>
                                <div className="text-sm text-slate-300">{entry.field}</div>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-0">
                              <div className="px-4 py-3 border-r border-white/10">
                                <div className="text-xs text-slate-400 font-semibold mb-2">BEFORE</div>
                                <div className="text-sm text-slate-400">{renderVisitSummary(entry.before)}</div>
                              </div>
                              <div className="px-4 py-3">
                                <div className="text-xs text-green-400 font-semibold mb-2">AFTER</div>
                                <div className="text-sm text-slate-200">{renderVisitSummary(entry.after, entry.before)}</div>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Alert Message Input */}
            <div>
              <h4 className="font-semibold text-slate-300 mb-4">Alert Message</h4>
              <div className="flex gap-2">
                <textarea
                  placeholder="Type an alert message that will display at the top..."
                  className="flex-1 bg-slate-900 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  rows={3}
                  value={newAlertMessage}
                  onChange={(e) => setNewAlertMessage(e.target.value)}
                />
                <button 
                  onClick={addAlertMessage}
                  className="bg-amber-600 hover:bg-amber-700 text-white font-semibold py-2 px-4 rounded text-sm transition"
                >
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
                          {technicianOptions.map((technician) => (
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

      {/* Share Ticket via Internal Messenger Modal (root-level so it's
          available regardless of which tab is active) */}
      {isShareModalOpen ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-slate-900 p-5 text-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-3 mb-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">Internal Messenger</p>
                <h3 className="text-lg font-bold">Send Ticket #{ticketNo}</h3>
              </div>
              <button
                type="button"
                onClick={() => { setIsShareModalOpen(false); setShareQuery(""); setShareMessage(""); setShareError(null); }}
                className="rounded border border-white/15 bg-slate-950 px-2 py-1 text-xs text-slate-300 hover:border-slate-200/40"
              >
                Close
              </button>
            </div>

            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Recipient name</label>
            <input
              autoFocus
              type="text"
              value={shareQuery}
              onChange={(e) => { setShareQuery(e.target.value); setShareError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleShareSubmit(); } }}
              placeholder="Enter teammate name…"
              className="w-full rounded border border-white/15 bg-slate-950 px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
            />

            {shareQuery.trim() && filteredShareContacts.length > 0 ? (
              <div className="mt-2 max-h-40 overflow-y-auto rounded border border-white/10 bg-slate-950/60">
                {filteredShareContacts.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setShareQuery(c.display_name || c.email || "")}
                    className="w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left text-xs hover:bg-emerald-500/10 transition"
                  >
                    <span className="truncate">
                      <span className="font-semibold text-slate-200">{c.display_name || c.email}</span>
                      <span className="text-slate-500 ml-2 text-[10px]">{c.role || ""}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            {shareError ? (
              <div className="mt-3 rounded border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{shareError}</div>
            ) : null}

            <label className="block mt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Message (optional)</label>
            <textarea
              value={shareMessage}
              onChange={(e) => setShareMessage(e.target.value)}
              placeholder="Add a note to send with the ticket…"
              rows={3}
              className="w-full rounded border border-white/15 bg-slate-950 px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 resize-y"
            />
            <div className="mt-1 text-[10px] text-slate-500">
              {shareMessage.trim()
                ? `Recipient will see your note followed by #${ticketNo}.`
                : `Recipient will see just #${ticketNo} (clickable).`}
            </div>

            <button
              type="button"
              onClick={handleShareSubmit}
              disabled={shareSending || !shareQuery.trim()}
              className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-md border border-emerald-400/40 bg-emerald-500/20 px-3 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              {shareSending ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      ) : null}

      {/* Per-model resource link editor (Exploded View / Service Bulletin) */}
      {modelResourceModal ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-slate-900 p-5 text-white shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-200">
                  {modelResourceModal.kind === "exploded" ? "Exploded View link" : "Service Bulletin link"}
                </h3>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  Shared with every ticket using model{" "}
                  <span className="font-mono text-slate-200">{ticket?.model || "—"}</span>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModelResourceModal(null)}
                className="rounded border border-white/15 bg-slate-950 px-2 py-1 text-xs text-slate-300 hover:border-slate-200/40"
              >
                Close
              </button>
            </div>

            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">URL</label>
            <input
              type="url"
              value={modelResourceModal.value}
              onChange={(e) => setModelResourceModal({ ...modelResourceModal, value: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSaveModelResource(); } }}
              placeholder="https://…"
              autoFocus
              className="mt-1 w-full rounded border border-white/15 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-blue-400"
            />

            <div className="mt-4 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setModelResourceModal({ ...modelResourceModal, value: "" })}
                className="text-xs text-slate-400 hover:text-rose-300"
                title="Clear the saved link"
              >
                Clear link
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setModelResourceModal(null)}
                  className="rounded-lg border border-white/15 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-200/40"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveModelResource}
                  disabled={modelResourceSaving || !ticket?.model}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  {modelResourceSaving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Marcone Parts Order modal — opens when Submit POs catches at least
          one Marcone part. Non-Marcone parts already went through the
          silent batch flow before this point. */}
      <MarconePartsOrderModal
        open={marconeModal.open}
        onClose={() => setMarconeModal({ open: false, parts: [] })}
        parts={marconeModal.parts.map((p): MarconePartLine => ({
          id: p.id,
          partNo: p.partNo,
          partDesc: p.partDesc,
          partPrice: p.partPrice,
          coreValue: p.coreValue,
          quantity: p.quantity,
        }))}
        ticketNo={ticketNo}
        defaultShipTo={defaultShipTo}
        addressBook={partAddressBook}
        onPlaceOrder={handleMarconePlaceOrder}
      />

      {/* Truck Stock batch modal — opens from the Truck Stock button next
          to Submit POs. Fulfils Need PO parts from in-house branches
          instead of placing distributor POs. */}
      <TruckStockBatchModal
        open={truckStockModal.open}
        onClose={() => setTruckStockModal({ open: false, parts: [] })}
        ticketNo={ticketNo}
        parts={truckStockModal.parts.map((p) => ({
          id: p.id,
          partNo: p.partNo,
          partDesc: p.partDesc,
          quantity: p.quantity,
        }))}
        fetchStock={async (partNos) => {
          const { supabase } = await import("@/lib/supabase/client");
          const trimmed = partNos.map((p) => p.trim()).filter(Boolean);
          if (trimmed.length === 0) return [];
          const { data, error } = await supabase
            .from("truck_stock")
            .select("*")
            .in("part_no", trimmed)
            .gt("quantity", 0);
          if (error) {
            console.warn("truck stock batch fetch error:", error.message);
            return [];
          }
          return (data ?? []).map((r: any) => ({
            id: r.id,
            branch: r.branch ?? "",
            partNo: r.part_no ?? "",
            description: r.description ?? "",
            manufacturer: r.manufacturer ?? "",
            quantity: Number(r.quantity ?? 0),
            storageLocation: r.storage_location ?? "",
            notes: r.notes ?? "",
            updatedAt: r.updated_at ?? undefined,
          }));
        }}
        onConfirm={handleTruckStockBatchConfirm}
      />

      {/* Squaretrade Appointment Completion URL — per-ticket dialog.
          Each Squaretrade ticket has its own unique token, so the
          claims team pastes the URL they received from Squaretrade
          and we persist it under this ticket number. Saving stamps
          the bare token form too, so they can paste either the
          whole URL or just the token. */}
      {squaretradeEditOpen && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4"
          onClick={() => setSquaretradeEditOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-white/15 bg-slate-900/95 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-white">Squaretrade appointment URL</h3>
                <p className="mt-1 text-xs text-slate-400">
                  Auto-synced from ServicePower running notes for ticket #{ticketNo}. Paste a full URL or just the token here only if SP didn't include the link.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSquaretradeEditOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <label className="mt-4 block">
              <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">URL or Token</span>
              <input
                value={squaretradeDraft}
                onChange={(e) => setSquaretradeDraft(e.target.value)}
                placeholder="https://www.squaretrade.com/.../confirmappointment?...&token=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="mt-1 w-full rounded border border-white/15 bg-slate-800/80 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-400 focus:outline-none"
                autoFocus
              />
            </label>
            <p className="mt-2 text-[11px] text-slate-500">
              Example token: <code className="text-slate-300">458838a4-a266-45c5-8fa7-f64560fb9c04</code>
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              {squaretradeUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setSquaretradeUrl(ticketNo, "");
                    setSquaretradeUrlState("");
                    setSquaretradeDraft("");
                    setSquaretradeEditOpen(false);
                  }}
                  className="rounded border border-rose-400/40 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-400/10"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => setSquaretradeEditOpen(false)}
                className="rounded border border-white/15 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const raw = squaretradeDraft.trim();
                  if (!raw) {
                    setSquaretradeUrl(ticketNo, "");
                    setSquaretradeUrlState("");
                    setSquaretradeEditOpen(false);
                    return;
                  }
                  // If it doesn't look like a URL, treat it as a bare
                  // token and build the canonical URL around it.
                  const looksLikeUrl = /^https?:\/\//i.test(raw);
                  const finalUrl = looksLikeUrl ? raw : buildSquaretradeUrlFromToken(raw);
                  const saved = setSquaretradeUrl(ticketNo, finalUrl);
                  setSquaretradeUrlState(saved);
                  setSquaretradeEditOpen(false);
                }}
                className="rounded bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-400"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </>
  );
}
