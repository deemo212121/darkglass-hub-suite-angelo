import { createFileRoute } from "@tanstack/react-router";
import { FillVehicleUseAgreementPage } from "@/components/FillVehicleUseAgreementPage";

export const Route = createFileRoute("/fill-vehicle-use-agreement/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Vehicle Use Agreement — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillVehicleUseAgreementPage docId={docId} />;
}
