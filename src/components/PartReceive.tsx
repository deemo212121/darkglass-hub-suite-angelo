import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Check } from "lucide-react";
import { LOCATIONS } from "@/lib/locations";
import {
  getPartsToReceive,
  updatePartReceiveRow,
  getDistinctPartSources,
  type PartReceiveRow,
} from "@/lib/supabase/partReceive";
import { FloatingHorizontalScrollbar } from "@/components/FloatingHorizontalScrollbar";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

function getTrackingUrl(tracking: string, partFrom: string) {
  const value = tracking.trim();
  const source = partFrom.trim().toLowerCase();
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

export function PartReceive({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [location, setLocation] = useState("");
  const [partFrom, setPartFrom] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showNotReceived, setShowNotReceived] = useState(true);
  const [showReceived, setShowReceived] = useState(true);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [receiveItems, setReceiveItems] = useState<PartReceiveRow[]>([]);
  const [partSources, setPartSources] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    getPartsToReceive()
      .then(setReceiveItems)
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
    getDistinctPartSources().then(setPartSources).catch((err) => console.error("Failed to load part sources:", err));
  }, []);

  const toggleItemSelection = (id: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedItems(newSelected);
  };

  const toggleAllItems = () => {
    if (selectedItems.size === filteredItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredItems.map((item) => item.id)));
    }
  };

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
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save quantity received");
    }
  };

  const setLocalReceivedDate = (id: string, value: string) => {
    setReceiveItems((current) => current.map((item) => (item.id === id ? { ...item, receivedDate: value } : item)));
  };
  const persistReceivedDate = async (id: string, value: string) => {
    try {
      await updatePartReceiveRow(id, { receivedDate: value });
      setSaveError(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save receive date");
    }
  };

  const [dirtyInvoiceIds, setDirtyInvoiceIds] = useState<Set<string>>(new Set());
  const [savingInvoices, setSavingInvoices] = useState(false);
  const [invoiceSaveMessage, setInvoiceSaveMessage] = useState<string | null>(null);

  const setLocalInvoiceNo = (id: string, value: string) => {
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
    if (location && item.location !== location) return false;
    if (partFrom && item.partFrom !== partFrom) return false;
    if (dateFrom || dateTo) {
      if (!item.poDate) return false;
      const rowDate = new Date(item.poDate);
      if (dateFrom && rowDate < new Date(dateFrom)) return false;
      if (dateTo && rowDate > new Date(dateTo)) return false;
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

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 min-w-0 max-w-[1600px] mx-auto w-full px-6 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-6">
            <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
              <ChevronLeft className="h-4 w-4" /> {mod.label}
            </Link>
          </div>
          <h1 className="text-4xl font-display font-bold tracking-tight mb-2">{sub.title}</h1>
          <p className="text-lg text-muted-foreground">{sub.description}</p>
          {saveError && <p className="text-sm text-red-400 mt-2">{saveError}</p>}
        </div>

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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
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
        <div className="flex items-center justify-end gap-3 mb-3">
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
        </div>
        <div ref={tableScrollRef} className="panel overflow-x-auto p-0">
            <table className="w-full min-w-[2400px] text-sm">
              <thead>
                <tr className="bg-blue-900/50 border-b border-blue-500/30">
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">
                    <input
                      type="checkbox"
                      aria-label="Select all rows"
                      checked={selectedItems.size === filteredItems.length && filteredItems.length > 0}
                      onChange={toggleAllItems}
                      className="cursor-pointer"
                    />
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Comp*</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Unique ID*</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">PO Number</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Part From</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">P/O Date</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Order No</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Invoice #</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Part Number*</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Part Desc*</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">ETA</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Receive Date</th>
                  <th className="px-4 py-3 text-left font-semibold text-blue-300">Tracking</th>
                  <th colSpan={4} className="px-4 py-3 text-center font-semibold text-blue-300">Ticket</th>
                  <th className="px-4 py-3 text-center font-semibold text-blue-300">Quantity Ordered</th>
                  <th className="px-4 py-3 text-center font-semibold text-blue-300">Quantity Received</th>
                  <th className="px-4 py-3 text-center font-semibold text-blue-300">$ Part</th>
                  <th className="px-4 py-3 text-center font-semibold text-blue-300">$ Core</th>
                </tr>
                <tr className="bg-blue-900/30 border-b border-blue-500/20">
                  <th colSpan={13} className="px-4 py-2"></th>
                  <th className="px-4 py-2 text-xs font-semibold text-blue-200 border-l border-blue-500/20">Ticket No</th>
                  <th className="px-4 py-2 text-xs font-semibold text-blue-200 border-l border-blue-500/20">Status</th>
                  <th className="px-4 py-2 text-xs font-semibold text-blue-200 border-l border-blue-500/20">Tech</th>
                  <th className="px-4 py-2 text-xs font-semibold text-blue-200 border-l border-blue-500/20">Schedule</th>
                  <th colSpan={4} className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.length === 0 ? (
                  <tr><td colSpan={21} className="px-4 py-8 text-center text-slate-400">No parts match these filters.</td></tr>
                ) : filteredItems.map((item) => (
                  <tr key={item.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        aria-label={`Select row ${item.id}`}
                        checked={selectedItems.has(item.id)}
                        onChange={() => toggleItemSelection(item.id)}
                        className="cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <input type="checkbox" checked={item.qtyReceived > 0} readOnly aria-label={`Received status for ${item.id}`} className="cursor-not-allowed" />
                    </td>
                    <td className="px-4 py-3 font-mono text-[10px] text-slate-300" title={item.id}>{item.id.slice(0, 8)}</td>
                    <td className="px-4 py-3 text-slate-300">{item.poNo}</td>
                    <td className="px-4 py-3 text-slate-300">{item.partFrom}</td>
                    <td className="px-4 py-3 text-slate-300">{item.poDate}</td>
                    <td className="px-4 py-3 text-slate-300">{item.orderNo || "—"}</td>
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
                    <td className="px-4 py-3 font-mono text-slate-300">{item.partNo}</td>
                    <td className="px-4 py-3 text-slate-300">{item.partDesc}</td>
                    <td className="px-4 py-3 text-slate-300">{item.eta || "—"}</td>
                    <td className="px-4 py-3 text-slate-300">
                      <input
                        type="date"
                        value={item.receivedDate}
                        onChange={(e) => setLocalReceivedDate(item.id, e.target.value)}
                        onBlur={(e) => persistReceivedDate(item.id, e.target.value)}
                        className="w-36 rounded border border-white/10 bg-slate-950/70 px-2 py-1 text-sm text-slate-300 outline-none focus:border-blue-400"
                      />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-300">
                      {item.tracking ? (
                        <a href={getTrackingUrl(item.tracking, item.partFrom)} target="_blank" rel="noreferrer" className="text-blue-300 underline decoration-dotted underline-offset-4 hover:text-blue-200">
                          {item.tracking}
                        </a>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{item.ticketNo}</td>
                    <td className={`px-4 py-3 font-semibold ${ticketStatusClass(item.ticketStatus)}`}>{item.ticketStatus}</td>
                    <td className="px-4 py-3 text-slate-300">{item.tech || "—"}</td>
                    <td className="px-4 py-3 text-slate-300">{item.schedule || "—"}</td>
                    <td className="px-4 py-3 text-center font-semibold text-slate-300">{item.quantity}</td>
                    <td className="px-4 py-3 text-center font-semibold text-green-400">
                      <label className="sr-only" htmlFor={`received-qty-${item.id}`}>Quantity received for {item.id}</label>
                      <input
                        id={`received-qty-${item.id}`}
                        type="number"
                        min={0}
                        max={item.quantity}
                        value={item.qtyReceived}
                        onChange={(event) => setLocalQty(item.id, event.target.value)}
                        onBlur={(event) => persistQty(item.id, Number.parseFloat(event.target.value) || 0)}
                        className="w-20 rounded border border-white/10 bg-slate-950/70 px-2 py-1 text-center text-sm font-semibold text-green-400 outline-none transition focus:border-green-400"
                      />
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">${item.partPrice.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right text-slate-300">${item.coreValue.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-blue-900/50 border-t-2 border-blue-500/30 font-semibold text-blue-300">
                  <td colSpan={17} className="px-4 py-3 text-right">Totals:</td>
                  <td className="px-4 py-3 text-center">{totals.total}</td>
                  <td className="px-4 py-3 text-center text-green-400">{totals.rcvd}</td>
                  <td className="px-4 py-3 text-right">${totals.partCost.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right">${totals.coreCost.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        <FloatingHorizontalScrollbar targetRef={tableScrollRef} />
        </>
        )}
      </main>
    </div>
  );
}
