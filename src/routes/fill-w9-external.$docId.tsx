import { createFileRoute } from "@tanstack/react-router";
import { ExternalFillW9Page } from "@/components/ExternalFillW9Page";

export const Route = createFileRoute("/fill-w9-external/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Fill W-9 — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ExternalFillW9Page docId={docId} />;
}
