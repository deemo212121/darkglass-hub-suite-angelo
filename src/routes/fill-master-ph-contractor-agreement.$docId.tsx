import { createFileRoute } from "@tanstack/react-router";
import { FillMasterPhContractorAgreementPage } from "@/components/FillMasterPhContractorAgreementPage";

export const Route = createFileRoute("/fill-master-ph-contractor-agreement/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Master Confidentiality, Non-Solicitation, and Affirmative Duty Agreement — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillMasterPhContractorAgreementPage docId={docId} />;
}
