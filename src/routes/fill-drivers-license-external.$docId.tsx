import { createFileRoute } from "@tanstack/react-router";
import { ExternalFillDriversLicensePage } from "@/components/ExternalFillDriversLicensePage";

export const Route = createFileRoute("/fill-drivers-license-external/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Driver's License — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ExternalFillDriversLicensePage docId={docId} />;
}
