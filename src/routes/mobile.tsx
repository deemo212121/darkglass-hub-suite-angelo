import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { MobileTechApp } from "@/components/mobile/MobileTechApp";

export const Route = createFileRoute("/mobile")({
  ssr: false,
  head: () => ({ meta: [{ title: "Mobile — Admin Hub Solutions" }] }),
  component: MobilePage,
});

function MobilePage() {
  const { ready, email } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!ready) return;
    if (!email) navigate({ to: "/landing", replace: true });
  }, [ready, email, navigate]);

  if (!ready || !email) return null;
  return <MobileTechApp />;
}
