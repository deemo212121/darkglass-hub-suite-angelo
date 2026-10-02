/**
 * Tech Guides — view and edit the repair guides shown as "Tech Tips" inside
 * tickets (src/lib/techGuides.ts, migration 0328). Everyone who can open
 * the page can read them; editing is limited to Technical Director,
 * Technical Assistant Director, Senior Branch Manager and Admin-and-up
 * (role or extra_roles) — the RLS twin is can_edit_tech_guides().
 *
 * Editing a built-in guide saves a company copy; "Reset to built-in" drops
 * that copy. Added guides can be deleted outright.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ArrowDown, ArrowUp, BookOpen, ChevronLeft, Pencil, Plus, Trash2 } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { normalizeRole } from "@/lib/roleLabels";
import { DEFAULT_TECH_GUIDES, type TechGuide, type TechGuideReading, type TechGuideSection } from "@/lib/techGuides";
import { deleteTechGuide, getTechGuides, saveTechGuide, type TechGuideWithMeta } from "@/lib/supabase/techGuides";

const GUIDE_EDITOR_ROLES = new Set(["ADMIN", "SUPERADMIN", "SUPERSUPERADMIN", "TECHNICAL_DIRECTOR", "TECHNICAL_ASSISTANT_DIRECTOR", "SENIOR_BRANCH_MANAGER"]);

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
const uniqueId = (base: string, taken: string[]) => {
  let id = slug(base);
  let n = 2;
  while (taken.includes(id)) id = `${slug(base)}-${n++}`;
  return id;
};
const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const splitLines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

/** Editor-side shape: list fields as the raw text being typed, parsed on save. */
interface SectionDraft { id: string; title: string; body: string; steps: string; keywords: string }
interface ReadingDraft { id: string; label: string; kind: "text" | "choice"; options: string }
interface GuideDraft { key: string; title: string; productCategories: string; intro: string; sections: SectionDraft[]; readings: ReadingDraft[] }

const toDraft = (g: TechGuide): GuideDraft => ({
  key: g.key,
  title: g.title,
  productCategories: g.productCategories.join(", "),
  intro: g.intro,
  sections: g.sections.map((s) => ({ id: s.id, title: s.title, body: s.body, steps: s.steps.join("\n"), keywords: s.keywords.join(", ") })),
  readings: g.readings.map((r) => ({ id: r.id, label: r.label, kind: r.kind, options: (r.options ?? []).join(", ") })),
});

const fromDraft = (d: GuideDraft): TechGuide => ({
  key: d.key,
  title: d.title.trim(),
  productCategories: splitList(d.productCategories),
  intro: d.intro.trim(),
  sections: d.sections
    .filter((s) => s.title.trim())
    .map<TechGuideSection>((s) => ({ id: s.id, title: s.title.trim(), body: s.body.trim(), steps: splitLines(s.steps), keywords: splitList(s.keywords).map((k) => k.toLowerCase()) })),
  readings: d.readings
    .filter((r) => r.label.trim())
    .map<TechGuideReading>((r) => (r.kind === "choice"
      ? { id: r.id, label: r.label.trim(), kind: "choice", options: splitList(r.options) }
      : { id: r.id, label: r.label.trim(), kind: "text" })),
});

