import { createFileRoute } from "@tanstack/react-router";
import { FillContractorDataPage } from "@/components/FillContractorDataPage";

export const Route = createFileRoute("/fill-contractor-data/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Contractor Data — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillContractorDataPage docId={docId} />;
}
