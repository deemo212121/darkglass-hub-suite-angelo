/**
 * "Custom Forms" tab — the in-house Form Maker's home inside the HR
 * dashboard. Two halves: the form list (build/publish/archive forms, copy
 * a public form's link) and the submissions list for whichever forms have
 * been filled out — same search/filter/soft-delete UX as the Applicant
 * Documents (Jotform) tab, since this is the self-built equivalent of it.
 */
import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Copy, Search, FileText, ExternalLink, X, FileDown, Loader2, HardDrive } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import { auth as firebaseAuth } from "@/lib/firebase/config";
import { CustomFormBuilder } from "./CustomFormBuilder";
import { Switch } from "@/components/ui/switch";
import { generateSubmissionPdf } from "@/lib/documentTemplates/generate";
import { ELEMENT_REGISTRY, type CustomFormField } from "@/lib/formElements";
import {
  getCustomForms,
  getCustomFormSubmissions,
  getDeletedCustomFormSubmissions,
  updateCustomFormSubmissionStatus,
  softDeleteCustomFormSubmission,
  restoreCustomFormSubmission,
  archiveCustomForm,
  setCustomFormDraft,
  setCustomFormDriveUpload,
  deleteCustomForm,
  getGoogleDriveConnectionStatus,
  disconnectGoogleDrive,
  type CustomForm,
  type CustomFormSubmission,
  type CustomFormSubmissionStatus,
  type GoogleDriveConnectionStatus,
} from "@/lib/supabase/customForms";
import { getAppUrl } from "@/lib/appUrl";

const PAGE_SIZE = 25;

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-slate-500/20 text-slate-300",
  published: "bg-green-500/20 text-green-300",
  archived: "bg-slate-700 text-slate-400",
};

/** Renders one submission's stored value — prefers the field's own ElementDefinition.formatValue (Full Name → "First Last", Address → one line, Product List → item names) so composite values read naturally instead of a generic key: value dump; falls back to a generic renderer for types with no formatValue or when the field itself isn't known. */
function renderResponseValue(value: unknown, field?: CustomFormField) {
  const def = field && ELEMENT_REGISTRY[field.type];
  if (def?.formatValue && field) {
    const text = def.formatValue(value, field);
    return <p>{text || "—"}</p>;
  }
  if (value == null || value === "") return <p className="text-muted-foreground">—</p>;
  if (typeof value === "boolean") return <p>{value ? "Yes" : "No"}</p>;
  if (typeof value === "string" || typeof value === "number") return <p>{String(value)}</p>;
  if (value && typeof value === "object" && "url" in (value as any)) {
    const f = value as { url: string; fileName?: string };
    return <a href={f.url} target="_blank" rel="noreferrer noopener" className="text-blue-300 hover:text-blue-200 underline">{f.fileName || "View file"}</a>;
  }
  if (Array.isArray(value)) {
    if (value.length > 0 && Array.isArray(value[0])) {
      // Input Table grid.
      return (
        <table className="text-xs border border-white/10">
          <tbody>{(value as string[][]).map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c} className="border border-white/10 px-1.5 py-0.5">{cell || "—"}</td>)}</tr>)}</tbody>
        </table>
      );
    }
    return <p>{(value as unknown[]).filter((v) => v !== "" && v != null).join(", ") || "—"}</p>;
  }
  // Plain composite object with no formatValue of its own — Captcha, etc.
  return (
    <p className="text-xs">
      {Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== "" && v != null)
        .map(([k, v]) => `${k}: ${v}`)
        .join(" · ") || "—"}
    </p>
  );
}

