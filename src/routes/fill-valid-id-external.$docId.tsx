import { createFileRoute } from "@tanstack/react-router";
import { ExternalFillValidIdPage } from "@/components/ExternalFillValidIdPage";

export const Route = createFileRoute("/fill-valid-id-external/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Valid ID — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ExternalFillValidIdPage docId={docId} />;
}
