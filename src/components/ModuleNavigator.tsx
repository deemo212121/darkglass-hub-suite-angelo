/**
 * Floating module switcher. Lives on every authenticated page via a portal
 * to document.body, sitting just below the sticky header on the right side
 * (NOT inside the header itself).
 *
 *   1. Click the "Modules" pill — opens a dropdown listing the 6 top-level
 *      modules (Dashboard / Tickets / Parts / Claims / Report / Admin), each
 *      collapsed by default.
 *   2. Click a module name — expands just that module's submodule links
 *      beneath it. Click it again to collapse. Any number of modules can be
 *      expanded at once; leaving one collapsed keeps its submodules out of
 *      the list entirely instead of forcing a long scroll past everything.
 *
 * Click-based (not hover) throughout — an earlier hover-driven version had
 * to fight a close timer while the cursor moved toward a submodule
 * dropdown's own scrollbar, which is exactly what made a long submodule
 * list ("Claims" has ~18) awkward to scroll. Closes on an outside click.
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
import { LayoutGrid, ChevronDown } from "lucide-react";
import { MODULES } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { isModuleAllowed, isSubmoduleAllowed } from "@/lib/roleLabels";

// Header's inner container in AppHeader: `max-w-[1400px] mx-auto px-6`.
// We mirror those constants here so the floating navigator's right edge
// always lines up with the user pill's right edge.
const HEADER_MAX_WIDTH = 1400;
const HEADER_INNER_PADDING = 24; // px-6
// Fallback only, used before the real header has been measured (or if no
// <header> is found at all).
const FALLBACK_HEADER_HEIGHT = 64;
// Breathing room below the (real, measured) header height so the Modules
// pill doesn't touch the nav bar's bottom edge.
const TOP_GAP = 14;

/**
 * Right edge (to line up with the header's user pill) + top offset (just
 * below the header). Both are measured from the real <header> element via
 * ResizeObserver rather than a hardcoded height constant — a previous
 * version hardcoded ~64px assuming the header was always a single row of
 * h-9 icons, which silently broke (the Modules pill overlapped the header)
 * the moment header content grew taller on any page.
 */
function useHeaderMetrics() {
  const [metrics, setMetrics] = useState<{ right: number; top: number }>({
    right: HEADER_INNER_PADDING,
    top: FALLBACK_HEADER_HEIGHT + TOP_GAP,
  });

  useLayoutEffect(() => {
    const update = () => {
      const vw = window.innerWidth || document.documentElement.clientWidth;
      // How much of the viewport is empty on either side of the inner
      // header container? max-w-[1400px] mx-auto centers it, so the empty
      // gutter on the right is (vw - innerWidth) / 2, plus the inner px-6.
      const innerWidth = Math.min(vw, HEADER_MAX_WIDTH);
      const sideGutter = (vw - innerWidth) / 2;
      const headerEl = document.querySelector("header");
      const headerHeight = headerEl ? headerEl.getBoundingClientRect().height : FALLBACK_HEADER_HEIGHT;
      setMetrics({ right: sideGutter + HEADER_INNER_PADDING, top: headerHeight + TOP_GAP });
    };
    update();
    window.addEventListener("resize", update);

    const headerEl = document.querySelector("header");
    let observer: ResizeObserver | null = null;
    if (headerEl && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(update);
      observer.observe(headerEl);
    }
    return () => {
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, []);

  return metrics;
}

export function ModuleNavigator() {
  const { ready, email, role, extraRoles } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  // Which module sections are expanded — independent of each other, so
  // collapsing one you don't need shrinks the list instead of forcing a
  // scroll past every module's full submodule list at once.
  const [openModules, setOpenModules] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const { right: rightPx, top: topPx } = useHeaderMetrics();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  if (!ready || !email || !mounted) return null;

  // CSR-department roles only get Dashboard/Tickets (see isModuleAllowed) —
  // the actual pages already enforce this, but the quick-nav pill strip
  // rendered every module unconditionally, so a restricted user could still
  // see and click into Parts/Claims/Report/Admin from here even though
  // they'd be blocked on arrival. Filtering the strip itself, not just the
  // destination page, keeps what's hoverable in sync with what's allowed.
  const visibleModules = MODULES.filter((m) => isModuleAllowed(role, m.slug, extraRoles));

  const toggleModule = (slug: string) => {
    setOpenModules((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const node = (
    <div
      ref={containerRef}
      // Fixed at viewport-top, just under the sticky header. Right edge
      // matches the user pill's right edge so the two visually align.
      style={{
        position: "fixed",
        top: topPx,
        right: `${rightPx}px`,
        zIndex: 60,
        pointerEvents: "auto",
      }}
    >
      <div className="flex justify-end">
        <button
          type="button"
          aria-label="Quick module navigator"
          aria-expanded={open}
          className="flex items-center gap-1.5 rounded-full bg-slate-900/85 border border-white/15 px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:text-white hover:border-white/30 transition-colors shadow-md backdrop-blur"
          onClick={() => setOpen((o) => !o)}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          <span>Modules</span>
          <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {open && (
        <div
          data-testid="module-nav-panel"
          className="mt-1.5 w-72 max-h-[70vh] overflow-y-auto rounded-xl border border-white/10 bg-slate-900/95 backdrop-blur-md shadow-2xl py-1.5"
        >
          {visibleModules.map((m) => {
            const isModuleOpen = openModules.has(m.slug);
            // Same hiddenFromGrid convention as the module's own tile grid
            // (m.$module.tsx) — a submodule meant to be reached only via
            // another page's button (e.g. Flash Tech Calendar via Expense
            // Tracking) stays out of this quick-nav list too — plus the
            // CSR allow-list, same as the module filter above.
            const visibleSubmodules = m.submodules.filter(
              (s) => !s.hiddenFromGrid && isSubmoduleAllowed(role, m.slug, s.slug, extraRoles)
            );
            return (
              <div key={m.slug} className="border-b border-white/5 last:border-b-0">
                <button
                  type="button"
                  data-testid="module-nav-row"
                  data-module-slug={m.slug}
                  onClick={() => toggleModule(m.slug)}
                  aria-expanded={isModuleOpen}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] font-semibold text-slate-200 hover:bg-white/5 transition-colors"
                >
                  <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: m.accent }} />
                  <span className="flex-1 truncate">{m.label}</span>
                  <ChevronDown
                    className={`h-3 w-3 shrink-0 text-slate-500 transition-transform ${isModuleOpen ? "rotate-180" : ""}`}
                  />
                </button>

                {isModuleOpen && visibleSubmodules.length > 0 && (
                  <div className="pb-1.5">
                    {visibleSubmodules.map((s) => (
                      <Link
                        key={s.slug}
                        to="/m/$module/$submodule"
                        params={{ module: m.slug, submodule: s.slug }}
                        className="block pl-8 pr-3 py-1.5 text-[12px] text-slate-300 hover:bg-white/10 hover:text-white truncate"
                        title={s.description}
                        onClick={() => setOpen(false)}
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
    </div>
  );

  return createPortal(node, document.body);
}
