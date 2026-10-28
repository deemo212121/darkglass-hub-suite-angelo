/**
 * Admin → Errors & Improvements: the running list of what needs doing —
 * errors to fix, improvements, to-dos. Every item shows who added it and
 * when, who's handling it, and its pictures / files, and has its own
 * Confirm button (records who confirmed it and when; Undo reopens it),
 * which needs someone handling it first.
 * Add / edit / delete in place; filter by Open / Confirmed, by kind and by
 * who's handling it; search. "Download for Google Docs" saves it as a .docx
 * (pictures included) that opens in Google Docs or Word.
 *
 * Stored in admin_errors_improvements (migration 0409; Handled by and
 * attachments 0411) — Admin / SuperAdmin only, same as the Admin module
 * gate. IT (main or extra role) gives an item to one of the IT people once
 * it's on the list — from its card, or in Edit — not while adding it;
 * whoever's given it gets a notification. Everyone else sees who's
 * handling it but can't change it. (An IT person also needs Admin or
 * SuperAdmin to open the page.) Pictures can be picked, dropped in, or pasted
 * (Ctrl+V a screenshot); big photos are shrunk before upload.
 */
import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Check, ChevronLeft, ChevronRight, Download, ExternalLink, FileText, Loader2, Paperclip, Pencil, Plus, RotateCcw, Search, Trash2, UserRound, X } from "lucide-react";
import { useSmartBack } from "@/hooks/useSmartBack";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { getActiveCompanyUsers, getMyProfileAndCompanyIds } from "@/lib/supabase/users";
import {
  addErrorImprovement,
  deleteErrorImprovement,
  listErrorsImprovements,
  setErrorImprovementConfirmed,
  updateErrorImprovement,
  type ErrorImprovementAttachment,
  type ErrorImprovementItem,
  type ErrorImprovementKind,
} from "@/lib/supabase/errorsImprovements";
import { deleteAttachmentByUrl, uploadErrorImprovementAttachment } from "@/lib/firebase/storage";
import { compressImage } from "@/lib/imageCompression";
import { createNotification } from "@/lib/supabase/notifications";
import { InlinePdfModal } from "@/components/InlinePdfViewer";
import { todayISO } from "@/lib/localDate";
import { randomUuid } from "@/lib/utils";

const KINDS: { id: ErrorImprovementKind; label: string; badge: string }[] = [
  { id: "error", label: "Error", badge: "border-red-500/40 bg-red-500/15 text-red-300" },
  { id: "improvement", label: "Improvement", badge: "border-sky-500/40 bg-sky-500/15 text-sky-300" },
  { id: "todo", label: "To do", badge: "border-amber-500/40 bg-amber-500/15 text-amber-300" },
];
const kindMeta = (k: ErrorImprovementKind) => KINDS.find((x) => x.id === k) ?? KINDS[0];

const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/** Same cap as storage.rules and the upload fallback. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Photos above this (and every HEIC) are shrunk before upload; smaller ones — mostly screenshots — stay as they are, so their text stays sharp. */
const COMPRESS_ABOVE_BYTES = 1.5 * 1024 * 1024;

const isHeic = (name: string) => /\.(heic|heif)$/i.test(name);
const isImage = (type: string, name = "") => type.startsWith("image/") || isHeic(name);
const isPdf = (a: ErrorImprovementAttachment) => a.type === "application/pdf" || /\.pdf$/i.test(a.name);

interface Person {
  id: string;
  name: string;
}

interface Draft {
  kind: ErrorImprovementKind;
  area: string;
  title: string;
  details: string;
  assignedTo: string | null;
  /** Attachments already saved on the item that are being kept. */
  attachments: ErrorImprovementAttachment[];
}
const EMPTY_DRAFT: Draft = { kind: "error", area: "", title: "", details: "", assignedTo: null, attachments: [] };
const draftOf = (i: ErrorImprovementItem): Draft => ({ kind: i.kind, area: i.area, title: i.title, details: i.details, assignedTo: i.assignedTo, attachments: i.attachments });

interface PendingFile {
  key: string;
  file: File;
  preview: string | null;
}

const labelCls = "mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500";
const inputCls = "w-full rounded-md border border-white/15 bg-slate-900/60 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500";

