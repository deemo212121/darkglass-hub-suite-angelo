/**
 * "Custom Forms" tab — the in-house Form Maker's home inside the HR
 * dashboard. Two halves: the form list (build/publish/archive forms, copy
 * a public form's link) and the submissions list for whichever forms have
 * been filled out — same search/filter/soft-delete UX as the Applicant
 * Documents (Jotform) tab, since this is the self-built equivalent of it.
 */
import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Copy, Search, FileText, ExternalLink, X, FileDown, Loader2, HardDrive, Download, FileSpreadsheet, PenLine, CheckCircle2, Link2, Eye } from "lucide-react";
import { CustomFormSignersModal } from "./CustomFormSignersModal";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import { auth as firebaseAuth } from "@/lib/firebase/config";
import { CustomFormBuilder } from "./CustomFormBuilder";
import { CustomFormRenderer, type CustomFormRendererValue } from "./CustomFormRenderer";
import { Switch } from "@/components/ui/switch";
import { formatFieldValue, generateSubmissionDocumentPdf } from "@/lib/documentTemplates/generate";
import { saveSubmissionDocument, submissionDocumentFileName } from "@/lib/documentTemplates/saveDocument";
import { generateSubmissionDocx } from "@/lib/documentTemplates/docx";
import { downloadSignableDocumentPdf } from "@/lib/downloadSignableDocumentPdf";
import { downloadStyledReport, type ReportSheet } from "@/lib/styledReportExport";
import type { CustomFormField } from "@/lib/formElements";
import { saveCompanyPart } from "@/lib/customFormCompletion";
import { canSignSection, inSigningOrder, isSectionsTurn, isSignerSectionComplete, sectionSigner, signerSectionName, splitSignerSections, type CurrentSigner } from "@/lib/customFormSections";
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
  companyFields,
  isAwaitingCompany,
  type CustomForm,
  type CustomFormSubmission,
  type CustomFormSubmissionStatus,
  type GoogleDriveConnectionStatus,
  type CustomFormResponseValue,
} from "@/lib/supabase/customForms";
import { getAppUrl } from "@/lib/appUrl";
import { todayISO } from "@/lib/localDate";

const PAGE_SIZE = 25;

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-slate-500/20 text-slate-300",
  published: "bg-green-500/20 text-green-300",
  archived: "bg-slate-700 text-slate-400",
};

/** A form with several company signers: the parts not signed yet (e.g. "HUMAN RESOURCES"). Empty for a single company part. */
function pendingSignerNames(form: CustomForm | undefined, submission: CustomFormSubmission): string {
  if (!form) return "";
  const sections = splitSignerSections(companyFields(form));
  return sections.length > 1 ? inSigningOrder(sections).filter((s) => !isSignerSectionComplete(s, submission.responses)).map(signerSectionName).join(", ") : "";
}

/** Fields that carry an answer (not headings/paragraphs/page markers) — the columns of an export. */
const NON_ANSWER_TYPES = new Set(["heading", "paragraph", "divider", "pageBreak", "sectionCollapse", "submitButton", "captcha", "image"]);

