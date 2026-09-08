import { createFileRoute } from "@tanstack/react-router";
import { ExternalFillVehicleUseAgreementPage } from "@/components/ExternalFillVehicleUseAgreementPage";

export const Route = createFileRoute("/fill-vehicle-use-agreement-external/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Vehicle Use Agreement — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ExternalFillVehicleUseAgreementPage docId={docId} />;
}
