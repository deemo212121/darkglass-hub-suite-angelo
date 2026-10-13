import { createFileRoute } from "@tanstack/react-router";
import { FillFlashTechnicianTravelPage } from "@/components/FillFlashTechnicianTravelPage";

export const Route = createFileRoute("/fill-flash-technician-travel/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Flash Tech Travel & Expense Policy Agreement — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillFlashTechnicianTravelPage docId={docId} />;
}
