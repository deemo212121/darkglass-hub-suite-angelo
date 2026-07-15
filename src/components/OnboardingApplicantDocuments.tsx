/**
 * Onboarding Documents — Applicant View.
 *
 * Shown when HR clicks an applicant's name on the Onboarding Documents tab.
 * Two halves: a droppable document repository on the left — one drop zone
 * per required document for that applicant's role (Technician / Parts
 * Manager / Philippines each have their own list, passed in via
 * `categories`, same lists the checklist grid uses) — and Bulk Import Links
 * on the right, where HR pastes a batch of Drive links that each become a
 * draggable card. Dragging a card onto a category files it there (labeled
 * by hand, since a bare link doesn't carry a filename) and HR can also
 * upload a file by hand per category, for applicants without any Drive
 * links at all.
 */
import { useEffect, useMemo, useState } from "react";
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { ChevronLeft, Upload, Trash2, FileText, Loader2, Link as LinkIcon, X, Eye, Forward } from "lucide-react";
import {
  getOnboardingDocuments,
  addOnboardingDocument,
  deleteOnboardingDocument,
  type OnboardingDocument,
  type OnboardingDocCategory,
} from "@/lib/supabase/onboardingDocuments";
import { uploadOnboardingDocument, deleteOnboardingDocumentFile } from "@/lib/firebase/storage";
import { logActivity } from "@/lib/supabase/hrActivityLog";
import { getJotformSubmissions, type JotformSubmission } from "@/lib/supabase/jotformSubmissions";

interface Props {
  companyId: string;
  profileId: string;
  profileName: string;
  /** The required-document names for this applicant's role (e.g. Technician's "W9", "Driver's License", ...) — one drop zone per entry. */
  categories: string[];
  onBack: () => void;
}

/**
 * A pasted Google Drive share link (`/file/d/{id}/view`, `?id={id}`, etc.)
 * isn't directly embeddable — Drive has a separate `/preview` endpoint that
 * renders the full file (PDF, image, etc.) inside an iframe. Returns null
 * for anything that isn't a recognizable Drive link, so non-Drive documents
 * fall back to opening in a new tab instead of a broken embed.
 */
function getDriveEmbedUrl(url: string): string | null {
  const idMatch = url.match(/\/d\/([a-zA-Z0-9_-]{10,})/) || url.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (!idMatch) return null;
  return `https://drive.google.com/file/d/${idMatch[1]}/preview`;
}

