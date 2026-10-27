/**
 * Admin → Errors & Improvements: the running list of what needs doing —
 * errors to fix, improvements, to-dos. Every item shows who added it and
 * when, and has its own Confirm button (records who confirmed it and when;
 * Undo reopens it). Add / edit / delete in place; filter by Open / Confirmed
 * and by kind; search. "Download for Google Docs" saves it as a .docx that
 * opens in Google Docs or Word.
 *
 * Stored in admin_errors_improvements (migration 0409) — Admin / SuperAdmin
 * only, same as the Admin module gate.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Check, ChevronLeft, Download, Loader2, Pencil, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import { useSmartBack } from "@/hooks/useSmartBack";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import {
  addErrorImprovement,
  deleteErrorImprovement,
  listErrorsImprovements,
  setErrorImprovementConfirmed,
  updateErrorImprovement,
  type ErrorImprovementItem,
  type ErrorImprovementKind,
} from "@/lib/supabase/errorsImprovements";
import { todayISO } from "@/lib/localDate";

const KINDS: { id: ErrorImprovementKind; label: string; badge: string }[] = [
  { id: "error", label: "Error", badge: "border-red-500/40 bg-red-500/15 text-red-300" },
  { id: "improvement", label: "Improvement", badge: "border-sky-500/40 bg-sky-500/15 text-sky-300" },
  { id: "todo", label: "To do", badge: "border-amber-500/40 bg-amber-500/15 text-amber-300" },
];
const kindMeta = (k: ErrorImprovementKind) => KINDS.find((x) => x.id === k) ?? KINDS[0];

const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

interface Draft {
  kind: ErrorImprovementKind;
  area: string;
  title: string;
  details: string;
}
const EMPTY_DRAFT: Draft = { kind: "error", area: "", title: "", details: "" };

function ItemForm({ initial, saving, onSave, onCancel }: { initial: Draft; saving: boolean; onSave: (d: Draft) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<Draft>(initial);
  const input = "w-full rounded-md border border-white/15 bg-slate-900/60 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500";
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Type</label>
          <div className="flex gap-1.5">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => setDraft({ ...draft, kind: k.id })}
                className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold ${draft.kind === k.id ? k.badge : "border-white/10 text-slate-400 hover:bg-white/5"}`}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Area / page</label>
          <input value={draft.area} onChange={(e) => setDraft({ ...draft, area: e.target.value })} placeholder="e.g. HR → Training List" className={input} />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">What needs doing</label>
        <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Short summary" className={input} />
      </div>
      <div>
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Details</label>
        <textarea value={draft.details} onChange={(e) => setDraft({ ...draft, details: e.target.value })} rows={3} placeholder="Steps, examples, ticket numbers…" className={`${input} resize-y`} />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn text-sm px-3 py-1.5">Cancel</button>
        <button
          type="button"
          disabled={saving || !draft.title.trim()}
          onClick={() => onSave(draft)}
          className="btn text-sm px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 flex items-center gap-1.5"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
        </button>
      </div>
    </div>
  );
}

export function ErrorsImprovementsPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const { uid, companyId, displayName } = useAuth();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [items, setItems] = useState<ErrorImprovementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusTab, setStatusTab] = useState<"open" | "confirmed" | "all">("open");
  const [kindFilter, setKindFilter] = useState<ErrorImprovementKind | "">("");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (uid) void getMyProfileId(uid).then(setProfileId);
  }, [uid]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listErrorsImprovements());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the list.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const me = { profileId, name: displayName || "Admin" };
  const run = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that.");
    } finally {
      setBusyId(null);
    }
  };
  const replace = (next: ErrorImprovementItem) => setItems((cur) => cur.map((i) => (i.id === next.id ? next : i)));

  const counts = useMemo(
    () => ({ open: items.filter((i) => !i.confirmedAt).length, confirmed: items.filter((i) => i.confirmedAt).length, all: items.length }),
    [items],
  );
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter((i) => (statusTab === "all" ? true : statusTab === "open" ? !i.confirmedAt : !!i.confirmedAt))
      .filter((i) => !kindFilter || i.kind === kindFilter)
      .filter((i) => !q || [i.title, i.details, i.area, i.addedByName, i.confirmedByName ?? ""].some((t) => t.toLowerCase().includes(q)))
      .sort((a, b) => Number(!!a.confirmedAt) - Number(!!b.confirmedAt) || a.createdAt.localeCompare(b.createdAt));
  }, [items, statusTab, kindFilter, search]);

  const download = async () => {
    setDownloading(true);
    try {
      const { buildErrorsImprovementsDocx } = await import("@/lib/errorsImprovementsDocx");
      const blob = await buildErrorsImprovementsDocx(items);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Errors and Improvements ${todayISO()}.docx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't build the document.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1200px] mx-auto w-full px-4 sm:px-6 py-8">
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <button type="button" onClick={goBack} className="btn hover:bg-white/15" aria-label="Back"><ChevronLeft className="h-4 w-4" /></button>
          <div className="flex-1 min-w-[14rem]">
            <h1 className="text-2xl font-bold">{sub.title}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              What needs doing — errors, improvements and to-dos. Each shows who added it; Confirm it once it's done.
            </p>
          </div>
          <button type="button" onClick={() => void download()} disabled={downloading || items.length === 0} className="btn text-sm px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50" title="Saves a .docx — upload it to Google Drive and open with Google Docs, or open in Word">
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download for Google Docs
          </button>
          {!adding && (
            <button type="button" onClick={() => { setAdding(true); setEditingId(null); }} className="btn text-sm px-3 py-1.5 flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white">
              <Plus className="h-4 w-4" /> Add item
            </button>
          )}
        </div>

        {error && <p className="mt-4 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">{error}</p>}

        {adding && (
          <div className="panel mt-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">New item</h2>
              <button type="button" onClick={() => setAdding(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
            <ItemForm
              initial={EMPTY_DRAFT}
              saving={busyId === "new"}
              onCancel={() => setAdding(false)}
              onSave={(d) =>
                void run("new", async () => {
                  if (!companyId) throw new Error("No company on this account.");
                  const created = await addErrorImprovement(d, { companyId, ...me });
                  setItems((cur) => [...cur, created]);
                  setAdding(false);
                  setStatusTab((t) => (t === "confirmed" ? "open" : t));
                })
              }
            />
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-white/10 bg-slate-800/40 p-0.5">
            {([
              ["open", "Open", "text-amber-300"],
              ["confirmed", "Confirmed", "text-green-300"],
              ["all", "All", "text-white"],
            ] as const).map(([key, label, tone]) => (
              <button
                key={key}
                type="button"
                onClick={() => setStatusTab(key)}
                className={`px-3 py-1 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 ${statusTab === key ? `bg-white/10 ${tone}` : "text-slate-400 hover:text-white"}`}
              >
                {label} <span className="rounded-full bg-black/25 px-1.5 text-[10px] tabular-nums">{counts[key]}</span>
              </button>
            ))}
          </div>
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as ErrorImprovementKind | "")}
            className="rounded-lg border border-white/15 bg-slate-900/60 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">All types</option>
            {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}s</option>)}
          </select>
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="w-56 rounded-lg border border-white/15 bg-slate-900/60 py-1.5 pl-8 pr-2.5 text-xs text-white focus:outline-none focus:border-blue-500" />
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {loading ? (
            <div className="panel flex items-center justify-center gap-2 py-10 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : visible.length === 0 ? (
            <div className="panel py-10 text-center text-sm text-slate-400">
              {items.length === 0 ? "Nothing on the list yet — use Add item." : statusTab === "open" ? "Nothing open — everything here is confirmed." : "Nothing matches."}
            </div>
          ) : (
            visible.map((item) => {
              const meta = kindMeta(item.kind);
              const busy = busyId === item.id;
              if (editingId === item.id) {
                return (
                  <div key={item.id} className="panel">
                    <ItemForm
                      initial={{ kind: item.kind, area: item.area, title: item.title, details: item.details }}
                      saving={busy}
                      onCancel={() => setEditingId(null)}
                      onSave={(d) => void run(item.id, async () => { replace(await updateErrorImprovement(item.id, d)); setEditingId(null); })}
                    />
                  </div>
                );
              }
              return (
                <div key={item.id} className={`panel flex flex-col gap-3 sm:flex-row sm:items-start ${item.confirmedAt ? "opacity-75" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${meta.badge}`}>{meta.label}</span>
                      {item.area && <span className="text-[11px] text-slate-400">{item.area}</span>}
                    </div>
                    <div className={`mt-1 text-sm font-semibold text-white ${item.confirmedAt ? "line-through decoration-white/30" : ""}`}>{item.title}</div>
                    {item.details && <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-slate-300">{item.details}</p>}
                    <div className="mt-2 text-[11px] text-slate-500">
                      Added by <span className="text-slate-300">{item.addedByName || "—"}</span> · {fmtWhen(item.createdAt)}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-stretch gap-1.5 sm:w-52">
                    {item.confirmedAt ? (
                      <>
                        <div className="rounded-md border border-green-500/30 bg-green-500/10 px-2.5 py-1.5 text-[11px] text-green-300">
                          <div className="flex items-center gap-1 font-semibold"><Check className="h-3.5 w-3.5" /> Confirmed</div>
                          <div className="text-green-200/80">{item.confirmedByName || "—"} · {fmtWhen(item.confirmedAt)}</div>
                        </div>
                        <button type="button" disabled={busy} onClick={() => void run(item.id, async () => replace(await setErrorImprovementConfirmed(item.id, null)))} className="btn text-xs px-2.5 py-1 flex items-center justify-center gap-1 disabled:opacity-50">
                          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />} Undo
                        </button>
                      </>
                    ) : (
                      <button type="button" disabled={busy} onClick={() => void run(item.id, async () => replace(await setErrorImprovementConfirmed(item.id, me)))} className="btn text-sm px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white flex items-center justify-center gap-1.5 disabled:opacity-50">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Confirm
                      </button>
                    )}
                    <div className="flex justify-end gap-1">
                      <button type="button" title="Edit" onClick={() => { setEditingId(item.id); setAdding(false); }} className="btn p-1.5"><Pencil className="h-3.5 w-3.5" /></button>
                      <button
                        type="button"
                        title="Delete"
                        disabled={busy}
                        onClick={() => {
                          if (!window.confirm(`Delete "${item.title}"? This can't be undone.`)) return;
                          void run(item.id, async () => { await deleteErrorImprovement(item.id); setItems((cur) => cur.filter((i) => i.id !== item.id)); });
                        }}
                        className="btn p-1.5 text-red-300 hover:text-red-200 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </main>
    </div>
  );
}
