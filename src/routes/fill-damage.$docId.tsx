import { createFileRoute } from "@tanstack/react-router";
import { FillDamagePage } from "@/components/FillDamagePage";

export const Route = createFileRoute("/fill-damage/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Damage Agreement — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillDamagePage docId={docId} />;
}
