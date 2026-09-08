import { createFileRoute } from "@tanstack/react-router";
import { FillContractorAddendumPage } from "@/components/FillContractorAddendumPage";

export const Route = createFileRoute("/fill-contractor-addendum/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Master Independent Contractor Subcontractor Agreement Addendum — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillContractorAddendumPage docId={docId} />;
}
