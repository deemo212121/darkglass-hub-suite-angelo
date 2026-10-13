import { createFileRoute } from "@tanstack/react-router";
import { FillConfidentialityNonCompeteAgreementPage } from "@/components/FillConfidentialityNonCompeteAgreementPage";

export const Route = createFileRoute("/fill-confidentiality-noncompete-agreement/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Master Confidentiality & Non-Compete Agreement — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillConfidentialityNonCompeteAgreementPage docId={docId} />;
}
