import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { MobileTechApp } from "@/components/mobile/MobileTechApp";
import { isDesktopOverride, setMobileMode } from "@/lib/device";

export const Route = createFileRoute("/mobile")({
  ssr: false,
  head: () => ({ meta: [{ title: "Mobile — Admin Hub Solutions" }] }),
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

  useEffect(() => {
    if (!ready) return;
    if (!email) navigate({ to: "/landing", replace: true });
  }, [ready, email, navigate]);

  if (!ready || !email) return null;
  return <MobileTechApp />;
}
