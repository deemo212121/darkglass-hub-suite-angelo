/**
 * Marcone Parts Order modal.
 *
 * Opens when the user clicks Submit POs on a Part Transaction grid that
 * contains at least one part with `partDist = Marcone` (any variant). Lets
 * the CSR review which parts to order, pick a ship method + address, and
 * confirm. Only when Place Order is clicked does anything get written —
 * mounting the modal has no side effects.
 *
 * Shape contract:
 *   - `parts` is the Marcone-eligible subset the host already filtered. The
 *     modal does NOT filter again; if a row is in props it's pre-selected.
 *   - `addressBook` is precomputed by the host so the dropdown can render
 *     instantly without a Supabase round-trip inside the modal.
 *   - `onPlaceOrder` receives a `MarconeOrderPayload` (mirrors Marcone's
 *     mSupply POST /orders body) and is expected to throw on failure; the
 *     modal stays open with state preserved on error.
 */

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { ShipToAddress, MarconeOrderPayload } from "@/lib/supabase/partOrders";

/** Address book entry rendered in the Address dropdown. */
export interface AddressBookEntry {
  /** Unique key like "branch:Memphis" or "part:<uuid>". */
  id: string;
  label: string;
  shipTo: ShipToAddress;
}

/** A part row eligible for Marcone ordering. Subset of PartTransactionRow. */
export interface MarconePartLine {
  id: string;        // PartTransactionRow.id
  partNo: string;
  partDesc: string;
  partPrice: string; // raw string from the grid
  coreValue: string; // raw string from the grid
  quantity: string;  // raw string from the grid
}

export interface MarconePartsOrderModalProps {
  open: boolean;
  onClose: () => void;
  parts: MarconePartLine[];
  ticketNo: string;
  defaultShipTo: ShipToAddress;
  addressBook: AddressBookEntry[];
  /** Resolve handler for Place Order. Throws on failure. */
  onPlaceOrder: (payload: MarconeOrderPayload) => Promise<void>;
}

const SHIP_METHODS = [
  "FedEx Ground",
  "FedEx Priority",
  "FedEx Standard Overnight",
  "FedEx Second Day",
  "FedEx Ground Residential",
  "FedEx SmartPost",
  "FedEx Next Day Early AM",
  "FedEx Next Day Air Saturday",
  "UPS Ground",
  "UPS Ground Residential",
  "UPS Next Day Air",
  "UPS 2nd Day",
  "UPS Saver",
  "UPS Early A.M.",
  "UPS SurePost",
  "LTL",
  "Will Call",
  "PCR WILL CALL",
];

type LineState = {
  partId: string;
  selected: boolean;
  partNo: string;
  partDesc: string;
  partPrice: number;
  coreValue: number;
  orderQty: number;
};


