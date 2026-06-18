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
 */
export function TicketPhotos({ ticketNo, category, title }: { ticketNo: string; category?: string; title?: string }) {
  const { companyId, ready } = useAuth();
  const [photos, setPhotos] = useState<TicketPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<TicketPhoto | null>(null);
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
        const photo = await uploadTicketPhoto(cid, ticketPath, file);
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
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-slate-300">{title ?? "Photos"}</h4>
        <div>
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
                <button type="button" onClick={() => setPreview(photo)} className="block w-full">
                  <img src={photo.url} alt={photo.name} className="h-28 w-full object-cover" loading="lazy" />
                </button>
              ) : (
                <a href={photo.url} target="_blank" rel="noopener noreferrer" className="flex h-28 w-full items-center justify-center text-xs text-slate-400 px-2 text-center">
                  {photo.name}
                </a>
              )}
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

      {/* Lightbox preview */}
      {preview && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6" onClick={() => setPreview(null)}>
          <div className="max-w-4xl max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <img src={preview.url} alt={preview.name} className="max-h-[85vh] w-auto rounded-lg" />
            <div className="mt-2 flex items-center justify-between text-sm text-slate-300">
              <span className="truncate">{preview.name}</span>
              <a href={preview.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">Open original</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
