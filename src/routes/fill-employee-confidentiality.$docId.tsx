import { createFileRoute } from "@tanstack/react-router";
import { FillEmployeeConfidentialityPage } from "@/components/FillEmployeeConfidentialityPage";

export const Route = createFileRoute("/fill-employee-confidentiality/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Employee Confidentiality Agreement — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillEmployeeConfidentialityPage docId={docId} />;
}
