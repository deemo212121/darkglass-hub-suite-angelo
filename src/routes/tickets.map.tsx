import { createFileRoute, Navigate } from "@tanstack/react-router";
import { TicketListMap } from "@/components/TicketListMap";
import { useAuth } from "@/lib/auth";
import { useRedirectGuard } from "@/lib/useRedirectGuard";

export const Route = createFileRoute("/tickets/map")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Ticket Map — Admin Hub Solutions" }],
  }),
  component: TicketMapPage,
});

function TicketMapPage() {
  const { ready, email } = useAuth();
  // Guards the <Navigate> below against firing more than once per distinct
  // target — see useRedirectGuard.ts for why this is necessary.
  const redirectOnce = useRedirectGuard();
  if (!ready) return null;
  if (!email) return redirectOnce("/landing") ? <Navigate to="/landing" replace /> : null;
  return <TicketListMap />;
}
