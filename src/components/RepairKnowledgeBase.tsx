/**
 * Repair Knowledge — Triage module. Past repairs grouped by model, sourced
 * from Completed/Claimed/Data Closed tickets (statusGroupOf === "completed"),
 * so Technical Support can look up "has anyone fixed this model before, and
 * how" without digging through individual tickets.
 *
 * One row per ticket (not per visit) — the ticket's most recently updated
 * visit supplies Unit Problem (symptomCx, falling back to diagnosis),
 * Part/Action, and Outcome/Notes; Part Number joins every part used across
 * the ticket's full parts history, not just the latest visit.
 *
 * There's no real "was this repair actually successful" field anywhere on a
 * ticket, so — per an explicit call not to guess at that judgment — this
 * page shows the real Redo flag (Y/N) as its own column instead of
 * inventing a Status category. Ticket No links straight to the ticket for
 * full context.
 *
 * Grouped by Product + Model only, not by manufacturer/brand — there's no
 * reliable brand field on a ticket (`manufacturer` holds a warranty/source
 * code like "IH", not the appliance brand), so unlike a hand-curated
 * reference, this can't safely group AMANA/GE/WHIRLPOOL etc. without
 * guessing from the model number prefix.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { statusGroupOf, type Ticket } from "@/lib/ticketData";
import { getCompanyTickets, getVisitsByTicketIds, getPartsByTicketIds } from "@/lib/supabase/tickets";

// Same lookback/"load full history" pattern TicketList.tsx uses — this
// page can otherwise pull years of closed tickets on first load.
const LOOKBACK_DAYS = 180;
function lookbackSinceIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - LOOKBACK_DAYS);
  return d.toISOString().slice(0, 10);
}

// Same helper as TicketList.tsx's own productLabel — kept as its own copy,
// page-local helpers aren't exported/shared between these files.
function productLabel(ticket: { productType?: string; model?: string }): string {
  const explicit = (ticket.productType || "").trim();
  if (explicit) return explicit;
  const model = (ticket.model || "").toLowerCase();
  const guesses: Array<[RegExp, string]> = [
    [/dryer/, "Dryer"],
    [/washer|washing/, "Washer"],
    [/refrig|fridge/, "Refrigerator"],
    [/freezer/, "Freezer"],
    [/dishwash/, "Dishwasher"],
    [/range|stove|oven|cooktop/, "Range/Oven"],
    [/microwave/, "Microwave"],
    [/ice\s*maker/, "Ice Maker"],
    [/disposal/, "Disposal"],
    [/water\s*heater/, "Water Heater"],
  ];
  for (const [re, label] of guesses) {
    if (re.test(model)) return label;
  }
  return "—";
}

interface RepairRow {
  ticketNo: string;
  date: string;
  technician: string;
  product: string;
  model: string;
  unitProblem: string;
  partAction: string;
  partNumbers: string;
  redo: boolean;
  outcome: string;
}

export function RepairKnowledgeBase({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [visitsByTicket, setVisitsByTicket] = useState<Map<string, any[]>>(new Map());
  const [partsByTicket, setPartsByTicket] = useState<Map<string, any[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [fullHistoryLoaded, setFullHistoryLoaded] = useState(false);
  const [loadingFull, setLoadingFull] = useState(false);
  const [search, setSearch] = useState("");
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set());

  const load = useCallback(async (full: boolean) => {
    if (full) setLoadingFull(true);
    else setLoading(true);
    try {
      const rows = await getCompanyTickets(full ? undefined : { sinceDate: lookbackSinceIso() });
      const completed = rows.filter((t) => statusGroupOf(t.status) === "completed");
      setTickets(completed);
      const ids = completed.map((t) => String((t as any)._id || "")).filter(Boolean);
      const [visits, parts] = await Promise.all([getVisitsByTicketIds(ids), getPartsByTicketIds(ids)]);
      setVisitsByTicket(visits);
      setPartsByTicket(parts);
      if (full) setFullHistoryLoaded(true);
    } catch (err) {
      console.error("Failed to load Repair Knowledge Base:", err);
    } finally {
      setLoading(false);
      setLoadingFull(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const latestVisitFor = (tid: string): any | null => {
    const visits = visitsByTicket.get(tid);
    if (!visits || visits.length === 0) return null;
    return [...visits].sort((a: any, b: any) => (b.updatedAt || b.timestamp || "").localeCompare(a.updatedAt || a.timestamp || ""))[0];
  };

  const rows: RepairRow[] = useMemo(() => {
    return tickets
      .map((t): RepairRow | null => {
        const model = (t.model || "").trim();
        if (!model) return null; // nothing to group this ticket under
        const tid = String((t as any)._id || "");
        const visit = latestVisitFor(tid);
        const parts = partsByTicket.get(tid) ?? [];
        const partAction =
          parts.length > 0
            ? parts.map((p: any) => p.partDesc || p.partNo).filter(Boolean).join(", ")
            : visit?.repairType || visit?.activity || "";
        return {
          ticketNo: t.ticketNo,
          date: t.created || "",
          technician: t.technician || "",
          product: productLabel(t),
          model,
          unitProblem: visit?.symptomCx || visit?.diagnosis || "",
          partAction,
          partNumbers: parts.map((p: any) => p.partNo).filter(Boolean).join(", "),
          redo: t.redo === "Y",
          outcome: visit?.resolution || t.triageNotes || "",
        };
      })
      .filter((r): r is RepairRow => r !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets, visitsByTicket, partsByTicket]);

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = !q
      ? rows
      : rows.filter(
          (r) =>
            r.model.toLowerCase().includes(q) ||
            r.product.toLowerCase().includes(q) ||
            r.unitProblem.toLowerCase().includes(q) ||
            r.partNumbers.toLowerCase().includes(q) ||
            r.ticketNo.toLowerCase().includes(q)
        );
    const map = new Map<string, RepairRow[]>();
    for (const r of filtered) {
      const key = `${r.product} | Model ${r.model}`;
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return Array.from(map.entries())
      .map(([key, groupRows]): [string, RepairRow[]] => [key, groupRows.sort((a, b) => b.date.localeCompare(a.date))])
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows, search]);

  const toggleModel = (key: string) =>
    setExpandedModels((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-4 sm:px-6 py-8">
        <div className="flex items-center gap-3 mb-2">
          <button type="button" onClick={goBack} className="btn hover:bg-white/15">
            <ChevronLeft className="h-4 w-4" /> {mod.label}
          </button>
        </div>
        <h1 className="text-2xl font-bold mb-1">{sub.title}</h1>
        <p className="text-sm text-muted-foreground mb-6">{sub.description}</p>

        {!fullHistoryLoaded && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-xs text-muted-foreground">
            <span>Showing completed tickets from the last {LOOKBACK_DAYS / 30} months for a faster load.</span>
            <button type="button" onClick={() => void load(true)} disabled={loadingFull} className="text-blue-400 hover:text-blue-300 font-medium disabled:opacity-50">
              {loadingFull ? "Loading…" : "Load full history"}
            </button>
          </div>
        )}

        <div className="panel p-4 mb-4">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Search</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Model, symptom, part number, ticket no…"
            className="glass-input w-full"
          />
        </div>

        {loading ? (
          <div className="panel p-10 flex items-center justify-center text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : grouped.length === 0 ? (
          <div className="panel p-10 text-center text-sm text-muted-foreground">No completed tickets match.</div>
        ) : (
          <div className="space-y-3">
            {grouped.map(([key, groupRows]) => {
              const open = expandedModels.has(key);
              return (
                <div key={key} className="panel p-0 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleModel(key)}
                    className="w-full flex items-center gap-2 px-4 py-3 border-b border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-left"
                  >
                    {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                    <span className="font-semibold text-sm">{key}</span>
                    <span className="text-xs text-muted-foreground">({groupRows.length} ticket{groupRows.length === 1 ? "" : "s"})</span>
                  </button>
                  {open && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-slate-400 border-b border-white/10 text-left">
                            <th className="py-2 px-3">Ticket No</th>
                            <th className="py-2 px-3">Unit Problem</th>
                            <th className="py-2 px-3">Part / Action</th>
                            <th className="py-2 px-3">Part Number</th>
                            <th className="py-2 px-3">Outcome / Tech Support Guidance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {groupRows.map((r) => (
                            <tr key={r.ticketNo} className="border-b border-white/5 align-top">
                              <td className="py-2 px-3 font-mono font-semibold whitespace-nowrap">
                                <a href={`/ticket/${r.ticketNo}`} target="_blank" rel="noopener noreferrer" className="text-blue-300 hover:text-blue-200 hover:underline">
                                  {r.ticketNo}
                                </a>
                              </td>
                              <td className="py-2 px-3 text-slate-300 max-w-xs">{r.unitProblem || "—"}</td>
                              <td className="py-2 px-3 text-slate-300 max-w-xs">{r.partAction || "—"}</td>
                              <td className="py-2 px-3 text-slate-300 font-mono text-xs whitespace-nowrap">{r.partNumbers || "—"}</td>
                              <td className="py-2 px-3 text-slate-300 max-w-sm">{r.outcome || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
