import { createFileRoute } from "@tanstack/react-router";
import { FillPhAntiCloningAgreementPage } from "@/components/FillPhAntiCloningAgreementPage";

export const Route = createFileRoute("/fill-ph-anti-cloning-agreement/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Master PH Independent Contractor & Anti-Cloning Agreement — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillPhAntiCloningAgreementPage docId={docId} />;
}
