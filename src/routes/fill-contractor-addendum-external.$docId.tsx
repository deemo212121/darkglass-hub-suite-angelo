import { createFileRoute } from "@tanstack/react-router";
import { ExternalFillContractorAddendumPage } from "@/components/ExternalFillContractorAddendumPage";

export const Route = createFileRoute("/fill-contractor-addendum-external/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Master Independent Contractor Subcontractor Agreement Addendum — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ExternalFillContractorAddendumPage docId={docId} />;
}
