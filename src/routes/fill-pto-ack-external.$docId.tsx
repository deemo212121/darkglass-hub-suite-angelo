import { createFileRoute } from "@tanstack/react-router";
import { ExternalFillPtoAckPage } from "@/components/ExternalFillPtoAckPage";

export const Route = createFileRoute("/fill-pto-ack-external/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `PTO & Sick Leave Policy Acknowledgment — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ExternalFillPtoAckPage docId={docId} />;
}
