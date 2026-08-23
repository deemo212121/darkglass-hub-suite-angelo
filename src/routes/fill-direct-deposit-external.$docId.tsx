import { createFileRoute } from "@tanstack/react-router";
import { ExternalFillDirectDepositPage } from "@/components/ExternalFillDirectDepositPage";

export const Route = createFileRoute("/fill-direct-deposit-external/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Direct Deposit Authorization — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ExternalFillDirectDepositPage docId={docId} />;
}