/** Excel sheet names: max 31 chars, none of []:*?/\, unique within the workbook. */
function sheetNameFor(title: string, used: Set<string>): string {
  const base = (title.replace(/[[\]:*?/\\]+/g, " ").trim() || "Form").slice(0, 28);
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 26)} ${i}`;
  used.add(name.toLowerCase());
  return name;
}

function exportCellText(value: CustomFormResponseValue | undefined, field: CustomFormField): string {
  if (value && typeof value === "object" && !Array.isArray(value) && "url" in value) return String((value as { url: string }).url);
  return formatFieldValue(value ?? null, field);
}

export function CustomFormsPanel() {
  const { uid, realRole, extraRoles, viewAsRole, displayName } = useAuth();

  // Who's signed in, for forms whose company parts name their signer (e.g.
  // only Justin Lee signs the CEO part, only HR the HR part). The real role —
  // a "View as" preview doesn't let anyone sign as another role.
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  useEffect(() => {
    if (!uid) return;
    getMyProfileId(uid).then(setMyProfileId).catch(() => setMyProfileId(null));
  }, [uid]);
  const me = useMemo<CurrentSigner>(
    () => ({ profileId: myProfileId, roles: [realRole, ...(viewAsRole ? [] : extraRoles)].filter((r): r is string => !!r) }),
    [myProfileId, realRole, extraRoles, viewAsRole]
  );
  /** Awaiting the company's part AND there's a part left that's this person's to sign. */
  const canComplete = (form: CustomForm | undefined, submission: CustomFormSubmission): boolean => {
    if (!form || !isAwaitingCompany(form, submission)) return false;
    const sections = splitSignerSections(companyFields(form));
    if (!sections.some(sectionSigner)) return true;
    return sections.some((sec) => !isSignerSectionComplete(sec, submission.responses) && canSignSection(sec, me) && isSectionsTurn(sec, sections, submission.responses));
  };

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
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const revokeIfBlob = (url: string | null) => { if (url?.startsWith("blob:")) URL.revokeObjectURL(url); };

  /**
   * The submission's document: the saved copy when there is one. Otherwise
   * it's rendered now (from the form's Document Template, or the automatic
   * layout when none is designed) — and if the submission is complete, that
   * render is saved too, so it's on file from then on.
   */
  const getDocumentUrl = async (submission: CustomFormSubmission): Promise<string> => {
    if (submission.pdfUrl) return submission.pdfUrl;
    const form = formsById.get(submission.formId);
    if (!form) throw new Error("This submission's form was deleted, so its document can't be built.");
    if (!isAwaitingCompany(form, submission)) {
      try {
        const { url, blob } = await saveSubmissionDocument(form, submission);
        setSubmissions((prev) => prev.map((s) => (s.id === submission.id ? { ...s, pdfUrl: url, pdfGeneratedAt: new Date().toISOString() } : s)));
        return URL.createObjectURL(blob);
      } catch (err) {
        console.error("Saving the document failed — showing it without saving:", err);
      }
    }
    return URL.createObjectURL(await generateSubmissionDocumentPdf(form, submission));
  };

  /** Clicking a submission (or View PDF) opens its document in the preview modal. */
  const openPreview = async (submission: CustomFormSubmission) => {
    setPreview(submission);
    setPreviewError(null);
    setPreviewPdfUrl((prev) => { revokeIfBlob(prev); return null; });
    setPreviewPdfLoading(true);
    try {
      setPreviewPdfUrl(await getDocumentUrl(submission));
    } catch (err) {
      console.error("Failed to build the document:", err);
      setPreviewError(err instanceof Error ? err.message : "Couldn't build this document.");
    } finally {
      setPreviewPdfLoading(false);
    }
  };

  const closePreview = () => {
    setPreview(null);
    setPreviewPdfUrl((prev) => { revokeIfBlob(prev); return null; });
  };

  const handleDownload = async (submission: CustomFormSubmission) => {
    const form = formsById.get(submission.formId);
    const fileName = form ? submissionDocumentFileName(form, submission) : `${submission.formTitle || "Submission"} - ${submission.submitterName || "Submission"}.pdf`;
    setDownloadingId(submission.id);
    setActionError(null);
    try {
      const url = await getDocumentUrl(submission);
      if (url.startsWith("blob:")) {
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      } else {
        await downloadSignableDocumentPdf(url, fileName);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't download this document.");
    } finally {
      setDownloadingId(null);
    }
  };

  const saveBlob = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  /** The submission as an editable Word document (same layout as the automatic PDF). */
  const handleDownloadWord = async (submission: CustomFormSubmission) => {
    const form = formsById.get(submission.formId);
    if (!form) { setActionError("This submission's form was deleted, so its document can't be built."); return; }
    setDownloadingId(`${submission.id}:word`);
    setActionError(null);
    try {
      saveBlob(await generateSubmissionDocx(form, submission), submissionDocumentFileName(form, submission).replace(/\.pdf$/, ".docx"));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't build the Word document.");
    } finally {
      setDownloadingId(null);
    }
  };

  /** The form itself, unfilled (default answers only) — e.g. to print and sign on paper. */
  const [exportingFormId, setExportingFormId] = useState<string | null>(null);
  const handleExportBlank = async (form: CustomForm, kind: "pdf" | "word") => {
    setExportingFormId(`${form.id}:${kind}`);
    setActionError(null);
    try {
      const responses = Object.fromEntries(form.fields.filter((fd) => fd.defaultValue !== undefined && fd.defaultValue !== "").map((fd) => [fd.id, fd.defaultValue]));
      const name = form.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Form";
      if (kind === "pdf") saveBlob(await generateSubmissionDocumentPdf(form, { responses, submittedAt: new Date().toISOString() }), `${name}.pdf`);
      else saveBlob(await generateSubmissionDocx(form, { responses }), `${name}.docx`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExportingFormId(null);
    }
  };

  // ── Complete — HR fills the form's "Filled in by: Company" fields (e.g.
  // the Authorized Representative's signature) on a submission, then the
  // finished document is saved. ──
  const [completing, setCompleting] = useState<CustomFormSubmission | null>(null);

  const handleComplete = async (values: Record<string, CustomFormRendererValue>) => {
    const submission = completing;
    const form = submission ? formsById.get(submission.formId) : undefined;
    if (!submission || !form || !uid) return;
    const myId = await getMyProfileId(uid);
    if (!myId) throw new Error("Couldn't identify your account — refresh and try again.");
    setActionNotice(null);
    const result = await saveCompanyPart(form, submission, values, myId, displayName || "Someone");
    setSubmissions((prev) => prev.map((s) => (s.id === submission.id ? result.submission : s)));
    setCompleting(null);
    if (result.waitingOn.length) setActionNotice(`Saved your part of "${submission.formTitle || "the form"}". Still waiting on: ${result.waitingOn.join(", ")}.`);
    else if (result.documentError) setActionError("Completed — but the document couldn't be saved yet. Open it with View PDF to try again.");
  };

  // ── Signing link — /complete-form/<id>, sent to whoever signs for the
  // company (e.g. the CEO) so they sign without opening HR Paperworks. ──
  const [copiedSignId, setCopiedSignId] = useState<string | null>(null);
  // ── View — who has signed a form's submissions (CustomFormSignersModal). ──
  const [viewingSignersFormId, setViewingSignersFormId] = useState<string | null>(null);
  const copySigningLink = (submission: CustomFormSubmission) => {
    navigator.clipboard.writeText(`${getAppUrl()}/complete-form/${submission.id}`);
    setCopiedSignId(submission.id);
    setTimeout(() => setCopiedSignId((id) => (id === submission.id ? null : id)), 1500);
  };

  // ── Export — the filtered submissions as a styled Excel workbook, one
  // sheet per form, one column per question. ──
  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    setExporting(true);
    setActionError(null);
    try {
      const byForm = new Map<string, CustomFormSubmission[]>();
      for (const sub of filteredSubmissions) byForm.set(sub.formId, [...(byForm.get(sub.formId) ?? []), sub]);
      const used = new Set<string>();
      const sheets: ReportSheet[] = [];
      for (const [formId, subs] of byForm) {
        const form = formsById.get(formId);
        const title = form?.title || subs[0].formTitle || "Form";
        const answerFields = (form?.fields ?? []).filter((fd) => !NON_ANSWER_TYPES.has(fd.type) && !fd.hidden);
        sheets.push({
          name: sheetNameFor(title, used),
          title,
          subtitle: `${subs.length} submission${subs.length === 1 ? "" : "s"} · exported ${new Date().toLocaleString()}`,
          columns: [
            { header: "Submitter", width: 24 },
            { header: "Submitted", width: 20 },
            { header: "Status", width: 12, align: "center" },
            ...(form && companyFields(form).length > 0 ? [{ header: "Completed by HR", width: 20 }] : []),
            ...answerFields.map((fd) => ({ header: fd.label || fd.name, width: 24, wrap: true })),
            { header: "Document", width: 40 },
          ],
          rows: subs.map((sub) => [
            sub.submitterName || "Someone",
            new Date(sub.submittedAt).toLocaleString(),
            sub.status,
            ...(form && companyFields(form).length > 0 ? [sub.completedAt ? `${new Date(sub.completedAt).toLocaleDateString()}${sub.completedByName ? ` · ${sub.completedByName}` : ""}` : "Awaiting"] : []),
            ...answerFields.map((fd) => exportCellText(sub.responses[fd.id], fd)),
            sub.pdfUrl || "",
          ]),
        });
      }
      if (sheets.length === 0) { setActionError("Nothing to export — no submissions match these filters."); return; }
      const formPart = formFilter ? formsById.get(formFilter)?.title || "Custom Forms" : "Custom Forms";
      await downloadStyledReport(`${formPart} - Submissions ${todayISO()}.xlsx`, sheets);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExporting(false);
    }
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
                        <button type="button" onClick={() => setViewingSignersFormId(f.id)} title="Who has signed this form" className="btn text-[10px] px-2 py-1 flex items-center gap-1">
                          <Eye className="h-3 w-3" /> View
                        </button>
                        <button type="button" onClick={() => void handleExportBlank(f, "pdf")} disabled={!!exportingFormId} title="Export this form (blank) as PDF" className="btn text-[10px] px-2 py-1 flex items-center gap-1 disabled:opacity-50">
                          {exportingFormId === `${f.id}:pdf` ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileDown className="h-3 w-3" />} PDF
                        </button>
                        <button type="button" onClick={() => void handleExportBlank(f, "word")} disabled={!!exportingFormId} title="Export this form (blank) as a Word document" className="btn text-[10px] px-2 py-1 flex items-center gap-1 disabled:opacity-50">
                          {exportingFormId === `${f.id}:word` ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />} Word
                        </button>
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
        <div className="px-4 py-4 border-b border-white/10 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-sm">Submissions</h2>
            <p className="text-[10px] text-muted-foreground mt-0.5">Every finished submission's document is saved here — view it, or download it as PDF or Word any time. Export gives the filtered list as Excel, one sheet per form.</p>
          </div>
          <button type="button" onClick={() => void handleExport()} disabled={exporting || filteredSubmissions.length === 0} className="btn text-xs px-3 py-1.5 flex items-center gap-1.5 shrink-0 disabled:opacity-50">
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />} Export Excel
          </button>
        </div>
        {actionError && <p className="px-4 py-2 text-xs text-red-300 bg-red-500/10 border-b border-red-500/20">{actionError}</p>}
        {actionNotice && <p className="px-4 py-2 text-xs text-green-300 bg-green-500/10 border-b border-green-500/20">{actionNotice}</p>}
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
                      {isAwaitingCompany(formsById.get(s.formId), s) && (
                        <span className="block mt-1 text-[10px] font-semibold text-orange-300" title="The company's part (e.g. Authorized Representative signature) isn't filled in yet — use Complete.">
                          Awaiting company signature{pendingSignerNames(formsById.get(s.formId), s) ? ` — ${pendingSignerNames(formsById.get(s.formId), s)}` : ""}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {canComplete(formsById.get(s.formId), s) && (
                          <button type="button" onClick={() => setCompleting(s)} className="btn text-xs px-2.5 py-1.5 flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white" title="Fill in the company's part — e.g. the Authorized Representative signature">
                            <PenLine className="h-3 w-3" /> Complete
                          </button>
                        )}
                        {isAwaitingCompany(formsById.get(s.formId), s) && (
                          <button type="button" onClick={() => copySigningLink(s)} className="btn text-xs px-2.5 py-1.5 flex items-center gap-1" title="Copy a link to send to whoever signs for the company (e.g. the CEO) — they sign their part from it, logged in, without opening HR Paperworks">
                            {copiedSignId === s.id ? <><CheckCircle2 className="h-3 w-3 text-green-400" /> Copied</> : <><Link2 className="h-3 w-3" /> Copy signing link</>}
                          </button>
                        )}
                        <button type="button" onClick={() => void openPreview(s)} className="btn text-xs px-2.5 py-1.5 flex items-center gap-1">
                          <FileDown className="h-3 w-3" /> View PDF
                        </button>
                        <button type="button" onClick={() => void handleDownload(s)} disabled={downloadingId === s.id} title="Download as PDF" className="btn text-xs px-2.5 py-1.5 flex items-center gap-1 disabled:opacity-50">
                          {downloadingId === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} PDF
                        </button>
                        <button type="button" onClick={() => void handleDownloadWord(s)} disabled={downloadingId === `${s.id}:word`} title="Download as a Word document" className="btn text-xs px-2.5 py-1.5 flex items-center gap-1 disabled:opacity-50">
                          {downloadingId === `${s.id}:word` ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />} Word
                        </button>
                        {s.pdfUrl && <span title={`Saved${s.pdfGeneratedAt ? ` ${new Date(s.pdfGeneratedAt).toLocaleString()}` : ""}`}><CheckCircle2 className="h-3.5 w-3.5 text-green-400" /></span>}
                      </div>
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
        const live = submissions.find((s) => s.id === preview.id) ?? preview;
        const awaiting = isAwaitingCompany(formsById.get(live.formId), live);
        return (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={closePreview}>
            <div className="bg-slate-900 border border-white/10 rounded-lg shadow-2xl w-full flex flex-col max-w-6xl h-[92vh]" onClick={(e) => e.stopPropagation()}>
              <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-sm">{live.submitterName || "Someone"} — {live.formTitle || "Submission"}</h3>
                  <p className="text-[10px] text-muted-foreground">
                    {awaiting ? "Awaiting company signature — not final yet" : live.pdfUrl ? "Saved document" : "Not saved yet"}
                    {live.completedAt ? ` · Completed ${new Date(live.completedAt).toLocaleString()}${live.completedByName ? ` by ${live.completedByName}` : ""}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {canComplete(formsById.get(live.formId), live) && (
                    <button type="button" onClick={() => { closePreview(); setCompleting(live); }} className="btn text-xs px-2.5 py-1.5 flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white">
                      <PenLine className="h-3 w-3" /> Complete
                    </button>
                  )}
                  <button type="button" onClick={() => void handleDownload(live)} disabled={downloadingId === live.id} className="btn text-xs px-2.5 py-1.5 flex items-center gap-1 disabled:opacity-50">
                    <Download className="h-3 w-3" /> PDF
                  </button>
                  <button type="button" onClick={() => void handleDownloadWord(live)} disabled={downloadingId === `${live.id}:word`} className="btn text-xs px-2.5 py-1.5 flex items-center gap-1 disabled:opacity-50">
                    <FileText className="h-3 w-3" /> Word
                  </button>
                  {previewPdfUrl && (
                    <a href={previewPdfUrl} target="_blank" rel="noreferrer noopener" className="btn text-xs px-2.5 py-1.5 flex items-center gap-1">
                      <FileDown className="h-3 w-3" /> Open in New Tab
                    </a>
                  )}
                  <button onClick={closePreview} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
                </div>
              </div>
              <div className="flex-1 overflow-hidden bg-slate-950">
                {previewPdfLoading ? (
                  <div className="h-full flex items-center justify-center text-sm text-muted-foreground gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Generating document…</div>
                ) : previewPdfUrl ? (
                  <iframe src={previewPdfUrl} title="Submission document" className="w-full h-full min-h-[70vh] border-0" />
                ) : (
                  <p className="p-8 text-center text-sm text-red-300">{previewError || "Couldn't generate this document."}</p>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {viewingSignersFormId && formsById.get(viewingSignersFormId) && (
        <CustomFormSignersModal
          form={formsById.get(viewingSignersFormId)!}
          submissions={submissions.filter((s) => s.formId === viewingSignersFormId)}
          onClose={() => setViewingSignersFormId(null)}
          onViewPdf={(s) => { setViewingSignersFormId(null); void openPreview(s); }}
          onCopySigningLink={copySigningLink}
          copiedSigningLinkId={copiedSignId}
        />
      )}

      {/* ── Complete — the company's part of a two-party form ── */}
      {completing && (() => {
        const form = formsById.get(completing.formId);
        return (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setCompleting(null)}>
            <div className="bg-slate-900 border border-white/10 rounded-lg shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-sm">Complete — {completing.formTitle || "Submission"}</h3>
                  <p className="text-[10px] text-muted-foreground">Submitted by {completing.submitterName || "Someone"} on {new Date(completing.submittedAt).toLocaleString()}. Fill in the company's part; the finished document is then saved.</p>
                </div>
                <button onClick={() => setCompleting(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
              </div>
              <div className="p-4 overflow-y-auto">
                {form ? (
                  <CustomFormRenderer key={completing.id} fields={form.fields} mode="company" showSubmitterPart={form.fields.some((f) => f.type === "pdfDocument")} initialValues={completing.responses} signer={me} onSubmit={(values) => handleComplete(values)} />
                ) : (
                  <p className="text-sm text-red-300">This submission's form was deleted.</p>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
