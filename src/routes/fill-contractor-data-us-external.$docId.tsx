import { createFileRoute } from "@tanstack/react-router";
import { ExternalFillContractorDataUsPage } from "@/components/ExternalFillContractorDataUsPage";

export const Route = createFileRoute("/fill-contractor-data-us-external/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Contractor Data (US) — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ExternalFillContractorDataUsPage docId={docId} />;
}
