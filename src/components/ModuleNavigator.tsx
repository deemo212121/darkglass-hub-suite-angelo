/**
 * Module switcher, rendered inside the AppHeader's single row right after
 * the logo: a "Modules" toggle plus (Super Admins only) the "View as" role
 * selector, side by side.
 *
 *   1. Click "Modules" — toggles a strip of the top-level modules (Dashboard /
 *      CSR / Tickets / ...) that drops down just below the header, starting
 *      under the Modules button.
 *   2. Hover any module — a second-level dropdown opens with the submodules
 *      under it. Each entry is a real Link to /m/<m>/<sub>.
 *
 * The submodule dropdown uses a small close timer so it doesn't flicker
 * shut when the cursor moves between a module and its dropdown.
 *
 * "View as" drives auth.tsx's viewAsRole preview, which swaps
 * `role`/`extraRoles` everywhere in the app (this strip included) so a
 * Super Admin can see exactly what nav/modules a given role sees. See
 * ViewAsRoleBanner.tsx for the "still previewing" reminder.
 */

import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { LayoutGrid, Eye, ChevronDown } from "lucide-react";
import { MODULES, type ModuleDef, type SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { canAccessSubmodule } from "@/lib/submoduleAccess";
import { useModuleRoleGateOverrides } from "@/lib/moduleAccess";
import { ROLE_OPTIONS, isModuleAllowed, isModuleAllowedForTrainee, isModuleAllowedForFrozen } from "@/lib/roleLabels";

const SUPER_ROLES = new Set(["SUPERADMIN", "SUPERSUPERADMIN"]);

export function ModuleNavigator() {
  const { ready, email, role, extraRoles, isTrainee, isFrozen, realRole, viewAsRole, setViewAsRole } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [activeModule, setActiveModule] = useState<ModuleDef | null>(null);
  const closeTimer = useRef<number | null>(null);
  // Re-render when an admin changes module access live (the strip's filters
  // below read the override cache synchronously).
  useModuleRoleGateOverrides();

  useEffect(() => {
    return () => {
      if (closeTimer.current !== null) {
        window.clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
    };
  }, []);

  if (!ready || !email) return null;

  // Same full gate m.$module.$submodule.tsx itself enforces (see
  // submoduleAccess.ts) — filtering the strip, not just the destination
  // page, keeps what's listed in sync with what's actually reachable.
  const visibleSubmodulesFor = (m: ModuleDef): SubModuleDef[] =>
    m.submodules.filter((s) => {
      if (s.hiddenFromGrid) return false;
      return canAccessSubmodule(role, extraRoles, m.slug, s, isTrainee, isFrozen);
    });

  // Same module-level "Whole Module" front-door gate home.tsx's tile grid
  // checks before ever listing a module (see home.tsx line ~67) —
  // canAccessSubmodule/isSubmoduleAllowed only enforces this for CSR-
  // restricted roles, so without this explicit check here a module hidden
  // via Accessibility Management's "Whole Module" box for a non-CSR role
  // would still show up in this strip even though the home page and the
  // module route itself both block it.
  const moduleAllowed = (m: ModuleDef) =>
    isModuleAllowed(role, m.slug, extraRoles) && isModuleAllowedForTrainee(isTrainee, m.slug) && isModuleAllowedForFrozen(isFrozen, m.slug);

  // A module only gets a pill if its front door is open AND it has at
  // least one submodule this viewer can actually open — an empty dropdown
  // isn't useful to show.
  const visibleModules = MODULES.filter((m) => moduleAllowed(m) && visibleSubmodulesFor(m).length > 0);

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  // Only closes a module's submodule dropdown — the strip itself stays open
  // until the Modules pill is clicked again.
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setActiveModule(null), 180);
  };

  return (
    <div className="relative flex shrink-0 items-center gap-2">
      <button
        type="button"
        aria-label="Quick module navigator"
        aria-expanded={expanded}
        title={expanded ? "Hide modules" : "Show modules"}
        className={`flex h-9 items-center gap-2 rounded-full border px-3.5 text-xs font-semibold transition-colors ${
          expanded
            ? "bg-blue-600 border-blue-400/60 text-white"
            : "border-[var(--color-panel-border)] bg-[var(--color-panel)] text-foreground hover:bg-[var(--color-secondary)]"
        }`}
        onClick={() => {
          setExpanded((e) => !e);
          setActiveModule(null);
        }}
      >
        <LayoutGrid className="h-4 w-4" />
        <span>Modules</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {realRole && SUPER_ROLES.has(realRole) && (
        <div
          className={`hidden md:flex h-9 items-center gap-2 rounded-full border px-3.5 ${
            viewAsRole ? "border-violet-400/50 bg-violet-950/85" : "border-[var(--color-panel-border)] bg-[var(--color-panel)]"
          }`}
          title="Preview module/nav access as another role — Super Admin only"
        >
          <Eye className={`h-4 w-4 shrink-0 ${viewAsRole ? "text-violet-300" : "text-muted-foreground"}`} />
          <select
            value={viewAsRole ?? ""}
            onChange={(e) => setViewAsRole(e.target.value || null)}
            aria-label="View as role"
            className={`bg-transparent text-xs font-semibold outline-none max-w-[10rem] cursor-pointer ${
              viewAsRole ? "text-violet-100" : "text-muted-foreground"
            }`}
          >
            <option value="" className="bg-slate-900 text-slate-300">View as…</option>
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value} className="bg-slate-900 text-slate-100">
                {r.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {expanded && (
        <div className="absolute left-0 top-full mt-2.5 z-50 flex items-stretch whitespace-nowrap rounded-full border border-white/10 bg-slate-950/95 backdrop-blur-md shadow-2xl px-1 py-1">
          {visibleModules.map((m) => {
            const isActive = activeModule?.slug === m.slug;
            const visibleSubmodules = visibleSubmodulesFor(m);
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
                  className={`flex items-center gap-1.5 px-2.5 py-1 mx-0.5 rounded-full border text-[11px] font-semibold transition-colors ${
                    isActive
                      ? "bg-slate-700/85 border-white/30 text-white"
                      : "bg-slate-900/80 border-white/15 text-slate-300 hover:text-white hover:border-white/25"
                  }`}
                  title={m.tagline}
                >
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: m.accent }} />
                  <span>{m.label}</span>
                </Link>

                {isActive && visibleSubmodules.length > 0 && (
                  <div
                    className="absolute left-0 top-full mt-1.5 z-50 min-w-[16rem] max-h-[60vh] overflow-y-auto rounded-xl border border-white/10 bg-slate-900/95 backdrop-blur-md shadow-2xl py-1.5"
                    onMouseEnter={cancelClose}
                    onMouseLeave={scheduleClose}
                  >
                    <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-slate-500 border-b border-white/5">
                      {m.label}
                    </div>
                    {visibleSubmodules.map((s) => (
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
    </div>
  );
}
