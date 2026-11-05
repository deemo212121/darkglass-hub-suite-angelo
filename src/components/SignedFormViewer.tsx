/**
 * Form Inconsistencies → a signed form opened in place (no new tab): its PDF,
 * with Edit at the top — HR corrects the fields the check compares and the
 * PDF is rebuilt under the person's own signature (signedFormEdit.ts) — and
 * Send form again for when the person should redo it themselves.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Send, X, CheckCircle2, AlertTriangle, History } from "lucide-react";
import type { SignableDocument } from "@/lib/supabase/signableDocuments";
import { CONSISTENCY_FIELDS, CONSISTENCY_FIELD_LABEL, type ConsistencyField } from "@/lib/formConsistency";
import { editableFields, editHistoryOf, saveSignedFormCorrections, whyNotEditable } from "@/lib/signedFormEdit";

const shortDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");
const text = (v: unknown) => (v == null ? "" : String(v));
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function SignedFormViewer({
  doc,
  title,
  personName,
  focusField,
  editor,
  onSaved,
  onSendAgain,
  onClose,
}: {
  doc: SignableDocument;
  title: string;
  personName: string;
  /** The difference it was opened from — its fields come first, highlighted. */
  focusField: ConsistencyField | null;
  editor: { profileId: string | null; name: string | null };
  onSaved: (doc: SignableDocument) => void;
  /** Send this form to the person to fill out again instead (unset = not offered). */
  onSendAgain?: () => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const fields = useMemo(() => editableFields(doc), [doc]);
  const notEditable = whyNotEditable(doc);
  const history = editHistoryOf(doc);
  const lastEdit = history[history.length - 1];
  const groups = useMemo(() => {
    const order = focusField ? [focusField, ...CONSISTENCY_FIELDS.filter((x) => x !== focusField)] : CONSISTENCY_FIELDS;
    return order.map((field) => ({ field, items: fields.filter((x) => x.field === field) })).filter((g) => g.items.length > 0);
  }, [fields, focusField]);
  const changed = fields.filter((x) => text(values[x.key]) !== text(doc.formData?.[x.key]));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !saving) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  const startEdit = () => {
    setValues(Object.fromEntries(fields.map((x) => [x.key, text(doc.formData?.[x.key])])));
    setError(null);
    setSaved(false);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await saveSignedFormCorrections(doc, values, editor);
      onSaved(updated);
      setEditing(false);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-2 backdrop-blur-sm sm:p-4" onClick={() => { if (!saving) onClose(); }}>
      <div
        role="dialog"
        aria-label={`${title} — ${personName}`}
        onClick={(e) => e.stopPropagation()}
        className="flex h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-white/15 bg-slate-950 shadow-2xl shadow-black/60"
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-semibold text-white">{title}</h3>
            <p className="truncate text-xs text-slate-400">
              {personName} · signed {shortDate(doc.signedAt || doc.confirmedAt || doc.createdAt)}
              {lastEdit && (
                <span title={history.map((h) => `${shortDate(h.at)} · ${h.byName || "HR"}: ${h.changes.map((c) => c.label).join(", ")}`).join("\n")}>
                  {" "}· <History className="inline h-3 w-3" /> edited by {lastEdit.byName || "HR"} {shortDate(lastEdit.at)}
                </span>
              )}
            </p>
          </div>
          {!editing && (
            <button
              type="button"
              onClick={startEdit}
              disabled={!!notEditable}
              title={notEditable ?? "Correct this form's answers — the PDF is rebuilt under their signature"}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-40"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
          )}
          {onSendAgain && !editing && (
            <button
              type="button"
              onClick={onSendAgain}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-400/40 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-500/20"
            >
              <Send className="h-3.5 w-3.5" /> Send form again
            </button>
          )}
          <button type="button" onClick={onClose} disabled={saving} title="Close" className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-40">
            <X className="h-4 w-4" />
          </button>
        </div>

        {saved && (
          <div className="flex items-center gap-1.5 border-b border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-xs text-emerald-200">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> Saved — the PDF below was rebuilt with the corrected answers.
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {editing && (
            <div className="flex max-h-[45vh] shrink-0 flex-col border-b border-white/10 lg:max-h-none lg:w-80 lg:border-b-0 lg:border-r">
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                {groups.map((g) => (
                  <div key={g.field} className={g.field === focusField ? "rounded-lg border border-amber-400/30 bg-amber-500/5 p-2.5" : ""}>
                    <p className={`mb-1.5 text-[11px] font-semibold uppercase tracking-wide ${g.field === focusField ? "text-amber-200" : "text-slate-500"}`}>
                      {CONSISTENCY_FIELD_LABEL[g.field]}
                      {g.field === focusField && <span className="ml-1 normal-case tracking-normal text-amber-200/70">— doesn't match their other forms</span>}
                    </p>
                    <div className="space-y-2">
                      {g.items.map((x) => {
                        const original = text(doc.formData?.[x.key]);
                        const isDate = x.field === "dob" && (ISO_DAY.test(original) || original === "");
                        return (
                          <label key={x.key} className="block">
                            <span className="mb-0.5 block text-[11px] text-slate-400">{x.label}</span>
                            <input
                              type={isDate ? "date" : "text"}
                              value={values[x.key] ?? ""}
                              onChange={(e) => setValues((prev) => ({ ...prev, [x.key]: e.target.value }))}
                              className={`glass-input w-full rounded-md px-2 py-1.5 text-sm ${x.field === "ssn" || x.field === "phone" || x.field === "license" ? "font-mono" : ""} ${text(values[x.key]) !== original ? "ring-1 ring-amber-400/60" : ""}`}
                            />
                            {text(values[x.key]) !== original && <span className="mt-0.5 block text-[10px] text-slate-500">Was: {original || "(blank)"}</span>}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div className="space-y-2 border-t border-white/10 p-4">
                {error && (
                  <p className="flex items-start gap-1.5 text-xs text-red-300">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
                  </p>
                )}
                <p className="text-[11px] leading-4 text-slate-500">
                  The PDF is rebuilt with these answers under {personName}'s original signature. The change is kept on the form and in Activity Logs.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={saving || changed.length === 0}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    {saving ? "Rebuilding the PDF…" : changed.length > 0 ? `Save ${changed.length} change${changed.length === 1 ? "" : "s"}` : "Save"}
                  </button>
                  <button type="button" onClick={() => setEditing(false)} disabled={saving} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-40">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
          <div className="min-h-0 flex-1 bg-slate-900">
            {doc.pdfUrl ? (
              <iframe key={doc.pdfUrl} src={doc.pdfUrl} title={title} className="h-full w-full border-0" />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">No PDF on file for this form.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
