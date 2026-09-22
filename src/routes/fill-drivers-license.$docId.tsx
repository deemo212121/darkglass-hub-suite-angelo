import { createFileRoute } from "@tanstack/react-router";
import { FillDriversLicensePage } from "@/components/FillDriversLicensePage";

export const Route = createFileRoute("/fill-drivers-license/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Driver's License — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillDriversLicensePage docId={docId} />;
}
