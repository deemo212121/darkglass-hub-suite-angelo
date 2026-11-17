/**
 * Admin → Terms & Conditions (migration 0455).
 *
 * Each set of terms has a DRAFT — saved as often as needed, seen by nobody —
 * and a Publish button that makes the draft live as the next version. Each
 * set says who it's for: Everyone, or any mix of roles / departments /
 * branches. Before publishing, it shows exactly who it will reach.
 *
 *   Draft         title, who sees it, the text (Preview shows the accept window)
 *   Who accepted  everyone it's for: accepted (which version, when) or not yet — CSV
 *   History       every published version and its text
 *
 * Admin / Super Admin write and publish; HR can look (read only). The accept
 * window itself is TermsGate.tsx.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import DOMPurify from "dompurify";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowDownToLine, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock, Download, Eye, FileInput, FileText, Loader2, Pause, Play, Plus, Rocket, Save, Search, Trash2, Users, X,
} from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { useSmartBack } from "@/hooks/useSmartBack";
import { AppModal } from "@/components/ui-kit/AppModal";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { TERMS_DOC_CLASS, TERMS_DOC_PANEL, TermsDocStyleTag } from "@/components/TermsDocStyle";
import { AHS_STANDARD_TERMS } from "@/lib/termsTemplates";
import { markTermsChanges } from "@/lib/termsDiff";
import { ROLE_LABELS, normalizeRole } from "@/lib/roleLabels";
import { LOCATIONS_DATA } from "@/lib/zipCoverage";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import {
  createTermsDocument, deleteTermsDocument, getTermsAcceptances, getTermsDocuments, getTermsVersions, publishTerms, saveTermsDraft, setTermsArchived,
} from "@/lib/supabase/terms";
import {
  audienceIsEmpty, audienceMatches, audienceText, bodyIsEmpty, draftChanged, hasAcceptedLatest, toAudience,
  type TermsAcceptance, type TermsAudience, type TermsDocument, type TermsVersion,
} from "@/lib/terms";

const EDIT_ROLES = new Set(["ADMIN", "SUPERADMIN", "SUPERSUPERADMIN"]);
const VIEW_ROLES = new Set([...EDIT_ROLES, "HR"]);

const roleName = (r: string) => ROLE_LABELS[normalizeRole(r)] ?? r.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const KNOWN_BRANCHES = Array.from(new Set(LOCATIONS_DATA.map((l) => l.location).filter(Boolean)));

type Tab = "draft" | "accepted" | "history";
type Draft = { title: string; body: string; audience: TermsAudience };

export function TermsAdminPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const { role, extraRoles, realRole } = useAuth();
  const myRoles = [realRole ?? role, ...(extraRoles ?? [])].filter(Boolean).map((r) => normalizeRole(r as string));
  const canEdit = myRoles.some((r) => EDIT_ROLES.has(r));
  const canView = myRoles.some((r) => VIEW_ROLES.has(r));

  const [docs, setDocs] = useState<TermsDocument[] | null>(null);
  const [versions, setVersions] = useState<TermsVersion[]>([]);
  const [acceptances, setAcceptances] = useState<TermsAcceptance[]>([]);
  const [people, setPeople] = useState<ProfileRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("draft");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [d, v, a, p] = await Promise.all([getTermsDocuments(), getTermsVersions(), getTermsAcceptances(), getCompanyUsers()]);
      setDocs(d);
      setVersions(v);
      setAcceptances(a);
      setPeople(p.filter((x) => x.is_active));
      setSelectedId((cur) => cur ?? d[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDocs([]);
    }
  }, []);
  useEffect(() => { if (canView) void load(); }, [canView, load]);

  const selected = docs?.find((d) => d.id === selectedId) ?? null;
  // The editor holds the selected set's draft; switching sets reloads it.
  useEffect(() => {
    setDraft(selected ? { title: selected.title, body: selected.body, audience: selected.audience } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.updatedAt]);

  const versionsOf = useCallback((docId: string) => versions.filter((v) => v.documentId === docId).sort((a, b) => b.version - a.version), [versions]);
  const latestOf = (docId: string) => versionsOf(docId)[0];
  const unsaved = !!(selected && draft && (draft.title !== selected.title || draft.body !== selected.body || JSON.stringify(draft.audience) !== JSON.stringify(selected.audience)));

  /** Accepted / out of who it's for, against the live version's audience. */
  const progressOf = useCallback((doc: TermsDocument) => {
    const vs = versionsOf(doc.id);
    const live = vs[0];
    if (!live) return null;
    const audience = people.filter((p) => audienceMatches(live.audience, p));
    const mine = new Map<string, Set<string>>();
    for (const a of acceptances) if (a.documentId === doc.id) mine.set(a.profileId, (mine.get(a.profileId) ?? new Set()).add(a.versionId));
    const done = audience.filter((p) => hasAcceptedLatest(vs, mine.get(p.id) ?? new Set())).length;
    return { done, total: audience.length };
  }, [versionsOf, people, acceptances]);

  // ---- options for "Who sees it" ----
  const roleOptions = useMemo(() => {
    const set = new Set<string>(Object.keys(ROLE_LABELS));
    for (const p of people) { if (p.role) set.add(normalizeRole(p.role)); for (const r of p.extra_roles ?? []) set.add(normalizeRole(r)); }
    return Array.from(set).sort((a, b) => roleName(a).localeCompare(roleName(b)));
  }, [people]);
  const deptOptions = useMemo(() => Array.from(new Set(people.map((p) => (p.department ?? "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [people]);
  const branchOptions = useMemo(() => {
    const set = new Set(KNOWN_BRANCHES);
    for (const p of people) if (p.assigned_branch?.trim()) set.add(p.assigned_branch.trim());
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [people]);

  // ---- actions ----
  const createNew = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const doc = await createTermsDocument("New Pop up Form");
      await load();
      setSelectedId(doc.id);
      setTab("draft");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const save = async (quiet = false): Promise<boolean> => {
    if (!selected || !draft) return false;
    if (!draft.title.trim()) { toast.error("Give the form a title."); return false; }
    setSaving(true);
    try {
      await saveTermsDraft(selected.id, draft);
      await load();
      if (!quiet) toast.success("Draft saved — nobody sees it until you publish.");
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const toggleArchived = async () => {
    if (!selected) return;
    try {
      await setTermsArchived(selected.id, !selected.archived);
      toast.success(selected.archived ? "Asking again." : "Stopped asking — acceptances are kept.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async () => {
    if (!selected || versionsOf(selected.id).length) return;
    if (!window.confirm(`Delete the draft "${selected.title || "Untitled"}"? It was never published.`)) return;
    try {
      await deleteTermsDocument(selected.id);
      setSelectedId(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  // ---- access ----
  if (!canView) {
    return (
      <main className="flex-1 w-full px-3 py-8 sm:px-5">
        <button type="button" onClick={goBack} className="btn mb-6"><ChevronLeft className="h-4 w-4" /> {mod.label}</button>
        <p className="text-slate-400">Only Admin, Super Admin and HR can open Pop up Forms.</p>
      </main>
    );
  }

  const live = selected ? latestOf(selected.id) : undefined;
  const changed = selected && draft ? draftChanged(draft, live) : false;
  // Preview marks what the draft changes from the live version — as people who accepted it will see it.
  const previewChanges = previewing && draft && live ? markTermsChanges(DOMPurify.sanitize(live.body), DOMPurify.sanitize(draft.body)) : undefined;

  return (
    <main className="flex-1 w-full px-3 py-6 sm:px-5">
      <TermsDocStyleTag />
      <div className="mb-5 flex flex-wrap items-start gap-3">
        <button type="button" onClick={goBack} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4" /> {mod.label}</button>
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-display font-bold tracking-tight">{sub.title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Forms that pop up for people to read and accept, like the Terms &amp; Conditions. Write one as a draft — nobody sees it until you press <b>Publish</b>. Then everyone it's for gets it on their next sign-in,
            or within 5 minutes if they're already signed in. Each person accepts once per version.{!canEdit && " You can look; only Admin and Super Admin can edit and publish."}
          </p>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}

      <div className="grid gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
        {/* ---- the sets ---- */}
        <aside className="space-y-2">
          {canEdit && (
            <button type="button" onClick={() => void createNew()} disabled={creating} className="btn btn-primary w-full justify-center">
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} New pop up form
            </button>
          )}
          {docs === null ? (
            <p className="px-2 py-6 text-center text-sm text-slate-400"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Loading…</p>
          ) : !docs.length ? (
            <p className="rounded-lg border border-dashed border-white/15 px-4 py-6 text-center text-sm text-slate-400">No pop up forms yet.{canEdit && " Press New pop up form to write the first draft."}</p>
          ) : (
            docs.map((d) => {
              const v = latestOf(d.id);
              const prog = progressOf(d);
              const pending = draftChanged(d, v);
              const active = d.id === selectedId;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => { if (unsaved && !window.confirm("Leave without saving the draft?")) return; setSelectedId(d.id); }}
                  className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${active ? "border-sky-500/60 bg-sky-500/10" : "border-white/10 bg-slate-900/40 hover:border-white/20"}`}
                >
                  <div className="flex items-start gap-2">
                    <FileText className={`mt-0.5 h-4 w-4 shrink-0 ${active ? "text-sky-300" : "text-slate-500"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-white">{d.title || "Untitled"}</div>
                      <div className="mt-0.5 truncate text-[11px] text-slate-400">{audienceText(v ? v.audience : d.audience, roleName)}</div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold">
                        {!v ? (
                          <span className="rounded bg-slate-600/40 px-1.5 py-0.5 text-slate-300">DRAFT — not published</span>
                        ) : d.archived ? (
                          <span className="rounded bg-slate-600/40 px-1.5 py-0.5 text-slate-300">STOPPED · v{v.version}</span>
                        ) : (
                          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-emerald-300">LIVE · v{v.version}</span>
                        )}
                        {v && pending && <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-300">Draft changes</span>}
                        {prog && <span className="text-slate-400">{prog.done}/{prog.total} accepted</span>}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </aside>

        {/* ---- the selected set ---- */}
        <section className="min-w-0 rounded-xl border border-white/10 bg-slate-900/40">
          {!selected || !draft ? (
            <p className="px-6 py-16 text-center text-sm text-slate-400">Pick a form on the left.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1 border-b border-white/10 px-4 pt-3">
                {([
                  ["draft", canEdit ? "Draft" : "Text"],
                  ["accepted", "Who accepted"],
                  ["history", `History (${versionsOf(selected.id).length})`],
                ] as const).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setTab(k)}
                    className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${tab === k ? "border-sky-400 text-white" : "border-transparent text-slate-400 hover:text-slate-200"}`}
                  >
                    {label}
                  </button>
                ))}
                <span className="ml-auto pb-2 text-[11px] text-slate-500">
                  {live ? <>Live: v{live.version}, published {fmtDate(live.publishedAt)}{live.publishedByName ? ` by ${live.publishedByName}` : ""}</> : "Not published yet"}
                </span>
              </div>

              {tab === "draft" && (
                <div className="space-y-5 p-4 sm:p-5">
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Title</label>
                    <input
                      value={draft.title}
                      disabled={!canEdit}
                      onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                      placeholder="e.g. General Terms & Conditions"
                      className="w-full rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2 text-base font-semibold text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none disabled:opacity-70"
                    />
                  </div>

                  <AudiencePicker
                    value={draft.audience}
                    onChange={(audience) => setDraft({ ...draft, audience })}
                    disabled={!canEdit}
                    roles={roleOptions}
                    departments={deptOptions}
                    branches={branchOptions}
                    people={people}
                  />

                  <div>
                    <div className="mb-1 flex items-center gap-2">
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">Text</label>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => {
                            if (!bodyIsEmpty(draft.body) && !window.confirm("Replace the text in this draft with the AHS standard terms?")) return;
                            const keepTitle = draft.title.trim() && !["New Terms & Conditions", "New Pop up Form"].includes(draft.title.trim());
                            setDraft({ ...draft, title: keepTitle ? draft.title : AHS_STANDARD_TERMS.title, body: AHS_STANDARD_TERMS.html });
                            toast.success("AHS standard terms inserted — review, then Save draft. Nothing is live until you publish.");
                          }}
                          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-sky-500/15 px-2.5 py-1 text-xs font-semibold text-sky-200 hover:bg-sky-500/25"
                        >
                          <FileInput className="h-3.5 w-3.5" /> Insert AHS standard terms
                        </button>
                      )}
                    </div>
                    {canEdit ? (
                      <RichTextEditor value={draft.body} onChange={(body) => setDraft((d) => (d ? { ...d, body } : d))} mergeFields={[]} tall darkClass={TERMS_DOC_CLASS} />
                    ) : (
                      <div className={`${TERMS_DOC_CLASS} ${TERMS_DOC_PANEL} max-h-[60vh] overflow-y-auto rounded-md border border-white/10 px-8 py-6`} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(draft.body) }} />
                    )}
                  </div>

                  {canEdit && (
                    <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
                      <span className="mr-auto text-xs text-slate-400">
                        {unsaved ? <span className="text-amber-300">Unsaved changes</span>
                          : changed && live ? "Saved draft differs from what's live — publish to make it live."
                          : changed ? "Saved as a draft — nobody sees it yet."
                          : "Live matches this draft."}
                        {selected.updatedByName && !unsaved && <> · last saved {fmtDateTime(selected.updatedAt)} by {selected.updatedByName}</>}
                      </span>
                      {!versionsOf(selected.id).length && (
                        <button type="button" onClick={() => void remove()} className="btn hover:bg-red-500/20"><Trash2 className="h-4 w-4" /> Delete draft</button>
                      )}
                      {live && (
                        <button type="button" onClick={() => void toggleArchived()} className="btn hover:bg-white/15" title={selected.archived ? "Start asking again" : "Stop showing these terms to anyone (acceptances kept)"}>
                          {selected.archived ? <><Play className="h-4 w-4" /> Ask again</> : <><Pause className="h-4 w-4" /> Stop asking</>}
                        </button>
                      )}
                      <button type="button" onClick={() => setPreviewing(true)} className="btn hover:bg-white/15"><Eye className="h-4 w-4" /> Preview</button>
                      <button type="button" onClick={() => void save()} disabled={saving || !unsaved} className="btn hover:bg-white/15 disabled:opacity-50">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save draft
                      </button>
                      <button
                        type="button"
                        onClick={() => setPublishing(true)}
                        disabled={!changed && !unsaved}
                        title={!changed && !unsaved ? "Nothing new to publish" : undefined}
                        className="btn btn-primary disabled:opacity-50"
                      >
                        <Rocket className="h-4 w-4" /> Publish…
                      </button>
                    </div>
                  )}
                </div>
              )}

              {tab === "accepted" && (
                <AcceptedTab doc={selected} versions={versionsOf(selected.id)} acceptances={acceptances.filter((a) => a.documentId === selected.id)} people={people} />
              )}

              {tab === "history" && (
                <HistoryTab versions={versionsOf(selected.id)} acceptances={acceptances.filter((a) => a.documentId === selected.id)} />
              )}
            </>
          )}
        </section>
      </div>

      {previewing && draft && (
        <AppModal title="Preview — what people will see" description="This is the window people get. Nothing is sent." onClose={() => setPreviewing(false)} size="xl">
          <div className="rounded-lg border border-white/10 bg-slate-900">
            <div className="border-b border-white/10 px-5 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-sky-300">Please read and accept to continue</div>
              <div className="mt-1 text-lg font-bold text-white">{draft.title || "Untitled"}</div>
              <div className="text-xs text-slate-400">Version {(live?.version ?? 0) + 1} · for {audienceText(draft.audience, roleName)}</div>
              {previewChanges !== undefined && (
                <div className="mt-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-100">
                  {previewChanges === null
                    ? `Changed throughout since Version ${live!.version} — people are asked to read it all.`
                    : previewChanges.changes
                      ? `${previewChanges.changes} ${previewChanges.changes === 1 ? "place" : "places"} changed since Version ${live!.version} — people see added text highlighted and removed text struck through, as here.`
                      : `Same text as Version ${live!.version}.`}
                </div>
              )}
            </div>
            <div
              className={`${TERMS_DOC_CLASS} ${TERMS_DOC_PANEL} max-h-[55vh] overflow-y-auto px-8 py-7 sm:px-12`}
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(previewChanges?.changes ? previewChanges.html : draft.body) || "<p><i>No text yet.</i></p>" }}
            />
            <div className="flex items-center gap-2 border-t border-white/10 px-5 py-3 text-sm text-slate-400">
              <input type="checkbox" disabled className="h-4 w-4" /> I have read, understood, and agree to the {draft.title || "terms"}.
              <span className="ml-auto rounded-lg bg-sky-600/50 px-4 py-1.5 font-semibold text-white">I agree</span>
            </div>
          </div>
        </AppModal>
      )}

      {publishing && selected && draft && (
        <PublishDialog
          draft={draft}
          nextVersion={(live?.version ?? 0) + 1}
          people={people}
          unsaved={unsaved}
          onClose={() => setPublishing(false)}
          onPublish={async (requiresReaccept) => {
            if (unsaved && !(await save(true))) return;
            await publishTerms(selected.id, requiresReaccept);
            toast.success(`Published v${(live?.version ?? 0) + 1}. People will be asked to accept.`);
            setPublishing(false);
            await load();
          }}
        />
      )}
    </main>
  );
}

// ---- Who sees it -----------------------------------------------------------

function AudiencePicker({
  value, onChange, disabled, roles, departments, branches, people,
}: {
  value: TermsAudience;
  onChange: (a: TermsAudience) => void;
  disabled: boolean;
  roles: string[];
  departments: string[];
  branches: string[];
  people: ProfileRow[];
}) {
  const a = toAudience(value);
  const reach = people.filter((p) => audienceMatches(a, p)).length;
  const set = (key: "roles" | "departments" | "branches", list: string[]) => onChange({ ...a, everyone: false, [key]: list });
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">Who sees it</label>
      <div className="inline-flex rounded-lg border border-white/10 bg-slate-800/60 p-0.5 text-sm">
        {([["everyone", "Everyone"], ["pick", "Only some people"]] as const).map(([k, label]) => {
          const on = k === "everyone" ? a.everyone : !a.everyone;
          return (
            <button
              key={k}
              type="button"
              disabled={disabled}
              onClick={() => onChange(k === "everyone" ? { everyone: true } : { everyone: false, roles: a.roles ?? [], departments: a.departments ?? [], branches: a.branches ?? [] })}
              className={`rounded-md px-3 py-1.5 font-semibold ${on ? "bg-sky-600 text-white" : "text-slate-300 hover:text-white"} disabled:cursor-not-allowed`}
            >
              {label}
            </button>
          );
        })}
      </div>
      {!a.everyone && (
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <ChipPicker label="Roles" options={roles} value={a.roles ?? []} onChange={(l) => set("roles", l)} disabled={disabled} display={roleName} />
          <ChipPicker label="Departments" options={departments} value={a.departments ?? []} onChange={(l) => set("departments", l)} disabled={disabled} />
          <ChipPicker label="Branches" options={branches} value={a.branches ?? []} onChange={(l) => set("branches", l)} disabled={disabled} />
        </div>
      )}
      <p className={`mt-2 text-xs ${audienceIsEmpty(a) ? "text-amber-300" : "text-slate-400"}`}>
        <Users className="mr-1 inline h-3.5 w-3.5" />
        {audienceIsEmpty(a) ? "Pick at least one role, department or branch." : <>Reaches <b className="text-white">{plural(reach, "active person")}</b>{!a.everyone && " — anyone who matches any one of the picks"}.</>}
      </p>
    </div>
  );
}

function ChipPicker({
  label, options, value, onChange, disabled, display = (s: string) => s,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  disabled: boolean;
  display?: (s: string) => string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const picked = new Set(value);
  const shown = options.filter((o) => !picked.has(o) && (!q.trim() || display(o).toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <div className="rounded-lg border border-white/10 bg-slate-800/40 p-2">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="flex flex-wrap gap-1">
        {value.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-md bg-sky-500/20 px-2 py-0.5 text-xs font-semibold text-sky-200">
            {display(v)}
            {!disabled && <button type="button" onClick={() => onChange(value.filter((x) => x !== v))} aria-label={`Remove ${display(v)}`} className="text-sky-300 hover:text-white"><X className="h-3 w-3" /></button>}
          </span>
        ))}
        {!value.length && <span className="text-xs text-slate-500">None</span>}
      </div>
      {!disabled && (
        <div className="relative mt-2">
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 150)}
            placeholder={`Add ${label.toLowerCase()}…`}
            className="w-full rounded-md border border-white/10 bg-slate-900 px-2 py-1 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
          />
          {open && shown.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-52 overflow-y-auto rounded-md border border-white/10 bg-slate-900 py-1 shadow-xl">
              {shown.map((o) => (
                <button key={o} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange([...value, o]); setQ(""); }} className="block w-full px-2.5 py-1 text-left text-xs text-slate-200 hover:bg-white/10">
                  {display(o)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Publish ---------------------------------------------------------------

function PublishDialog({
  draft, nextVersion, people, unsaved, onClose, onPublish,
}: {
  draft: Draft;
  nextVersion: number;
  people: ProfileRow[];
  unsaved: boolean;
  onClose: () => void;
  onPublish: (requiresReaccept: boolean) => Promise<void>;
}) {
  const [reaccept, setReaccept] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showList, setShowList] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const a = toAudience(draft.audience);
  const reach = people.filter((p) => audienceMatches(a, p)).sort((x, y) => (x.display_name || "").localeCompare(y.display_name || ""));
  // People a targeted set can't reach because their profile is missing what it targets.
  const blanks = a.everyone ? [] : people.filter((p) =>
    ((a.departments?.length ?? 0) > 0 && !p.department?.trim()) || ((a.branches?.length ?? 0) > 0 && !p.assigned_branch?.trim()));
  const problem = !draft.title.trim() ? "Add a title first." : bodyIsEmpty(draft.body) ? "Write the text first." : audienceIsEmpty(a) ? "Pick who it's for first." : null;

  const go = async () => {
    if (problem || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onPublish(nextVersion === 1 || reaccept);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <AppModal
      title={`Publish v${nextVersion}?`}
      description={`"${draft.title || "Untitled"}" goes live now. People are asked on their next sign-in, or within 5 minutes if they're signed in.`}
      icon={<Rocket className="h-5 w-5 text-sky-300" />}
      onClose={onClose}
      busy={busy}
      size="lg"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="btn">Cancel</button>
          <button type="button" onClick={() => void go()} disabled={!!problem || busy} className="btn btn-primary disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />} Publish v{nextVersion}
          </button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        {problem && <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-200">{problem}</p>}
        {unsaved && !problem && <p className="text-xs text-slate-400">Your unsaved changes are saved first.</p>}
        <div className="rounded-lg border border-white/10 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-sky-300" />
            <span>Goes to <b>{plural(reach.length, "active person")}</b> · {audienceText(a, roleName)}</span>
            <button type="button" onClick={() => setShowList((s) => !s)} className="ml-auto text-xs font-semibold text-sky-300 hover:underline">{showList ? "Hide list" : "See who"}</button>
          </div>
          {showList && (
            <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-white/5 text-xs">
              {reach.map((p) => (
                <div key={p.id} className="flex gap-2 border-t border-white/5 px-2 py-1 first:border-t-0">
                  <span className="font-medium">{p.display_name || p.email}</span>
                  <span className="ml-auto text-muted-foreground">{[p.role && roleName(p.role), p.department, p.assigned_branch].filter(Boolean).join(" · ")}</span>
                </div>
              ))}
            </div>
          )}
          {blanks.length > 0 && (
            <p className="mt-2 text-xs text-amber-300">
              {plural(blanks.length, "person")} {blanks.length === 1 ? "has" : "have"} no {(a.departments?.length ? ["department"] : []).concat(a.branches?.length ? ["branch"] : []).join(" or ")} set, so {blanks.length === 1 ? "they" : "they"} won't get this unless a role picks them up:{" "}
              {blanks.slice(0, 8).map((p) => p.display_name || p.email).join(", ")}{blanks.length > 8 ? `, +${blanks.length - 8} more` : ""}.
            </p>
          )}
        </div>
        {nextVersion > 1 ? (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-white/10 px-3 py-2.5">
            <input type="checkbox" checked={reaccept} onChange={(e) => setReaccept(e.target.checked)} className="mt-0.5 h-4 w-4 accent-sky-500" />
            <span>
              <b>Everyone must accept again</b>
              <span className="block text-xs text-muted-foreground">Leave on for a real change. Untick for a small fix (typo) — people who accepted an earlier version won't be asked again; new people still accept this one.</span>
            </span>
          </label>
        ) : (
          <p className="text-xs text-muted-foreground">First version — everyone it's for will be asked to accept.</p>
        )}
        {err && <p className="text-xs text-red-300">{err}</p>}
      </div>
    </AppModal>
  );
}

// ---- Who accepted ----------------------------------------------------------

function AcceptedTab({ doc, versions, acceptances, people }: { doc: TermsDocument; versions: TermsVersion[]; acceptances: TermsAcceptance[]; people: ProfileRow[] }) {
  const [status, setStatus] = useState<"all" | "done" | "waiting">("all");
  const [ipDiffOnly, setIpDiffOnly] = useState(false);
  const [q, setQ] = useState("");
  const [branch, setBranch] = useState("");
  const [dept, setDept] = useState("");
  const live = versions[0];

  const rows = useMemo(() => {
    if (!live) return [];
    const byPerson = new Map<string, TermsAcceptance[]>();
    for (const a of acceptances) byPerson.set(a.profileId, [...(byPerson.get(a.profileId) ?? []), a]);
    const vNum = new Map(versions.map((v) => [v.id, v.version]));
    return people
      .filter((p) => audienceMatches(live.audience, p))
      .map((p) => {
        const mine = (byPerson.get(p.id) ?? []).sort((x, y) => (vNum.get(y.versionId) ?? 0) - (vNum.get(x.versionId) ?? 0));
        const done = hasAcceptedLatest(versions, new Set(mine.map((a) => a.versionId)));
        return { p, done, last: mine[0], lastVersion: mine[0] ? vNum.get(mine[0].versionId) : undefined };
      })
      .sort((x, y) => Number(x.done) - Number(y.done) || (x.p.display_name || "").localeCompare(y.p.display_name || ""));
  }, [live, versions, acceptances, people]);

  if (!live) return <p className="px-6 py-14 text-center text-sm text-slate-400">Not published yet — publish it to start collecting acceptances.</p>;

  const branches = Array.from(new Set(rows.map((r) => r.p.assigned_branch || "").filter(Boolean))).sort();
  const depts = Array.from(new Set(rows.map((r) => r.p.department || "").filter(Boolean))).sort();
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = rows.filter((r) =>
    (status === "all" || (status === "done") === r.done)
    && (!ipDiffOnly || r.last?.ipMatches === false)
    && (!branch || r.p.assigned_branch === branch)
    && (!dept || r.p.department === dept)
    && words.every((w) => `${r.p.display_name} ${r.p.email} ${r.p.role ? roleName(r.p.role) : ""}`.toLowerCase().includes(w)));
  const done = rows.filter((r) => r.done).length;
  const ipDiff = rows.filter((r) => r.last?.ipMatches === false).length;
  /** "Memphis, Tennessee, US" — where the IP was when they accepted. */
  const ipPlace = (a: TermsAcceptance) => [a.ipCity, a.ipRegion, a.ipCountry].filter(Boolean).join(", ");

  const exportCsv = () => {
    const esc = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const lines = [["Name", "Email", "Role", "Department", "Branch", "Status", "Version accepted", "Accepted at", "Device", "IP", "IP location", "Browser", "Usual sign-in IP", "Same as usual"].map(esc).join(",")];
    for (const r of shown) {
      const a = r.last;
      lines.push([r.p.display_name, r.p.email, r.p.role ? roleName(r.p.role) : "", r.p.department, r.p.assigned_branch, r.done ? "Accepted" : "Not yet",
        r.lastVersion ? `v${r.lastVersion}` : "", a ? fmtDateTime(a.acceptedAt) : "", a?.device ?? "",
        a?.ip ?? "", a ? ipPlace(a) : "", a?.browser ?? "", a?.usualIp ?? "", a?.ipMatches == null ? "" : a.ipMatches ? "Yes" : "No"].map(esc).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(doc.title || "terms").replace(/[^\w-]+/g, "_")}_v${live.version}_acceptances.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const select = "rounded-md border border-white/10 bg-slate-800 px-2 py-1.5 text-xs text-slate-200 [color-scheme:dark] focus:border-sky-500 focus:outline-none";
  return (
    <div className="p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="mr-2">
          <div className="text-2xl font-bold tabular-nums text-white">{done}<span className="text-base font-semibold text-slate-500"> / {rows.length}</span></div>
          <div className="text-[11px] text-slate-400">accepted v{live.version}{rows.length ? ` · ${Math.round((done / rows.length) * 100)}%` : ""}</div>
        </div>
        <div className="inline-flex rounded-lg border border-white/10 bg-slate-800/60 p-0.5 text-xs">
          {([["all", `All (${rows.length})`], ["waiting", `Not yet (${rows.length - done})`], ["done", `Accepted (${done})`]] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setStatus(k)} className={`rounded-md px-2.5 py-1 font-semibold ${status === k ? "bg-sky-600 text-white" : "text-slate-300 hover:text-white"}`}>{label}</button>
          ))}
        </div>
        {ipDiff > 0 && (
          <button
            type="button"
            onClick={() => setIpDiffOnly((v) => !v)}
            title="Accepted from an IP that isn't the one they usually sign in from (last 90 days)"
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold ${ipDiffOnly ? "border-amber-400/60 bg-amber-500/25 text-amber-100" : "border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"}`}
          >
            <AlertTriangle className="h-3.5 w-3.5" /> Different IP ({ipDiff})
          </button>
        )}
        <select value={branch} onChange={(e) => setBranch(e.target.value)} className={select} aria-label="Branch">
          <option value="">All branches</option>
          {branches.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={dept} onChange={(e) => setDept(e.target.value)} className={select} aria-label="Department">
          <option value="">All departments</option>
          {depts.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <label className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, role" className="w-56 rounded-md border border-white/10 bg-slate-800 py-1.5 pl-7 pr-2 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none" />
        </label>
        <button type="button" onClick={exportCsv} className="btn ml-auto hover:bg-white/15"><Download className="h-4 w-4" /> Export CSV</button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full text-xs">
          <thead className="bg-slate-900/80">
            <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Department</th>
              <th className="px-3 py-2">Branch</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Accepted</th>
              <th className="px-3 py-2" title="The IP they accepted from, compared with the one they usually sign in from (last 90 days)">Signed from</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.p.id} className="border-t border-white/5">
                <td className="whitespace-nowrap px-3 py-2 font-medium text-white">{r.p.display_name || r.p.email}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-300">{r.p.role ? roleName(r.p.role) : "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-400">{r.p.department || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-400">{r.p.assigned_branch || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  {r.done ? (
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 font-semibold text-emerald-300"><CheckCircle2 className="h-3 w-3" /> Accepted</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 font-semibold text-amber-300"><Clock className="h-3 w-3" /> Not yet{r.last ? ` (has v${r.lastVersion})` : ""}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-400">{r.last ? `v${r.lastVersion} · ${fmtDateTime(r.last.acceptedAt)} · ${r.last.device}` : "—"}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  {r.last?.ip ? (
                    <div title={[r.last.browser, r.last.usualIp ? `Usual sign-in IP: ${r.last.usualIp}` : "No sign-in history to compare"].filter(Boolean).join(" · ")}>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-slate-200">{r.last.ip}</span>
                        {r.last.ipMatches === true && <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">Usual IP</span>}
                        {r.last.ipMatches === false && (
                          <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                            <AlertTriangle className="h-3 w-3" /> Usually {r.last.usualIp}
                          </span>
                        )}
                      </div>
                      {ipPlace(r.last) && <div className="text-[10px] text-slate-500">{ipPlace(r.last)}</div>}
                    </div>
                  ) : (
                    <span className="text-slate-500" title={r.last ? "Accepted before IPs were recorded, or without the server" : undefined}>—</span>
                  )}
                </td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">Nobody matches these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- History ---------------------------------------------------------------

function HistoryTab({ versions, acceptances }: { versions: TermsVersion[]; acceptances: TermsAcceptance[] }) {
  const [open, setOpen] = useState<string | null>(versions[0]?.id ?? null);
  const [highlight, setHighlight] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);
  const changeAt = useRef(-1);
  // What each version changed from the one before it (versions are newest first) — undefined for v1.
  const changesOf = useMemo(
    () => new Map(versions.map((v, i) => [v.id, versions[i + 1] ? markTermsChanges(DOMPurify.sanitize(versions[i + 1].body), DOMPurify.sanitize(v.body)) : undefined])),
    [versions],
  );
  const nextChange = () => {
    const marks = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("ins.terms-added, del.terms-removed") ?? []);
    if (!marks.length) return;
    marks.forEach((m) => m.classList.remove("terms-change-focus"));
    changeAt.current = (changeAt.current + 1) % marks.length;
    marks[changeAt.current].classList.add("terms-change-focus");
    marks[changeAt.current].scrollIntoView({ behavior: "smooth", block: "center" });
  };
  if (!versions.length) return <p className="px-6 py-14 text-center text-sm text-slate-400">Nothing published yet.</p>;
  return (
    <div className="divide-y divide-white/5">
      {versions.map((v, i) => {
        const isOpen = open === v.id;
        const count = acceptances.filter((a) => a.versionId === v.id).length;
        const changes = changesOf.get(v.id);
        const prev = versions[i + 1];
        const showMarks = highlight && !!changes?.changes;
        return (
          <Fragment key={v.id}>
            <button type="button" onClick={() => { setOpen(isOpen ? null : v.id); changeAt.current = -1; }} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/5">
              {isOpen ? <ChevronDown className="h-4 w-4 text-slate-300" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
              <span className="rounded bg-slate-700/60 px-1.5 py-0.5 text-xs font-bold text-white">v{v.version}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{v.title}</span>
              <span className="hidden text-xs text-slate-400 sm:inline">{audienceText(v.audience, roleName)}</span>
              {prev && changes !== undefined && (
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300" title={`What changed from v${prev.version}`}>
                  {changes === null ? `Rewritten from v${prev.version}` : changes.changes ? `${plural(changes.changes, "change")} from v${prev.version}` : `Same text as v${prev.version}`}
                </span>
              )}
              {v.version > 1 && (
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${v.requiresReaccept ? "bg-sky-500/15 text-sky-300" : "bg-slate-600/40 text-slate-300"}`}>
                  {v.requiresReaccept ? "Everyone re-accepted" : "Small fix"}
                </span>
              )}
              <span className="text-xs tabular-nums text-slate-400">{plural(count, "acceptance")}</span>
              <span className="text-xs text-slate-500">{fmtDate(v.publishedAt)}{v.publishedByName ? ` · ${v.publishedByName}` : ""}</span>
            </button>
            {isOpen && (
              <div className="mx-4 mb-4">
                {prev && !!changes?.changes && (
                  <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                    <span>
                      <span className="font-semibold">New in v{v.version}:</span> {plural(changes.changes, "place")} changed from v{prev.version} —{" "}
                      <ins className="rounded-sm bg-yellow-400/25 px-1 text-yellow-100 no-underline">added</ins> highlighted, <del className="text-red-300">removed</del> struck through.
                    </span>
                    <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5">
                      <input type="checkbox" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} className="h-3.5 w-3.5 accent-amber-500" /> Highlight changes
                    </label>
                    {highlight && (
                      <button type="button" onClick={nextChange} className="inline-flex items-center gap-1 rounded-md bg-amber-500/25 px-2.5 py-1 font-semibold text-amber-50 hover:bg-amber-500/40">
                        <ArrowDownToLine className="h-3.5 w-3.5" /> Next change
                      </button>
                    )}
                  </div>
                )}
                <div
                  ref={panelRef}
                  className={`${TERMS_DOC_CLASS} ${TERMS_DOC_PANEL} max-h-[50vh] overflow-y-auto rounded-md border border-white/10 px-8 py-6`}
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(showMarks ? changes!.html : v.body) }}
                />
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
