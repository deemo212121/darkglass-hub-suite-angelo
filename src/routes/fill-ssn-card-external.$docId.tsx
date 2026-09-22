import { createFileRoute } from "@tanstack/react-router";
import { ExternalFillSsnCardPage } from "@/components/ExternalFillSsnCardPage";

export const Route = createFileRoute("/fill-ssn-card-external/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `SSN Card — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ExternalFillSsnCardPage docId={docId} />;
}