const toNumber = (v: string | number): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const money = (n: number) => `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;

export function MarconePartsOrderModal({
  open,
  onClose,
  parts,
  ticketNo,
  defaultShipTo,
  addressBook,
  onPlaceOrder,
}: MarconePartsOrderModalProps) {
  // ── Line state — derived from props.parts when the modal opens ─────────
  const [lines, setLines] = useState<LineState[]>([]);
  // ── Form state ─────────────────────────────────────────────────────────
  const [poNo, setPoNo] = useState<string>("");
  const [shipMethod, setShipMethod] = useState<string>("");
  const [selectedAddressId, setSelectedAddressId] = useState<string>("");
  const [shipTo, setShipTo] = useState<ShipToAddress>(defaultShipTo);
  const [isPlacing, setIsPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  // Hydrate every time the modal opens with a fresh set of parts.
  useEffect(() => {
    if (!open) return;
    setLines(
      parts.map((p) => ({
        partId: p.id,
        selected: true,
        partNo: p.partNo || "",
        partDesc: p.partDesc || "",
        partPrice: toNumber(p.partPrice),
        coreValue: toNumber(p.coreValue),
        orderQty: Math.max(1, toNumber(p.quantity) || 1),
      })),
    );
    setPoNo(ticketNo);
    setShipMethod("");
    setSelectedAddressId("");
    setShipTo(defaultShipTo);
    setIsPlacing(false);
    setError(null);
    setAttempted(false);
  }, [open, parts, ticketNo, defaultShipTo]);

  // Escape closes the modal (Requirement 5.2).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isPlacing) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, isPlacing]);

  const missingFields = useMemo(() => {
    const m: string[] = [];
    if (!poNo.trim()) m.push("PO No");
    if (!shipMethod.trim()) m.push("Ship Method");
    if (!shipTo.name.trim()) m.push("Ship To Name");
    if (!shipTo.street1.trim()) m.push("Street");
    if (!shipTo.city.trim()) m.push("City");
    if (!shipTo.state.trim()) m.push("State");
    if (!shipTo.zip.trim()) m.push("ZIP");
    return m;
  }, [poNo, shipMethod, shipTo]);

  const selectedCount = lines.filter((l) => l.selected).length;
  const canPlace = !isPlacing && selectedCount > 0 && missingFields.length === 0;


  const toggleLine = (partId: string) =>
    setLines((prev) =>
      prev.map((l) => (l.partId === partId ? { ...l, selected: !l.selected } : l)),
    );

  const updateLineQty = (partId: string, value: string) =>
    setLines((prev) =>
      prev.map((l) =>
        l.partId === partId
          ? { ...l, orderQty: Math.max(1, toNumber(value) || 1) }
          : l,
      ),
    );

  const pickAddress = (id: string) => {
    setSelectedAddressId(id);
    const entry = addressBook.find((a) => a.id === id);
    if (entry) setShipTo({ ...entry.shipTo });
  };

  const updateShipTo = (field: keyof ShipToAddress, value: string) =>
    setShipTo((prev) => ({ ...prev, [field]: value }));

  const handlePlace = async () => {
    setAttempted(true);
    if (!canPlace) return;
    setIsPlacing(true);
    setError(null);
    try {
      const payload: MarconeOrderPayload = {
        ticketNo,
        purchaseOrderNumber: poNo.trim(),
        shipMethod,
        shipTo: { ...shipTo },
        lineItems: lines
          .filter((l) => l.selected)
          .map((l) => ({
            partId: l.partId,
            partNumber: l.partNo,
            description: l.partDesc,
            quantity: l.orderQty,
            unitPrice: l.partPrice,
            coreValue: l.coreValue,
          })),
      };
      await onPlaceOrder(payload);
      // Host closes the modal on success.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsPlacing(false);
    }
  };

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const body = (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      {/* Backdrop is intentionally not click-to-close (Requirement 5.3). */}
      <div
        className="w-full max-w-5xl rounded-md bg-slate-950 ring-1 ring-white/10 shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header bar — Marcone blue */}
        <div className="bg-[#1f7cf3] text-white px-4 py-2 flex items-center justify-between rounded-t-md">
          <span className="font-semibold tracking-wide">Marcone Parts Order</span>
          <button
            type="button"
            aria-label="Close"
            onClick={() => !isPlacing && onClose()}
            className="text-white/90 hover:text-white text-lg leading-none px-2"
          >
            ✕
          </button>
        </div>


        {/* Parts table */}
        <div className="overflow-auto px-4 py-3 border-b border-white/10 max-h-72">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/60 text-slate-300 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-2 py-1 text-left">Ticket #</th>
                <th className="px-2 py-1 text-center w-16">Select</th>
                <th className="px-2 py-1 text-left">Part No</th>
                <th className="px-2 py-1 text-left">Description</th>
                <th className="px-2 py-1 text-right w-24">Price</th>
                <th className="px-2 py-1 text-right w-24">Core Value</th>
                <th className="px-2 py-1 text-center w-24">Order Qty</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-2 py-6 text-center text-slate-500">
                    No Marcone parts to order.
                  </td>
                </tr>
              ) : (
                lines.map((l, i) => (
                  <tr
                    key={l.partId}
                    className={`${i % 2 === 0 ? "bg-slate-900/40" : "bg-slate-900/20"} ${l.selected ? "ring-1 ring-blue-400/30" : ""}`}
                  >
                    <td className="px-2 py-1.5 text-slate-300">{ticketNo}</td>
                    <td className="px-2 py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={l.selected}
                        onChange={() => toggleLine(l.partId)}
                        className="accent-blue-500 h-4 w-4"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-blue-300 font-semibold">{l.partNo}</td>
                    <td className="px-2 py-1.5 text-slate-300">{l.partDesc || "—"}</td>
                    <td className="px-2 py-1.5 text-right text-slate-200">{money(l.partPrice)}</td>
                    <td className="px-2 py-1.5 text-right text-slate-200">{money(l.coreValue)}</td>
                    <td className="px-2 py-1.5 text-center">
                      <input
                        type="number"
                        min={1}
                        value={l.orderQty}
                        onChange={(e) => updateLineQty(l.partId, e.target.value)}
                        className="w-16 rounded border border-white/15 bg-slate-950 px-1 py-0.5 text-sm text-white text-center focus:outline-none focus:border-blue-500"
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>


        {/* Address form */}
        <div className="px-4 py-3 grid grid-cols-[100px_1fr_100px_1fr] gap-x-3 gap-y-2 text-sm items-center">
          {/* Row: PO No + Ship Method */}
          <label className="text-slate-400 uppercase text-[10px] tracking-wide">PO No*</label>
          <input
            value={poNo}
            onChange={(e) => setPoNo(e.target.value)}
            className={`rounded border bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500 ${attempted && !poNo.trim() ? "border-rose-500/50" : "border-white/15"}`}
            placeholder="Purchase Order #"
          />
          <label className="text-slate-400 uppercase text-[10px] tracking-wide">Ship Method*</label>
          <select
            value={shipMethod}
            onChange={(e) => setShipMethod(e.target.value)}
            className={`rounded border bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500 ${attempted && !shipMethod ? "border-rose-500/50" : "border-white/15"}`}
          >
            <option value="">— select —</option>
            {SHIP_METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>

          {/* Row: Address dropdown */}
          <label className="text-slate-400 uppercase text-[10px] tracking-wide">Address</label>
          <select
            value={selectedAddressId}
            onChange={(e) => pickAddress(e.target.value)}
            className="col-span-3 rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">— pick a saved address —</option>
            {addressBook.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>

          {/* Row: Ship To Name */}
          <label className="text-slate-400 uppercase text-[10px] tracking-wide">Ship To Name*</label>
          <input
            value={shipTo.name}
            onChange={(e) => updateShipTo("name", e.target.value)}
            className={`col-span-3 rounded border bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500 ${attempted && !shipTo.name.trim() ? "border-rose-500/50" : "border-white/15"}`}
            placeholder="Recipient name"
          />

          {/* Row: Ship To (5 cells) */}
          <label className="text-slate-400 uppercase text-[10px] tracking-wide">Ship To*</label>
          <div className="col-span-3 grid grid-cols-[1.5fr_1fr_1fr_70px_90px] gap-2">
            <input
              value={shipTo.street1}
              onChange={(e) => updateShipTo("street1", e.target.value)}
              placeholder="Street"
              className={`rounded border bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500 ${attempted && !shipTo.street1.trim() ? "border-rose-500/50" : "border-white/15"}`}
            />
            <input
              value={shipTo.street2}
              onChange={(e) => updateShipTo("street2", e.target.value)}
              placeholder="Street 2"
              className="rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500"
            />
            <input
              value={shipTo.city}
              onChange={(e) => updateShipTo("city", e.target.value)}
              placeholder="City"
              className={`rounded border bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500 ${attempted && !shipTo.city.trim() ? "border-rose-500/50" : "border-white/15"}`}
            />
            <input
              value={shipTo.state}
              onChange={(e) => updateShipTo("state", e.target.value)}
              placeholder="State"
              maxLength={2}
              className={`rounded border bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500 uppercase ${attempted && !shipTo.state.trim() ? "border-rose-500/50" : "border-white/15"}`}
            />
            <input
              value={shipTo.zip}
              onChange={(e) => updateShipTo("zip", e.target.value)}
              placeholder="ZIP"
              className={`rounded border bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500 ${attempted && !shipTo.zip.trim() ? "border-rose-500/50" : "border-white/15"}`}
            />
          </div>

          {/* Row: Phone + Email */}
          <label className="text-slate-400 uppercase text-[10px] tracking-wide">Phone #</label>
          <input
            value={shipTo.phone}
            onChange={(e) => updateShipTo("phone", e.target.value)}
            inputMode="tel"
            className="rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500"
          />
          <label className="text-slate-400 uppercase text-[10px] tracking-wide">Email Address</label>
          <input
            type="email"
            value={shipTo.email}
            onChange={(e) => updateShipTo("email", e.target.value)}
            className="rounded border border-white/15 bg-slate-950 px-2 py-1 text-white focus:outline-none focus:border-blue-500"
          />
        </div>


        {/* Error banner */}
        {error && (
          <div className="mx-4 mb-2 rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between gap-2">
          <span className="text-xs text-slate-400">
            {selectedCount} of {lines.length} part{lines.length === 1 ? "" : "s"} selected
            {attempted && missingFields.length > 0 && (
              <span className="ml-2 text-rose-300">· Missing: {missingFields.join(", ")}</span>
            )}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => !isPlacing && onClose()}
              disabled={isPlacing}
              className="rounded border border-white/15 bg-slate-800 px-4 py-1.5 text-sm font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handlePlace}
              disabled={!canPlace}
              title={
                selectedCount === 0
                  ? "Select at least one part"
                  : missingFields.length > 0
                  ? `Missing: ${missingFields.join(", ")}`
                  : "Place this order"
              }
              className={`rounded border px-4 py-1.5 text-sm font-semibold transition ${
                canPlace
                  ? "border-blue-400/40 bg-blue-600/30 text-blue-100 hover:bg-blue-600/50"
                  : "border-white/10 bg-slate-800 text-slate-500 cursor-not-allowed"
              }`}
            >
              {isPlacing ? "Placing…" : "Place Order"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}
