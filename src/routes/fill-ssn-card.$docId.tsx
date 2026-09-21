import { createFileRoute } from "@tanstack/react-router";
import { FillSsnCardPage } from "@/components/FillSsnCardPage";

export const Route = createFileRoute("/fill-ssn-card/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `SSN Card — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillSsnCardPage docId={docId} />;
}
