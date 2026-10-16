import { createFileRoute } from "@tanstack/react-router";
import { CompleteCustomFormPage } from "@/components/CompleteCustomFormPage";

export const Route = createFileRoute("/complete-form/$submissionId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Sign Document — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { submissionId } = Route.useParams();
  return <CompleteCustomFormPage submissionId={submissionId} />;
}
