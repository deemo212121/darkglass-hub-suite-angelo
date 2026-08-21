import { createFileRoute } from "@tanstack/react-router";
import { ExternalFillEmployeeConfidentialityPage } from "@/components/ExternalFillEmployeeConfidentialityPage";

export const Route = createFileRoute("/fill-employee-confidentiality-external/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Employee Confidentiality Agreement — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ExternalFillEmployeeConfidentialityPage docId={docId} />;
}
