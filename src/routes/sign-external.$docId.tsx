import { createFileRoute } from "@tanstack/react-router";
import { ExternalSignDocumentPage } from "@/components/ExternalSignDocumentPage";

export const Route = createFileRoute("/sign-external/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Sign Document — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ExternalSignDocumentPage docId={docId} />;
}
