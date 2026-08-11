import { createFileRoute } from "@tanstack/react-router";
import { SignTerminationFormPage } from "@/components/SignTerminationFormPage";

export const Route = createFileRoute("/sign-termination-form/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Sign Termination Notice — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <SignTerminationFormPage docId={docId} />;
}
