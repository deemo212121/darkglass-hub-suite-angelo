import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  uploadTicketPhoto,
  listTicketPhotos,
  deleteTicketPhoto,
  type TicketPhoto,
} from "@/lib/firebase/storage";

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
}: {
  ticketNo: string;
  category?: string;
  title?: string;
  uploadedBy?: string;
  visitOptions?: string[];
}) {
  const { companyId, ready } = useAuth();
  const [photos, setPhotos] = useState<TicketPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<TicketPhoto | null>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const [zoomPos, setZoomPos] = useState({ x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement | null>(null);
  const lastTouchDist = useRef<number | null>(null);
  // The visit number to tag the next batch of uploads with. Defaults to the
  // newest visit if the parent passed any options.
  const [selectedVisitNo, setSelectedVisitNo] = useState<string>(() => (visitOptions && visitOptions.length ? visitOptions[visitOptions.length - 1] : ""));
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const cid = companyId || "COMP001";
  // Storage sub-path. Keep backward compatible: no category => the ticket root.
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

  const isImage = (name: string) => /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(name);

  // Format the upload timestamp the same way SP's running notes are displayed
  // — local time, short date + time, with no seconds. Falls back to "—" when
  // the metadata isn't available.
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

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded: TicketPhoto[] = [];
      for (const file of Array.from(files)) {
        // 25MB guard per file.
        if (file.size > 25 * 1024 * 1024) {
          setError(`"${file.name}" is larger than 25MB and was skipped.`);
          continue;
        }
        const photo = await uploadTicketPhoto(cid, ticketPath, file, {
          uploadedBy,
          visitNo: selectedVisitNo || undefined,
        });
        uploaded.push(photo);
      }
      if (uploaded.length) setPhotos((prev) => [...uploaded, ...prev]);
    } catch (err) {
      console.error("Photo upload failed:", err);
      setError(`Upload failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (photo: TicketPhoto) => {
    if (!confirm(`Delete this photo? This cannot be undone.`)) return;
    try {
      await deleteTicketPhoto(photo.fullPath);
      setPhotos((prev) => prev.filter((p) => p.fullPath !== photo.fullPath));
    } catch (err) {
      console.error("Photo delete failed:", err);
      alert(`Delete failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

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
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
          >
            {uploading ? "Uploading..." : "+ Upload Photos"}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded p-3">
          {error}
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
                <button type="button" onClick={() => { setPreview(photo); setZoomScale(1); setZoomPos({ x: 0, y: 0 }); }} className="block w-full">
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
                className="absolute top-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox preview with zoom */}
      {preview && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => { setPreview(null); setZoomScale(1); setZoomPos({ x: 0, y: 0 }); }}
        >
          {/* Toolbar */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 bg-black/60 z-10">
            <div className="text-sm text-slate-200 truncate max-w-xs">
              {preview.name}
              {preview.uploadedBy && <span className="text-slate-400 ml-2">· by {preview.uploadedBy}</span>}
              {preview.visitNo && <span className="text-blue-300 ml-2">· Visit {preview.visitNo}</span>}
            </div>
            <div className="flex items-center gap-2">
              {/* Zoom controls */}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setZoomScale(s => Math.max(1, +(s - 0.5).toFixed(1))); if (zoomScale <= 1.5) setZoomPos({ x: 0, y: 0 }); }}
                className="w-8 h-8 rounded bg-white/10 hover:bg-white/20 text-white text-lg flex items-center justify-center"
                title="Zoom out"
              >−</button>
              <span className="text-xs text-slate-300 w-10 text-center">{Math.round(zoomScale * 100)}%</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setZoomScale(s => Math.min(5, +(s + 0.5).toFixed(1))); }}
                className="w-8 h-8 rounded bg-white/10 hover:bg-white/20 text-white text-lg flex items-center justify-center"
                title="Zoom in"
              >+</button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setZoomScale(1); setZoomPos({ x: 0, y: 0 }); }}
                className="px-2 h-8 rounded bg-white/10 hover:bg-white/20 text-white text-xs"
                title="Reset zoom"
              >Reset</button>
              <a
                href={preview.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="px-2 h-8 rounded bg-blue-600/40 hover:bg-blue-600/60 text-blue-200 text-xs flex items-center"
              >Open original ↗</a>
              <button
                type="button"
                onClick={() => { setPreview(null); setZoomScale(1); setZoomPos({ x: 0, y: 0 }); }}
                className="w-8 h-8 rounded bg-white/10 hover:bg-rose-600/40 text-white text-sm flex items-center justify-center"
              >✕</button>
            </div>
          </div>

          {/* Image container */}
          <div
            className="overflow-hidden w-full h-full flex items-center justify-center cursor-zoom-in pt-12 pb-4"
            onClick={(e) => {
              e.stopPropagation();
              // Double-click to toggle zoom
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (zoomScale > 1) { setZoomScale(1); setZoomPos({ x: 0, y: 0 }); }
              else { setZoomScale(2.5); }
            }}
            onWheel={(e) => {
              e.stopPropagation();
              const delta = e.deltaY > 0 ? -0.2 : 0.2;
              setZoomScale(s => Math.min(5, Math.max(1, +(s + delta).toFixed(1))));
              if (zoomScale + delta <= 1) setZoomPos({ x: 0, y: 0 });
            }}
            onTouchStart={(e) => {
              if (e.touches.length === 2) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                lastTouchDist.current = Math.sqrt(dx * dx + dy * dy);
              }
            }}
            onTouchMove={(e) => {
              if (e.touches.length === 2 && lastTouchDist.current !== null) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const ratio = dist / lastTouchDist.current;
                setZoomScale(s => Math.min(5, Math.max(1, +(s * ratio).toFixed(2))));
                lastTouchDist.current = dist;
              }
            }}
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
                const onMove = (mv: MouseEvent) => {
                  setZoomPos({ x: mv.clientX - startX, y: mv.clientY - startY });
                };
                const onUp = () => {
                  window.removeEventListener("mousemove", onMove);
                  window.removeEventListener("mouseup", onUp);
                };
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
