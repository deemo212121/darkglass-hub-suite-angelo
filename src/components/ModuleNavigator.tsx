/**
 * Floating module switcher. Lives on every authenticated page via a portal
 * to document.body, sitting just below the sticky header on the right side
 * (NOT inside the header itself).
 *
 *   1. Hover the "Modules" pill — it expands sideways into the 6 top-level
 *      modules (Dashboard / Tickets / Parts / Claims / Report / Admin).
 *   2. Hover any module name — a second-level dropdown opens with all the
 *      submodules under it. Each entry is a real Link to /m/<m>/<sub>.
 *
 * Hover handling uses a small close timer so the strip doesn't flicker
 * shut when the cursor moves between the pill, the modules, and a
 * submodule dropdown.
 *
 * Positioning: we anchor to the same right edge as the user pill in the
 * header (the rightmost element inside the header's `max-w-[1400px]`
 * container). We compute that edge dynamically from the actual header
 * size, so the Modules pill stays perfectly aligned with the user pill
 * at every viewport width.
 */

import { Link } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LayoutGrid } from "lucide-react";
import { MODULES, type ModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";

// Header's inner container in AppHeader: `max-w-[1400px] mx-auto px-6`.
// We mirror those constants here so the floating navigator's right edge
// always lines up with the user pill's right edge.
const HEADER_MAX_WIDTH = 1400;
const HEADER_INNER_PADDING = 24; // px-6
// Sticky header is `py-3` over a flex row of ~h-9 items → ≈ 64px total.
// Add some breathing room below it so the Modules pill doesn't touch the
// nav bar's bottom edge.
const HEADER_HEIGHT = 64;
const TOP_OFFSET = HEADER_HEIGHT + 14;

function useRightEdgePx() {
  const [right, setRight] = useState<number>(HEADER_INNER_PADDING);

  useLayoutEffect(() => {
    const update = () => {
      const vw = window.innerWidth || document.documentElement.clientWidth;
      // How much of the viewport is empty on either side of the inner
      // header container? max-w-[1400px] mx-auto centers it, so the empty
      // gutter on the right is (vw - innerWidth) / 2, plus the inner px-6.
      const innerWidth = Math.min(vw, HEADER_MAX_WIDTH);
      const sideGutter = (vw - innerWidth) / 2;
      setRight(sideGutter + HEADER_INNER_PADDING);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return right;
}

export function ModuleNavigator() {
  const { ready, email } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [activeModule, setActiveModule] = useState<ModuleDef | null>(null);
  const closeTimer = useRef<number | null>(null);
  const rightPx = useRightEdgePx();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    return () => {
      if (closeTimer.current !== null) {
        window.clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
    };
  }, []);

  if (!ready || !email || !mounted) return null;

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      setExpanded(false);
      setActiveModule(null);
    }, 180);
  };

  const node = (
    <div
      // Fixed at viewport-top, just under the sticky header. Right edge
      // matches the user pill's right edge so the two visually align.
      style={{
        position: "fixed",
        top: TOP_OFFSET,
        right: `${rightPx}px`,
        zIndex: 60,
        pointerEvents: "auto",
      }}
      onMouseEnter={() => { cancelClose(); setExpanded(true); }}
      onMouseLeave={scheduleClose}
    >
      <div className="flex items-center justify-end gap-1">
        {expanded && (
          <div className="flex items-stretch overflow-visible">
            {MODULES.map((m) => {
              const isActive = activeModule?.slug === m.slug;
              return (
                <div
                  key={m.slug}
                  className="relative"
                  onMouseEnter={() => { cancelClose(); setActiveModule(m); }}
                  onMouseLeave={scheduleClose}
                >
                  <Link
                    to="/m/$module"
                    params={{ module: m.slug }}
                    className={`group flex items-center gap-1.5 px-2.5 py-1 mx-0.5 rounded-full border text-[11px] font-semibold transition-colors backdrop-blur ${
                      isActive
                        ? "bg-slate-700/85 border-white/30 text-white"
                        : "bg-slate-900/80 border-white/15 text-slate-300 hover:text-white hover:border-white/25"
                    }`}
                    title={m.tagline}
                  >
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: m.accent }}
                    />
                    <span>{m.label}</span>
                  </Link>

                  {isActive && m.submodules.length > 0 && (
                    <div
                      className="absolute right-0 top-full mt-1.5 z-50 min-w-[16rem] max-h-[60vh] overflow-y-auto rounded-xl border border-white/10 bg-slate-900/95 backdrop-blur-md shadow-2xl py-1.5"
                      onMouseEnter={cancelClose}
                      onMouseLeave={scheduleClose}
                    >
                      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-slate-500 border-b border-white/5">
                        {m.label}
                      </div>
                      {m.submodules.map((s) => (
                        <Link
                          key={s.slug}
                          to="/m/$module/$submodule"
                          params={{ module: m.slug, submodule: s.slug }}
                          className="block px-3 py-1.5 text-[12px] text-slate-200 hover:bg-white/10 hover:text-white truncate"
                          title={s.description}
                        >
                          {s.title}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <button
          type="button"
          aria-label="Quick module navigator"
          className="flex items-center gap-1.5 rounded-full bg-slate-900/85 border border-white/15 px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:text-white hover:border-white/30 transition-colors shadow-md backdrop-blur"
          onClick={() => setExpanded((e) => !e)}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          <span>Modules</span>
        </button>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
