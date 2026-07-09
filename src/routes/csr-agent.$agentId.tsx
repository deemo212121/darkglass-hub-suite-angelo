import { createFileRoute } from "@tanstack/react-router";
import { CsrAgentDetailPage } from "@/components/CsrAgentDetailPage";

export const Route = createFileRoute("/csr-agent/$agentId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Agent Details — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { agentId } = Route.useParams();
  return <CsrAgentDetailPage agentId={agentId} />;
}
