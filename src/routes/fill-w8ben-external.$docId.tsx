import { createFileRoute } from "@tanstack/react-router";
import { ExternalFillW8benPage } from "@/components/ExternalFillW8benPage";

export const Route = createFileRoute("/fill-w8ben-external/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Fill W-8BEN — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ExternalFillW8benPage docId={docId} />;
}
