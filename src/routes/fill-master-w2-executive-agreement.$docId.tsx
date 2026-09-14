import { createFileRoute } from "@tanstack/react-router";
import { FillMasterW2ExecutiveAgreementPage } from "@/components/FillMasterW2ExecutiveAgreementPage";

export const Route = createFileRoute("/fill-master-w2-executive-agreement/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `W-2 Executive Exempt Management Agreement — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillMasterW2ExecutiveAgreementPage docId={docId} />;
}
