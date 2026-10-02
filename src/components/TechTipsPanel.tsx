/**
 * "Tech Tips" inside a ticket — the repair guide for the ticket's Product
 * Category (see src/lib/techGuides.ts), with the sections matching the
 * symptom text opened first, plus the guide's test-checklist readings the
 * tech records per visit (migration 0328).
 *
 * Used by the mobile tech app's "Tech Tips" tab (editable — the tech fills
 * readings in on the job) and the desktop ticket's Tracking tab (read-only
 * by default, so the office sees what was checked and measured).
 */
import { useEffect, useMemo, useState } from "react";
import { BookOpen, CheckCircle2, ChevronDown, Circle, Loader2 } from "lucide-react";
import { guidesForProduct, sectionsMatchingSymptom, stepKey } from "@/lib/techGuides";
import {
  getTechGuides,
  getTicketGuideReadings,
  saveTicketGuideReadings,
  type GuideReadings,
  type TechGuideWithMeta,
} from "@/lib/supabase/techGuides";

export interface TechTipsVisit {
  id: string;
  label: string;
}

export function TechTipsPanel({
  ticketId,
  productType,
  model,
  symptom,
  visits,
  editable,
  authorName,
}: {
  /** tickets.id (uuid) — readings are saved against it. */
  ticketId: string | null;
  productType: string;
  model?: string;
  /** The latest visit's customer symptom — picks which sections open first. */
  symptom: string;
  /** Newest first; readings are recorded per visit. */
  visits: TechTipsVisit[];
  editable: boolean;
  authorName: string;
}) {
  const [guides, setGuides] = useState<TechGuideWithMeta[] | null>(null);
  const [readings, setReadings] = useState<GuideReadings[]>([]);
  const [guideKey, setGuideKey] = useState<string | null>(null);
  const [visitId, setVisitId] = useState<string | null>(visits[0]?.id ?? null);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const [introOpen, setIntroOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTechGuides().then((g) => { if (!cancelled) setGuides(g); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ticketId) return;
    let cancelled = false;
    getTicketGuideReadings(ticketId).then((r) => { if (!cancelled) setReadings(r); });
    return () => { cancelled = true; };
  }, [ticketId]);

  // Keep the selected visit valid as visits load/change (default: newest).
  useEffect(() => {
    if (!visitId || !visits.some((v) => v.id === visitId)) setVisitId(visits[0]?.id ?? null);
  }, [visits, visitId]);

  const matched = useMemo(() => (guides ? guidesForProduct(guides, productType, model) : []), [guides, productType, model]);
  const guide = matched.find((g) => g.key === guideKey) ?? matched[0] ?? null;
  const symptomSections = useMemo(() => (guide ? sectionsMatchingSymptom(guide, symptom) : []), [guide, symptom]);

  // Open the symptom-matching sections whenever the guide changes.
  useEffect(() => {
    setOpenSections(new Set(symptomSections));
  }, [guide?.key, symptomSections.join("|")]);

  const saved = guide && visitId ? readings.find((r) => r.visitId === visitId && r.guideKey === guide.key) ?? null : null;

  // Reset the draft to what's saved whenever the visit/guide/saved row changes.
  useEffect(() => {
    setDraft(saved?.values ?? {});
    setDirty(false);
    setSaveMsg(null);
  }, [guide?.key, visitId, saved?.updatedAt]);

  if (guides === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400 py-3">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading tech tips…
      </div>
    );
  }

  if (!guide) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-slate-400">
        <BookOpen className="inline h-4 w-4 mr-1.5 -mt-0.5" />
        No repair guide for {productType ? `"${productType}"` : "this product"} yet. Guides are managed in Branch/Technician → Tech Guides.
      </div>
    );
  }

  const canRecord = editable && !!ticketId && !!visitId;
  const setValue = (key: string, value: string | boolean) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
    setSaveMsg(null);
  };
  const toggleSection = (id: string) =>
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const handleSave = async () => {
    if (!ticketId || !visitId) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await saveTicketGuideReadings(ticketId, visitId, guide.key, draft, authorName);
      setReadings(await getTicketGuideReadings(ticketId));
      setDirty(false);
      setSaveMsg("Saved");
    } catch (err) {
      setSaveMsg(err instanceof Error ? `Couldn't save: ${err.message}` : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const recordedCount = guide.readings.filter((r) => String(draft[r.id] ?? "").trim() !== "").length;

  return (
    <div className="space-y-3 text-sm text-slate-200">
      {matched.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {matched.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => setGuideKey(g.key)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                g.key === guide.key ? "border-blue-400/50 bg-blue-500/25 text-white" : "border-white/10 bg-white/5 text-slate-300"
              }`}
            >
              {g.title}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-start gap-2">
        <BookOpen className="h-4 w-4 mt-0.5 shrink-0 text-blue-300" />
        <div className="min-w-0">
          <div className="font-semibold text-white">{guide.title} repair guide</div>
          <div className="text-xs text-slate-400">
            {symptom ? <>Symptom: <span className="text-slate-300">{symptom}</span></> : "No symptom on the ticket"}
            {symptom && symptomSections.length === 0 && " — no section matched, browse below"}
          </div>
        </div>
      </div>

      {guide.intro && (
        <div className="rounded-lg border border-white/10 bg-white/5">
          <button type="button" onClick={() => setIntroOpen((o) => !o)} className="flex w-full items-center justify-between px-3 py-2 text-left">
            <span className="font-medium text-slate-200">How it works</span>
            <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${introOpen ? "rotate-180" : ""}`} />
          </button>
          {introOpen && <p className="whitespace-pre-line px-3 pb-3 text-xs leading-relaxed text-slate-300">{guide.intro}</p>}
        </div>
      )}

      {guide.sections.map((sec) => {
        const open = openSections.has(sec.id);
        const isMatch = symptomSections.includes(sec.id);
        const ticked = sec.steps.filter((s) => draft[stepKey(sec.id, s)] === true).length;
        return (
          <div key={sec.id} className={`rounded-lg border ${isMatch ? "border-amber-400/40 bg-amber-500/5" : "border-white/10 bg-white/5"}`}>
            <button type="button" onClick={() => toggleSection(sec.id)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left">
              <span className="flex min-w-0 items-center gap-2">
                <span className="font-medium text-slate-100">{sec.title}</span>
                {isMatch && <span className="shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-200">Matches symptom</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2 text-[11px] text-slate-400">
                {sec.steps.length > 0 && `${ticked}/${sec.steps.length}`}
                <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
              </span>
            </button>
            {open && (
              <div className="space-y-2 px-3 pb-3">
                {sec.body && <p className="whitespace-pre-line text-xs leading-relaxed text-slate-300">{sec.body}</p>}
                <ul className="space-y-1.5">
                  {sec.steps.map((step) => {
                    const k = stepKey(sec.id, step);
                    const done = draft[k] === true;
                    return (
                      <li key={step}>
                        {canRecord ? (
                          <label className="flex items-start gap-2 text-xs">
                            <input type="checkbox" className="mt-0.5" checked={done} onChange={(e) => setValue(k, e.target.checked)} />
                            <span className={done ? "text-slate-400 line-through" : "text-slate-200"}>{step}</span>
                          </label>
                        ) : (
                          <div className="flex items-start gap-2 text-xs">
                            {done ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-green-400" /> : <Circle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-slate-500" />}
                            <span className="text-slate-200">{step}</span>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        );
      })}

      {guide.readings.length > 0 && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold text-blue-200">
              Test readings <span className="text-xs font-normal text-slate-400">({recordedCount}/{guide.readings.length} recorded)</span>
            </div>
            {visits.length > 0 && (
              <select
                value={visitId ?? ""}
                onChange={(e) => setVisitId(e.target.value)}
                disabled={dirty}
                title={dirty ? "Save or discard changes first" : "Readings are recorded per visit"}
                className="rounded-md border border-white/15 bg-slate-950/90 px-2 py-1 text-xs text-white disabled:opacity-50"
              >
                {visits.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            )}
          </div>
          {visits.length === 0 ? (
            <p className="text-xs text-slate-400">Readings are saved to a visit — this ticket has no visits yet.</p>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                {guide.readings.map((r) => {
                  const value = String(draft[r.id] ?? "");
                  return (
                    <div key={r.id} className="text-xs">
                      <div className="mb-1 text-slate-400">{r.label}</div>
                      {!canRecord ? (
                        <div className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-slate-100 min-h-[30px]">{value || "—"}</div>
                      ) : r.kind === "choice" ? (
                        <div className="flex flex-wrap gap-1">
                          {(r.options ?? []).map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => setValue(r.id, value === opt ? "" : opt)}
                              className={`rounded-md border px-2.5 py-1.5 ${
                                value === opt ? "border-blue-400/60 bg-blue-500/30 text-white" : "border-white/15 bg-white/5 text-slate-300"
                              }`}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <input
                          value={value}
                          onChange={(e) => setValue(r.id, e.target.value)}
                          className="w-full rounded-md border border-white/15 bg-slate-950/90 px-2 py-1.5 text-white focus:border-blue-500 focus:outline-none"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                {canRecord && (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleSave()}
                      disabled={!dirty || saving}
                      className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {saving ? "Saving…" : "Save readings"}
                    </button>
                    {dirty && (
                      <button type="button" onClick={() => { setDraft(saved?.values ?? {}); setDirty(false); }} className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-slate-300">
                        Discard
                      </button>
                    )}
                  </>
                )}
                {saveMsg && <span className={saveMsg === "Saved" ? "text-green-400" : "text-red-300"}>{saveMsg}</span>}
                {saved?.updatedAt && (
                  <span>
                    Last saved{saved.updatedByName ? ` by ${saved.updatedByName}` : ""} · {new Date(saved.updatedAt).toLocaleString()}
                  </span>
                )}
                {!saved && !canRecord && <span>Nothing recorded for this visit yet.</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
