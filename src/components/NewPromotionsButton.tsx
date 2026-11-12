/**
 * Accounting Dashboard → "New Promotion / New wage" button (under US / PH
 * Payroll). Opens the list of HR's promotion forms and wage-increase letters
 * — name, old → new position, new wage, pending signatures / completed —
 * with a red badge for papers sent or completed since this person last
 * opened it. Accounting presses Adjusted once the rate is changed in
 * Payroll. See lib/newPromotions.ts and migration 0443.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearch } from "@tanstack/react-router";
import { clearAttentionCache } from "@/lib/attention";
import { ArrowRight, Check, FileText, Loader2, RotateCcw, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  NEW_WAGE_KIND_LABEL,
  NEW_WAGE_STATUS_LABEL,
  isNewSince,
  needsAdjusting,
  readSeenAt,
  writeSeenAt,
  type NewWageItem,
} from "@/lib/newPromotions";
import { getNewPromotionsAndWages, setWageAdjusted } from "@/lib/supabase/newPromotions";
import { InlinePdfLink } from "@/components/InlinePdfViewer";

type Filter = "all" | "to_adjust" | "pending" | "adjusted";

// Every paper is in exactly one of the first three, so they add up to All.
const FILTERS: { key: Filter; label: string; title?: string }[] = [
  { key: "to_adjust", label: "To adjust", title: "Completed, rate not marked Adjusted yet" },
  { key: "pending", label: "Pending signatures", title: "Still being signed, or waiting for HR to confirm" },
  { key: "adjusted", label: "Adjusted", title: "Accounting marked the rate as changed in Payroll" },
  { key: "all", label: "All" },
];

const matches = (i: NewWageItem, f: Filter) =>
  f === "all" ? true
  : f === "adjusted" ? !!i.adjusted
  : f === "pending" ? i.status !== "confirmed" && !i.adjusted
  : needsAdjusting(i);

const fmtDay = (iso: string | null) => {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const STATUS_PILL: Record<NewWageItem["status"], string> = {
  pending_signature: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  signed: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  confirmed: "bg-green-500/15 text-green-300 border-green-500/30",
};

export function NewPromotionsButton() {
  const { uid, displayName } = useAuth();
  const [items, setItems] = useState<NewWageItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [seenAt, setSeenAt] = useState<string | null>(null);
  /** What counted as new when the list was opened — those rows keep their "New" pill until it closes. */
  const [newOnOpen, setNewOnOpen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("to_adjust");

  const load = useCallback(() => {
    setError(null);
    getNewPromotionsAndWages()
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => { setSeenAt(readSeenAt(uid)); }, [uid]);
  useEffect(() => { load(); }, [load]);

  const unseen = useMemo(() => (items ?? []).filter((i) => isNewSince(i, seenAt)), [items, seenAt]);

  // Home's "New promotion need to adjust rate" card links here with ?open=newWages — open the list once the rows are in.
  const routeSearch = (useSearch({ strict: false }) as { open?: string }) ?? {};
  const autoOpened = useRef(false);
  useEffect(() => {
    if (routeSearch.open === "newWages" && items && !autoOpened.current) {
      autoOpened.current = true;
      openList();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSearch.open, items]);

  const openList = () => {
    setNewOnOpen(new Set(unseen.map((i) => i.id)));
    setActionError(null);
    setOpen(true);
    load();
    const now = new Date().toISOString();
    writeSeenAt(uid, now);
    setSeenAt(now);
  };

  const toggleAdjusted = async (item: NewWageItem) => {
    setBusyId(item.id);
    setActionError(null);
    try {
      await setWageAdjusted(item.id, !item.adjusted);
      setItems((prev) => prev?.map((x) => (x.id === item.id ? { ...x, adjusted: x.adjusted ? null : { byName: displayName ?? null, at: new Date().toISOString() } } : x)) ?? prev);
      clearAttentionCache(); // Home's card recounts
      load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, to_adjust: 0, pending: 0, adjusted: 0 };
    for (const i of items ?? []) for (const f of FILTERS) if (matches(i, f.key)) c[f.key]++;
    return c;
  }, [items]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter((i) => matches(i, filter) && (!q || `${i.employeeName} ${i.oldPosition} ${i.newPosition}`.toLowerCase().includes(q)));
  }, [items, query, filter]);

  const modal = open && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-6" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-wage-title"
        className="w-full max-w-[1400px] h-[92vh] flex flex-col rounded-xl border border-white/10 bg-slate-900 text-left shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-white/10 px-5 py-4">
          <div className="flex-1 min-w-0">
            <h3 id="new-wage-title" className="text-lg font-bold text-white">New Promotion / New wage</h3>
            <p className="text-xs text-slate-400">
              Promotion forms and wage-increase letters from HR. When one is completed, change the employee's rate in Payroll from the effective date, then press Adjusted.
            </p>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-5 py-2.5">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                title={f.title}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${filter === f.key ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
              >
                {f.label} <span className="tabular-nums opacity-80">{items ? counts[f.key] : ""}</span>
              </button>
            ))}
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Employee or position…"
            aria-label="Search"
            className="ml-auto w-60 rounded-md border border-white/10 bg-slate-800 px-2.5 py-1.5 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
          />
          {newOnOpen.size > 0 && <span className="text-xs font-semibold text-red-300">{newOnOpen.size} new</span>}
        </div>

        {actionError && <p className="mx-5 mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{actionError}</p>}

        <div className="flex-1 overflow-auto">
          {error ? (
            <p className="p-5 text-sm text-red-300">Couldn't load the list: {error}</p>
          ) : !items ? (
            <p className="flex items-center gap-2 p-5 text-sm text-slate-300"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
          ) : shown.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-500">{query ? "Nothing matches that search." : "Nothing here."}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-900">
                <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-2.5 font-semibold">Employee</th>
                  <th className="px-4 py-2.5 font-semibold">Old position → New position title</th>
                  <th className="px-4 py-2.5 font-semibold">New wage</th>
                  <th className="px-4 py-2.5 font-semibold">Effective</th>
                  <th className="px-4 py-2.5 font-semibold">Paper status</th>
                  <th className="px-4 py-2.5 font-semibold">PDF</th>
                  <th className="px-5 py-2.5 font-semibold text-right">Payroll</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => (
                  <tr key={i.id} className={`border-b border-white/5 ${newOnOpen.has(i.id) ? "bg-red-500/[0.06]" : ""}`}>
                    <td className="px-5 py-3 align-top">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white">{i.employeeName || "—"}</span>
                        {newOnOpen.has(i.id) && <span className="rounded-full bg-red-600 px-1.5 text-[10px] font-bold uppercase text-white">New</span>}
                      </div>
                      <span className="text-[11px] text-slate-500">{NEW_WAGE_KIND_LABEL[i.kind]} · sent {fmtDay(i.createdAt)}</span>
                    </td>
                    <td className="px-4 py-3 align-top text-slate-200">
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        <span className={i.oldPosition ? "" : "text-slate-500"}>{i.oldPosition || "—"}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-slate-500" />
                        <span className="font-semibold text-white">{i.newPosition || "—"}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top font-semibold text-green-300 tabular-nums whitespace-nowrap">{i.newWage || "—"}</td>
                    <td className="px-4 py-3 align-top text-slate-300 whitespace-nowrap">{fmtDay(i.effectiveDate)}</td>
                    <td className="px-4 py-3 align-top">
                      <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${STATUS_PILL[i.status]}`}>
                        {NEW_WAGE_STATUS_LABEL[i.status]}
                      </span>
                      {i.confirmedAt && <p className="mt-0.5 text-[11px] text-slate-500">{fmtDay(i.confirmedAt)}</p>}
                    </td>
                    <td className="px-4 py-3 align-top">
                      {i.pdfUrl ? (
                        <span className="inline-flex items-center gap-1 text-blue-300">
                          <FileText className="h-3.5 w-3.5" />
                          <InlinePdfLink
                            url={i.pdfUrl}
                            label="View PDF"
                            fileName={`${NEW_WAGE_KIND_LABEL[i.kind]} - ${i.employeeName}.pdf`}
                            className="text-xs underline hover:text-blue-200"
                          />
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 align-top text-right">
                      {i.adjusted ? (
                        <div className="inline-flex flex-col items-end gap-0.5">
                          <span className="inline-flex items-center gap-1 rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white">
                            <Check className="h-3.5 w-3.5" /> Adjusted
                          </span>
                          <span className="text-[11px] text-slate-300">
                            by <span className="font-semibold text-white">{i.adjusted.byName ?? "—"}</span> · {fmtDay(i.adjusted.at)}
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleAdjusted(i)}
                            disabled={busyId === i.id}
                            className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white disabled:opacity-50"
                          >
                            <RotateCcw className="h-3 w-3" /> Undo
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => toggleAdjusted(i)}
                          disabled={busyId === i.id || i.status !== "confirmed"}
                          title={i.status !== "confirmed" ? "Available once all signatures are in and HR confirms it" : "Mark the rate as changed in Payroll"}
                          className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                        >
                          {busyId === i.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Need to be adjusted
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={openList}
        className="relative px-3 py-1.5 text-sm rounded font-semibold bg-slate-700 text-slate-100 hover:bg-slate-600 transition"
      >
        New Promotion / New wage
        {/* Stays until every completed paper is marked Adjusted. */}
        {counts.to_adjust > 0 && (
          <span
            className="absolute -top-2 -right-2 min-w-[20px] h-5 px-1 rounded-full bg-red-600 text-white text-[11px] font-bold leading-5 text-center tabular-nums"
            aria-label={`${counts.to_adjust} to adjust`}
            title={`${counts.to_adjust} completed promotion / wage paper${counts.to_adjust === 1 ? "" : "s"} not marked Adjusted yet`}
          >
            {counts.to_adjust > 99 ? "99+" : counts.to_adjust}
          </span>
        )}
      </button>
      {/* Portaled: the dashboard header sits inside a blurred .panel, which traps position: fixed. */}
      {modal && typeof document !== "undefined" && createPortal(modal, document.body)}
    </>
  );
}
