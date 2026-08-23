import { createFileRoute } from "@tanstack/react-router";
import { ExternalFillDamagePage } from "@/components/ExternalFillDamagePage";

export const Route = createFileRoute("/fill-damage-external/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Damage Agreement — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ExternalFillDamagePage docId={docId} />;
}
