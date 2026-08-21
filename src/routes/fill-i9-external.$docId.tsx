import { createFileRoute } from "@tanstack/react-router";
import { ExternalFillI9Page } from "@/components/ExternalFillI9Page";

export const Route = createFileRoute("/fill-i9-external/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Fill I-9 — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ExternalFillI9Page docId={docId} />;
}
