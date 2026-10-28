import { useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, Circle, Camera } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  uploadTicketPhoto,
  listTicketPhotos,
  deleteTicketPhoto,
  setTicketPhotoType,
  type TicketPhoto,
} from "@/lib/firebase/storage";
import { PHOTO_TYPES, photoTypeLabel, missingRequiredPhotoTypes } from "@/lib/photoTypes";
import { compressImage, validateImageFile, formatBytes } from "@/lib/imageCompression";
import { enqueuePhotoUpload, getQueuedActionStates } from "@/lib/offlineQueue";
import { isTabVisible, onTabVisible } from "@/lib/pageVisibility";

// Room for every photo type (8) plus extras.
const MAX_PHOTOS = 30;

interface UploadQueueItem {
  id: string;
  fileName: string;
  status: "compressing" | "uploading" | "done" | "error" | "queued";
  progress: number;
  originalSize: number;
  originalDims?: { width: number; height: number };
  compressedSize?: number;
  compressedDims?: { width: number; height: number };
  error?: string;
  /** Offline-queue row id while "queued". */
  queueId?: number;
}

/**
 * Ticket photo gallery + uploader. Photos live in Firebase Storage under
 * companies/{companyId}/tickets/{ticketNo}/{category}/ so they're namespaced
 * per company and (optionally) per category (e.g. "general", "service").
 *
 * `uploadedBy` is stamped onto each upload so the tile shows who uploaded
 * the file. `visitOptions` lets the caller hand in a list of visit numbers
 * (e.g. ["1", "2"]) so the technician can label which visit the photo
 * belongs to before uploading — this gets stored as Firebase storage
 * custom metadata and shown back on the tile.
 */