const move = <T,>(arr: T[], i: number, dir: -1 | 1): T[] => {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const next = arr.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

export function TechGuidesPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const { role, extraRoles, displayName, email } = useAuth();
  const canEdit = [role, ...(extraRoles ?? [])].some((r) => GUIDE_EDITOR_ROLES.has(normalizeRole(r)));

  const [guides, setGuides] = useState<TechGuideWithMeta[] | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<GuideDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => setGuides(await getTechGuides());
  useEffect(() => { void load(); }, []);

  const selected = useMemo(() => guides?.find((g) => g.key === selectedKey) ?? guides?.[0] ?? null, [guides, selectedKey]);
  const isBuiltIn = (key: string) => DEFAULT_TECH_GUIDES.some((d) => d.key === key);

  const startEdit = (g: TechGuide) => { setDraft(toDraft(g)); setError(null); };
  const startNew = () => {
    const key = uniqueId("new-guide", (guides ?? []).map((g) => g.key));
    setDraft({ key, title: "", productCategories: "", intro: "", sections: [], readings: [] });
    setError(null);
  };

  const handleSave = async () => {
    if (!draft) return;
    const guide = fromDraft(draft);
    if (!guide.title) { setError("Give the guide a title."); return; }
    if (guide.productCategories.length === 0) { setError("Add at least one Product Category so tickets can match this guide."); return; }
    // A brand-new guide takes its key from the title.
    if (!(guides ?? []).some((g) => g.key === guide.key)) guide.key = uniqueId(guide.title, (guides ?? []).map((g) => g.key));
    setBusy(true);
    setError(null);
    try {
      await saveTechGuide(guide, displayName || email || "");
      await load();
      setSelectedKey(guide.key);
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save guide.");
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async (g: TechGuideWithMeta) => {
    const builtIn = isBuiltIn(g.key);
    if (!window.confirm(builtIn ? `Reset "${g.title}" to the built-in guide? Your edits will be removed.` : `Delete the "${g.title}" guide?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteTechGuide(g.key);
      await load();
      if (!builtIn) setSelectedKey(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  const upd = (patch: Partial<GuideDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const updSection = (i: number, patch: Partial<SectionDraft>) =>
    setDraft((d) => (d ? { ...d, sections: d.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) } : d));
  const updReading = (i: number, patch: Partial<ReadingDraft>) =>
    setDraft((d) => (d ? { ...d, readings: d.readings.map((r, j) => (j === i ? { ...r, ...patch } : r)) } : d));

  const input = "glass-input w-full rounded-md px-2.5 py-1.5 text-sm";
  const label = "block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1";

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-4 sm:px-6 py-8">
        <div className="flex items-center gap-3 mb-2">
          <button type="button" onClick={goBack} className="btn hover:bg-white/15">
            <ChevronLeft className="h-4 w-4" /> {mod.label}
          </button>
        </div>
        <h1 className="text-2xl font-bold mb-1">{sub.title}</h1>
        <p className="text-sm text-muted-foreground mb-6">
          {sub.description} Tickets pick a guide by Product Category, then open the sections whose keywords appear in the symptom.
          {!canEdit && " Only Technical Directors, Technical Assistant Directors, Senior Branch Managers and Admins can edit."}
        </p>
        {error && <p className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

        {!guides ? (
          <p className="text-sm text-muted-foreground">Loading guides…</p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
            <aside className="space-y-1.5">
              {guides.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => { setSelectedKey(g.key); setDraft(null); }}
                  className={`w-full rounded-lg border px-3 py-2 text-left ${selected?.key === g.key ? "border-blue-400/50 bg-blue-500/20" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
                >
                  <div className="font-semibold text-sm">{g.title}</div>
                  <div className="text-[11px] text-slate-400">{g.customized ? `Edited${g.updatedByName ? ` by ${g.updatedByName}` : ""}` : "Built-in"}</div>
                </button>
              ))}
              {canEdit && (
                <button type="button" onClick={startNew} className="w-full rounded-lg border border-dashed border-white/20 px-3 py-2 text-left text-sm text-blue-300 hover:bg-white/5">
                  <Plus className="inline h-4 w-4 mr-1 -mt-0.5" /> New guide
                </button>
              )}
            </aside>

            {draft ? (
              <section className="panel p-4 space-y-5">
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className={label}>Title</label>
                    <input className={input} value={draft.title} onChange={(e) => upd({ title: e.target.value })} placeholder="e.g. Freezer" />
                  </div>
                  <div>
                    <label className={label}>Product Categories (comma-separated)</label>
                    <input className={input} value={draft.productCategories} onChange={(e) => upd({ productCategories: e.target.value })} placeholder="Refrigerator, Food Center" />
                  </div>
                </div>
                <div>
                  <label className={label}>How it works</label>
                  <textarea className={input} rows={5} value={draft.intro} onChange={(e) => upd({ intro: e.target.value })} />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-blue-300">Sections</h3>
                    <button type="button" className="btn text-xs px-2.5 py-1" onClick={() => upd({ sections: [...draft.sections, { id: uniqueId("section", draft.sections.map((s) => s.id)), title: "", body: "", steps: "", keywords: "" }] })}>
                      <Plus className="h-3.5 w-3.5" /> Add section
                    </button>
                  </div>
                  <div className="space-y-3">
                    {draft.sections.map((s, i) => (
                      <div key={s.id} className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2">
                        <div className="flex gap-2">
                          <input className={input} value={s.title} onChange={(e) => updSection(i, { title: e.target.value })} placeholder="Section title" />
                          <button type="button" title="Move up" className="btn px-2" onClick={() => upd({ sections: move(draft.sections, i, -1) })}><ArrowUp className="h-3.5 w-3.5" /></button>
                          <button type="button" title="Move down" className="btn px-2" onClick={() => upd({ sections: move(draft.sections, i, 1) })}><ArrowDown className="h-3.5 w-3.5" /></button>
                          <button type="button" title="Remove" className="btn px-2 hover:text-red-300" onClick={() => upd({ sections: draft.sections.filter((_, j) => j !== i) })}><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                        <textarea className={input} rows={2} value={s.body} onChange={(e) => updSection(i, { body: e.target.value })} placeholder="Explanation (optional)" />
                        <div>
                          <label className={label}>Check steps (one per line)</label>
                          <textarea className={input} rows={4} value={s.steps} onChange={(e) => updSection(i, { steps: e.target.value })} />
                        </div>
                        <div>
                          <label className={label}>Symptom keywords (comma-separated)</label>
                          <input className={input} value={s.keywords} onChange={(e) => updSection(i, { keywords: e.target.value })} placeholder="not cooling, warm, no cool" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-blue-300">Test readings</h3>
                    <button type="button" className="btn text-xs px-2.5 py-1" onClick={() => upd({ readings: [...draft.readings, { id: uniqueId("reading", draft.readings.map((r) => r.id)), label: "", kind: "text", options: "" }] })}>
                      <Plus className="h-3.5 w-3.5" /> Add reading
                    </button>
                  </div>
                  <div className="space-y-2">
                    {draft.readings.map((r, i) => (
                      <div key={r.id} className="flex flex-wrap gap-2 items-center">
                        <input className={`${input} flex-1 min-w-[180px]`} value={r.label} onChange={(e) => updReading(i, { label: e.target.value })} placeholder="e.g. Compressor voltage" />
                        <select className="glass-input rounded-md px-2 py-1.5 text-sm" value={r.kind} onChange={(e) => updReading(i, { kind: e.target.value as ReadingDraft["kind"] })}>
                          <option value="text">Value</option>
                          <option value="choice">Choice</option>
                        </select>
                        {r.kind === "choice" && (
                          <input className={`${input} w-56`} value={r.options} onChange={(e) => updReading(i, { options: e.target.value })} placeholder="Good, Poor, Bad" />
                        )}
                        <button type="button" title="Move up" className="btn px-2" onClick={() => upd({ readings: move(draft.readings, i, -1) })}><ArrowUp className="h-3.5 w-3.5" /></button>
                        <button type="button" title="Move down" className="btn px-2" onClick={() => upd({ readings: move(draft.readings, i, 1) })}><ArrowDown className="h-3.5 w-3.5" /></button>
                        <button type="button" title="Remove" className="btn px-2 hover:text-red-300" onClick={() => upd({ readings: draft.readings.filter((_, j) => j !== i) })}><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2 border-t border-white/10 pt-4">
                  <button type="button" onClick={() => void handleSave()} disabled={busy} className="btn bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
                    {busy ? "Saving…" : "Save guide"}
                  </button>
                  <button type="button" onClick={() => { setDraft(null); setError(null); }} className="btn">Cancel</button>
                </div>
              </section>
            ) : selected ? (
              <section className="panel p-4 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold flex items-center gap-2"><BookOpen className="h-5 w-5 text-blue-300" /> {selected.title}</h2>
                    <p className="text-xs text-slate-400 mt-1">
                      Shown on tickets with Product Category: {selected.productCategories.join(", ") || "—"}
                    </p>
                    {selected.customized && selected.updatedAt && (
                      <p className="text-xs text-slate-500">Last edited{selected.updatedByName ? ` by ${selected.updatedByName}` : ""} · {new Date(selected.updatedAt).toLocaleString()}</p>
                    )}
                  </div>
                  {canEdit && (
                    <div className="flex gap-2">
                      <button type="button" onClick={() => startEdit(selected)} className="btn text-xs"><Pencil className="h-3.5 w-3.5" /> Edit</button>
                      {selected.customized && (
                        <button type="button" onClick={() => void handleReset(selected)} disabled={busy} className="btn text-xs disabled:opacity-50">
                          {isBuiltIn(selected.key) ? "Reset to built-in" : <><Trash2 className="h-3.5 w-3.5" /> Delete</>}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {selected.intro && <p className="whitespace-pre-line text-sm text-slate-300 leading-relaxed">{selected.intro}</p>}
                {selected.sections.map((s) => (
                  <div key={s.id} className="rounded-lg border border-white/10 bg-white/5 p-3">
                    <h3 className="font-semibold text-slate-100">{s.title}</h3>
                    {s.body && <p className="mt-1 whitespace-pre-line text-sm text-slate-300">{s.body}</p>}
                    <ul className="mt-2 list-disc pl-5 space-y-1 text-sm text-slate-200">
                      {s.steps.map((st) => <li key={st}>{st}</li>)}
                    </ul>
                    {s.keywords.length > 0 && (
                      <p className="mt-2 text-[11px] text-slate-500">Opens first when the symptom mentions: {s.keywords.join(", ")}</p>
                    )}
                  </div>
                ))}
                {selected.readings.length > 0 && (
                  <div>
                    <h3 className="font-semibold text-blue-300 mb-2">Test readings (recorded per visit)</h3>
                    <ul className="grid gap-1 sm:grid-cols-2 text-sm text-slate-200">
                      {selected.readings.map((r) => (
                        <li key={r.id}>• {r.label}{r.kind === "choice" && r.options?.length ? <span className="text-slate-500"> ({r.options.join(" / ")})</span> : null}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
