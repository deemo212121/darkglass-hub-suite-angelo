/**
 * Floating horizontal scrollbar pinned at the bottom of the BROWSER viewport
 * that mirrors a target element's scroll position. Lets a user scroll a wide
 * table sideways without having to scroll the page down to the table's
 * native scrollbar.
 *
 * Notes:
 *  - Rendered into a React portal at <body> so no ancestor with `transform`
 *    / `backdrop-filter` / `filter` can break its `position: fixed` anchor.
 *  - We draw the thumb ourselves with a plain <div> instead of relying on
 *    the browser's native scrollbar — modern Chrome / macOS use overlay
 *    scrollbars that are invisible until you start scrolling.
 *  - Visibility rules: hide when the target doesn't overflow horizontally,
 *    OR when the target is fully off-screen, OR when the target's own
 *    bottom edge (and therefore its native scrollbar) is already on-screen
 *    so the user can use that one instead.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";

interface Props {
  /** The horizontally-scrollable element to mirror. */
  targetRef: React.RefObject<HTMLElement | null>;
}

const BAR_HEIGHT = 14;
const MIN_THUMB = 40;

export function FloatingHorizontalScrollbar({ targetRef }: Props) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [layout, setLayout] = useState({
    trackWidth: 0,
    thumbLeft: 0,
    thumbWidth: 0,
  });

  useEffect(() => setMounted(true), []);

  const measure = useCallback(() => {
    const el = targetRef.current;
    if (!el) return;

    const overflow = el.scrollWidth - el.clientWidth;
    if (overflow <= 1) {
      setVisible(false);
      return;
    }

    const rect = el.getBoundingClientRect();
    const viewportH = window.innerHeight || document.documentElement.clientHeight;

    // Off-screen.
    if (rect.bottom <= 0 || rect.top >= viewportH) {
      setVisible(false);
      return;
    }
    // Native bar reachable.
    if (rect.bottom <= viewportH) {
      setVisible(false);
      return;
    }

    const trackWidth = window.innerWidth || document.documentElement.clientWidth;
    const visibleRatio = el.clientWidth / el.scrollWidth;
    const thumbWidth = Math.max(MIN_THUMB, Math.floor(trackWidth * visibleRatio));
    const scrollableTrack = trackWidth - thumbWidth;
    const thumbLeft = overflow > 0
      ? (el.scrollLeft / overflow) * scrollableTrack
      : 0;

    setVisible(true);
    setLayout({ trackWidth, thumbLeft, thumbWidth });
  }, [targetRef]);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    const onScroll = () => measure();
    const onResize = () => measure();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    measure();
    const r1 = requestAnimationFrame(measure);
    const r2 = window.setTimeout(measure, 300);
    const r3 = window.setTimeout(measure, 1500);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onScroll, { capture: true } as any);
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      cancelAnimationFrame(r1);
      window.clearTimeout(r2);
      window.clearTimeout(r3);
    };
  }, [targetRef, measure]);

  // Thumb drag — listeners attached on pointerdown, cleaned up on pointerup.
  const onThumbDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = targetRef.current;
    if (!el) return;
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startScrollLeft = el.scrollLeft;
    document.body.style.userSelect = "none";

    const onMove = (ev: PointerEvent) => {
      const el2 = targetRef.current;
      if (!el2) return;
      const overflow = el2.scrollWidth - el2.clientWidth;
      const scrollableTrack = layout.trackWidth - layout.thumbWidth;
      if (overflow <= 0 || scrollableTrack <= 0) return;
      const dx = ev.clientX - startX;
      el2.scrollLeft = startScrollLeft + (dx / scrollableTrack) * overflow;
    };
    const onUp = () => {
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  // Click on empty track → page jump.
  const onTrackDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = targetRef.current;
    if (!el) return;
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    if (clickX >= layout.thumbLeft && clickX <= layout.thumbLeft + layout.thumbWidth) return;
    const direction = clickX < layout.thumbLeft ? -1 : 1;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
  };

  if (!mounted) return null;

  const bar = (
    <div
      data-floating-hscroll
      aria-hidden="true"
      onPointerDown={onTrackDown}
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        height: `${BAR_HEIGHT}px`,
        zIndex: 2147483600, // top of the stack — beats any modal/backdrop.
        background: "rgba(15,23,42,0.92)",
        borderTop: "1px solid rgba(255,255,255,0.18)",
        boxShadow: "0 -4px 12px rgba(0,0,0,0.45)",
        display: visible ? "block" : "none",
        cursor: "pointer",
        userSelect: "none",
        touchAction: "none",
      }}
    >
      <div
        onPointerDown={onThumbDown}
        style={{
          position: "absolute",
          top: 3,
          height: BAR_HEIGHT - 6,
          left: `${layout.thumbLeft}px`,
          width: `${layout.thumbWidth}px`,
          background: "rgba(148,163,184,0.95)",
          borderRadius: 8,
          cursor: "grab",
        }}
      />
    </div>
  );

  return createPortal(bar, document.body);
}
