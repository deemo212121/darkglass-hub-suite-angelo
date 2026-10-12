import { useRef, useState } from "react";

// receiptUrl is a Firebase Storage download URL — the original filename
// (with extension) survives in its path component, before the "?" query
// string that carries the access token, so a plain extension check still
// works despite the URL not literally ending in ".pdf".
export function isPdfReceipt(url: string): boolean {
  return /\.pdf(\?|$)/i.test(url);
}

/**
 * Full-screen receipt viewer shared by Accounting → Expenses and
 * Branch/Technician → Technician Expenses — shown in place instead of
 * navigating away, so reviewing a receipt doesn't lose your place. Same
 * zoom/pan mechanics as TicketPhotos.tsx's lightbox (scroll/pinch/
 * double-click to zoom, drag to pan when zoomed).
 */
export function ReceiptLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  const [zoomScale, setZoomScale] = useState(1);
  const [zoomPos, setZoomPos] = useState({ x: 0, y: 0 });
  const lastTouchDist = useRef<number | null>(null);

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center" onClick={onClose}>
      {/* Toolbar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 bg-black/60 z-10">
        <div className="text-sm text-slate-200 truncate max-w-xs">Receipt</div>
        <div className="flex items-center gap-2">
          {!isPdfReceipt(url) && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setZoomScale((s) => Math.max(1, +(s - 0.5).toFixed(1))); if (zoomScale <= 1.5) setZoomPos({ x: 0, y: 0 }); }}
                className="w-8 h-8 rounded bg-white/10 hover:bg-white/20 text-white text-lg flex items-center justify-center"
                title="Zoom out"
              >
                −
              </button>
              <span className="text-xs text-slate-300 w-10 text-center">{Math.round(zoomScale * 100)}%</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setZoomScale((s) => Math.min(5, +(s + 0.5).toFixed(1))); }}
                className="w-8 h-8 rounded bg-white/10 hover:bg-white/20 text-white text-lg flex items-center justify-center"
                title="Zoom in"
              >
                +
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setZoomScale(1); setZoomPos({ x: 0, y: 0 }); }}
                className="px-2 h-8 rounded bg-white/10 hover:bg-white/20 text-white text-xs"
                title="Reset zoom"
              >
                Reset
              </button>
            </>
          )}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="px-2 h-8 rounded bg-blue-600/40 hover:bg-blue-600/60 text-blue-200 text-xs flex items-center"
          >
            Open original ↗
          </a>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded bg-white/10 hover:bg-rose-600/40 text-white text-sm flex items-center justify-center">
            ✕
          </button>
        </div>
      </div>

      {isPdfReceipt(url) ? (
        <iframe src={url} title="Receipt" className="w-full h-full pt-12 pb-8" onClick={(e) => e.stopPropagation()} />
      ) : (
        <div
          className="overflow-hidden w-full h-full flex items-center justify-center cursor-zoom-in pt-12 pb-8"
          onDoubleClick={(e) => { e.stopPropagation(); if (zoomScale > 1) { setZoomScale(1); setZoomPos({ x: 0, y: 0 }); } else { setZoomScale(2.5); } }}
          onWheel={(e) => { e.stopPropagation(); const delta = e.deltaY > 0 ? -0.2 : 0.2; setZoomScale((s) => Math.min(5, Math.max(1, +(s + delta).toFixed(1)))); if (zoomScale + delta <= 1) setZoomPos({ x: 0, y: 0 }); }}
          onTouchStart={(e) => { if (e.touches.length === 2) { const dx = e.touches[0].clientX - e.touches[1].clientX; const dy = e.touches[0].clientY - e.touches[1].clientY; lastTouchDist.current = Math.sqrt(dx * dx + dy * dy); } }}
          onTouchMove={(e) => { if (e.touches.length === 2 && lastTouchDist.current !== null) { const dx = e.touches[0].clientX - e.touches[1].clientX; const dy = e.touches[0].clientY - e.touches[1].clientY; const dist = Math.sqrt(dx * dx + dy * dy); setZoomScale((s) => Math.min(5, Math.max(1, +(s * (dist / lastTouchDist.current!)).toFixed(2)))); lastTouchDist.current = dist; } }}
          onTouchEnd={() => { lastTouchDist.current = null; }}
        >
          <img
            src={url}
            alt="Receipt"
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
      )}

      {/* Caption */}
      <div className="absolute bottom-0 left-0 right-0 px-4 py-2 bg-black/60 text-xs text-slate-400 text-center">
        {isPdfReceipt(url) ? "PDF receipt" : "Scroll to zoom · Double-click to zoom in/out · Drag to pan when zoomed"}
      </div>
    </div>
  );
}