export function OnboardingApplicantDocuments({ companyId, profileId, profileName, categories, onBack }: Props) {
  const [documents, setDocuments] = useState<OnboardingDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyCategory, setBusyCategory] = useState<OnboardingDocCategory | null>(null);

  const loadDocuments = async () => {
    setDocsLoading(true);
    try {
      setDocuments(await getOnboardingDocuments(profileId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load documents.");
    } finally {
      setDocsLoading(false);
    }
  };
  useEffect(() => { void loadDocuments(); }, [profileId]);

  const documentsByCategory = useMemo(() => {
    const map = new Map<OnboardingDocCategory, OnboardingDocument[]>();
    for (const cat of categories) map.set(cat, []);
    for (const d of documents) map.get(d.category)?.push(d);
    return map;
  }, [documents, categories]);

  const handleManualUpload = async (category: OnboardingDocCategory, file: File) => {
    setBusyCategory(category);
    try {
      const { url, fullPath } = await uploadOnboardingDocument(companyId, profileId, category, file);
      await addOnboardingDocument({
        profileId,
        category,
        fileName: file.name,
        fileUrl: url,
        storagePath: fullPath,
        source: "manual",
      });
      await loadDocuments();
      void logActivity({ action: "onboarding_document_added", targetType: "employee", targetId: profileId, targetLabel: profileName, details: { category, fileName: file.name } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload file.");
    } finally {
      setBusyCategory(null);
    }
  };

  const [linkDialogCategory, setLinkDialogCategory] = useState<OnboardingDocCategory | null>(null);
  // Set when the Add Link dialog was opened by dropping a Bulk Imported Link
  // card rather than clicking "Add Link" directly — the URL is then locked
  // (it's whatever was pasted) and, on save, that card is removed from the
  // pending list instead of staying in the inbox forever.
  const [linkDialogPendingId, setLinkDialogPendingId] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkName, setLinkName] = useState("");
  const [linkSaving, setLinkSaving] = useState(false);
  // Generic {fileName, fileUrl} rather than a full OnboardingDocument, so
  // a not-yet-filed pending link (which has neither an id nor a category
  // yet) can also be previewed before HR decides where to drop it.
  const [previewDoc, setPreviewDoc] = useState<{ fileName: string; fileUrl: string } | null>(null);

  const closeLinkDialog = () => {
    setLinkDialogCategory(null);
    setLinkDialogPendingId(null);
    setLinkUrl("");
    setLinkName("");
  };

  const handleAddLink = async () => {
    if (!linkDialogCategory || !linkUrl.trim()) return;
    setLinkSaving(true);
    try {
      await addOnboardingDocument({
        profileId,
        category: linkDialogCategory,
        fileName: linkName.trim() || "Google Drive Link",
        fileUrl: linkUrl.trim(),
        source: "manual",
      });
      await loadDocuments();
      void logActivity({ action: "onboarding_document_added", targetType: "employee", targetId: profileId, targetLabel: profileName, details: { category: linkDialogCategory, fileName: linkName.trim() || "Google Drive Link" } });
      if (linkDialogPendingId) setPendingLinks((prev) => prev.filter((l) => l.id !== linkDialogPendingId));
      closeLinkDialog();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add link.");
    } finally {
      setLinkSaving(false);
    }
  };

  // ── Bulk Import Links — paste a comma/newline-separated batch of Drive
  // links, each becomes its own draggable card (a link's URL alone doesn't
  // carry a filename, so HR labels it — either while dragging it onto a
  // category, or by discarding it if pasted by mistake). ──
  const [bulkLinksInput, setBulkLinksInput] = useState("");
  const [pendingLinks, setPendingLinks] = useState<{ id: string; url: string }[]>([]);

  const handleParseBulkLinks = () => {
    const urls = bulkLinksInput
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter((s) => /^https?:\/\//i.test(s));
    if (urls.length === 0) return;
    setPendingLinks((prev) => [
      ...prev,
      ...urls.map((url, i) => ({ id: `pendinglink:${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`, url })),
    ]);
    setBulkLinksInput("");
  };

  // Drive links use their dedicated /preview embed URL (see getDriveEmbedUrl);
  // anything else (uploaded files, Jotform-generated PDFs) renders directly
  // in the iframe as-is — browsers display PDFs inline just fine — with
  // "Open in new tab" in the modal header as a fallback if a given file
  // ever doesn't render well embedded.
  const handleOpenDocument = (doc: OnboardingDocument) => {
    setPreviewDoc(doc);
  };

  const handleDeleteDocument = async (doc: OnboardingDocument) => {
    if (!window.confirm(`Remove "${doc.fileName}" from ${doc.category}?`)) return;
    setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    try {
      await deleteOnboardingDocument(doc.id);
      if (doc.storagePath) await deleteOnboardingDocumentFile(doc.storagePath).catch(() => {});
      void logActivity({ action: "onboarding_document_deleted", targetType: "employee", targetId: profileId, targetLabel: profileName, details: { category: doc.category, fileName: doc.fileName } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove document.");
      await loadDocuments();
    }
  };

  // ── Jotform Submissions — every applicant's real Jotform-generated PDF
  // (see hr_jotform_submissions / jotformBridge.ts), filterable by name/form
  // and draggable straight into a category — unlike a Bulk Import Link, we
  // already know the applicant's name and the form title, so a drop files it
  // immediately with no "type a label" dialog needed. ──
  const [jotformSubs, setJotformSubs] = useState<JotformSubmission[]>([]);
  const [jotformSubsLoading, setJotformSubsLoading] = useState(true);
  const [jotformNameFilter, setJotformNameFilter] = useState("");
  const [jotformFormFilter, setJotformFormFilter] = useState("");
  const [filingSubmissionId, setFilingSubmissionId] = useState<string | null>(null);

  useEffect(() => {
    getJotformSubmissions()
      .then((subs) => setJotformSubs(subs.filter((s) => s.documentUrl)))
      .catch((err) => console.error("Failed to load Jotform submissions:", err))
      .finally(() => setJotformSubsLoading(false));
  }, []);

  const jotformFormOptions = useMemo(
    () => Array.from(new Set(jotformSubs.map((s) => s.formTitle || s.formId))).sort(),
    [jotformSubs]
  );
  const filteredJotformSubs = useMemo(() => {
    const q = jotformNameFilter.trim().toLowerCase();
    return jotformSubs.filter((s) => {
      if (jotformFormFilter && (s.formTitle || s.formId) !== jotformFormFilter) return false;
      if (q && !(s.applicantName ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [jotformSubs, jotformNameFilter, jotformFormFilter]);

  const handleFileJotformSubmission = async (category: OnboardingDocCategory, submission: JotformSubmission) => {
    if (!submission.documentUrl) return;
    setFilingSubmissionId(submission.id);
    try {
      const fileName = `${submission.applicantName || "Applicant"} — ${submission.formTitle || submission.formId}.pdf`;
      await addOnboardingDocument({
        profileId,
        category,
        fileName,
        fileUrl: submission.documentUrl,
        source: "jotform",
        jotformNotificationId: submission.submissionId,
      });
      await loadDocuments();
      void logActivity({ action: "onboarding_document_added", targetType: "employee", targetId: profileId, targetLabel: profileName, details: { category, fileName } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to file submission.");
    } finally {
      setFilingSubmissionId(null);
    }
  };

  // ── Bulk Upload Files — for documents that don't come through Jotform at
  // all (paper forms, emailed copies, etc.). Selecting multiple files makes
  // each one a draggable card, same as a Jotform submission — a real
  // filename is already known, so a drop files it immediately with no
  // "type a label" dialog (unlike a bare Bulk Import Link). ──
  const [pendingFiles, setPendingFiles] = useState<{ id: string; file: File }[]>([]);
  const [filingFileId, setFilingFileId] = useState<string | null>(null);

  const handleSelectBulkFiles = (files: FileList) => {
    const next = Array.from(files).map((file, i) => ({
      id: `bulkfile:${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
      file,
    }));
    setPendingFiles((prev) => [...prev, ...next]);
  };

  const handleFileBulkUpload = async (category: OnboardingDocCategory, pending: { id: string; file: File }) => {
    setFilingFileId(pending.id);
    try {
      const { url, fullPath } = await uploadOnboardingDocument(companyId, profileId, category, pending.file);
      await addOnboardingDocument({
        profileId,
        category,
        fileName: pending.file.name,
        fileUrl: url,
        storagePath: fullPath,
        source: "manual",
      });
      await loadDocuments();
      setPendingFiles((prev) => prev.filter((f) => f.id !== pending.id));
      void logActivity({ action: "onboarding_document_added", targetType: "employee", targetId: profileId, targetLabel: profileName, details: { category, fileName: pending.file.name } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload file.");
    } finally {
      setFilingFileId(null);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const category = over.id as OnboardingDocCategory;

    const activeId = String(active.id);
    if (activeId.startsWith("jotform:")) {
      const submission = jotformSubs.find((s) => `jotform:${s.id}` === activeId);
      if (submission) void handleFileJotformSubmission(category, submission);
      return;
    }
    if (activeId.startsWith("bulkfile:")) {
      const pending = pendingFiles.find((f) => f.id === activeId);
      if (pending) void handleFileBulkUpload(category, pending);
      return;
    }

    const link = pendingLinks.find((l) => l.id === active.id);
    if (!link) return;
    // No filename to go on for a bare link — open Add Link pre-filled with
    // this URL and the target category, so HR only has to type a label.
    setLinkDialogCategory(category);
    setLinkDialogPendingId(link.id);
    setLinkUrl(link.url);
    setLinkName("");
  };

  return (
    <div className="panel p-0 overflow-hidden">
      <div className="px-4 py-4 border-b border-white/10 flex items-center gap-3">
        <button type="button" onClick={onBack} className="btn text-xs px-2.5 py-1.5 flex items-center gap-1">
          <ChevronLeft className="h-3.5 w-3.5" /> Back
        </button>
        <div>
          <h2 className="font-semibold text-sm">{profileName}'s Documents</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">Drag an imported link into a category, or upload a file directly.</p>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-center justify-between gap-2">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-300 hover:text-red-200">✕</button>
        </div>
      )}

      <DndContext onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-4">
          {/* ── Document repository ── */}
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
            {categories.map((category) => (
              <CategoryDropZone
                key={category}
                category={category}
                documents={documentsByCategory.get(category) ?? []}
                busy={busyCategory === category}
                loading={docsLoading}
                onUpload={(file) => handleManualUpload(category, file)}
                onDelete={handleDeleteDocument}
                onAddLink={() => setLinkDialogCategory(category)}
                onOpenDocument={handleOpenDocument}
              />
            ))}
          </div>

          {/* ── Right column: Jotform Submissions + Bulk Import Links, stacked ── */}
          <div className="flex flex-col gap-4 lg:sticky lg:top-4 self-start">
          {/* Every applicant's real Jotform-generated document, filterable by name/form, draggable straight into a category. */}
          <div className="panel p-3">
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><Forward className="h-3.5 w-3.5 text-blue-300" /> Jotform Submissions</h3>
            <div className="flex flex-col gap-1.5 mb-2">
              <input
                type="text"
                value={jotformNameFilter}
                onChange={(e) => setJotformNameFilter(e.target.value)}
                placeholder="Filter by name…"
                className="glass-input text-xs py-1.5 px-2 rounded-md w-full"
              />
              <select
                value={jotformFormFilter}
                onChange={(e) => setJotformFormFilter(e.target.value)}
                className="glass-input text-xs py-1.5 px-2 rounded-md w-full"
              >
                <option value="">All forms</option>
                {jotformFormOptions.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            {jotformSubsLoading ? (
              <p className="text-xs text-muted-foreground text-center py-6 flex items-center justify-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</p>
            ) : filteredJotformSubs.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">{jotformSubs.length === 0 ? "No submissions yet." : "No submissions match these filters."}</p>
            ) : (
              <div className="flex flex-col gap-1.5 max-h-[50vh] overflow-y-auto mb-3">
                {filteredJotformSubs.map((s) => (
                  <DraggableJotformSubmission
                    key={s.id}
                    submission={s}
                    filing={filingSubmissionId === s.id}
                    onPreview={() => setPreviewDoc({ fileName: `${s.applicantName || "Applicant"} — ${s.formTitle || s.formId}`, fileUrl: s.documentUrl! })}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Bulk Upload Files — for documents that don't come through Jotform at all (paper forms, emailed copies, etc.). Select several at once, each becomes its own draggable card below. */}
          <div className="panel p-3">
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><Upload className="h-3.5 w-3.5 text-cyan-300" /> Bulk Upload Files</h3>
            <label className="btn text-xs px-3 py-1.5 w-full mb-2 flex items-center justify-center gap-1.5 cursor-pointer">
              <Upload className="h-3.5 w-3.5" /> Select Files
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) handleSelectBulkFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            {pendingFiles.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">No pending files yet.</p>
            ) : (
              <div className="flex flex-col gap-1.5 max-h-[50vh] overflow-y-auto mb-3">
                {pendingFiles.map((f) => (
                  <DraggablePendingFile
                    key={f.id}
                    pending={f}
                    filing={filingFileId === f.id}
                    onDiscard={() => setPendingFiles((prev) => prev.filter((x) => x.id !== f.id))}
                    onPreview={() => setPreviewDoc({ fileName: f.file.name, fileUrl: URL.createObjectURL(f.file) })}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Bulk Import Links — paste a batch of Drive links (comma or newline separated), each becomes its own draggable card below. */}
          <div className="panel p-3">
            <h3 className="text-sm font-semibold mb-2">Bulk Import Links</h3>
            <textarea
              value={bulkLinksInput}
              onChange={(e) => setBulkLinksInput(e.target.value)}
              placeholder="Paste Google Drive links, separated by commas or new lines…"
              rows={3}
              className="glass-input text-xs py-1.5 px-2 rounded-md w-full mb-2 resize-y"
            />
            <button
              type="button"
              onClick={handleParseBulkLinks}
              disabled={!bulkLinksInput.trim()}
              className="btn text-xs px-3 py-1.5 w-full mb-2 disabled:opacity-50"
            >
              Parse Links
            </button>
            {pendingLinks.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">No pending links yet.</p>
            ) : (
              <div className="flex flex-col gap-1.5 max-h-[70vh] overflow-y-auto">
                {pendingLinks.map((link) => (
                  <DraggablePendingLink
                    key={link.id}
                    link={link}
                    onDiscard={() => setPendingLinks((prev) => prev.filter((l) => l.id !== link.id))}
                    onPreview={() => setPreviewDoc({ fileName: link.url, fileUrl: link.url })}
                  />
                ))}
              </div>
            )}
          </div>
          </div>
        </div>
      </DndContext>

      {/* Add a Google Drive (or any external) link instead of uploading a file */}
      {linkDialogCategory && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-lg p-6 max-w-sm w-full">
            <h3 className="text-lg font-bold mb-2">Add Link</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Paste a Google Drive (or other) share link for <span className="font-semibold text-white">{linkDialogCategory}</span>.
            </p>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Link URL</label>
            <input
              type="text"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://drive.google.com/file/d/…"
              readOnly={!!linkDialogPendingId}
              className={`glass-input text-sm py-1.5 px-3 rounded-md w-full mt-1 mb-3 ${linkDialogPendingId ? "opacity-70" : ""}`}
            />
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Label{linkDialogPendingId ? "" : " (optional)"}</label>
            <input
              type="text"
              value={linkName}
              onChange={(e) => setLinkName(e.target.value)}
              placeholder="e.g. Signed Contract"
              autoFocus={!!linkDialogPendingId}
              className="glass-input text-sm py-1.5 px-3 rounded-md w-full mt-1 mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={closeLinkDialog} className="btn text-sm px-4 py-2">Cancel</button>
              <button
                onClick={handleAddLink}
                disabled={!linkUrl.trim() || linkSaving}
                className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
              >
                {linkSaving ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inline preview — full document in an iframe instead of a new tab. Click the backdrop or the X to close. */}
      {previewDoc && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setPreviewDoc(null)}>
          <div className="bg-slate-800 border border-white/10 rounded-lg w-full max-w-4xl h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <p className="text-sm font-semibold truncate">{previewDoc.fileName}</p>
              <div className="flex items-center gap-2">
                <a href={previewDoc.fileUrl} target="_blank" rel="noreferrer noopener" className="btn text-xs px-2.5 py-1.5">Open in new tab</a>
                <button onClick={() => setPreviewDoc(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <iframe
              src={getDriveEmbedUrl(previewDoc.fileUrl) ?? previewDoc.fileUrl}
              className="flex-1 w-full rounded-b-lg bg-white"
              title={previewDoc.fileName}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryDropZone({
  category,
  documents,
  busy,
  loading,
  onUpload,
  onDelete,
  onAddLink,
  onOpenDocument,
}: {
  category: OnboardingDocCategory;
  documents: OnboardingDocument[];
  busy: boolean;
  loading: boolean;
  onUpload: (file: File) => void;
  onDelete: (doc: OnboardingDocument) => void;
  onAddLink: () => void;
  onOpenDocument: (doc: OnboardingDocument) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: category });
  const inputId = `onboarding-upload-${category.replace(/[^a-zA-Z0-9]+/g, "-")}`;

  return (
    <div
      ref={setNodeRef}
      className={`panel p-2 border-2 border-dashed transition-colors ${isOver ? "border-blue-400 bg-blue-500/10" : "border-white/10"}`}
    >
      <div className="flex items-center justify-between mb-1.5 gap-1.5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground truncate">{category}</h4>
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" onClick={onAddLink} disabled={busy} className="btn text-[10px] px-1.5 py-1 flex items-center gap-1 disabled:opacity-50">
            <LinkIcon className="h-3 w-3" /> Add Link
          </button>
          <label htmlFor={inputId} className={`btn text-[10px] px-1.5 py-1 flex items-center gap-1 cursor-pointer ${busy ? "opacity-50 pointer-events-none" : ""}`}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />} Upload File
          </label>
        </div>
        <input
          id={inputId}
          type="file"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = "";
          }}
        />
      </div>
      <div className="flex flex-col gap-1.5 min-h-[44px] max-h-40 overflow-y-auto pr-0.5">
        {loading ? (
          <p className="text-[11px] text-muted-foreground">Loading…</p>
        ) : documents.length === 0 ? (
          <p className="text-[11px] text-muted-foreground italic">Drop a submission, upload a file, or add a link.</p>
        ) : (
          documents.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between gap-2 bg-white/5 rounded px-1.5 py-1">
              <button type="button" onClick={() => onOpenDocument(doc)} className="flex items-center gap-1.5 text-xs text-blue-300 hover:text-blue-200 truncate min-w-0 text-left">
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{doc.fileName}</span>
              </button>
              <button type="button" onClick={() => onDelete(doc)} className="text-muted-foreground hover:text-red-300 shrink-0">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * A single bulk-imported link, not yet filed into any category. The URL
 * alone doesn't reveal what the file actually is, so a Preview button opens
 * it (Drive links render inline, same as filed documents) before HR decides
 * where to drag it — plus a discard button for links pasted by mistake.
 */
function DraggablePendingLink({ link, onDiscard, onPreview }: { link: { id: string; url: string }; onDiscard: () => void; onPreview: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: link.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-md border border-white/10 bg-white/5 px-2.5 py-2 flex items-center justify-between gap-2 ${isDragging ? "opacity-50" : ""}`}
    >
      <div {...listeners} {...attributes} className="flex items-center gap-1.5 min-w-0 flex-1 cursor-grab active:cursor-grabbing">
        <LinkIcon className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
        <span className="text-xs truncate">{link.url}</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button type="button" onClick={onPreview} title="Preview this link" className="text-muted-foreground hover:text-blue-300">
          <Eye className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={onDiscard} title="Discard this link" className="text-muted-foreground hover:text-red-300">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * A real Jotform submission with its generated document already known —
 * unlike DraggablePendingLink, a drop files it immediately (applicant name
 * + form title are already real data, no label to type).
 */
function DraggableJotformSubmission({
  submission,
  filing,
  onPreview,
}: {
  submission: JotformSubmission;
  filing: boolean;
  onPreview: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `jotform:${submission.id}`, disabled: filing });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-md border border-white/10 bg-white/5 px-2.5 py-2 flex items-center justify-between gap-2 ${isDragging ? "opacity-50" : ""} ${filing ? "opacity-60" : ""}`}
    >
      <div {...listeners} {...attributes} className={`flex items-center gap-1.5 min-w-0 flex-1 ${filing ? "cursor-wait" : "cursor-grab active:cursor-grabbing"}`}>
        {filing ? <Loader2 className="h-3.5 w-3.5 shrink-0 text-blue-300 animate-spin" /> : <Forward className="h-3.5 w-3.5 shrink-0 text-blue-300" />}
        <div className="min-w-0">
          <p className="text-xs truncate">{submission.applicantName || "Applicant"}</p>
          <p className="text-[10px] text-muted-foreground truncate">{submission.formTitle || submission.formId}</p>
        </div>
      </div>
      <button type="button" onClick={onPreview} title="Preview this document" className="text-muted-foreground hover:text-blue-300 shrink-0">
        <Eye className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * A locally-selected file not yet filed into any category — for documents
 * that don't come through Jotform at all. Its real filename is already
 * known, so like a Jotform submission (and unlike a bare Bulk Import Link)
 * a drop files it immediately, no label to type.
 */
function DraggablePendingFile({
  pending,
  filing,
  onDiscard,
  onPreview,
}: {
  pending: { id: string; file: File };
  filing: boolean;
  onDiscard: () => void;
  onPreview: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: pending.id, disabled: filing });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-md border border-white/10 bg-white/5 px-2.5 py-2 flex items-center justify-between gap-2 ${isDragging ? "opacity-50" : ""} ${filing ? "opacity-60" : ""}`}
    >
      <div {...listeners} {...attributes} className={`flex items-center gap-1.5 min-w-0 flex-1 ${filing ? "cursor-wait" : "cursor-grab active:cursor-grabbing"}`}>
        {filing ? <Loader2 className="h-3.5 w-3.5 shrink-0 text-cyan-300 animate-spin" /> : <FileText className="h-3.5 w-3.5 shrink-0 text-cyan-300" />}
        <span className="text-xs truncate">{pending.file.name}</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button type="button" onClick={onPreview} title="Preview this file" className="text-muted-foreground hover:text-blue-300">
          <Eye className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={onDiscard} title="Discard this file" className="text-muted-foreground hover:text-red-300">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
