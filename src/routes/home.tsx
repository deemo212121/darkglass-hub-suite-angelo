import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useAuth } from "@/lib/auth";
import { MODULES } from "@/lib/modules";
import { ArrowRight, Settings } from "lucide-react";
import { HomeToday } from "@/components/home/HomeToday";
import { useAttention, badgeText } from "@/lib/attention";
import { moduleIcon } from "@/lib/moduleIcons";
import logoUrl from "@/assets/logo.png";
import { useEffect, useRef, useState } from "react";
import { runTour, takeQueuedTour } from "@/lib/tours/runTour";
import { DESKTOP_GETTING_STARTED_TOUR, GETTING_STARTED_TARGET } from "@/lib/tours/desktopTours";
import { shouldUseMobile } from "@/lib/device";
import { isModuleAllowed, isModuleAllowedForTrainee, isModuleAllowedForFrozen } from "@/lib/roleLabels";
import { canAccessSubmodule } from "@/lib/submoduleAccess";
import { useModuleRoleGateOverrides } from "@/lib/moduleAccess";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { ModuleAccessQuickEditModal } from "@/components/ModuleAccessQuickEditModal";

export const Route = createFileRoute("/home")({
  ssr: false,
  head: () => ({ meta: [{ title: "Home — Admin Hub Solutions" }] }),
  component: Home,
});

function Home() {
  const { ready, email, role, extraRoles, isTrainee, isFrozen } = useAuth();
  // Re-render when an admin changes module access live (the tile filters
  // below read the override cache synchronously).
  useModuleRoleGateOverrides();
  const navigate = useNavigate();
  // Only an actual admin tier can reassign who sees a module — same gate
  // Accessibility Management itself sits behind. Super Admin always passes
  // isModuleAllowed/canAccessSubmodule regardless of this page's own
  // overrides, so showing the gear to a lower role would let them open an
  // editor whose changes wouldn't even affect their own access to see it.
  const canManageAccess = role === "ADMIN" || role === "SUPERADMIN";
  const [accessModalFor, setAccessModalFor] = useState<{ mod: ModuleDef; submodule?: SubModuleDef } | null>(null);
  const pageCounts = useAttention()?.pageCounts ?? {};

  useEffect(() => {
    if (!ready) return;
    
    if (!email) {
      navigate({ to: "/landing", replace: true });
      return;
    }
    
    // Redirect the platform-level SuperSuperAdmin to their console
    // (case-insensitive check) — the per-company SUPERADMIN role lands on
    // the normal dashboard below like any other company role.
    if (role && role.toUpperCase() === "SUPERSUPERADMIN") {
      navigate({ to: "/superadmin", replace: true });
      return;
    }

    // Phone users (no desktop override) get the mobile ticket experience.
    if (shouldUseMobile()) {
      navigate({ to: "/mobile", replace: true });
      return;
    }
  }, [ready, email, role, navigate]);
  
  // Guides → Getting Started hands its tour over to this page.
  const tourStartedRef = useRef(false);
  useEffect(() => {
    if (!ready || !email || tourStartedRef.current) return;
    if (takeQueuedTour(GETTING_STARTED_TARGET) !== DESKTOP_GETTING_STARTED_TOUR.id) return;
    tourStartedRef.current = true;
    window.setTimeout(() => void runTour(DESKTOP_GETTING_STARTED_TOUR), 900);
  }, [ready, email]);

  if (!ready) return null;
  if (!email) return null;
  if (role && role.toUpperCase() === "SUPERSUPERADMIN") return null;
  
  return (
    <>
      <AppHeader />
      {/* Brand watermark: the logo's shape as a faint silhouette behind the page. */}
      <div className="home-watermark" style={{ ["--logo" as string]: `url("${logoUrl}")` }} aria-hidden />
      <main className="relative z-[1] max-w-[1400px] mx-auto px-6 py-8 page-fade-in">
        <HomeToday />
        <h2 className="home-section-title">Your modules</h2>
        <div data-tour="home-modules" className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {MODULES.filter((m) => isModuleAllowed(role, m.slug, extraRoles) && isModuleAllowedForTrainee(isTrainee, m.slug) && isModuleAllowedForFrozen(isFrozen, m.slug)).map((m) => {
            const visibleSubmodules = m.submodules.filter((s) => !s.hiddenFromGrid && canAccessSubmodule(role, extraRoles, m.slug, s, isTrainee, isFrozen));
            const Icon = moduleIcon(m.slug);
            const moduleCount = visibleSubmodules.reduce((n, s) => n + (pageCounts[`${m.slug}/${s.slug}`] ?? 0), 0);
            return (
            <div
              key={m.slug}
              data-tour={`home-module-${m.slug}`}
              className="module-card home-module group relative flex h-full flex-col"
              style={{ ["--accent" as string]: m.accent }}
            >
              <div className="flex items-center gap-3 mb-3">
                <Link to="/m/$module" params={{ module: m.slug }} className="home-module-icon" aria-hidden tabIndex={-1}>
                  <Icon />
                </Link>
                {canManageAccess && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setAccessModalFor({ mod: m });
                    }}
                    title={`Manage who can access ${m.label}`}
                    aria-label={`Manage who can access ${m.label}`}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-[var(--color-panel-border)] bg-[var(--color-panel)] text-muted-foreground hover:text-foreground hover:bg-[var(--color-secondary)] transition-colors"
                  >
                    <Settings className="h-3 w-3" />
                  </button>
                )}
                <Link to="/m/$module" params={{ module: m.slug }} className="flex flex-1 items-center gap-2 min-w-0">
                  <h2 className="text-lg font-semibold truncate">{m.label}</h2>
                  {moduleCount > 0 && <span className="home-badge">{badgeText(moduleCount)}</span>}
                  <ArrowRight className="ml-auto h-4 w-4 opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition shrink-0" />
                </Link>
              </div>
              <Link to="/m/$module" params={{ module: m.slug }} className="block">
                <p className="text-sm text-muted-foreground mb-4">{m.tagline}</p>
              </Link>
              <ul className="home-sublinks">
                {visibleSubmodules.slice(0, 6).map((s) => (
                  <li key={s.slug} className="group/sub flex items-center gap-1 min-w-0">
                    <Link
                      to="/m/$module/$submodule"
                      params={{ module: m.slug, submodule: s.slug }}
                      className="home-sublink"
                    >
                      <span className="truncate">{s.title}</span>
                      {(pageCounts[`${m.slug}/${s.slug}`] ?? 0) > 0 && <span className="home-badge home-badge--sm">{badgeText(pageCounts[`${m.slug}/${s.slug}`])}</span>}
                    </Link>
                    {canManageAccess && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setAccessModalFor({ mod: m, submodule: s });
                        }}
                        title={`Manage who can access ${s.title}`}
                        aria-label={`Manage who can access ${s.title}`}
                        className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-muted-foreground opacity-0 group-hover/sub:opacity-100 hover:text-foreground transition-opacity"
                      >
                        <Settings className="h-3 w-3" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {visibleSubmodules.length > 6 && (
                <Link to="/m/$module" params={{ module: m.slug }} className="home-more">
                  +{visibleSubmodules.length - 6} more in {m.label}
                </Link>
              )}
            </div>
            );
          })}
        </div>
      </main>
      <Footer />
      {accessModalFor && (
        <ModuleAccessQuickEditModal mod={accessModalFor.mod} submodule={accessModalFor.submodule} onClose={() => setAccessModalFor(null)} />
      )}
    </>
  );
}
