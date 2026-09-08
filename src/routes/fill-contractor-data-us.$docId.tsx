import { createFileRoute } from "@tanstack/react-router";
import { FillContractorDataUsPage } from "@/components/FillContractorDataUsPage";

export const Route = createFileRoute("/fill-contractor-data-us/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Contractor Data (US) — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillContractorDataUsPage docId={docId} />;
}
