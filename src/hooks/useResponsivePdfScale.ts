import { useCallback, useEffect, useState } from "react";

/**
 * Computes a PDF page render scale that fits the actual available width of
 * a container element, reacting to resizes via ResizeObserver — replaces
 * the fixed `useState(1.3)` every Fill*Page/ExternalFill*Page component
 * used to hardcode. At PAGE_WIDTH = 612 (every one of these forms is US
 * Letter), that fixed 1.3 rendered each page ~796px wide regardless of
 * screen size, clipping the document — and every input/signature box
 * overlaid on it, all of which already position themselves as `* scale`
 * relative to the page — off mobile screens with no way to reach the
 * hidden part.
 *
 * `maxScale` preserves each page's existing desktop appearance (the old
 * hardcoded 1.3) as an upper bound, so nothing changes on a wide screen;
 * narrow ones shrink to fit instead of overflowing.
 *
 * `containerRef` is a CALLBACK ref, not a plain useRef — every one of
 * these Fill*Page components mounts its document behind a `loading`
 * gate ({loading ? <Spinner/> : ... : <div ref={containerRef}>...}), so
 * the container element doesn't exist yet on this hook's first render. A
 * plain useRef's `.current` changing later doesn't re-trigger an effect,
 * so the ResizeObserver would never get attached at all; a callback ref
 * fires (and updates this state, re-running the effect below) the moment
 * React actually attaches the node, however many renders later that is.
 */
export function useResponsivePdfScale(pageWidthPt: number, maxScale = 1.3, minScale = 0.35) {
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(maxScale);

  useEffect(() => {
    if (!containerEl) return;
    const compute = () => {
      const available = containerEl.clientWidth;
      if (!available) return;
      // Small horizontal breathing room so the page doesn't touch the
      // container's own edges.
      const fit = (available - 16) / pageWidthPt;
      setScale(Math.min(maxScale, Math.max(minScale, fit)));
    };
    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(containerEl);
    window.addEventListener("resize", compute);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", compute);
    };
  }, [containerEl, pageWidthPt, maxScale, minScale]);

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setContainerEl(node);
  }, []);

  return { scale, containerRef };
}
