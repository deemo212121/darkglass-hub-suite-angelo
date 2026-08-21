import { createFileRoute } from "@tanstack/react-router";
import { ExternalFillW4Page } from "@/components/ExternalFillW4Page";

export const Route = createFileRoute("/fill-w4-external/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Fill W-4 — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ExternalFillW4Page docId={docId} />;
}
