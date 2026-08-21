import { createFileRoute } from "@tanstack/react-router";
import { ExternalFillVehicleAgreementPage } from "@/components/ExternalFillVehicleAgreementPage";

export const Route = createFileRoute("/fill-vehicle-agreement-external/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Company Vehicle Use Agreement — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ExternalFillVehicleAgreementPage docId={docId} />;
}
