import { createFileRoute } from "@tanstack/react-router";
import { ExternalFillW4RPage } from "@/components/ExternalFillW4RPage";

export const Route = createFileRoute("/fill-w4r-external/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Fill W-4R — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ExternalFillW4RPage docId={docId} />;
}