export function TicketPhotos({
  ticketNo,
  category,
  title,
  uploadedBy,
  visitOptions,
  enableOfflineQueue,
  onPhotoClick,
  compactChecklist,
  onPhotosChange,
}: {
  ticketNo: string;
  category?: string;
  title?: string;
  uploadedBy?: string;
  visitOptions?: string[];
  /** Mobile only — desktop leaves this off, so a failed upload there still just fails outright (unchanged behavior). A failure while offline queues the already-compressed photo instead of erroring; OfflineQueueBadge (mounted in MobileTechApp) drains it once back online. */
  enableOfflineQueue?: boolean;
  /** When set, clicking a photo calls this (with every image photo, in order) instead of opening the full-screen viewer — e.g. Pre-Claim's side preview. */
  onPhotoClick?: (photo: TicketPhoto, imagePhotos: TicketPhoto[]) => void;
  /** Narrow spots (Pre-Claim): only the "Missing required" line, not the full photo checklist. */
  compactChecklist?: boolean;
  /** The ticket's photos once loaded, and again after every upload / delete / type change — Pre-Claim checks them before submitting. */
  onPhotosChange?: (photos: TicketPhoto[]) => void;
}) {
  const { companyId, ready } = useAuth();
  const [photos, setPhotos] = useState<TicketPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const uploading = uploadQueue.some((q) => q.status === "compressing" || q.status === "uploading");
  const [error, setError] = useState<string | null>(null);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<TicketPhoto | null>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const [zoomPos, setZoomPos] = useState({ x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement | null>(null);
  const lastTouchDist = useRef<number | null>(null);
  const [selectedVisitNo, setSelectedVisitNo] = useState<string>(() => (visitOptions && visitOptions.length ? visitOptions[visitOptions.length - 1] : ""));
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Which photo type the next pick from the file picker is for ("" = other / untyped).
  const pendingTypeRef = useRef<string>("");
  const pickFor = (photoType: string) => {
    pendingTypeRef.current = photoType;
    fileInputRef.current?.click();
  };
  const [typingPath, setTypingPath] = useState<string | null>(null);
  // Categorize a photo uploaded without a type (or change its type).
  const handleSetType = async (photo: TicketPhoto, photoType: string) => {
    if (!photoType) return;
    setTypingPath(photo.fullPath);
    try {
      await setTicketPhotoType(photo.fullPath, photoType);
      setPhotos((prev) => prev.map((p) => (p.fullPath === photo.fullPath ? { ...p, photoType } : p)));
    } catch (err) {
      alert(`Couldn't set the photo type: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setTypingPath(null);
    }
  };
  const missingRequired = missingRequiredPhotoTypes(photos.map((p) => p.photoType));
  const countByType = (key: string) => photos.filter((p) => p.photoType === key).length;

  const cid = companyId || "COMP001";
  const ticketPath = category ? `${ticketNo}/${category}` : ticketNo;

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const list = await listTicketPhotos(cid, ticketPath);
        if (!cancelled) setPhotos(list);
      } catch (err) {
        console.error("Failed to load ticket photos:", err);
        if (!cancelled) setPhotos([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ready, cid, ticketPath]);

  useEffect(() => {
    if (!loading) onPhotosChange?.(photos);
  }, [photos, loading, onPhotosChange]);

  // Reconciles "queued" placeholders with OfflineQueueBadge's background
  // drain (elsewhere in the app) by their queue row ids: a row that's gone
  // has synced — re-list this ticket's real photos and drop its placeholder;
  // a row whose last try failed shows that error under its placeholder.
  const queuedIdsKey = uploadQueue.filter((q) => q.status === "queued" && q.queueId != null).map((q) => q.queueId).join(",");
  useEffect(() => {
    if (!queuedIdsKey) return;
    const ids = queuedIdsKey.split(",").map(Number);
    let cancelled = false;
    const check = async () => {
      if (cancelled || !isTabVisible()) return;
      const states = await getQueuedActionStates(ids).catch(() => null);
      if (cancelled || !states) return;
      if (ids.some((id) => !states.has(id))) {
        const list = await listTicketPhotos(cid, ticketPath).catch(() => null);
        if (cancelled) return;
        if (list) setPhotos(list);
      }
      setUploadQueue((prev) =>
        prev
          .filter((q) => q.status !== "queued" || q.queueId == null || states.has(q.queueId))
          .map((q) => (q.status === "queued" && q.queueId != null ? { ...q, error: states.get(q.queueId)?.lastError } : q)),
      );
    };
    check();
    const interval = window.setInterval(check, 15_000);
    // Catches up immediately on refocus instead of waiting out the rest of
    // the interval — see pageVisibility.ts.
    const unsubVisible = onTabVisible(check);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      unsubVisible();
    };
  }, [queuedIdsKey, cid, ticketPath]);

  const isImage = (name: string) => /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(name);

  const formatUploadedAt = (iso: string | undefined): string => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-US", {
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const updateQueueItem = (id: string, patch: Partial<UploadQueueItem>) => {
    setUploadQueue((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  };

  // Compresses (in parallel across files, via a Web Worker per
  // browser-image-compression) then uploads each selected photo. Each
  // file's pipeline is wrapped in its own try/catch so one failure never
  // stops the rest of the batch — the previous version awaited each file
  // sequentially inside a single try/catch, which silently abandoned the
  // remaining files the moment any one of them threw.
  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    const photoType = pendingTypeRef.current || undefined;
    pendingTypeRef.current = "";

    const candidates = Array.from(files);
    const valid: File[] = [];
    const rejections: string[] = [];

    const roomLeft = MAX_PHOTOS - photos.length - uploadQueue.length;
    for (const file of candidates) {
      const formatError = validateImageFile(file);
      if (formatError) {
        rejections.push(formatError);
        continue;
      }
      if (valid.length >= Math.max(0, roomLeft)) {
        rejections.push(`"${file.name}" was skipped — a ticket can have at most ${MAX_PHOTOS} photos.`);
        continue;
      }
      valid.push(file);
    }
    if (rejections.length) setError(rejections.join(" "));
    if (valid.length === 0) {
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const items: UploadQueueItem[] = valid.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      fileName: file.name,
      status: "compressing",
      progress: 0,
      originalSize: file.size,
    }));
    setUploadQueue((prev) => [...items, ...prev]);

    await Promise.allSettled(
      valid.map(async (file, i) => {
        const id = items[i].id;
        // Declared outside the try so the catch block below can still
        // queue the already-compressed blob if only the upload (not the
        // compression) failed — compression is CPU-only and needs no
        // network, so there's no reason to redo it on a network failure.
        let compressed: Awaited<ReturnType<typeof compressImage>> | null = null;
        try {
          compressed = await compressImage(file);
          updateQueueItem(id, {
            status: "uploading",
            originalDims: { width: compressed.originalWidth, height: compressed.originalHeight },
            compressedSize: compressed.compressedSize,
            compressedDims: { width: compressed.width, height: compressed.height },
          });

          const photo = await uploadTicketPhoto(
            cid,
            ticketPath,
            compressed.blob,
            file.name,
            {
              uploadedBy,
              visitNo: selectedVisitNo || undefined,
              width: compressed.width,
              height: compressed.height,
              originalSize: compressed.originalSize,
              photoType,
            },
            (percent) => updateQueueItem(id, { progress: percent }),
          );

          setPhotos((prev) => [photo, ...prev]);
          setUploadQueue((prev) => prev.filter((q) => q.id !== id));
        } catch (err) {
          console.error(`Photo upload failed for "${file.name}":`, err);
          if (enableOfflineQueue) {
            // Compression is CPU-only (no network needed) — if it already
            // succeeded, queue that same blob as-is instead of redoing it;
            // only falls back to the raw file if the failure happened
            // during compression itself.
            try {
              const queueId = await enqueuePhotoUpload({
                companyId: cid,
                ticketPath,
                blob: compressed?.blob ?? file,
                fileName: file.name,
                uploadedBy,
                visitNo: selectedVisitNo || undefined,
                width: compressed?.width,
                height: compressed?.height,
                originalSize: compressed?.originalSize ?? file.size,
                photoType,
              });
              updateQueueItem(id, { status: "queued", progress: 100, queueId });
              return;
            } catch (queueErr) {
              console.error(`Failed to queue "${file.name}" for offline sync:`, queueErr);
            }
          }
          updateQueueItem(id, {
            status: "error",
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }),
    );

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDelete = async (photo: TicketPhoto) => {
    if (!confirm(`Delete this photo? This cannot be undone.`)) return;
    setDeletingPath(photo.fullPath);
    try {
      await deleteTicketPhoto(photo.fullPath);
      setPhotos((prev) => prev.filter((p) => p.fullPath !== photo.fullPath));
    } catch (err) {
      console.error("Photo delete failed:", err);
      alert(`Delete failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setDeletingPath(null);
    }
  };

  const closePreview = () => { setPreview(null); setZoomScale(1); setZoomPos({ x: 0, y: 0 }); };
  const openPreview = (photo: TicketPhoto) => { setPreview(photo); setZoomScale(1); setZoomPos({ x: 0, y: 0 }); };

  return (
    <div className="space-y-4 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="font-semibold text-slate-300">{title ?? "Photos"}</h4>
        <div className="flex items-center gap-2">
          {visitOptions && visitOptions.length > 0 && (
            <label className="flex items-center gap-1 text-xs text-slate-400">
              <span className="uppercase tracking-wide">Visit</span>
              <select
                value={selectedVisitNo}
                onChange={(e) => setSelectedVisitNo(e.target.value)}
                className="rounded border border-white/15 bg-slate-950 px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
              >
                <option value="">— none —</option>
                {visitOptions.map((v) => (
                  <option key={v} value={v}>Visit {v}</option>
                ))}
              </select>
            </label>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <button
            type="button"
            onClick={() => pickFor("")}
            disabled={uploading}
            title="A photo that isn't one of the types below"
            className="px-3 py-2 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 disabled:opacity-50 text-slate-200 text-xs font-semibold transition-colors"
          >
            {uploading ? "Uploading..." : "+ Other photo"}
          </button>
        </div>
      </div>

      {/* Photo checklist — upload each kind of photo from its own row. Required ones are checked by Claims Readiness. */}
      <div className="rounded-lg border border-white/10 bg-slate-900/40">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-white/10">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Photos needed</span>
          {loading ? null : missingRequired.length === 0 ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> All required photos uploaded</span>
          ) : (
            <span className="text-[11px] font-semibold text-amber-300">Missing required: {missingRequired.map((t) => t.label).join(" · ")}</span>
          )}
        </div>
        {!compactChecklist && <ul className="divide-y divide-white/5">
          {PHOTO_TYPES.map((t) => {
            const n = countByType(t.key);
            return (
              <li key={t.key} className="flex items-center gap-2.5 px-3 py-1.5" title={t.help}>
                {n > 0 ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" /> : <Circle className={`h-4 w-4 shrink-0 ${t.required ? "text-amber-400" : "text-slate-600"}`} />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-200">
                    {t.label}
                    <span className={`ml-2 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${t.required ? "bg-rose-500/15 text-rose-300" : "bg-white/5 text-slate-400"}`}>{t.required ? "Required" : "Optional"}</span>
                    {n > 0 && <span className="ml-2 text-[11px] text-emerald-300">{n} uploaded</span>}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => pickFor(t.key)}
                  disabled={uploading}
                  className="shrink-0 inline-flex items-center gap-1 rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-2.5 py-1.5 text-xs font-semibold text-white"
                >
                  <Camera className="h-3.5 w-3.5" /> Upload
                </button>
              </li>
            );
          })}
        </ul>}
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded p-3">
          {error}
        </div>
      )}

      {uploadQueue.length > 0 && (
        <div className="space-y-2">
          {uploadQueue.map((item) => {
            const savedPct = item.compressedSize
              ? Math.round((1 - item.compressedSize / item.originalSize) * 100)
              : null;
            return (
              <div key={item.id} className="rounded-lg border border-white/10 bg-slate-900/50 px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-slate-300">{item.fileName}</span>
                  <span className={item.status === "error" ? "text-red-400" : item.status === "queued" ? "text-amber-400" : "text-slate-400"}>
                    {item.status === "compressing" && "Compressing…"}
                    {item.status === "uploading" && `Uploading ${item.progress}%`}
                    {item.status === "error" && "Failed"}
                    {item.status === "queued" && "Waiting to sync"}
                  </span>
                </div>
                {item.status === "uploading" && (
                  <div className="mt-1.5 h-1 w-full rounded-full bg-slate-800 overflow-hidden">
                    <div className="h-full bg-blue-500 transition-all" style={{ width: `${item.progress}%` }} />
                  </div>
                )}
                {item.compressedSize != null && item.compressedDims && item.originalDims ? (
                  <div className="mt-1 text-slate-500">
                    {formatBytes(item.originalSize)} ({item.originalDims.width}×{item.originalDims.height}) →{" "}
                    {formatBytes(item.compressedSize)} ({item.compressedDims.width}×{item.compressedDims.height})
                    {savedPct != null && savedPct > 0 && <span className="text-emerald-400 ml-1">· {savedPct}% saved</span>}
                  </div>
                ) : null}
                {item.status === "error" && item.error && (
                  <div className="mt-1 text-red-400">{item.error}</div>
                )}
                {item.status === "queued" && item.error && (
                  <div className="mt-1 text-amber-300/80">Still trying — last attempt: {item.error}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Loading photos…</p>
      ) : photos.length === 0 ? (
        <p className="text-sm text-slate-500">No photos uploaded yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {photos.map((photo) => (
            <div key={photo.fullPath} className="group relative rounded-lg overflow-hidden border border-white/10 bg-slate-900/50">
              {isImage(photo.name) ? (
                <button
                  type="button"
                  onClick={() => (onPhotoClick ? onPhotoClick(photo, photos.filter((p) => isImage(p.name))) : openPreview(photo))}
                  className="block w-full"
                  title={photo.width && photo.height ? `${formatBytes(photo.size)} · ${photo.width}×${photo.height}` : undefined}
                >
                  <img src={photo.url} alt={photo.name} className="h-28 w-full object-cover" loading="lazy" />
                </button>
              ) : (
                <a href={photo.url} target="_blank" rel="noopener noreferrer" className="flex h-28 w-full items-center justify-center text-xs text-slate-400 px-2 text-center">
                  {photo.name}
                </a>
              )}
              <div
                className="px-2 py-1.5 text-[10px] leading-tight text-slate-300 bg-slate-950/60 border-t border-white/10"
                title={photo.uploadedAt ? new Date(photo.uploadedAt).toLocaleString() : ""}
              >
                <div>{formatUploadedAt(photo.uploadedAt)}</div>
                {photo.photoType ? (
                  <div className="mb-0.5 font-semibold text-sky-300">{photoTypeLabel(photo.photoType) || photo.photoType}</div>
                ) : (
                  <select
                    value=""
                    disabled={typingPath === photo.fullPath}
                    onChange={(e) => void handleSetType(photo, e.target.value)}
                    className="mb-0.5 w-full rounded border border-amber-400/30 bg-slate-950 px-1 py-0.5 text-[10px] text-amber-200"
                    title="This photo has no type yet — pick what it shows"
                  >
                    <option value="">{typingPath === photo.fullPath ? "Saving…" : "Set type…"}</option>
                    {PHOTO_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                )}
                {(photo.uploadedBy || photo.visitNo) && (
                  <div className="text-[9px] text-slate-400 flex flex-wrap gap-x-2">
                    {photo.uploadedBy && <span>by {photo.uploadedBy}</span>}
                    {photo.visitNo && <span className="text-blue-300">Visit {photo.visitNo}</span>}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleDelete(photo)}
                title="Delete photo"
                disabled={deletingPath === photo.fullPath}
                className={`absolute top-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white transition-opacity hover:bg-red-600 disabled:opacity-100 ${
                  deletingPath === photo.fullPath ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}
              >
                {deletingPath === photo.fullPath ? <Loader2 className="h-3 w-3 animate-spin inline" /> : "✕"}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox with zoom */}
      {preview && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={closePreview}
        >
          {/* Toolbar */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 bg-black/60 z-10">
            <div className="text-sm text-slate-200 truncate max-w-xs">
              {preview.name}
              {preview.uploadedBy && <span className="text-slate-400 ml-2">· by {preview.uploadedBy}</span>}
              {preview.visitNo && <span className="text-blue-300 ml-2">· Visit {preview.visitNo}</span>}
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={(e) => { e.stopPropagation(); setZoomScale(s => Math.max(1, +(s - 0.5).toFixed(1))); if (zoomScale <= 1.5) setZoomPos({ x: 0, y: 0 }); }} className="w-8 h-8 rounded bg-white/10 hover:bg-white/20 text-white text-lg flex items-center justify-center" title="Zoom out">−</button>
              <span className="text-xs text-slate-300 w-10 text-center">{Math.round(zoomScale * 100)}%</span>
              <button type="button" onClick={(e) => { e.stopPropagation(); setZoomScale(s => Math.min(5, +(s + 0.5).toFixed(1))); }} className="w-8 h-8 rounded bg-white/10 hover:bg-white/20 text-white text-lg flex items-center justify-center" title="Zoom in">+</button>
              <button type="button" onClick={(e) => { e.stopPropagation(); setZoomScale(1); setZoomPos({ x: 0, y: 0 }); }} className="px-2 h-8 rounded bg-white/10 hover:bg-white/20 text-white text-xs" title="Reset zoom">Reset</button>
              <a href={preview.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="px-2 h-8 rounded bg-blue-600/40 hover:bg-blue-600/60 text-blue-200 text-xs flex items-center">Open original ↗</a>
              <button type="button" onClick={closePreview} className="w-8 h-8 rounded bg-white/10 hover:bg-rose-600/40 text-white text-sm flex items-center justify-center">✕</button>
            </div>
          </div>

          {/* Image */}
          <div
            className="overflow-hidden w-full h-full flex items-center justify-center cursor-zoom-in pt-12 pb-8"
            onDoubleClick={(e) => { e.stopPropagation(); if (zoomScale > 1) { setZoomScale(1); setZoomPos({ x: 0, y: 0 }); } else { setZoomScale(2.5); } }}
            onWheel={(e) => { e.stopPropagation(); const delta = e.deltaY > 0 ? -0.2 : 0.2; setZoomScale(s => Math.min(5, Math.max(1, +(s + delta).toFixed(1)))); if (zoomScale + delta <= 1) setZoomPos({ x: 0, y: 0 }); }}
            onTouchStart={(e) => { if (e.touches.length === 2) { const dx = e.touches[0].clientX - e.touches[1].clientX; const dy = e.touches[0].clientY - e.touches[1].clientY; lastTouchDist.current = Math.sqrt(dx * dx + dy * dy); } }}
            onTouchMove={(e) => { if (e.touches.length === 2 && lastTouchDist.current !== null) { const dx = e.touches[0].clientX - e.touches[1].clientX; const dy = e.touches[0].clientY - e.touches[1].clientY; const dist = Math.sqrt(dx * dx + dy * dy); setZoomScale(s => Math.min(5, Math.max(1, +(s * (dist / lastTouchDist.current!)).toFixed(2)))); lastTouchDist.current = dist; } }}
            onTouchEnd={() => { lastTouchDist.current = null; }}
          >
            <img
              ref={imgRef}
              src={preview.url}
              alt={preview.name}
              draggable={false}
              style={{
                transform: `scale(${zoomScale}) translate(${zoomPos.x / zoomScale}px, ${zoomPos.y / zoomScale}px)`,
                transition: zoomScale === 1 ? "transform 0.2s ease" : "none",
                maxHeight: "calc(100vh - 80px)",
                maxWidth: "100%",
                objectFit: "contain",
                userSelect: "none",
                cursor: zoomScale > 1 ? "grab" : "zoom-in",
              }}
              onMouseDown={(e) => {
                if (zoomScale <= 1) return;
                e.preventDefault();
                const startX = e.clientX - zoomPos.x;
                const startY = e.clientY - zoomPos.y;
                const onMove = (mv: MouseEvent) => { setZoomPos({ x: mv.clientX - startX, y: mv.clientY - startY }); };
                const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
              }}
            />
          </div>

          {/* Caption */}
          <div className="absolute bottom-0 left-0 right-0 px-4 py-2 bg-black/60 text-xs text-slate-400 text-center">
            Scroll to zoom · Double-click to zoom in/out · Drag to pan when zoomed
          </div>
        </div>
      )}
    </div>
  );
}
