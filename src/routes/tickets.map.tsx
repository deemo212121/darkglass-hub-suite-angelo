import { createFileRoute, Navigate } from "@tanstack/react-router";
import { TicketListMap } from "@/components/TicketListMap";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/tickets/map")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Ticket Map — Admin Hub Solutions" }],
  }),
  component: TicketMapPage,
});

function TicketMapPage() {
  const { ready, email } = useAuth();
  if (!ready) return null;
  if (!email) return <Navigate to="/landing" replace />;
  return <TicketListMap />;
}
