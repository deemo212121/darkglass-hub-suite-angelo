/**
 * HR Paperworks → Form Inconsistencies — each person's signed forms
 * cross-checked against each other (name, SSN, date of birth, address,
 * phone, email, driver's license #; see src/lib/formConsistency.ts), listing
 * where they disagree. HR / Admin / Super Admin only (ReportHRDaily.tsx).
 * Completed papers stay as private as on the rest of HR Paperworks
 * (completedPapers.ts): someone who can't open a paper sees which forms
 * disagree, but not the values or a link.
 *
 * A difference that's fine (the person moved) can be marked as checked
 * (form_consistency_reviews, migration 0425); it stays hidden until a new,
 * different value shows up. HR also gets a bell notification when someone
 * signs a form that disagrees with all of their other forms
 * (formConsistencyReviews.ts's notifyHrOfNewInconsistencies).
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, RefreshCw, Search, ShieldAlert, Undo2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Switch } from "@/components/ui/switch";
import { getSignableDocumentsByTypes, type SignableDocument } from "@/lib/supabase/signableDocuments";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getFormConsistencyReviews, markInconsistencyChecked, undoInconsistencyChecked, type FormConsistencyReview } from "@/lib/supabase/formConsistencyReviews";
import {
  CONSISTENCY_FIELDS,
  CONSISTENCY_FIELD_LABEL,
  CONSISTENCY_FORM_TYPES,
  documentOwner,
  findInconsistencies,
  type ConsistencyField,
  type Inconsistency,
} from "@/lib/formConsistency";
import { ROLE_LABELS, normalizeRole } from "@/lib/roleLabels";
import { isCompletedPaper } from "@/lib/completedPapers";

const shortDate = (iso: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");
const reviewKey = (profileId: string, field: string, valuesKey: string) => `${profileId}|${field}|${valuesKey}`;

interface Item {
  inc: Inconsistency;
  review: FormConsistencyReview | undefined;
}

interface Person {
  profileId: string;
  name: string;
  roleLabel: string;
  branch: string;
  active: boolean;
  items: Item[];
}

/** `canViewCompleted`: HR Paperworks' own completedPapers.ts check for this viewer. */
export function FormInconsistenciesPanel({ canViewCompleted }: { canViewCompleted: boolean }) {
  const { displayName } = useAuth();
  const canOpen = (f: { documentType: SignableDocument["documentType"]; status: SignableDocument["status"] }) => canViewCompleted || !isCompletedPaper(f);
  const [docs, setDocs] = useState<SignableDocument[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  // null = migration 0425 not run yet (nothing can be marked as checked).
  const [reviews, setReviews] = useState<FormConsistencyReview[] | null>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [field, setField] = useState<"" | ConsistencyField>("");
  const [showChecked, setShowChecked] = useState(false);
  const [activeOnly, setActiveOnly] = useState(true);
  // The difference whose "Mark as checked" note box is open, and its note.
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, p, r] = await Promise.all([getSignableDocumentsByTypes(CONSISTENCY_FORM_TYPES), getCompanyUsers(), getFormConsistencyReviews()]);
      setDocs(d);
      setProfiles(p);
      setReviews(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const people = useMemo<Person[]>(() => {
    const profileById = new Map(profiles.map((p) => [p.id, p]));
    const reviewByKey = new Map((reviews ?? []).map((r) => [reviewKey(r.profileId, r.field, r.valuesKey), r]));
    // The name typed on their forms, for anyone without a profile any more.
    const nameOnForms = new Map<string, string>();
    for (const d of docs) {
      const owner = documentOwner(d);
      if (owner && !nameOnForms.has(owner) && d.formData?.employeeName) nameOnForms.set(owner, String(d.formData.employeeName));
    }
    return [...findInconsistencies(docs)].map(([profileId, list]) => {
      const p = profileById.get(profileId);
      return {
        profileId,
        name: p?.display_name || p?.username || nameOnForms.get(profileId) || "Unknown person",
        roleLabel: p ? ROLE_LABELS[normalizeRole(p.role)] ?? p.role : "",
        branch: p?.assigned_branch || "",
        active: !!p?.is_active,
        items: list.map((inc) => ({ inc, review: reviewByKey.get(reviewKey(profileId, inc.field, inc.valuesKey)) })),
      };
    });
  }, [docs, profiles, reviews]);

  const scoped = useMemo(() => people.filter((p) => !activeOnly || p.active), [people, activeOnly]);

  /** Open (not checked) differences per field, for the chips. */
  const openByField = useMemo(() => {
    const counts = new Map<ConsistencyField, number>();
    for (const p of scoped) for (const it of p.items) if (!it.review) counts.set(it.inc.field, (counts.get(it.inc.field) ?? 0) + 1);
    return counts;
  }, [scoped]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped
      .map((p) => ({ ...p, items: p.items.filter((it) => (!field || it.inc.field === field) && (showChecked || !it.review)) }))
      .filter((p) => p.items.length > 0 && (!q || p.name.toLowerCase().includes(q) || p.branch.toLowerCase().includes(q)))
      .sort((a, b) => {
        const latest = (p: Person) => p.items.reduce((m, it) => (it.inc.latestAt > m ? it.inc.latestAt : m), "");
        return latest(b).localeCompare(latest(a));
      });
  }, [scoped, field, showChecked, search]);

  const openPeople = scoped.filter((p) => p.items.some((it) => !it.review)).length;

  const handleCheck = async (person: Person, inc: Inconsistency) => {
    const key = reviewKey(person.profileId, inc.field, inc.valuesKey);
    setBusy(key);
    try {
      const saved = await markInconsistencyChecked({ profileId: person.profileId, field: inc.field, valuesKey: inc.valuesKey, note, reviewedByName: displayName });
      setReviews((prev) => [saved, ...(prev ?? [])]);
      setNoteFor(null);
      setNote("");
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleUndo = async (review: FormConsistencyReview) => {
    setBusy(review.id);
    try {
      await undoInconsistencyChecked(review.id);
      setReviews((prev) => (prev ?? []).filter((r) => r.id !== review.id));
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-[18rem] flex-1">
          <h2 className="flex items-center gap-2 text-lg font-bold text-white">
            <ShieldAlert className="h-5 w-5 shrink-0 text-amber-300" /> Form Inconsistencies
          </h2>
          <p className="text-sm text-slate-400">
            Each person's signed forms checked against each other — name, SSN, date of birth, address, phone, email and driver's license #.
            Only the latest signed copy of each form counts, and formatting ("Street" / "St", a missing middle initial) isn't a difference.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-300">
          {loading ? "Checking…" : `${openPeople} ${openPeople === 1 ? "person" : "people"} to check`}
        </span>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {reviews === null && !loading && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Marking a difference as checked needs migration 0425 (Supabase SQL Editor). The list below works without it.
        </div>
      )}
      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Search</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or branch…"
              className="glass-input w-56 rounded-md py-1.5 pl-8 pr-3 text-sm"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setField("")}
            className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold ${field === "" ? "border-primary/50 bg-primary/10 text-foreground" : "border-white/10 text-muted-foreground hover:bg-white/5 hover:text-foreground"}`}
          >
            All
          </button>
          {CONSISTENCY_FIELDS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setField(field === f ? "" : f)}
              className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold ${field === f ? "border-primary/50 bg-primary/10 text-foreground" : "border-white/10 text-muted-foreground hover:bg-white/5 hover:text-foreground"}`}
            >
              {CONSISTENCY_FIELD_LABEL[f]} <span className="ml-0.5 text-[10px] text-slate-500">({openByField.get(f) ?? 0})</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-muted-foreground">
            Active staff only <Switch checked={activeOnly} onCheckedChange={setActiveOnly} />
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-muted-foreground">
            Show checked <Switch checked={showChecked} onCheckedChange={setShowChecked} />
          </label>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-slate-900/40 px-6 py-16 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking every signed form…
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-slate-900/40 px-6 py-16 text-center text-sm text-slate-400">
          <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-emerald-400" />
          {search || field ? "Nothing matches these filters." : "No differences to check — everyone's forms agree."}
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((person) => (
            <div key={person.profileId} className="rounded-xl border border-white/10 bg-slate-900/40">
              <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-2.5">
                <span className="font-semibold text-white">{person.name}</span>
                {person.roleLabel && <span className="text-xs text-slate-400">{person.roleLabel}</span>}
                {person.branch && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">{person.branch}</span>}
                {!person.active && <span className="rounded bg-slate-500/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">Inactive</span>}
                <span className="ml-auto text-xs text-slate-500">{person.items.length} {person.items.length === 1 ? "difference" : "differences"}</span>
              </div>
              <div className="divide-y divide-white/5">
                {person.items.map(({ inc, review }) => {
                  const key = reviewKey(person.profileId, inc.field, inc.valuesKey);
                  return (
                    <div key={key} className={`flex flex-col gap-3 px-4 py-3 lg:flex-row ${review ? "opacity-60" : ""}`}>
                      <div className="w-44 shrink-0">
                        <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-200">{CONSISTENCY_FIELD_LABEL[inc.field]}</span>
                        {inc.hint && <p className="mt-1 text-[11px] leading-4 text-amber-200/70">{inc.hint}</p>}
                      </div>
                      <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {inc.groups.map((g, i) => (
                          <div key={i} className="min-w-0 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                            {g.forms.some(canOpen) ? (
                              <p className={`break-words text-sm text-white ${inc.field === "ssn" || inc.field === "phone" || inc.field === "license" ? "font-mono" : ""}`}>{g.display}</p>
                            ) : (
                              <p className="text-xs italic text-slate-500" title="Completed papers can only be opened by the people allowed to view them">Hidden — only completed-paper viewers can see it</p>
                            )}
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {g.forms.map((f) =>
                                f.pdfUrl && canOpen(f) ? (
                                  <a
                                    key={f.docId}
                                    href={f.pdfUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    title={`Open the signed ${f.label}`}
                                    className="inline-flex items-center gap-1 rounded border border-sky-400/30 bg-sky-500/10 px-1.5 py-0.5 text-[11px] text-sky-200 hover:bg-sky-500/20"
                                  >
                                    {f.label} · {shortDate(f.signedAt)} <ExternalLink className="h-3 w-3" />
                                  </a>
                                ) : (
                                  <span key={f.docId} className="rounded border border-white/10 px-1.5 py-0.5 text-[11px] text-slate-400">
                                    {f.label} · {shortDate(f.signedAt)}
                                  </span>
                                ),
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="w-full shrink-0 lg:w-56">
                        {review ? (
                          <div className="text-xs text-slate-400">
                            <p className="flex items-center gap-1 text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> Checked</p>
                            <p className="mt-0.5">{review.reviewedByName || "HR"} · {shortDate(review.createdAt)}</p>
                            {review.note && <p className="mt-0.5 italic text-slate-300">"{review.note}"</p>}
                            <button
                              type="button"
                              disabled={busy === review.id}
                              onClick={() => void handleUndo(review)}
                              className="mt-1.5 inline-flex items-center gap-1 rounded border border-white/15 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10 disabled:opacity-50"
                            >
                              <Undo2 className="h-3 w-3" /> Undo
                            </button>
                          </div>
                        ) : noteFor === key ? (
                          <div className="space-y-1.5">
                            <input
                              type="text"
                              autoFocus
                              value={note}
                              onChange={(e) => setNote(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") void handleCheck(person, inc); if (e.key === "Escape") setNoteFor(null); }}
                              placeholder="Note (optional) — e.g. moved in June"
                              className="glass-input w-full rounded-md px-2 py-1 text-xs"
                            />
                            <div className="flex gap-1.5">
                              <button
                                type="button"
                                disabled={busy === key}
                                onClick={() => void handleCheck(person, inc)}
                                className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                              >
                                {busy === key ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} Mark as checked
                              </button>
                              <button type="button" onClick={() => setNoteFor(null)} className="rounded border border-white/15 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10">
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={reviews === null}
                            title={reviews === null ? "Needs migration 0425" : "Hide this difference — it shows again if a new, different value is signed"}
                            onClick={() => { setNoteFor(key); setNote(""); }}
                            className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-40"
                          >
                            <CheckCircle2 className="h-3 w-3" /> Mark as checked
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
