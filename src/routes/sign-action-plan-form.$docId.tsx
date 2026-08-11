import { createFileRoute } from "@tanstack/react-router";
import { SignActionPlanFormPage } from "@/components/SignActionPlanFormPage";

export const Route = createFileRoute("/sign-action-plan-form/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Sign Action Plan Form — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <SignActionPlanFormPage docId={docId} />;
}
