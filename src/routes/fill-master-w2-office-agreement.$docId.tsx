import { createFileRoute } from "@tanstack/react-router";
import { FillMasterW2OfficeAgreementPage } from "@/components/FillMasterW2OfficeAgreementPage";

export const Route = createFileRoute("/fill-master-w2-office-agreement/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Master W-2 Office Agreement — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillMasterW2OfficeAgreementPage docId={docId} />;
}