/** The "Handled by" options — the IT people, plus whoever an item already names (e.g. someone since deactivated or no longer IT). */
function HandledBySelect({ value, valueName, people, myProfileId, onChange, className, disabled }: {
  value: string | null;
  valueName?: string | null;
  people: Person[];
  myProfileId: string | null;
  onChange: (id: string | null) => void;
  className: string;
  disabled?: boolean;
}) {
  const options = value && !people.some((p) => p.id === value) ? [{ id: value, name: valueName || "Someone no longer listed" }, ...people] : people;
  return (
    <select value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value || null)} className={className}>
      <option value="">— Not assigned —</option>
      {options.map((p) => (
        <option key={p.id} value={p.id}>{p.name}{p.id === myProfileId ? " (me)" : ""}</option>
      ))}
    </select>
  );
}

function ItemForm({ initial, showHandledBy, initialAssigneeName, people, myProfileId, saving, savingLabel, onSave, onCancel }: {
  initial: Draft;
  /** Off for a new item — it's given to someone once it's on the list. */
  showHandledBy: boolean;
  initialAssigneeName?: string | null;
  people: Person[];
  myProfileId: string | null;
  saving: boolean;
  savingLabel: string | null;
  onSave: (d: Draft, files: File[]) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  // Previews are object URLs — free them when the form closes.
  useEffect(() => () => pendingRef.current.forEach((p) => p.preview && URL.revokeObjectURL(p.preview)), []);

  const addFiles = (list: File[]) => {
    const tooBig = list.filter((f) => f.size > MAX_FILE_BYTES);
    setFileError(tooBig.length ? `Too big (25 MB max): ${tooBig.map((f) => f.name).join(", ")}` : null);
    const ok = list.filter((f) => f.size <= MAX_FILE_BYTES);
    if (!ok.length) return;
    setPending((cur) => [
      ...cur,
      ...ok.map((file) => ({
        key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        // HEIC can't be shown by the browser until it's converted on upload.
        preview: file.type.startsWith("image/") && !isHeic(file.name) ? URL.createObjectURL(file) : null,
      })),
    ]);
  };
  const removePending = (key: string) =>
    setPending((cur) => {
      const gone = cur.find((p) => p.key === key);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return cur.filter((p) => p.key !== key);
    });

  // Ctrl+V a screenshot anywhere in the form. Text pasted into a box is left
  // alone — a copy from Excel or Word carries a picture of it too.
  const onPaste = (e: ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (!files.length) return;
    const tag = (e.target as HTMLElement).tagName;
    if ((tag === "INPUT" || tag === "TEXTAREA") && e.clipboardData.types.includes("text/plain")) return;
    e.preventDefault();
    const stamp = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }).replace(/:/g, ".");
    addFiles(files.map((f, n) => (f.name && f.name !== "image.png" ? f : new File([f], `Pasted image ${stamp}${files.length > 1 ? ` (${n + 1})` : ""}.${(f.type.split("/")[1] || "png").replace("jpeg", "jpg")}`, { type: f.type }))));
  };

  const thumb = "relative h-20 w-20 shrink-0 overflow-hidden rounded-md border border-white/15 bg-slate-900/60";
  const removeBtn = "absolute right-0.5 top-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white hover:bg-red-600";

  return (
    <div
      className={`space-y-3 rounded-md ${dragging ? "outline outline-2 outline-dashed outline-blue-500/60" : ""}`}
      onPaste={onPaste}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
        <div>
          <label className={labelCls}>Type</label>
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
          <label className={labelCls}>Area / page</label>
          <input value={draft.area} onChange={(e) => setDraft({ ...draft, area: e.target.value })} placeholder="e.g. HR → Training List" className={inputCls} />
        </div>
      </div>
      <div>
        <label className={labelCls}>What needs doing</label>
        <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Short summary" className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>Details</label>
        <textarea value={draft.details} onChange={(e) => setDraft({ ...draft, details: e.target.value })} rows={3} placeholder="Steps, examples, ticket numbers…" className={`${inputCls} resize-y`} />
      </div>
      <div className={showHandledBy ? "grid gap-3 sm:grid-cols-[minmax(0,18rem)_1fr]" : ""}>
        {showHandledBy && (
          <div>
            <label className={labelCls}>Handled by</label>
            <HandledBySelect
              value={draft.assignedTo}
              valueName={initialAssigneeName}
              people={people}
              myProfileId={myProfileId}
              onChange={(assignedTo) => setDraft({ ...draft, assignedTo })}
              className={inputCls}
            />
            <p className="mt-1 text-[10px] text-slate-500">They get a notification. IT people are listed.</p>
          </div>
        )}
        <div>
          <label className={labelCls}>Pictures &amp; files</label>
          <div className="flex flex-wrap items-start gap-2">
            {draft.attachments.map((a) => (
              <div key={a.url} className={thumb} title={a.name}>
                {isImage(a.type, a.name) ? (
                  <img src={a.url} alt={a.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-1 text-center text-[9px] leading-tight text-slate-300"><FileText className="h-5 w-5" /><span className="line-clamp-2 break-all">{a.name}</span></div>
                )}
                <button type="button" aria-label={`Remove ${a.name}`} onClick={() => setDraft({ ...draft, attachments: draft.attachments.filter((x) => x.url !== a.url) })} className={removeBtn}><X className="h-3 w-3" /></button>
              </div>
            ))}
            {pending.map((p) => (
              <div key={p.key} className={thumb} title={p.file.name}>
                {p.preview ? (
                  <img src={p.preview} alt={p.file.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-1 text-center text-[9px] leading-tight text-slate-300"><FileText className="h-5 w-5" /><span className="line-clamp-2 break-all">{p.file.name}</span></div>
                )}
                <button type="button" aria-label={`Remove ${p.file.name}`} onClick={() => removePending(p.key)} className={removeBtn}><X className="h-3 w-3" /></button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-white/20 text-[10px] text-slate-400 hover:border-blue-500/60 hover:text-white"
            >
              <Paperclip className="h-4 w-4" /> Add
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </div>
          <p className="mt-1 text-[10px] text-slate-500">Pick files, drag them here, or paste a screenshot (Ctrl+V). 25 MB each.</p>
          {fileError && <p className="mt-1 text-[11px] text-red-300">{fileError}</p>}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn text-sm px-3 py-1.5">Cancel</button>
        <button
          type="button"
          disabled={saving || !draft.title.trim()}
          onClick={() => onSave(draft, pending.map((p) => p.file))}
          className="btn text-sm px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 flex items-center gap-1.5"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {saving && savingLabel ? savingLabel : "Save"}
        </button>
      </div>
    </div>
  );
}

/** Full-size picture viewer for an item's pictures, with previous / next. */
function PictureViewer({ pictures, start, onClose }: { pictures: ErrorImprovementAttachment[]; start: number; onClose: () => void }) {
  const [index, setIndex] = useState(start);
  const pic = pictures[index];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, pictures.length - 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pictures.length]);
  if (!pic) return null;
  const nav = "absolute top-1/2 -translate-y-1/2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 disabled:opacity-30";
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/85" onClick={onClose}>
      <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-slate-900 px-4 py-3" onClick={(e) => e.stopPropagation()}>
        <p className="truncate text-sm font-semibold">{pic.name}{pictures.length > 1 ? ` · ${index + 1} of ${pictures.length}` : ""}</p>
        <div className="flex shrink-0 items-center gap-2">
          <a href={pic.url} target="_blank" rel="noopener noreferrer" className="btn flex items-center gap-1 px-2.5 py-1.5 text-xs"><ExternalLink className="h-3.5 w-3.5" /> Open original</a>
          <button type="button" onClick={onClose} className="btn flex items-center gap-1 px-2.5 py-1.5 text-xs" aria-label="Close"><X className="h-3.5 w-3.5" /> Close</button>
        </div>
      </div>
      <div className="relative flex flex-1 items-center justify-center overflow-hidden p-3">
        <img src={pic.url} alt={pic.name} className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
        {pictures.length > 1 && (
          <>
            <button type="button" disabled={index === 0} onClick={(e) => { e.stopPropagation(); setIndex(index - 1); }} className={`${nav} left-3`} aria-label="Previous"><ChevronLeft className="h-5 w-5" /></button>
            <button type="button" disabled={index === pictures.length - 1} onClick={(e) => { e.stopPropagation(); setIndex(index + 1); }} className={`${nav} right-3`} aria-label="Next"><ChevronRight className="h-5 w-5" /></button>
          </>
        )}
      </div>
    </div>
  );
}

/** Shrinks a big photo (and converts HEIC) before upload, then stores it under the item's folder. */
async function uploadAttachment(companyId: string, itemId: string, file: File): Promise<ErrorImprovementAttachment> {
  let blob: Blob = file;
  let name = file.name || "file";
  if (isImage(file.type, file.name) && !/gif|svg/.test(file.type) && (isHeic(file.name) || file.size > COMPRESS_ABOVE_BYTES)) {
    try {
      const c = await compressImage(file);
      blob = c.blob;
      name = `${name.replace(/\.[^.]+$/, "")}.${c.mimeType === "image/webp" ? "webp" : "jpg"}`;
    } catch {
      /* couldn't shrink it — upload the original */
    }
  }
  const { url, fullPath } = await uploadErrorImprovementAttachment(companyId, itemId, blob, name);
  return { url, path: fullPath, name, type: blob.type || file.type || "application/octet-stream", size: blob.size };
}

export function ErrorsImprovementsPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const { uid, companyId, displayName, role, extraRoles } = useAuth();
  // Only IT chooses who handles an item (also enforced by migration 0411's trigger).
  const canAssign = [role, ...extraRoles].includes("IT");
  const [profileId, setProfileId] = useState<string | null>(null);
  // The company's uuid for the row's company_id — useAuth's companyId can be
  // the legacy code ("COMP001"), which only names the storage folder.
  const [companyUuid, setCompanyUuid] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [items, setItems] = useState<ErrorImprovementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusTab, setStatusTab] = useState<"open" | "confirmed" | "all">("open");
  const [kindFilter, setKindFilter] = useState<ErrorImprovementKind | "">("");
  const [handlerFilter, setHandlerFilter] = useState<string>(""); // "" all, "me", "none", or a profile id
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [savingLabel, setSavingLabel] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [viewer, setViewer] = useState<{ pictures: ErrorImprovementAttachment[]; start: number } | null>(null);
  const [pdfView, setPdfView] = useState<ErrorImprovementAttachment | null>(null);

  useEffect(() => {
    if (!uid) return;
    void getMyProfileAndCompanyIds(uid).then((ids) => {
      setProfileId(ids?.profileId ?? null);
      setCompanyUuid(ids?.companyId ?? null);
    });
  }, [uid]);

  // Handled by: IT people (main or extra role).
  useEffect(() => {
    getActiveCompanyUsers()
      .then((rows) =>
        setPeople(
          rows
            .filter((p) => [p.role, ...(p.extra_roles ?? [])].includes("IT"))
            .map((p) => ({ id: p.id, name: p.display_name || p.email }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        ),
      )
      .catch(() => setPeople([]));
  }, []);

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
      setSavingLabel(null);
    }
  };
  const replace = (next: ErrorImprovementItem) => setItems((cur) => cur.map((i) => (i.id === next.id ? next : i)));
  const nameOf = (id: string | null) => (id ? people.find((p) => p.id === id)?.name ?? null : null);

  /**
   * Uploads the new files into the item's folder, then saves the row (a new
   * item gets its id here first). Files uploaded for a save that then fails
   * are removed again; files taken off an item are removed after it saves.
   * A newly given Handled by (someone other than me) is notified.
   */
  const saveItem = async (existing: ErrorImprovementItem | null, d: Draft, files: File[]): Promise<ErrorImprovementItem> => {
    if (!companyId || (!existing && !companyUuid)) throw new Error("Your account is still loading — try Save again in a moment.");
    const id = existing?.id ?? randomUuid();
    const uploaded: ErrorImprovementAttachment[] = [];
    let saved: ErrorImprovementItem;
    try {
      for (const [n, file] of files.entries()) {
        setSavingLabel(files.length > 1 ? `Uploading ${n + 1} of ${files.length}…` : "Uploading…");
        uploaded.push(await uploadAttachment(companyId, id, file));
      }
      setSavingLabel("Saving…");
      const assignedToName = d.assignedTo ? nameOf(d.assignedTo) ?? (d.assignedTo === existing?.assignedTo ? existing?.assignedToName ?? null : null) : null;
      const input = { ...d, assignedToName, attachments: [...d.attachments, ...uploaded] };
      saved = existing ? await updateErrorImprovement(id, input) : await addErrorImprovement(id, input, { companyId: companyUuid!, ...me });
    } catch (err) {
      for (const a of uploaded) void deleteAttachmentByUrl(a.path).catch(() => {});
      throw err;
    }
    for (const a of existing?.attachments ?? []) {
      if (!saved.attachments.some((k) => k.url === a.url)) void deleteAttachmentByUrl(a.path || a.url).catch(() => {});
    }
    if (saved.assignedTo && saved.assignedTo !== existing?.assignedTo && saved.assignedTo !== profileId) {
      createNotification({
        recipientId: saved.assignedTo,
        senderId: profileId,
        senderName: me.name,
        body: `${me.name} gave you ${existing ? "an item" : "a new item"} on Errors & Improvements: "${saved.title}"`,
        linkTo: `/m/${mod.slug}/${sub.slug}`,
      }).catch((err) => console.error("Errors & Improvements: couldn't notify the person handling it:", err));
    }
    return saved;
  };

  const counts = useMemo(
    () => ({ open: items.filter((i) => !i.confirmedAt).length, confirmed: items.filter((i) => i.confirmedAt).length, all: items.length }),
    [items],
  );
  // People named on items but not in the list (e.g. since deactivated), for the filter.
  const handlerOptions = useMemo(() => {
    const extra = new Map<string, string>();
    for (const i of items) if (i.assignedTo && !people.some((p) => p.id === i.assignedTo)) extra.set(i.assignedTo, i.assignedToName || "Someone no longer listed");
    return [...people, ...[...extra].map(([id, name]) => ({ id, name }))];
  }, [items, people]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter((i) => (statusTab === "all" ? true : statusTab === "open" ? !i.confirmedAt : !!i.confirmedAt))
      .filter((i) => !kindFilter || i.kind === kindFilter)
      .filter((i) => !handlerFilter || (handlerFilter === "none" ? !i.assignedTo : handlerFilter === "me" ? !!profileId && i.assignedTo === profileId : i.assignedTo === handlerFilter))
      .filter((i) => !q || [i.title, i.details, i.area, i.addedByName, i.assignedToName ?? "", i.confirmedByName ?? ""].some((t) => t.toLowerCase().includes(q)))
      .sort((a, b) => Number(!!a.confirmedAt) - Number(!!b.confirmedAt) || a.createdAt.localeCompare(b.createdAt));
  }, [items, statusTab, kindFilter, handlerFilter, profileId, search]);

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

  const selectCls = "rounded-lg border border-white/15 bg-slate-900/60 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500";

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1200px] mx-auto w-full px-4 sm:px-6 py-8">
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <button type="button" onClick={goBack} className="btn hover:bg-white/15" aria-label="Back"><ChevronLeft className="h-4 w-4" /></button>
          <div className="flex-1 min-w-[14rem]">
            <h1 className="text-2xl font-bold">{sub.title}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              What needs doing — errors, improvements and to-dos. Each shows who added it and who's handling it; Confirm it once it's done.
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
              showHandledBy={false}
              people={people}
              myProfileId={profileId}
              saving={busyId === "new"}
              savingLabel={savingLabel}
              onCancel={() => setAdding(false)}
              onSave={(d, files) =>
                void run("new", async () => {
                  const created = await saveItem(null, d, files);
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
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as ErrorImprovementKind | "")} className={selectCls}>
            <option value="">All types</option>
            {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}s</option>)}
          </select>
          <select value={handlerFilter} onChange={(e) => setHandlerFilter(e.target.value)} className={selectCls}>
            <option value="">Anyone handling</option>
            <option value="me">Handled by me</option>
            <option value="none">Not assigned</option>
            {handlerOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
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
              {items.length === 0 ? "Nothing on the list yet — use Add item." : statusTab === "open" && !kindFilter && !handlerFilter && !search.trim() ? "Nothing open — everything here is confirmed." : "Nothing matches."}
            </div>
          ) : (
            visible.map((item) => {
              const meta = kindMeta(item.kind);
              const busy = busyId === item.id;
              if (editingId === item.id) {
                return (
                  <div key={item.id} className="panel">
                    <ItemForm
                      initial={draftOf(item)}
                      showHandledBy={canAssign}
                      initialAssigneeName={item.assignedToName}
                      people={people}
                      myProfileId={profileId}
                      saving={busy}
                      savingLabel={savingLabel}
                      onCancel={() => setEditingId(null)}
                      onSave={(d, files) => void run(item.id, async () => { replace(await saveItem(item, d, files)); setEditingId(null); })}
                    />
                  </div>
                );
              }
              const pictures = item.attachments.filter((a) => isImage(a.type, a.name));
              const otherFiles = item.attachments.filter((a) => !isImage(a.type, a.name));
              return (
                <div key={item.id} className={`panel flex flex-col gap-3 sm:flex-row sm:items-start ${item.confirmedAt ? "opacity-75" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${meta.badge}`}>{meta.label}</span>
                      {item.area && <span className="text-[11px] text-slate-400">{item.area}</span>}
                    </div>
                    <div className={`mt-1 text-sm font-semibold text-white ${item.confirmedAt ? "line-through decoration-white/30" : ""}`}>{item.title}</div>
                    {item.details && <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-slate-300">{item.details}</p>}
                    {item.attachments.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {pictures.map((a, n) => (
                          <button
                            key={a.url}
                            type="button"
                            title={a.name}
                            onClick={() => setViewer({ pictures, start: n })}
                            className="h-16 w-16 overflow-hidden rounded-md border border-white/15 bg-slate-900/60 hover:border-blue-500/60"
                          >
                            <img src={a.url} alt={a.name} loading="lazy" className="h-full w-full object-cover" />
                          </button>
                        ))}
                        {otherFiles.map((a) =>
                          isPdf(a) ? (
                            <button key={a.url} type="button" onClick={() => setPdfView(a)} className="inline-flex max-w-[14rem] items-center gap-1.5 rounded-md border border-white/15 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-200 hover:border-blue-500/60">
                              <FileText className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{a.name}</span>
                            </button>
                          ) : (
                            <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-[14rem] items-center gap-1.5 rounded-md border border-white/15 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-200 hover:border-blue-500/60">
                              <FileText className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{a.name}</span>
                            </a>
                          ),
                        )}
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                      <span>Added by <span className="text-slate-300">{item.addedByName || "—"}</span> · {fmtWhen(item.createdAt)}</span>
                      {item.assignedTo ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-violet-200">
                          <UserRound className="h-3 w-3" /> Handled by {item.assignedToName || nameOf(item.assignedTo) || "—"}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5"><UserRound className="h-3 w-3" /> Not assigned</span>
                      )}
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
                      <>
                        {/* Confirm needs someone handling it first. */}
                        <button
                          type="button"
                          disabled={busy || !item.assignedTo}
                          title={item.assignedTo ? undefined : "Assign someone to handle it first"}
                          onClick={() => void run(item.id, async () => replace(await setErrorImprovementConfirmed(item.id, me)))}
                          className="btn text-sm px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-green-600"
                        >
                          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Confirm
                        </button>
                        {!item.assignedTo && (
                          <p className="text-[10px] leading-snug text-amber-300/90">
                            {canAssign ? "Pick who's handling it below to confirm." : "IT has to assign someone before it can be confirmed."}
                          </p>
                        )}
                        {canAssign && (
                          <label className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            Handled by
                            <HandledBySelect
                              value={item.assignedTo}
                              valueName={item.assignedToName}
                              people={people}
                              myProfileId={profileId}
                              onChange={(assignedTo) => void run(item.id, async () => replace(await saveItem(item, { ...draftOf(item), assignedTo }, [])))}
                              disabled={busy}
                              className={`${selectCls} mt-1 w-full font-normal normal-case tracking-normal disabled:opacity-50`}
                            />
                          </label>
                        )}
                      </>
                    )}
                    <div className="flex justify-end gap-1">
                      <button type="button" title="Edit" onClick={() => { setEditingId(item.id); setAdding(false); }} className="btn p-1.5"><Pencil className="h-3.5 w-3.5" /></button>
                      <button
                        type="button"
                        title="Delete"
                        disabled={busy}
                        onClick={() => {
                          if (!window.confirm(`Delete "${item.title}"? This can't be undone.`)) return;
                          void run(item.id, async () => {
                            await deleteErrorImprovement(item.id);
                            setItems((cur) => cur.filter((i) => i.id !== item.id));
                            for (const a of item.attachments) void deleteAttachmentByUrl(a.path || a.url).catch(() => {});
                          });
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
      {viewer && <PictureViewer pictures={viewer.pictures} start={viewer.start} onClose={() => setViewer(null)} />}
      {pdfView && <InlinePdfModal url={pdfView.url} title={pdfView.name} fileName={pdfView.name} onClose={() => setPdfView(null)} />}
    </div>
  );
}
