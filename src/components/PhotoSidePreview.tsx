/**
 * A side panel that shows one photo large — zoom (mouse wheel or + / −),
 * drag to move around when zoomed, rotate (sideways serial plates), and
 * ‹ › through the other photos. Used by Pre-Claim Information so the claim
 * form stays usable on the left while the photo is read on the right
 * (e.g. typing the serial number off the rating plate).
 */
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, RotateCw, X, ZoomIn, ZoomOut } from "lucide-react";
import type { TicketPhoto } from "@/lib/firebase/storage";

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

export function PhotoSidePreview({
  photos,
  index,
  onIndexChange,
  onClose,
}: {
  photos: TicketPhoto[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}) {
  const photo = photos[index];
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // A new photo starts fresh.
  useEffect(() => {
    setZoom(1);
    setRotation(0);
    setPos({ x: 0, y: 0 });
  }, [photo?.fullPath]);

  // Wheel zoom — attached by hand so it can preventDefault (React's onWheel is passive).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => {
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, +(z * (e.deltaY < 0 ? 1.2 : 1 / 1.2)).toFixed(2)));
        if (next === 1) setPos({ x: 0, y: 0 });
        return next;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ← / → between photos, Esc closes — only when not typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
      if (e.key === "ArrowRight" && index < photos.length - 1) onIndexChange(index + 1);
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, photos.length, onIndexChange, onClose]);

  if (!photo) return null;

  const zoomBy = (factor: number) =>
    setZoom((z) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, +(z * factor).toFixed(2)));
      if (next === 1) setPos({ x: 0, y: 0 });
      return next;
    });
  const reset = () => { setZoom(1); setRotation(0); setPos({ x: 0, y: 0 }); };
  const btn = "inline-flex h-8 min-w-8 items-center justify-center rounded bg-white/10 px-2 text-xs text-white hover:bg-white/20 disabled:opacity-30";

  return (
    <aside className="flex min-h-0 w-[46%] min-w-[420px] max-w-[900px] flex-col border-l border-white/10 bg-slate-950" aria-label="Photo preview">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-white/10 px-3 py-2">
        <button type="button" className={btn} onClick={() => onIndexChange(index - 1)} disabled={index <= 0} title="Previous photo (←)">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="px-1 text-xs tabular-nums text-slate-400">{index + 1} of {photos.length}</span>
        <button type="button" className={btn} onClick={() => onIndexChange(index + 1)} disabled={index >= photos.length - 1} title="Next photo (→)">
          <ChevronRight className="h-4 w-4" />
        </button>
        <span className="mx-1 h-5 w-px bg-white/10" />
        <button type="button" className={btn} onClick={() => zoomBy(1 / 1.4)} disabled={zoom <= MIN_ZOOM} title="Zoom out">
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="w-12 text-center text-xs tabular-nums text-slate-300">{Math.round(zoom * 100)}%</span>
        <button type="button" className={btn} onClick={() => zoomBy(1.4)} disabled={zoom >= MAX_ZOOM} title="Zoom in">
          <ZoomIn className="h-4 w-4" />
        </button>
        <button type="button" className={btn} onClick={() => setRotation((r) => (r + 90) % 360)} title="Rotate 90°">
          <RotateCw className="h-4 w-4" />
        </button>
        <button type="button" className={btn} onClick={reset} title="Fit">Fit</button>
        <a href={photo.url} target="_blank" rel="noopener noreferrer" className={btn} title="Open the original in a new tab">
          <ExternalLink className="h-4 w-4" />
        </a>
        <button type="button" className={`${btn} ml-auto hover:bg-rose-600/40`} onClick={onClose} title="Close preview (Esc)">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div
        ref={stageRef}
        className={`relative min-h-0 flex-1 overflow-hidden bg-black/60 ${zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"}`}
        onPointerDown={(e) => {
          if (zoom <= 1) return;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setPos({ x: drag.current.px + (e.clientX - drag.current.x), y: drag.current.py + (e.clientY - drag.current.y) });
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onDoubleClick={() => (zoom > 1 ? reset() : setZoom(2.5))}
      >
        <img
          src={photo.url}
          alt={photo.name}
          draggable={false}
          className="absolute inset-0 m-auto max-h-full max-w-full select-none object-contain"
          style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom}) rotate(${rotation}deg)`, transition: drag.current ? "none" : "transform 80ms ease-out" }}
        />
      </div>

      <p className="border-t border-white/10 px-3 py-1.5 text-[11px] text-slate-500">
        Scroll to zoom · drag to move · double-click to zoom in / fit
        {photo.uploadedBy ? ` · by ${photo.uploadedBy}` : ""}
      </p>
    </aside>
  );
}
