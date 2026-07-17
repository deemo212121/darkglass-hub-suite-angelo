import { createFileRoute } from "@tanstack/react-router";
import { FillW4Page } from "@/components/FillW4Page";

export const Route = createFileRoute("/fill-w4/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Fill W-4 — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillW4Page docId={docId} />;
}
