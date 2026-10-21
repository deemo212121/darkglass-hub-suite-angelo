/**
 * Claims → Pre-Auth: ServicePower's Call Auth (Request for Authorization)
 * filled in from the app. A queue of tickets in PT-Need PreAuthorization
 * (plus any ticket with a saved Pre-Auth, or one opened by number), and a
 * form laid out like ServicePower's screen that saves as a draft
 * (migration 0402).
 *
 * Sending to ServicePower is locked: Submit only goes out for a company
 * whose settings.spPreAuthSubmitEnabled is true (nothing in the app turns
 * it on), and even then asks "Submit this Pre-Auth to ServicePower?" first.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { CheckCircle2, ChevronLeft, Clock, FileCheck2, Loader2, Lock, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import type { Ticket } from "@/lib/ticketData";
import { useAuth } from "@/lib/auth";
import { localISODate } from "@/lib/localDate";
import { getCompanyUsersLite } from "@/lib/supabase/users";
import { PRE_AUTH_DEFAULT_ROLES } from "@/lib/submoduleAccess";
import { useSmartBack } from "@/hooks/useSmartBack";
import { TicketColumnFilter } from "@/components/TicketColumnFilter";
import { getCompanyTicketsWithStatuses, getTicketByNumber, getTicketParts } from "@/lib/supabase/tickets";
import { claimToColor } from "@/lib/claimToColors";
import { jobCodesFor } from "@/lib/jobCodes";
import { buildPreAuthRFA } from "@/lib/preAuthPayload";
import {
  emptyPreAuthForm,
  getPreAuthRequests,
  isPreAuthSubmitEnabled,
  markPreAuthSent,
  preAuthMissing,
  preAuthTotals,
  savePreAuthRequest,
  type PreAuthForm,
  type PreAuthPart,
  type PreAuthRequest,
  type YesNo,
} from "@/lib/supabase/preAuth";

const PRE_AUTH_TICKET_STATUS = "PT-Need PreAuthorization";
const fmtMoney = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const custName = (t: Ticket) => [t.firstName, t.lastName].filter(Boolean).join(" ") || t.customer || "—";
const daysSince = (iso?: string) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
};

const STATUS_PILL: Record<string, string> = {
  "Not started": "border-slate-400/25 bg-slate-500/10 text-slate-300",
  Draft: "border-amber-400/40 bg-amber-500/10 text-amber-200",
  Ready: "border-sky-400/40 bg-sky-500/10 text-sky-200",
  Sent: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
};

/** "YYYY-MM-DD" (local) of an ISO timestamp, "" when missing. */
const isoDay = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : localISODate(d);
};
const fmtDay = (day: string) => (day ? new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");

interface Row {
  ticketNo: string;
  ticket: Ticket | null;
  preAuth: PreAuthRequest | null;
}

export function PreAuthPage({ mod }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const { companyId, displayName, email } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [preAuths, setPreAuths] = useState<Map<string, PreAuthRequest>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // Pending = not sent yet (Not started / Draft / Ready); Completed = Sent.
  const [bucket, setBucket] = useState<"pending" | "completed" | null>(null);
  // "Managed by" choices: active Claims / Parts / BizOps / Admin people.
  const [managers, setManagers] = useState<string[]>([]);
  useEffect(() => {
    getCompanyUsersLite()
      .then((list) => {
        const allowed = new Set(PRE_AUTH_DEFAULT_ROLES);
        const names = list
          .filter((u) => u.is_active && [u.role, ...((u.extra_roles as string[] | null) ?? [])].some((r) => allowed.has(String(r || "").trim().toUpperCase().replace(/\s+/g, "_"))))
          .map((u) => u.display_name || u.email || "")
          .filter(Boolean);
        setManagers(Array.from(new Set(names)).sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => {});
  }, []);
  const [openTicketNo, setOpenTicketNo] = useState("");
  const [opening, setOpening] = useState(false);
  const [editing, setEditing] = useState<{ ticket: Ticket; preAuth: PreAuthRequest | null } | null>(null);
  // Admin → Company Settings → ServicePower switch (SuperAdmin). Off by default.
  const [sendOn, setSendOn] = useState(false);
  useEffect(() => { isPreAuthSubmitEnabled(companyId).then(setSendOn).catch(() => setSendOn(false)); }, [companyId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [t, p] = await Promise.all([
        getCompanyTicketsWithStatuses(["PreAuthorization"]),
        getPreAuthRequests().catch((e) => {
          setError(e instanceof Error ? e.message : String(e));
          return new Map<string, PreAuthRequest>();
        }),
      ]);
      setTickets(t.filter((x) => /pre\s*-?\s*auth/i.test(x.status || "")));
      setPreAuths(p);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Tickets waiting for a Pre-Auth, plus any saved Pre-Auth whose ticket has since moved on.
  const rows: Row[] = useMemo(() => {
    const byNo = new Map(tickets.map((t) => [t.ticketNo, t]));
    const out: Row[] = tickets.map((t) => ({ ticketNo: t.ticketNo, ticket: t, preAuth: preAuths.get(t.ticketNo) ?? null }));
    for (const [no, p] of preAuths) if (!byNo.has(no)) out.push({ ticketNo: no, ticket: null, preAuth: p });
    return out;
  }, [tickets, preAuths]);

  /** The row's date: when its Pre-Auth was last saved, else when the ticket went into its status. */
  const rowDay = (r: Row) => isoDay(r.preAuth?.updatedAt) || isoDay(r.ticket?.statusChangedAt);
  const isCompleted = (r: Row) => r.preAuth?.status === "Sent";
  const rangeRows = rows.filter((r) => {
    if (!dateFrom && !dateTo) return true;
    const d = rowDay(r);
    return !!d && (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo);
  });
  const bucketRows = rangeRows.filter((r) => (bucket === "pending" ? !isCompleted(r) : bucket === "completed" ? isCompleted(r) : true));

  const COLUMNS: { key: string; label: string; value: (r: Row) => string; align?: "right" }[] = [
    { key: "ticketNo", label: "Ticket #", value: (r) => r.ticketNo },
    { key: "customer", label: "Customer", value: (r) => (r.ticket ? custName(r.ticket) : "—") },
    { key: "claimTo", label: "Claim To", value: (r) => (r.ticket ? claimToColor(r.ticket.account || r.ticket.claimCompany).label : "—") },
    { key: "brand", label: "Brand", value: (r) => r.ticket?.manufacturer || "—" },
    { key: "model", label: "Model", value: (r) => r.ticket?.model || "—" },
    { key: "technician", label: "Technician", value: (r) => r.ticket?.technician || "—" },
    { key: "ticketStatus", label: "Ticket Status", value: (r) => r.ticket?.status || "(moved on)" },
    { key: "preAuth", label: "Pre-Auth", value: (r) => r.preAuth?.status || "Not started" },
    { key: "managedBy", label: "Managed by", value: (r) => r.preAuth?.managedByName || "—" },
    { key: "date", label: "Date", value: (r) => fmtDay(rowDay(r)) },
    { key: "days", label: "Days", value: (r) => { const d = daysSince(r.ticket?.statusChangedAt); return d == null ? "—" : String(d); } },
    { key: "requested", label: "Requested", value: (r) => (r.preAuth ? fmtMoney(r.preAuth.total) : "—"), align: "right" },
    { key: "savedBy", label: "Last saved by", value: (r) => r.preAuth?.updatedByName || "—" },
  ];
  const matchesSearch = (r: Row) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [r.ticketNo, r.ticket ? custName(r.ticket) : "", r.ticket?.model, r.ticket?.serial, r.ticket?.manufacturer].join(" ").toLowerCase().includes(q);
  };
  const matchesColumns = (r: Row, skip?: string) => COLUMNS.every((c) => c.key === skip || !colFilters[c.key]?.size || colFilters[c.key].has(c.value(r)));
  const filtered = bucketRows.filter((r) => matchesSearch(r) && matchesColumns(r));
  const columnOptions = (key: string) => {
    const col = COLUMNS.find((c) => c.key === key)!;
    const list = Array.from(new Set(bucketRows.filter((r) => matchesSearch(r) && matchesColumns(r, key)).map(col.value)));
    const n = (v: string) => Number(v.replace(/[$,]/g, ""));
    if (key === "days" || key === "requested") return list.sort((a, b) => (Number.isNaN(n(a)) ? 1 : Number.isNaN(n(b)) ? -1 : n(a) - n(b)));
    if (key === "date") return list.sort((a, b) => (a === "—" ? 1 : b === "—" ? -1 : new Date(b).getTime() - new Date(a).getTime()));
    return list.sort((a, b) => a.localeCompare(b));
  };
  // The two cards follow the date range, search and column filters (not the card picked).
  const cardBase = rangeRows.filter((r) => matchesSearch(r) && matchesColumns(r));
  const pendingRows = cardBase.filter((r) => !isCompleted(r));
  const completedRows = cardBase.filter(isCompleted);
  const sumRequested = (list: Row[]) => list.reduce((t, r) => t + (r.preAuth?.total ?? 0), 0);
  const anyFilter = !!(search || dateFrom || dateTo || bucket || Object.values(colFilters).some((v) => v.size));
  const counts = useMemo(() => {
    const c = { "Not started": 0, Draft: 0, Ready: 0, Sent: 0 } as Record<string, number>;
    for (const r of filtered) c[r.preAuth?.status || "Not started"]++;
    return c;
  }, [filtered]);

  const openRow = async (r: Row) => {
    const ticket = r.ticket ?? (await getTicketByNumber(r.ticketNo));
    if (!ticket) { alert(`Ticket ${r.ticketNo} wasn't found.`); return; }
    setEditing({ ticket, preAuth: r.preAuth });
  };
  const openByNumber = async () => {
    const no = openTicketNo.trim();
    if (!no) return;
    setOpening(true);
    try {
      const ticket = await getTicketByNumber(no);
      if (!ticket) { alert(`Ticket ${no} wasn't found.`); return; }
      setEditing({ ticket, preAuth: preAuths.get(ticket.ticketNo) ?? null });
      setOpenTicketNo("");
    } finally {
      setOpening(false);
    }
  };

  return (
    <main className="flex-1 max-w-[1900px] mx-auto w-full px-4 py-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={goBack} className="btn"><ChevronLeft className="h-4 w-4" /></button>
        <h1 className="text-xl font-bold">Pre-Auth</h1>
        <span className="text-xs text-muted-foreground">ServicePower Call Auth (Request for Authorization) — fill in and save here</span>
        {sendOn ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-200" title="Turned on in Admin → Company Settings → ServicePower. Submit still asks before sending.">
            Sending to ServicePower is ON
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-200" title="Nothing is sent to ServicePower from this page. A SuperAdmin can turn it on in Admin → Company Settings → ServicePower.">
            <Lock className="h-3 w-3" /> Sending to ServicePower is off · turn on in Admin → Company Settings
          </span>
        )}
        <button type="button" onClick={() => void load()} className="btn ml-auto inline-flex items-center gap-1.5 text-sm" disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {error && <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">{error}</p>}

      {/* Pending / Completed — click to show only those; the date range drives both. */}
      <div className="flex flex-wrap items-stretch gap-3">
        {([
          { key: "pending" as const, title: "Pending Pre-Auth", sub: "Not started, Draft or Ready — not sent yet", list: pendingRows, Icon: Clock, tone: "border-amber-400/30 bg-amber-500/[0.07]", ring: "ring-amber-300/70", num: "text-amber-200" },
          { key: "completed" as const, title: "Completed Pre-Auth", sub: "Sent to ServicePower", list: completedRows, Icon: CheckCircle2, tone: "border-emerald-400/30 bg-emerald-500/[0.07]", ring: "ring-emerald-300/70", num: "text-emerald-200" },
        ]).map(({ key, title, sub, list, Icon, tone, ring, num }) => {
          const on = bucket === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setBucket(on ? null : key)}
              className={`min-w-[230px] flex-1 sm:flex-none text-left rounded-xl border px-4 py-3 transition ${tone} ${on ? `ring-2 ${ring}` : bucket ? "opacity-60 hover:opacity-100" : "hover:brightness-125"}`}
              title={on ? "Show all" : `Show only ${title.toLowerCase()}`}
            >
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-300"><Icon className="h-4 w-4" /> {title}</p>
              <p className={`mt-1 text-3xl font-bold tabular-nums ${num}`}>{list.length}</p>
              <p className="text-xs text-slate-400">{fmtMoney(sumRequested(list))} requested · {sub}</p>
            </button>
          );
        })}
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">From</span>
            <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">To</span>
            <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md" />
          </label>
          {(dateFrom || dateTo) && <button type="button" onClick={() => { setDateFrom(""); setDateTo(""); }} className="btn text-xs px-2.5 py-1.5">Clear dates</button>}
          <p className="basis-full text-[10px] text-slate-500">Date = when the Pre-Auth was last saved, or when the ticket went into its status.</p>
        </div>
      </div>

      <div className="panel p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 bg-white/5 flex flex-wrap items-end gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ticket #, customer, model, serial…" className="glass-input text-sm py-1.5 pl-8 pr-3 rounded-md w-64" />
          </div>
          <div className="flex items-end gap-1.5">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Start one for any ticket</span>
              <input value={openTicketNo} onChange={(e) => setOpenTicketNo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void openByNumber()} placeholder="Ticket #" className="glass-input text-sm py-1.5 px-3 rounded-md w-40" />
            </label>
            <button type="button" onClick={() => void openByNumber()} disabled={opening || !openTicketNo.trim()} className="btn text-sm px-3 py-1.5 inline-flex items-center gap-1 disabled:opacity-40">
              {opening ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Open
            </button>
          </div>
          {anyFilter && (
            <button type="button" onClick={() => { setSearch(""); setDateFrom(""); setDateTo(""); setBucket(null); setColFilters({}); }} className="btn text-xs px-2.5 py-1.5">Clear all filters</button>
          )}
          <span className="text-xs text-muted-foreground mb-1.5">{filtered.length}{filtered.length !== rows.length ? ` of ${rows.length}` : ""} tickets</span>
          <div className="flex flex-wrap gap-1.5 ml-auto">
            {Object.entries(counts).map(([k, n]) => (
              <span key={k} className={`rounded-full border px-2.5 py-1 text-xs ${STATUS_PILL[k]}`}>{k} <span className="font-semibold tabular-nums">{n}</span></span>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                {COLUMNS.map((c) => (
                  <th key={c.key} className={`px-3 py-2.5 text-xs text-muted-foreground uppercase whitespace-nowrap ${c.align === "right" ? "text-right" : "text-left"}`}>
                    <span className="inline-flex items-center">
                      {c.label}
                      <TicketColumnFilter options={columnOptions(c.key)} selected={colFilters[c.key] ?? new Set()} onChange={(next) => setColFilters((p) => ({ ...p, [c.key]: next }))} label={`Filter by ${c.label}`} />
                    </span>
                  </th>
                ))}
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={COLUMNS.length + 1} className="px-4 py-8 text-center text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin mr-2" />Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={COLUMNS.length + 1} className="px-4 py-8 text-center text-muted-foreground">{rows.length === 0 ? `No tickets in ${PRE_AUTH_TICKET_STATUS}. Use "Start one for any ticket" to open another.` : "No tickets match this search/filter."}</td></tr>
              ) : (
                filtered.map((r) => {
                  const ct = r.ticket ? claimToColor(r.ticket.account || r.ticket.claimCompany) : null;
                  const st = r.preAuth?.status || "Not started";
                  const days = daysSince(r.ticket?.statusChangedAt);
                  return (
                    <tr key={r.ticketNo} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-3 py-2 font-medium">
                        <a href={`/ticket/${encodeURIComponent(r.ticketNo)}`} target="_blank" rel="noopener noreferrer" className="text-blue-300 hover:underline">{r.ticketNo}</a>
                      </td>
                      <td className="px-3 py-2">{r.ticket ? custName(r.ticket) : "—"}</td>
                      <td className="px-3 py-2">{ct ? <span className={`inline-block rounded border px-1.5 py-0.5 text-xs ${ct.pill}`}>{r.ticket?.account || r.ticket?.claimCompany || ct.label}</span> : "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.ticket?.manufacturer || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.ticket?.model || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.ticket?.technician || "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{r.ticket?.status || "(moved on)"}</td>
                      <td className="px-3 py-2"><span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${STATUS_PILL[st]}`}>{st}</span></td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.preAuth?.managedByName || <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{fmtDay(rowDay(r))}</td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{days ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.preAuth ? fmtMoney(r.preAuth.total) : "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{r.preAuth?.updatedByName || "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <button type="button" onClick={() => void openRow(r)} className="btn text-xs px-3 py-1 inline-flex items-center gap-1">
                          <FileCheck2 className="h-3.5 w-3.5" /> {r.preAuth ? "Open" : "Start Pre-Auth"}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing &&
        createPortal(
          <PreAuthFormModal
            ticket={editing.ticket}
            existing={editing.preAuth}
            companyId={companyId}
            byName={displayName || email || null}
            managers={managers}
            sendOn={sendOn}
            onClose={() => setEditing(null)}
            onSaved={(p) => setPreAuths((prev) => new Map(prev).set(p.ticketNo, p))}
          />,
          document.body,
        )}
    </main>
  );
}

const inputCls = "w-full bg-slate-800/60 border border-white/10 rounded-md px-2.5 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none";
const labelCls = "block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1";
const Req = () => <span className="text-pink-400">*</span>;

function YesNoField({ label, required, value, onChange }: { label: string; required?: boolean; value: YesNo; onChange: (v: YesNo) => void }) {
  return (
    <div>
      <p className={labelCls}>{label} {required && <Req />}</p>
      <div className="flex gap-4 text-sm text-slate-200">
        {(["Y", "N"] as const).map((v) => (
          <label key={v} className="inline-flex items-center gap-1.5 cursor-pointer">
            <input type="radio" checked={value === v} onChange={() => onChange(v)} className="accent-blue-500" />
            {v === "Y" ? "Yes" : "No"}
          </label>
        ))}
      </div>
    </div>
  );
}

function ReadOnly({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm text-slate-200 break-words">{value || "—"}</p>
    </div>
  );
}

function PreAuthFormModal({
  ticket,
  existing,
  companyId,
  byName,
  managers,
  sendOn,
  onClose,
  onSaved,
}: {
  ticket: Ticket;
  existing: PreAuthRequest | null;
  companyId: string | null;
  byName: string | null;
  managers: string[];
  sendOn: boolean;
  onClose: () => void;
  onSaved: (p: PreAuthRequest) => void;
}) {
  // Who is handling it — defaults to whoever starts it.
  const [managedBy, setManagedBy] = useState(existing?.managedByName ?? byName ?? "");
  const managerOptions = managedBy && !managers.includes(managedBy) ? [managedBy, ...managers] : managers;
  const [form, setForm] = useState<PreAuthForm>(() => existing?.form ?? { ...emptyPreAuthForm(), newBrand: ticket.manufacturer || "" });
  const [saved, setSaved] = useState<PreAuthRequest | null>(existing);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const set = <K extends keyof PreAuthForm>(k: K, v: PreAuthForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  // A new Pre-Auth starts with the ticket's parts (not cancelled / returned).
  useEffect(() => {
    if (existing) return;
    let cancelled = false;
    getTicketParts(ticket.ticketNo)
      .then((parts) => {
        if (cancelled) return;
        const lines: PreAuthPart[] = parts
          .filter((p) => p.partNo && !/cancel|return|not used/i.test(p.status || ""))
          .map((p) => ({ quantity: p.quantity || "1", partNumber: p.partNo, description: p.partDesc || "", price: p.partPrice || "" }));
        if (lines.length) setForm((f) => (f.parts.length ? f : { ...f, parts: lines }));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [existing, ticket.ticketNo]);

  const jobRule = jobCodesFor(ticket.account, ticket.claimCompany, ticket.manufacturer);
  const jobList = jobRule && jobRule.field === "jobCode" && jobRule.codes.length ? jobRule : null;
  const pickedJob = jobList?.codes.find((c) => c.code === form.jobCode);
  const totals = preAuthTotals(form);
  const missing = preAuthMissing(form);
  const payload = useMemo(() => buildPreAuthRFA(ticket, form), [ticket, form]);

  const save = async (status: "Draft" | "Ready") => {
    if (status === "Ready" && missing.length) {
      setMsg({ tone: "warn", text: `Still missing: ${missing.join(", ")}.` });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const p = await savePreAuthRequest({ ticketNo: ticket.ticketNo, status: saved?.status === "Sent" ? "Sent" : status, form, managedByName: managedBy || null, byName, isNew: !saved });
      setSaved(p);
      onSaved(p);
      setMsg({ tone: "ok", text: status === "Ready" ? "Saved as Ready — everything ServicePower requires is filled in." : "Draft saved." });
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  // Locked unless the company has sending switched on — and then it still asks first.
  const submit = async () => {
    setMsg(null);
    if (missing.length) {
      setMsg({ tone: "warn", text: `Fill these in first: ${missing.join(", ")}.` });
      return;
    }
    const enabled = await isPreAuthSubmitEnabled(companyId);
    if (!enabled) {
      setMsg({ tone: "warn", text: "Sending to ServicePower is turned off — nothing was sent. Save it as Ready and file it on ServicePower's Call Auth screen for now (a SuperAdmin can turn sending on in Admin → Company Settings)." });
      return;
    }
    if (!window.confirm(`Submit this Pre-Auth to ServicePower?\n\nTicket ${ticket.ticketNo} · ${fmtMoney(totals.total)} requested`)) return;
    setSending(true);
    try {
      const { sendPreAuthRFA } = await import("@/lib/servicePowerApiClient");
      const res = await sendPreAuthRFA(payload);
      if (res.responseCode !== "OK") {
        setMsg({ tone: "err", text: `ServicePower didn't accept it: ${res.messages?.map((m) => m.message).join("; ") || "error"}` });
        return;
      }
      await markPreAuthSent(ticket.ticketNo, res);
      const p = await savePreAuthRequest({ ticketNo: ticket.ticketNo, status: "Sent", form, managedByName: managedBy || null, byName, isNew: !saved });
      setSaved(p);
      onSaved(p);
      setMsg({ tone: "ok", text: "Sent to ServicePower." });
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSending(false);
    }
  };

  const setPart = (i: number, k: keyof PreAuthPart, v: string) => set("parts", form.parts.map((p, j) => (j === i ? { ...p, [k]: v } : p)));

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-6xl max-h-[94vh] flex flex-col rounded-xl border border-white/15 bg-slate-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-3.5 border-b border-white/10">
          <div>
            <h2 className="text-lg font-bold text-white">Pre-Auth · Ticket {ticket.ticketNo}</h2>
            <p className="text-xs text-slate-400">
              {saved ? <>Status <span className="text-slate-200">{saved.status}</span>{saved.updatedByName ? ` · last saved by ${saved.updatedByName}` : ""}</> : "Not saved yet"}
              {sendOn ? <span className="ml-2 text-emerald-300">sending to ServicePower is ON</span> : <span className="ml-2 inline-flex items-center gap-1 text-amber-300"><Lock className="h-3 w-3" /> sending to ServicePower is off</span>}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white p-1" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        <div className="overflow-y-auto px-5 py-4 grid gap-4 lg:grid-cols-[300px_1fr]">
          {/* Request Details — from the ticket */}
          <section className="rounded-lg border border-white/10 bg-white/[0.03] p-4 grid grid-cols-2 gap-3 content-start">
            <h3 className="col-span-2 text-sm font-semibold text-white">Request Details</h3>
            <ReadOnly label="Call Number" value={ticket.ticketNo} />
            <ReadOnly label="Ticket Status" value={ticket.status} />
            <ReadOnly label="First Name" value={ticket.firstName} />
            <ReadOnly label="Last Name" value={ticket.lastName} />
            <div className="col-span-2"><ReadOnly label="Address" value={[ticket.address, ticket.address2].filter(Boolean).join(", ")} /></div>
            <ReadOnly label="City" value={ticket.city} />
            <ReadOnly label="State / Zip" value={[ticket.state, ticket.zip].filter(Boolean).join(" ")} />
            <ReadOnly label="Brand" value={ticket.manufacturer} />
            <ReadOnly label="Claim To" value={ticket.account || ticket.claimCompany} />
            <ReadOnly label="Model Number" value={ticket.model} />
            <ReadOnly label="Serial Number" value={ticket.serial} />
            <ReadOnly label="Purchase Date" value={ticket.purchaseDate} />
            <ReadOnly label="Phone" value={ticket.phone} />
            <div className="col-span-2"><ReadOnly label="Customer Notes" value={ticket.problemDescription || ticket.internalNote} /></div>
            <ReadOnly label="Technician" value={ticket.technician} />
            <ReadOnly label="Scheduled" value={ticket.schedule} />
            <div className="col-span-2 border-t border-white/10 pt-3">
              <label className={labelCls}>Managed by</label>
              <select value={managedBy} onChange={(e) => setManagedBy(e.target.value)} className={inputCls}>
                <option value="">— nobody yet —</option>
                {managerOptions.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <p className="mt-1 text-[10px] text-slate-500">Who is handling this Pre-Auth — saved with Save Draft / Save as Ready.</p>
            </div>
          </section>

          <div className="space-y-4 min-w-0">
            {/* Questions — as on ServicePower's Call Auth screen */}
            <section className="rounded-lg border border-white/10 bg-white/[0.03] p-4 grid gap-3 md:grid-cols-3">
              <div className="md:col-span-3">
                <label className={labelCls}>Repair Description <Req /></label>
                <textarea rows={2} value={form.repairDescription} onChange={(e) => set("repairDescription", e.target.value)} placeholder="e.g. Unit is a wall oven. Requesting additional labor." className={`${inputCls} resize-none`} />
              </div>
              <div className="md:col-span-3">
                <label className={labelCls}>Why does this repair require a rate higher than your negotiated rate?</label>
                <input value={form.whyHigherRate} onChange={(e) => set("whyHigherRate", e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>
                  Job Code <Req />
                  {jobList && <span className="ml-1 normal-case tracking-normal font-semibold text-emerald-400">· {jobList.label} job code</span>}
                </label>
                {jobList ? (
                  <>
                    <select value={form.jobCode} onChange={(e) => set("jobCode", e.target.value)} className={inputCls}>
                      <option value="">— select —</option>
                      {jobList.codes.map((c) => <option key={c.code} value={c.code}>{c.note ? `${c.code} — ${c.note}` : c.code}</option>)}
                      {form.jobCode && !pickedJob && <option value={form.jobCode}>{form.jobCode} (not a {jobList.label} code)</option>}
                    </select>
                    {pickedJob?.note && <p className="mt-1 text-[10px] text-slate-400">{pickedJob.note}</p>}
                  </>
                ) : (
                  <input value={form.jobCode} onChange={(e) => set("jobCode", e.target.value)} className={inputCls} />
                )}
              </div>
              <div>
                <label className={labelCls}>Estimated time on the job (Hrs / Min) <Req /></label>
                <div className="flex gap-2">
                  <input type="number" min="0" value={form.estHours} onChange={(e) => set("estHours", e.target.value)} placeholder="Hrs" className={inputCls} />
                  <input type="number" min="0" max="59" value={form.estMinutes} onChange={(e) => set("estMinutes", e.target.value)} placeholder="Min" className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>New Brand <Req /></label>
                <input value={form.newBrand} onChange={(e) => set("newBrand", e.target.value)} className={inputCls} />
              </div>
              <YesNoField label="Is the product repaired?" required value={form.productRepaired} onChange={(v) => set("productRepaired", v)} />
              <YesNoField label="Are the parts in warranty?" required value={form.partsInWarranty} onChange={(v) => set("partsInWarranty", v)} />
              <YesNoField label="Is the labor in warranty?" required value={form.laborInWarranty} onChange={(v) => set("laborInWarranty", v)} />
              <YesNoField label="Are you OEM authorized with the manufacturer?" value={form.oemAuthorized} onChange={(v) => set("oemAuthorized", v)} />
              <YesNoField label="Will there be an additional man on the job?" required value={form.additionalMan} onChange={(v) => set("additionalMan", v)} />
              <ReadOnly label="Days owned by the consumer" value={(() => { const d = daysSince(ticket.purchaseDate); return d == null ? "" : String(d); })()} />
            </section>

            {/* Amounts */}
            <section className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-3">
              <h3 className="text-sm font-semibold text-white">Requested Amounts</h3>
              <div className="grid gap-3 sm:grid-cols-4">
                <div>
                  <label className={labelCls}>Labor ($)</label>
                  <input type="number" step="0.01" min="0" value={form.labor} onChange={(e) => set("labor", e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}># of miles</label>
                  <input type="number" min="0" value={form.miles} onChange={(e) => set("miles", e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Rate per mile ($)</label>
                  <input type="number" step="0.01" min="0" value={form.ratePerMile} onChange={(e) => set("ratePerMile", e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Travel ($)</label>
                  <input type="number" step="0.01" min="0" value={form.travel} onChange={(e) => set("travel", e.target.value)} className={inputCls} />
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase text-slate-400 border-b border-white/10">
                      <th className="py-1.5 pr-2 w-20">Qty</th>
                      <th className="py-1.5 pr-2">Part #</th>
                      <th className="py-1.5 pr-2">Description</th>
                      <th className="py-1.5 pr-2 w-28">Price ($)</th>
                      <th className="py-1.5 pr-2 w-24 text-right">Ext</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {form.parts.map((p, i) => (
                      <tr key={i} className="border-b border-white/5">
                        <td className="py-1 pr-2"><input type="number" min="0" value={p.quantity} onChange={(e) => setPart(i, "quantity", e.target.value)} className={inputCls} /></td>
                        <td className="py-1 pr-2"><input value={p.partNumber} onChange={(e) => setPart(i, "partNumber", e.target.value)} className={inputCls} /></td>
                        <td className="py-1 pr-2"><input value={p.description} onChange={(e) => setPart(i, "description", e.target.value)} className={inputCls} /></td>
                        <td className="py-1 pr-2"><input type="number" step="0.01" min="0" value={p.price} onChange={(e) => setPart(i, "price", e.target.value)} className={inputCls} /></td>
                        <td className="py-1 pr-2 text-right tabular-nums text-slate-300">{fmtMoney((Number(p.quantity) || 0) * (Number(p.price) || 0))}</td>
                        <td className="py-1 text-right">
                          <button type="button" onClick={() => set("parts", form.parts.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-300 p-1" title="Remove line"><Trash2 className="h-3.5 w-3.5" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button type="button" onClick={() => set("parts", [...form.parts, { quantity: "1", partNumber: "", description: "", price: "" }])} className="mt-2 text-xs text-blue-300 hover:text-blue-200 inline-flex items-center gap-1">
                  <Plus className="h-3.5 w-3.5" /> Add part line
                </button>
                <p className="mt-1 text-[10px] text-slate-500">ServicePower adds its own markup on parts.</p>
              </div>
              <dl className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs border-t border-white/10 pt-3">
                {([["Labor", totals.labor], ["Parts", totals.parts], ["Mileage", totals.mileage], ["Travel", totals.travel], ["Other", totals.other]] as const).map(([k, v]) => (
                  <div key={k}><dt className="text-slate-500">{k}</dt><dd className="tabular-nums text-slate-200">{fmtMoney(v)}</dd></div>
                ))}
                <div><dt className="text-slate-400 font-semibold">TOTAL</dt><dd className="tabular-nums text-emerald-300 font-bold">{fmtMoney(totals.total)}</dd></div>
              </dl>
            </section>

            {showPreview && (
              <section className="rounded-lg border border-white/10 bg-black/30 p-3">
                <p className="text-[11px] text-slate-400 mb-1.5">What ServicePower would receive (login details are added on the server). Nothing has been sent.</p>
                <pre className="text-[11px] text-slate-300 overflow-x-auto max-h-64">{JSON.stringify(payload, null, 2)}</pre>
              </section>
            )}
          </div>
        </div>

        <div className="border-t border-white/10 px-5 py-3 space-y-2">
          {missing.length > 0 && <p className="text-[11px] text-amber-300">Required before it's Ready: {missing.join(" · ")}</p>}
          {msg && <p className={`text-xs ${msg.tone === "ok" ? "text-emerald-300" : msg.tone === "warn" ? "text-amber-300" : "text-red-300"}`}>{msg.text}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void save("Draft")} disabled={saving} className="btn px-4 py-2 text-sm">{saving ? "Saving…" : "Save Draft"}</button>
            <button type="button" onClick={() => void save("Ready")} disabled={saving} className="btn px-4 py-2 text-sm bg-sky-600/80 hover:bg-sky-600 text-white">Save as Ready</button>
            <button type="button" onClick={() => setShowPreview((v) => !v)} className="btn px-4 py-2 text-sm">{showPreview ? "Hide preview" : "Preview what would be sent"}</button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={sending || saved?.status === "Sent"}
              className="ml-auto btn px-4 py-2 text-sm inline-flex items-center gap-1.5 border-amber-400/40 text-amber-200 disabled:opacity-40"
              title={sendOn ? "Sends this Pre-Auth to ServicePower — asks first" : "Locked — sending to ServicePower is turned off (Admin → Company Settings)"}
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : sendOn ? <FileCheck2 className="h-4 w-4" /> : <Lock className="h-4 w-4" />} Submit to ServicePower
            </button>
            <button type="button" onClick={onClose} className="btn px-4 py-2 text-sm">Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
