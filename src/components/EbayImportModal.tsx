/**
 * Parts Daily Report eBAY → Import Excel. Pick the team's workbook (Google
 * Sheets → File → Download → .xlsx, or any .xlsx/.csv). ebayImport.ts reads
 * the sales tables into Orders and the listing tabs into Listings; this
 * shows a preview — ready / warning / error / duplicate per row — and only
 * saves the importable rows when Import is clicked. Right after, "Undo this
 * import" removes exactly what was added.
 */
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FileSpreadsheet, Loader2, Upload, Undo2, CheckCircle2, X } from "lucide-react";
import { parseEbayWorkbook, markDuplicates, listingKey, type ParsedOrder, type ParsedListing, type ImportRowState } from "@/lib/ebayImport";
import { getExistingEbayOrderExtIds, getEbayListings, bulkCreateEbayOrders, bulkCreateEbayListings, deleteEbayRowsByIds } from "@/lib/supabase/partDailyReportEbay";
import { logActivity } from "@/lib/supabase/hrActivityLog";

const STATE_STYLE: Record<ImportRowState, { label: string; cls: string }> = {
  ready: { label: "Ready", cls: "bg-green-500/15 text-green-300 border-green-500/30" },
  warning: { label: "Check", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  error: { label: "Won't import", cls: "bg-red-500/15 text-red-300 border-red-500/30" },
  duplicate: { label: "Duplicate", cls: "bg-slate-500/15 text-slate-300 border-slate-500/30" },
};
const importable = (s: ImportRowState) => s === "ready" || s === "warning";
const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;

export function EbayImportModal({
  accounts,
  activityTargetType,
  onClose,
  onImported,
}: {
  accounts: string[];
  activityTargetType: string;
  onClose: () => void;
  /** Called after an import or undo, so the page reloads. */
  onImported: () => void;
}) {
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<ParsedOrder[]>([]);
  const [listings, setListings] = useState<ParsedListing[]>([]);
  const [sheets, setSheets] = useState<string[]>([]);
  const [tab, setTab] = useState<"orders" | "listings">("orders");
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<{ orderIds: string[]; listingIds: string[] } | null>(null);
  const [undoing, setUndoing] = useState(false);

  const readFile = async (file: File) => {
    setFileName(file.name);
    setParsing(true);
    setError(null);
    setDone(null);
    try {
      const parsed = parseEbayWorkbook(await file.arrayBuffer(), accounts);
      // Duplicates: orders by order ID (any date); listings by date + part + branch + account + price.
      const existingIds = await getExistingEbayOrderExtIds(parsed.orders.map((o) => o.orderExtId));
      const dates = parsed.listings.map((l) => l.listedDate).filter(Boolean).sort();
      const existingListings = dates.length ? await getEbayListings(dates[0], dates[dates.length - 1]) : [];
      markDuplicates(parsed.orders, parsed.listings, existingIds, new Set(existingListings.map((l) => listingKey(l))));
      setOrders(parsed.orders);
      setListings(parsed.listings);
      setSheets(parsed.sheetsRead);
      setTab(parsed.orders.length === 0 && parsed.listings.length > 0 ? "listings" : "orders");
      if (parsed.orders.length === 0 && parsed.listings.length === 0) {
        setError("No sales or listing tables found. The sheet needs a header row like \"Order I.D | Part# | …\" or \"DATE | PART# | EBAY ACC | LOCATION | PRICE\".");
      }
    } catch (err) {
      setError(`Couldn't read the file: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setParsing(false);
    }
  };

  const count = <T extends { state: ImportRowState }>(rows: T[]) => ({
    ready: rows.filter((r) => importable(r.state)).length,
    warning: rows.filter((r) => r.state === "warning").length,
    error: rows.filter((r) => r.state === "error").length,
    duplicate: rows.filter((r) => r.state === "duplicate").length,
  });
  const oc = useMemo(() => count(orders), [orders]);
  const lc = useMemo(() => count(listings), [listings]);

  const runImport = async () => {
    setImporting(true);
    setError(null);
    try {
      const orderIds = await bulkCreateEbayOrders(
        orders.filter((o) => importable(o.state)).map(({ orderExtId, partNo, quantity, status, orderEarnings, orderDate, salesAccount, branch, notes }) => ({
          orderExtId, partNo, quantity, status, orderEarnings, orderDate, salesAccount, branch, notes,
        }))
      );
      let listingIds: string[] = [];
      try {
        listingIds = await bulkCreateEbayListings(
          listings.filter((l) => importable(l.state)).map(({ partNo, ebayAccount, branch, price, quantity, listedDate, status }) => ({
            partNo, ebayAccount, branch, price, quantity, listedDate, status,
          }))
        );
      } catch (err) {
        // Keep it all-or-nothing: take back the orders that went in.
        await deleteEbayRowsByIds("ebay_orders", orderIds).catch(() => {});
        throw err;
      }
      setDone({ orderIds, listingIds });
      logActivity({
        action: "ebay_excel_import",
        targetType: activityTargetType,
        targetId: fileName || "import",
        targetLabel: `Imported ${orderIds.length} orders, ${listingIds.length} listings from ${fileName}`,
      });
      onImported();
    } catch (err) {
      setError(`Import failed — nothing was saved: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImporting(false);
    }
  };

  const undo = async () => {
    if (!done || !window.confirm(`Remove the ${done.orderIds.length} orders and ${done.listingIds.length} listings this import added?`)) return;
    setUndoing(true);
    try {
      await deleteEbayRowsByIds("ebay_orders", done.orderIds);
      await deleteEbayRowsByIds("ebay_listings", done.listingIds);
      logActivity({ action: "ebay_excel_import_undone", targetType: activityTargetType, targetId: fileName || "import", targetLabel: `Undid import of ${fileName}` });
      setDone(null);
      onImported();
    } catch (err) {
      setError(`Undo failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUndoing(false);
    }
  };

  const shownOrders = problemsOnly ? orders.filter((o) => o.state !== "ready") : orders;
  const shownListings = problemsOnly ? listings.filter((l) => l.state !== "ready") : listings;
  const total = oc.ready + lc.ready;
  const busy = parsing || importing || undoing;

  const badge = (s: ImportRowState) => <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${STATE_STYLE[s].cls}`}>{STATE_STYLE[s].label}</span>;
  const summary = (c: ReturnType<typeof count>) => (
    <span className="text-[11px] text-slate-400">
      {c.ready} to import{c.warning ? ` (${c.warning} to check)` : ""}
      {c.error ? ` · ${c.error} won't import` : ""}
      {c.duplicate ? ` · ${c.duplicate} duplicate` : ""}
    </span>
  );

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4" onClick={() => !busy && onClose()}>
      <div className="bg-slate-900 border border-white/10 rounded-xl w-full max-w-6xl max-h-[90vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-white/10">
          <FileSpreadsheet className="h-5 w-5 text-green-400" />
          <h2 className="text-base font-bold text-white">Import eBay sheet</h2>
          <button type="button" onClick={onClose} disabled={busy} className="ml-auto text-slate-400 hover:text-white disabled:opacity-40">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-white/10 flex flex-wrap items-center gap-3">
          <label className={`btn text-sm px-3 py-1.5 inline-flex items-center gap-1.5 cursor-pointer ${busy ? "opacity-50 pointer-events-none" : ""}`}>
            <Upload className="h-4 w-4" /> {fileName ? "Choose another file" : "Choose Excel file"}
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void readFile(f);
                e.target.value = "";
              }}
            />
          </label>
          <span className="text-xs text-slate-400 truncate">
            {fileName ? (
              <>
                <span className="text-slate-200">{fileName}</span>
                {sheets.length > 0 && ` · read ${sheets.length} tab${sheets.length === 1 ? "" : "s"}: ${sheets.join(", ")}`}
              </>
            ) : (
              "Google Sheets: File → Download → Microsoft Excel (.xlsx). Sales tables go to Orders, listing tabs go to Listings."
            )}
          </span>
          {parsing && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
        </div>

        {error && <div className="mx-5 mt-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

        {done ? (
          <div className="flex-1 flex flex-col items-center justify-center p-10 text-center">
            <CheckCircle2 className="h-10 w-10 text-green-400 mb-2" />
            <div className="text-white font-semibold">
              Imported {done.orderIds.length} order{done.orderIds.length === 1 ? "" : "s"} and {done.listingIds.length} listing{done.listingIds.length === 1 ? "" : "s"}
            </div>
            <p className="text-xs text-slate-400 mt-1">They're on the report now — change the date range to see older days.</p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => void undo()} disabled={undoing} className="btn text-sm px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50">
                {undoing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />} Undo this import
              </button>
              <button type="button" onClick={onClose} className="btn text-sm px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white">Done</button>
            </div>
          </div>
        ) : orders.length + listings.length > 0 ? (
          <>
            <div className="px-5 pt-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setTab("orders")} className={`rounded-md px-3 py-1.5 text-sm ${tab === "orders" ? "bg-blue-600 text-white" : "bg-white/5 text-slate-300 hover:bg-white/10"}`}>
                Orders ({orders.length})
              </button>
              <button type="button" onClick={() => setTab("listings")} className={`rounded-md px-3 py-1.5 text-sm ${tab === "listings" ? "bg-blue-600 text-white" : "bg-white/5 text-slate-300 hover:bg-white/10"}`}>
                Listings ({listings.length})
              </button>
              <span className="ml-1">{summary(tab === "orders" ? oc : lc)}</span>
              <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                <input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} className="accent-blue-500" /> Show only rows to check
              </label>
            </div>
            <div className="flex-1 overflow-auto px-5 py-3">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-900">
                  {tab === "orders" ? (
                    <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400 border-b border-white/10">
                      <th className="px-2 py-2"></th><th className="px-2 py-2">Tab · row</th><th className="px-2 py-2">Order ID</th><th className="px-2 py-2">Part #</th>
                      <th className="px-2 py-2">Qty</th><th className="px-2 py-2">Status</th><th className="px-2 py-2 text-right">Earnings</th><th className="px-2 py-2">Date</th>
                      <th className="px-2 py-2">Account</th><th className="px-2 py-2">Branch</th><th className="px-2 py-2">Notes / problem</th>
                    </tr>
                  ) : (
                    <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400 border-b border-white/10">
                      <th className="px-2 py-2"></th><th className="px-2 py-2">Tab · row</th><th className="px-2 py-2">Date</th><th className="px-2 py-2">Part #</th>
                      <th className="px-2 py-2">Account</th><th className="px-2 py-2">Branch</th><th className="px-2 py-2 text-right">Price</th><th className="px-2 py-2">Qty</th>
                      <th className="px-2 py-2">Status</th><th className="px-2 py-2">Problem</th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {tab === "orders"
                    ? shownOrders.map((o, i) => (
                        <tr key={`${o.sheet}-${o.row}-${i}`} className={`border-b border-white/5 ${o.state === "error" ? "bg-red-500/[0.04]" : o.state === "duplicate" ? "opacity-60" : ""}`}>
                          <td className="px-2 py-1.5">{badge(o.state)}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap text-slate-500">{o.sheet} · {o.row}</td>
                          <td className="px-2 py-1.5 font-mono whitespace-nowrap">{o.orderExtId}</td>
                          <td className="px-2 py-1.5 font-mono whitespace-nowrap">{o.partNo || "—"}</td>
                          <td className="px-2 py-1.5">{o.quantity}</td>
                          <td className="px-2 py-1.5">{o.status}</td>
                          <td className={`px-2 py-1.5 text-right tabular-nums ${o.orderEarnings < 0 ? "text-red-300" : ""}`}>{money(o.orderEarnings)}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap">{o.orderDate || "—"}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap">{o.salesAccount}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap">{o.branch}</td>
                          <td className="px-2 py-1.5 max-w-[280px]">
                            {o.messages.length > 0 && <div className={o.state === "error" ? "text-red-300" : "text-amber-300"}>{o.messages.join(" · ")}</div>}
                            {o.notes && <div className="text-slate-400 truncate" title={o.notes}>{o.notes}</div>}
                          </td>
                        </tr>
                      ))
                    : shownListings.map((l, i) => (
                        <tr key={`${l.sheet}-${l.row}-${i}`} className={`border-b border-white/5 ${l.state === "error" ? "bg-red-500/[0.04]" : l.state === "duplicate" ? "opacity-60" : ""}`}>
                          <td className="px-2 py-1.5">{badge(l.state)}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap text-slate-500">{l.sheet} · {l.row}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap">{l.listedDate || "—"}</td>
                          <td className="px-2 py-1.5 font-mono whitespace-nowrap">{l.partNo || "—"}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap">{l.ebayAccount}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap">{l.branch}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{money(l.price)}</td>
                          <td className="px-2 py-1.5">{l.quantity}</td>
                          <td className="px-2 py-1.5">{l.status}</td>
                          <td className="px-2 py-1.5 max-w-[280px]">
                            {l.messages.length > 0 && <div className={l.state === "error" ? "text-red-300" : "text-amber-300"}>{l.messages.join(" · ")}</div>}
                          </td>
                        </tr>
                      ))}
                  {(tab === "orders" ? shownOrders : shownListings).length === 0 && (
                    <tr>
                      <td colSpan={11} className="px-2 py-6 text-center text-slate-500">{problemsOnly ? "No problems on this tab." : "Nothing on this tab."}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-3 border-t border-white/10 flex flex-wrap items-center gap-3">
              <span className="text-xs text-slate-400">
                Orders: {summary(oc)} <span className="mx-1">|</span> Listings: {summary(lc)}
              </span>
              <div className="ml-auto flex gap-2">
                <button type="button" onClick={onClose} disabled={busy} className="btn text-sm px-3 py-1.5">Cancel</button>
                <button
                  type="button"
                  onClick={() => void runImport()}
                  disabled={busy || total === 0}
                  className="btn text-sm px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  {importing && <Loader2 className="h-4 w-4 animate-spin" />} Import {oc.ready} order{oc.ready === 1 ? "" : "s"} + {lc.ready} listing{lc.ready === 1 ? "" : "s"}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-10 text-center text-sm text-slate-400">
            <FileSpreadsheet className="h-10 w-10 text-slate-600 mb-2" />
            Choose the eBay workbook to see what will be imported. Nothing is saved until you click Import.
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
