import { createFileRoute } from "@tanstack/react-router";
import { FillDirectDepositPage } from "@/components/FillDirectDepositPage";

export const Route = createFileRoute("/fill-direct-deposit/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Direct Deposit Authorization — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillDirectDepositPage docId={docId} />;
}
