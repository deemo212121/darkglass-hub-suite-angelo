import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useAuth } from "@/lib/auth";
import { MODULES } from "@/lib/modules";
import { ArrowRight, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { shouldUseMobile } from "@/lib/device";
import { isModuleAllowed, isModuleAllowedForTrainee, isModuleAllowedForFrozen } from "@/lib/roleLabels";
import { canAccessSubmodule } from "@/lib/submoduleAccess";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { ModuleAccessQuickEditModal } from "@/components/ModuleAccessQuickEditModal";

export const Route = createFileRoute("/home")({
  ssr: false,
  head: () => ({ meta: [{ title: "Home — Admin Hub Solutions" }] }),
  component: Home,
});

function Home() {
  const { ready, email, role, extraRoles, isTrainee, isFrozen } = useAuth();
  const navigate = useNavigate();
  // Only an actual admin tier can reassign who sees a module — same gate
  // Accessibility Management itself sits behind. Super Admin always passes
  // isModuleAllowed/canAccessSubmodule regardless of this page's own
  // overrides, so showing the gear to a lower role would let them open an
  // editor whose changes wouldn't even affect their own access to see it.
  const canManageAccess = role === "ADMIN" || role === "SUPERADMIN";
  const [accessModalFor, setAccessModalFor] = useState<{ mod: ModuleDef; submodule?: SubModuleDef } | null>(null);

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
  
  if (!ready) return null;
  if (!email) return null;
  if (role && role.toUpperCase() === "SUPERSUPERADMIN") return null;
  
  return (
    <>
      <AppHeader />
      <main className="max-w-[1400px] mx-auto px-6 py-8 page-fade-in">
        <div className="mb-6">
          <h1 className="text-3xl font-semibold tracking-tight">Welcome back</h1>
          <p className="text-muted-foreground">Choose a module to get started.</p>
        </div>
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {MODULES.filter((m) => isModuleAllowed(role, m.slug, extraRoles) && isModuleAllowedForTrainee(isTrainee, m.slug) && isModuleAllowedForFrozen(isFrozen, m.slug)).map((m) => {
            const visibleSubmodules = m.submodules.filter((s) => !s.hiddenFromGrid && canAccessSubmodule(role, extraRoles, m.slug, s, isTrainee, isFrozen));
            return (
            <div key={m.slug} className="module-card group relative flex h-full flex-col">
              <div className="flex items-center gap-2.5 mb-3">
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
                <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: m.accent }} />
                <Link to="/m/$module" params={{ module: m.slug }} className="flex flex-1 items-center gap-2 min-w-0">
                  <h2 className="text-xl font-semibold truncate">{m.label}</h2>
                  <ArrowRight className="ml-auto h-4 w-4 opacity-60 group-hover:translate-x-1 transition shrink-0" />
                </Link>
              </div>
              <Link to="/m/$module" params={{ module: m.slug }} className="block">
                <p className="text-sm text-muted-foreground mb-4">{m.tagline}</p>
              </Link>
              <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                {visibleSubmodules.slice(0, 6).map((s) => (
                  <li key={s.slug} className="group/sub flex items-center gap-1 min-w-0">
                    <Link
                      to="/m/$module"
                      params={{ module: m.slug }}
                      className="text-foreground/80 hover:text-foreground truncate min-w-0"
                    >
                      • {s.title}
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
                <Link to="/m/$module" params={{ module: m.slug }} className="text-xs text-muted-foreground mt-2 block hover:text-foreground">
                  +{visibleSubmodules.length - 6} more
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
