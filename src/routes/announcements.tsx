import { createFileRoute, Navigate } from "@tanstack/react-router";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useAuth } from "@/lib/auth";
import { AnnouncementsPage } from "@/components/AnnouncementsPage";

export const Route = createFileRoute("/announcements")({
  head: () => ({ meta: [{ title: "Announcements — Admin Hub Solutions" }] }),
  component: AnnouncementsRoute,
});

function AnnouncementsRoute() {
  const { ready, email } = useAuth();
  if (!ready) return null;
  if (!email) return <Navigate to="/landing" />;

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <AnnouncementsPage />
      <Footer />
    </div>
  );
}
