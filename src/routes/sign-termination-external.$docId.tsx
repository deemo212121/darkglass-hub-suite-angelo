import { createFileRoute } from "@tanstack/react-router";
import { ExternalSignTerminationFormPage } from "@/components/ExternalSignTerminationFormPage";

export const Route = createFileRoute("/sign-termination-external/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Sign Termination Notice — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ExternalSignTerminationFormPage docId={docId} />;
}
