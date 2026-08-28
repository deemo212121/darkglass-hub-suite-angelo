import { createFileRoute } from "@tanstack/react-router";
import { FillFlashTechnicianTravelPage } from "@/components/FillFlashTechnicianTravelPage";

export const Route = createFileRoute("/fill-flash-technician-travel/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Flash Technician Travel & Out-of-State Policy — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillFlashTechnicianTravelPage docId={docId} />;
}
