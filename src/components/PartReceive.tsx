import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, Check, Columns3, History, PackageCheck, CalendarRange } from "lucide-react";
import { LOCATIONS } from "@/lib/locations";
import { branchDonutHex } from "@/lib/branchDisplay";
import { DonutSummaryCard, CATEGORICAL_DONUT_HEX, DONUT_OTHER_COLOR, DONUT_TOP_N, topDonutSlices } from "@/components/DonutSummaryCard";
import {
  getPartsToReceive,
  updatePartReceiveRow,
  getDistinctPartSources,
  getDeliveredDates,
  saveDeliveredDate,
  type PartReceiveRow,
} from "@/lib/supabase/partReceive";
import { marconeTrackDelivery } from "@/lib/marconeApi";
import { logActivity, getActivityLog, activityActionLabel, type HrActivityLogEntry } from "@/lib/supabase/hrActivityLog";
import { addPendingDoneItem, removePendingDoneItem } from "@/lib/partsDoneQueue";
import { FloatingHorizontalScrollbar } from "@/components/FloatingHorizontalScrollbar";
import { PART_STATUS_OPTIONS } from "@/lib/partStatuses";
import { TicketColumnFilter } from "@/components/TicketColumnFilter";
import { BranchBarChart } from "@/components/BranchBarChart";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

const PART_RECEIVE_ACTIVITY_TARGET_TYPE = "part_receive";
// Label used both for this page's own activity log entries and for the
// shared cross-page "done" queue behind the Parts hub's "I'm Done" button.
const PARTS_DONE_QUEUE_SOURCE = "Part Receive";
function partReceiveActivityLabel(item: Pick<PartReceiveRow, "partNo" | "poNo" | "id">): string {
  return `${item.partNo || item.id} · PO ${item.poNo || "—"}`;
}

// Ship methods that don't route to any carrier tracking site at all — the
// part was picked up in person, not shipped, so there's no tracking number
// to look up regardless of what ended up (or didn't) in the tracking field.
const NO_TRACKING_SHIP_METHODS = new Set(["will call", "pcr will call"]);

function getTrackingUrl(tracking: string, partFrom: string, shipMethod: string) {
  const value = tracking.trim();
  const source = partFrom.trim().toLowerCase();
  const method = shipMethod.trim().toLowerCase();

  if (NO_TRACKING_SHIP_METHODS.has(method)) return "#";

  // Prefer the real shipping method actually selected when the PO was
  // placed (Marcone/Encompass order flow) over guessing from the tracking
  // number's shape — a real carrier name is never ambiguous the way a bare
  // number pattern can be.
  if (value && method) {
    if (method.startsWith("fedex")) {
      return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(value)}`;
    }
    if (method.startsWith("ups")) {
      return `https://www.ups.com/track?track=yes&trackNums=${encodeURIComponent(value)}`;
    }
    if (method.startsWith("usps")) {
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(value)}`;
    }
    // LTL freight and anything else without a universal tracking site fall
    // through to the pattern-matching / search fallback below.
  }

  if (!value) return "#";
  if (source.includes("marcone")) {
    return `https://www.google.com/search?q=${encodeURIComponent(`site:marcone.com ${value} tracking`)}`;
  }
  if (value.startsWith("1Z")) {
    return `https://www.ups.com/track?track=yes&trackNums=${encodeURIComponent(value)}`;
  }
  if (/^\d{12,14}$/.test(value)) {
    return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(value)}`;
  }
  if (/^(94|93|92|95|96)/.test(value)) {
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(value)}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(value + " tracking")}`;
}

function ticketStatusClass(status: string): string {
  const s = status.toUpperCase();
  if (s.includes("CANCEL")) return "text-red-400";
  if (s.startsWith("CL-")) return "text-green-400";
  return "text-blue-400";
}

