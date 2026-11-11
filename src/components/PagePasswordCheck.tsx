/**
 * Wraps every module page (m.$module.$submodule.tsx). When a Super Admin has
 * added this page on Password and Email Management → Password Checks, the
 * page asks for the person's own login password before it shows — every time
 * it's opened, or once per browser session, as set there. Cancel goes back.
 *
 * Keyed by page in the route, so "every time" means every time the page is
 * opened (not every re-render).
 */
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { needsPassword, pageCheckKey, usePasswordChecks } from "@/lib/passwordChecks";
import { PasswordGateModal } from "@/components/PasswordGateModal";
import { BrandedLoader } from "@/components/BrandedLoader";

/** Don't hold a page forever if the settings never arrive (offline, not set up). */
const WAIT_FOR_SETTINGS_MS = 4000;

export function PagePasswordCheck({ mod, sub, children }: { mod: ModuleDef; sub: SubModuleDef; children: ReactNode }) {
  const navigate = useNavigate();
  const { status, rows } = usePasswordChecks();
  const key = pageCheckKey(mod.slug, sub.slug);
  const [unlocked, setUnlocked] = useState(false);
  const [gaveUpWaiting, setGaveUpWaiting] = useState(false);

  useEffect(() => {
    if (status === "ready") return;
    const t = window.setTimeout(() => setGaveUpWaiting(true), WAIT_FOR_SETTINGS_MS);
    return () => window.clearTimeout(t);
  }, [status]);

  if (status !== "ready" && !gaveUpWaiting) return <BrandedLoader label="Loading page..." delayMs={150} />;
  if (unlocked || !needsPassword(key, rows)) return <>{children}</>;

  return (
    <>
      <main className="flex-1 flex items-center justify-center px-6 py-24 text-muted-foreground">
        <div className="flex items-center gap-2 text-sm">
          <Lock className="h-4 w-4" /> {sub.title} asks for your password.
        </div>
      </main>
      <PasswordGateModal
        gateKey={key}
        title={sub.title}
        onUnlocked={() => setUnlocked(true)}
        onCancel={() => navigate({ to: "/m/$module", params: { module: mod.slug } })}
      />
    </>
  );
}
