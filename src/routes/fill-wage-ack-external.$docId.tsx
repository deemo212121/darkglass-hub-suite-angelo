import { createFileRoute } from "@tanstack/react-router";
import { ExternalFillWageAckPage } from "@/components/ExternalFillWageAckPage";

export const Route = createFileRoute("/fill-wage-ack-external/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Acknowledgment of Wage — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ExternalFillWageAckPage docId={docId} />;
}
