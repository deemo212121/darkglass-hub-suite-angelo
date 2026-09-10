import { createFileRoute } from "@tanstack/react-router";
import { FillMasterW2AgreementPage } from "@/components/FillMasterW2AgreementPage";

export const Route = createFileRoute("/fill-master-w2-agreement/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Master W-2 Technician Agreement — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillMasterW2AgreementPage docId={docId} />;
}
