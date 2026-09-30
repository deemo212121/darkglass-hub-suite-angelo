/**
 * "Part Info. of <part #>" popup opened from the magnifying glass beside the
 * ticket page's Part Transaction Lookup button. One tab per distributor we
 * have an API for (Encompass, Marcone): the tab the Lookup ran on opens with
 * that result; the other tab looks the part up the first time it's opened.
 * Shows the part's details plus every warehouse's available quantity.
 */
import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import type { MarconePartInfo } from "@/lib/marconeApi";
import type { EncompassPartInfo } from "@/lib/encompassApi";

export type PartInfoVendor = "marcone" | "encompass";

type VendorState<T> = { status: "idle" | "loading" | "ok" | "notFound" | "error"; data?: T; error?: string };

const VENDOR_LABEL: Record<PartInfoVendor, string> = { encompass: "Encompass", marcone: "Marcone" };

const money = (n: number | undefined | null) => (typeof n === "number" ? n.toFixed(2) : "");
const yesNo = (b: boolean | undefined) => (b === undefined ? "" : b ? "true" : "false");

export function PartInfoModal({
  partNumber,
  initialVendor,
  initialMarcone,
  initialEncompass,
  onClose,
}: {
  partNumber: string;
  initialVendor: PartInfoVendor;
  initialMarcone?: MarconePartInfo;
  initialEncompass?: EncompassPartInfo;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<PartInfoVendor>(initialVendor);
  const [marcone, setMarcone] = useState<VendorState<MarconePartInfo>>(initialMarcone ? { status: "ok", data: initialMarcone } : { status: "idle" });
  const [encompass, setEncompass] = useState<VendorState<EncompassPartInfo>>(initialEncompass ? { status: "ok", data: initialEncompass } : { status: "idle" });

  // Look the part up on a tab's distributor the first time that tab is opened.
  useEffect(() => {
    let cancelled = false;
    if (tab === "marcone" && marcone.status === "idle") {
      setMarcone({ status: "loading" });
      import("@/lib/marconeApi")
        .then(({ marconeLookupPart }) => marconeLookupPart({ partNumber }))
        .then((r) => {
          if (cancelled) return;
          if (r.notFound) setMarcone({ status: "notFound" });
          else if (!r.success || !r.data) setMarcone({ status: "error", error: r.error || "Request failed" });
          else setMarcone({ status: "ok", data: r.data });
        })
        .catch((err) => !cancelled && setMarcone({ status: "error", error: err instanceof Error ? err.message : String(err) }));
    }
    if (tab === "encompass" && encompass.status === "idle") {
      setEncompass({ status: "loading" });
      import("@/lib/encompassApi")
        .then(({ encompassLookupPart }) => encompassLookupPart({ partNumber }))
        .then((r) => {
          if (cancelled) return;
          if (r.notFound) setEncompass({ status: "notFound" });
          else if (!r.success || !r.data) setEncompass({ status: "error", error: r.error || "Request failed" });
          else setEncompass({ status: "ok", data: r.data });
        })
        .catch((err) => !cancelled && setEncompass({ status: "error", error: err instanceof Error ? err.message : String(err) }));
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const current = tab === "marcone" ? marcone : encompass;

  let details: [string, string][] = [];
  let rows: { id: string; name: string; qty: number }[] = [];
  if (tab === "marcone" && marcone.data) {
    const d = marcone.data;
    details = [
      ["Make", d.make ?? ""],
      ["Part #", d.partNumber ?? partNumber],
      ["Price", money(d.netPrice)],
      ["Dealer Price", money(d.dealerPrice)],
      ["Retail Price", money(d.retailPrice)],
      ["List Price", money(d.listPrice)],
      ["Core Price", money(d.coreValue)],
      ["Discontinued?", yesNo(d.isDiscontinued)],
      ["Description", d.description ?? ""],
      ["Drop Ship only?", yesNo(d.isDropShipOnly)],
    ];
    rows = (d.inventory ?? []).map((w) => ({ id: w.warehouseNumber ?? "", name: w.warehouseName ?? "", qty: Number(w.quantityAvailable ?? 0) || 0 }));
  } else if (tab === "encompass" && encompass.data) {
    const d = encompass.data;
    details = [
      ["Make", d.mfgName ?? d.mfgCode ?? ""],
      ["Part #", d.partNumber ?? partNumber],
      ["Price", money(d.partPrice)],
      ["List Price", money(d.listPrice)],
      ["Core Price", money(d.corePrice)],
      ["Total Price", money(d.totalPrice)],
      ["Description", d.description ?? ""],
      ["ETA", d.eta || d.estimatedDeliveryDate || ""],
    ];
    rows = d.availabilityByLocation.map((l) => ({ id: l.number ?? "", name: l.name ?? "", qty: l.available }));
  }
  rows.sort((a, b) => b.qty - a.qty);
  const totalQty = rows.reduce((s, r) => s + r.qty, 0);

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-slate-900 border border-white/10 rounded-lg w-full max-w-[720px] max-h-[92vh] flex flex-col overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 bg-blue-600 text-white shrink-0">
          <span className="text-base font-bold">Part Info. of {partNumber}</span>
          <button type="button" onClick={onClose} aria-label="Close" className="w-7 h-7 rounded hover:bg-white/20 inline-flex items-center justify-center">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex gap-1 px-3 pt-3 border-b border-white/10 shrink-0">
          {(["encompass", "marcone"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setTab(v)}
              className={`px-3 py-1.5 text-sm font-semibold rounded-t-md transition ${tab === v ? "bg-blue-600 text-white" : "bg-white/5 text-slate-300 hover:bg-white/10"}`}
            >
              {VENDOR_LABEL[v]}
            </button>
          ))}
        </div>

        <div className="overflow-auto p-3">
          {current.status === "loading" || current.status === "idle" ? (
            <div className="py-10 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Looking up {partNumber} on {VENDOR_LABEL[tab]}…
            </div>
          ) : current.status === "notFound" ? (
            <div className="py-10 text-center text-sm text-slate-400">{VENDOR_LABEL[tab]}: {partNumber} not found.</div>
          ) : current.status === "error" ? (
            <div className="py-10 text-center text-sm text-rose-300">{VENDOR_LABEL[tab]} error: {current.error}</div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 border border-white/10 rounded overflow-hidden text-sm">
                {details.map(([label, value]) => (
                  <div key={label} className="flex border-b border-white/5">
                    <div className="w-32 shrink-0 bg-white/5 px-3 py-1.5 text-slate-400">{label}</div>
                    <div className="px-3 py-1.5 text-slate-100 break-words min-w-0">{value}</div>
                  </div>
                ))}
              </div>

              <h3 className="mt-4 text-center text-lg font-semibold text-blue-300">Availability ({VENDOR_LABEL[tab]})</h3>
              <p className="text-sm text-slate-300 mb-2">
                <span className="text-sky-300 font-semibold">{rows.length}</span> records found · <span className="text-emerald-300 font-semibold">{totalQty}</span> available in total
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-white/10 text-slate-200">
                    <th className="px-3 py-2 text-center font-semibold">ID</th>
                    <th className="px-3 py-2 text-center font-semibold">W/H Name</th>
                    <th className="px-3 py-2 text-right font-semibold">Available Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={3} className="px-3 py-6 text-center text-slate-400">No warehouse data returned.</td></tr>
                  ) : rows.map((r, i) => (
                    <tr key={`${r.id}-${r.name}-${i}`} className={i % 2 ? "bg-white/5" : ""}>
                      <td className="px-3 py-1.5 text-center text-slate-300 tabular-nums">{r.id || "—"}</td>
                      <td className="px-3 py-1.5 text-center text-slate-100">{r.name || "—"}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums font-semibold ${r.qty > 0 ? "text-emerald-300" : "text-slate-500"}`}>{r.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
