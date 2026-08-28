import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { MobileTechApp } from "@/components/mobile/MobileTechApp";
import { isDesktopOverride, setMobileMode } from "@/lib/device";

export const Route = createFileRoute("/mobile")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Mobile — Admin Hub Solutions" }],
    links: [{ rel: "manifest", href: "/mobile-manifest.webmanifest" }],
  }),
  component: MobilePage,
});

function MobilePage() {
  const { ready, email } = useAuth();
  const navigate = useNavigate();

  // Reaching /mobile means we're committed to the mobile experience — remember
  // it so a flaky reload (e.g. Brave fingerprint protection) keeps the user
  // here instead of bouncing back to the desktop view. The Desktop Site button
  // clears this and sets the desktop override.
  useEffect(() => {
    if (!isDesktopOverride()) setMobileMode(true);
  }, []);

  // Offline app shell — ONLY registered here, never in __root.tsx, and with
  // an explicit scope of "/mobile" — that's what keeps a desktop/admin
  // session sharing this browser from ever getting one at all. Hand-
  // written service worker (public/mobile-sw.js) rather than a build
  // plugin — see that file's header comment for why. See
  // src/lib/offlineQueue.ts for the auto-sync half of this.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/mobile-sw.js", { scope: "/mobile" })
      .catch((err) => console.warn("Mobile offline shell registration failed:", err));
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!email) navigate({ to: "/landing", replace: true });
  }, [ready, email, navigate]);

  if (!ready || !email) return null;
  return <MobileTechApp />;
}
