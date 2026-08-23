import { createFileRoute } from "@tanstack/react-router";
import { FillMileageFuelPage } from "@/components/FillMileageFuelPage";

export const Route = createFileRoute("/fill-mileage-fuel/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Mileage & Fuel Policy Agreement — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillMileageFuelPage docId={docId} />;
}
