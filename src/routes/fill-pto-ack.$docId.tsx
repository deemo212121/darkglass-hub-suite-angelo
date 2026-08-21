import { createFileRoute } from "@tanstack/react-router";
import { FillPtoAckPage } from "@/components/FillPtoAckPage";

export const Route = createFileRoute("/fill-pto-ack/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `PTO & Sick Leave Policy Acknowledgment — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillPtoAckPage docId={docId} />;
}
