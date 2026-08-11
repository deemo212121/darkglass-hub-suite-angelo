import { createFileRoute } from "@tanstack/react-router";
import { ExternalSignActionPlanFormPage } from "@/components/ExternalSignActionPlanFormPage";

export const Route = createFileRoute("/sign-action-plan-external/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Sign Action Plan Form — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ExternalSignActionPlanFormPage docId={docId} />;
}