export function CustomFormsPanel() {
  const { uid } = useAuth();

  const [forms, setForms] = useState<CustomForm[]>([]);
  const [formsLoading, setFormsLoading] = useState(true);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingForm, setEditingForm] = useState<CustomForm | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadForms = async () => {
    setFormsLoading(true);
    try {
      setForms(await getCustomForms());
    } catch (err) {
      console.error("Failed to load custom forms:", err);
    } finally {
      setFormsLoading(false);
    }
  };
  useEffect(() => { void loadForms(); }, []);

  const formsById = useMemo(() => new Map(forms.map((f) => [f.id, f])), [forms]);

  // "Connect Google Drive" — a company-wide setting (not per-form), so
  // every submission on a form with a Document Template gets auto-uploaded
  // (see src/lib/documentTemplates/driveUpload.ts). Status only ever shows
  // connected/not-connected + who connected it — the stored refresh token
  // itself never reaches the client (see get_google_drive_connection_status()).
  const [driveStatus, setDriveStatus] = useState<GoogleDriveConnectionStatus | null>(null);
  const [driveStatusLoading, setDriveStatusLoading] = useState(true);
  const [driveMessage, setDriveMessage] = useState<string | null>(null);
  const [driveActionPending, setDriveActionPending] = useState(false);

  const loadDriveStatus = async () => {
    setDriveStatusLoading(true);
    try {
      setDriveStatus(await getGoogleDriveConnectionStatus());
    } catch (err) {
      console.error("Failed to load Google Drive connection status:", err);
    } finally {
      setDriveStatusLoading(false);
    }
  };
  useEffect(() => { void loadDriveStatus(); }, []);

  // Google redirects back here with ?driveConnected=1|0 after the consent
  // screen (see googleDriveBridge.ts) — show the result once, then strip
  // the param so refreshing the page doesn't re-show it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("driveConnected");
    if (result === null) return;
    setDriveMessage(result === "1" ? "Google Drive connected." : "Couldn't connect Google Drive — please try again.");
    if (result === "1") void loadDriveStatus();
    params.delete("driveConnected");
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
    window.history.replaceState(null, "", next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnectDrive = async () => {
    setDriveActionPending(true);
    try {
      const idToken = await firebaseAuth?.currentUser?.getIdToken(false);
      if (!idToken) { setDriveMessage("You need to be logged in to connect Google Drive."); return; }
      // A real navigation (not fetch) — Google's consent screen has to run in the top-level window.
      window.location.href = `/api/google-drive?action=connect&idToken=${encodeURIComponent(idToken)}`;
    } finally {
      setDriveActionPending(false);
    }
  };

  const handleDisconnectDrive = async () => {
    if (!confirm("Disconnect Google Drive? Submissions will stop auto-uploading until it's reconnected.")) return;
    setDriveActionPending(true);
    try {
      await disconnectGoogleDrive();
      await loadDriveStatus();
    } catch (err) {
      setDriveMessage(err instanceof Error ? err.message : "Failed to disconnect Google Drive.");
    } finally {
      setDriveActionPending(false);
    }
  };

  const [submissions, setSubmissions] = useState<CustomFormSubmission[]>([]);
  const [submissionsLoading, setSubmissionsLoading] = useState(true);
  const loadSubmissions = async () => {
    setSubmissionsLoading(true);
    try {
      setSubmissions(await getCustomFormSubmissions());
    } catch (err) {
      console.error("Failed to load custom form submissions:", err);
    } finally {
      setSubmissionsLoading(false);
    }
  };
  useEffect(() => { void loadSubmissions(); }, []);

  const [deleted, setDeleted] = useState<CustomFormSubmission[]>([]);
  const [deletedLoading, setDeletedLoading] = useState(true);
  const loadDeleted = async () => {
    setDeletedLoading(true);
    try {
      setDeleted(await getDeletedCustomFormSubmissions());
    } catch (err) {
      console.error("Failed to load deleted custom form submissions:", err);
    } finally {
      setDeletedLoading(false);
    }
  };
  useEffect(() => { void loadDeleted(); }, []);

  const [search, setSearch] = useState("");
  const [formFilter, setFormFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | CustomFormSubmissionStatus>("");
  const [page, setPage] = useState(1);

  const filteredSubmissions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return submissions.filter((s) => {
      if (formFilter && s.formId !== formFilter) return false;
      if (statusFilter && s.status !== statusFilter) return false;
      if (q && !(s.submitterName || "").toLowerCase().includes(q) && !(s.formTitle || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [submissions, search, formFilter, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredSubmissions.length / PAGE_SIZE));
  const pagedSubmissions = filteredSubmissions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleStatusChange = async (submission: CustomFormSubmission, status: CustomFormSubmissionStatus) => {
    if (!uid) return;
    const reviewerId = await getMyProfileId(uid);
    if (!reviewerId) return;
    setSubmissions((prev) => prev.map((s) => (s.id === submission.id ? { ...s, status } : s)));
    try {
      await updateCustomFormSubmissionStatus(submission.id, status, reviewerId);
    } catch (err) {
      console.error("Failed to update submission status:", err);
      void loadSubmissions();
    }
  };

  const handleDelete = async (submission: CustomFormSubmission) => {
    setSubmissions((prev) => prev.filter((s) => s.id !== submission.id));
    try {
      await softDeleteCustomFormSubmission(submission.id);
      void loadDeleted();
    } catch (err) {
      console.error("Failed to delete submission:", err);
      void loadSubmissions();
    }
  };

  const handleRestore = async (submission: CustomFormSubmission) => {
    setDeleted((prev) => prev.filter((s) => s.id !== submission.id));
    try {
      await restoreCustomFormSubmission(submission.id);
      void loadSubmissions();
    } catch (err) {
      console.error("Failed to restore submission:", err);
      void loadDeleted();
    }
  };

  /** Public forms link to /apply/$slug (no login); internal ones link to /fill-form/$id (requires being logged in at this company — see FillCustomFormPage.tsx). */
  const copyLink = (form: CustomForm) => {
    const path = form.access === "public" ? (form.publicSlug ? `/apply/${form.publicSlug}` : null) : `/fill-form/${form.id}`;
    if (!path) return;
    navigator.clipboard.writeText(`${getAppUrl()}${path}`);
    setCopiedId(form.id);
    setTimeout(() => setCopiedId((id) => (id === form.id ? null : id)), 1500);
  };

  const handleArchiveForm = async (form: CustomForm) => {
    setForms((prev) => prev.map((f) => (f.id === form.id ? { ...f, status: "archived" } : f)));
    try {
      await archiveCustomForm(form.id);
    } catch (err) {
      console.error("Failed to archive form:", err);
      void loadForms();
    }
  };

  const handleUnarchiveForm = async (form: CustomForm) => {
    setForms((prev) => prev.map((f) => (f.id === form.id ? { ...f, status: "draft" } : f)));
    try {
      await setCustomFormDraft(form.id);
    } catch (err) {
      console.error("Failed to unarchive form:", err);
      void loadForms();
    }
  };

  /** On = every submission's PDF auto-uploads to the connected Google Drive; off = the Document Template still works for on-demand PDF downloads, it just never files to Drive. */
  const handleToggleDriveUpload = async (form: CustomForm, enabled: boolean) => {
    setForms((prev) => prev.map((f) => (f.id === form.id ? { ...f, driveUploadEnabled: enabled } : f)));
    try {
      await setCustomFormDriveUpload(form.id, enabled);
    } catch (err) {
      console.error("Failed to update Drive upload setting:", err);
      void loadForms();
    }
  };

  const handleDeleteForm = async (form: CustomForm) => {
    if (!confirm(`Delete "${form.title}"? Its past submissions are kept, but the form itself (and its public link, if any) will be gone.`)) return;
    setForms((prev) => prev.filter((f) => f.id !== form.id));
    try {
      await deleteCustomForm(form.id);
    } catch (err) {
      console.error("Failed to delete form:", err);
      void loadForms();
    }
  };

  const [preview, setPreview] = useState<CustomFormSubmission | null>(null);
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [previewPdfLoading, setPreviewPdfLoading] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);

  /** Generates the submission's PDF on the fly from its form's document template and opens it in a new tab — "viewing" rather than forcing a download, same as the Applicant Documents tab's "View PDF". */
  const handleViewPdf = async (submission: CustomFormSubmission) => {
    const form = formsById.get(submission.formId);
    if (!form?.documentTemplate) return;
    setViewingId(submission.id);
    try {
      const blob = await generateSubmissionPdf(form.documentTemplate, form, submission);
      window.open(URL.createObjectURL(blob), "_blank");
    } catch (err) {
      console.error("Failed to generate document PDF:", err);
    } finally {
      setViewingId(null);
    }
  };

  /** Clicking a submission's name opens the detail modal — if its form has a document template, that modal shows the actual generated PDF (like the Applicant Documents tab's preview) instead of the raw response list. */
  const openPreview = async (submission: CustomFormSubmission) => {
    setPreview(submission);
    setPreviewPdfUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    const form = formsById.get(submission.formId);
    if (!form?.documentTemplate) return;
    setPreviewPdfLoading(true);
    try {
      const blob = await generateSubmissionPdf(form.documentTemplate, form, submission);
      setPreviewPdfUrl(URL.createObjectURL(blob));
    } catch (err) {
      console.error("Failed to generate document PDF:", err);
    } finally {
      setPreviewPdfLoading(false);
    }
  };

  const closePreview = () => {
    setPreview(null);
    setPreviewPdfUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
  };

  if (builderOpen) {
    return (
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-sm">{editingForm ? "Edit Form" : "New Form"}</h2>
        </div>
        <CustomFormBuilder
          initial={editingForm}
          onCancel={() => { setBuilderOpen(false); setEditingForm(null); }}
          onSaved={() => { setBuilderOpen(false); setEditingForm(null); void loadForms(); }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Google Drive ── */}
      <div className="panel p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <HardDrive className="h-4 w-4 text-blue-300 shrink-0" />
          <div>
            <p className="text-sm font-semibold">Google Drive</p>
            {driveStatusLoading ? (
              <p className="text-[10px] text-muted-foreground mt-0.5">Checking connection…</p>
            ) : driveStatus?.connected ? (
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Connected{driveStatus.connectedByName ? ` by ${driveStatus.connectedByName}` : ""} — every submission on a form with a Document Template auto-uploads here.
              </p>
            ) : (
              <p className="text-[10px] text-muted-foreground mt-0.5">Not connected — submissions with a Document Template aren't being saved to Drive.</p>
            )}
            {driveMessage && <p className="text-[10px] text-blue-300 mt-0.5">{driveMessage}</p>}
          </div>
        </div>
        {!driveStatusLoading && (
          driveStatus?.connected ? (
            <button type="button" onClick={handleDisconnectDrive} disabled={driveActionPending} className="btn text-xs px-3 py-1.5 shrink-0 disabled:opacity-50">Disconnect</button>
          ) : (
            <button type="button" onClick={handleConnectDrive} disabled={driveActionPending} className="btn text-xs px-3 py-1.5 shrink-0 disabled:opacity-50">Connect Google Drive</button>
          )
        )}
      </div>

      {/* ── Forms ── */}
      <div className="panel p-0 overflow-hidden">
        <div className="px-4 py-4 border-b border-white/10 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-sm flex items-center gap-1.5"><FileText className="h-4 w-4 text-blue-300" /> Custom Forms</h2>
            <p className="text-[10px] text-muted-foreground mt-0.5">Build your own forms — public ones can be filled out by anyone with the link, no AHS login needed; internal ones need an AHS login and have their own shareable link too.</p>
          </div>
          <button type="button" onClick={() => { setEditingForm(null); setBuilderOpen(true); }} className="btn text-sm px-3 py-1.5 flex items-center gap-1.5 shrink-0">
            <Plus className="h-3.5 w-3.5" /> New Form
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Title</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Access</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Fields</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase"></th>
              </tr>
            </thead>
            <tbody>
              {formsLoading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">Loading…</td></tr>
              ) : forms.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">No forms yet — click "New Form" to build one.</td></tr>
              ) : (
                forms.map((f) => (
                  <tr key={f.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-4 py-3 font-medium">{f.title}</td>
                    <td className="px-4 py-3 text-muted-foreground capitalize">{f.access}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-1 rounded ${STATUS_BADGE[f.status]}`}>{f.status}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{f.fields.length}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 justify-end">
                        {f.access === "public" && f.status === "published" && f.publicSlug && (
                          <>
                            <button type="button" onClick={() => copyLink(f)} title="Copy public link" className="text-muted-foreground hover:text-foreground transition-colors">
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                            {copiedId === f.id && <span className="text-[10px] text-green-300">Copied!</span>}
                            <a href={`/apply/${f.publicSlug}`} target="_blank" rel="noreferrer noopener" title="Open public form" className="text-muted-foreground hover:text-foreground transition-colors">
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </>
                        )}
                        {f.access === "internal" && f.status === "published" && (
                          <>
                            <button type="button" onClick={() => copyLink(f)} title="Copy internal link (requires AHS login)" className="text-muted-foreground hover:text-foreground transition-colors">
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                            {copiedId === f.id && <span className="text-[10px] text-green-300">Copied!</span>}
                            <a href={`/fill-form/${f.id}`} target="_blank" rel="noreferrer noopener" title="Open internal form" className="text-muted-foreground hover:text-foreground transition-colors">
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </>
                        )}
                        {f.documentTemplate && (
                          <div className="flex items-center gap-1.5 mr-1" title={f.driveUploadEnabled ? "Drive upload is on — every submission's PDF files to the connected Google Drive" : "Drive upload is off — submissions still save, just no Drive copy"}>
                            <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
                            <Switch checked={f.driveUploadEnabled} onCheckedChange={(checked) => void handleToggleDriveUpload(f, checked)} />
                          </div>
                        )}
                        <button type="button" onClick={() => { setEditingForm(f); setBuilderOpen(true); }} title="Edit" className="text-muted-foreground hover:text-foreground transition-colors">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        {f.status === "archived" ? (
                          <button type="button" onClick={() => handleUnarchiveForm(f)} className="btn text-xs px-2 py-1">Unarchive</button>
                        ) : (
                          <button type="button" onClick={() => handleArchiveForm(f)} className="btn text-xs px-2 py-1">Archive</button>
                        )}
                        <button type="button" onClick={() => handleDeleteForm(f)} title="Delete" className="text-muted-foreground hover:text-red-400 transition-colors">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Submissions ── */}
      <div className="panel p-0 overflow-hidden">
        <div className="px-4 py-4 border-b border-white/10">
          <h2 className="font-semibold text-sm">Submissions</h2>
        </div>
        <div className="px-4 py-3 border-b border-white/10 bg-white/5 flex flex-wrap items-end gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Submitter or form…" className="glass-input text-sm py-1.5 pl-8 pr-3 rounded-md w-56" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Form</label>
            <select value={formFilter} onChange={(e) => { setFormFilter(e.target.value); setPage(1); }} className="glass-input text-sm py-1.5 px-3 rounded-md">
              <option value="">All</option>
              {forms.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Status</label>
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as any); setPage(1); }} className="glass-input text-sm py-1.5 px-3 rounded-md">
              <option value="">All</option>
              <option value="new">New</option>
              <option value="reviewed">Reviewed</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <span className="text-xs text-muted-foreground mb-1.5 ml-auto">{filteredSubmissions.length} of {submissions.length} submissions</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Submitter</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Form</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Submitted</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Document</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase"></th>
              </tr>
            </thead>
            <tbody>
              {submissionsLoading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">Loading…</td></tr>
              ) : pagedSubmissions.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">{submissions.length === 0 ? "No submissions yet." : "No submissions match these filters."}</td></tr>
              ) : (
                pagedSubmissions.map((s) => (
                  <tr key={s.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-4 py-3 font-medium">
                      <button type="button" onClick={() => void openPreview(s)} className="hover:text-blue-300 hover:underline transition cursor-pointer text-left">
                        {s.submitterName || "Someone"}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{s.formTitle || "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(s.submittedAt).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <select
                        value={s.status}
                        onChange={(e) => handleStatusChange(s, e.target.value as CustomFormSubmissionStatus)}
                        className={`text-xs font-semibold px-2 py-1 rounded border-0 ${s.status === "new" ? "bg-blue-500/20 text-blue-300" : s.status === "reviewed" ? "bg-green-500/20 text-green-300" : "bg-slate-700 text-slate-300"}`}
                      >
                        <option value="new">New</option>
                        <option value="reviewed">Reviewed</option>
                        <option value="archived">Archived</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      {formsById.get(s.formId)?.documentTemplate ? (
                        <button type="button" onClick={() => handleViewPdf(s)} disabled={viewingId === s.id} className="btn text-xs px-2.5 py-1.5 flex items-center gap-1 disabled:opacity-50">
                          {viewingId === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileDown className="h-3 w-3" />} View PDF
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground" title="This form has no document template yet — design one in Edit Form's Document Template tab.">Unavailable</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => handleDelete(s)} title="Delete this submission" className="text-muted-foreground hover:text-red-400 transition-colors">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!submissionsLoading && filteredSubmissions.length > PAGE_SIZE && (
          <div className="px-4 py-3 border-t border-white/10 flex items-center justify-center gap-1">
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="btn text-xs px-2.5 py-1.5 disabled:opacity-40">Prev</button>
            <span className="text-xs text-muted-foreground px-2">{page} / {pageCount}</span>
            <button type="button" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page === pageCount} className="btn text-xs px-2.5 py-1.5 disabled:opacity-40">Next</button>
          </div>
        )}
      </div>

      {/* ── Deleted submissions — 30-day restore window, same as Applicant Documents ── */}
      <div className="panel p-0 overflow-hidden">
        <div className="px-4 py-4 border-b border-white/10">
          <h2 className="font-semibold text-sm flex items-center gap-1.5"><Trash2 className="h-4 w-4 text-red-300" /> Deleted Submissions</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">Kept for 30 days and restorable — after that they drop off this list.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Submitter</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Form</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase">Deleted</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase"></th>
              </tr>
            </thead>
            <tbody>
              {deletedLoading ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground text-sm">Loading…</td></tr>
              ) : deleted.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground text-sm">Nothing deleted.</td></tr>
              ) : (
                deleted.map((s) => (
                  <tr key={s.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-4 py-3 font-medium">{s.submitterName || "Someone"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{s.formTitle || "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(s.deletedAt!).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => handleRestore(s)} className="btn text-xs px-2.5 py-1.5">Restore</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Submission detail modal — shows the actual generated PDF when the form has a document template (same "click the name" pattern as the Applicant Documents tab), otherwise the raw response list. ── */}
      {preview && (() => {
        const previewForm = formsById.get(preview.formId);
        const hasDocument = !!previewForm?.documentTemplate;
        return (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={closePreview}>
            <div className={`bg-slate-900 border border-white/10 rounded-lg shadow-2xl w-full flex flex-col ${hasDocument ? "max-w-6xl h-[92vh]" : "max-w-lg max-h-[85vh]"}`} onClick={(e) => e.stopPropagation()}>
              <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3">
                <h3 className="font-semibold text-sm">{preview.submitterName || "Someone"} — {preview.formTitle || "Submission"}</h3>
                <div className="flex items-center gap-2 shrink-0">
                  {hasDocument && previewPdfUrl && (
                    <a href={previewPdfUrl} target="_blank" rel="noreferrer noopener" className="btn text-xs px-2.5 py-1.5 flex items-center gap-1">
                      <FileDown className="h-3 w-3" /> Open in New Tab
                    </a>
                  )}
                  <button onClick={closePreview} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
                </div>
              </div>

              {hasDocument ? (
                <div className="flex-1 overflow-hidden bg-slate-950">
                  {previewPdfLoading ? (
                    <div className="h-full flex items-center justify-center text-sm text-muted-foreground gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Generating document…</div>
                  ) : previewPdfUrl ? (
                    <iframe src={previewPdfUrl} title="Submission document" className="w-full h-full min-h-[70vh] border-0" />
                  ) : (
                    <p className="p-8 text-center text-sm text-muted-foreground">Couldn't generate this document.</p>
                  )}
                </div>
              ) : (
                <div className="p-4 overflow-y-auto flex flex-col gap-3 text-sm">
                  {(() => {
                    const fieldById = (id: string) => previewForm?.fields.find((f) => f.id === id);
                    return Object.entries(preview.responses).map(([fieldId, value]) => {
                      const field = fieldById(fieldId);
                      return (
                        <div key={fieldId}>
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{field?.label ?? fieldId}</p>
                          {renderResponseValue(value, field)}
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
