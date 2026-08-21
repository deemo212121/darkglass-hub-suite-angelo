import { createFileRoute } from "@tanstack/react-router";
import { FillWageAckPage } from "@/components/FillWageAckPage";

export const Route = createFileRoute("/fill-wage-ack/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Acknowledgment of Wage — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillWageAckPage docId={docId} />;
}
