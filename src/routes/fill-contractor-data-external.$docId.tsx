import { createFileRoute } from "@tanstack/react-router";
import { ExternalFillContractorDataPage } from "@/components/ExternalFillContractorDataPage";

export const Route = createFileRoute("/fill-contractor-data-external/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Contractor Data — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ExternalFillContractorDataPage docId={docId} />;
}
