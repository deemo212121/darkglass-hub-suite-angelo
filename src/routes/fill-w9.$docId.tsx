import { createFileRoute } from "@tanstack/react-router";
import { FillW9Page } from "@/components/FillW9Page";

export const Route = createFileRoute("/fill-w9/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Fill W-9 — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillW9Page docId={docId} />;
}
