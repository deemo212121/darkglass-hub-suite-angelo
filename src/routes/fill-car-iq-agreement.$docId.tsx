import { createFileRoute } from "@tanstack/react-router";
import { FillCarIqAgreementPage } from "@/components/FillCarIqAgreementPage";

export const Route = createFileRoute("/fill-car-iq-agreement/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Car IQ Technician Agreement — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillCarIqAgreementPage docId={docId} />;
}