// Weekday count strictly AFTER `fromISO` up through `toISO` (inclusive),
// skipping Sat/Sun — e.g. an ETA on Friday with today being the
// following Monday is 1 day late, not 3.
function businessDaysBetween(fromISO: string, toISO: string): number {
  const from = new Date(fromISO);
  const to = new Date(toISO);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  from.setHours(0, 0, 0, 0);
  to.setHours(0, 0, 0, 0);
  if (to <= from) return 0;
  let count = 0;
  const cur = new Date(from);
  cur.setDate(cur.getDate() + 1);
  while (cur <= to) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// Days late vs. ETA, excluding weekends — measured to the receive date
// once received, otherwise still counting up against today. No ETA
// means there's nothing to measure against.
function agingDays(item: PartReceiveRow): number | null {
  if (!item.eta) return null;
  const asOf = item.qtyReceived > 0 && item.receivedDate ? item.receivedDate : new Date().toISOString().slice(0, 10);
  return businessDaysBetween(item.eta, asOf);
}

function agingClass(days: number | null): string {
  if (days === null || days <= 0) return "text-slate-500";
  if (days <= 2) return "text-amber-400";
  return "text-red-400";
}

// The tracking number Marcone's /orders/trackpackage can look up (FedEx or
// UPS only) — null for USPS, will-call pickups, or free-text entries.
function carrierTrackingNumber(item: Pick<PartReceiveRow, "tracking" | "shipMethod">): string | null {
  if (NO_TRACKING_SHIP_METHODS.has(item.shipMethod.trim().toLowerCase())) return null;
  const tn = item.tracking.split(/[,\s/;|]+/).map((v) => v.trim()).find(Boolean) ?? "";
  if (/^1Z[0-9A-Z]{16}$/i.test(tn)) return tn;
  if (/^\d{12,15}$/.test(tn)) return tn;
  if (/^\d{20,22}$/.test(tn) && !/^(9[1-6])/.test(tn)) return tn;
  return null;
}

function agingLabel(days: number | null): string {
  return days === null ? "—" : days > 0 ? `${days}d` : "On time";
}

// Column visibility (persisted per browser) — same "Columns (n/m)" /
// "Show columns" panel pattern as TicketList.tsx's own column toggle.
const PART_RECEIVE_COLUMNS = [
  { key: "receive", label: "Receive" },
  { key: "partStatus", label: "Part Status" },
  { key: "uniqueId", label: "Unique ID*" },
  { key: "poNumber", label: "PO Number" },
  { key: "partsNote", label: "Parts Note" },
  { key: "partFrom", label: "Part From" },
  { key: "poDate", label: "P/O Date" },
  { key: "orderNo", label: "Order No" },
  { key: "invoiceNo", label: "Invoice #" },
  { key: "partNumber", label: "Part Number*" },
  { key: "partDesc", label: "Part Desc*" },
  { key: "eta", label: "ETA" },
  { key: "aging", label: "Aging" },
  { key: "deliveredDate", label: "Delivered Date" },
  { key: "receiveDate", label: "Receive Date" },
  { key: "tracking", label: "Tracking" },
  { key: "ticketNo", label: "Ticket No" },
  { key: "ticketStatus", label: "Ticket Status" },
  { key: "tech", label: "Tech" },
  { key: "schedule", label: "Schedule" },
  { key: "qtyOrdered", label: "Quantity Ordered" },
  { key: "qtyReceived", label: "Quantity Received" },
  { key: "partCost", label: "$ Part" },
  { key: "coreCost", label: "$ Core" },
] as const;
type PartReceiveColumnKey = (typeof PART_RECEIVE_COLUMNS)[number]["key"];
// Left-to-right groups, matching the table's two-row header (a spanning
// "Ticket" group over 4 sub-columns, flanked by ungrouped columns) — used
// to keep colSpans correct as columns are hidden/shown.
const PART_RECEIVE_LEADING_COLS: readonly PartReceiveColumnKey[] = [
  "receive", "partStatus", "uniqueId", "poNumber", "partsNote", "partFrom", "poDate", "orderNo", "invoiceNo", "partNumber", "partDesc", "eta", "aging", "deliveredDate", "receiveDate", "tracking",
];
const PART_RECEIVE_TICKET_GROUP_COLS: readonly PartReceiveColumnKey[] = ["ticketNo", "ticketStatus", "tech", "schedule"];
const PART_RECEIVE_TRAILING_COLS: readonly PartReceiveColumnKey[] = ["qtyOrdered", "qtyReceived", "partCost", "coreCost"];

const PART_RECEIVE_COLUMN_VISIBILITY_KEY = "ahs:part-receive:visible-columns";

// Text each column is filtered on — matches what the cell displays.
const PART_RECEIVE_FILTER_VALUE: Record<PartReceiveColumnKey, (item: PartReceiveRow) => string> = {
  receive: (i) => (i.qtyReceived > 0 ? "Received" : "Not Received"),
  partStatus: (i) => i.status,
  uniqueId: (i) => i.id,
  poNumber: (i) => i.poNo,
  partsNote: (i) => i.note,
  partFrom: (i) => i.partFrom,
  poDate: (i) => i.poDate,
  orderNo: (i) => i.orderNo,
  invoiceNo: (i) => i.invoiceNo,
  partNumber: (i) => i.partNo,
  partDesc: (i) => i.partDesc,
  eta: (i) => i.eta,
  aging: (i) => agingLabel(agingDays(i)),
  deliveredDate: (i) => i.deliveredDate,
  receiveDate: (i) => i.receivedDate,
  tracking: (i) => i.tracking,
  ticketNo: (i) => i.ticketNo,
  ticketStatus: (i) => i.ticketStatus,
  tech: (i) => i.tech,
  schedule: (i) => i.schedule,
  qtyOrdered: (i) => String(i.quantity),
  qtyReceived: (i) => String(i.qtyReceived),
  partCost: (i) => i.partPrice.toFixed(2),
  coreCost: (i) => i.coreValue.toFixed(2),
};

function loadPartReceiveVisibleColumns(): Record<string, boolean> {
  const allVisible = Object.fromEntries(PART_RECEIVE_COLUMNS.map((c) => [c.key, true]));
  try {
    const raw = localStorage.getItem(PART_RECEIVE_COLUMN_VISIBILITY_KEY);
    if (!raw) return allVisible;
    const saved = JSON.parse(raw) as Record<string, boolean>;
    return { ...allVisible, ...saved };
  } catch {
    return allVisible;
  }
}

// Same amber/green pairing already used everywhere else on this page for
// "not received" vs "received" (the badge counts, the totals row) — the
// Status donut just visualizes the same two numbers, so it needs the same
// colors.
const NO_LOCATION = "(No location)";

const DONUT_NOT_RECEIVED_COLOR = "#f59e0b";
const DONUT_RECEIVED_COLOR = "#22c55e";

export function PartReceive({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const [location, setLocation] = useState("");
  const [partFrom, setPartFrom] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [ticketFilter, setTicketFilter] = useState("");
  const [showNotReceived, setShowNotReceived] = useState(true);
  const [showReceived, setShowReceived] = useState(true);
  const [receiveItems, setReceiveItems] = useState<PartReceiveRow[]>([]);
  const [partSources, setPartSources] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  // Captures a field's value the moment editing starts (onFocus, or first
  // keystroke for the batch-saved Invoice # field) so the eventual save
  // can log a real "from → to" instead of just "changed" — keyed
  // "<field>:<rowId>", cleared once read.
  const editStartRef = useRef<Record<string, string>>({});
  const markEditStart = (field: string, id: string, value: string) => {
    const key = `${field}:${id}`;
    if (!(key in editStartRef.current)) editStartRef.current[key] = value;
  };
  const takeEditStart = (field: string, id: string): string | undefined => {
    const key = `${field}:${id}`;
    const v = editStartRef.current[key];
    delete editStartRef.current[key];
    return v;
  };
  const [activityLogOpen, setActivityLogOpen] = useState(false);
  const [activityLogEntries, setActivityLogEntries] = useState<HrActivityLogEntry[]>([]);
  const [activityLogLoading, setActivityLogLoading] = useState(false);
  const [activityLogError, setActivityLogError] = useState<string | null>(null);
  const openActivityLog = () => {
    setActivityLogOpen(true);
    setActivityLogLoading(true);
    setActivityLogError(null);
    getActivityLog({ targetType: PART_RECEIVE_ACTIVITY_TARGET_TYPE, limit: 200 })
      .then(setActivityLogEntries)
      .catch((err) => setActivityLogError(err instanceof Error ? err.message : "Failed to load activity log"))
      .finally(() => setActivityLogLoading(false));
  };
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(() =>
    typeof window !== "undefined"
      ? loadPartReceiveVisibleColumns()
      : Object.fromEntries(PART_RECEIVE_COLUMNS.map((c) => [c.key, true]))
  );
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const isColVisible = (key: PartReceiveColumnKey) => visibleColumns[key] !== false;
  const toggleColumn = (key: PartReceiveColumnKey) => {
    setVisibleColumns((prev) => {
      const next = { ...prev, [key]: prev[key] === false };
      try { localStorage.setItem(PART_RECEIVE_COLUMN_VISIBILITY_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };
  const showAllPartReceiveColumns = () => {
    const all = Object.fromEntries(PART_RECEIVE_COLUMNS.map((c) => [c.key, true]));
    setVisibleColumns(all);
    try { localStorage.setItem(PART_RECEIVE_COLUMN_VISIBILITY_KEY, JSON.stringify(all)); } catch { /* ignore */ }
  };

  // Per tracking-number lookup state for the Delivered Date column:
  // "checking" while in flight, otherwise the latest carrier scan text for
  // packages that aren't delivered yet ("" when Marcone had nothing).
  const [deliveryLookup, setDeliveryLookup] = useState<Record<string, "checking" | { lastEvent: string }>>({});

  const lookUpDeliveries = async (items: PartReceiveRow[]) => {
    const pending = new Map<string, string[]>();
    for (const item of items) {
      if (item.deliveredDate) continue;
      const tn = carrierTrackingNumber(item);
      if (!tn) continue;
      const ids = pending.get(tn);
      if (ids) ids.push(item.id);
      else pending.set(tn, [item.id]);
    }
    const queue = Array.from(pending.entries());
    setDeliveryLookup((prev) => ({ ...prev, ...Object.fromEntries(queue.map(([tn]) => [tn, "checking" as const])) }));
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const [tn, ids] = next;
        const res = await marconeTrackDelivery(tn);
        const info = res.success ? res.data : undefined;
        if (info?.deliveredDate) {
          const { deliveredDate, deliveredLocation = "" } = info;
          setReceiveItems((current) => current.map((r) => (ids.includes(r.id) ? { ...r, deliveredDate, deliveredLocation } : r)));
          await Promise.all(ids.map((id) => saveDeliveredDate(id, deliveredDate, deliveredLocation).catch((err) => console.warn("Couldn't save delivered date (is migration 0325 applied?):", err))));
        }
        setDeliveryLookup((prev) => ({ ...prev, [tn]: { lastEvent: info?.lastEvent ?? "" } }));
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
  };

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    Promise.all([getPartsToReceive(), getDeliveredDates()])
      .then(([items, delivered]) => {
        const merged = items.map((item) => {
          const d = delivered.get(item.id);
          return d ? { ...item, deliveredDate: d.date, deliveredLocation: d.location } : item;
        });
        setReceiveItems(merged);
        lookUpDeliveries(merged);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
    getDistinctPartSources().then(setPartSources).catch((err) => console.error("Failed to load part sources:", err));
  }, []);

  const setLocalQty = (id: string, value: string) => {
    const nextValue = Number.parseFloat(value);
    setReceiveItems((current) =>
      current.map((item) =>
        item.id === id
          ? { ...item, qtyReceived: Number.isNaN(nextValue) ? 0 : Math.min(item.quantity, Math.max(0, nextValue)) }
          : item
      )
    );
  };
  const persistQty = async (id: string, value: number) => {
    try {
      await updatePartReceiveRow(id, { qtyReceived: value });
      setSaveError(null);
      const before = takeEditStart("qty", id);
      if (before !== undefined && before !== String(value)) {
        const item = receiveItems.find((r) => r.id === id);
        logActivity({
          action: "part_receive_qty_changed",
          targetType: PART_RECEIVE_ACTIVITY_TARGET_TYPE,
          targetId: id,
          targetLabel: item ? partReceiveActivityLabel(item) : id,
          details: { from: before, to: value },
        });
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save quantity received");
    }
  };
  // The single "Receive" checkbox — checking it marks the whole line
  // fully received (saves immediately, same as the rest of this table);
  // the Quantity Received number field below still exists for partial
  // receives, so unchecking after a partial entry resets to 0 rather
  // than leaving a half-received row in a checked state.
  //
  // Also stamps Receive Date to today (unless one's already set, e.g. a
  // backdated manual entry) — Aging freezes as of that date, so checking
  // this box is what actually stops it counting up. Without also setting
  // a receive date, qtyReceived alone wouldn't be enough: Aging falls
  // back to "today" whenever receivedDate is blank, so it would keep
  // climbing even on a row marked received.
  const handleToggleReceived = (id: string, checked: boolean) => {
    const item = receiveItems.find((r) => r.id === id);
    if (!item) return;
    const confirmed = checked
      ? confirm(`Mark ${item.partNo || "this part"} as received? This sets Quantity Received to ${item.quantity} and stamps today's date as the Receive Date, which freezes its Aging.`)
      : confirm(`Undo received status for ${item.partNo || "this part"}? This clears its Quantity Received and Receive Date, and Aging will start counting again.`);
    if (!confirmed) return;
    const nextQty = checked ? item.quantity : 0;
    const nextReceivedDate = checked ? item.receivedDate || new Date().toISOString().slice(0, 10) : "";
    setReceiveItems((current) =>
      current.map((r) => (r.id === id ? { ...r, qtyReceived: nextQty, receivedDate: nextReceivedDate } : r))
    );
    updatePartReceiveRow(id, { qtyReceived: nextQty, receivedDate: nextReceivedDate })
      .then(() => {
        setSaveError(null);
        logActivity({
          action: checked ? "part_receive_marked_received" : "part_receive_unmarked_received",
          targetType: PART_RECEIVE_ACTIVITY_TARGET_TYPE,
          targetId: id,
          targetLabel: partReceiveActivityLabel(item),
          details: { quantity: nextQty, receivedDate: nextReceivedDate || null },
        });
        // Feeds the Parts hub's single "I'm Done" button (see
        // src/lib/partsDoneQueue.ts) — checking adds this row to the
        // shared cross-page queue, unchecking pulls it back out. Sending
        // the actual notification happens only on the hub page now.
        if (checked) {
          addPendingDoneItem(PARTS_DONE_QUEUE_SOURCE, id, partReceiveActivityLabel(item), item.location);
        } else {
          removePendingDoneItem(PARTS_DONE_QUEUE_SOURCE, id);
        }
      })
      .catch((err) => setSaveError(err instanceof Error ? err.message : "Failed to save receive status"));
  };

  const setLocalReceivedDate = (id: string, value: string) => {
    setReceiveItems((current) => current.map((item) => (item.id === id ? { ...item, receivedDate: value } : item)));
  };
  const persistReceivedDate = async (id: string, value: string) => {
    try {
      await updatePartReceiveRow(id, { receivedDate: value });
      setSaveError(null);
      const before = takeEditStart("receiveDate", id);
      if (before !== undefined && before !== value) {
        const item = receiveItems.find((r) => r.id === id);
        logActivity({
          action: "part_receive_date_changed",
          targetType: PART_RECEIVE_ACTIVITY_TARGET_TYPE,
          targetId: id,
          targetLabel: item ? partReceiveActivityLabel(item) : id,
          details: { from: before || null, to: value || null },
        });
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save receive date");
    }
  };

  // Shares the same `parts.note` column as the ticket page's Part
  // Transaction "Note" field — one note per part, editable from either
  // place, not a separate Part-Receive-only note.
  const setLocalNote = (id: string, value: string) => {
    setReceiveItems((current) => current.map((item) => (item.id === id ? { ...item, note: value } : item)));
  };
  const [noteModal, setNoteModal] = useState<{ id: string; label: string; draft: string } | null>(null);
  const saveNoteModal = () => {
    if (!noteModal) return;
    const current = receiveItems.find((r) => r.id === noteModal.id);
    if (current && current.note !== noteModal.draft) {
      markEditStart("note", noteModal.id, current.note);
      setLocalNote(noteModal.id, noteModal.draft);
      persistNote(noteModal.id, noteModal.draft);
    }
    setNoteModal(null);
  };
  const persistNote = async (id: string, value: string) => {
    try {
      await updatePartReceiveRow(id, { note: value });
      setSaveError(null);
      const before = takeEditStart("note", id);
      if (before !== undefined && before !== value) {
        const item = receiveItems.find((r) => r.id === id);
        logActivity({
          action: "part_receive_note_changed",
          targetType: PART_RECEIVE_ACTIVITY_TARGET_TYPE,
          targetId: id,
          targetLabel: item ? partReceiveActivityLabel(item) : id,
          details: { from: before || null, to: value || null },
        });
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save note");
    }
  };

  const handleStatusChange = (id: string, nextStatus: string) => {
    const item = receiveItems.find((r) => r.id === id);
    if (!item || item.status === nextStatus) return;
    const prevStatus = item.status;
    setReceiveItems((current) => current.map((r) => (r.id === id ? { ...r, status: nextStatus } : r)));
    updatePartReceiveRow(id, { status: nextStatus })
      .then(() => {
        setSaveError(null);
        logActivity({
          action: "part_receive_status_changed",
          targetType: PART_RECEIVE_ACTIVITY_TARGET_TYPE,
          targetId: id,
          targetLabel: partReceiveActivityLabel(item),
          details: { from: prevStatus || null, to: nextStatus },
        });
      })
      .catch((err) => {
        setReceiveItems((current) => current.map((r) => (r.id === id ? { ...r, status: prevStatus } : r)));
        setSaveError(err instanceof Error ? err.message : "Failed to save part status");
      });
  };

  const [columnFilters, setColumnFilters] = useState<Partial<Record<PartReceiveColumnKey, Set<string>>>>({});
  const colFilter = (key: PartReceiveColumnKey) => (
    <TicketColumnFilter
      options={receiveItems.map((i) => PART_RECEIVE_FILTER_VALUE[key](i))}
      selected={columnFilters[key] ?? new Set()}
      onChange={(next) => setColumnFilters((prev) => ({ ...prev, [key]: next }))}
      label={`Filter by ${PART_RECEIVE_COLUMNS.find((c) => c.key === key)?.label ?? key}`}
    />
  );

  const [dirtyInvoiceIds, setDirtyInvoiceIds] = useState<Set<string>>(new Set());
  const [savingInvoices, setSavingInvoices] = useState(false);
  const [invoiceSaveMessage, setInvoiceSaveMessage] = useState<string | null>(null);

  const setLocalInvoiceNo = (id: string, value: string) => {
    if (!dirtyInvoiceIds.has(id)) {
      const current = receiveItems.find((r) => r.id === id);
      if (current) markEditStart("invoiceNo", id, current.invoiceNo);
    }
    setReceiveItems((current) => current.map((item) => (item.id === id ? { ...item, invoiceNo: value } : item)));
    setDirtyInvoiceIds((prev) => new Set(prev).add(id));
    setInvoiceSaveMessage(null);
  };

  const saveAllInvoiceChanges = async () => {
    if (dirtyInvoiceIds.size === 0) return;
    setSavingInvoices(true);
    setSaveError(null);
    const ids = Array.from(dirtyInvoiceIds);
    try {
      await Promise.all(
        ids.map((id) => {
          const item = receiveItems.find((r) => r.id === id);
          return item ? updatePartReceiveRow(id, { invoiceNo: item.invoiceNo }) : Promise.resolve();
        })
      );
      ids.forEach((id) => {
        const item = receiveItems.find((r) => r.id === id);
        const before = takeEditStart("invoiceNo", id);
        if (item && before !== undefined && before !== item.invoiceNo) {
          logActivity({
            action: "part_receive_invoice_changed",
            targetType: PART_RECEIVE_ACTIVITY_TARGET_TYPE,
            targetId: id,
            targetLabel: partReceiveActivityLabel(item),
            details: { from: before || null, to: item.invoiceNo || null },
          });
        }
      });
      setDirtyInvoiceIds(new Set());
      setInvoiceSaveMessage(`Saved ${ids.length} invoice ${ids.length === 1 ? "number" : "numbers"}.`);
      window.setTimeout(() => setInvoiceSaveMessage(null), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save invoice numbers");
    } finally {
      setSavingInvoices(false);
    }
  };

  const filteredItems = receiveItems.filter((item) => {
    if (location && (item.location || NO_LOCATION) !== location) return false;
    if (partFrom && item.partFrom !== partFrom) return false;
    if (ticketFilter && !item.ticketNo.toLowerCase().includes(ticketFilter.trim().toLowerCase())) return false;
    if (dateFrom || dateTo) {
      if (!item.poDate) return false;
      const rowDate = new Date(item.poDate);
      if (dateFrom && rowDate < new Date(dateFrom)) return false;
      if (dateTo && rowDate > new Date(dateTo)) return false;
    }
    for (const [key, selected] of Object.entries(columnFilters) as [PartReceiveColumnKey, Set<string>][]) {
      if (selected.size > 0 && !selected.has(PART_RECEIVE_FILTER_VALUE[key](item))) return false;
    }
    const isReceived = item.qtyReceived > 0;
    return isReceived ? showReceived : showNotReceived;
  });

  const totals = {
    total: filteredItems.reduce((sum, item) => sum + item.quantity, 0),
    rcvd: filteredItems.reduce((sum, item) => sum + item.qtyReceived, 0),
    partCost: filteredItems.reduce((sum, item) => sum + item.partPrice, 0),
    coreCost: filteredItems.reduce((sum, item) => sum + item.coreValue, 0),
  };

  // Per-branch counts for the summary chips below — deliberately built
  // from every location at once (ignores the Location filter itself,
  // since that's what the chips let you set) and ignores the Received/
  // Not Received checkboxes too, since the whole point is to show both
  // counts side by side regardless of which rows the table is currently
  // showing. Still respects Part From / PO Date Range, since those
  // narrow "which parts" rather than "which branch".
  const branchScoped = receiveItems.filter((item) => {
    if (partFrom && item.partFrom !== partFrom) return false;
    if (dateFrom || dateTo) {
      if (!item.poDate) return false;
      const rowDate = new Date(item.poDate);
      if (dateFrom && rowDate < new Date(dateFrom)) return false;
      if (dateTo && rowDate > new Date(dateTo)) return false;
    }
    return true;
  });
  // Built from the locations actually on these parts, not the LOCATIONS
  // constant — a ticket whose location is spelled differently or blank
  // would otherwise be dropped, making this total disagree with the rest.
  const branchSummary = Array.from(new Set(branchScoped.map((item) => item.location || NO_LOCATION))).map((loc) => {
    const items = branchScoped.filter((item) => (item.location || NO_LOCATION) === loc);
    return {
      location: loc,
      notReceived: items.filter((item) => item.qtyReceived <= 0).length,
      received: items.filter((item) => item.qtyReceived > 0).length,
    };
  })
    .filter((b) => b.notReceived + b.received > 0)
    .sort((a, b) => b.notReceived - a.notReceived || a.location.localeCompare(b.location));
  const allBranchTotals = {
    notReceived: branchScoped.filter((item) => item.qtyReceived <= 0).length,
    received: branchScoped.filter((item) => item.qtyReceived > 0).length,
  };
  // Same total each location badge shows (not received + received) —
  // reused directly as the Location donut's slice values, so the donut and
  // the list beside it can never disagree with each other.
  const locationDonutData = topDonutSlices(
    Object.fromEntries(branchSummary.map((b) => [b.location, b.notReceived + b.received])),
    DONUT_TOP_N
  );

  // Part From donut's base scope — mirrors branchScoped's own reasoning,
  // just excluding the ONE filter this chart itself visualizes (Part From)
  // instead of Location, so picking a source in the dropdown doesn't just
  // collapse this donut down to a single 100% slice.
  const partFromScoped = receiveItems.filter((item) => {
    if (location && (item.location || NO_LOCATION) !== location) return false;
    if (dateFrom || dateTo) {
      if (!item.poDate) return false;
      const rowDate = new Date(item.poDate);
      if (dateFrom && rowDate < new Date(dateFrom)) return false;
      if (dateTo && rowDate > new Date(dateTo)) return false;
    }
    return true;
  });
  const partFromCounts: Record<string, number> = {};
  for (const item of partFromScoped) {
    const key = item.partFrom?.trim() || "Unspecified";
    partFromCounts[key] = (partFromCounts[key] ?? 0) + 1;
  }
  const partFromDonutData = topDonutSlices(partFromCounts, DONUT_TOP_N);

  // colSpans that track which columns are actually visible right now, so
  // hiding/showing columns never leaves the header groups or footer
  // totals row misaligned.
  const leadingColSpan = PART_RECEIVE_LEADING_COLS.filter(isColVisible).length;
  const ticketGroupColSpan = PART_RECEIVE_TICKET_GROUP_COLS.filter(isColVisible).length;
  const trailingColSpan = PART_RECEIVE_TRAILING_COLS.filter(isColVisible).length;
  const totalVisibleColSpan = leadingColSpan + ticketGroupColSpan + trailingColSpan;

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 min-w-0 w-full px-3 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-6">
            <button type="button" onClick={goBack} className="btn hover:bg-white/15">
              <ChevronLeft className="h-4 w-4" /> {mod.label}
            </button>
          </div>
          <h1 className="text-4xl font-display font-bold tracking-tight mb-2">{sub.title}</h1>
          <p className="text-lg text-muted-foreground">{sub.description}</p>
          {saveError && <p className="text-sm text-red-400 mt-2">{saveError}</p>}
        </div>

        {!loading && !loadError && (
          <div className="panel mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <PackageCheck className="h-4 w-4 text-blue-400 shrink-0" />
                <div>
                  <h3 className="form-section-title mb-0">Branch Summary</h3>
                  <p className="text-xs text-muted-foreground -mt-0.5">Click a branch to filter the table below</p>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {/* Same dateFrom/dateTo state the "PO Date Range" filter
                    below reads/writes — not a second, separate filter, just
                    a second place to set the exact same one, so both stay
                    in sync automatically with no extra wiring. */}
                <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5">
                  <CalendarRange className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="bg-transparent text-xs text-white outline-none [color-scheme:dark]"
                    aria-label="PO date from"
                  />
                  <span className="text-xs text-muted-foreground">~</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="bg-transparent text-xs text-white outline-none [color-scheme:dark]"
                    aria-label="PO date to"
                  />
                  {(dateFrom || dateTo) && (
                    <button
                      type="button"
                      onClick={() => { setDateFrom(""); setDateTo(""); }}
                      title="Clear date range"
                      className="text-muted-foreground hover:text-white transition-colors ml-1 text-sm leading-none"
                    >
                      ×
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={openActivityLog}
                  className="btn hover:bg-white/15 inline-flex items-center gap-2 text-xs shrink-0"
                >
                  <History className="h-3.5 w-3.5" /> View Activity
                </button>
              </div>
            </div>
            {/* Capped, not unbounded — a branch list can run to 20+ rows,
                and letting the donuts stretch to match THAT height (rather
                than a sane fixed one) is what made them balloon into huge,
                mostly-empty rings. The list scrolls internally past this
                height instead. */}
            <div className="flex flex-col lg:flex-row gap-4 items-stretch">
              {/* ~1/4 width on wide screens — the list itself doesn't need
                  more, and the donut alongside fills what would otherwise
                  be dead space to its right. */}
              <BranchBarChart
                title="Parts for Receive by Branch"
                totalLabel="Total Parts for Receive"
                unitLabel="Number of Parts"
                bars={branchSummary.map((b) => ({
                  location: b.location,
                  total: b.notReceived + b.received,
                  detail: `${b.notReceived} not received · ${b.received} received`,
                }))}
                selected={location}
                onSelect={setLocation}
                noLocationKey={NO_LOCATION}
              />

              {/* Fills the remaining space beside the (now-narrow) list —
                  three breakdowns of the same underlying data (status,
                  location, source) instead of one empty stretch of panel.
                  No content-start: the row (and each card in it, via
                  DonutSummaryCard's own h-full) stretches to match the
                  branch list's full height instead of packing to the top
                  and leaving the rest of the panel blank. */}
              <div className="flex-1 flex flex-wrap gap-4 lg:self-start">
                <DonutSummaryCard
                  title="Status"
                  data={[
                    { name: "Received", value: allBranchTotals.received },
                    { name: "Not received", value: allBranchTotals.notReceived },
                  ]}
                  colorFor={(name) => (name === "Received" ? DONUT_RECEIVED_COLOR : DONUT_NOT_RECEIVED_COLOR)}
                  centerValue={String(allBranchTotals.notReceived + allBranchTotals.received)}
                  centerLabel="Total Parts"
                />
                <DonutSummaryCard
                  title="By Location"
                  data={locationDonutData}
                  colorFor={(name) => (name === "Other" ? DONUT_OTHER_COLOR : branchDonutHex(name))}
                  centerValue={String(locationDonutData.reduce((sum, d) => sum + d.value, 0))}
                  centerLabel="Total"
                />
                <DonutSummaryCard
                  title="By Part From"
                  data={partFromDonutData}
                  colorFor={(name, i) => (name === "Other" ? DONUT_OTHER_COLOR : CATEGORICAL_DONUT_HEX[i % CATEGORICAL_DONUT_HEX.length])}
                  centerValue={String(partFromDonutData.reduce((sum, d) => sum + d.value, 0))}
                  centerLabel="Total"
                />
              </div>
            </div>
          </div>
        )}

        <div className="panel">
          <style>{`
            .form-group { display: flex; flex-direction: column; gap: 0.35rem; }
            .form-group label { font-size: 0.8rem; font-weight: 600; letter-spacing: 0.02em; color: #e5e7eb; }
            .form-group label.required::after { content: " *"; color: #ef4444; }
            .form-section-title { font-size: 0.95rem; font-weight: 600; color: #64b5f6; margin-bottom: 1rem; text-transform: uppercase; letter-spacing: 0.05em; }
            .date-range { display: flex; align-items: center; gap: 0.5rem; }
            .date-range input { flex: 1; }
            .date-range-sep { color: #64748b; font-weight: 600; }
            .checkbox-group { display: flex; align-items: center; gap: 1rem; }
            .checkbox-item { display: flex; align-items: center; gap: 0.5rem; }
            .checkbox-item input[type="checkbox"] { width: 18px; height: 18px; cursor: pointer; }
            .checkbox-item label { margin: 0; cursor: pointer; font-size: 0.9rem; }
          `}</style>

          {/* Filter Section */}
          <div>
            <h3 className="form-section-title">Filters</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
              <div className="form-group">
                <label htmlFor="part-receive-ticket">Ticket #</label>
                <input
                  id="part-receive-ticket"
                  type="text"
                  value={ticketFilter}
                  onChange={(e) => setTicketFilter(e.target.value)}
                  placeholder="Search ticket…"
                  className="glass-input"
                />
              </div>

              <div className="form-group">
                <label htmlFor="part-receive-location">Location</label>
                <select id="part-receive-location" value={location} onChange={(e) => setLocation(e.target.value)} className="glass-input">
                  <option value="">All</option>
                  {LOCATIONS.map((loc) => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="part-receive-part-from">Part From</label>
                <select id="part-receive-part-from" value={partFrom} onChange={(e) => setPartFrom(e.target.value)} className="glass-input">
                  <option value="">Select Source</option>
                  {partSources.map((src) => (
                    <option key={src} value={src}>{src}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>PO Date Range</label>
                <div className="date-range">
                  <label htmlFor="part-receive-date-from" className="sr-only">Date from</label>
                  <input id="part-receive-date-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="glass-input" />
                  <span className="date-range-sep">~</span>
                  <label htmlFor="part-receive-date-to" className="sr-only">Date to</label>
                  <input id="part-receive-date-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="glass-input" />
                </div>
              </div>

              <div className="form-group">
                <label>Receive Status</label>
                <div className="checkbox-group">
                  <div className="checkbox-item">
                    <input
                      type="checkbox"
                      id="notReceived"
                      checked={showNotReceived}
                      onChange={(e) => setShowNotReceived(e.target.checked)}
                    />
                    <label htmlFor="notReceived">Not Received</label>
                  </div>
                  <div className="checkbox-item">
                    <input
                      type="checkbox"
                      id="received"
                      checked={showReceived}
                      onChange={(e) => setShowReceived(e.target.checked)}
                    />
                    <label htmlFor="received">Received</label>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Receive Table */}
        {loadError ? (
          <p className="text-sm text-red-400 px-2 py-6">Failed to load parts: {loadError}</p>
        ) : loading ? (
          <p className="text-sm text-muted-foreground px-2 py-6">Loading…</p>
        ) : (
        <>
        <div className="relative flex items-center justify-end gap-3 mb-3">
          {invoiceSaveMessage && (
            <span className="flex items-center gap-1.5 text-sm text-green-400">
              <Check className="h-4 w-4" /> {invoiceSaveMessage}
            </span>
          )}
          <button
            type="button"
            onClick={saveAllInvoiceChanges}
            disabled={dirtyInvoiceIds.size === 0 || savingInvoices}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {savingInvoices ? "Saving…" : `Save Invoice Changes${dirtyInvoiceIds.size > 0 ? ` (${dirtyInvoiceIds.size})` : ""}`}
          </button>
          <button
            type="button"
            onClick={() => setColumnsMenuOpen((open) => !open)}
            className="btn hover:bg-white/15 inline-flex items-center gap-2"
            aria-haspopup="true"
            aria-expanded={columnsMenuOpen}
          >
            <Columns3 className="h-4 w-4" /> Columns
            <span className="text-xs text-muted-foreground">
              ({PART_RECEIVE_COLUMNS.filter((c) => isColVisible(c.key)).length}/{PART_RECEIVE_COLUMNS.length})
            </span>
          </button>
          {columnsMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setColumnsMenuOpen(false)} />
              <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-white/15 bg-slate-900 p-2 shadow-2xl">
                <div className="flex items-center justify-between px-2 py-1.5 border-b border-white/10 mb-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Show columns</span>
                  <button type="button" onClick={showAllPartReceiveColumns} className="text-xs text-blue-400 hover:text-blue-300">Show all</button>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {PART_RECEIVE_COLUMNS.map((col) => (
                    <label key={col.key} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={isColVisible(col.key)}
                        onChange={() => toggleColumn(col.key)}
                      />
                      <span className="text-slate-200">{col.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        <div ref={tableScrollRef} className="panel overflow-x-auto p-0">
            <table className="w-full min-w-[1900px] text-xs pt-compact">
              <thead>
                <tr className="bg-blue-900/50 border-b border-blue-500/30">
                  {PART_RECEIVE_LEADING_COLS.filter(isColVisible).map((key) => (
                    <th
                      key={key}
                      className="px-4 py-3 text-left font-semibold text-blue-300 whitespace-nowrap"
                      title={key === "aging" ? "Business days late vs. ETA, excluding weekends" : undefined}
                    >
                      <span className="inline-flex items-center">{PART_RECEIVE_COLUMNS.find((c) => c.key === key)?.label}{colFilter(key)}</span>
                    </th>
                  ))}
                  {ticketGroupColSpan > 0 && <th colSpan={ticketGroupColSpan} className="px-4 py-3 text-center font-semibold text-blue-300">Ticket</th>}
                  {PART_RECEIVE_TRAILING_COLS.filter(isColVisible).map((key) => (
                    <th key={key} className="px-4 py-3 text-center font-semibold text-blue-300 whitespace-nowrap">
                      <span className="inline-flex items-center">{PART_RECEIVE_COLUMNS.find((c) => c.key === key)?.label}{colFilter(key)}</span>
                    </th>
                  ))}
                </tr>
                <tr className="bg-blue-900/30 border-b border-blue-500/20">
                  {leadingColSpan > 0 && <th colSpan={leadingColSpan} className="px-4 py-2"></th>}
                  {PART_RECEIVE_TICKET_GROUP_COLS.filter(isColVisible).map((key) => (
                    <th key={key} className="px-4 py-2 text-xs font-semibold text-blue-200 border-l border-blue-500/20 whitespace-nowrap">
                      <span className="inline-flex items-center">{key === "ticketStatus" ? "Status" : PART_RECEIVE_COLUMNS.find((c) => c.key === key)?.label}{colFilter(key)}</span>
                    </th>
                  ))}
                  {trailingColSpan > 0 && <th colSpan={trailingColSpan} className="px-4 py-2"></th>}
                </tr>
              </thead>
              <tbody>
                {filteredItems.length === 0 ? (
                  <tr><td colSpan={Math.max(1, totalVisibleColSpan)} className="px-4 py-8 text-center text-slate-400">No parts match these filters.</td></tr>
                ) : filteredItems.map((item) => {
                  const aging = agingDays(item);
                  return (
                  <tr key={item.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    {isColVisible("receive") && (
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={item.qtyReceived > 0}
                          onChange={(e) => handleToggleReceived(item.id, e.target.checked)}
                          aria-label={`Mark ${item.partNo || item.id} received`}
                          title="Check to mark this part fully received"
                          className="cursor-pointer"
                        />
                      </td>
                    )}
                    {isColVisible("partStatus") && (
                      <td className="px-4 py-3">
                        <select
                          value={item.status}
                          onChange={(e) => handleStatusChange(item.id, e.target.value)}
                          aria-label={`Part status for ${item.partNo || item.id}`}
                          className="w-44 rounded border border-white/15 bg-slate-900 px-2 py-1 text-sm font-semibold text-white outline-none [color-scheme:dark] focus:border-blue-400"
                        >
                          {!item.status && <option value="" className="bg-slate-900 text-white">Status*</option>}
                          {item.status && !(PART_STATUS_OPTIONS as readonly string[]).includes(item.status) && (
                            <option value={item.status} className="bg-slate-900 text-white">{item.status}</option>
                          )}
                          {PART_STATUS_OPTIONS.map((s) => <option key={s} value={s} className="bg-slate-900 text-white">{s}</option>)}
                        </select>
                      </td>
                    )}
                    {isColVisible("uniqueId") && (
                      <td className="px-4 py-3 font-mono text-[10px] text-slate-300" title={item.id}>{item.id.slice(0, 8)}</td>
                    )}
                    {isColVisible("poNumber") && (
                      <td className="px-4 py-3 text-slate-300">
                        {item.ticketNo ? (
                          <Link
                            to="/ticket/$ticketNo"
                            params={{ ticketNo: item.ticketNo }}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-blue-400 hover:text-blue-300 hover:underline"
                          >
                            {item.poNo}
                          </Link>
                        ) : (
                          item.poNo
                        )}
                      </td>
                    )}
                    {isColVisible("partsNote") && (
                      <td className="px-4 py-3 text-slate-300">
                        <button
                          type="button"
                          onClick={() => setNoteModal({ id: item.id, label: partReceiveActivityLabel(item), draft: item.note })}
                          title={item.note || "Add a note"}
                          className={`w-40 truncate rounded border border-white/10 bg-slate-950/70 px-2 py-1 text-left text-sm outline-none hover:border-blue-400 focus:border-blue-400 ${item.note ? "text-slate-300" : "text-slate-500 italic"}`}
                        >
                          {item.note || "Add a note…"}
                        </button>
                      </td>
                    )}
                    {isColVisible("partFrom") && <td className="px-4 py-3 text-slate-300">{item.partFrom}</td>}
                    {isColVisible("poDate") && <td className="px-4 py-3 text-slate-300">{item.poDate}</td>}
                    {isColVisible("orderNo") && <td className="px-4 py-3 text-slate-300">{item.orderNo || "—"}</td>}
                    {isColVisible("invoiceNo") && (
                      <td className="px-4 py-3 text-slate-300">
                        <div className="flex items-center gap-1.5">
                          <label className="sr-only" htmlFor={`invoice-no-${item.id}`}>Invoice number for {item.id}</label>
                          <input
                            id={`invoice-no-${item.id}`}
                            type="text"
                            value={item.invoiceNo}
                            placeholder="e.g. JS-TS-26000792299DF"
                            onChange={(event) => setLocalInvoiceNo(item.id, event.target.value)}
                            className={`w-40 rounded border bg-slate-950/70 px-2 py-1 text-sm text-slate-300 outline-none focus:border-blue-400 ${dirtyInvoiceIds.has(item.id) ? "border-amber-400/60" : "border-white/10"}`}
                          />
                          {dirtyInvoiceIds.has(item.id) && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" title="Unsaved change" />}
                        </div>
                      </td>
                    )}
                    {isColVisible("partNumber") && <td className="px-4 py-3 font-mono text-slate-300">{item.partNo}</td>}
                    {isColVisible("partDesc") && <td className="px-4 py-3 text-slate-300">{item.partDesc}</td>}
                    {isColVisible("eta") && <td className="px-4 py-3 text-slate-300">{item.eta || "—"}</td>}
                    {isColVisible("aging") && (
                      <td className={`px-4 py-3 font-semibold ${agingClass(aging)}`}>
                        {agingLabel(aging)}
                      </td>
                    )}
                    {isColVisible("deliveredDate") && (() => {
                      if (item.deliveredDate) {
                        return (
                          <td className="px-4 py-3 whitespace-nowrap text-green-400 font-semibold" title={item.deliveredLocation ? `Delivered in ${item.deliveredLocation}` : "Delivered"}>
                            {item.deliveredDate}
                          </td>
                        );
                      }
                      const tn = carrierTrackingNumber(item);
                      const state = tn ? deliveryLookup[tn] : undefined;
                      if (state === "checking") return <td className="px-4 py-3 text-slate-500 italic whitespace-nowrap">Checking…</td>;
                      if (state) {
                        return (
                          <td className="px-4 py-3 text-amber-300 whitespace-nowrap" title={state.lastEvent ? `Latest scan: ${state.lastEvent}` : "No carrier scans yet"}>
                            Not yet
                          </td>
                        );
                      }
                      return <td className="px-4 py-3 text-slate-500" title={tn ? undefined : "No FedEx/UPS tracking number to look up"}>—</td>;
                    })()}
                    {isColVisible("receiveDate") && (
                      <td className="px-4 py-3 text-slate-300">
                        <input
                          type="date"
                          value={item.receivedDate}
                          onFocus={(e) => markEditStart("receiveDate", item.id, e.target.value)}
                          onChange={(e) => setLocalReceivedDate(item.id, e.target.value)}
                          onBlur={(e) => persistReceivedDate(item.id, e.target.value)}
                          className="w-36 rounded border border-white/10 bg-slate-950/70 px-2 py-1 text-sm text-slate-300 outline-none focus:border-blue-400"
                        />
                      </td>
                    )}
                    {isColVisible("tracking") && (
                      <td className="px-4 py-3 font-mono text-xs text-slate-300">
                        {item.tracking ? (
                          <a
                            href={getTrackingUrl(item.tracking, item.partFrom, item.shipMethod)}
                            target="_blank"
                            rel="noreferrer"
                            title={item.shipMethod ? `Ship method: ${item.shipMethod}` : undefined}
                            className="text-blue-300 underline decoration-dotted underline-offset-4 hover:text-blue-200"
                          >
                            {item.tracking}
                          </a>
                        ) : "—"}
                      </td>
                    )}
                    {isColVisible("ticketNo") && (
                      <td className="px-4 py-3 text-slate-300">
                        {item.ticketNo ? (
                          <Link
                            to="/ticket/$ticketNo"
                            params={{ ticketNo: item.ticketNo }}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-blue-400 hover:text-blue-300 hover:underline"
                          >
                            {item.ticketNo}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                    )}
                    {isColVisible("ticketStatus") && (
                      <td className={`px-4 py-3 font-semibold ${ticketStatusClass(item.ticketStatus)}`}>{item.ticketStatus}</td>
                    )}
                    {isColVisible("tech") && <td className="px-4 py-3 text-slate-300">{item.tech || "—"}</td>}
                    {isColVisible("schedule") && <td className="px-4 py-3 text-slate-300">{item.schedule || "—"}</td>}
                    {isColVisible("qtyOrdered") && <td className="px-4 py-3 text-center font-semibold text-slate-300">{item.quantity}</td>}
                    {isColVisible("qtyReceived") && (
                      <td className="px-4 py-3 text-center font-semibold text-green-400">
                        <label className="sr-only" htmlFor={`received-qty-${item.id}`}>Quantity received for {item.id}</label>
                        <input
                          id={`received-qty-${item.id}`}
                          type="number"
                          min={0}
                          max={item.quantity}
                          value={item.qtyReceived}
                          onFocus={(event) => markEditStart("qty", item.id, event.target.value)}
                          onChange={(event) => setLocalQty(item.id, event.target.value)}
                          onBlur={(event) => persistQty(item.id, Number.parseFloat(event.target.value) || 0)}
                          className="w-20 rounded border border-white/10 bg-slate-950/70 px-2 py-1 text-center text-sm font-semibold text-green-400 outline-none transition focus:border-green-400"
                        />
                      </td>
                    )}
                    {isColVisible("partCost") && <td className="px-4 py-3 text-right text-slate-300">${item.partPrice.toFixed(2)}</td>}
                    {isColVisible("coreCost") && <td className="px-4 py-3 text-right text-slate-300">${item.coreValue.toFixed(2)}</td>}
                  </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-blue-900/50 border-t-2 border-blue-500/30 font-semibold text-blue-300">
                  <td colSpan={Math.max(1, leadingColSpan + ticketGroupColSpan)} className="px-4 py-3 text-right">Totals — {filteredItems.length} part line{filteredItems.length === 1 ? "" : "s"} (quantities summed):</td>
                  {isColVisible("qtyOrdered") && <td className="px-4 py-3 text-center">{totals.total}</td>}
                  {isColVisible("qtyReceived") && <td className="px-4 py-3 text-center text-green-400">{totals.rcvd}</td>}
                  {isColVisible("partCost") && <td className="px-4 py-3 text-right">${totals.partCost.toFixed(2)}</td>}
                  {isColVisible("coreCost") && <td className="px-4 py-3 text-right">${totals.coreCost.toFixed(2)}</td>}
                </tr>
              </tfoot>
            </table>
          </div>
        <FloatingHorizontalScrollbar targetRef={tableScrollRef} />
        </>
        )}
      </main>

      {noteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setNoteModal(null)}>
          <div className="w-full max-w-lg flex flex-col rounded-lg border border-white/10 bg-slate-900 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-white">Parts Note</h3>
                <p className="text-xs text-blue-300 truncate">{noteModal.label}</p>
              </div>
              <button type="button" onClick={() => setNoteModal(null)} className="text-slate-400 hover:text-white text-xl leading-none" aria-label="Close">×</button>
            </div>
            <textarea
              value={noteModal.draft}
              onChange={(e) => setNoteModal((m) => (m ? { ...m, draft: e.target.value } : m))}
              placeholder="Add a note…"
              rows={8}
              autoFocus
              aria-label="Parts note"
              className="w-full resize-y rounded border border-white/15 bg-slate-950 px-3 py-2 text-sm leading-relaxed text-slate-200 outline-none focus:border-blue-400 whitespace-pre-wrap"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setNoteModal(null)} className="btn hover:bg-white/15 text-sm">Cancel</button>
              <button type="button" onClick={saveNoteModal} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700">Save Note</button>
            </div>
          </div>
        </div>
      )}

      {activityLogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setActivityLogOpen(false)}>
          <div className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-lg border border-white/10 bg-slate-900 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">Part Receive Activity</h3>
              <button type="button" onClick={() => setActivityLogOpen(false)} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
            </div>
            {activityLogLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : activityLogError ? (
              <p className="text-sm text-red-400">{activityLogError}</p>
            ) : activityLogEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity logged yet.</p>
            ) : (
              <div className="overflow-y-auto flex-1 -mx-2 px-2">
                <ul className="space-y-2">
                  {activityLogEntries.map((entry) => {
                    const from = entry.details?.from;
                    const to = entry.details?.to;
                    const hasFromTo = from !== undefined || to !== undefined;
                    return (
                      <li key={entry.id} className="rounded border border-white/10 bg-white/5 px-3 py-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-200">{activityActionLabel(entry.action)}</span>
                          <span className="text-xs text-slate-500 whitespace-nowrap">{new Date(entry.createdAt).toLocaleString()}</span>
                        </div>
                        {entry.targetLabel && <div className="text-xs text-blue-300 mt-0.5">{entry.targetLabel}</div>}
                        {hasFromTo && (
                          <div className="text-xs text-slate-400 mt-0.5">
                            {String(from ?? "—") || "—"} → {String(to ?? "—") || "—"}
                          </div>
                        )}
                        <div className="text-xs text-slate-500 mt-0.5">{entry.actorName || "Unknown"}</div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
