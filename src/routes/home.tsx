import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useAuth } from "@/lib/auth";
import { MODULES } from "@/lib/modules";
import { ArrowRight } from "lucide-react";
import { useEffect } from "react";
import { shouldUseMobile } from "@/lib/device";
import { isModuleAllowed, isSubmoduleAllowed } from "@/lib/roleLabels";

export const Route = createFileRoute("/home")({
  ssr: false,
  head: () => ({ meta: [{ title: "Home — Admin Hub Solutions" }] }),
  component: Home,
});

function Home() {
  const { ready, email, role } = useAuth();
  const navigate = useNavigate();
  
  useEffect(() => {
    if (!ready) return;
    
    if (!email) {
      navigate({ to: "/landing", replace: true });
      return;
    }
    
    // Redirect SuperAdmin to their dashboard (case-insensitive check)
    if (role && role.toUpperCase() === "SUPERADMIN") {
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
  if (role && role.toUpperCase() === "SUPERADMIN") return null;
  
  return (
    <>
      <AppHeader />
      <main className="max-w-[1400px] mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-semibold tracking-tight">Welcome back</h1>
          <p className="text-muted-foreground">Choose a module to get started.</p>
        </div>
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {MODULES.filter((m) => isModuleAllowed(role, m.slug)).map((m) => {
            const visibleSubmodules = m.submodules.filter((s) => isSubmoduleAllowed(role, m.slug, s.slug));
            return (
            <Link key={m.slug} to="/m/$module" params={{ module: m.slug }} className="module-card group">
              <div className="flex items-center gap-3 mb-3">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: m.accent }} />
                <h2 className="text-xl font-semibold">{m.label}</h2>
                <ArrowRight className="ml-auto h-4 w-4 opacity-60 group-hover:translate-x-1 transition" />
              </div>
              <p className="text-sm text-muted-foreground mb-4">{m.tagline}</p>
              <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                {visibleSubmodules.slice(0, 6).map((s) => (
                  <li key={s.slug} className="text-foreground/80 truncate">• {s.title}</li>
                ))}
              </ul>
              {visibleSubmodules.length > 6 && (
                <div className="text-xs text-muted-foreground mt-2">+{visibleSubmodules.length - 6} more</div>
              )}
            </Link>
            );
          })}
        </div>
      </main>
      <Footer />
    </>
  );
}
