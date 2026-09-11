import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Wraps a wide, horizontally-scrolling block (typically a table) so its
 * horizontal scrollbar is ALWAYS reachable, even after scrolling far down a
 * tall page — a native `overflow-x-auto` div's own scrollbar sits at the
 * very bottom of its content, which scrolls out of view along with the
 * table once there are enough rows.
 *
 * This adds a second, thin scrollbar pinned to the bottom of the viewport,
 * kept in sync with the real scroll position in both directions. Portaled
 * to document.body with `position: fixed` rather than `position: sticky` —
 * this table typically sits inside a `.panel` with `overflow-hidden` (to
 * clip its own rounded corners), which makes sticky's containing block that
 * panel instead of the viewport; since the panel never scrolls internally
 * (the page does), a sticky child just renders at its static in-flow
 * position and never actually sticks. Escaping via a portal + fixed
 * position, positioned from the real container's own getBoundingClientRect,
 * sidesteps that entirely — same fix pattern used elsewhere in this app for
 * an ancestor that clips/traps a child (see e.g. the Branch Manager combobox
 * in ReportHRDaily.tsx).
 */
export function StickyHorizontalScrollbar({ children, className }: { children: ReactNode; className?: string }) {
  const mainRef = useRef<HTMLDivElement | null>(null);
  const shadowRef = useRef<HTMLDivElement | null>(null);
  const [contentWidth, setContentWidth] = useState(0);
  const [needsScroll, setNeedsScroll] = useState(false);
  const [inView, setInView] = useState(false);
  const [rect, setRect] = useState<{ left: number; width: number } | null>(null);
  // Guards against the two scroll listeners re-triggering each other.
  const syncingFrom = useRef<"main" | "shadow" | null>(null);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const updateSize = () => {
      setContentWidth(main.scrollWidth);
      setNeedsScroll(main.scrollWidth > main.clientWidth + 1);
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(main);
    // The table's own width can change from data loading in async (roster,
    // filters, column visibility, etc.) without the container itself
    // resizing — a MutationObserver on children catches that too.
    const mo = new MutationObserver(updateSize);
    mo.observe(main, { childList: true, subtree: true });

    const updateRect = () => {
      const r = main.getBoundingClientRect();
      setRect({ left: r.left, width: r.width });
    };
    updateRect();
    window.addEventListener("scroll", updateRect, { passive: true });
    window.addEventListener("resize", updateRect);

    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0 });
    io.observe(main);

    return () => {
      ro.disconnect();
      mo.disconnect();
      io.disconnect();
      window.removeEventListener("scroll", updateRect);
      window.removeEventListener("resize", updateRect);
    };
  }, []);

  // The shadow bar is conditionally rendered (only while in view), so each
  // time it (re)mounts it starts at scrollLeft 0 — sync it to wherever the
  // real content is already scrolled to instead of snapping it back to 0.
  useEffect(() => {
    if (shadowRef.current && mainRef.current) shadowRef.current.scrollLeft = mainRef.current.scrollLeft;
  }, [needsScroll, inView, rect]);

  return (
    <>
      <div
        ref={mainRef}
        className={className ?? "overflow-x-auto"}
        onScroll={() => {
          if (syncingFrom.current === "shadow") return;
          syncingFrom.current = "main";
          if (shadowRef.current && mainRef.current) shadowRef.current.scrollLeft = mainRef.current.scrollLeft;
          syncingFrom.current = null;
        }}
      >
        {children}
      </div>
      {needsScroll &&
        inView &&
        rect &&
        createPortal(
          <div
            ref={shadowRef}
            className="fixed bottom-0 z-40 overflow-x-auto overflow-y-hidden bg-black/60 border-t border-white/10"
            style={{ left: rect.left, width: rect.width, height: 16 }}
            onScroll={() => {
              if (syncingFrom.current === "main") return;
              syncingFrom.current = "shadow";
              if (mainRef.current && shadowRef.current) mainRef.current.scrollLeft = shadowRef.current.scrollLeft;
              syncingFrom.current = null;
            }}
          >
            <div style={{ width: contentWidth, height: 1 }} />
          </div>,
          document.body
        )}
    </>
  );
}
