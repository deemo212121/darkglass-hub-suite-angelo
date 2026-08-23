import { createFileRoute } from "@tanstack/react-router";
import { ExternalFillMileageFuelPage } from "@/components/ExternalFillMileageFuelPage";

export const Route = createFileRoute("/fill-mileage-fuel-external/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Mileage & Fuel Policy Agreement — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ExternalFillMileageFuelPage docId={docId} />;
}
