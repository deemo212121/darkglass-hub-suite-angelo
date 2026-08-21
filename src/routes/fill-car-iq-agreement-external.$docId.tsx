import { createFileRoute } from "@tanstack/react-router";
import { ExternalFillCarIqAgreementPage } from "@/components/ExternalFillCarIqAgreementPage";

export const Route = createFileRoute("/fill-car-iq-agreement-external/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Car IQ Technician Agreement — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ExternalFillCarIqAgreementPage docId={docId} />;
}
