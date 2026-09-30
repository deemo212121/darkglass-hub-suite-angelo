import { createFileRoute, Navigate } from "@tanstack/react-router";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useAuth } from "@/lib/auth";
import { useRedirectGuard } from "@/lib/useRedirectGuard";
import { AnnouncementsPage } from "@/components/AnnouncementsPage";

export const Route = createFileRoute("/announcements")({
  head: () => ({ meta: [{ title: "Announcements — Admin Hub Solutions" }] }),
  component: AnnouncementsRoute,
});

function AnnouncementsRoute() {
  const { ready, email } = useAuth();
  // Guards the <Navigate> below against firing more than once per distinct
  // target — see useRedirectGuard.ts for why this is necessary.
  const redirectOnce = useRedirectGuard();
  if (!ready) return null;
  if (!email) return redirectOnce("/landing") ? <Navigate to="/landing" replace /> : null;

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <AnnouncementsPage />
      <Footer />
    </div>
  );
}
