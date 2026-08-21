import { createFileRoute } from "@tanstack/react-router";
import { FillVehicleAgreementPage } from "@/components/FillVehicleAgreementPage";

export const Route = createFileRoute("/fill-vehicle-agreement/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Company Vehicle Use Agreement — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillVehicleAgreementPage docId={docId} />;
}
