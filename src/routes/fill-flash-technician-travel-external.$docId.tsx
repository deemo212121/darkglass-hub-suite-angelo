import { createFileRoute } from "@tanstack/react-router";
import { ExternalFillFlashTechnicianTravelPage } from "@/components/ExternalFillFlashTechnicianTravelPage";

export const Route = createFileRoute("/fill-flash-technician-travel-external/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Flash Technician Travel & Out-of-State Policy — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ExternalFillFlashTechnicianTravelPage docId={docId} />;
}
