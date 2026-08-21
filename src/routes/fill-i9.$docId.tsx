import { createFileRoute } from "@tanstack/react-router";
import { FillI9Page } from "@/components/FillI9Page";

export const Route = createFileRoute("/fill-i9/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Fill I-9 — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillI9Page docId={docId} />;
}
