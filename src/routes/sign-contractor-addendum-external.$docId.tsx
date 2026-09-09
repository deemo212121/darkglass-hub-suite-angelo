import { createFileRoute } from "@tanstack/react-router";
import { ExternalSignContractorAddendumPage } from "@/components/ExternalSignContractorAddendumPage";

export const Route = createFileRoute("/sign-contractor-addendum-external/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Master Independent Contractor Subcontractor Agreement Addendum — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ExternalSignContractorAddendumPage docId={docId} />;
}
